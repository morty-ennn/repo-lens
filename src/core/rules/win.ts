import type { Finding, ScanContext } from '../types.ts';
import { mkFinding } from './util.ts';

export function winRules(ctx: ScanContext): Finding[] {
  const out: Finding[] = [];
  const { windowsScripts, posixScripts, packageJson } = ctx.manifest;

  // WIN-01：如实陈述平台绑定事实，不扣分
  for (const path of windowsScripts.slice(0, 8)) {
    out.push(
      mkFinding(ctx, {
        ruleId: 'WIN-01',
        group: 'win',
        severity: 'info',
        title: '存在 Windows 专用脚本',
        file: path,
        line: 1,
        detail: '该脚本只能在 Windows 上直接运行，非 Windows 环境需要等价替代',
      }),
    );
  }
  if (windowsScripts.length > 8) {
    out.push(
      mkFinding(ctx, {
        ruleId: 'WIN-01',
        group: 'win',
        severity: 'info',
        title: '存在 Windows 专用脚本',
        file: windowsScripts[8],
        detail: `另有 ${windowsScripts.length - 8} 个 Windows 脚本未逐一列出`,
      }),
    );
  }

  // WIN-02：唯一的启动方式是 Windows 脚本
  if (windowsScripts.length > 0 && posixScripts.length === 0) {
    const startCmd = String(packageJson?.scripts?.start ?? packageJson?.scripts?.dev ?? '');
    const windowsOnly = !startCmd || /\.(bat|cmd|ps1)$/i.test(startCmd);
    if (windowsOnly) {
      out.push(
        mkFinding(ctx, {
          ruleId: 'WIN-02',
          group: 'win',
          severity: 'major',
          title: '启动方式被 Windows 脚本绑定',
          file: windowsScripts[0],
          line: 1,
          detail: '仓库只有 Windows 脚本，没有 .sh 或跨平台的 npm 脚本',
          remediation: '补一个 .sh 或把启动逻辑放进 package.json 的 scripts',
        }),
      );
    }
  }

  // WIN-03：绕过 PowerShell 执行策略
  for (const path of windowsScripts) {
    if (!path.toLowerCase().endsWith('.ps1')) continue;
    const rec = ctx.files.files.get(path);
    if (!rec?.lines) continue;
    const idx = rec.lines.findIndex((l) => /-ExecutionPolicy\s+Bypass/i.test(l));
    if (idx >= 0) {
      out.push(
        mkFinding(ctx, {
          ruleId: 'WIN-03',
          group: 'win',
          severity: 'minor',
          title: '脚本要求绕过 PowerShell 执行策略',
          file: path,
          line: idx + 1,
          excerpt: rec.lines[idx].trim().slice(0, 120),
          detail: 'ExecutionPolicy Bypass 会让使用者在不知情的情况下执行任意脚本',
          remediation: '用签名脚本，或在文档中说明为何需要绕过策略',
        }),
      );
    }
  }

  return out;
}
