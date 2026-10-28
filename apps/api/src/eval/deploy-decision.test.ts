import { describe, it, expect, vi } from 'vitest';
import { decideDeploy, sendForceEmail, type DeployLedgerEntry } from './deploy-decision.js';
import { parseDeployLedger, verdictLine } from './deploy-ledger.js';

// [P52 · owner] What may deploy. A certification FAIL (not PROVISIONAL) blocks both halves, a missing gate is a refusal,
// a manual deploy needs a green, certified commit, and a forced deploy needs a reason, is recorded (who, when, why) and
// emails ADMIN_EMAILS. Verdicts live permanently in the gate ledger, so a rollback to an older green commit is allowed.
const SHA = 'a'.repeat(40);
const OLD = 'b'.repeat(40);
const verdict = (sha: string, over: Partial<Extract<DeployLedgerEntry, { type: 'verdict' }>> = {}): Extract<DeployLedgerEntry, { type: 'verdict' }> =>
  ({ type: 'verdict', sha, runId: '1', attempt: 1, at: '2026-10-28T10:00:00Z', mode: 'normal', deployGate: 'PASS', certification: 'PROVISIONAL', counters: {}, ...over });
const green = (sha: string): DeployLedgerEntry => ({ type: 'ci_green', sha, runId: '1', at: '2026-10-28T10:05:00Z' });
const base = { policy: 'provisional-ok' as const, emailConfigured: true };

describe('[P52] automatic deploys (after CI)', () => {
  it('a green CI with a recorded PASS or PROVISIONAL verdict deploys', () => {
    expect(decideDeploy({ ...base, trigger: 'auto', sha: SHA, ciConclusion: 'success', ledger: [verdict(SHA)] }).allow).toBe(true);
    expect(decideDeploy({ ...base, trigger: 'auto', sha: SHA, ciConclusion: 'success', ledger: [verdict(SHA, { certification: 'PASS' })] }).allow).toBe(true);
  });
  it('NEGATIVE: CI not green → refused', () => {
    const d = decideDeploy({ ...base, trigger: 'auto', sha: SHA, ciConclusion: 'failure', ledger: [verdict(SHA)] });
    expect(d).toMatchObject({ allow: false });
    expect(d.reason).toMatch(/CI/);
  });
  it('NEGATIVE: no gate verdict recorded for the commit (gate skipped, no key, stopped early) → refused', () => {
    const d = decideDeploy({ ...base, trigger: 'auto', sha: SHA, ciConclusion: 'success', ledger: [verdict(OLD)] });
    expect(d.allow).toBe(false);
    expect(d.reason).toMatch(/no gate verdict/i);
  });
  it('NEGATIVE: a certification FAIL → refused (both halves: api and web both depend on this decision)', () => {
    const d = decideDeploy({ ...base, trigger: 'auto', sha: SHA, ciConclusion: 'success', ledger: [verdict(SHA, { mode: 'full-cert', certification: 'FAIL', deployGate: 'FAIL' })] });
    expect(d.allow).toBe(false);
    expect(d.reason).toMatch(/certification FAIL/i);
  });
  it('NEGATIVE: a deploy-gate FAIL → refused even if CI was somehow green', () => {
    expect(decideDeploy({ ...base, trigger: 'auto', sha: SHA, ciConclusion: 'success', ledger: [verdict(SHA, { deployGate: 'FAIL' })] }).allow).toBe(false);
  });
  it('the latest attempt decides (a re-run that passed after a failure deploys; a later failure refuses)', () => {
    const fail = verdict(SHA, { attempt: 1, at: '2026-10-28T09:00:00Z', certification: 'FAIL', deployGate: 'FAIL' });
    const pass = verdict(SHA, { attempt: 2, at: '2026-10-28T11:00:00Z' });
    expect(decideDeploy({ ...base, trigger: 'auto', sha: SHA, ciConclusion: 'success', ledger: [fail, pass] }).allow).toBe(true);
    expect(decideDeploy({ ...base, trigger: 'auto', sha: SHA, ciConclusion: 'success', ledger: [pass, { ...fail, attempt: 3, at: '2026-10-28T12:00:00Z' }] }).allow).toBe(false);
  });
  it('PROVISIONAL is allowed under the current policy, and refused when the policy requires PASS', () => {
    expect(decideDeploy({ ...base, policy: 'pass-required', trigger: 'auto', sha: SHA, ciConclusion: 'success', ledger: [verdict(SHA)] }).allow).toBe(false);
  });
});

describe('[P52] manual deploys (Run workflow)', () => {
  it('a green, certified commit deploys, including an older one (a rollback)', () => {
    const ledger = [verdict(OLD), green(OLD), verdict(SHA), green(SHA)];
    expect(decideDeploy({ ...base, trigger: 'manual', sha: OLD, ledger }).allow).toBe(true);
  });
  it('NEGATIVE: a commit with no CI-green record → refused', () => {
    const d = decideDeploy({ ...base, trigger: 'manual', sha: SHA, ledger: [verdict(SHA)] });
    expect(d.allow).toBe(false);
    expect(d.reason).toMatch(/not green/i);
  });
  it('NEGATIVE: a green commit whose certification FAILED → refused', () => {
    expect(decideDeploy({ ...base, trigger: 'manual', sha: SHA, ledger: [verdict(SHA, { certification: 'FAIL', deployGate: 'FAIL' }), green(SHA)] }).allow).toBe(false);
  });
  it('a commit from before this ledger existed deploys when GitHub shows its CI green, and never when the ledger has a FAIL for it', () => {
    expect(decideDeploy({ ...base, trigger: 'manual', sha: OLD, ledger: [], legacyCiGreen: true }).allow).toBe(true);
    expect(decideDeploy({ ...base, trigger: 'manual', sha: OLD, ledger: [], legacyCiGreen: false }).allow).toBe(false);
    expect(decideDeploy({ ...base, trigger: 'manual', sha: OLD, ledger: [verdict(OLD, { certification: 'FAIL', deployGate: 'FAIL' })], legacyCiGreen: true }).allow).toBe(false);
  });
});

describe('[P52] forced deploys', () => {
  it('a forced deploy with a reason deploys anything, and is recorded with who, when and why', () => {
    const d = decideDeploy({ ...base, trigger: 'manual', sha: SHA, ledger: [verdict(SHA, { certification: 'FAIL', deployGate: 'FAIL' })], force: true, reason: 'Hotfix: login outage, gate API down', actor: 'wabilahmed', now: '2026-10-28T13:00:00Z', runId: '99' });
    expect(d.allow).toBe(true);
    expect(d.forced).toEqual({ type: 'forced_deploy', sha: SHA, actor: 'wabilahmed', at: '2026-10-28T13:00:00Z', reason: 'Hotfix: login outage, gate API down', runId: '99' });
  });
  it('NEGATIVE: force without a real reason → refused', () => {
    for (const reason of [undefined, '', '   ', 'fix']) {
      const d = decideDeploy({ ...base, trigger: 'manual', sha: SHA, ledger: [], force: true, reason, actor: 'wabilahmed', now: 'x', runId: '1' });
      expect(d.allow, String(reason)).toBe(false);
      expect(d.reason).toMatch(/reason/i);
    }
  });
  it('NEGATIVE: force without the email secrets → refused (it must reach ADMIN_EMAILS)', () => {
    const d = decideDeploy({ ...base, emailConfigured: false, trigger: 'manual', sha: SHA, ledger: [], force: true, reason: 'Hotfix: login outage', actor: 'wabilahmed', now: 'x', runId: '1' });
    expect(d.allow).toBe(false);
    expect(d.reason).toMatch(/RESEND_API_KEY|ADMIN_EMAILS/);
  });
  it('the email goes to every ADMIN_EMAILS address, from hello@tovira.io, with the reason, who, when and the commit', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    await sendForceEmail(fetchFn, 'key', 'a@x.io, b@x.io', { type: 'forced_deploy', sha: SHA, actor: 'wabilahmed', at: '2026-10-28T13:00:00Z', reason: 'Hotfix: login outage', runId: '99' }, 'owner/repo');
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe('https://api.resend.com/emails');
    const body = JSON.parse(init.body);
    expect(body.to).toEqual(['a@x.io', 'b@x.io']);
    expect(body.from).toMatch(/hello@tovira\.io/);
    expect(body.text).toContain('Hotfix: login outage');
    expect(body.text).toContain('wabilahmed');
    expect(body.text).toContain(SHA.slice(0, 7));
    expect(body.text).not.toMatch(/—/);
    expect(init.headers.authorization).toBe('Bearer key');
  });
  it('NEGATIVE: a failed send throws (the forced deploy is then refused, never silent)', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('no', { status: 403 }));
    await expect(sendForceEmail(fetchFn, 'key', 'a@x.io', { type: 'forced_deploy', sha: SHA, actor: 'a', at: 'x', reason: 'Hotfix: login outage', runId: '1' }, 'o/r')).rejects.toThrow();
  });
});

describe('[P52] the deploy ledger is permanent and read fail-closed', () => {
  it('round-trips verdict lines; an empty or absent file is simply no records', () => {
    const line = verdictLine({ type: 'verdict', sha: SHA, runId: '7', attempt: 1, at: '2026-10-28T10:00:00Z', mode: 'full-cert', deployGate: 'PASS', certification: 'PROVISIONAL', counters: { merged: 0 } });
    expect(parseDeployLedger(line)).toHaveLength(1);
    expect(parseDeployLedger('')).toEqual([]);
  });
  it('NEGATIVE: a malformed line refuses to be read (never a silent pass)', () => {
    expect(() => parseDeployLedger('{"type":"verdict","sha":"x"}')).toThrow();
    expect(() => parseDeployLedger('not json')).toThrow();
  });
});
