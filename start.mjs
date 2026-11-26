/**
 * 启动器：先检查 Node 版本，再动态加载 server.ts。
 * 这样在低版本 Node 上能给出人话提示，而不是 "Unknown file extension .ts"。
 */
const [major, minor] = process.versions.node.split('.').map(Number);

const ok = major > 22 || (major === 22 && minor >= 18);

if (!ok) {
  console.error(
    `\n  需要 Node.js >= 22.18（原生运行 TypeScript），当前是 v${process.versions.node}。\n` +
      `  升级方式：https://nodejs.org/ 或 nvm install 22\n`,
  );
  process.exit(1);
}

await import('./server.ts');
