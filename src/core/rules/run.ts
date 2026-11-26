import type { Finding, ScanContext } from '../types.ts';
import { findReadme } from '../manifest.ts';
import { mkFinding } from './util.ts';

const FILE_TOKEN = /(?:^|[\s"'=])((?:\.\/)?[\w./-]+\.(?:js|mjs|cjs|ts|mts|cts|py))(?=$|[\s"'])/;

export function runRules(ctx: ScanContext): Finding[] {
  const out: Finding[] = [];
  const { packageJson, packageJsonPath, primaryLang, pythonEntry, pythonDeps, hasMakefile, hasCompose } = ctx.manifest;

  if (packageJson && !hasMakefile && !hasCompose) {
    const scripts = packageJson.scripts ?? {};
    // 库（未提供 start/dev）不需要启动脚本，"能不能跑"对它是另一个问题
    const isLibrary = Boolean(packageJson.bin) || Boolean(packageJson.exports);
    if (!scripts.start && !scripts.dev) {
      out.push(
        mkFinding(ctx, {
          ruleId: 'RUN-01',
          group: 'run',
          severity: isLibrary ? 'info' : 'major',
          title: isLibrary ? '这是库，没有启动脚本（正常）' : 'package.json 没有 start / dev 脚本',
          file: packageJsonPath ?? 'package.json',
          detail: isLibrary
            ? 'package.json 声明了 bin / exports，属于被引用的库，不需要 start 脚本'
            : '既无 scripts.start 也无 scripts.dev，也没有 Makefile 或 docker-compose 兜底',
          remediation: isLibrary
            ? undefined
            : '添加 "dev" 或 "start" 脚本，并在 README 中给出启动命令',
        }),
      );
    }

    // RUN-03：脚本引用的入口文件不存在
    for (const [name, command] of Object.entries(scripts)) {
      const m = String(command).match(FILE_TOKEN);
      if (!m) continue;
      const target = m[1].replace(/^\.\//, '');
      if (target.startsWith('-')) continue;
      if (ctx.files.files.has(target)) continue;
      const pkgLines = ctx.files.files.get(packageJsonPath ?? 'package.json')?.lines ?? [];
      const line = pkgLines.findIndex((l) => l.includes(`"${name}"`)) + 1 || 1;
      out.push(
        mkFinding(ctx, {
          ruleId: 'RUN-03',
          group: 'run',
          severity: 'major',
          title: `启动脚本引用的文件不存在：${target}`,
          file: packageJsonPath ?? 'package.json',
          line,
          excerpt: `"${name}": "${command}"`,
          detail: `scripts.${name} 指向 ${target}，但该路径不在仓库中（常见于忘记提交构建产物）`,
          remediation: '改为指向存在的源文件，或在启动前先执行构建',
        }),
      );
    }
  }

  if (primaryLang === 'python' && !pythonEntry) {
    out.push(
      mkFinding(ctx, {
        ruleId: 'RUN-02',
        group: 'run',
        severity: 'major',
        title: 'Python 项目找不到入口',
        file: 'pyproject.toml',
        detail: '没有 __main__.py / main.py / app.py，也没有 if __name__ == "__main__" 的入口',
        remediation: '提供明确的入口文件，或申报 [project.scripts]',
      }),
    );
  }

  if (pythonDeps) {
    const readme = findReadme(ctx.files);
    const text = readme ? ctx.files.files.get(readme)?.lines?.join('\n') ?? '' : '';
    if (!/(pip3?\s+install|uv\s+(sync|pip)|poetry\s+install|conda\s+env)/i.test(text)) {
      out.push(
        mkFinding(ctx, {
          ruleId: 'RUN-05',
          group: 'run',
          severity: 'minor',
          title: '缺少依赖安装命令',
          file: readme ?? pythonDeps.path,
          detail: '有 Python 依赖清单，但 README 与脚本中都没有安装依赖的命令',
          remediation: '在 README 中加入 pip install -r requirements.txt 之类的命令',
        }),
      );
    }
  }

  return out;
}
