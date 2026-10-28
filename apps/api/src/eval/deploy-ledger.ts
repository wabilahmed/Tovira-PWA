/**
 * [P52 · owner] The deploy ledger: deploy-ledger.jsonl on the append-only gate-ledger branch, beside fab-ledger.jsonl
 * (whose parser refuses unknown records by design, so these live in their own file). Kept permanently, unlike CI
 * artifacts (90 days), so a rollback to an older green, certified commit can still be checked.
 *   verdict        what the gate decided for a commit (written by the gate runner, every scored run)
 *   ci_green       every CI job passed for a commit (written by CI's last job)
 *   forced_deploy  a manual deploy forced past the rules: who, when, why
 */
export type Certification = 'PASS' | 'PROVISIONAL' | 'FAIL';
export interface VerdictRecord {
  type: 'verdict';
  sha: string;
  runId: string;
  attempt: number;
  at: string;
  mode: 'normal' | 'refill' | 'full-cert';
  deployGate: 'PASS' | 'FAIL';
  certification: Certification;
  counters: Record<string, number>;
}
export interface CiGreenRecord { type: 'ci_green'; sha: string; runId: string; at: string }
export interface ForcedDeployRecord { type: 'forced_deploy'; sha: string; actor: string; at: string; reason: string; runId: string }
export type DeployLedgerEntry = VerdictRecord | CiGreenRecord | ForcedDeployRecord;

export class DeployLedgerUnreadable extends Error {}
const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

/** Parse the JSONL file. An empty or absent file is no records; anything malformed throws (fail closed). */
export function parseDeployLedger(text: string): DeployLedgerEntry[] {
  return text.split('\n').map((l) => l.trim()).filter(Boolean).map((l, i) => {
    let o: Record<string, unknown>;
    try { o = JSON.parse(l) as Record<string, unknown>; } catch { throw new DeployLedgerUnreadable(`deploy ledger line ${i + 1} is not valid JSON — failing closed`); }
    const base = isStr(o.sha) && isStr(o.at) && isStr(o.runId);
    const ok =
      (o.type === 'verdict' && base && typeof o.attempt === 'number' && ['normal', 'refill', 'full-cert'].includes(o.mode as string)
        && ['PASS', 'FAIL'].includes(o.deployGate as string) && ['PASS', 'PROVISIONAL', 'FAIL'].includes(o.certification as string) && typeof o.counters === 'object' && o.counters !== null)
      || (o.type === 'ci_green' && base)
      || (o.type === 'forced_deploy' && base && isStr(o.actor) && isStr(o.reason));
    if (!ok) throw new DeployLedgerUnreadable(`deploy ledger line ${i + 1} is not a valid record — failing closed`);
    return o as unknown as DeployLedgerEntry;
  });
}

export const verdictLine = (r: VerdictRecord): string => JSON.stringify(r) + '\n';
export const ciGreenLine = (r: CiGreenRecord): string => JSON.stringify(r) + '\n';
export const forcedLine = (r: ForcedDeployRecord): string => JSON.stringify(r) + '\n';
