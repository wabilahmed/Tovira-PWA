# BATCH B — concurrent two-account leak test (PRODUCTION)

**Goal:** prove that two accounts running extractions *simultaneously* against the deployed
environment cannot see each other's data — targeting the concurrency-only leak classes a
sequential IDOR sweep (`a5-money-isolation`) can't reach: connection-pool bleed, cached
request/response context, shared in-process structures, advisory-lock cross-job collisions,
and a shared embedding / vector index.

- **Target:** `https://dyxluteuo1xg6.cloudfront.net` (API `/api/*`), `env=production`,
  build `610ce87` (the shipped backlog). Approved for prod because the leak classes named above
  behave differently across ECS instances than within one process.
- **Runner:** `tests/staging/concurrent-leak-run.ts` (standalone tsx — deliberately NOT part of
  `npm run test:staging`, which is single-worker and never races two identities).
- **Local detector proof:** `apps/api/src/http/concurrent-leak-detection.test.ts`.
- **Result:** **13 / 13 surfaces CLEAN · 0 leaked · 0 ambiguous.** Both accounts torn down;
  both logins now 401.

---

## Task 2 — seed (recorded baseline)

Two synthetic accounts created via the public `POST /api/auth/signup` (no ops token, no DB,
no email). Every id/name/email/client is synthetic and marked `zztest`/`ZZTEST-LEAK`.

| | Account A | Account B |
|---|---|---|
| email | `qa+zztest-leaktest-alpha-<run>@qa.tovira.io` | `qa+zztest-leaktest-bravo-<run>@qa.tovira.io` |
| client | `ZZTEST-LEAK Marina Heights` | `ZZTEST-LEAK Marina Gardens` |
| **shared counterparty** | **Kai Sterling** — *has AED 9,000,000 in cash* | **Kai Sterling** — *needs a strictly shellfish-free venue* |
| sentinel (must never cross) | `SENTINEL-ALPHA-A7` | `SENTINEL-BRAVO-B3` |
| secret tokens scanned for | `SENTINEL-ALPHA-A7`, `9,000,000`, `Marina Heights` | `SENTINEL-BRAVO-B3`, `shellfish-free`, `Marina Gardens` |
| inventory | 2-bed @ Marina Heights, `AED 2.1M` | 2-bed @ Marina Gardens, `AED 3.4M` |

The two accounts share the counterparty **name** "Kai Sterling" with **different facts** — the
collision that would expose any name-based (rather than tenant-based) attribution or a merged
vector index. Credentials are written to a state file the instant each account exists, so a
crash can never orphan an account.

## Task 3 — concurrent extraction (12 rounds + shared-counterparty round + Round S)

Each round pastes a fresh, sentinel-bearing note to **both** accounts, then fires
`Promise.all([A /extract, B /extract])` so two tenants' extractions are **in-flight at the same
instant**. Note shapes varied across rounds (promise, budget, code-switched Arabic/English,
vague-date, shared-counterparty).

- **12/12 rounds** completed. **Round 6** forced BOTH accounts to extract a *Kai Sterling* note
  simultaneously (A: "AED 9,000,000 in cash"; B: "shellfish-free venue").
- **Round S (scheduled-job overlap):** both accounts pasted sentinel notes **without** calling
  `/extract` — leaving them for the **15-second background `notes-sweep`** (a real ScheduledBrain
  job on a global advisory lock) — while `POST /scan` and `GET /monday-digest` ran concurrently
  for both tenants. The sweep advanced B's note to `extracted` inside the window (proving the
  scheduled job ran during concurrent activity); A's lagged `pending_extraction` at the 90s poll
  deadline (sweep is idempotent and catches it on a later tick — not a correctness issue).

**What the concurrent run revealed that the sequential suite did not:** under two stacked heavy
extractions in-flight, **2 of 24** synchronous `/extract` calls returned **504** (gateway
timeout) — the synchronous extract path can exceed the CloudFront/ALB timeout when two run at
once; those notes fall back to the background sweep. This is a **latency/robustness** observation,
**not** a leak (all downstream surfaces stayed clean), but it is invisible to the single-threaded
staging suite, which never stacks two extractions.

## Task 4 — per-surface leakage verification

For each account, every surface's full response was scanned for the **other** account's secret
tokens. `AMBIGUOUS` is never rounded to `CLEAN`.

| # | Surface | Verdict | Note |
|---|---|---|---|
| 1 | facts (own notes / extracted) | ✅ CLEAN | each account sees only its own sentinel & facts |
| 2 | brief (recentContext / openPromises) | ✅ CLEAN | own-client context only |
| 3 | promises (global list) | ✅ CLEAN | own promises only |
| 4 | recall / Ask (answer + receipts) | ✅ CLEAN | neither answer surfaced the other's secret; **all receipts belonged to the asking account** (A=5, B=5 receipts) |
| 5 | embedding / vector via recall | ✅ CLEAN | embedder is **live in prod** (5 receipts each) → this is a real check, not stubbed/ambiguous; only own-account notes retrieved |
| 6 | today (daily list) | ✅ CLEAN | scoped to own account |
| 7 | monday / daily digest | ✅ CLEAN | counts & content scoped to own account |
| 8 | scan (outcomes / counts) | ✅ CLEAN | no foreign content in either scan body |
| 9 | ledger / outcomes history | ✅ CLEAN | scoped to own account |
| 10 | inventory list | ✅ CLEAN | each rep lists only own items |
| 11 | inventory matching (vector index) | ✅ CLEAN | matching returned suggestions (live, not empty) → real check; each rep matched only against own inventory |
| 12 | shared-counterparty separation | ✅ CLEAN | both keep their own "Kai Sterling" facts (A=cash, B=venue) despite the identical name, **including the simultaneous shared-counterparty round** |
| 13 | book-scan (aggregate) | ✅ CLEAN | aggregate reads scoped to own account |

Both the recall vector index (surface 5) and inventory matching (surface 11) returned **real
data** in prod, so they are genuine `CLEAN` verdicts, not the `AMBIGUOUS` fallback the runner
would record against a stubbed embedder.

## Task 5 — proof the detector can detect a leak (mutation, local)

An all-clean prod result is only trustworthy if the detector is *proven able to fire*. The local
mirror (`concurrent-leak-detection.test.ts`) runs two accounts' extractions concurrently against
the in-memory server and asserts no cross-tenant leak on three surfaces, each backed by a
**distinct tenant-scoping filter**. Tenant scoping was deleted on each in turn (in the **test
suite**, never prod), the test was run, and the matching assertion went **RED**; each was then
reverted (confirmed clean via `git diff`).

| Mutation | File / filter broken | Result |
|---|---|---|
| 1 — recall | `in-memory-note-repository.ts` `searchSimilarByUser` (`n.userId === userId`) | ⛔ RED — `recall(A) leaked B` and `recall(B) leaked A` |
| 2 — promises | `in-memory-facts-repository.ts` `listPromisesByUser` (`p.userId === userId`) | ⛔ RED — `promises(A) leaked B` and `promises(B) leaked A` |
| 3 — inventory | `in-memory-inventory-repository.ts` `listByUser` (`r.userId === userId`) | ⛔ RED — `inventory(A) leaked B` and `inventory(B) leaked A` |

All three reverted; suite green afterward. The test also asserts each account's OWN sentinel
**is** present on all three surfaces, so it cannot pass trivially by finding nothing anywhere.

## Task 6 — cleanup & spend

- **Teardown:** `DELETE /account` ×2 → **2 deleted, 0 failed**. Re-login for both accounts →
  **401** (accounts + data gone).
- **Spend (estimate):** ~28 extraction calls (2 baseline + 24 concurrent + 2 Round-S sweeps) plus
  recall/scan/digest reads. Estimated **~AED 10–20**, well under the AED 100 stop. Exact spend is
  **not readable** post-teardown without the ops token / `spend_ledger` (the accounts are deleted);
  `/ledger` reports recovered-value, not cost.

---

## Limitations (honest scope)

- **No ops token.** The rich `/health` body — including `jobs[]` (`daily-scan`, `daily-digest`
  `lastRunAt`/`ok`) — is ops-token-gated (public `/health` returns only `{status}`). So I could
  **not** read the scheduled-job health telemetry in prod, nor force the real `daily-scan` (3h) /
  `daily-digest` (1h) cron ticks to fire inside the ~few-minute window. Round S therefore drove
  the **per-tenant** scan/digest business logic (`/scan`, `/monday-digest`) concurrently and used
  the **15-second `notes-sweep`** as the genuinely-overlapping scheduled job (observed end-to-end
  by a note advancing to `extracted` on its own). The `daily-scan`/`daily-digest` advisory-lock
  **cross-job collision** itself was already fixed and is guarded by a unit test
  (`wiring-guard.test.ts`, commit `5da92e0`) — this batch did not re-verify it live.
- The runner records `AMBIGUOUS` (never `CLEAN`) if the embedder or matching returned empty; in
  this prod run both returned real data, so neither fell back.

## Security note (belongs on the backlog — NOT this batch's problem)

`POST /api/auth/signup` is **open**: no invite / waitlist / allowlist gate, it returns a session
token immediately, and **email verification is not required to extract**. A fresh, unverified
trial account created clients, notes, and ran real extractions (spending Bedrock credits)
throughout this test. **Trial farming is trivially exploitable in production** — anyone can
script unlimited synthetic accounts and burn extraction spend. The per-rep AED 45 cap bounds one
account, not N scripted ones. This belongs back on the security list (gate signup:
invite / email-verify-before-extract / captcha / per-IP rate limit). Saved to memory as
`signup-trial-farming-security`.
