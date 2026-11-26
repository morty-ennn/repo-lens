import {
  CONFIG_EXTS,
  SECRET_PATTERNS,
  extOf,
  isPlaceholder,
  isRealEnvFile,
  redact,
  shannonEntropy,
} from '../lexicon.ts';
import type { Finding, ScanContext } from '../types.ts';
import { mkFinding } from './util.ts';

const SKIP_PATH = /node_modules\/|\.min\.js$|\/dist\/|\/build\/|\.map$|-lock\.json$|lock\.yaml$/i;
const SECRETISH_KEY = /key|token|secret|pass|pwd|credential|auth|signature|salt/i;

export function secretRules(ctx: ScanContext): Finding[] {
  const out: Finding[] = [];
  const seen = new Set<string>();

  for (const [path, rec] of ctx.files.files) {
    if (rec.kind !== 'text' || !rec.lines) continue;
    if (SKIP_PATH.test(path)) continue;

    const limit = Math.min(rec.lines.length, 5000);
    for (let i = 0; i < limit; i++) {
      const line = rec.lines[i];
      if (!line || line.length > 2000) continue;

      for (const pat of SECRET_PATTERNS) {
        const m = line.match(pat.re);
        if (!m) continue;
        const key = `${pat.ruleId}|${path}`;
        if (seen.has(key)) break;

        const raw = (m[1] ?? m[0]).trim();
        const placeholder = isPlaceholder(raw);

        seen.add(key);
        out.push(
          mkFinding(ctx, {
            ruleId: pat.ruleId,
            group: 'secrets',
            severity: placeholder ? 'info' : pat.severity,
            title: pat.title,
            file: path,
            line: i + 1,
            excerpt: placeholder ? `占位符：${redact(raw)}` : redact(raw),
            detail: placeholder
              ? '命中密钥形态，但值看起来是占位符，已降级为提示'
              : `检测到疑似真实凭证（已脱敏）。完整值不会出现在报告、日志或缓存中`,
            remediation: placeholder ? '确认示例值不含真实密钥即可' : '立即在仓库中移除该凭证并轮换（revoke），改用环境变量注入',
            keepSeverity: true,
          }),
        );
        break;
      }
    }
  }

  // SEC-05：真实的 .env 文件入库。只有里面确实像真凭证时才判 critical
  for (const [path, rec] of ctx.files.files) {
    if (!isRealEnvFile(path)) continue;
    const lines = rec.lines ?? [];
    let realLooking = false;
    for (const line of lines) {
      const m = line.match(/^\s*[A-Za-z0-9_]+\s*=\s*(.+)$/);
      if (!m) continue;
      const v = m[1].replace(/^["']|["']$/g, '').trim();
      if (v.length >= 12 && !isPlaceholder(v) && !/^https?:/i.test(v) && shannonEntropy(v) >= 3.5) {
        realLooking = true;
        break;
      }
    }
    const inTestDir = /(^|\/)(tests?|fixtures?|examples?)\//i.test(path);

    out.push(
      mkFinding(ctx, {
        ruleId: 'SEC-05',
        group: 'secrets',
        severity: realLooking ? 'critical' : 'minor',
        title: realLooking ? '.env 文件被提交进仓库' : '.env 文件被提交（内容未见明显凭证）',
        file: path,
        line: 1,
        detail: realLooking
          ? '.env 内存有高熵值，疑似真实凭证。一旦入库即视为已泄漏，历史提交里仍然存在'
          : `已提交的 .env${inTestDir ? '（位于测试/示例目录，通常是夹具）' : ''}，当前内容未见真实凭证，但仍是坏习惯`,
        remediation: realLooking
          ? '从版本库移除并加入 .gitignore，轮换其中所有密钥，改用 .env.example'
          : '改为提交 .env.example，把 .env 加入 .gitignore',
        keepSeverity: true,
      }),
    );
  }

  // SEC-06：忽略规则缺失（只有真的会用到环境变量时才当风险）
  const gitignore = ctx.files.files.get('.gitignore');
  const ignoresEnv = Boolean(gitignore?.lines?.some((l) => /^\.?env/i.test(l.trim()) && !l.trim().startsWith('#')));
  if (!gitignore || !ignoresEnv) {
    const envUsed = [...ctx.files.files.values()].some(
      (f) => f.kind === 'text' && f.lines?.some((l) => /process\.env\.|os\.environ|import\.meta\.env/.test(l)),
    );
    const envRelevant = envUsed || [...ctx.files.files.keys()].some(isRealEnvFile);
    out.push(
      mkFinding(ctx, {
        ruleId: 'SEC-06',
        group: 'secrets',
        severity: envRelevant ? 'major' : 'info',
        title: gitignore ? '.gitignore 未忽略 .env' : '仓库没有 .gitignore',
        file: '.gitignore',
        detail: gitignore
          ? envRelevant
            ? '.gitignore 中没有 .env 相关规则，本地凭证容易被误提交'
            : '.gitignore 中没有 .env 规则；但仓库未读取环境变量，优先级低'
          : envRelevant
            ? '缺少 .gitignore，且仓库会读取环境变量，凭证被误提交的风险较高'
            : '缺少 .gitignore；仓库未读取环境变量，优先级低',
        remediation: '在 .gitignore 中加入 .env / .env.local 等规则',
        keepSeverity: true,
      }),
    );
  }

  // SEC-08：配置类文件里的高熵赋值
  for (const [path, rec] of ctx.files.files) {
    if (rec.kind !== 'text' || !rec.lines) continue;
    const isConfig = CONFIG_EXTS.has(extOf(path)) || path.toLowerCase().includes('.env');
    if (!isConfig || SKIP_PATH.test(path)) continue;
    if (seen.has(`SEC-08|${path}`)) continue;

    const limit = Math.min(rec.lines.length, 800);
    for (let i = 0; i < limit; i++) {
      const line = rec.lines[i];
      if (!line || line.length < 20 || line.length > 500) continue;
      const m = line.match(/([\w.-]{2,40})\s*[:=]\s*["']?([A-Za-z0-9+/_\-=.]{20,120})["']?/);
      if (!m) continue;
      if (!SECRETISH_KEY.test(m[1])) continue;
      if (isPlaceholder(m[2])) continue;
      if (shannonEntropy(m[2]) < 4.5) continue;

      seen.add(`SEC-08|${path}`);
      out.push(
        mkFinding(ctx, {
          ruleId: 'SEC-08',
          group: 'secrets',
          severity: 'major',
          title: '配置文件中存在高熵字符串',
          file: path,
          line: i + 1,
          excerpt: redact(m[2]),
          detail: `字段 ${m[1]} 的值随机度较高，疑似真实凭证（已脱敏）`,
          remediation: '确认是否为真实凭证；若是，改从环境变量读取',
          keepSeverity: true,
        }),
      );
      break;
    }
  }

  return out;
}
