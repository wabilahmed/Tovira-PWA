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
  monday_digest: { triggeredBy: 'monday.runScheduled(' }, // monday-digest brain job
  overdue_promise: { triggeredBy: 'scanRunner.run(' }, // daily-scan brain job → scan.runAll
  going_cold: { triggeredBy: 'scanRunner.run(' },
  date_reminder: { triggeredBy: 'scanRunner.run(' },
  chat_refresh: { triggeredBy: 'scanRunner.run(' },
};

const LEDGER_WIRING: Record<LedgerEventType, Wiring> = {
  thread_reopened: { triggeredBy: "type: 'thread_reopened'" }, // notes-routes on note capture
  promise_kept: { triggeredBy: "type: 'promise_kept'" }, // facts-routes on promise done-on-time
  brief_before_meeting: { triggeredBy: "type: 'brief_before_meeting'" }, // brief-routes
  inventory_suggested_bought: { dormant: 'Batch 2: credited only when outcome_set_by=confirmed_suggestion, which no production path sets until the matching engine ships (inventory-service.ts).' },
};

// Every job that must be registered on the ScheduledBrain (asserted present in index.ts).
const SCHEDULED_JOBS = ['notes-sweep', 'priorities-nightly', 'trial-emails', 'meeting-nudges', 'monday-digest', 'daily-scan'];

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

  it('the allow-list is small and every entry carries a reason (visible, not silent)', () => {
    const dormant = [
      ...Object.entries(NOTIFICATION_WIRING),
      ...Object.entries(LEDGER_WIRING),
    ].filter(([, w]) => 'dormant' in w);
    // If this grows, each addition is a deliberate, reviewed decision — not a silent gap.
    expect(dormant.length).toBeLessThanOrEqual(1);
    expect(dormant.map(([t]) => t)).toEqual(['inventory_suggested_bought']);
  });
});
