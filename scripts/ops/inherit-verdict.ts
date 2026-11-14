/**
 * [P70 · owner] A frontend-only push skips the extraction gate (owner: "since this will be only a frontend deploy do not
 * run the 12 aed gate"). The gate certifies the API's extraction; the API image is built only from package.json,
 * package-lock.json, apps/api/** and apps/web/package.json (docker/api.prod.Dockerfile). If none of those changed since
 * the nearest ancestor that has a gate verdict, this commit's extraction is that ancestor's, byte for byte, so its
 * verdict is carried forward instead of spending a gate run. Anything else (including a missing or unreadable ledger,
 * no verdicted ancestor, or a git error) runs the gate as before: fail closed.
 *
 * The carried verdict is written as an ordinary ('normal') verdict with inheritedFrom set, never as a certification, so
 * the CERT_SURFACE's certification history is unchanged. A FAIL is carried forward as a FAIL.
 *
 * CI: SHA, LEDGER_FILE (deploy-ledger.jsonl), OUT (verdict file), GITHUB_RUN_ID, GITHUB_RUN_ATTEMPT, GITHUB_OUTPUT.
 * Prints the decision; writes inherited=1|0 to GITHUB_OUTPUT. Needs the full git history (checkout fetch-depth: 0).
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseDeployLedger, verdictLine, type DeployLedgerEntry, type VerdictRecord } from '../../apps/api/src/eval/deploy-ledger.js';

/** The files the API image is built from (docker/api.prod.Dockerfile). A change to any of them needs the gate. */
export function touchesApiImage(path: string): boolean {
  return path === 'package.json' || path === 'package-lock.json' || path === 'apps/web/package.json' || path.startsWith('apps/api/');
}

export type InheritDecision = { inherit: true; record: VerdictRecord & { inheritedFrom: string }; reason: string } | { inherit: false; reason: string };

export function decideInherit(i: {
  sha: string;
  ledger: DeployLedgerEntry[];
  /** this commit's ancestors, nearest first (this commit excluded) */
  ancestors: string[];
  /** the files changed between an ancestor and this commit */
  changedSince: (base: string) => string[];
  runId: string;
  attempt: number;
  now: string;
}): InheritDecision {
  const verdicted = new Set(i.ledger.filter((e) => e.type === 'verdict').map((e) => e.sha));
  const base = i.ancestors.find((s) => verdicted.has(s));
  if (!base) return { inherit: false, reason: 'no ancestor has a gate verdict' };
  const changed = i.changedSince(base);
  const api = changed.filter(touchesApiImage);
  if (api.length > 0) return { inherit: false, reason: `the API image changed since ${base.slice(0, 7)} (${api.slice(0, 5).join(', ')}${api.length > 5 ? ', …' : ''})` };
  const v = i.ledger.filter((e): e is VerdictRecord => e.type === 'verdict' && e.sha === base).at(-1)!;
  const record = {
    type: 'verdict' as const, sha: i.sha, runId: i.runId, attempt: i.attempt, at: i.now,
    mode: 'normal' as const, deployGate: v.deployGate, certification: v.certification, counters: v.counters,
    ...(v.certFingerprint ? { certFingerprint: v.certFingerprint } : {}),
    inheritedFrom: base,
  };
  return { inherit: true, record, reason: `nothing in the API image changed since ${base.slice(0, 7)} (${changed.length} file${changed.length === 1 ? '' : 's'} changed, none in it): its verdict (${v.deployGate}, ${v.certification}) is carried forward` };
}

function main(): void {
  const env = process.env;
  const out = (inherited: boolean): void => { if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `inherited=${inherited ? 1 : 0}\n`); };
  try {
    const sha = env.SHA ?? '';
    const file = env.LEDGER_FILE ?? '';
    if (!sha || !file || !existsSync(file)) throw new Error('no commit or no deploy ledger');
    const ledger = parseDeployLedger(readFileSync(file, 'utf8'));
    const git = (...a: string[]): string => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();
    const ancestors = git('rev-list', '--max-count=2000', `${sha}^`).split('\n').filter(Boolean);
    const d = decideInherit({
      sha, ledger, ancestors,
      changedSince: (base) => git('diff', '--name-only', base, sha).split('\n').filter(Boolean),
      runId: env.GITHUB_RUN_ID ?? 'local', attempt: Number(env.GITHUB_RUN_ATTEMPT ?? '1'), now: new Date().toISOString(),
    });
    console.log(`[inherit-verdict] ${d.inherit ? 'GATE SKIPPED' : 'GATE RUNS'}: ${d.reason}`);
    if (d.inherit && env.OUT) writeFileSync(env.OUT, verdictLine(d.record));
    out(d.inherit);
  } catch (err) {
    console.log(`[inherit-verdict] GATE RUNS: ${err instanceof Error ? err.message : String(err)} (failing closed)`);
    out(false);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
