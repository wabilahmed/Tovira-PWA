import { describe, it, expect } from 'vitest';
import { decideDeploy, mustRecertify, type DeployLedgerEntry } from './deploy-decision.js';
import { parseDeployLedger, verdictLine } from './deploy-ledger.js';

// [P55-1 · owner] A CERT_SURFACE whose latest certification FAILED cannot deploy until a later certification passes.
// The gap it closes: the failed run still filled the fabrication window, so the next commit ran a normal 3-run gate
// where the special-category bar is provisional, passed, and would have deployed the same surface that just failed.
const CERT = 'c'.repeat(64);
const OTHER = 'd'.repeat(64);
type V = Extract<DeployLedgerEntry, { type: 'verdict' }>;
const v = (sha: string, at: string, over: Partial<V> = {}): V => ({ type: 'verdict', sha, runId: '1', attempt: 1, at, mode: 'normal', deployGate: 'PASS', certification: 'PROVISIONAL', counters: {}, certFingerprint: CERT, ...over });
const green = (sha: string): DeployLedgerEntry => ({ type: 'ci_green', sha, runId: '1', at: 'x' });
const failedCert = v('a1', '2026-10-29T01:00:00Z', { mode: 'full-cert', deployGate: 'FAIL', certification: 'FAIL' });
const base = { policy: 'provisional-ok' as const, emailConfigured: true, certFingerprint: CERT };

describe('[P55-1] a failed certification blocks the surface until a later one passes', () => {
  it('NEGATIVE (auto): a later commit with the same CERT_SURFACE, green on an ordinary gate, is refused', () => {
    const d = decideDeploy({ ...base, trigger: 'auto', sha: 'b2', ciConclusion: 'success', ledger: [failedCert, v('b2', '2026-10-29T03:00:00Z')] });
    expect(d.allow).toBe(false);
    expect(d.reason).toMatch(/latest certification of this CERT_SURFACE.*FAILED/i);
  });
  it('NEGATIVE (manual): the same refusal for a manual deploy of such a commit', () => {
    expect(decideDeploy({ ...base, trigger: 'manual', sha: 'b2', ledger: [failedCert, v('b2', '2026-10-29T03:00:00Z'), green('b2')] }).allow).toBe(false);
  });
  it('a later certification that passes lifts it (PASS, or PROVISIONAL while the policy allows it)', () => {
    const pass = v('c3', '2026-10-29T05:00:00Z', { mode: 'full-cert', certification: 'PASS' });
    expect(decideDeploy({ ...base, trigger: 'auto', sha: 'c3', ciConclusion: 'success', ledger: [failedCert, pass] }).allow).toBe(true);
    const prov = v('c3', '2026-10-29T05:00:00Z', { mode: 'full-cert', certification: 'PROVISIONAL' });
    expect(decideDeploy({ ...base, trigger: 'auto', sha: 'c3', ciConclusion: 'success', ledger: [failedCert, prov] }).allow).toBe(true);
    expect(decideDeploy({ ...base, policy: 'pass-required', trigger: 'auto', sha: 'c3', ciConclusion: 'success', ledger: [failedCert, prov] }).allow).toBe(false);
  });
  it('a different CERT_SURFACE is not affected by another surface\'s failure', () => {
    expect(decideDeploy({ ...base, certFingerprint: OTHER, trigger: 'auto', sha: 'e5', ciConclusion: 'success', ledger: [failedCert, v('e5', '2026-10-29T06:00:00Z', { certFingerprint: OTHER })] }).allow).toBe(true);
  });
  it('a verdict written before fingerprints were recorded is matched through certOf (computed from git)', () => {
    const { certFingerprint: _drop, ...old } = failedCert; void _drop;
    const d = decideDeploy({ ...base, trigger: 'auto', sha: 'b2', ciConclusion: 'success', ledger: [old as V, v('b2', '2026-10-29T03:00:00Z')], certOf: { a1: CERT } });
    expect(d.allow).toBe(false);
  });
  it('NEGATIVE: an unknown target fingerprint (cannot be computed) is refused, never assumed clean', () => {
    const { certFingerprint: _x, ...noFp } = base; void _x;
    const d = decideDeploy({ ...noFp, trigger: 'auto', sha: 'b2', ciConclusion: 'success', ledger: [failedCert, v('b2', '2026-10-29T03:00:00Z')] });
    expect(d.allow).toBe(false);
    expect(d.reason).toMatch(/fingerprint/i);
  });
  it('a forced deploy still goes through (recorded and emailed), as before', () => {
    expect(decideDeploy({ ...base, trigger: 'manual', sha: 'b2', ledger: [failedCert], force: true, reason: 'Hotfix: login outage', actor: 'w', now: 'x', runId: '1' }).allow).toBe(true);
  });
});

describe('[P55-1] the gate re-certifies a surface whose latest certification failed', () => {
  it('when the latest full certification for this fingerprint failed, the gate must run a full certification again', () => {
    expect(mustRecertify([failedCert], CERT)).toBe(true);
    expect(mustRecertify([failedCert, v('c3', '2026-10-29T05:00:00Z', { mode: 'full-cert', certification: 'PROVISIONAL' })], CERT)).toBe(false);
    expect(mustRecertify([failedCert], OTHER)).toBe(false);
    expect(mustRecertify([], CERT)).toBe(false);
  });
});

describe('[P55-1] verdicts record their CERT fingerprint', () => {
  it('round-trips, and a verdict without one (older) still reads', () => {
    expect(parseDeployLedger(verdictLine(failedCert))[0]).toMatchObject({ certFingerprint: CERT });
    const { certFingerprint: _y, ...older } = failedCert; void _y;
    expect(parseDeployLedger(JSON.stringify(older))).toHaveLength(1);
  });
});

describe('[P55-1] wired into the gate and CI', () => {
  it('the gate reads the deploy ledger, forces a re-certification when needed, and records the fingerprint in its verdict', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
    expect(src).toMatch(/mustRecertify\(deployLedger, windowKey\.certFingerprint\)/);
    expect(src).toMatch(/certFingerprint: windowKey\.certFingerprint/);
  });
  it('CI hands the gate the deploy ledger from the gate-ledger branch', async () => {
    const { readFileSync } = await import('node:fs');
    const ci = readFileSync(new URL('../../../../.github/workflows/ci.yml', import.meta.url), 'utf8');
    expect(ci).toMatch(/GATE_DEPLOY_LEDGER_FILE: \$\{\{ runner\.temp \}\}\/deploy-ledger\.jsonl/);
    expect(ci).toMatch(/git show FETCH_HEAD:deploy-ledger\.jsonl > "\$GATE_DEPLOY_LEDGER_FILE"/);
  });
});
