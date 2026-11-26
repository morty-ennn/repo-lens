import type { Deduction, Finding, Grade, ScoreBreakdown, SubScore } from './types.ts';

interface RuleDeduct {
  sub: 'run' | 'cfg' | 'sec';
  points: number;
}

/** 扣分表，对应 spec §5.2 */
const TABLE: Record<string, RuleDeduct> = {
  'DEP-01': { sub: 'run', points: 45 },
  'DEP-03': { sub: 'run', points: 45 },
  'RUN-01': { sub: 'run', points: 40 },
  'RUN-02': { sub: 'run', points: 25 },
  'RUN-03': { sub: 'run', points: 20 },
  'RD-03': { sub: 'run', points: 15 },
  'DEP-02': { sub: 'run', points: 10 },
  'RD-07': { sub: 'run', points: 5 },
  'RD-05': { sub: 'run', points: 5 },

  'RD-01': { sub: 'cfg', points: 55 },
  'RD-02': { sub: 'cfg', points: 20 },
  'RD-04': { sub: 'cfg', points: 15 },
  'RD-06': { sub: 'cfg', points: 5 },
  'PATH-01': { sub: 'cfg', points: 8 },
  'PATH-02': { sub: 'cfg', points: 8 },
  'PATH-03': { sub: 'cfg', points: 8 },
  'PATH-04': { sub: 'cfg', points: 3 },
  'PATH-05': { sub: 'cfg', points: 1 },

  'SEC-01': { sub: 'sec', points: 50 },
  'SEC-02': { sub: 'sec', points: 50 },
  'SEC-03': { sub: 'sec', points: 50 },
  'SEC-04': { sub: 'sec', points: 15 },
  'SEC-05': { sub: 'sec', points: 50 },
  'SEC-06': { sub: 'sec', points: 20 },
  'SEC-07': { sub: 'sec', points: 50 },
  'SEC-08': { sub: 'sec', points: 15 },
  'SEC-10': { sub: 'sec', points: 50 },
  'WIN-02': { sub: 'sec', points: 10 },
};

const WEIGHTS = { run: 0.35, cfg: 0.25, sec: 0.4 } as const;
const PATH_CAP = 30;
const SEC_MAJOR_CAP = 45;
const SEC_MAJOR_IDS = new Set(['SEC-04', 'SEC-08']);

export function gradeOf(total: number): Grade {
  if (total >= 85) return 'A';
  if (total >= 70) return 'B';
  if (total >= 50) return 'C';
  return 'D';
}

export function scoreReport(findings: Finding[], opts: { empty?: boolean } = {}): ScoreBreakdown {
  const deductions: Record<'run' | 'cfg' | 'sec', Deduction[]> = { run: [], cfg: [], sec: [] };

  if (!opts.empty) {
    for (const f of findings) {
      if (f.severity === 'info') continue;
      // SEC-05 的严重度由内容决定：只有真的像凭证时才按 critical 扣 50
      if (f.ruleId === 'SEC-05' && f.severity !== 'critical') continue;
      const rule = TABLE[f.ruleId];
      if (!rule) continue;
      deductions[rule.sub].push({
        ruleId: f.ruleId,
        points: -rule.points,
        note: f.line ? `${f.title}（${f.file}:${f.line}）` : `${f.title}（${f.file}）`,
      });
    }
  }

  // 同类封顶：路径类最多扣 30，安全类 major 最多扣 45
  capCategory(deductions.cfg, PATH_CAP, ['PATH-01', 'PATH-02', 'PATH-03', 'PATH-04', 'PATH-05']);
  capCategory(
    deductions.sec,
    SEC_MAJOR_CAP,
    [...SEC_MAJOR_IDS],
  );

  const run = subScore(deductions.run, WEIGHTS.run);
  const cfg = subScore(deductions.cfg, WEIGHTS.cfg);
  const sec = subScore(deductions.sec, WEIGHTS.sec);

  let total = Math.round(run.score * WEIGHTS.run + cfg.score * WEIGHTS.cfg + sec.score * WEIGHTS.sec);
  const criticals = findings.filter((f) => f.severity === 'critical');
  let capped = false;
  let capReason: string | null = null;

  if (criticals.length > 0) {
    total = Math.min(total, 40);
    capped = true;
    capReason = `检测到 ${criticals.length} 项严重风险，总分上限为 40`;
  }

  if (opts.empty) {
    total = 0;
    capReason = '仓库为空，没有任何可分析的制品';
  }

  return {
    total: Math.max(0, Math.min(100, Math.round(total))),
    grade: gradeOf(total),
    sub: { runnability: run, configurability: cfg, security: sec },
    capped,
    capReason,
    confidence: 'exact',
  };
}

function subScore(list: Deduction[], weight: number): SubScore {
  const score = Math.max(0, 100 + list.reduce((sum, d) => sum + d.points, 0));
  return { score, weight, deductions: list };
}

/** 把某一类规则的扣分折叠到上限内，并在末条注明 */
function capCategory(list: Deduction[], cap: number, ruleIds: string[]): void {
  const target = list.filter((d) => ruleIds.includes(d.ruleId));
  if (target.length === 0) return;
  const sum = target.reduce((s, d) => s + d.points, 0); // 负数
  if (sum >= -cap) return;

  const kept = list.filter((d) => !ruleIds.includes(d.ruleId));
  const first = target[0];
  kept.push({
    ruleId: first.ruleId,
    points: -cap,
    note: `${target.length} 处同类问题合并计 -${cap}（上限）`,
  });
  list.length = 0;
  list.push(...kept);
}
