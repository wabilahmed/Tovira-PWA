import type { DeployLedgerEntry, ForcedDeployRecord, VerdictRecord } from './deploy-ledger.js';
export type { DeployLedgerEntry } from './deploy-ledger.js';

/**
 * [P52 · owner] Whether a commit may deploy. Pure: deploy.yml's decide job feeds it the ledger and the trigger, and both
 * the api and the web job depend on its answer, so neither half ever moves on a refusal.
 *
 *  auto (after CI)   CI green, and the commit's latest gate verdict is a deploy-gate PASS with no certification FAIL.
 *  manual            the commit has a CI-green record and no certification FAIL. A commit from before the ledger
 *                    existed is checked against GitHub's CI result instead (legacyCiGreen), unless the ledger holds a
 *                    FAIL for it. A rollback to an older green commit is therefore allowed.
 *  forced            any commit, with a reason (10+ characters); recorded (who, when, why) and emailed to ADMIN_EMAILS,
 *                    so it needs both email secrets. A failed email refuses the deploy.
 *  policy            'provisional-ok' (owner, for now) lets PROVISIONAL through; 'pass-required' does not.
 */
export interface DecideInput {
  trigger: 'auto' | 'manual';
  sha: string;
  ledger: DeployLedgerEntry[];
  policy: 'provisional-ok' | 'pass-required';
  ciConclusion?: string;
  legacyCiGreen?: boolean;
  force?: boolean;
  reason?: string;
  actor?: string;
  now?: string;
  runId?: string;
  emailConfigured: boolean;
  /** [P55-1] the target commit's CERT_SURFACE fingerprint (computed from git by the decide job) */
  certFingerprint?: string;
  /** [P55-1] fingerprints for verdicts written before they were recorded, by sha (computed from git) */
  certOf?: Record<string, string>;
}
export interface Decision { allow: boolean; reason: string; forced?: ForcedDeployRecord }

const MIN_REASON = 10;

function latestVerdict(ledger: DeployLedgerEntry[], sha: string): VerdictRecord | undefined {
  return ledger
    .filter((e): e is VerdictRecord => e.type === 'verdict' && e.sha === sha)
    .sort((a, b) => (a.at === b.at ? a.attempt - b.attempt : a.at < b.at ? -1 : 1))
    .at(-1);
}

function verdictAllows(v: VerdictRecord, policy: DecideInput['policy']): Decision {
  if (v.certification === 'FAIL') return { allow: false, reason: `certification FAIL for ${v.sha.slice(0, 7)} (run ${v.runId}/${v.attempt})` };
  if (v.deployGate !== 'PASS') return { allow: false, reason: `deploy gate FAIL for ${v.sha.slice(0, 7)} (run ${v.runId}/${v.attempt})` };
  if (v.certification === 'PROVISIONAL' && policy === 'pass-required') return { allow: false, reason: `certification PROVISIONAL for ${v.sha.slice(0, 7)}, and the policy requires PASS` };
  return { allow: true, reason: `gate ${v.deployGate}, certification ${v.certification} (${v.mode}, run ${v.runId}/${v.attempt})` };
}

const fpOf = (v: VerdictRecord, certOf: Record<string, string> = {}): string | undefined => v.certFingerprint ?? certOf[v.sha];
const byTime = (a: VerdictRecord, b: VerdictRecord) => (a.at === b.at ? a.attempt - b.attempt : a.at < b.at ? -1 : 1);

/** [P55-1] The latest full certification of this CERT_SURFACE, or undefined when none is on record. */
function latestCertification(ledger: DeployLedgerEntry[], fp: string, certOf?: Record<string, string>): VerdictRecord | undefined {
  return ledger.filter((e): e is VerdictRecord => e.type === 'verdict' && e.mode === 'full-cert' && fpOf(e, certOf) === fp).sort(byTime).at(-1);
}

/** [P55-1] The gate side: a surface whose latest certification failed is certified again (not an ordinary 3-run gate),
 *  otherwise a later certification could never happen without editing a surface. */
export function mustRecertify(ledger: DeployLedgerEntry[], certFingerprint: string): boolean {
  return latestCertification(ledger, certFingerprint)?.certification === 'FAIL';
}

/** [P55-1] Refuse while the latest certification of the target's CERT_SURFACE failed (or, under pass-required, did not pass). */
function certificationBlocks(i: DecideInput): Decision | null {
  if (!i.certFingerprint) {
    const anyFailed = i.ledger.some((e) => e.type === 'verdict' && e.mode === 'full-cert' && e.certification === 'FAIL');
    return anyFailed ? { allow: false, reason: `the CERT_SURFACE fingerprint of ${i.sha.slice(0, 7)} could not be computed, and a failed certification is on record: refusing (closed)` } : null;
  }
  const c = latestCertification(i.ledger, i.certFingerprint, i.certOf);
  if (!c) return null;
  if (c.certification === 'FAIL') return { allow: false, reason: `the latest certification of this CERT_SURFACE (${c.sha.slice(0, 7)}, run ${c.runId}/${c.attempt}) FAILED; a later certification must pass before it deploys` };
  if (c.certification === 'PROVISIONAL' && i.policy === 'pass-required') return { allow: false, reason: `the latest certification of this CERT_SURFACE (${c.sha.slice(0, 7)}) is PROVISIONAL, and the policy requires PASS` };
  return null;
}

export function decideDeploy(i: DecideInput): Decision {
  if (i.force) {
    if (i.trigger !== 'manual') return { allow: false, reason: 'force is only for a manual deploy' };
    const reason = (i.reason ?? '').trim();
    if (reason.length < MIN_REASON) return { allow: false, reason: `a forced deploy needs a reason (at least ${MIN_REASON} characters)` };
    if (!i.emailConfigured) return { allow: false, reason: 'a forced deploy emails ADMIN_EMAILS: set the RESEND_API_KEY and ADMIN_EMAILS secrets first' };
    if (!i.actor || !i.now || !i.runId) return { allow: false, reason: 'a forced deploy must record who and when' };
    return { allow: true, reason: `FORCED by ${i.actor}: ${reason}`, forced: { type: 'forced_deploy', sha: i.sha, actor: i.actor, at: i.now, reason, runId: i.runId } };
  }
  // the commit's own verdict speaks first; then [P55-1] its CERT_SURFACE's latest certification
  const own = decideOwn(i);
  if (!own.allow) return own;
  return certificationBlocks(i) ?? own;
}

function decideOwn(i: DecideInput): Decision {
  const v = latestVerdict(i.ledger, i.sha);
  if (i.trigger === 'auto') {
    if (i.ciConclusion !== 'success') return { allow: false, reason: `CI did not succeed (${i.ciConclusion ?? 'unknown'})` };
    if (!v) return { allow: false, reason: `no gate verdict recorded for ${i.sha.slice(0, 7)} (the gate was skipped or stopped before scoring)` };
    return verdictAllows(v, i.policy);
  }
  const known = i.ledger.some((e) => e.sha === i.sha);
  if (!known) {
    return i.legacyCiGreen
      ? { allow: true, reason: `${i.sha.slice(0, 7)} predates the deploy ledger; GitHub shows its CI green` }
      : { allow: false, reason: `${i.sha.slice(0, 7)} is not green: no CI-green record, and GitHub shows no successful CI run` };
  }
  if (v && v.certification === 'FAIL') return verdictAllows(v, i.policy);
  if (!i.ledger.some((e) => e.type === 'ci_green' && e.sha === i.sha)) return { allow: false, reason: `${i.sha.slice(0, 7)} is not green: no CI-green record` };
  if (!v) return { allow: false, reason: `no gate verdict recorded for ${i.sha.slice(0, 7)}` };
  return verdictAllows(v, i.policy);
}

type FetchFn = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<Response>;

/** Email ADMIN_EMAILS about a forced deploy, through Resend, from hello@tovira.io. Throws when the send fails. */
export async function sendForceEmail(fetchFn: FetchFn, apiKey: string, adminEmails: string, f: ForcedDeployRecord, repo: string): Promise<void> {
  const to = adminEmails.split(',').map((e) => e.trim()).filter((e) => e.includes('@'));
  if (to.length === 0) throw new Error('ADMIN_EMAILS has no address');
  const text = [
    `A deploy of Tovira was forced past the release checks.`,
    ``,
    `Commit: ${f.sha.slice(0, 7)} (${f.sha})`,
    `By: ${f.actor}`,
    `When: ${f.at}`,
    `Reason: ${f.reason}`,
    `Run: https://github.com/${repo}/actions/runs/${f.runId}`,
  ].join('\n');
  const res = await fetchFn('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: 'Tovira <hello@tovira.io>', to, subject: `Forced deploy: ${f.sha.slice(0, 7)} by ${f.actor}`, text }),
  });
  if (!res.ok) throw new Error(`the forced-deploy email was not sent (Resend ${res.status})`);
}
