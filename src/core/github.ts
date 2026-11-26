import { AnalyzeError } from './errors.ts';
import { MAX_ARCHIVE_BYTES } from './lexicon.ts';

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
