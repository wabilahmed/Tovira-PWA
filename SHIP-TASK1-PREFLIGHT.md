# Ship the backlog — Task 1 pre-flight (findings only, nothing pushed)

## ⛔ BLOCKER — fix before pushing: duplicate scheduled-job advisory-lock key

`index.ts` registers two jobs with the **same** `lockKey: 4711006`:
- `daily-digest` (line 324, hourly) — added in NOTIF-REWORK
- `daily-scan` (line 329, 3-hourly) — pre-existing

`ScheduledBrain` runs each job under `withLock(job.lockKey)` and the field's own contract is
"**unique per job so jobs don't block each other**" (`scheduled-brain.ts:6`). A shared key means the
two jobs contend for one Postgres advisory lock: whenever their ticks overlap (and across multiple
ECS tasks), one cannot acquire the lock and is skipped. **This is exactly the "deploy succeeded but a
job doesn't run" failure Task 3 warns about** — I introduced it in NOTIF-REWORK Task 3.

One-line fix: change `daily-digest` to an unused key (e.g. `4711007`). Recommend fixing before Task 2.
(Findings-only task — not edited yet; awaiting your go-ahead.)

## 1. The 29 commits, grouped by what they change

| Group | Commits | What ships |
|---|---|---|
| Probes (report-only, no prod behaviour) | `21b04e1`, `e14c659` | time-ambiguity + clean-date probe reports only |
| RECEIPTS v0.9.5 (persist + render receipts, gate scoring) | `1c537af`, `e94553a`, `cbf37d4`, `06a4442`, `a13a5f7`, `d8f9111` | persist source_span/source_message_at; render per-fact receipts; no-receipt marker; GATE_RECEIPTS scoring; docs |
| RECEIPTS capture-date | `d61336b`, `1e3eca6`, `1c61cbc`, `47ef6e9` | capture_at conversation date (migration 0065) + rendering fix; docs |
| NOTIF-REWORK | `183a3de`, `5b40ce3`, `c494e67`, `6cf2114`, `a7eee22`, `b763d74` | remove 2/day cap; daily-digest + cron; imports never push; grouped /today; docs |
| ERASURE | `0e7c00d`, `db1a187`, `5939812`, `2289fbf`, `8d95ea5`, `1f2499f` | erasure op + preview/commit/audit; window + rep notice; ops route (migration 0066); docs |
| ERASURE-ARCHIVE | `9e455a7`, `3eb8429`, `7aaa343`, `8a90e6c`, `997b8ac` | archive purge in the erasure flow + gate; docs |

## 2. Migrations that apply on boot (ascending), and what each does

`runMigrations` (index.ts:113, on ECS boot) applies every migration not yet recorded in prod's
migrations table, in ascending order. The batch states 0063–0066 are unapplied. **Note:** 0063 and
0064's files are already on `origin/main` (their commits were `[skip ci]`, so the files shipped but no
deploy ran); 0065 and 0066 are in the 29 unpushed. Either way, whichever of these are pending apply now:

| # | File | Does | Additive? |
|---|---|---|---|
| 0063 | `import_acknowledgements.sql` | new table `import_acknowledgements` (PK user_id, timestamp) + RLS | **Additive** (new table, IF NOT EXISTS) |
| 0064 | `fact_receipts.sql` | adds nullable `source_span text` + `source_message_at timestamptz` to promises/key_dates/meetings | **Additive** (nullable cols, no default, ADD COLUMN IF NOT EXISTS) |
| 0065 | `fact_capture_at.sql` | adds nullable `capture_at text` to promises/key_dates/meetings | **Additive** |
| 0066 | `erasure.sql` | new tables `erasure_requests` + `erasure_audit` + RLS + indexes | **Additive** (new tables) |

**None is non-additive** — no ALTER of existing column types, no DROP, no data transform, no NOT NULL
backfill. All use `IF NOT EXISTS`, so a partial prior application is safe.

## 3. Migration dependencies

- 0064 and 0065 `ALTER TABLE promises/key_dates/meetings` — those tables must pre-exist (they do, from
  earlier migrations). They touch **different columns**, so 0064↔0065 are independent (order irrelevant).
- 0063 and 0066 reference `users(id)` (pre-existing).
- **No 0063–0066 depends on another in this set.** They only depend on tables that already exist in prod.

## 4. What changes production behaviour on first boot (no further action)

- **Notification cap removed (NOTIF-REWORK):** immediately — discretionary alerts (going-cold, overdue,
  date reminders, chat-refresh) STOP pushing individually; time-critical (meeting nudges,
  `promise_due_today`, import-complete, digests, erasure notices) push uncapped. `monday_digest` no
  longer pushes (in-app only).
- **New `daily-digest` cron:** registered on boot, hourly, fires one digest at each rep's local 08:00.
  ⚠️ Blocked by the lockKey collision above — fix first or it (or daily-scan) may not run.
- **New `promise_due_today` push emitter** from the daily scan.
- **Grouped `/today`** now also returns `groups` (with `actions` retained) — additive response change.
- **Receipts:** new extractions persist `source_span`/`source_message_at`/`capture_at`; fact surfaces
  render receipts. (v0.9.5 prompt is already live — no model change here.)
- **Erasure `/ops/erasure/*` routes** become available but are **inert** — ops-token gated, no cron,
  nothing runs until an operator calls them. Migration 0066 just creates the (empty) tables.

## 5. CI extraction gate — will it actually run?

- The gate job (`ci.yml:28`) is **present and not commented out**, runs on main, `needs: verify`.
- **It self-activates:** it runs `npm run gate` ONLY if the `ANTHROPIC_API_KEY` repo secret is set;
  otherwise it prints "skipping the P1-9 gate" and **exits 0** (`ci.yml:48-52`).
- **Deploy chains on the CI workflow's overall success** (`deploy.yml` `workflow_run … conclusion ==
  'success'`). A self-skipped gate still makes CI succeed → **Deploy would proceed without the gate
  ever validating extraction.**
- **I cannot see repo secrets from the local checkout**, so I cannot confirm the gate will actually
  run. "Credits restored" (Anthropic account funded) is necessary but NOT sufficient — the key must be
  present in the repo's **GitHub Actions secrets** for the gate to run. **Please confirm
  `ANTHROPIC_API_KEY` is set in the repo secrets** before Task 2, or the "green gate" in Task 2 may be
  a skip, not a pass.

## Access limits that affect Tasks 3–4 (so you can plan the go-ahead)

Tasks 3–4 verify against **real** infrastructure. From this local environment I do **not** have:
- the prod **OPS_TOKEN** (needed for the rich `/api/health` body and the `/ops/erasure/*` route),
- prod **DATABASE_URL** (needed to query the migrations table + verify erasure against real Postgres),
- **object-storage** credentials (needed to read the archive NDJSON).

Publicly reachable checks I **can** do: `/api/version` (sha) and public `/api/health` (200). For the
rest I'll need you to supply the OPS_TOKEN (e.g. via a `!`-prefixed command so it lands in the session)
or run the DB/object-storage queries yourself and paste results. Flagging now so Task 3/4 don't stall.

## STOP — awaiting your review before any push

Nothing pushed, nothing deployed, nothing edited. Recommended order once you approve:
1. Fix the `daily-digest` lockKey collision (4711006 → 4711007) + confirm `ANTHROPIC_API_KEY` is in repo
   secrets.
2. Then Task 2 (push with an unmarked commit so CI runs the full gate).
