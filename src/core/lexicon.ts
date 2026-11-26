/** 集中存放扩展名表、正则与词表：正则只在这里编译一次，量词一律带上界（防 ReDoS）。 */

export const RULESET_VERSION = '1.0.0';

export const MAX_FILE_BYTES = 1_000_000;
export const MAX_FILES = 5000;
export const MAX_ARCHIVE_BYTES = 60_000_000;

const TEXT_EXTS = new Set([
  'md', 'markdown', 'mdx', 'txt', 'rst', 'adoc',
  'js', 'mjs', 'cjs', 'ts', 'mts', 'cts', 'jsx', 'tsx', 'vue', 'svelte',
  'json', 'jsonc', 'yml', 'yaml', 'toml', 'ini', 'cfg', 'conf', 'properties',
  'py', 'pyi', 'sh', 'bash', 'zsh', 'bat', 'cmd', 'ps1', 'vbs',
  'go', 'rs', 'java', 'kt', 'php', 'rb', 'cs', 'c', 'h', 'cpp', 'hpp',
  'css', 'scss', 'less', 'html', 'htm', 'xml', 'svg', 'sql', 'graphql',
  'env', 'lock', 'gitignore', 'npmrc', 'editorconfig', 'dockerfile', 'gradle',
]);

const TEXT_BASENAMES = new Set([
  'readme', 'license', 'licence', 'makefile', 'dockerfile', 'procfile',
  'changelog', 'contributing', 'authors', 'notice', 'copying',
  '.gitignore', '.gitattributes', '.npmrc', '.nvmrc', '.editorconfig', '.env',
]);

export const CODE_EXTS = new Set([
  'js', 'mjs', 'cjs', 'ts', 'mts', 'cts', 'jsx', 'tsx', 'vue', 'svelte',
  'py', 'sh', 'bash', 'bat', 'cmd', 'ps1', 'vbs', 'go', 'rs', 'java', 'kt',
  'php', 'rb', 'cs', 'c', 'h', 'cpp', 'hpp',
]);

export const CONFIG_EXTS = new Set(['env', 'json', 'yml', 'yaml', 'toml', 'ini', 'cfg', 'conf', 'properties']);

export function basename(p: string): string {
  const i = p.lastIndexOf('/');
  return i === -1 ? p : p.slice(i + 1);
}

export function dirname(p: string): string {
  const i = p.lastIndexOf('/');
  return i === -1 ? '' : p.slice(0, i);
}

export function extOf(p: string): string {
  const b = basename(p);
  const i = b.lastIndexOf('.');
  if (i <= 0) return '';
  return b.slice(i + 1).toLowerCase();
}

export function isTextPath(p: string): boolean {
  const b = basename(p).toLowerCase();
  if (TEXT_BASENAMES.has(b)) return true;
  if (b.startsWith('.env')) return true;
  const e = extOf(p);
  if (!e) return false;
  return TEXT_EXTS.has(e);
}

export function langOf(p: string): string | null {
  const e = extOf(p);
  const b = basename(p).toLowerCase();
  if (b === 'dockerfile') return 'docker';
  if (b === 'makefile') return 'make';
  const map: Record<string, string> = {
    ts: 'ts', mts: 'ts', cts: 'ts', tsx: 'ts', js: 'js', mjs: 'js', cjs: 'js', jsx: 'js',
    py: 'python', pyi: 'python', md: 'markdown', markdown: 'markdown', json: 'json',
    yml: 'yaml', yaml: 'yaml', toml: 'toml', sh: 'shell', bash: 'shell',
    bat: 'bat', cmd: 'bat', ps1: 'powershell', vbs: 'vbscript', html: 'html', css: 'css',
  };
  return map[e] ?? (e || null);
}

/** 真正的 .env 文件（排除模板） */
export function isRealEnvFile(p: string): boolean {
  const b = basename(p).toLowerCase();
  if (!b.startsWith('.env')) return false;
  if (/\.(example|sample|template|dist|defaults?)$/.test(b)) return false;
  return true;
}

export function isExampleEnvFile(p: string): boolean {
  const b = basename(p).toLowerCase();
  return b.startsWith('.env') && /\.(example|sample|template|dist|defaults?)$/.test(b);
}

export function isDocsOrFixturePath(p: string): boolean {
  return /^(docs?|examples?|samples?|test|tests|__tests__|spec|specs|fixtures?|benchmarks?|\.github)\//i.test(p)
    || /\/(docs?|examples?|fixtures?|__tests__)\//i.test(p);
}

export function isCommentLine(line: string): boolean {
  const t = line.trimStart();
  return t.startsWith('//') || t.startsWith('#') || t.startsWith('*')
    || t.startsWith('/*') || t.startsWith('<!--') || t.startsWith('-- ');
}

/** 占位符白名单：命中即把密钥类结论降级为 info（spec SEC-09） */
export function isPlaceholder(value: string): boolean {
  const v = value.trim();
  if (v.length === 0) return true;
  if (/^(your|xxx+|placeholder|change[_-]?me|example|dummy|test|sample|todo|none|null|undefined|fake|mock|redacted)/i.test(v)) return true;
  if (/[<>{}]|\$\{|%[A-Z_]+%/.test(v)) return true;
  if (/^[*.\-_x]+$/i.test(v)) return true;
  if (/^(process\.env|os\.environ|import\.meta\.env|env\.)/i.test(v)) return true;
  if (/(your|replace|insert|put)[-_ ].*(key|token|secret|here)/i.test(v)) return true;
  return false;
}

export function shannonEntropy(s: string): number {
  if (!s) return 0;
  const freq = new Map<string, number>();
  for (const ch of s) freq.set(ch, (freq.get(ch) ?? 0) + 1);
  let h = 0;
  for (const n of freq.values()) {
    const p = n / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

/** 前 4 后 2 脱敏；短于 8 位一律全遮挡（Constitution 第四条） */
export function redact(secret: string): string {
  const s = secret.trim();
  if (s.length < 8) return '****';
  return `${s.slice(0, 4)}…${s.slice(-2)}`;
}

export function clip(line: string, max = 180): string {
  const t = line.trim();
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

/* ------------------------------------------------------------------ */
/* 密钥正则                                                            */
/* ------------------------------------------------------------------ */

export const SECRET_PATTERNS: { ruleId: string; title: string; re: RegExp; severity: 'critical' | 'major' }[] = [
  {
    ruleId: 'SEC-01',
    title: '私钥文件内容入库',
    re: /-----BEGIN ((?:RSA|OPENSSH|EC|DSA|PGP|ENCRYPTED) )?PRIVATE KEY-----/,
    severity: 'critical',
  },
  {
    ruleId: 'SEC-02',
    title: 'OpenAI/Anthropic 风格密钥（sk-）',
    re: /\bsk-[A-Za-z0-9_-]{20,200}\b/,
    severity: 'critical',
  },
  {
    ruleId: 'SEC-03',
    title: '阿里云 AccessKey（AKID / LTAI）',
    re: /\b(?:AKID[A-Za-z0-9]{12,40}|LTAI[A-Za-z0-9]{12,40})\b/,
    severity: 'critical',
  },
  {
    ruleId: 'SEC-10',
    title: 'AWS Access Key（AKIA）',
    re: /\bAKIA[0-9A-Z]{16}\b/,
    severity: 'critical',
  },
  {
    ruleId: 'SEC-07',
    title: 'GitHub / Slack Token',
    re: /\b(?:ghp_[A-Za-z0-9]{30,60}|github_pat_[A-Za-z0-9_]{20,120}|xox[baprs]-[A-Za-z0-9-]{10,80})\b/,
    severity: 'critical',
  },
  {
    ruleId: 'SEC-04',
    title: '硬编码 Bearer Token',
    re: /\bBearer\s+([A-Za-z0-9\-._~+/]{20,200}=*)/,
    severity: 'major',
  },
];

/* ------------------------------------------------------------------ */
/* 路径正则                                                            */
/* ------------------------------------------------------------------ */

export const PATH_PATTERNS: { ruleId: string; title: string; re: RegExp; severity: 'major' | 'minor' }[] = [
  { ruleId: 'PATH-01', title: '硬编码 Windows 盘符路径', re: /(?:^|[^A-Za-z0-9_])[A-Za-z]:[\\/][^\s'"`)]{0,120}/, severity: 'major' },
  { ruleId: 'PATH-02', title: '硬编码 macOS 用户目录', re: /\/Users\/[A-Za-z0-9._-]{1,40}\/[^\s'"`)]{0,120}/, severity: 'major' },
  { ruleId: 'PATH-03', title: '硬编码 Linux 用户目录', re: /\/home\/[A-Za-z0-9._-]{1,40}\/[^\s'"`)]{0,120}/, severity: 'major' },
  { ruleId: 'PATH-04', title: '绝对路径传入文件 API', re: /(?:join|resolve|open|readFile|readFileSync|writeFile)\(\s*['"]\/(?!\/)[^'"]{1,120}['"]/, severity: 'minor' },
  { ruleId: 'PATH-05', title: '路径中包含中文字符', re: /['"][^'"]{0,80}[\u4e00-\u9fa5][^'"]{0,80}[\\/][^'"]{0,80}['"]/, severity: 'minor' },
];

/* ------------------------------------------------------------------ */
/* Python 标准库（用于「第三方 import 但无依赖清单」判定）              */
/* ------------------------------------------------------------------ */

export const PY_STDLIB = new Set([
  '__future__', 'abc', 'argparse', 'array', 'asyncio', 'base64', 'binascii', 'bisect', 'builtins',
  'calendar', 'collections', 'concurrent', 'configparser', 'contextlib', 'copy', 'csv', 'ctypes',
  'dataclasses', 'datetime', 'decimal', 'difflib', 'dis', 'email', 'enum', 'errno', 'faulthandler',
  'filecmp', 'fileinput', 'fnmatch', 'fractions', 'ftplib', 'functools', 'gc', 'getpass', 'glob',
  'gzip', 'hashlib', 'heapq', 'hmac', 'html', 'http', 'imaplib', 'importlib', 'inspect', 'io',
  'ipaddress', 'itertools', 'json', 'keyword', 'linecache', 'locale', 'logging', 'lzma', 'mailbox',
  'math', 'mimetypes', 'multiprocessing', 'numbers', 'operator', 'os', 'pathlib', 'pdb', 'pickle',
  'pkgutil', 'platform', 'plistlib', 'pprint', 'profile', 'pstats', 'queue', 'random', 're',
  'readline', 'reprlib', 'sched', 'secrets', 'select', 'shelve', 'shlex', 'shutil', 'signal',
  'site', 'smtplib', 'socket', 'socketserver', 'sqlite3', 'ssl', 'stat', 'statistics', 'string',
  'struct', 'subprocess', 'sys', 'sysconfig', 'tarfile', 'tempfile', 'textwrap', 'threading',
  'time', 'timeit', 'tkinter', 'token', 'tokenize', 'traceback', 'tracemalloc', 'types', 'typing',
  'unicodedata', 'unittest', 'urllib', 'uuid', 'venv', 'warnings', 'wave', 'weakref', 'webbrowser',
  'xml', 'xmlrpc', 'zipapp', 'zipfile', 'zlib', 'zoneinfo',
]);

export const LOCKFILES = ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lockb', 'npm-shrinkwrap.json'];
