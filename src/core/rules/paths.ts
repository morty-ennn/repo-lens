import { CODE_EXTS, CONFIG_EXTS, PATH_PATTERNS, extOf } from '../lexicon.ts';
import type { Finding, ScanContext } from '../types.ts';
import { mkFinding } from './util.ts';

const SCRIPT_EXTS = new Set(['sh', 'bash', 'bat', 'cmd', 'ps1', 'vbs']);
const MAX_LINES_PER_FILE = 3000;

function scannable(path: string): boolean {
  const e = extOf(path);
  if (SCRIPT_EXTS.has(e)) return true;
  if (CODE_EXTS.has(e)) return true;
  if (CONFIG_EXTS.has(e)) return true;
  return false;
}

export function pathRules(ctx: ScanContext): Finding[] {
  const out: Finding[] = [];

  for (const [path, rec] of ctx.files.files) {
    if (rec.kind !== 'text' || !rec.lines) continue;
    if (!scannable(path)) continue;
    if (path.includes('node_modules/') || /\.min\.(js|css)$/i.test(path)) continue;

    const limit = Math.min(rec.lines.length, MAX_LINES_PER_FILE);
    for (let i = 0; i < limit; i++) {
      const line = rec.lines[i];
      if (!line || line.length > 1000) continue;

      for (const pat of PATH_PATTERNS) {
        const m = line.match(pat.re);
        if (!m) continue;

        out.push(
          mkFinding(ctx, {
            ruleId: pat.ruleId,
            group: 'path',
            severity: pat.severity,
            title: pat.title,
            file: path,
            line: i + 1,
            excerpt: line.trim().slice(0, 160),
            detail:
              pat.ruleId === 'PATH-01'
                ? '盘符路径只在开发者的 Windows 机器上成立，换机或上容器即失败'
                : pat.ruleId === 'PATH-02' || pat.ruleId === 'PATH-03'
                  ? '用户主目录被写死，其他机器上该目录不存在'
                  : '绝对路径缺少可移植性，建议基于项目根目录或环境变量拼接',
            remediation:
              pat.ruleId === 'PATH-01' || pat.ruleId === 'PATH-02' || pat.ruleId === 'PATH-03'
                ? "改为 path.join(root, 'relative/path') 或读取配置文件"
                : undefined,
          }),
        );
        break; // 同一行被一条路径规则命中即可，避免重复刷屏
      }
    }
  }

  return out;
}
