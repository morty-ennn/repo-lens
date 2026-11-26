import { extOf } from '../lexicon.ts';
import type { Finding, ScanContext } from '../types.ts';
import { thirdPartyImports } from '../manifest.ts';
import { mkFinding } from './util.ts';

export function depsRules(ctx: ScanContext): Finding[] {
  const out: Finding[] = [];
  const { packageJson, packageJsonPath, hasLockfile, pythonDeps, primaryLang } = ctx.manifest;

  const paths = [...ctx.files.files.keys()];
  const jsSources = paths.filter((p) => /\.(js|mjs|cjs|ts|mts|cts|jsx|tsx)$/i.test(p));
  const pySources = paths.filter((p) => extOf(p) === 'py');
  const hasSource = jsSources.length + pySources.length > 0;
  const hasAnyManifest = Boolean(packageJson || pythonDeps);

  if (hasSource && !hasAnyManifest) {
    const first = jsSources[0] ?? pySources[0];
    out.push(
      mkFinding(ctx, {
        ruleId: 'DEP-01',
        group: 'deps',
        severity: 'major',
        title: '有源码但没有任何依赖清单',
        file: first,
        line: 1,
        detail: '仓库包含源码文件，却找不到 package.json / requirements.txt / pyproject.toml',
        remediation: '补一份依赖清单并锁定版本，否则接入方无法复现环境',
      }),
    );
  }

  if (packageJson && !hasLockfile) {
    out.push(
      mkFinding(ctx, {
        ruleId: 'DEP-02',
        group: 'deps',
        severity: 'minor',
        title: '有 package.json，但缺少 lockfile',
        file: packageJsonPath ?? 'package.json',
        detail: '没有 package-lock.json / pnpm-lock.yaml / yarn.lock，依赖版本不可复现',
        remediation: '提交 lockfile，保证不同机器安装结果一致',
      }),
    );
  }

  if (packageJson && !packageJson.dependencies && !packageJson.devDependencies) {
    out.push(
      mkFinding(ctx, {
        ruleId: 'DEP-05',
        group: 'deps',
        severity: 'minor',
        title: 'package.json 里没有任何依赖声明',
        file: packageJsonPath ?? 'package.json',
        detail: '既无 dependencies 也无 devDependencies',
      }),
    );
  }

  if (!pythonDeps && pySources.length > 0 && primaryLang !== 'node') {
    const imports = thirdPartyImports(ctx.files);
    if (imports.size > 0) {
      const [name, where] = [...imports.entries()][0];
      out.push(
        mkFinding(ctx, {
          ruleId: 'DEP-03',
          group: 'deps',
          severity: 'major',
          title: 'Python 项目引用了第三方包，但没有依赖清单',
          file: where.file,
          line: where.line,
          excerpt: `import ${name}`,
          detail: `检测到 ${imports.size} 个第三方 import（如 ${name}），但没有 requirements.txt / pyproject.toml`,
          remediation: '生成 requirements.txt 或 pyproject.toml，并固定版本',
        }),
      );
    }
  }

  if (pythonDeps) {
    const lines = (pythonDeps.raw ?? '')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#') && !l.startsWith('-'));
    const unpinned = lines.filter((l) => !/[=<>~!]/.test(l));
    if (lines.length > 0 && unpinned.length === lines.length) {
      out.push(
        mkFinding(ctx, {
          ruleId: 'DEP-04',
          group: 'deps',
          severity: 'minor',
          title: 'Python 依赖全部未固定版本',
          file: pythonDeps.path,
          line: 1,
          excerpt: unpinned[0],
          detail: `${lines.length} 条依赖均无版本约束，安装结果会随上游变化`,
          remediation: '使用 == 固定主版本，或提供 poetry.lock / uv.lock',
        }),
      );
    }
  }

  return out;
}
