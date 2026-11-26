# 数据模型 · Report Schema v1

> 实现见 `src/core/types.ts`。本文件是契约：字段增删属于破坏性变更，需提升 `schemaVersion`。

---

## 1. 核心类型

```ts
export type Severity = 'critical' | 'major' | 'minor' | 'info';
export type RuleGroup = 'readme' | 'deps' | 'run' | 'win' | 'path' | 'secrets';

/** 单个文件在内存中的形态 */
export interface FileRecord {
  path: string;                 // 相对仓库根，已剥离 tarball 顶层 {repo}-{sha}/
  size: number;
  kind: 'text' | 'binary';
  lang: string | null;          // 'ts' | 'js' | 'py' | 'md' | null
  lines: string[] | null;       // 仅 text 且 ≤ 1MB；否则 null
  encoding: 'utf8' | 'utf8-lossy';
}

export interface RepoFiles {
  owner: string;
  repo: string;
  ref: string;                  // 用户请求的 ref，默认 default_branch
  commitSha: string;
  files: Map<string, FileRecord>;
  sampling: SamplingInfo | null;
}

export interface SamplingInfo {
  mode: 'exact' | 'sampled';
  totalFiles: number;
  scannedFiles: number;
  skippedFiles: number;
  reason: string;               // 'file-count' | 'archive-size' | 'time-budget'
}

/** 扫描上下文：规则函数的唯一入参 */
export interface ScanContext {
  files: RepoFiles;
  manifest: ManifestInfo;
  rulesetVersion: string;
  primaryLang: 'node' | 'python' | 'mixed' | 'unknown';
}
```

## 2. 检测结论

```ts
export interface Finding {
  ruleId: string;               // 如 'PATH-01'
  group: RuleGroup;
  severity: Severity;
  title: string;                // 人类可读，≤ 60 字
  file: string;                 // 必要，不可为空（Constitution 第三条）
  line?: number;                // 1-based
  excerpt?: string;             // ≤ 200 字符，密钥类必须已脱敏
  detail?: string;              // 命中原因说明
  remediation?: string;         // 修复建议，一句话
  weight: number;               // 排序权重，越大越靠前
  downgradedFrom?: Severity;    // 被抑制层降级时保留原级别，便于排查误抑制
}
```

**排序规则**：`severity` 降序 → `weight` 降序 → `file` 字典序 → `line` 升序。排序必须稳定可复现。

## 3. 评分

```ts
export interface Deduction {
  ruleId: string;
  points: number;               // 负数
  note: string;                 // '缺少 lockfile'
}

export interface SubScore {
  score: number;                // 0–100
  weight: number;               // 0.35 | 0.25 | 0.40
  deductions: Deduction[];      // UI 可展开查看
}

export interface ScoreBreakdown {
  total: number;                // 0–100 整数
  grade: 'A' | 'B' | 'C' | 'D';
  sub: {
    runnability: SubScore;
    configurability: SubScore;
    security: SubScore;
  };
  capped: boolean;
  capReason: string | null;     // '检测到 2 项严重风险，总分上限 40'
  confidence: 'exact' | 'sampled';
}
```

## 4. 报告

```ts
export interface Source {
  owner: string;
  repo: string;
  ref: string;
  commitSha: string;            // 完整 40 位
  shortSha: string;             // 前 7 位，UI 展示用
  fetchedAt: string;            // ISO 8601
  stars: number;
  language: string | null;
  archived: boolean;
  sizeKb: number;
}

export interface Report {
  id: string;                   // `${owner}__${repo}__${shortSha}`
  schemaVersion: 1;
  rulesetVersion: string;       // '1.0.0'
  source: Source;
  score: ScoreBreakdown;
  findings: Finding[];          // 全量，未分页
  stats: {
    filesScanned: number;
    filesSkipped: number;
    textFiles: number;
    binaryFiles: number;
  };
  timings: {
    meta: number; fetch: number; unpack: number;
    scan: number; score: number; explain: number; total: number;
  };
  sampling: SamplingInfo | null;
  degradations: string[];       // 'tarball 解压失败，已回退 Contents API'
  advice: Advice;               // 永不为 null

  /** 增量分析时存在 */
  diff?: {
    baseSha: string;
    headSha: string;
    changedFiles: string[];
    reusedFindings: number;
    rescannedFiles: number;
    scoreBefore: number;
    fallbackReason: string | null;   // 'compare-300-plus' | 'force-push'
  };

  analyzedAt: string;           // ISO 8601，不参与幂等比较
}
```

## 5. 建议层

```ts
export interface Advice {
  source: 'llm' | 'rules';      // UI 角标依据，不得伪装
  model?: string;               // source='llm' 时必填，如 'deepseek-chat'
  verdict: string;              // ≤ 60 字
  reasons: [string, string, string];
  actions: { title: string; detail: string; severity: Severity }[];
  degradedReason?: string;      // LLM 失败原因，仅调试展示
}
```

## 6. 不变量（单测必须断言）

| # | 不变量 |
|---|---|
| I-1 | `findings.every(f => f.file !== '')` |
| I-2 | `findings.every(f => f.severity in {critical,major,minor,info})` |
| I-3 | `0 <= score.total <= 100` 且为整数 |
| I-4 | `score.sub.*.score` 均在 0–100 |
| I-5 | 存在 critical 时 `score.total <= 40 && score.capped` |
| I-6 | `advice !== null` 恒成立 |
| I-7 | 同 `(commitSha, rulesetVersion)` 两次分析，除 `analyzedAt` 外深度相等 |
| I-8 | `JSON.stringify(report)` 不含任何原始密钥子串 |
| I-9 | `diff` 存在时，`diff.reusedFindings + 重算条数 >= 上一版 findings.length` |
| I-10 | 密钥类 `excerpt` 满足 `^.{0,4}…{0,2}$` 形态或 `****` |

## 7. 序列化约定

- 全部字段使用 `camelCase`；时间一律 ISO 8601 UTC（`2026-01-01T00:00:00.000Z`）。
- `Report` 必须可 `JSON.stringify` 无损往返（不支持循环引用、Map 等）。
- `RepoFiles.files` 在内存里是 `Map`，**不进报告**——报告只存结论，不存源码，避免缓存膨胀与泄漏面扩大。
- 缓存文件命名：`.cache/reports/{owner}__{repo}__{shortSha}.json`。
