# TZ-REPORT — the timezone correctness batch (Task B4)

`docs(TZ-REPORT)`. Full audit in `TZ-AUDIT.md`; this is the fix report. Suite **1216 green**,
typecheck + lint clean. No extraction-prompt change, no gate run.

## The audit outcome (B1) — narrower AND wider than the batch premised
| Group | Items |
|---|---|
| **REP-TZ-AWARE already (A3)** | meeting parse/resolve, meeting datetime, nudge today/tomorrow labels |
| **FIXED now (B2/B3)** | Monday week boundary + this-week window; priorities daily cache + refreshes-left-today; date/key-date reminders; push silence-budget day; verify-resend daily limit; **B3** priorities-nightly + Monday-digest scheduling |
| **Deliberately UTC (fine)** | **going-cold** (all sites), chat-refresh staleness, trial start/end/+7/+30, recall 30-min idle, pending-note 14-day TTL, UI `daysSince`, corpus span, account-email stamp — every one a pure duration/instant |
| **DEFERRED (own tested pass)** | overdue-promise "before today" (feeds the **ledger** promise-kept value); extraction reference "today" fresh-capture (the **P1-9-certified** relative-date path) |

## Worse than expected (the audit's surprises)
1. **Going-cold was never a timezone bug.** The batch named it as one of the three fixes; it is
   `nowMs − lastTouchedAt` elapsed ms — a duration, identical on any clock. Skipped deliberately.
2. **The Monday digest push was never wired.** `notifyMonday` was only ever called from tests — a
   built-but-inert push (the same pattern this project keeps hitting). The boundary fix (B2) plus the
   new scheduled job (B3) are what make it *actually fire*, correctly, per rep. **This means reps
   begin receiving a weekly Monday push they were not getting before** — flagged as a behavior change,
   not just a tz fix.
3. **The real day-boundary set was larger than three.** Beyond Monday + priorities, the audit found
   date reminders, overdue-promise, extraction-today, push-budget, and verify-resend — the "safe"
   three fixed here, the two sensitive ones deferred.

## Scheduling approach (B3) and why
**Chosen: run frequently and process each rep when their boundary passes** — not bucket-by-offset.
- *Why:* idempotency is already provable per rep-day without a bucketing scheme, and "frequent +
  skip-if-done" is simpler and restart-safe. Bucketing reps by UTC offset would need a registry kept
  in sync with tz edits and DST, for no gain.
- **Priorities precompute: 24h → hourly.** With the cache keyed on the rep's `(userId, localDay)`,
  the first hourly tick after the rep's local midnight computes their list; every later tick that day
  skips (the row exists). So each rep is warm for their morning regardless of timezone.
- **Monday digest: a new hourly job**, firing each rep's digest on their local Monday **morning**
  (≥ 08:00 local — never 04:00 or 00:00), deduped per rep-local-week.

## Idempotency is per rep-day / rep-week (provable)
- **Priorities:** the `(userId, localDay)` priorities-cache row **is** the per-rep-day record — its
  existence is the proof the job ran for that rep-day; `precompute` is a no-op when it exists. A
  restart or overlapping tick cannot double-compute.
- **Monday digest:** the `monday:<weekOf>` notification dedupe key gives exactly one digest per
  rep-local-week — restart-safe, and a tz change within the same local week yields the same `weekOf`,
  so no second digest (tested).
- `scheduled_job_runs` records each job's global tick (liveness, in `/health`); the **per-rep-day
  idempotency lives in the cache row / dedupe key**, which is the right place for it — a per-rep-day
  row in `scheduled_job_runs` would duplicate what the cache already guarantees.

## The fallback for reps with no timezone (B2 decision)
Migration 0042 added `timezone text NOT NULL DEFAULT 'Asia/Dubai'`, so **every account created before
the A3 deploy was backfilled to `Asia/Dubai`** by the column default, and any post-deploy signup whose
browser reported no zone also lands there. The fix treats these as `Asia/Dubai` (the launch ICP) — a
deliberate, safe default, never silent UTC. In the data they are indistinguishable from reps genuinely
in Dubai (all read `Asia/Dubai`).

**Count (pending a DB run — I have only localhost creds here, not staging/prod):**
```sql
SELECT count(*) AS total,
       count(*) FILTER (WHERE timezone = 'Asia/Dubai') AS on_dubai_default,
       count(*) FILTER (WHERE timezone <> 'Asia/Dubai') AS explicit_other
FROM users;
```
`on_dubai_default` is the upper bound on accounts affected by the fallback (it includes genuine Dubai
reps). Given the launch ICP is Dubai, the fallback is expected to be correct for nearly all of them.

## The deferred overdue-promise fix — reclassification count to run FIRST (owner requirement)
Before switching overdue-promise / promise-kept to rep-local, measure how many existing promises the
boundary shift would flip between **kept-on-time** and **late** — that number decides whether the fix
is worth the churn (it changes a ledger value we report honestly). Query to run against staging/prod:
```sql
-- Promises whose "kept on time" verdict differs between UTC-today and the rep's local today, right now.
-- (done, dated promises; compares dueDate against each clock's current calendar date.)
WITH t AS (
  SELECT p.id, p.due_date,
         (now() AT TIME ZONE 'UTC')::date                       AS utc_today,
         (now() AT TIME ZONE u.timezone)::date                  AS local_today
  FROM promises p JOIN users u ON u.id = p.user_id
  WHERE p.due_date IS NOT NULL AND p.done = true
)
SELECT count(*) FILTER (WHERE (utc_today <= due_date) <> (local_today <= due_date)) AS would_flip,
       count(*) AS dated_done_promises
FROM t;
```
I could not run this locally (no staging DB creds in the env available here). Expectation: on a
Dubai-heavy book the local date is usually one day ahead of UTC only in the UTC evening, so the flip
count is bounded by promises whose due date equals the rep's boundary day — likely small, but the
number is the point. **Run this before opening the deferred fix; if `would_flip` is negligible, the
churn may not be worth it.**

## Not fixed here, on purpose
The two deferred surfaces (overdue-promise, extraction-today) stay UTC until their own carefully-tested
pass — one touches the ledger, the other the certified extractor. Both deserve fixture work, not a
ride-along.
