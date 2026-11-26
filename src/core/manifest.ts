import { LOCKFILES, PY_STDLIB, basename, extOf } from './lexicon.ts';
import type { ManifestInfo, PackageJson, RepoFiles } from './types.ts';

const PY_DEP_FILES = ['requirements.txt', 'requirements-dev.txt', 'pyproject.toml', 'Pipfile', 'setup.py'];

export function buildManifest(repo: RepoFiles): ManifestInfo {
  const paths = [...repo.files.keys()];

  const pkgPath = paths.find((p) => p === 'package.json') ?? null;
  let packageJson: PackageJson | null = null;
  if (pkgPath) {
    try {
      packageJson = JSON.parse(repo.files.get(pkgPath)!.lines?.join('\n') ?? '{}') as PackageJson;
    } catch {
      packageJson = null;
    }
  }

  const rootNames = new Set(paths.filter((p) => !p.includes('/')));
  const hasLockfile = LOCKFILES.some((l) => rootNames.has(l));

  const pyDepPath = PY_DEP_FILES.map((n) => paths.find((p) => p === n)).find(Boolean) ?? null;
  const pythonDeps = pyDepPath
    ? { path: pyDepPath, raw: repo.files.get(pyDepPath)?.lines?.join('\n') ?? '' }
    : null;

  const windowsScripts = paths.filter((p) => /\.(bat|cmd|ps1|vbs)$/i.test(p));
  const posixScripts = paths.filter((p) => /\.(sh|bash|zsh)$/i.test(p));

  const pythonEntry =
    paths.find((p) => /^(__main__|main|app|manage|cli|run)\.py$/.test(p))
    ?? paths.find((p) => {
      const lines = repo.files.get(p)?.lines;
      if (!lines || extOf(p) !== 'py') return false;
      return lines.some((l) => /if\s+__name__\s*==\s*['"]__main__['"]/.test(l));
    })
    ?? null;

  const jsCount = paths.filter((p) => /\.(js|mjs|cjs|ts|mts|cts|jsx|tsx)$/i.test(p)).length;
  const pyCount = paths.filter((p) => /\.py$/i.test(p)).length;
  let primaryLang: ManifestInfo['primaryLang'] = 'unknown';
  if (jsCount > 0 && pyCount > 0) primaryLang = jsCount >= pyCount * 2 ? 'node' : pyCount >= jsCount * 2 ? 'python' : 'mixed';
  else if (jsCount > 0) primaryLang = 'node';
  else if (pyCount > 0) primaryLang = 'python';

  return {
    primaryLang,
    packageJson,
    packageJsonPath: pkgPath,
    hasLockfile,
    pythonDeps,
    pythonEntry,
    windowsScripts,
    posixScripts,
    hasMakefile: rootNames.has('Makefile') || rootNames.has('makefile'),
    hasCompose:
      rootNames.has('docker-compose.yml') ||
      rootNames.has('docker-compose.yaml') ||
      rootNames.has('compose.yml') ||
      rootNames.has('compose.yaml'),
    hasGitignore: rootNames.has('.gitignore'),
  };
}

/** 提取 Python 中 import 的第三方顶层包名 */
export function thirdPartyImports(repo: RepoFiles): Map<string, { file: string; line: number }> {
  const out = new Map<string, { file: string; line: number }>();
  for (const [path, rec] of repo.files) {
    if (extOf(path) !== 'py' || !rec.lines) continue;
    rec.lines.forEach((line, i) => {
      const m = line.match(/^\s*(?:from|import)\s+([A-Za-z_][\w.]*)/);
      if (!m) return;
      const top = m[1].split('.')[0];
      if (PY_STDLIB.has(top) || top.startsWith('_')) return;
      if (!out.has(top)) out.set(top, { file: path, line: i + 1 });
    });
  }
  return out;
}

export function rootFile(repo: RepoFiles, name: string): string | null {
  return repo.files.has(name) ? name : null;
}

export function findReadme(repo: RepoFiles): string | null {
  for (const p of repo.files.keys()) {
    if (!p.includes('/') && /^readme(\.(md|markdown|rst|txt))?$/i.test(basename(p))) return p;
  }
  return null;
}
