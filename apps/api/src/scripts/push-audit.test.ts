import { describe, it, expect } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, chmodSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPushAudit, parsePushAuditArgs, formatPushAudit, PUSH_AUDIT_SQL } from './push-audit.js';

/**
 * [P46-2] How many reps have no stored push subscription (so no alerts or meeting nudges reach them). The server
 * cannot see a browser's permission, so it counts reps with ZERO stored subscriptions, the ones with one or more, and
 * the subscriptions in total. One READ ONLY transaction, counts only (no endpoints, no ids), refuses --apply.
 */
const fake = (row: Record<string, string>) => {
  const seen: string[] = [];
  return { seen, query: async (sql: string) => { seen.push(sql); return { rows: sql === PUSH_AUDIT_SQL ? [row] : [] }; } };
};

describe('[P46-2] push audit', () => {
  it('one read-only transaction, one SELECT, three counts', async () => {
    const c = fake({ reps: '12', with_subscription: '0', subscriptions: '0' });
    expect(await runPushAudit(c)).toEqual({ reps: 12, withSubscription: 0, withoutSubscription: 12, subscriptions: 0 });
    expect(c.seen).toEqual(['BEGIN TRANSACTION READ ONLY', PUSH_AUDIT_SQL, 'ROLLBACK']);
    expect(PUSH_AUDIT_SQL.trim()).toMatch(/^SELECT/i);
    expect(PUSH_AUDIT_SQL).not.toMatch(/\b(INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE|CREATE)\b/i);
    expect(PUSH_AUDIT_SQL).not.toMatch(/endpoint\s*,|p256dh|auth\b/i);
  });

  it('prints the counts in plain words', () => {
    expect(formatPushAudit({ reps: 12, withSubscription: 2, withoutSubscription: 10, subscriptions: 3 })).toEqual([
      'reps: 12',
      'reps with a stored push subscription: 2 (3 subscriptions in total)',
      'reps with NO stored push subscription (no alerts or meeting nudges reach them): 10',
    ]);
  });

  it('NEGATIVE: refuses --apply or any other argument', () => {
    expect(parsePushAuditArgs([])).toEqual({});
    expect(() => parsePushAuditArgs(['--apply'])).toThrow(/read-only/);
    expect(() => parsePushAuditArgs(['--only-user', 'x'])).toThrow();
  });
});

describe('[P46-2] scripts/ops/run-backfill.sh --script push-audit', () => {
  const repo = fileURLToPath(new URL('../../../../', import.meta.url));
  const script = join(repo, 'scripts/ops/run-backfill.sh');
  const withFakeAws = () => {
    const dir = mkdtempSync(join(tmpdir(), 'pa-'));
    const log = join(dir, 'calls.log');
    writeFileSync(join(dir, 'aws'), `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "${log}"
case "$1 $2" in
  "ecs describe-services") echo '{"taskDefinition":"arn:aws:ecs:eu-north-1:1:task-definition/tovira-prod-api:111","net":{"subnets":["subnet-a"],"securityGroups":["sg-a"],"assignPublicIp":"ENABLED"}}' ;;
  "ecs run-task") echo '{"tasks":[{"taskArn":"arn:aws:ecs:eu-north-1:1:task/tovira-prod/abc123"}],"failures":[]}' ;;
  "ecs wait") ;;
  "ecs describe-tasks") echo '{"reason":"Essential container in task exited","exit":0}' ;;
  "logs get-log-events") echo '{"events":[{"message":"reps: 12"}]}' ;;
esac
`);
    chmodSync(join(dir, 'aws'), 0o755);
    return { log, env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, TOVIRA_BACKFILL_STATE_DIR: join(dir, 'state') } };
  };

  it('runs read-only as an ECS one-off with the audit script', () => {
    const f = withFakeAws();
    const out = execFileSync('bash', [script, '--script', 'push-audit'], { env: f.env, encoding: 'utf8' });
    expect(readFileSync(f.log, 'utf8')).toContain('apps/api/src/scripts/push-audit.ts');
    expect(out).toMatch(/mode=READ-ONLY/);
  });

  it('NEGATIVE: --apply is refused before any AWS call', () => {
    const f = withFakeAws();
    const r = spawnSync('bash', [script, '--script', 'push-audit', '--apply', '--i-checked-the-dry-run'], { env: f.env, encoding: 'utf8' });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/read-only/);
    expect(existsSync(f.log)).toBe(false);
  });
});
