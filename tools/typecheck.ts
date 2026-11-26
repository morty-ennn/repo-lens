/**
 * 零依赖语法检查：Node 22 原生剥离 TypeScript 类型后执行 `node --check`。
 * 注意：这不是 `tsc --noEmit` 的完整类型检查，只能抓语法错误、非法 import/export
 * 和明显的模块解析问题；真正的类型兼容仍靠测试与运行。
 */
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const SKIP = new Set(['node_modules', '.git', '.cache', 'dist']);
const EXTS = new Set(['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs']);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') && entry.name !== '.gitignore') continue;
    if (SKIP.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (EXTS.has(entry.name.slice(entry.name.lastIndexOf('.')))) out.push(full);
  }
  return out;
}

const files = [
  ...walk(join(ROOT, 'src')),
  ...walk(join(ROOT, 'tools')),
  join(ROOT, 'server.ts'),
  join(ROOT, 'start.mjs'),
  join(ROOT, 'public', 'app.js'),
];
let failed = 0;

for (const file of files) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  } catch {
    failed++;
    console.error(`✗ 语法检查失败：${file.slice(ROOT.length + 1)}`);
  }
}

if (failed > 0) process.exit(1);
console.log(`✓ ${files.length} 个文件的语法检查通过（Node 类型剥离，非 tsc 全量类型检查）`);
