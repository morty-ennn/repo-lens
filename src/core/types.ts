/** 全局数据契约，对应 specs/001-repo-health/data-model.md */

export type Severity = 'critical' | 'major' | 'minor' | 'info';
export type RuleGroup = 'readme' | 'deps' | 'run' | 'win' | 'path' | 'secrets';
export type Grade = 'A' | 'B' | 'C' | 'D';

export interface FileRecord {
  path: string;
  size: number;
  kind: 'text' | 'binary';
  lang: string | null;
  lines: string[] | null;
}

export interface RepoFiles {
  owner: string;
  repo: string;
  ref: string;
  commitSha: string;
  files: Map<string, FileRecord>;
}

export interface Finding {
  ruleId: string;
  group: RuleGroup;
  severity: Severity;
  title: string;
  file: string;
  line?: number;
  excerpt?: string;
  detail?: string;
  remediation?: string;
  weight: number;
  downgradedFrom?: Severity;
  /** 命中行 ±2 行的上下文，供 UI 展开，不包含整份源码 */
  context?: { line: number; text: string }[];
}

export interface PackageJson {
  name?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  main?: string;
  bin?: string | Record<string, string>;
  exports?: unknown;
  type?: string;
}

export interface ManifestInfo {
  primaryLang: 'node' | 'python' | 'mixed' | 'unknown';
  packageJson: PackageJson | null;
  packageJsonPath: string | null;
  hasLockfile: boolean;
  pythonDeps: { path: string; raw: string } | null;
  pythonEntry: string | null;
  windowsScripts: string[];
  posixScripts: string[];
  hasMakefile: boolean;
  hasCompose: boolean;
  hasGitignore: boolean;
}

export interface ScanContext {
  files: RepoFiles;
  manifest: ManifestInfo;
  rulesetVersion: string;
}

export interface Deduction {
  ruleId: string;
  points: number;
  note: string;
}

export interface SubScore {
  score: number;
  weight: number;
  deductions: Deduction[];
}

export interface ScoreBreakdown {
  total: number;
  grade: Grade;
  sub: {
    runnability: SubScore;
    configurability: SubScore;
    security: SubScore;
  };
  capped: boolean;
  capReason: string | null;
  confidence: 'exact' | 'sampled';
}

export interface Source {
  owner: string;
  repo: string;
  ref: string;
  commitSha: string;
  shortSha: string;
  fetchedAt: string;
  stars: number;
  language: string | null;
  archived: boolean;
  sizeKb: number;
  description: string | null;
}

export interface Advice {
  source: 'llm' | 'rules';
  model?: string;
  verdict: string;
  reasons: string[];
  actions: { title: string; detail: string; severity: Severity }[];
  degradedReason?: string;
}

export interface Report {
  id: string;
  schemaVersion: 1;
  rulesetVersion: string;
  source: Source;
  score: ScoreBreakdown;
  findings: Finding[];
  stats: {
    totalFiles: number;
    textFiles: number;
    binaryFiles: number;
    filesScanned: number;
  };
  timings: {
    meta: number;
    fetch: number;
    unpack: number;
    scan: number;
    score: number;
    total: number;
  };
  degradations: string[];
  advice: Advice;
  analyzedAt: string;
}

export interface ApiError {
  error: {
    code: string;
    message: string;
    hint?: string;
    retryable?: boolean;
    resetAt?: string | null;
  };
}
