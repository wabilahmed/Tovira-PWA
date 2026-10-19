import { describe, it, expect } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, chmodSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { redactEmail, keyMode, classifyStripeId, runStripeModeAudit, formatAudit, parseAuditArgs, STRIPE_MODE_CANDIDATES_SQL, type AuditStripe } from './stripe-mode-audit.js';

/**
 * [P30-3] Before Stripe goes live: which accounts look paid ('active') but carry a Stripe customer /
 * subscription id from TEST mode — they would keep full access with no live subscription behind them. The
 * audit is READ-ONLY: one READ ONLY database transaction (rolled back), Stripe GET calls only (retrieve),
 * redacted emails, and it refuses --apply. A test-mode id is recognised from Stripe's own answer under the
 * live key ("No such customer …; a similar object exists in test mode").
 */
const testModeMissing = (kind: string, id: string) => Object.assign(new Error(`No such ${kind}: '${id}'; a similar object exists in test mode, but a live mode key was used to make this request.`), { code: 'resource_missing' });
const plainMissing = (kind: string, id: string) => Object.assign(new Error(`No such ${kind}: '${id}'`), { code: 'resource_missing' });

function fakeStripe(map: Record<string, 'live' | 'test' | 'gone'>): AuditStripe & { calls: string[] } {
  const calls: string[] = [];
  const get = (kind: string) => async (id: string) => {
    calls.push(`${kind}:${id}`);
    const m = map[id];
    if (m === 'live') return { id, livemode: true };
    if (m === 'test') throw testModeMissing(kind, id);
    throw plainMissing(kind, id);
  };
  return { calls, customers: { retrieve: get('customer') }, subscriptions: { retrieve: get('subscription') } };
}
const row = (o: Partial<Record<string, unknown>>) => ({ user_id: 'u1', email: 'wabil@prospera-technologies.com', status: 'active', billing_state: 'active', created_at: new Date('2026-09-01T10:00:00Z'), stripe_customer_id: null, stripe_subscription_id: null, ...o });

describe('[P30-3] stripe-mode-audit — pieces', () => {
  it('redacts the email to its first 3 characters plus the domain', () => {
    expect(redactEmail('wabil@prospera-technologies.com')).toBe('wab…@prospera-technologies.com');
    expect(redactEmail('al@x.io')).toBe('al…@x.io');
    expect(redactEmail('not-an-email')).toBe('not…');
  });
  it('reads the key mode from its prefix without printing the key', () => {
    expect(keyMode(['sk', 'live', 'abc'].join('_'))).toBe('live');
    expect(keyMode(['rk', 'test', 'abc'].join('_'))).toBe('test');
    expect(keyMode(undefined)).toBe('none');
  });
  it('classifies an id from Stripe\'s answer: live / test / missing', async () => {
    const s = fakeStripe({ cus_L: 'live', cus_T: 'test', cus_G: 'gone' });
    expect(await classifyStripeId(s.customers.retrieve, 'cus_L')).toBe('live');
    expect(await classifyStripeId(s.customers.retrieve, 'cus_T')).toBe('test');
    expect(await classifyStripeId(s.customers.retrieve, 'cus_G')).toBe('missing');
    expect(await classifyStripeId(s.customers.retrieve, null)).toBe('none');
  });
});

describe('[P30-3] stripe-mode-audit — the run', () => {
  it('flags active accounts whose customer/subscription is test-mode (or gone), and active accounts with no Stripe ids at all', async () => {
    const seen: string[] = [];
    const db = { query: async (sql: string) => {
      seen.push(sql);
      if (sql === STRIPE_MODE_CANDIDATES_SQL) return { rows: [
        row({ user_id: 'u-test', stripe_customer_id: 'cus_T', stripe_subscription_id: 'sub_T' }),
        row({ user_id: 'u-live', stripe_customer_id: 'cus_L', stripe_subscription_id: 'sub_L' }),
        row({ user_id: 'u-noids' }),
        row({ user_id: 'u-trial-test', status: 'trialing', stripe_customer_id: 'cus_T2' }),
      ] };
      return { rows: [] };
    } };
    const stripe = fakeStripe({ cus_T: 'test', sub_T: 'test', cus_L: 'live', sub_L: 'live', cus_T2: 'test' });
    const out = await runStripeModeAudit(db, stripe);
    expect(seen[0]).toBe('BEGIN TRANSACTION READ ONLY');
    expect(seen.at(-1)).toBe('ROLLBACK');
    expect(seen.slice(1, -1)).toEqual([STRIPE_MODE_CANDIDATES_SQL]);
    expect(STRIPE_MODE_CANDIDATES_SQL.trim()).toMatch(/^SELECT/i);
    expect(STRIPE_MODE_CANDIDATES_SQL).not.toMatch(/\b(INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE)\b/i);
    expect(out.flagged.map((f) => [f.userId, f.reason])).toEqual([
      ['u-test', 'active with a test-mode Stripe customer/subscription'],
      ['u-noids', 'active with no Stripe customer or subscription'],
    ]);
    expect(out.flagged[0]).toMatchObject({ email: 'wab…@prospera-technologies.com', status: 'active', createdAt: '2026-09-01', customer: 'test', subscription: 'test' });
    expect(out.checked).toBe(4);
    // only retrieve (GET) calls were made
    expect(stripe.calls.every((c) => /^(customer|subscription):/.test(c))).toBe(true);
  });

  it('prints one line per flagged account (redacted) and a summary; never the raw email or the key', async () => {
    const lines = formatAudit({ keyMode: 'live', checked: 3, flagged: [{ userId: 'u-test', email: 'wab…@prospera-technologies.com', status: 'active', billingState: 'active', createdAt: '2026-09-01', customer: 'test', subscription: 'test', reason: 'active with a test-mode Stripe customer/subscription' }] });
    expect(lines).toEqual([
      'Stripe key mode: live',
      'checked 3 account(s) (active, or with any Stripe id)',
      'FLAG u-test  wab…@prospera-technologies.com  status=active  created=2026-09-01  customer=test  subscription=test  — active with a test-mode Stripe customer/subscription',
      '1 account(s) flagged. Nothing was changed.',
    ]);
    expect(formatAudit({ keyMode: 'test', checked: 0, flagged: [] })).toContain('WARNING: the Stripe key in this task is a TEST key — test-mode ids look valid under it, so nothing can be flagged as test. Run after the live key is in tovira/prod/app.');
  });

  it('NEGATIVE: refuses --apply or any argument', () => {
    expect(parseAuditArgs([])).toEqual({});
    expect(() => parseAuditArgs(['--apply'])).toThrow(/read-only/);
    expect(() => parseAuditArgs(['--only-user', 'x'])).toThrow();
  });
});

describe('[P30-3] scripts/ops/run-backfill.sh --script stripe-mode-audit', () => {
  const repo = fileURLToPath(new URL('../../../../', import.meta.url));
  const script = join(repo, 'scripts/ops/run-backfill.sh');
  const withFakeAws = () => {
    const dir = mkdtempSync(join(tmpdir(), 'sma-'));
    const log = join(dir, 'calls.log');
    writeFileSync(join(dir, 'aws'), `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "${log}"
case "$1 $2" in
  "ecs describe-services") echo '{"taskDefinition":"arn:aws:ecs:eu-north-1:1:task-definition/tovira-prod-api:117","net":{"subnets":["subnet-a"],"securityGroups":["sg-a"],"assignPublicIp":"ENABLED"}}' ;;
  "ecs run-task") echo '{"tasks":[{"taskArn":"arn:aws:ecs:eu-north-1:1:task/tovira-prod/abc"}],"failures":[]}' ;;
  "ecs describe-tasks") echo '{"reason":"done","exit":0}' ;;
  "logs get-log-events") echo '{"events":[{"message":"[stripe-mode-audit] 0 account(s) flagged. Nothing was changed."}]}' ;;
esac
`);
    chmodSync(join(dir, 'aws'), 0o755);
    return { log, env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, TOVIRA_BACKFILL_STATE_DIR: join(dir, 'state') } };
  };
  it('runs the audit script as a READ-ONLY ECS one-off', () => {
    const f = withFakeAws();
    const out = execFileSync('bash', [script, '--script', 'stripe-mode-audit'], { env: f.env, encoding: 'utf8' });
    expect(readFileSync(f.log, 'utf8')).toContain('apps/api/src/scripts/stripe-mode-audit.ts');
    expect(out).toMatch(/mode=READ-ONLY/);
  });
  it('NEGATIVE: --apply is refused before any AWS call', () => {
    const f = withFakeAws();
    const r = spawnSync('bash', [script, '--script', 'stripe-mode-audit', '--apply', '--i-checked-the-dry-run'], { env: f.env, encoding: 'utf8' });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/read-only/);
    expect(existsSync(f.log)).toBe(false);
  });
});
