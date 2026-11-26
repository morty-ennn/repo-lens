import { clip, isCommentLine, isDocsOrFixturePath, shannonEntropy } from '../lexicon.ts';
import type { Finding, RuleGroup, ScanContext, Severity } from '../types.ts';

const BASE_WEIGHT: Record<Severity, number> = { critical: 100, major: 50, minor: 20, info: 5 };

export interface FindingInput {
  ruleId: string;
  group: RuleGroup;
  severity: Severity;
  title: string;
  file: string;
  line?: number;
  excerpt?: string;
  detail?: string;
  remediation?: string;
  weight?: number;
  /** 显式禁止上下文降级（密钥类使用） */
  keepSeverity?: boolean;
}

const CONTEXT_RADIUS = 2;

/**
 * 生成结论，并就地应用「上下文降级」：
 * 文档 / 示例 / 测试目录 / 注释行中的命中降为 info，避免噪声淹没真正的问题。
 * 密钥组不参与该降级——注释里的真密钥依然是泄漏。
 */
export function mkFinding(ctx: ScanContext, input: FindingInput): Finding {
  const lineText = input.line ? ctx.files.files.get(input.file)?.lines?.[input.line - 1] ?? '' : '';
  const noisy = isDocsOrFixturePath(input.file) || (lineText ? isCommentLine(lineText) : false);

  let severity = input.severity;
  let downgradedFrom: Severity | undefined;
  if (noisy && input.group !== 'secrets' && !input.keepSeverity && severity !== 'info') {
    downgradedFrom = severity;
    severity = 'info';
  }

  const finding: Finding = {
    ruleId: input.ruleId,
    group: input.group,
    severity,
    title: input.title,
    file: input.file,
    weight: input.weight ?? BASE_WEIGHT[severity],
  };
  if (input.line) finding.line = input.line;
  if (input.excerpt) finding.excerpt = input.excerpt;
  if (input.detail) finding.detail = input.detail;
  if (input.remediation) finding.remediation = input.remediation;
  if (downgradedFrom) finding.downgradedFrom = downgradedFrom;

  // 上下文一律打码：任何一条结论的上下文都可能捎带出别的密钥
  const context = buildContext(ctx, input.file, input.line);
  if (context) finding.context = context;

  return finding;
}

const TOKEN = /[A-Za-z0-9_\-+/=.]{12,}/g;
const SECRET_PREFIX = /^(sk-|AKIA|AKID|LTAI|ghp_|github_pat_|xox[baprs]-)/;

function maskLine(text: string): string {
  return text.replace(TOKEN, (m) => {
    if (SECRET_PREFIX.test(m)) return '「已脱敏凭证」';
    if (m.length >= 20 && shannonEntropy(m) >= 3.5) return `「已脱敏 ${m.length} 字符」`;
    return m;
  });
}

function buildContext(
  ctx: ScanContext,
  file: string,
  line: number | undefined,
): { line: number; text: string }[] | undefined {
  if (!line) return undefined;
  const lines = ctx.files.files.get(file)?.lines;
  if (!lines) return undefined;
  const from = Math.max(1, line - CONTEXT_RADIUS);
  const to = Math.min(lines.length, line + CONTEXT_RADIUS);
  const out: { line: number; text: string }[] = [];
  for (let i = from; i <= to; i++) {
    out.push({ line: i, text: maskLine(clip(lines[i - 1] ?? '', 160)) });
  }
  return out;
}

const SEVERITY_ORDER: Record<Severity, number> = { critical: 3, major: 2, minor: 1, info: 0 };

export function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => {
    const s = SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity];
    if (s !== 0) return s;
    if (b.weight !== a.weight) return b.weight - a.weight;
    if (a.file !== b.file) return a.file < b.file ? -1 : 1;
    return (a.line ?? 0) - (b.line ?? 0);
  });
}

/** 同一 (ruleId,file) 最多保留 n 条，其余折成一条汇总，避免刷屏 */
export function capPerFile(findings: Finding[], n = 2): Finding[] {
  const buckets = new Map<string, Finding[]>();
  const passthrough: Finding[] = [];
  for (const f of findings) {
    if (!f.line) {
      passthrough.push(f);
      continue;
    }
    const key = `${f.ruleId}|${f.file}`;
    const arr = buckets.get(key);
    if (arr) arr.push(f);
    else buckets.set(key, [f]);
  }
  const out = [...passthrough];
  for (const arr of buckets.values()) {
    if (arr.length <= n) {
      out.push(...arr);
      continue;
    }
    const kept = arr.slice(0, n);
    const hidden = arr.length - n;
    const summary: Finding = {
      ...kept[0],
      title: `${kept[0].title}（另有 ${hidden} 处同类）`,
      weight: Math.max(1, kept[0].weight - 1),
    };
    delete summary.line;
    delete summary.context;
    delete summary.excerpt;
    out.push(...kept, summary);
  }
  return out;
}
