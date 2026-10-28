import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verdictLine, ciGreenLine } from './deploy-ledger.js';

// [P52] The CLI deploy.yml runs: exit 0 = deploy, anything else = neither half moves. Every refusal path end to end (a failed
// forced-deploy email is covered with a fake fetch in deploy-decision.test.ts: no test here calls a real email service).
const CLI = fileURLToPath(new URL('./deploy-decide.ts', import.meta.url));
const SHA = 'c'.repeat(40);
const dir = mkdtempSync(join(tmpdir(), 'decide-'));
const ledger = (text: string) => { const f = join(dir, `l${Math.random()}.jsonl`); writeFileSync(f, text); return f; };
const v = (cert: 'PASS' | 'PROVISIONAL' | 'FAIL') => verdictLine({ type: 'verdict', sha: SHA, runId: '1', attempt: 1, at: '2026-10-28T10:00:00Z', mode: 'normal', deployGate: cert === 'FAIL' ? 'FAIL' : 'PASS', certification: cert, counters: {} });
function run(env: Record<string, string>): { code: number; out: string } {
  const r = spawnSync(process.execPath, ['--import', 'tsx', CLI], { env: { PATH: process.env.PATH!, SHA, DEPLOY_POLICY: 'provisional-ok', ...env }, encoding: 'utf8' });
  return { code: r.status ?? -1, out: `${r.stdout}${r.stderr}` };
}

describe('[P52] deploy-decide CLI', { timeout: 60_000 }, () => {
  it('auto: green CI + PROVISIONAL verdict → exit 0', () => {
    const r = run({ TRIGGER: 'auto', CI_CONCLUSION: 'success', LEDGER_FILE: ledger(v('PROVISIONAL')) });
    expect(r.out).toMatch(/DEPLOY ALLOWED/);
    expect(r.code).toBe(0);
  });
  it('NEGATIVE: auto with a certification FAIL → exit 1', () => {
    const r = run({ TRIGGER: 'auto', CI_CONCLUSION: 'success', LEDGER_FILE: ledger(v('FAIL')) });
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/DEPLOY REFUSED: certification FAIL/);
  });
  it('NEGATIVE: auto with no verdict (missing ledger file) → exit 1', () => {
    expect(run({ TRIGGER: 'auto', CI_CONCLUSION: 'success', LEDGER_FILE: join(dir, 'absent.jsonl') }).code).toBe(1);
  });
  it('NEGATIVE: a corrupt ledger → exit 1 (fail closed)', () => {
    const r = run({ TRIGGER: 'auto', CI_CONCLUSION: 'success', LEDGER_FILE: ledger('{"type":"verdict"}\n') });
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/failing closed/);
  });
  it('NEGATIVE: manual without a CI-green record → exit 1; with one → exit 0', () => {
    expect(run({ TRIGGER: 'manual', LEDGER_FILE: ledger(v('PASS')) }).code).toBe(1);
    expect(run({ TRIGGER: 'manual', LEDGER_FILE: ledger(v('PASS') + ciGreenLine({ type: 'ci_green', sha: SHA, runId: '1', at: 'x' })) }).code).toBe(0);
  });
  it('NEGATIVE: force without a reason, or without the email secrets → exit 1, and nothing recorded', () => {
    const out = join(dir, 'forced-a.jsonl');
    expect(run({ TRIGGER: 'manual', FORCE: 'true', REASON: '', ACTOR: 'w', GITHUB_RUN_ID: '9', LEDGER_FILE: ledger(''), FORCED_OUT: out, RESEND_API_KEY: 'k', ADMIN_EMAILS: 'a@x.io' }).code).toBe(1);
    expect(run({ TRIGGER: 'manual', FORCE: 'true', REASON: 'Hotfix: login outage', ACTOR: 'w', GITHUB_RUN_ID: '9', LEDGER_FILE: ledger(''), FORCED_OUT: out }).code).toBe(1);
    expect(existsSync(out)).toBe(false);
  });
});
