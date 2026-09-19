# Notification rework — Task 1 findings (no edits)

## The cap ("silence budget")

- **Constant:** `DAILY_PUSH_CAP = 2` — `services/push/push-dispatch-service.ts:21`. Derivation in the
  P4-SILENCE block (lines 5-20): interruption friction kills the product; over-budget alerts are
  *suppressed from push only* (still recorded in-app). References "brand §10's 2/day cap".
- **Ranking for scarcity:** `RANK` map — `push-dispatch-service.ts:28-37` (loudest first:
  pre_meeting_nudge/import_complete 0, overdue_promise 1, going_cold 2, date_reminder 3,
  chat_refresh 4, monday_digest 5).
- **Enforcement point:** `PushDispatchService.dispatch()` — `push-dispatch-service.ts:78-118`. The
  single choke point every emitter routes through. Records all candidates in-app (80-88), splits
  exempt vs capped (91-94), truncates capped to `remaining = cap - countSent` (101-102), sends
  (109-113), spends budget only for non-exempt (115). Budget resets on the rep's local day (68-71).
  Ledger: `push_budget` table (`adapters/push/pg-push-budget-repository.ts`).

## The two documented exceptions

Both bypass via a flag set, not a separate path: `EXEMPT = {'pre_meeting_nudge','import_complete'}`
(`push-dispatch-service.ts:24`). Exempt alerts are pulled out (91), always sent when devices exist
(103), never sliced by the cap (107), never counted in `recordSent` (115).
- **pre_meeting_nudge** — [NUDGE-RANK], lines 12-14 (the only alert with a deadline).
- **import_complete** — [IMPORT-DONE], lines 16-19 + `notes/import-completion-service.ts:12` (a
  response to what the rep just did).

## Every emitter (the 7 `NotificationType` values — the set is type-bounded, so this is exhaustive)

| # | Emitter (file:line) | Trigger | Type | Classification |
|---|---|---|---|---|
| A | `scan-service.ts:96-104` overduePromises | daily-scan cron (3h) + POST /scan | `overdue_promise` | **AMBIGUOUS — ruling** |
| B | `scan-service.ts:126-136` nudges | meeting-nudges cron (60s) | `pre_meeting_nudge` | TIME-CRITICAL (already exempt) |
| C | `scan-service.ts:145-153` goingCold | daily-scan + /scan | `going_cold` | DISCRETIONARY |
| D | `scan-service.ts:165-173` dateReminders | daily-scan + /scan | `date_reminder` | **AMBIGUOUS — ruling** |
| E | `scan-service.ts:193-201` chatRefreshNudges | daily-scan + /scan | `chat_refresh` | DISCRETIONARY |
| F | `notes/import-completion-service.ts:62-66` | notes-sweep terminal hook | `import_complete` | TIME-CRITICAL (already exempt) |
| G | `monday/monday-service.ts:120-132` notifyMonday | monday-digest cron (weekly, rep-local Mon) | `monday_digest` | DISCRETIONARY — **overlaps the new daily digest, ruling** |

Emitters that never push (surface only): inventory matching (`inventory/matching-service.ts` → Today
register + Monday digest), book-scan (read-only report). Nothing else emits.

## Daily priorities surface — precomputed nightly, cached (confirmed)

- Builder: `HeroService.today()` (`hero-service.ts:158-209`) → deterministic `TodayAction[]`
  (kinds promise|meeting|cold|risk|match), then ONE grounded model reorder in
  `PrioritiesService.compute` (`priorities-service.ts:103-131`).
- **Cached, keyed `(userId, localDay)`** in `PrioritiesRepository`. `getForToday`
  (`priorities-service.ts:61-68`) serves the cached row with zero model calls; computes only on a
  cache miss. Nightly warm via the `priorities-nightly` cron (hourly, idempotent per rep-day).
- **The digest can read the cached row directly** (`repo.get(userId, day)`) without triggering a
  recompute — I must read the cache, never call `compute`/`getForToday`-that-computes for the digest.

## Import path — one push only

The import route (`notes-routes.ts`) emits **no** push (returns 202). Background extraction settles
via the notes-sweep and fires exactly one exempt `import_complete` (F). **BUT** facts extracted from
an import are later picked up by the daily-scan and pushed as ordinary capped alerts (A/C/D/E) — so
today an import *indirectly* causes discretionary pushes on the next scan. Under this rework those
become digest-only, which is the mechanism that makes "imports never push [findings]" hold.

## Push mechanics

`createIfAbsent` (record, idempotent by dedupeKey) is separate from `PushSender.send` (device push,
Web Push/VAPID — `adapters/push/webpush-sender.ts`). `dispatch` always records first, then sends to
`subs.listByUser` devices; no devices → recorded but not pushed.

---

## STOPPING — emitters that need a ruling, not a guess (per the batch)

1. **`overdue_promise` (A).** The push emitter fires for *every* promise strictly before today
   (`dueDate < todayIso`, up to the 90-day stale cutoff). There is **no "due today" push at all** —
   the batch's time-critical example "promises due today" has no emitter. The batch's own list puts
   "overdue-beyond-today" under DISCRETIONARY. So: **(a)** is `overdue_promise` discretionary
   (→ digest, no individual push)? **(b)** do you want a NEW time-critical "promise due today"
   emitter built (new scope, currently absent)?

2. **`date_reminder` (D).** Fires for a key date (birthday/anniversary/deadline) within
   `reminderWindowDays`. It is dated and imminent (reads time-critical) but is currently on the
   discretionary capped path. Time-critical (push uncapped) or discretionary (→ digest)?

3. **`monday_digest` (G).** A weekly digest push that overlaps the new **daily** digest — and it
   currently pushes even on a "clear week" (`isLight` → "A clear week — nothing due"), i.e. an empty
   digest, which this rework explicitly forbids. Does the new daily digest **replace** monday_digest,
   **coexist** with it, or is monday_digest **removed**?

Everything else is unambiguous: B/F stay time-critical (exempt); C/E are discretionary (→ digest).
I will not code Task 2 until these three are ruled.
