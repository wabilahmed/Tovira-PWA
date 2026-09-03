# NUDGE-AUDIT — the pre-meeting nudge chain, as it is today (before any fix)

`test(NUDGE-AUDIT)` — Task A1. Traces **extraction → confirmation → calendar → nudge
computation → delivery** against the real code, with evidence. No code changed in this task;
this is the "as-was" the rest of Part A is measured against. Two load-bearing gaps make a
2-hour-ahead nudge **not achievable today**, and they are independent of each other.

## The chain, end to end

```
note ──extract──▶ meeting PROPOSAL (JSON, confirmed:false)   ✗ never persisted
                                                              │  (gap 2: source)
rep ──meetings route──▶ meetings row (confirmed:true, nudged_at NULL)
                                                              │
scan.nudges ──dueForNudge(confirmed=true, nudged_at IS NULL, start∈[now, now+24h])──▶ pre_meeting_nudge
        ▲                                                     │
        │ only trigger: POST /scan                            │
        │ 07:00 EventBridge Lambda = STUB (no-op)   ✗ gap 1: trigger
        │ in-process ScheduledBrain does NOT run scan
                                                              ▼
PushDispatchService ── rank(pre_meeting_nudge=2) ── cap 2/UTC-day ──▶ ≤2 pushed, rest in-app
```

## The five questions, answered with evidence

### 1. On what schedule does the pre-meeting nudge currently compute?
**On no schedule in production.** The generator is real — `scan-service.ts:96` `nudges()` emits
`type: 'pre_meeting_nudge'`, `dedupeKey: nudge:<id>` — but its **only** trigger is `POST /scan`
(`proactive-routes.ts:61` `deps.scan.runAll(...)`). The two things that could call it don't:
- The **daily 07:00 EventBridge rule** (`infra/terraform/scheduler.tf:68` `cron(0 7 * * ? *)`) targets a
  Lambda whose body is a **stub**: `export const handler = async () => ({ ok: true })` (`scheduler.tf:25`).
  It never calls the API. `index.ts:152` documents this: "the EventBridge→Lambda path is a stub … the
  sweep, nightly priorities and trial emails silently never ran in prod."
- The **in-process `ScheduledBrain`** (30s tick, advisory-locked) runs only `notes-sweep` (15s),
  `priorities-nightly` (24h) and `trial-emails` (24h) — `index.ts:163-171`. **Scan is not one of its jobs.**

And even if triggered, the lead window is **`NUDGE_LEAD_HOURS = 24`** (`config.ts:158`,
`scan-service.ts:97-98` window `[now, now+leadMs]`). **Finding: a 2-hour-ahead nudge is structurally
impossible today** — nothing fires the scan on a sub-daily cadence, and the window is a day wide, not
two hours. This is exactly the daily-scan limitation the batch predicted.

### 2. Is an extraction-created meeting ever nudged if the rep never confirms it?
**No — and it is worse than the confirmation gap: extraction-created meetings are never persisted at
all.** Extraction *computes* a `meeting` proposal with a `confirmed` boolean (`prompt.ts:116`
`confirmed:false` for proposed, `:194` `true` for "locked in"; `validate.ts:52` requires the boolean),
but **nothing writes that proposal to the `meetings` table** — a repo-wide search for a consumer of
`extracted.meeting` / a `meetings.create` from extraction found none. The only writer is the meetings
route (`meetings-routes.ts:75`), which **hardcodes `confirmed:true`** (`:80`). `dueForNudge` requires
`confirmed = true AND nudged_at IS NULL` (`pg-meeting-repository.ts:74`). So the chain breaks at
**persistence**, one step before confirmation: a proposed meeting isn't an unconfirmed row waiting to be
confirmed — it isn't a row at all. (A6/A7 territory.)

### 3. Is a timezone stored per rep? If not, what clock do nudges use?
**No timezone is stored.** The `users` table is `id, email, password_hash, created_at`
(`0002_auth.sql:4-9`); a search across all migrations for `timezone|time_zone|tz|iana` returns zero.
**Every clock runs on UTC / server time:**
| Surface | Clock | Evidence |
|---|---|---|
| (a) pre-meeting nudge timing | UTC | `scan-service.ts:97-98` ISO strings off `Date.now()`; window is a raw ms offset |
| (b) Monday Statement "Monday" | UTC | `monday-service.ts:30` `Date.UTC(...)`, `getUTCDay()` |
| (c) daily priorities precompute | UTC | `priorities-service.ts:31` `toISOString().slice(0,10)` |
| (d) going-cold day counts | UTC | `scan-service.ts:116` `nowMs - days*DAY_MS`, `Date.now()`; `startOfDayUtc` at `:29` |

For the launch ICP (Dubai, UTC+4) every day boundary and "Monday" rolls at **04:00 local**. The four
clocks at least agree with each other (all UTC). **A3 fixes the nudge path; (b)(c)(d) are reported as
findings, not silently changed** (per A3's instruction).

### 4. Does the nudge carry the brief, or only "you have a meeting"?
**Only the bare alert.** `scan-service.ts:106-107`: `title: 'Upcoming meeting'`,
`body: 'Meeting soon — <datetimeRaw>'`. No client name, no open promise, no unanswered question, no
cooling signal, no deep link to the brief. This is precisely the "worthless — the rep knows" alert A4
replaces with the single most actionable item + tap-through.

### 5. How do multiple meetings in one day interact with the 2/day budget?
**They compete for it and lose.** Every `pre_meeting_nudge` goes through `PushDispatchService`
(`push-dispatch-service.ts`): `DAILY_PUSH_CAP = 2` (`:14`), ranked `pre_meeting_nudge = 2` — **below**
`overdue_promise (0)` and `going_cold (1)` (`:17-24`). `remaining = cap − countSent(user, UTC-day)`
(`:74`), day boundary `toISOString().slice(0,10)` UTC (`:41`). So today: **three meetings ≠ three
nudges** — at most two push, and an overdue promise or a cold-client alert **outranks** a meeting and
can consume the budget first, leaving the time-critical nudge suppressed to in-app. A5 inverts the rank
(meeting highest) and exempts meeting nudges from the cap.

## What already works (do not rebuild)
- The **generator** (`scan.nudges`) is correct: it selects due, unnudged, confirmed meetings and emits a
  ranked alert.
- **Idempotency-by-row already exists**: `nudged_at timestamptz` on the meeting (`0011_meetings.sql:10`),
  set by `markNudged` (`pg-meeting-repository.ts:83`), filtered by `dueForNudge`. A2's "nudge at most once,
  store on the row not in memory" is *already the shape* — it needs moving onto a frequent trigger and a
  2h±15m window, not inventing.
- The **in-process brain seam** (30s tick + per-job advisory lock + `scheduled_job_runs` + `/health`
  surfacing) is exactly where A2 adds `meeting-nudges` — no new infra.
- A **direct-creation API already exists**: `POST /clients/:id/meetings` and `POST /meetings` take a
  structured `{clientId, datetime, datetimeRaw, title}` and save `confirmed:true` with no NL parse
  (`meetings-routes.ts:56-85`). What's missing (A7) is a **web form** — the UI funnels every creation
  through the NL parse box (`Meetings.tsx`); there is no no-parse client-picker+date+time form component.

## The two gaps, stated plainly
1. **Trigger gap** — the nudge generator has no production scheduler: the 07:00 Lambda is a no-op stub
   and the frequent brain doesn't run scan. (A2)
2. **Source gap** — extraction proposes meetings but never persists them; only the meetings route creates
   rows, always `confirmed:true`. Unconfirmed/proposed meetings don't exist to be nudged. (A6/A7)

Plus: **no per-rep timezone** (A3), **nudge carries no substance** (A4), and **the rank/budget actively
suppress** time-critical meeting nudges (A5).
