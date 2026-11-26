/**
 * 规则自检：构造一个「什么都踩」的合成仓库，断言该触发的规则都触发了。
 * 这不是完整单测，但能挡住正则写错、规则被抑制层吃掉这类硬伤。
 * 用法：node tools/rules-check.ts
 */
import { buildManifest } from '../src/core/manifest.ts';
import { runRules, sortFindings } from '../src/core/rules/index.ts';
import { scoreReport } from '../src/core/score.ts';
import type { FileRecord, RepoFiles } from '../src/core/types.ts';

function text(path: string, content: string): [string, FileRecord] {
  return [path, { path, size: content.length, kind: 'text', lang: null, lines: content.split('\n') }];
}

const files = new Map<string, FileRecord>([
  text('README.md', '# Demo\n\n一个演示项目，没有安装说明也没有命令。'),
  text('package.json', JSON.stringify({ name: 'demo', dependencies: { express: '^4.0.0' } }, null, 2)),
  text(
    'src/index.js',
    [
      "const out = 'C:\\\\Users\\\\dev\\\\build';",
      "const apiKey = 'sk-abcdefghijklmnopqrstuvwxyz123456';",
      "const home = '/home/dev/project/data.json';",
      'module.exports = { out, apiKey, home };',
    ].join('\n'),
  ),
  text('.gitignore', 'node_modules\ndist\n'),
  text('start.bat', '@echo off\nnode src/index.js\n'),
  text('deploy.ps1', 'Set-ExecutionPolicy Bypass -Scope Process\nnode src/index.js\n'),
  text('.env', 'API_KEY=9f8a7b6c5d4e3f2a1b0c7d6e5f\nDB=postgres://localhost/db\n'),
  text('.env.example', 'API_KEY=your_key_here\nDB=postgres://localhost/db\n'),
]);

const repo: RepoFiles = { owner: 'demo', repo: 'demo', ref: 'main', commitSha: 'a'.repeat(40), files };
const manifest = buildManifest(repo);
const findings = sortFindings(runRules({ files: repo, manifest, rulesetVersion: 'selfcheck' }));
const score = scoreReport(findings);

const expected = [
  'RD-02', // 无安装章节
  'RD-03', // 无可执行命令
  'RD-06', // 无代码块
  'DEP-02', // 无 lockfile
  'RUN-01', // 无 start/dev
  'WIN-01', // 存在 .bat
  'WIN-02', // 只有 Windows 启动方式
  'WIN-03', // -ExecutionPolicy Bypass
  'PATH-01', // C:\ 路径
  'PATH-03', // /home/ 路径
  'SEC-02', // sk- 密钥
  'SEC-05', // .env 入库
  'SEC-06', // .gitignore 未忽略 .env
];

const got = new Set(findings.map((f) => f.ruleId));
const missing = expected.filter((r) => !got.has(r));

// 泄漏检查：脱敏后的报告里不能出现完整密钥
const serialized = JSON.stringify(findings);
const leak = serialized.includes('abcdefghijklmnopqrstuvwxyz');
const skFinding = findings.find((f) => f.ruleId === 'SEC-02');

console.log('\n合成仓库共触发', findings.length, '条结论：');
for (const f of findings) {
  console.log(`  ${f.severity.padEnd(8)} ${f.ruleId.padEnd(7)} ${f.file}${f.line ? ':' + f.line : ''}`);
}
console.log(`\n评分 ${score.total} 分 · ${score.grade} 级 · capped=${score.capped}`);
console.log(`封顶原因：${score.capReason ?? '—'}`);

if (missing.length > 0) {
  console.error('\n✗ 未触发：', missing.join(', '));
  process.exit(1);
}

console.log(`\n密钥脱敏样例：${skFinding?.excerpt ?? '（未命中）'}`);
if (leak) {
  console.error('✗ 完整密钥出现在报告里，违反 Constitution 第四条');
  process.exit(1);
}

console.log('\n✓ 13 条规则全部按预期触发，且报告中没有密钥原文');
