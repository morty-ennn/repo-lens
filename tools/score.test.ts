import assert from 'node:assert/strict';
import test from 'node:test';
import { gradeOf, scoreReport } from '../src/core/score.ts';
import type { Severity } from '../src/core/types.ts';

function finding(ruleId: string, severity: Severity = 'major') {
  return { ruleId, group: 'run' as const, severity, title: ruleId, file: 'x', line: 1, weight: 10 };
}

test('等级边界：85/84/70/69/50/49', () => {
  assert.equal(gradeOf(85), 'A');
  assert.equal(gradeOf(84), 'B');
  assert.equal(gradeOf(70), 'B');
  assert.equal(gradeOf(69), 'C');
  assert.equal(gradeOf(50), 'C');
  assert.equal(gradeOf(49), 'D');
});

test('任一 critical 封顶到 40 分', () => {
  const score = scoreReport([finding('SEC-02', 'critical')]);
  assert.equal(score.total, 40);
  assert.equal(score.capped, true);
  assert.match(score.capReason ?? '', /严重风险/);
});

test('空仓库 0 分 + 说明，而不是 100 分', () => {
  const score = scoreReport([], { empty: true });
  assert.equal(score.total, 0);
  assert.equal(score.grade, 'D');
  assert.match(score.capReason ?? '', /仓库为空/);
});

test('路径类扣分合计封顶 -30', () => {
  const score = scoreReport([
    finding('PATH-01'),
    finding('PATH-01'),
    finding('PATH-01'),
    finding('PATH-01'),
    finding('PATH-01'),
  ]);
  const pathDeductions = score.sub.configurability.deductions;
  assert.equal(pathDeductions.reduce((s, d) => s + d.points, 0), -30);
});

test('子分下限为 0', () => {
  const score = scoreReport([finding('RD-01'), finding('RD-02'), finding('RD-04'), finding('RD-06'), finding('PATH-01')]);
  assert.equal(score.sub.configurability.score, 0);
  assert.equal(score.total, 75);
});
