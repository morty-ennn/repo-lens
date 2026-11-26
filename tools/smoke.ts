/**
 * 冒烟测试：不走 HTTP，直接跑分析内核，用来验证规则与评分链路。
 * 用法：node tools/smoke.ts [仓库地址]
 */
import { analyzeUrl } from '../src/core/analyze.ts';

const target = process.argv[2] ?? 'https://github.com/chalk/chalk';

console.log(`\n▶ 分析 ${target}\n`);

const t0 = Date.now();
const report = await analyzeUrl(target, { useLLM: false });
const elapsed = Date.now() - t0;

const problems: string[] = [];

if (report.findings.some((f) => !f.file)) problems.push('存在没有 file 字段的 finding');
if (report.score.total < 0 || report.score.total > 100) problems.push('总分越界');
if (!Number.isInteger(report.score.total)) problems.push('总分不是整数');
const criticals = report.findings.filter((f) => f.severity === 'critical');
if (criticals.length > 0 && report.score.total > 40) problems.push('critical 存在但总分未封顶');

console.log(`仓库     ${report.source.owner}/${report.source.repo} @ ${report.source.shortSha}`);
console.log(`文件     ${report.stats.totalFiles} 个（文本 ${report.stats.textFiles}）`);
console.log(`评分     ${report.score.total} 分 · ${report.score.grade} 级${report.score.capped ? '（已封顶）' : ''}`);
console.log(
  `子分     可运行 ${report.score.sub.runnability.score} / 可配置 ${report.score.sub.configurability.score} / 安全 ${report.score.sub.security.score}`,
);
console.log(`耗时     ${elapsed}ms（fetch ${report.timings.fetch}ms · unpack ${report.timings.unpack}ms · scan ${report.timings.scan}ms）`);
console.log(`结论     ${report.findings.length} 条`);
console.log(`建议     [${report.advice.source}] ${report.advice.verdict}\n`);

const bySeverity = { critical: 0, major: 0, minor: 0, info: 0 };
for (const f of report.findings) bySeverity[f.severity]++;

console.log('严重度分布', bySeverity);
console.log('\n前 8 条：');
for (const f of report.findings.slice(0, 8)) {
  console.log(`  [${f.severity.padEnd(8)}] ${f.ruleId.padEnd(7)} ${f.file}${f.line ? `:${f.line}` : ''}  ${f.title}`);
}

console.log('');
if (problems.length > 0) {
  console.error('✗ 不变量检查失败：');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log('✓ 不变量检查通过');
