import { describe, it, expect, vi } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { contradictions, dryRunDelete, flagAccessRequests, flagClients, parseQaAuditArgs, runQaAudit } from './qa-data-audit.js';

/** [P39-10] The QA list is read-only: it flags, explains why, prints the delete it WOULD run, and never deletes. */
const T = (s: number) => new Date(Date.parse('2026-10-20T10:00:00Z') + s * 1000).toISOString();
const client = (id: string, name: string, at: number, has_export = false, user_id = 'u1') => ({ id, user_id, email: 'wabil@prospera-technologies.com', name, created_at: T(at), has_export });

describe('[P39-10] QA data audit', () => {
  it('flags the HTML probe, "QA …" names and a bulk batch — each with why; ordinary clients are left alone', () => {
    const flags = flagClients([
      client('c1', '<img src=x onerror=alert(1)>', 0),
      client('c2', 'QA Sara Khan', 10),
      client('c3', 'Layla', 100, true), client('c4', 'Omar', 110, true), client('c5', 'Hassan', 120, true),
      client('c6', 'Real Client', 5000, true),
      client('c7', 'Quality Homes', 9000),
    ]);
    expect(flags.map((f) => [f.id, f.why])).toEqual([
      ['c1', 'name is an HTML/script probe (security test)'],
      ['c2', 'name starts with "QA"'],
      ['c3', 'bulk-imported: one of 3 clients created within 60 seconds from chat exports'],
      ['c4', 'bulk-imported: one of 3 clients created within 60 seconds from chat exports'],
      ['c5', 'bulk-imported: one of 3 clients created within 60 seconds from chat exports'],
    ]);
    expect(flags[0]!.account).toBe('wab…@prospera-technologies.com');
  });

  it('flags QA-looking access requests only', () => {
    const r = flagAccessRequests([
      { id: 'a1', full_name: 'QA Tester', work_email: 'qa1@example.com', company_name: 'Test Co', status: 'pending', created_at: T(0) },
      { id: 'a2', full_name: 'Mariam Saeed', work_email: 'mariam@realestate.ae', company_name: 'Saeed Homes', status: 'pending', created_at: T(0) },
    ]);
    expect(r.map((x) => x.id)).toEqual(['a1']);
  });

  it('reports contradictory requirement summaries ("1BR villa"), never a consistent one', () => {
    const c = contradictions([
      { client_id: 'c1', name: 'A', text: '1BR villa in Mirdif', requirement_raw: 'a 1BR villa', stated_on: '2026-10-01', created_at: T(0) },
      { client_id: 'c2', name: 'B', text: '4BR villa in Mirdif', requirement_raw: 'a 4BR villa', stated_on: '2026-10-01', created_at: T(0) },
      { client_id: 'c3', name: 'C', text: '2BR studio', requirement_raw: 'a 2BR studio', stated_on: null, created_at: T(0) },
    ]);
    expect(c.map((x) => [x.clientId, x.says])).toEqual([['c1', '1BR Villa'], ['c3', '2BR Studio']]);
  });

  it('[P40-5] negative: two separate requirements (a 1 bed flat, a 3 bedroom villa) are not a contradiction', () => {
    expect(contradictions([
      { client_id: 'a', name: 'QA Ahmed Al Mansouri', text: 'a 1 bed flat', requirement_raw: 'I need a 1 bed flat for my son', stated_on: '2026-09-01', created_at: T(0) },
      { client_id: 'a', name: 'QA Ahmed Al Mansouri', text: '3 bedroom villa', requirement_raw: "I'm looking for a 3 bedroom villa in Arabian Ranches", stated_on: '2026-09-10', created_at: T(1) },
    ])).toEqual([]);
  });

  it('the dry-run delete names every flagged id and is only printed', () => {
    const s = dryRunDelete([
      { kind: 'client', id: 'c1', name: 'x', createdAt: '', account: '', why: '' },
      { kind: 'access_request', id: 'a1', name: 'x', createdAt: '', account: '', why: '' },
      { kind: 'inventory_item', id: 'i1', name: 'x', createdAt: '', account: '', why: '' },
    ]);
    expect(s).toEqual([
      "DELETE FROM clients WHERE id IN ('c1'); -- notes, facts, requirements and shares go with them (ON DELETE CASCADE)",
      "DELETE FROM access_requests WHERE id IN ('a1'); -- their invites go with them",
      "DELETE FROM inventory_items WHERE id IN ('i1'); -- its shares go with it",
    ]);
  });

  it('negative: read-only — one READ ONLY transaction, rolled back; no DELETE ever sent; --apply refused', async () => {
    const sent: string[] = [];
    const db = { query: vi.fn(async (sql: string) => { sent.push(sql); return { rows: [] }; }) };
    await runQaAudit(db);
    expect(sent[0]).toBe('BEGIN TRANSACTION READ ONLY');
    expect(sent[sent.length - 1]).toBe('ROLLBACK');
    expect(sent.some((q) => /\b(DELETE|UPDATE|INSERT)\b/i.test(q))).toBe(false);
    expect(() => parseQaAuditArgs(['--apply'])).toThrow(/read-only/);
  });
});

describe('[P39-10] scripts/ops/run-backfill.sh --script qa-data-audit', () => {
  const repo = fileURLToPath(new URL('../../../../', import.meta.url));
  const script = join(repo, 'scripts/ops/run-backfill.sh');
  const withFakeAws = () => {
    const dir = mkdtempSync(join(tmpdir(), 'qda-'));
    const log = join(dir, 'calls.log');
    writeFileSync(join(dir, 'aws'), `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "${log}"
case "$1 $2" in
  "ecs describe-services") echo '{"taskDefinition":"arn:aws:ecs:eu-north-1:1:task-definition/tovira-prod-api:117","net":{"subnets":["subnet-a"],"securityGroups":["sg-a"],"assignPublicIp":"ENABLED"}}' ;;
  "ecs run-task") echo '{"tasks":[{"taskArn":"arn:aws:ecs:eu-north-1:1:task/tovira-prod/abc"}],"failures":[]}' ;;
  "ecs describe-tasks") echo '{"reason":"done","exit":0}' ;;
  "logs get-log-events") echo '{"events":[{"message":"[qa-data-audit] READ-ONLY. 0 item(s) flagged."}]}' ;;
esac
`);
    chmodSync(join(dir, 'aws'), 0o755);
    return { log, env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, TOVIRA_BACKFILL_STATE_DIR: join(dir, 'state') } };
  };
  it('runs the QA audit as a READ-ONLY ECS one-off', () => {
    const f = withFakeAws();
    const out = execFileSync('bash', [script, '--script', 'qa-data-audit'], { env: f.env, encoding: 'utf8' });
    expect(readFileSync(f.log, 'utf8')).toContain('apps/api/src/scripts/qa-data-audit.ts');
    expect(out).toMatch(/mode=READ-ONLY/);
  });
  it('NEGATIVE: --apply is refused before any AWS call', () => {
    const f = withFakeAws();
    const r = spawnSync('bash', [script, '--script', 'qa-data-audit', '--apply', '--i-checked-the-dry-run'], { env: f.env, encoding: 'utf8' });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/read-only/);
    expect(existsSync(f.log)).toBe(false);
  });
});
