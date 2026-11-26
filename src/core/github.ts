import { AnalyzeError } from './errors.ts';
import { MAX_ARCHIVE_BYTES, MAX_FILE_BYTES, langOf } from './lexicon.ts';
import type { FileRecord } from './types.ts';

const API = 'https://api.github.com';
const META_TIMEOUT = 30_000;
const ARCHIVE_TIMEOUT = 120_000;

export interface RepoMeta {
  owner: string;
  repo: string;
  ref: string;
  commitSha: string;
  stars: number;
  language: string | null;
  archived: boolean;
  sizeKb: number;
  description: string | null;
}

export function hasToken(): boolean {
  return Boolean(process.env.GITHUB_TOKEN?.trim());
}

function apiHeaders(): Record<string, string> {
  const h: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'repo-health-check',
  };
  const token = process.env.GITHUB_TOKEN?.trim();
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

/** 把 fetch + 读 body 包在一起：超时可能在读完 header 之后才触发 */
async function ghJson<T>(url: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { headers: apiHeaders(), cache: 'no-store', signal: AbortSignal.timeout(META_TIMEOUT) });
  } catch {
    throw new AnalyzeError('UPSTREAM_TIMEOUT', '连接 GitHub 超时', { httpStatus: 504, retryable: true });
  }
  if (!res.ok) throwForStatus(res);

  try {
    return (await res.json()) as T;
  } catch {
    throw new AnalyzeError('UPSTREAM_TIMEOUT', '读取 GitHub 响应超时', { httpStatus: 504, retryable: true });
  }
}

function throwForStatus(res: Response): never {
  const remaining = res.headers.get('x-ratelimit-remaining');
  const reset = res.headers.get('x-ratelimit-reset');
  const resetAt = reset ? new Date(Number(reset) * 1000).toISOString() : null;

  if (res.status === 404) {
    throw new AnalyzeError('REPO_NOT_FOUND', '仓库不存在或为私有仓库', {
      httpStatus: 404,
      hint: '请检查 owner/repo 拼写，或确认仓库已公开',
    });
  }
  if (res.status === 403 || res.status === 429) {
    throw new AnalyzeError('RATE_LIMITED', remaining === '0' ? 'GitHub 匿名配额已用尽' : 'GitHub 拒绝了本次请求', {
      httpStatus: 429,
      retryable: true,
      resetAt,
      hint: hasToken() ? '当前已配置 GITHUB_TOKEN，请稍后重试' : '配置环境变量 GITHUB_TOKEN 可提升到 5000 次/小时',
    });
  }
  if (res.status >= 500) {
    throw new AnalyzeError('UPSTREAM_TIMEOUT', 'GitHub 服务暂时不可用', { httpStatus: 504, retryable: true });
  }
  throw new AnalyzeError('INTERNAL', `GitHub 返回了 ${res.status}`, { httpStatus: 502, retryable: true });
}

export async function fetchRepoMeta(owner: string, repo: string, ref: string | null): Promise<RepoMeta> {
  const meta = await ghJson<{
    default_branch?: string;
    stargazers_count?: number;
    language?: string | null;
    archived?: boolean;
    size?: number;
    description?: string | null;
  }>(`${API}/repos/${owner}/${repo}`);

  const targetRef = ref ?? meta.default_branch ?? 'main';

  // 用户直接给了 40 位 SHA 时省掉一次请求
  let commitSha = /^[0-9a-f]{40}$/i.test(targetRef) ? targetRef : '';
  if (!commitSha) {
    const commit = await ghJson<{ sha?: string }>(
      `${API}/repos/${owner}/${repo}/commits/${encodeURIComponent(targetRef)}`,
    );
    commitSha = commit.sha ?? '';
  }

  if (!commitSha) {
    throw new AnalyzeError('INTERNAL', '未能解析出 commit SHA', { httpStatus: 502, retryable: true });
  }

  return {
    owner,
    repo,
    ref: targetRef,
    commitSha,
    stars: meta.stargazers_count ?? 0,
    language: meta.language ?? null,
    archived: Boolean(meta.archived),
    sizeKb: meta.size ?? 0,
    description: meta.description ?? null,
  };
}

/** 快照失败时的兜底文件集：覆盖 README、依赖清单、入口与跨平台脚本。 */
const FALLBACK_PATHS = [
  'README.md', 'README', 'readme.md', 'Readme.md', 'README.rst', 'README.txt',
  'package.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lockb', 'npm-shrinkwrap.json',
  'requirements.txt', 'requirements-dev.txt', 'pyproject.toml', 'Pipfile', 'setup.py', 'poetry.lock', 'uv.lock',
  '.gitignore', '.env.example', '.env.sample', '.env.template',
  'main.py', 'app.py', '__main__.py', 'manage.py', 'cli.py', 'run.py',
  'index.js', 'index.ts', 'server.js', 'server.ts', 'src/index.js', 'src/index.ts',
  'src/main.py', 'src/app.py', 'src/server.js', 'src/server.ts',
  'Makefile', 'docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml', 'Dockerfile',
  'start.sh', 'start.bat', 'start.ps1', 'Procfile',
];

/**
 * tarball 下载/解包失败时的降级路径：先用 git tree 拿到文件清单，再用 Contents API
 * 逐个拉关键文件。走 api.github.com（会消耗配额），但只在 codeload 失败时触发。
 */
export async function fetchFallbackSnapshot(
  owner: string,
  repo: string,
  commitSha: string,
): Promise<Map<string, FileRecord>> {
  const files = new Map<string, FileRecord>();

  let available: Set<string>;
  try {
    const tree = await ghJson<{ tree?: { path?: string; type?: string }[] }>(
      `${API}/repos/${owner}/${repo}/git/trees/${commitSha}?recursive=1`,
    );
    available = new Set(
      (tree.tree ?? [])
        .filter((e) => e.type === 'blob' && typeof e.path === 'string')
        .map((e) => e.path as string),
    );
  } catch {
    return files;
  }

  const picked = FALLBACK_PATHS.filter((p) => available.has(p)).slice(0, 24);

  for (let i = 0; i < picked.length; i += 4) {
    const batch = picked.slice(i, i + 4);
    const results = await Promise.all(
      batch.map(async (path) => {
        const encoded = path.split('/').map(encodeURIComponent).join('/');
        try {
          const res = await fetch(`${API}/repos/${owner}/${repo}/contents/${encoded}?ref=${commitSha}`, {
            headers: { ...apiHeaders(), Accept: 'application/vnd.github.raw' },
            cache: 'no-store',
            signal: AbortSignal.timeout(15_000),
          });
          if (!res.ok) return null;
          const buf = Buffer.from(await res.arrayBuffer());
          if (buf.byteLength === 0 || buf.byteLength > MAX_FILE_BYTES) return null;
          const content = buf.toString('utf8');
          if (content.includes('\u0000')) return null;
          return {
            path,
            size: buf.byteLength,
            kind: 'text' as const,
            lang: langOf(path),
            lines: content.replace(/^\uFEFF/, '').split(/\r?\n/),
          };
        } catch {
          return null;
        }
      }),
    );
    for (const rec of results) if (rec) files.set(rec.path, rec);
  }

  return files;
}

/** codeload 不走 API 配额，用 SHA 请求保证快照可复现（Constitution 第九条） */
export async function fetchTarball(owner: string, repo: string, commitSha: string): Promise<Buffer> {
  const url = `https://codeload.github.com/${owner}/${repo}/tar.gz/${commitSha}`;

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { 'User-Agent': 'repo-health-check' },
      cache: 'no-store',
      signal: AbortSignal.timeout(ARCHIVE_TIMEOUT),
    });
  } catch {
    throw new AnalyzeError('UPSTREAM_TIMEOUT', '下载仓库快照超时', { httpStatus: 504, retryable: true });
  }

  if (res.status === 404) {
    throw new AnalyzeError('REPO_NOT_FOUND', '仓库快照不存在', { httpStatus: 404 });
  }
  if (!res.ok) {
    throw new AnalyzeError('UNPACK_FAILED', `下载快照失败（${res.status}）`, { httpStatus: 502, retryable: true });
  }

  const declared = Number(res.headers.get('content-length') ?? 0);
  if (declared > MAX_ARCHIVE_BYTES) {
    throw new AnalyzeError(
      'REPO_TOO_LARGE',
      `仓库快照 ${(declared / 1e6).toFixed(0)} MB，超过 ${MAX_ARCHIVE_BYTES / 1e6} MB 上限`,
      { httpStatus: 413, hint: '超大仓库不在本期范围内，请换一个中小型仓库演示' },
    );
  }

  let buf: Buffer;
  try {
    buf = Buffer.from(await res.arrayBuffer());
  } catch {
    throw new AnalyzeError('UPSTREAM_TIMEOUT', '下载仓库快照中断', { httpStatus: 504, retryable: true });
  }

  if (buf.byteLength > MAX_ARCHIVE_BYTES) {
    throw new AnalyzeError('REPO_TOO_LARGE', '仓库快照超过大小上限', { httpStatus: 413 });
  }
  return buf;
}
