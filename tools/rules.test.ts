import assert from 'node:assert/strict';
import test from 'node:test';
import { buildManifest } from '../src/core/manifest.ts';
import { runRules, sortFindings } from '../src/core/rules/index.ts';
import { scoreReport } from '../src/core/score.ts';
import type { FileRecord, RepoFiles } from '../src/core/types.ts';

function text(path: string, content: string): [string, FileRecord] {
  return [path, { path, size: content.length, kind: 'text', lang: null, lines: content.split('\n') }];
}

function scan(entries: [string, string][]) {
  const files = new Map<string, FileRecord>(entries.map(([path, content]) => text(path, content)));
  const repo: RepoFiles = { owner: 'o', repo: 'r', ref: 'main', commitSha: 'a'.repeat(40), files };
  const findings = sortFindings(runRules({ files: repo, manifest: buildManifest(repo), rulesetVersion: 'test' }));
  return { findings, score: scoreReport(findings) };
}

const README = '# Demo\n\n## Installation\n\n```bash\nnpm install\nnpm start\n```\n\n' + 'A'.repeat(300);
const PACKAGE = JSON.stringify({ name: 'demo', scripts: { start: 'node index.js' }, dependencies: { a: '1.0.0' } });
const BASE: [string, string][] = [
  ['README.md', README],
  ['package.json', PACKAGE],
  ['package-lock.json', '{}'],
  ['.gitignore', '.env\n'],
  ['index.js', 'console.log(1)\n'],
];

test('合成仓库仍触发 13 条预期规则', () => {
  const files: [string, string][] = [
    ['README.md', '# Demo\n\n一个演示项目，没有安装说明也没有命令。'],
    ['package.json', JSON.stringify({ name: 'demo', dependencies: { express: '^4.0.0' } }, null, 2)],
    [
      'src/index.js',
      [
        "const out = 'C:\\\\Users\\\\dev\\\\build';",
        "const apiKey = 'sk-abcdefghijklmnopqrstuvwxyz123456';",
        "const home = '/home/dev/project/data.json';",
      ].join('\n'),
    ],
    ['.gitignore', 'node_modules\ndist\n'],
    ['start.bat', '@echo off\nnode src/index.js\n'],
    ['deploy.ps1', 'Set-ExecutionPolicy Bypass -Scope Process\nnode src/index.js\n'],
    ['.env', 'API_KEY=9f8a7b6c5d4e3f2a1b0c7d6e5f\n'],
    ['.env.example', 'API_KEY=your_key_here\n'],
  ];
  const { findings, score } = scan(files);
  const ids = new Set(findings.map((f) => f.ruleId));
  for (const id of ['RD-02', 'RD-03', 'RD-06', 'DEP-02', 'RUN-01', 'WIN-01', 'WIN-02', 'WIN-03', 'PATH-01', 'PATH-03', 'SEC-02', 'SEC-05', 'SEC-06']) {
    assert.ok(ids.has(id), `缺少 ${id}`);
  }
  assert.equal(score.capped, true);
  assert.ok(score.total <= 40);
});

test('SEC-09：带厂商前缀的占位符降级为 info，不封顶', () => {
  const { findings, score } = scan([
    ...BASE,
    ['index.js', "const k = 'sk-your_key_here';\nconst k2 = 'sk-xxxxxxxxxxxxxxxxxxxxxxxx';\n"],
    ['.env.example', 'OPENAI_API_KEY=sk-your_key_here\nGITHUB=ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\n'],
  ]);
  assert.equal(findings.some((f) => f.severity === 'critical'), false);
  assert.equal(score.capped, false);
  assert.equal(score.total, 100);
  assert.ok(findings.some((f) => f.ruleId === 'SEC-02' && f.severity === 'info'));
});

test('真实 sk- 密钥仍判 critical，不被占位符规则吃掉', () => {
  const { findings } = scan([...BASE, ['index.js', "const k = 'sk-abcdefghijklmnopqrstuvwxyz123456';\n"]]);
  const hit = findings.find((f) => f.ruleId === 'SEC-02');
  assert.equal(hit?.severity, 'critical');
});

test('.env 短值不会通过证据上下文泄漏原文', () => {
  const { findings } = scan([...BASE, ['.env', 'K=abc123def456\n']]);
  const sec = findings.find((f) => f.ruleId === 'SEC-05');
  assert.equal(sec?.severity, 'critical');
  assert.equal(JSON.stringify(findings).includes('abc123def456'), false);
  assert.ok(sec?.context?.some((c) => c.text.includes('已脱敏')));
});

test('注释里的硬编码路径降级为 info，密钥在 docs 里仍保持 critical', () => {
  const comments = scan([...BASE, ['index.js', "// const p = 'C:\\\\Users\\\\dev\\\\x';\nconsole.log(1)\n"]]);
  const path = comments.findings.find((f) => f.ruleId === 'PATH-01');
  assert.equal(path?.severity, 'info');
  assert.equal(path?.downgradedFrom, 'major');

  const docs = scan([...BASE, ['docs/example.md', 'key: sk-abcdefghijklmnopqrstuvwxyz123456\n']]);
  assert.equal(docs.findings.find((f) => f.ruleId === 'SEC-02')?.severity, 'critical');
});

test('文件级结论也有行号（能找到对应文件时）', () => {
  const entries: [string, string][] = [
    ['README.md', '# Demo\n\n没有安装章节，也没有命令。'],
    ['package.json', JSON.stringify({ name: 'demo', dependencies: { a: '1.0.0' } })],
    ['.gitignore', '.env\n'],
    ['index.js', 'console.log(1)\n'],
  ];
  const { findings } = scan(entries);
  for (const id of ['RD-02', 'RD-03', 'RD-06', 'DEP-02', 'RUN-01']) {
    const f = findings.find((x) => x.ruleId === id);
    assert.ok(f, `缺少 ${id}`);
    assert.equal(f?.line, 1, `${id} 应定位到文件第 1 行`);
  }
});

test('.env.example 不触发 SEC-05', () => {
  const { findings } = scan([...BASE, ['.env.example', 'API_KEY=your_key_here\n']]);
  assert.equal(findings.some((f) => f.ruleId === 'SEC-05'), false);
});

test('配置文件的高熵赋值在上下文里也会脱敏', () => {
  const secret = 'aB3dE5fG7hJ9kL2mN4pQ6rS8tU0vW1xY';
  const { findings } = scan([...BASE, ['config.toml', `api_key = "${secret}"\n`]]);
  const hit = findings.find((f) => f.ruleId === 'SEC-08');
  assert.ok(hit, 'SEC-08 应命中');
  assert.equal(JSON.stringify(findings).includes(secret), false);
  assert.ok(hit?.context?.some((c) => c.text.includes('已脱敏')));
});

test('降级快照下跳过 RUN-03，避免把“没拉到”误判成“不存在”', () => {
  const files = new Map<string, FileRecord>(
    [
      ['README.md', README],
      ['package.json', JSON.stringify({ name: 'demo', scripts: { start: 'node dist/index.js' }, dependencies: { a: '1' } })],
      ['.gitignore', '.env\n'],
    ].map(([path, content]) => text(path, content)),
  );
  const repo: RepoFiles = { owner: 'o', repo: 'r', ref: 'main', commitSha: 'a'.repeat(40), files };
  const normal = runRules({ files: repo, manifest: buildManifest(repo), rulesetVersion: 'test' });
  assert.ok(normal.some((f) => f.ruleId === 'RUN-03'));
  const degraded = runRules({ files: repo, manifest: buildManifest(repo), rulesetVersion: 'test', degraded: true });
  assert.equal(degraded.some((f) => f.ruleId === 'RUN-03'), false);
});
