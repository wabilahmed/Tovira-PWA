# WIRING-REPORT — the emitter sweep (Part B)

`docs(WIRING-REPORT)`. B1 enumerated every production emitter and asked one question of each — **is
it reachable when the app runs, not merely covered by a test?** B2 made the answer self-enforcing.
Suite 1225 green, typecheck + lint clean.

## The full emitter table

### Notification types + push
| Emitter | Production trigger | Verdict |
|---|---|---|
| `pre_meeting_nudge` | `meeting-nudges` brain job → `scan.nudges` (60s) | WIRED |
| `monday_digest` | `monday-digest` brain job → `monday.runScheduled` → `notifyMonday` | WIRED (was test-only until last batch) |
| `overdue_promise` | **`daily-scan` brain job → `scan.runAll` (was UNWIRED — see below)** | WIRED (fixed this batch) |
| `going_cold` | same | WIRED (fixed) |
| `date_reminder` | same | WIRED (fixed) |
| `chat_refresh` | same | WIRED (fixed) |
| push send + SW push/notificationclick | `pushDispatch.dispatch` → `webpush-sender`; `sw.ts` | WIRED |

### Scheduled jobs (`index.ts` jobs array)
`notes-sweep`, `priorities-nightly`, `trial-emails`, `meeting-nudges`, `monday-digest`, `daily-scan` —
all registered, each `run()` calling a real service. **WIRED.** The 07:00 EventBridge Lambda
(`infra/terraform/scheduler.tf`) is a no-op stub and is **not relied upon** — the in-process
`ScheduledBrain` carries every job.

### Side-effect emitters
| Emitter | Production trigger | Verdict |
|---|---|---|
| Emails: password-reset, verification, welcome, trial-ending/ended, payment-failed, subscription-confirmed/canceled, account-deleted | auth-routes / trial-emails job / billing webhook / account-delete callback | WIRED (all 8) |
| Ledger `thread_reopened` / `promise_kept` / `brief_before_meeting` | notes-routes / facts-routes / brief-routes | WIRED |
| Ledger `inventory_suggested_bought` | gated on `outcome_set_by='confirmed_suggestion'`, which no production path sets until Batch 2 | **DORMANT** (documented) |
| Training-log write | `extraction.extractNote` via extract route / notes-sweep / ask-capture | WIRED |
| `modelMetrics.record` / `recallMetrics.record` | MeteredModelClient wraps every model call / `recall.ask` | WIRED |
| Confirmation queue: low-conf promises, unconfirmed meetings, ask-capture pending | GET /confirmations | WIRED |
| `/health` jobs + cache + recall | server /health | WIRED |

## The finding — the 6th instance (now fixed)
**The daily proactive scan never fired on its own.** `scan.runAll` — the producer of
`overdue_promise`, `going_cold`, `date_reminder`, `chat_refresh` — was reachable in production from
exactly one place: the manual **"Rescan"** button (`POST /scan`). Its intended automated trigger was
the 07:00 EventBridge Lambda, which is the same no-op stub that hid the notes-sweep gap, and **no
`ScheduledBrain` job called `scan.runAll`**. So four of the six notification types only existed if a
rep tapped Rescan by hand — the proactive product, not firing proactively.

Fixed in `fix(SCAN-WIRING)`: a `daily-scan` brain job (peer of `meeting-nudges`/`monday-digest`, every
3h) via a testable `ScanRunnerService`, idempotent (dedupe keys) and bounded by the 2/day silence
budget.

**The honest summary these six findings add up to:** combined with the Monday digest and the meeting
nudges — both also unwired until this week — **essentially the entire proactive layer had been
manual-only.** Nothing pushed, nudged, or digested on its own; every proactive output waited for a rep
to tap a button or open a screen. That reframes what "the proactive layer works" meant in every prior
status report: the logic worked, the *automation* did not. As of this week it actually runs.
(Deployed without a flag: there are no production reps yet, so there is no one to surprise, and a flag
would be debt guarding an empty population.)

## The guard (B2) — coverage + allow-list
`wiring-guard.test.ts` makes the audit self-enforcing at zero model cost:
- **Completeness by type.** `Record<NotificationType, …>` and `Record<LedgerEventType, …>` — omitting
  an emitter is a **compile error**. You cannot add a notification/ledger type without making a wiring
  decision.
- **Trigger presence.** Each wired entry names a production-call substring (`scanRunner.run(`,
  `meetingNudge.run(`, `monday.runScheduled(`, the `type:'…'` ledger writers) asserted present in
  non-test source — **delete the trigger and the build fails.** These substrings occur only at their
  trigger site, so the check has teeth.
- **Job registration.** Every expected ScheduledBrain job name is asserted registered in `index.ts`.
- **Allow-list.** Exactly one entry, with a reason: `inventory_suggested_bought` (Batch 2 dormant).
  The test caps the allow-list size, so any growth is a deliberate, reviewed decision — visible, never
  silent.

## Why this class kept recurring (the durable answer)
It is one **testing-boundary problem**, the same root as the timezone batch. Every one of these units
was unit-tested in isolation and correct in isolation. The failure lived in the **wiring** — a
separate line (a job registration in `index.ts`, a route calling a service, a Lambda body) that **no
test exercised**, because the suite runs in-memory adapters and fake triggers, never the deployed
trigger path.

The specific accelerant was the **stub EventBridge Lambda**: multiple features were built on the
premise "the scheduler triggers X for every rep", but the scheduler was a placeholder returning
`{ ok: true }`. So anything depending on it (the sweep, the daily scan) silently never ran — and a
not-running job is indistinguishable from a job with nothing to do, so nothing surfaced it. Five
instances (dark metrics, the scheduler, the import-date reference, meetings-never-persisted,
notifyMonday) were the same shape; the daily scan was the sixth, found by the sweep rather than by
accident.

**The two countermeasures now in place:** (1) this guard, which fails the build the moment an emitter
is added without wiring; (2) the real-Postgres integration suite (`test/integration`), which should
grow to exercise the deployed trigger paths — a scheduled tick actually producing an alert, an
extraction actually persisting — so "tested" and "runs in production" stop being conflated. Until a
seam has a real-path test or a guard entry, its green unit tests mean "correct if it runs", not "it
runs".
