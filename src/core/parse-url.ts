import { AnalyzeError } from './errors.ts';

export interface ParsedRepo {
  owner: string;
  repo: string;
  ref: string | null;
}

/**
 * 支持：
 *   https://github.com/o/r
 *   https://github.com/o/r.git
 *   github.com/o/r
 *   https://github.com/o/r/
 *   https://github.com/o/r/tree/branch
 *   git@github.com:o/r.git
 */
export function parseRepoUrl(input: string): ParsedRepo {
  const raw = (input ?? '').trim();
  if (!raw) {
    throw new AnalyzeError('INVALID_URL', '请输入一个 GitHub 仓库地址', { httpStatus: 400, hint: '例如 https://github.com/vercel/next.js' });
  }

  // git@github.com:owner/repo.git
  const ssh = raw.match(/^git@github\.com:([\w.-]+)\/([\w.-]+?)(?:\.git)?$/i);
  if (ssh) return finalize(ssh[1], ssh[2], null);

  let normalized = raw;
  if (!/^https?:\/\//i.test(normalized)) normalized = `https://${normalized}`;

  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    throw new AnalyzeError('INVALID_URL', '无法解析该地址', { httpStatus: 400 });
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  if (host !== 'github.com') {
    throw new AnalyzeError('UNSUPPORTED_HOST', `暂只支持 GitHub，收到的是 ${host}`, {
      httpStatus: 400,
      hint: '本期仅支持 github.com，GitLab/Gitee 在路线图中',
    });
  }

  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length < 2) {
    throw new AnalyzeError('INVALID_URL', '地址里缺少 owner/repo', { httpStatus: 400 });
  }

  const owner = parts[0];
  const repo = parts[1].replace(/\.git$/i, '');

  let ref: string | null = null;
  if (parts[2] === 'tree' || parts[2] === 'blob') {
    ref = parts.slice(3).join('/') || null;
  }

  return finalize(owner, repo, ref);
}

function finalize(owner: string, repo: string, ref: string | null): ParsedRepo {
  const ok = /^[\w.-]+$/;
  if (!ok.test(owner) || !ok.test(repo) || owner.length > 100 || repo.length > 100) {
    throw new AnalyzeError('INVALID_URL', 'owner/repo 含有非法字符', { httpStatus: 400 });
  }
  return { owner, repo, ref };
}
