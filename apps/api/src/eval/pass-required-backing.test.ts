import { describe, it, expect } from 'vitest';
import { decideDeploy, type DeployLedgerEntry } from './deploy-decision.js';

// [P56-1 · owner] Under "PASS required", a commit whose own gate is PROVISIONAL (an ordinary 3-run gate, too few
// special-category exposures to certify) deploys only when the latest full certification of the same CERT_SURFACE (the
// certified prompt, gate, scorer and eval set) is a PASS. A FAIL is always refused. Without this, every ordinary push
// would be refused, because an ordinary gate can never certify on its own.
const CERT = 'c'.repeat(64);
const OTHER = 'd'.repeat(64);
type V = Extract<DeployLedgerEntry, { type: 'verdict' }>;
const v = (sha: string, at: string, over: Partial<V> = {}): V => ({ type: 'verdict', sha, runId: '1', attempt: 1, at, mode: 'normal', deployGate: 'PASS', certification: 'PROVISIONAL', counters: {}, certFingerprint: CERT, ...over });
const green = (sha: string): DeployLedgerEntry => ({ type: 'ci_green', sha, runId: '1', at: 'x' });
const certPass = v('p1', '2026-10-29T05:00:00Z', { mode: 'full-cert', certification: 'PASS' });
const certFail = v('f1', '2026-10-29T07:00:00Z', { mode: 'full-cert', certification: 'FAIL', deployGate: 'FAIL' });
const ordinary = v('o2', '2026-10-29T09:00:00Z');
const base = { policy: 'pass-required' as const, emailConfigured: true, certFingerprint: CERT };
const auto = (ledger: DeployLedgerEntry[], over: Partial<Parameters<typeof decideDeploy>[0]> = {}) =>
  decideDeploy({ ...base, trigger: 'auto', sha: 'o2', ciConclusion: 'success', ledger, ...over });

describe('[P56-1] pass-required: a PROVISIONAL commit backed by a PASS certification', () => {
  it('auto: PROVISIONAL, and the latest certification of the same CERT_SURFACE is a PASS → allowed', () => {
    const d = auto([certPass, ordinary]);
    expect(d.allow, d.reason).toBe(true);
    expect(d.reason).toMatch(/PROVISIONAL.*backed by the PASS certification of p1/);
  });
  it('manual: the same, with a CI-green record → allowed', () => {
    expect(decideDeploy({ ...base, trigger: 'manual', sha: 'o2', ledger: [certPass, ordinary, green('o2')] }).allow).toBe(true);
  });
  it('a commit whose own certification is a PASS → allowed', () => {
    expect(auto([certPass], { sha: 'p1' }).allow).toBe(true);
  });
  it('NEGATIVE: no certification of this CERT_SURFACE on record → refused', () => {
    const d = auto([ordinary]);
    expect(d.allow).toBe(false);
    expect(d.reason).toMatch(/requires PASS/);
  });
  it('NEGATIVE: the only PASS certification is of a different CERT_SURFACE → refused', () => {
    expect(auto([{ ...certPass, certFingerprint: OTHER }, ordinary]).allow).toBe(false);
  });
  it('NEGATIVE: a PASS, then a later FAIL of the same surface → refused (the latest certification decides)', () => {
    const d = auto([certPass, certFail, ordinary]);
    expect(d.allow).toBe(false);
    expect(d.reason).toMatch(/FAIL/);
  });
  it('a FAIL, then a later PASS of the same surface → allowed', () => {
    expect(auto([{ ...certFail, at: '2026-10-29T01:00:00Z' }, certPass, ordinary]).allow).toBe(true);
  });
  it('NEGATIVE: the latest certification of the surface is itself PROVISIONAL → refused', () => {
    expect(auto([certPass, v('q1', '2026-10-29T07:00:00Z', { mode: 'full-cert', certification: 'PROVISIONAL' }), ordinary]).allow).toBe(false);
  });
  it('NEGATIVE: the commit\'s own verdict is a FAIL → refused, even with a PASS certification of its surface', () => {
    expect(auto([certPass, v('o2', '2026-10-29T09:00:00Z', { certification: 'FAIL', deployGate: 'FAIL' })]).allow).toBe(false);
    expect(auto([certPass, v('o2', '2026-10-29T09:00:00Z', { deployGate: 'FAIL' })]).allow).toBe(false);
  });
  it('NEGATIVE: the target\'s fingerprint cannot be computed → refused, never assumed backed', () => {
    const { certFingerprint: _x, ...noFp } = base; void _x;
    expect(decideDeploy({ ...noFp, trigger: 'auto', sha: 'o2', ciConclusion: 'success', ledger: [certPass, ordinary] }).allow).toBe(false);
  });
  it('a PASS certification written before fingerprints were recorded backs through certOf (computed from git)', () => {
    const { certFingerprint: _y, ...old } = certPass; void _y;
    expect(auto([old as V, ordinary], { certOf: { p1: CERT } }).allow).toBe(true);
  });
  it('NEGATIVE: CI not green, or no verdict for the commit → refused, as before', () => {
    expect(auto([certPass, ordinary], { ciConclusion: 'failure' }).allow).toBe(false);
    expect(auto([certPass]).allow).toBe(false);
  });
  it('provisional-ok is unchanged: a PROVISIONAL commit with no certification on record deploys', () => {
    expect(auto([ordinary], { policy: 'provisional-ok' }).allow).toBe(true);
  });
});

describe('[P56-3 · owner] the switch: deploy.yml requires PASS (after the P55 certification passed)', () => {
  it('the decide job runs with DEPLOY_POLICY pass-required', async () => {
    const { readFileSync } = await import('node:fs');
    const yml = readFileSync(new URL('../../../../.github/workflows/deploy.yml', import.meta.url), 'utf8');
    expect(yml).toMatch(/^\s+DEPLOY_POLICY: pass-required\b/m);
    expect(yml).not.toMatch(/DEPLOY_POLICY: provisional-ok/);
  });
});
