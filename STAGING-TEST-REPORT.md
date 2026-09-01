# Staging Test Report — Part A (functional harness)

**Target:** `https://staging.tovira.io` (eu-north-1, prod-representative)
**Date:** 2026-09-01
**Scope:** Black-box, against live staging. Namespaced QA identities (`qa+<runId>-…`),
everything torn down. Stripe test-mode. No real mail. Two-part plan: **Part A**
(functional, FLOWS 1–27 + P5) → **Part B** (extreme extraction) — this report covers
Part A and the fix batch it drove.

## Executive summary

- **Part A: 48/48 test cases green.** Structured coverage: **53 PASS · 3 PARTIAL · 2
  UNREACHABLE · 0 FAIL.** The PARTIAL/UNREACHABLE items are rail limits (cost budget,
  email-only token delivery), not defects — detailed below.
- **No stop-the-line condition tripped.** The cross-tenant isolation sweep passes on
  every id-addressable resource, and no refusal-set fabrication was observed.
- The first Part A pass found **5 findings**; fixing them and re-running Part A surfaced
  **2 more** (both now fixed). **All 7 are closed and verified live.**
- Everything is deployed and verified on staging: `/health` reports every adapter
  `live` and the scheduled brain running (`notes-sweep` age ≈ 20s).

## Findings (all closed)

| # | ID | Severity | Status | Verified by |
|---|----|----------|--------|-------------|
| 1 | IDOR-DEAL-VALUE | **Critical (cross-tenant)** | Closed | `ISOLATION` PASS |
| 2 | IMPORT-ASYNC | High (gateway 504) | Closed | `FLOW 4` PASS |
| 3 | STAGING-EMBEDDER | High (recall broken) | Closed | `FLOW 12` PASS (verbatim receipt) + `/health` embedder=live |
| 4 | REFERRAL-500 | High | Closed | `P5-6` PASS (credits both parties) |
| 5 | MALFORMED-ID | Medium (500 → info) | Closed | `FLOW 14` malformed id → 400 |
| 6 | EMAIL-SEND-500 | **High (enumeration oracle)** | Closed | `FLOW 3b` PASS (identical 200) |
| 7 | SWEEP-NEVER-RUNS | **High (silent data loss)** | Closed | `/health` jobs alive + `FLOW 4` sweep-based |

### 1 — IDOR-DEAL-VALUE  *(stop-the-line: cross-tenant write)*
`POST /clients/:id/deal-value` as rep B against rep A's client returned 200 — a
cross-tenant write. **Root cause:** the handler set the deal value without an ownership
check, and the tenant tables lacked composite `(user_id, ref_id)` foreign keys, so a
cross-tenant id could be referenced. **Fix:** ownership guard in the handler + composite
FKs on all 11 tenant tables + an orphan cleanup that must run with `NO FORCE ROW LEVEL
SECURITY` (the non-superuser owner otherwise no-ops the cleanup DELETEs under FORCE RLS).
Commits `6422ac1`, `fff411b`, `02a543e`. **Verified:** the isolation sweep denies B on
every one of A's id-addressable resources.

### 2 — IMPORT-ASYNC
A multi-message chat import ran extraction inline behind the ~30s gateway and 504'd.
**Fix:** the import endpoint returns `202 pending_extraction` immediately; extraction is
deferred to the background sweep. Commit `dc6c04d`. **Verified:** import returns 202 in
~185ms; the note extracts in the background (see finding 7 — the sweep had to actually run).

### 3 — STAGING-EMBEDDER
Recall/semantic search 500'd: the embedder was stubbed, then, once switched to Bedrock,
`InvokeModel` was denied. **Root causes, in order:** (a) `assertDeployReady` had to refuse
a real-AI + stub-embedder config; (b) an unwrapped embed call made extraction 500 →
best-effort embedding (`3077164`); (c) `AccessDeniedException` on
`arn:aws:bedrock:eu-north-1::…titan-embed-text-v2` — the task called Bedrock in
`eu-north-1` while IAM allowed only `eu-central-1`, because the task def had a **duplicate
`BEDROCK_REGION`** (the later `var.region` won). The 403 also proved Stockholm now has
Bedrock + that model. **Fix:** de-dup to a single in-region `BEDROCK_REGION=eu-north-1`
and scope IAM to `arn:aws:bedrock:*::foundation-model/*` so a region drift can't silently
deny again. 512-dim embeddings (migration 0038). Commits `4710425`, `0b30819`, `d188131`.
**Verified:** on-topic recall returns a verbatim receipt; `/health` embedder=live.
*(Side benefit: embeddings now process in-region — client text stays in Stockholm.)*

### 4 — REFERRAL-500
A valid referral 500'd: `referrals` (migration 0023) never granted privileges to the
non-superuser app role, so the INSERT was permission-denied — but only for a *valid* code
(a garbage code bails first) and never in the in-memory tests. **Fix:** `GRANT … ON
referrals TO tovira_app` (0037) + isolate crediting so it can never break signup. Commit
`2f67852`. **Verified:** valid referral credits both parties (+30d); garbage credits
nobody and signup still 201.

### 5 — MALFORMED-ID
A non-UUID path id reached Postgres as `22P02` and surfaced as a 500. **Fix:** map `22P02`
centrally to a generic `400 bad_request` for every id-taking route at once. Commit
`e49915e`. **Verified:** malformed promise id → 400.

### 6 — EMAIL-SEND-500  *(new; account-enumeration oracle)*
`POST /auth/forgot-password` returned **500 for a known email** while an unknown one
returned 200 — an enumeration oracle — whenever the email provider failed (staging: Resend
out of quota). **Root cause:** the reset-email send was awaited unguarded. An audit for the
same shape found a sibling: `/auth/resend-verification` sent unguarded too. **Fix:** email
delivery is best-effort everywhere — the durable action (token created / verification
reissued) still succeeds, the send failure is logged, the endpoint always returns 200.
Commit `3238f14`. **Verified:** known and unknown reset requests return byte-identical 200.

### 7 — SWEEP-NEVER-RUNS  *(new; silent data loss, exposed by finding 2)*
The scheduled "brain" never ran in staging/prod: `notes-sweep`, `priorities-nightly`, and
`trial-emails` were registered on a `LocalScheduler` that only runs on `trigger()`, and
nothing triggered it — the EventBridge→Lambda path is still the placeholder Lambda
(`{ ok: true }`). So after finding 2 made import async, **imported notes were stranded in
`pending_extraction` and never extracted** (worse than the 504); nightly priorities and
trial emails also never ran. **Fix (Option 1 — no new infra):** an in-process timer on the
persistent task drives the jobs (sweep ~15s so deferred imports extract within ~a minute;
nightly/trial daily); a **Postgres session-scoped advisory lock** (`pg_try_advisory_lock`)
runs each job on exactly one task under autoscaling and releases automatically on crash;
every run is recorded in `scheduled_job_runs` (migration 0039) and surfaced in `/health`
so the brain's liveness is checkable, not assumed. Commits `c22d6ce`, `700c159`.
**Verified live:** `/health` shows `notes-sweep ok age≈20s`, `priorities-nightly ok`,
`trial-emails ok`; the async-import test now confirms extraction happens with no
synchronous `/extract` call.

## Pattern note — two findings of one shape

Findings 1 and 6 are the same defect class: **a route that missed a pattern its siblings
had.** IDOR was an ownership check missing on one endpoint; EMAIL-SEND-500 was a
send-failure wrap missing on one endpoint. Rather than discover these one test at a time,
two one-off audits are worth doing properly:

1. **Endpoints that take an id without an ownership/tenant check.** (Done reactively for
   deal-value; the composite FKs + the isolation sweep now backstop it, but a static sweep
   of every `:id` route would confirm none else is bare.)
2. **Callers that invoke the mailer without a best-effort wrap.** (Done for the two `/auth`
   routes; `push` and the lifecycle sends already had it.)

## Part A coverage detail

**PARTIAL (rail #6 — cost budget, or #2 — needs a device):**
- `FLOW 7` trial seeding ceiling — async import is accepted (202) and the ceiling now
  surfaces at extraction (`/extract → trial_limit`); exhausting the real 200-extraction
  ceiling is out of this run's model-cost budget.
- `FLOW 22` over-threshold hero — crossing the volume gate needs 5 clients × 20 notes (20
  extractions); out of budget. The under-threshold refusal is verified.
- `FLOW 18` silence budget (≤2 pushes) — needs aged/overdue data **and** a subscribed push
  device; verified via logs, not reproducible black-box.

**UNREACHABLE (rail #5 — token delivered only by email):**
- `FLOW 3c` expired/reused/cross-user verify token, and `FLOW 3b` reused reset token /
  all-sessions-dead-after-reset — the token is delivered only by email and is not
  retrievable via the API, so these paths can't be exercised black-box. Covered by unit
  tests server-side.

**No-enumeration evidence (FLOW 2):** wrong-vs-unknown login timing gap median 51ms
(n=20); status + body byte-identical.

## Follow-ups (not blocking; flagged, not silently actioned)

- **Resend quota (ops):** the provider was out of quota on staging, which is what exposed
  finding 6. Delivery now degrades safely; restoring quota is an ops task. Once restored,
  the hole would not have announced itself — the wrap is the durable fix.
- **EventBridge/Lambda scan scaffold is now redundant** for scheduling (the in-process
  brain replaces it). Left in place; removing that infra is a separate decision.
- **Budget-gated flows** (FLOW 7 / 22 / 18) can be promoted from PARTIAL to full PASS in a
  dedicated run with a raised model-cost budget.

## Part B — not yet run

Part B (extreme extraction, B1–B4) is pending. Per the plan there is a **hard stop after
B1** for the answer key to be certified before scoring the refusal set. Awaiting go-ahead.
