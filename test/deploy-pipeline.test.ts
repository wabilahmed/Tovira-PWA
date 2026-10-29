import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';

// [P52 · owner] The release pipeline: a certification FAIL blocks both halves, the gate fails closed without its key,
// verdicts are kept permanently on the gate ledger, manual deploys need a green certified commit (or a recorded, emailed
// force with a reason), and the web half never ships ahead of a failed API deploy.
const ROOT = join(__dirname, '..');
type Step = { name?: string; run?: string; if?: string; env?: Record<string, string>; uses?: string; with?: Record<string, unknown> };
type Job = { needs?: string | string[]; if?: string; steps: Step[]; permissions?: Record<string, string> };
const ci = parse(readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8')) as { jobs: Record<string, Job> };
const deploy = parse(readFileSync(join(ROOT, '.github/workflows/deploy.yml'), 'utf8')) as { on: { workflow_dispatch: { inputs: Record<string, { type?: string; required?: boolean }> } }; permissions: Record<string, string>; jobs: Record<string, Job> };
const needs = (j: Job) => (Array.isArray(j.needs) ? j.needs : j.needs ? [j.needs] : []);
const runOf = (j: Job) => j.steps.map((s) => s.run ?? '').join('\n');
const append = readFileSync(join(ROOT, 'scripts/ops/append-fab-ledger.sh'), 'utf8');

describe('[P52] CI: the gate fails closed and records its verdict', () => {
  it('NEGATIVE: a missing ANTHROPIC_API_KEY fails the gate job, whatever changed (never "skipped", never exit 0)', () => {
    const gate = ci.jobs.gate!;
    const keyChecks = gate.steps.filter((s) => (s.run ?? '').includes('if [ -z "$ANTHROPIC_API_KEY" ]'));
    expect(keyChecks.length).toBeGreaterThan(0);
    for (const s of keyChecks) {
      const block = s.run!.slice(s.run!.indexOf('if [ -z "$ANTHROPIC_API_KEY" ]'), s.run!.indexOf('fi', s.run!.indexOf('if [ -z "$ANTHROPIC_API_KEY" ]')));
      expect(block, s.name).toMatch(/exit 1/);
      expect(block, s.name).not.toMatch(/exit 0/);
    }
  });
  it('the gate writes its verdict and appends it to deploy-ledger.jsonl on the gate ledger, whatever the result', () => {
    const gate = ci.jobs.gate!;
    const run = gate.steps.find((s) => (s.run ?? '').includes('npm run gate'))!;
    expect(run.env?.GATE_VERDICT_OUT).toBeTruthy();
    const rec = gate.steps.find((s) => (s.run ?? '').includes('TARGET_FILE=deploy-ledger.jsonl'))!;
    expect(rec, 'a verdict append step').toBeDefined();
    expect(rec.if).toBe('always()');
  });
  it('a ci_green record is appended only when every CI job passed', () => {
    const rec = Object.entries(ci.jobs).find(([, j]) => runOf(j).includes('deploy-record.ts ci-green'));
    expect(rec, 'a ci-green job').toBeDefined();
    const [, job] = rec!;
    expect(needs(job).sort()).toEqual(Object.keys(ci.jobs).filter((k) => k !== rec![0]).sort());
    expect(runOf(job)).toMatch(/TARGET_FILE=deploy-ledger\.jsonl/);
    expect(job.permissions?.contents).toBe('write');
  });
  it('the ledger script appends to a chosen file on the same append-only branch, defaulting to the fabrication ledger', () => {
    expect(append).toMatch(/TARGET="\$\{TARGET_FILE:-fab-ledger\.jsonl\}"/);
    expect(append).not.toMatch(/push --force|push -f/);
  });
});

describe('[P52] Deploy: one decision gates both halves', () => {
  const d = deploy.jobs.decide!;
  it('a decide job reads the permanent ledger and runs the decision (fail closed if the ledger cannot be read)', () => {
    expect(d).toBeDefined();
    expect(runOf(d)).toMatch(/deploy-ledger\.jsonl/);
    expect(runOf(d)).toMatch(/deploy-decide\.ts/);
    expect(runOf(d)).not.toMatch(/\|\| true/);
  });
  it('NEGATIVE: api and web both depend on the decision; web also waits for the API', () => {
    expect(needs(deploy.jobs.api!)).toContain('decide');
    expect(needs(deploy.jobs.web!)).toEqual(expect.arrayContaining(['decide', 'api']));
    expect(deploy.jobs.web!.if).toMatch(/needs\.api\.result == 'success'/);
    expect(deploy.jobs.api!.if).toMatch(/needs\.decide\.result == 'success'/);
    expect(deploy.jobs.web!.if).toMatch(/needs\.decide\.result == 'success'/);
  });
  it('deploys exactly the commit the decision approved', () => {
    for (const job of [deploy.jobs.api!, deploy.jobs.web!]) {
      const co = job.steps.find((s) => (s.uses ?? '').startsWith('actions/checkout'))!;
      expect(String(co.with?.ref)).toMatch(/needs\.decide\.outputs\.sha/);
    }
  });
  it('a manual deploy can name an older commit (a rollback) and force with a required reason', () => {
    const inputs = deploy.on.workflow_dispatch.inputs;
    expect(inputs.sha).toBeDefined();
    expect(inputs.force?.type).toBe('boolean');
    expect(inputs.reason).toBeDefined();
  });
  it('a forced deploy gets the email secrets and is appended to the ledger (who, when, why)', () => {
    const step = d.steps.find((s) => (s.run ?? '').includes('deploy-decide.ts'))!;
    expect(step.env?.RESEND_API_KEY).toMatch(/secrets\.RESEND_API_KEY/);
    expect(step.env?.ADMIN_EMAILS).toMatch(/secrets\.ADMIN_EMAILS/);
    expect(step.env?.ACTOR).toMatch(/github\.actor/);
    expect(runOf(d)).toMatch(/FORCED_OUT[\s\S]*TARGET_FILE=deploy-ledger\.jsonl/);
    expect(deploy.permissions.contents).toBe('write');
  });
  // [P56-3 · owner] was 'provisional-ok' ("PROVISIONAL allowed for now"); switched after the P55 full certification
  // passed. PROVISIONAL now deploys only when backed by a PASS certification of the same CERT_SURFACE (P56-1).
  it('the policy is explicit: PASS required', () => {
    const step = d.steps.find((s) => (s.run ?? '').includes('deploy-decide.ts'))!;
    expect(step.env?.DEPLOY_POLICY).toBe('pass-required');
  });
});
