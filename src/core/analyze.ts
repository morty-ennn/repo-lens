import { performance } from 'node:perf_hooks';
import { AnalyzeError } from './errors.ts';
import { buildAdvice } from './advice.ts';
import { fetchRepoMeta, fetchTarball } from './github.ts';
import { MAX_FILES, RULESET_VERSION } from './lexicon.ts';
import { buildManifest } from './manifest.ts';
import { parseRepoUrl } from './parse-url.ts';
import { runRules, sortFindings } from './rules/index.ts';
import { mkFinding } from './rules/util.ts';
import { scoreReport } from './score.ts';
import { unpackTarball } from './unpack.ts';
import type { Finding, Report, RepoFiles, ScanContext } from './types.ts';

export interface AnalyzeOptions {
  useLLM?: boolean;
}

export async function analyzeUrl(input: string, opts: AnalyzeOptions = {}): Promise<Report> {
  const t0 = performance.now();

  const parsed = parseRepoUrl(input);
  const t1 = performance.now();

  const meta = await fetchRepoMeta(parsed.owner, parsed.repo, parsed.ref);
  const t2 = performance.now();

  const tarball = await fetchTarball(meta.owner, meta.repo, meta.commitSha);
  const t3 = performance.now();

  const { files, skipped } = await unpackTarball(tarball);
  const t4 = performance.now();

  const repo: RepoFiles = {
    owner: meta.owner,
    repo: meta.repo,
    ref: meta.ref,
    commitSha: meta.commitSha,
    files,
  };

  const manifest = buildManifest(repo);
  const ctx: ScanContext = { files: repo, manifest, rulesetVersion: RULESET_VERSION };

  const degradations: string[] = [];
  let findings: Finding[] = runRules(ctx);

  if (files.size >= MAX_FILES) {
    degradations.push(`文件数达到 ${MAX_FILES} 上限，仅分析已解包的部分文件`);
  }
  if (files.size === 0) {
    findings.push(
      mkFinding(ctx, {
        ruleId: 'EMPTY-01',
        group: 'readme',
        severity: 'major',
        title: '仓库为空',
        file: 'README.md',
        detail: '快照中没有任何文件，无法进行接入评估',
      }),
    );
  }

  findings = sortFindings(findings);
  const t5 = performance.now();

  const score = scoreReport(findings, { empty: files.size === 0 });
  if (files.size >= MAX_FILES) score.confidence = 'sampled';
  const t6 = performance.now();

  const advice = await buildAdvice(score, findings, opts.useLLM ?? true);
  const t7 = performance.now();

  const textFiles = [...files.values()].filter((f) => f.kind === 'text').length;
  const shortSha = meta.commitSha.slice(0, 7);

  return {
    id: `${meta.owner}__${meta.repo}__${shortSha}`,
    schemaVersion: 1,
    rulesetVersion: RULESET_VERSION,
    source: {
      owner: meta.owner,
      repo: meta.repo,
      ref: meta.ref,
      commitSha: meta.commitSha,
      shortSha,
      fetchedAt: new Date().toISOString(),
      stars: meta.stars,
      language: meta.language,
      archived: meta.archived,
      sizeKb: meta.sizeKb,
      description: meta.description,
    },
    score,
    findings,
    stats: {
      totalFiles: files.size,
      textFiles,
      binaryFiles: files.size - textFiles,
      filesScanned: files.size - skipped,
    },
    timings: {
      meta: Math.round(t2 - t1),
      fetch: Math.round(t3 - t2),
      unpack: Math.round(t4 - t3),
      scan: Math.round(t5 - t4),
      score: Math.round(t6 - t5),
      total: Math.round(t7 - t0),
    },
    degradations,
    advice,
    analyzedAt: new Date().toISOString(),
  };
}

export { AnalyzeError };
