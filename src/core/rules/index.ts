import type { Finding, ScanContext } from '../types.ts';
import { capPerFile } from './util.ts';
import { readmeRules } from './readme.ts';
import { depsRules } from './deps.ts';
import { runRules as startupRules } from './run.ts';
import { winRules } from './win.ts';
import { pathRules } from './paths.ts';
import { secretRules } from './secrets.ts';

export function runRules(ctx: ScanContext): Finding[] {
  const raw = [
    ...readmeRules(ctx),
    ...depsRules(ctx),
    ...startupRules(ctx),
    ...winRules(ctx),
    ...pathRules(ctx),
    ...secretRules(ctx),
  ];
  return capPerFile(raw, 2);
}

export { sortFindings } from './util.ts';
