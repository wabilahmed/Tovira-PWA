import { describe, it, expect } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, chmodSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runTier1IndiaAudit, parseTier1IndiaAuditArgs, formatTier1IndiaAudit, TIER1_INDIA_AUDIT_SQL } from './tier1-india-audit.js';

/**
 * [P53-5] READ-ONLY: how many stored messages in prod would match the new Indian Tier-1 rules (Aadhaar, PAN, Indian
 * passports, the wider bank-account labels) if they were redacted today. Counts only: no text, no ids, nothing changed.
 * One READ ONLY transaction, paged; refuses --apply.
 */
const page = (rows: Array<Record<string, unknown>>) => {
  const seen: string[] = [];
  let served = false;
  return { seen, query: async (sql: string) => { seen.push(sql); if (sql === TIER1_INDIA_AUDIT_SQL && !served) { served = true; return { rows }; } return { rows: [] }; } };
};

describe('[P53-5] Indian Tier-1 audit (read-only)', () => {
  it('counts stored messages and message-less notes that would now be blanked, by kind; prints no text', async () => {
    const db = page([
      { id: 'n1', raw_text: null, messages: [{ body: 'aadhaar 2345 6789 0124' }, { body: 'hello' }, { body: 'pan ABCPE1234F' }] },
      { id: 'n2', raw_text: 'His passport for the visa is K1234567', messages: null },
      { id: 'n3', raw_text: 'call +91 98765 43210, budget 450000', messages: null },
      { id: 'n4', raw_text: null, messages: [{ body: 'a/c no. 123456789012' }] },
    ]);
    const r = await runTier1IndiaAudit(db);
    expect(r).toEqual({ notesScanned: 4, notesAffected: 3, textsAffected: 4, byKind: { aadhaar: 1, pan: 1, passport: 1, bank_account: 1 } });
    const printed = formatTier1IndiaAudit(r).join('\n');
    for (const secret of ['2345', 'ABCPE', 'K1234567', '123456789012', 'n1', 'n2']) expect(printed).not.toContain(secret);
  });

  it('one READ ONLY transaction, SELECT only, rolled back', async () => {
    const db = page([]);
    await runTier1IndiaAudit(db);
    expect(db.seen[0]).toBe('BEGIN TRANSACTION READ ONLY');
    expect(db.seen.at(-1)).toBe('ROLLBACK');
    expect(TIER1_INDIA_AUDIT_SQL.trim()).toMatch(/^SELECT/i);
    expect(TIER1_INDIA_AUDIT_SQL).not.toMatch(/\b(INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE|CREATE)\b/i);
  });

  it('NEGATIVE: refuses --apply or any other argument', () => {
    expect(parseTier1IndiaAuditArgs([])).toEqual({});
    expect(() => parseTier1IndiaAuditArgs(['--apply'])).toThrow(/read-only/);
    expect(() => parseTier1IndiaAuditArgs(['--only-user', 'x'])).toThrow();
  });
});

describe('[P53-5] scripts/ops/run-backfill.sh --script tier1-india-audit', () => {
  const repo = fileURLToPath(new URL('../../../../', import.meta.url));
  const script = join(repo, 'scripts/ops/run-backfill.sh');
  const withFakeAws = () => {
    const dir = mkdtempSync(join(tmpdir(), 'ti-'));
    const log = join(dir, 'calls.log');
    writeFileSync(join(dir, 'aws'), `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "${log}"
case "$1 $2" in
  "ecs describe-services") echo '{"taskDefinition":"arn:aws:ecs:eu-north-1:1:task-definition/tovira-prod-api:111","net":{"subnets":["subnet-a"],"securityGroups":["sg-a"],"assignPublicIp":"ENABLED"}}' ;;
  "ecs run-task") echo '{"tasks":[{"taskArn":"arn:aws:ecs:eu-north-1:1:task/tovira-prod/abc123"}],"failures":[]}' ;;
  "ecs wait") ;;
  "ecs describe-tasks") echo '{"reason":"Essential container in task exited","exit":0}' ;;
  "logs get-log-events") echo '{"events":[{"message":"notes scanned: 0"}]}' ;;
esac
`);
    chmodSync(join(dir, 'aws'), 0o755);
    return { log, env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, TOVIRA_BACKFILL_STATE_DIR: join(dir, 'state') } };
  };

  it('runs read-only as an ECS one-off with the audit script', () => {
    const f = withFakeAws();
    const out = execFileSync('bash', [script, '--script', 'tier1-india-audit'], { env: f.env, encoding: 'utf8' });
    expect(readFileSync(f.log, 'utf8')).toContain('apps/api/src/scripts/tier1-india-audit.ts');
    expect(out).toMatch(/mode=READ-ONLY/);
  });

  it('NEGATIVE: --apply is refused before any AWS call', () => {
    const f = withFakeAws();
    const r = spawnSync('bash', [script, '--script', 'tier1-india-audit', '--apply', '--i-checked-the-dry-run'], { env: f.env, encoding: 'utf8' });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/read-only/);
    expect(existsSync(f.log)).toBe(false);
  });
});
