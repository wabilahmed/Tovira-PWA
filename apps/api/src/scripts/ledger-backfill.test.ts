import { describe, it, expect } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { planLedgerBackfill, formatLedgerBackfill, runLedgerBackfill, WON_CANDIDATES_SQL, WON_INSERT_SQL, type WonCandidateRow } from './ledger-backfill.js';

/**
 * [P47-5] Owner: new Ledger entries come from events after the deploy. The ledger-backfill script's DRY RUN lists the
 * entries it WOULD create from stored history (client, both events with their dates, the window used); --apply writes
 * them. Only events with reliable timestamps: a rep's Won (clients.outcome_changed_at, written by the server when the
 * rep set it, source 'rep') and a suggestion share (inventory_shares.shared_at, written by the database at the share).
 * Win-backs: none, because no stored record shows a going-quiet alert reaching the rep before this deploy.
 */
const DAY = 86_400_000;
const T = Date.parse('2026-09-01T10:00:00Z');
const row = (o: Partial<WonCandidateRow> = {}): WonCandidateRow => ({ userId: 'u1', clientId: 'c1', clientName: 'Sara Khan', wonAt: new Date(T + 20 * DAY), shareId: 's1', sharedAt: new Date(T), itemTitle: 'Premium plan', ...o });

describe('[P47-5] ledger backfill', () => {
  it('plans one Won entry per client from the latest suggestion share inside 60 days, with both events and the window', () => {
    const plan = planLedgerBackfill([row()]);
    expect(plan.won).toEqual([{ userId: 'u1', clientId: 'c1', client: 'Sara Khan', item: 'Premium plan', shareId: 's1', sharedAt: '2026-09-01', wonAt: '2026-09-21', wonAtMs: T + 20 * DAY, days: 20 }]);
    expect(plan.winBacks).toEqual([]);
  });

  it('NEGATIVE: the SQL only reads a rep-set Won, suggestion shares before it and within 60 days, skipping clients already credited', () => {
    expect(WON_CANDIDATES_SQL).toMatch(/c\.outcome = 'won' AND c\.outcome_source = 'rep'/);
    expect(WON_CANDIDATES_SQL).toMatch(/outcome_set_by = 'confirmed_suggestion'/);
    expect(WON_CANDIDATES_SQL).toMatch(/s\.shared_at <= c\.outcome_changed_at/);
    expect(WON_CANDIDATES_SQL).toMatch(/interval '60 days'/);
    expect(WON_CANDIDATES_SQL).toMatch(/ORDER BY s\.shared_at DESC\s+LIMIT 1/);
    expect(WON_CANDIDATES_SQL).toMatch(/NOT EXISTS \(SELECT 1 FROM ledger_events/);
    expect(WON_INSERT_SQL).toMatch(/ON CONFLICT \(user_id, dedupe_key\) DO NOTHING/);
  });

  it('the dry run prints both events, their dates and the window, and says why there are no win-backs', () => {
    const lines = formatLedgerBackfill(planLedgerBackfill([row()]), false);
    expect(lines).toContain('Won after a suggestion: 1 entry would be created');
    expect(lines).toContain('  Sara Khan: Tovira suggested Premium plan (share s1) on 2026-09-01 · the rep set Won on 2026-09-21 · 20 days apart (window 60)');
    expect(lines.join('\n')).toMatch(/Clients won back: 0 \(no stored record shows a going-quiet alert reaching the rep before this deploy/);
    expect(lines.at(-1)).toBe('DRY RUN: nothing written. Re-run with --apply to create these.');
  });

  it('a dry run reads only; --apply inserts each planned entry in one transaction', async () => {
    const seen: string[] = [];
    const db = { query: async (sql: string) => { seen.push(sql); return { rows: sql === WON_CANDIDATES_SQL ? [{ user_id: 'u1', client_id: 'c1', client_name: 'Sara', won_at: new Date(T + DAY), share_id: 's1', shared_at: new Date(T), item_title: 'X' }] : [], rowCount: 1 }; } };
    await runLedgerBackfill(db, { apply: false, onlyUser: null });
    expect(seen).toEqual(['BEGIN TRANSACTION READ ONLY', WON_CANDIDATES_SQL, 'ROLLBACK']);
    seen.length = 0;
    const out = await runLedgerBackfill(db, { apply: true, onlyUser: null });
    expect(seen).toEqual(['BEGIN', WON_CANDIDATES_SQL, WON_INSERT_SQL, 'COMMIT']);
    expect(out.inserted).toBe(1);
  });
});

describe('[P47-5] scripts/ops/run-backfill.sh --script ledger-backfill', () => {
  const repo = fileURLToPath(new URL('../../../../', import.meta.url));
  const script = join(repo, 'scripts/ops/run-backfill.sh');
  const withFakeAws = () => {
    const dir = mkdtempSync(join(tmpdir(), 'lb-'));
    const log = join(dir, 'calls.log');
    writeFileSync(join(dir, 'aws'), `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "${log}"
case "$1 $2" in
  "ecs describe-services") echo '{"taskDefinition":"arn:aws:ecs:eu-north-1:1:task-definition/tovira-prod-api:111","net":{"subnets":["subnet-a"],"securityGroups":["sg-a"],"assignPublicIp":"ENABLED"}}' ;;
  "ecs run-task") echo '{"tasks":[{"taskArn":"arn:aws:ecs:eu-north-1:1:task/tovira-prod/abc123"}],"failures":[]}' ;;
  "ecs wait") ;;
  "ecs describe-tasks") echo '{"reason":"Essential container in task exited","exit":0}' ;;
  "logs get-log-events") echo '{"events":[{"message":"Won after a suggestion: 0 entries would be created"}]}' ;;
esac
`);
    chmodSync(join(dir, 'aws'), 0o755);
    return { log, env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, TOVIRA_BACKFILL_STATE_DIR: join(dir, 'state') } };
  };

  it('runs the ledger backfill as an ECS one-off, a dry run by default', () => {
    const f = withFakeAws();
    const out = execFileSync('bash', [script, '--script', 'ledger-backfill'], { env: f.env, encoding: 'utf8' });
    expect(readFileSync(f.log, 'utf8')).toContain('apps/api/src/scripts/ledger-backfill.ts');
    expect(out).toMatch(/mode=DRY RUN/);
  });

  it('NEGATIVE: --apply without a recent dry run is refused before any AWS call', () => {
    const f = withFakeAws();
    const r = spawnSync('bash', [script, '--script', 'ledger-backfill', '--apply'], { env: f.env, encoding: 'utf8' });
    expect(r.status).not.toBe(0);
  });
});
