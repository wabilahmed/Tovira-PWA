import { describe, it, expect } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, chmodSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runKeptPromiseCheck, parseKeptCheckArgs, formatKeptCheck, KEPT_AUTOCLOSED_COUNT_SQL, NOTES_WITH_KEPT_AT_SQL } from './kept-promise-check.js';

/**
 * [P26-2] The read-only kept-promise check, before EXTRACT_WINDOWED is turned on: how many promises did the
 * P23 windowed path auto-close (expected 0 — windowing was never on in prod), and how many notes carry a
 * model `kept_at`. It runs in prod as an ECS one-off (scripts/ops/run-backfill.sh --script kept-promise-check)
 * and must be READ-ONLY: one READ ONLY transaction, SELECTs only, counts only (no promise text is printed),
 * and it refuses --apply.
 */
type Q = { sql: string; params?: unknown[] };
const fakeClient = (counts: { autoClosed: number; keptAt: number }) => {
  const seen: Q[] = [];
  return {
    seen,
    query: async (sql: string, params?: unknown[]) => {
      seen.push({ sql, params });
      if (sql === KEPT_AUTOCLOSED_COUNT_SQL) return { rows: [{ n: String(counts.autoClosed) }] };
      if (sql === NOTES_WITH_KEPT_AT_SQL) return { rows: [{ n: String(counts.keptAt) }] };
      return { rows: [] };
    },
  };
};

describe('[P26-2] kept-promise check', () => {
  it('runs inside ONE read-only transaction, SELECTs only, and returns the two counts', async () => {
    const c = fakeClient({ autoClosed: 0, keptAt: 3 });
    const out = await runKeptPromiseCheck(c);
    expect(out).toEqual({ autoClosedPromises: 0, notesWithKeptAt: 3 });
    expect(c.seen[0]!.sql).toBe('BEGIN TRANSACTION READ ONLY');
    expect(c.seen.at(-1)!.sql).toBe('ROLLBACK');
    const body = c.seen.slice(1, -1).map((q) => q.sql);
    expect(body).toEqual([KEPT_AUTOCLOSED_COUNT_SQL, NOTES_WITH_KEPT_AT_SQL]);
    for (const s of body) expect(s.trim()).toMatch(/^SELECT count\(\*\)/i);
    for (const s of body) expect(s).not.toMatch(/\b(INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE|CREATE)\b/i);
  });

  it('prints the two counts, and says plainly when the auto-close count is not zero', () => {
    expect(formatKeptCheck({ autoClosedPromises: 0, notesWithKeptAt: 3 })).toEqual([
      'auto-closed promises (done + matching model kept_at): 0',
      'notes with a model kept_at: 3',
      'OK — nothing was auto-closed.',
    ]);
    expect(formatKeptCheck({ autoClosedPromises: 2, notesWithKeptAt: 2 }).at(-1)).toBe('NOT ZERO — 2 promise(s) look auto-closed; review before turning on EXTRACT_WINDOWED.');
  });

  it('NEGATIVE: refuses --apply or any other argument (it has nothing to write)', () => {
    expect(parseKeptCheckArgs([])).toEqual({});
    expect(() => parseKeptCheckArgs(['--apply'])).toThrow(/read-only/);
    expect(() => parseKeptCheckArgs(['--only-user', 'x'])).toThrow();
  });

  it('a failed query still ends the transaction (rollback) and surfaces the error', async () => {
    const seen: string[] = [];
    const bad = { query: async (sql: string) => { seen.push(sql); if (sql === NOTES_WITH_KEPT_AT_SQL) throw new Error('boom'); return { rows: [{ n: '0' }] }; } };
    await expect(runKeptPromiseCheck(bad)).rejects.toThrow('boom');
    expect(seen.at(-1)).toBe('ROLLBACK');
  });
});

describe('[P26-2] scripts/ops/run-backfill.sh --script kept-promise-check', () => {
  const repo = fileURLToPath(new URL('../../../../', import.meta.url));
  const script = join(repo, 'scripts/ops/run-backfill.sh');
  // A fake `aws` on PATH that records each call and answers just enough for the one-off flow.
  const withFakeAws = () => {
    const dir = mkdtempSync(join(tmpdir(), 'kpc-'));
    const log = join(dir, 'calls.log');
    writeFileSync(join(dir, 'aws'), `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "${log}"
case "$1 $2" in
  "ecs describe-services") echo '{"taskDefinition":"arn:aws:ecs:eu-north-1:1:task-definition/tovira-prod-api:111","net":{"subnets":["subnet-a"],"securityGroups":["sg-a"],"assignPublicIp":"ENABLED"}}' ;;
  "ecs run-task") echo '{"tasks":[{"taskArn":"arn:aws:ecs:eu-north-1:1:task/tovira-prod/abc123"}],"failures":[]}' ;;
  "ecs wait") ;;
  "ecs describe-tasks") echo '{"reason":"Essential container in task exited","exit":0}' ;;
  "logs get-log-events") echo '{"events":[{"message":"auto-closed promises (done + matching model kept_at): 0"}]}' ;;
esac
`);
    chmodSync(join(dir, 'aws'), 0o755);
    return { dir, log, env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, TOVIRA_BACKFILL_STATE_DIR: join(dir, 'state') } };
  };

  it('runs the check as an ECS one-off with the live task definition and the check script as the command', () => {
    const f = withFakeAws();
    const out = execFileSync('bash', [script, '--script', 'kept-promise-check'], { env: f.env, encoding: 'utf8' });
    const calls = readFileSync(f.log, 'utf8');
    expect(calls).toMatch(/ecs run-task .*--task-definition arn:aws:ecs:eu-north-1:1:task-definition\/tovira-prod-api:111/);
    expect(calls).toContain('apps/api/src/scripts/kept-promise-check.ts');
    expect(out).toMatch(/mode=READ-ONLY/);
    expect(out).toContain('auto-closed promises (done + matching model kept_at): 0');
  });

  it('NEGATIVE: --apply is refused before any AWS call', () => {
    const f = withFakeAws();
    const r = spawnSync('bash', [script, '--script', 'kept-promise-check', '--apply', '--i-checked-the-dry-run'], { env: f.env, encoding: 'utf8' });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/read-only/);
    expect(existsSync(f.log)).toBe(false);
  });
});
