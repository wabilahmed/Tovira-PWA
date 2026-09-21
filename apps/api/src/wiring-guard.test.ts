import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { NotificationType } from './ports/notification-repository.js';
import type { LedgerEventType } from './ports/ledger-repository.js';

/**
 * [WIRING-GUARD] The structural close on the built-but-never-wired class (dark gate metrics, the
 * scheduler that never fired, the import-date reference, extraction never persisting meetings,
 * notifyMonday test-only, the daily scan). Five instances were luck running out; this makes the
 * audit self-enforcing.
 *
 * Every emitter (each NotificationType, each LedgerEventType) MUST appear below — the
 * Record<…Type, …> makes that a COMPILE error to omit, so a new emitter cannot be added without a
 * wiring decision. Each entry either names a production trigger (a substring asserted present in
 * non-test source — if the trigger is deleted, this test fails) or is an explicit `dormant`
 * allow-list with a reason (visible, never silent). Same doctrine as the gate self-test: a check
 * that cannot fail is not a check. Zero model cost; runs in CI.
 */
type Wiring = { triggeredBy: string } | { dormant: string };

// Each notification type → the production call site that fires it (asserted present below).
const NOTIFICATION_WIRING: Record<NotificationType, Wiring> = {
  pre_meeting_nudge: { triggeredBy: 'meetingNudge.run(' }, // meeting-nudges brain job
  monday_digest: { triggeredBy: 'monday.runScheduled(' }, // monday-digest brain job (in-app only now; no push)
  overdue_promise: { triggeredBy: 'scanRunner.run(' }, // daily-scan brain job → scan.runAll
  promise_due_today: { triggeredBy: 'scanRunner.run(' }, // NOTIF-REWORK: scan.runAll → promisesDueToday
  going_cold: { triggeredBy: 'scanRunner.run(' },
  date_reminder: { triggeredBy: 'scanRunner.run(' },
  chat_refresh: { triggeredBy: 'scanRunner.run(' },
  daily_digest: { triggeredBy: 'dailyDigest.runScheduled(' }, // NOTIF-REWORK: daily-digest brain job
  erasure_pending: { triggeredBy: "type: 'erasure_pending'" }, // ERASURE: ErasureRequestService.open
  erasure_completed: { triggeredBy: "type: 'erasure_completed'" }, // ERASURE: ErasureRequestService.complete
  import_complete: { triggeredBy: 'importCompletion.onNoteSettled(' }, // [IMPORT-DONE] sweep terminal hook
};

const LEDGER_WIRING: Record<LedgerEventType, Wiring> = {
  thread_reopened: { triggeredBy: "type: 'thread_reopened'" }, // notes-routes on note capture
  promise_kept: { triggeredBy: "type: 'promise_kept'" }, // facts-routes on promise done-on-time
  brief_before_meeting: { triggeredBy: "type: 'brief_before_meeting'" }, // brief-routes
  inventory_suggested_bought: { triggeredBy: "'confirmed_suggestion'" }, // INV-MATCH A5: the share-from-suggestion route sets it; the ledger credits it on bought
};

// Every job that must be registered on the ScheduledBrain (asserted present in index.ts).
const SCHEDULED_JOBS = ['notes-sweep', 'priorities-nightly', 'trial-emails', 'meeting-nudges', 'monday-digest', 'daily-digest', 'daily-scan'];

function nonTestSource(): string {
  const root = dirname(fileURLToPath(import.meta.url));
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.ts') && !e.name.endsWith('.test.ts')) out.push(readFileSync(p, 'utf8'));
    }
  };
  walk(root);
  return out.join('\n');
}

/** Per-file non-test source, path relative to the src root — for checks that need file boundaries. */
function nonTestFiles(): Array<{ rel: string; content: string }> {
  const root = dirname(fileURLToPath(import.meta.url));
  const out: Array<{ rel: string; content: string }> = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.ts') && !e.name.endsWith('.test.ts')) out.push({ rel: p.slice(root.length + 1), content: readFileSync(p, 'utf8') });
    }
  };
  walk(root);
  return out;
}

/**
 * [SPEND-INSTRUMENT / WIRING-GUARD] Every model call must route through the metered sink, so no cost
 * escapes the ledger (this is the same defect class as an emitter with no caller — extraction ran on
 * RAW clients from P5-7 and was never metered, so the spend cap never counted it). A raw
 * AnthropicModelClient constructed outside the metered wrapper — anywhere but the eval/scripts paths,
 * which are deliberately unattributed — fails CI.
 */
describe('[WIRING-GUARD] every model call routes through the metered sink', () => {
  it('no production code constructs a raw AnthropicModelClient that bypasses MeteredModelClient', () => {
    const offenders: string[] = [];
    for (const f of nonTestFiles()) {
      if (/(^|\/)(scripts|eval)\//.test(f.rel)) continue; // eval + one-off scripts: no sink, no attribution
      const anthropic = (f.content.match(/new AnthropicModelClient\(/g) ?? []).length;
      if (anthropic === 0) continue;
      // container.ts is the ONE sanctioned factory; every client it builds must be wrapped in a
      // MeteredModelClient. Anywhere else, a raw client is a bypass.
      if (f.rel.endsWith('container.ts')) {
        const metered = (f.content.match(/new MeteredModelClient\(/g) ?? []).length;
        if (metered < anthropic) offenders.push(`${f.rel}: ${anthropic} AnthropicModelClient but only ${metered} MeteredModelClient — an unmetered client`);
      } else {
        offenders.push(`${f.rel}: constructs AnthropicModelClient outside the container factory (unmetered)`);
      }
    }
    expect(offenders, `raw model clients bypass the metered sink:\n${offenders.join('\n')}`).toEqual([]);
  });
});

describe('[WIRING-GUARD] every registered emitter is reachable in production', () => {
  const src = nonTestSource();
  const indexSrc = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'index.ts'), 'utf8');

  it('every notification type is wired to a production trigger (or explicitly dormant)', () => {
    for (const [type, w] of Object.entries(NOTIFICATION_WIRING)) {
      if ('dormant' in w) { expect(w.dormant.length, `${type} dormant reason`).toBeGreaterThan(10); continue; }
      expect(src.includes(w.triggeredBy), `${type}: production trigger "${w.triggeredBy}" not found in non-test source — emitter is UNWIRED`).toBe(true);
    }
  });

  it('every ledger event type is wired to a production writer (or explicitly dormant)', () => {
    for (const [type, w] of Object.entries(LEDGER_WIRING)) {
      if ('dormant' in w) { expect(w.dormant.length, `${type} dormant reason`).toBeGreaterThan(10); continue; }
      expect(src.includes(w.triggeredBy), `${type}: production writer "${w.triggeredBy}" not found — ledger emitter is UNWIRED`).toBe(true);
    }
  });

  it('every expected scheduled job is registered on the brain', () => {
    for (const job of SCHEDULED_JOBS) {
      expect(indexSrc.includes(`name: '${job}'`), `scheduled job "${job}" is not registered in index.ts`).toBe(true);
    }
  });

  // A shared advisory-lock key makes two jobs contend for one lock, so one is silently skipped —
  // a "registered but doesn't run" defect (a human once caught this by reading index.ts). Now CI does.
  it('every registered scheduled job has a UNIQUE advisory lockKey', () => {
    const pairs = [...indexSrc.matchAll(/name:\s*'([^']+)',\s*lockKey:\s*(\d+)/g)].map((m) => ({ name: m[1]!, lockKey: m[2]! }));
    expect(pairs.length, 'no scheduled jobs found — the regex or registration shape changed').toBeGreaterThanOrEqual(SCHEDULED_JOBS.length);
    const byKey = new Map<string, string[]>();
    for (const p of pairs) (byKey.get(p.lockKey) ?? byKey.set(p.lockKey, []).get(p.lockKey)!).push(p.name);
    const collisions = [...byKey.entries()].filter(([, names]) => names.length > 1);
    expect(collisions, `lockKey collisions: ${collisions.map(([k, n]) => `${k} → ${n.join(', ')}`).join('; ')}`).toEqual([]);
  });

  it('the allow-list is small and every entry carries a reason (visible, not silent)', () => {
    const dormant = [
      ...Object.entries(NOTIFICATION_WIRING),
      ...Object.entries(LEDGER_WIRING),
    ].filter(([, w]) => 'dormant' in w);
    // If this grows, each addition is a deliberate, reviewed decision — not a silent gap. As of
    // INV-MATCH A5 there are NONE: inventory_suggested_bought is now wired (share-from-suggestion).
    expect(dormant.length).toBe(0);
  });

  // [USERS-GUARD] The `users` table has NO row-level security — auth must look a user up by email
  // BEFORE any tenant context exists, so RLS keyed on app.user_id is impossible on it. That makes the
  // app-layer scoping the ONLY thing preventing a cross-tenant read, with no DB backstop. So: every
  // `users` query lives in ONE audited file (pg-user-repository.ts), and every SELECT there is scoped
  // by a key — except the single, deliberate, ids-only `allUserIds` read. A stray `FROM users` in a
  // request path, or a new unscoped SELECT, would leak silently; this makes that a CI failure.
  describe('[USERS-GUARD] users-table access is centralized and scoped', () => {
    const CANON = 'adapters/auth/pg-user-repository.ts';
    // Dev/tooling only — not a request path (same spirit as the eval/scripts exemption above).
    const exempt = (rel: string): boolean =>
      rel === CANON || rel.startsWith('seed/') || rel.startsWith('eval/') || rel.startsWith('scripts/');
    const USERS_SQL = /\b(?:from|into|update)\s+users\b/i; // covers SELECT…FROM / INSERT INTO / UPDATE / DELETE FROM users

    it('no users-table SQL exists outside pg-user-repository.ts', () => {
      const offenders = nonTestFiles()
        .filter((f) => !exempt(f.rel))
        // strip line comments so a doc mention of "from users" is not a false positive; SQL lives in strings
        .filter((f) => USERS_SQL.test(f.content.replace(/\/\/[^\n]*/g, '')))
        .map((f) => f.rel);
      expect(offenders, `users-table SQL must live only in ${CANON}; found in: ${offenders.join(', ')}`).toEqual([]);
    });

    it('every SELECT … FROM users in pg-user-repository.ts is WHERE-scoped, except the ids-only allUserIds read', () => {
      const repo = nonTestFiles().find((f) => f.rel === CANON);
      expect(repo, `${CANON} not found`).toBeTruthy();
      const selects = repo!.content
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => /\bselect\b/i.test(l) && /\bfrom users\b/i.test(l));
      expect(selects.length, 'no users SELECT found — file shape changed').toBeGreaterThan(0);
      for (const line of selects) {
        const scoped = /\bwhere\b/i.test(line);
        const allUserIds = /\bselect\s+id\s+from users\b/i.test(line); // ids only, deliberately unscoped (SYSTEM-ONLY)
        expect(scoped || allUserIds, `unscoped users SELECT (scope it, or it's a new allUserIds — reconsider): ${line}`).toBe(true);
      }
    });
  });
});
