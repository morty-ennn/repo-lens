import assert from 'node:assert/strict';
import test from 'node:test';
import { parseRepoUrl } from '../src/core/parse-url.ts';

test('支持 AC-1.2 的五种 URL 形态', () => {
  const cases: [string, { owner: string; repo: string; ref: string | null }][] = [
    ['https://github.com/o/r', { owner: 'o', repo: 'r', ref: null }],
    ['https://github.com/o/r.git', { owner: 'o', repo: 'r', ref: null }],
    ['github.com/o/r', { owner: 'o', repo: 'r', ref: null }],
    ['https://github.com/o/r/', { owner: 'o', repo: 'r', ref: null }],
    ['https://github.com/o/r/tree/main', { owner: 'o', repo: 'r', ref: 'main' }],
  ];
  for (const [input, expected] of cases) assert.deepEqual(parseRepoUrl(input), expected);
});

test('支持 git@github.com:owner/repo.git', () => {
  assert.deepEqual(parseRepoUrl('git@github.com:o/r.git'), { owner: 'o', repo: 'r', ref: null });
});

test('非 GitHub 主机给出明确错误', () => {
  assert.throws(() => parseRepoUrl('https://gitlab.com/x/y'), /暂只支持 GitHub/);
});

test('空输入与缺 owner/repo 报 INVALID_URL', () => {
  assert.throws(() => parseRepoUrl(''), /请输入一个 GitHub 仓库地址/);
  assert.throws(() => parseRepoUrl('https://github.com/onlyowner'), /缺少 owner\/repo/);
});
