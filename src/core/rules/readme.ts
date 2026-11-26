import { clip } from '../lexicon.ts';
import type { Finding, ScanContext } from '../types.ts';
import { findReadme } from '../manifest.ts';
import { mkFinding } from './util.ts';

const INSTALL_HEADING = /(^|\n)#{1,6}[^\n]{0,80}(install|安装|quick\s*start|getting\s*started|快速开始|开始使用)/i;
const ENV_HEADING = /(^|\n)#{1,6}[^\n]{0,80}(env|environment\s*variable|configuration|配置|环境变量)/i;
const RUN_COMMAND = /(npm|pnpm|yarn|bun|pip3?|python3?|uv|poetry|docker|make|cargo|go\s+run|mvn|gradle)\s+[a-z@./-]/i;
const ENV_USAGE = /process\.env\.[A-Z_]+|os\.environ|import\.meta\.env/;

export function readmeRules(ctx: ScanContext): Finding[] {
  const out: Finding[] = [];
  const readmePath = findReadme(ctx.files);
  const pkg = ctx.manifest.packageJson;

  const envUsed = [...ctx.files.files.values()].some(
    (f) => f.kind === 'text' && f.lines && f.lines.some((l) => ENV_USAGE.test(l)),
  );

  if (!readmePath) {
    out.push(
      mkFinding(ctx, {
        ruleId: 'RD-01',
        group: 'readme',
        severity: 'major',
        title: '缺少 README',
        file: 'README.md',
        detail: '根目录未找到 README，接入方无法判断如何安装与运行',
        remediation: '补充 README，至少包含安装、启动、配置三个小节',
      }),
    );
    return out;
  }

  const rec = ctx.files.files.get(readmePath)!;
  const text = rec.lines?.join('\n') ?? '';
  const lineOf = (needle: RegExp): number => {
    const lines = rec.lines ?? [];
    const i = lines.findIndex((l) => needle.test(l));
    return i >= 0 ? i + 1 : 1;
  };

  if (!INSTALL_HEADING.test(text)) {
    out.push(
      mkFinding(ctx, {
        ruleId: 'RD-02',
        group: 'readme',
        severity: 'minor',
        title: 'README 缺少安装说明',
        file: readmePath,
        detail: '未找到 Installation / 安装 / Quick Start 类标题',
        remediation: '增加「安装」小节，给出完整的依赖安装命令',
      }),
    );
  }

  const fenced = text.match(/```[\s\S]*?```/g) ?? [];
  const hasRunCmd = fenced.some((block) => RUN_COMMAND.test(block));
  if (!hasRunCmd) {
    out.push(
      mkFinding(ctx, {
        ruleId: 'RD-03',
        group: 'readme',
        severity: 'major',
        title: 'README 里没有可执行的启动命令',
        file: readmePath,
        detail: '代码块中未出现 npm / pip / docker 等可复制执行的命令',
        remediation: '在 README 中给出可直接复制运行的一条启动命令',
      }),
    );
  }

  if (envUsed && !ENV_HEADING.test(text)) {
    out.push(
      mkFinding(ctx, {
        ruleId: 'RD-04',
        group: 'readme',
        severity: 'minor',
        title: '代码读取环境变量，但 README 未说明配置',
        file: readmePath,
        detail: '代码中存在 process.env / os.environ 读取，README 却没有配置章节',
        remediation: '列出必需的环境变量及其默认值，并附 .env.example',
      }),
    );
  }

  const bodyLength = text.replace(/\s+/g, '').length;
  if (bodyLength < 200) {
    out.push(
      mkFinding(ctx, {
        ruleId: 'RD-05',
        group: 'readme',
        severity: 'minor',
        title: 'README 内容过短',
        file: readmePath,
        excerpt: clip(`${bodyLength} 个非空白字符`, 60),
        detail: '过短的 README 通常意味着缺少关键说明',
      }),
    );
  }

  if (!text.includes('```')) {
    out.push(
      mkFinding(ctx, {
        ruleId: 'RD-06',
        group: 'readme',
        severity: 'minor',
        title: 'README 没有代码块',
        file: readmePath,
        detail: '命令与代码没有使用围栏代码块，复制时容易出错',
      }),
    );
  }

  // RD-07：README 提到的 npm script 在 package.json 里不存在
  if (pkg?.scripts) {
    const mentioned = new Set<string>();
    const re = /(?:npm\s+run|pnpm|yarn)\s+([a-z][\w:-]{0,30})/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) mentioned.add(m[1]);
    const reserved = new Set(['install', 'i', 'add', 'exec', 'dlx', 'create', 'init', 'publish', 'link', 'run']);
    const missing = [...mentioned].filter((s) => !reserved.has(s) && !(s in (pkg.scripts ?? {})));
    if (missing.length > 0) {
      out.push(
        mkFinding(ctx, {
          ruleId: 'RD-07',
          group: 'run',
          severity: 'minor',
          title: 'README 中的命令在 package.json 中不存在',
          file: readmePath,
          line: lineOf(new RegExp(`(?:npm run|pnpm|yarn)[^\\n]{0,20}${missing[0]}`)),
          detail: `README 提到 ${missing.slice(0, 3).map((s) => `\`${s}\``).join('、')}，但 scripts 中没有对应条目`,
          remediation: '补齐 scripts 条目，或修正 README 中的命令',
        }),
      );
    }
  }

  return out;
}
