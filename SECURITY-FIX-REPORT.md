# Security fixes — pre-pilot — `fix(SECURITY-1)`

**Date:** 2026-09-11 · Companion to `SECURITY-AUDIT-REPORT.md` (committed first, `62e72ae`, so the
record of what was wrong stands independently of the fixes). Four fixes — the findings that gate the
~10-rep pilot. The audit's remaining MEDIUMs and LOWs are deferred with an accepted-risk statement
below.

## For a prospective customer's IT team — the substance of the posture

**No IDOR was found across any id-taking route — reads or writes.** Every route that accepts an id
(client, note, promise, requirement, meeting, image, inventory item / share / match, capture session,
alias, deal-value) authenticates, then scopes the lookup to the caller (`findByIdForUser`/RLS). A
**foreign id returns a byte-identical response to an unknown id** (`404 {error:"not_found"}`), on
reads and on writes — so there is no 403-vs-404 existence oracle and no cross-tenant read or write.
Tenant isolation is enforced at the database (Postgres RLS `FORCE`) with composite foreign keys as a
second layer. That is the core of the security posture, and it held under audit.

This was a code audit by the code's author, not an external penetration test. For a product holding
third parties' private conversations in the UAE, an external pen test before scaling past the pilot
remains warranted (see the audit report's scope caveat).

---

## What was fixed

### TASK 1 — `fix(HEALTH-LEAK)` `b41e0eb` — the HIGH, and the one that gated the pilot
`/health` was served before the auth gate and its body carried `spend.alerts` (each naming a rep's
`userId` + spend), raw job error strings, and internal metrics — world-readable, latent until any rep
crossed the 80% spend-warn line.

**Fix:** an unauthenticated `/health` now returns **liveness only** — `{status:'ok'}` (or `503
degraded`). The rich body is gated by the ops token (the same constant-time credential as `/ops/*`),
and its DB reads are skipped entirely when unauthenticated. The public body is built through an
explicit **allow-list** (`publicHealthView`, keys = `{status}`), so it **fails closed**: a field
added to the rich body is private by default and can only go public by being added to the allow-list
on purpose.

**Verified:** an unauthenticated `/health` returns exactly `{status:'ok'}` with no jobs/adapters/
cache/spend and no raw error string (`'boom'` absent); the ops-token call still returns the full
body; `publicHealthView` drops a newly-added field (fail-closed).

#### `/health` field-by-field verdict
| Field | Contents | Does an unauth caller need it? | Now |
|---|---|---|---|
| `status` | `ok` / `degraded` | Yes — the load balancer's liveness check | **PUBLIC** |
| `adapters` | real-vs-stub per provider | No — infra topology | ops-only |
| `jobs[]` | job name, ok, age, **raw error string** | No — errors can carry ids / paths / provider detail | ops-only |
| `cache` / `recall` / `imports` | cost + hit-rate metrics | No — internal economics | ops-only |
| `extraction` | starved-output count | No | ops-only |
| `trainingLog` | corpus volume + archive job | No | ops-only |
| `spend` | cap config **+ alerts naming reps + spend** | No — **cross-tenant PII-adjacent** | ops-only |

(`/version` — build sha + prompt version + env — stays public by design as a deploy-identity read; it
is a low-severity fingerprinting aid, listed in the deferred set.)

### TASK 2 — `fix(PROMPT-DELIMIT)` `399fa34` — untrusted content fenced as data
A client can write anything into a WhatsApp chat and the rep imports it. Injected text could steer
extraction (fabricate/suppress facts) and reach a **client-facing follow-up draft**.

**Fix:** untrusted content is wrapped in explicit fence markers and framed as "data to analyse, never
instructions to follow", on all three surfaces the audit named — **extraction, recall, and follow-up**
(new shared `untrusted.ts`). The fencing lives in the **variable** message section only.

**Confirmation that certified behaviour did NOT move (required, and it holds):**
- **Structural:** `EXTRACTION_SYSTEM_PROMPT` — the certified, cached prefix, and what `PROMPT_VERSION`
  labels — is **byte-identical**. The delimiters are not new extraction rules; they frame the input in
  the variable section. So **no re-certification is required by definition.**
- **Cache prefix:** `cache-prefix.test` passes and the live gate read the warm prefix **59/59 = 100%**
  — the delimited variable message did not disturb prefix caching.
- **Behaviour (the gate itself):** `GATE_RUNS=3` **DEPLOY GATE PASS** — promises p=0.98 r=0.94, people
  p=1.00 r=1.00, fabrication 0.68% (≤1.2% ceiling), Tier-1 zero, requirements 96% (≥95% floor), and
  the `import-easy-omar` invariant **recall 1.00 (prev 1.00)**. All six per-run passes were HARD PASS.
  Nothing moved past noise; there was no finding to stop on.
- (Follow-up and recall are not P1-9-certified surfaces, so their prompt framing carries no cert
  constraint.)

### TASK 3 — `test(INJECTION-CI)` `dbf725e` — injection tests that can actually fail
The sole prior probe (B2-5) was staging-only and non-gating. New tests run in `npm test` at **zero
model cost** — the property is structural (untrusted content is fenced and never lands in the
instruction region), so it's a pure assertion over the prompt-builders.

Covers the classes the audit named: instruction injection, fact **suppression**, cross-client
contamination, exfiltration attempt, and non-English injection — each fenced in the extraction prompt;
plus the **follow-up draft** fences the note (system frames it as data), the **recall answer** fences
excerpts, and recall retrieval is **user-scoped** (user A's ask never retrieves user B's notes).

**Proven able to fail** (the sixth time this project has made that routine): the checker returns
`false` against a deliberately unprotected prompt (the old `NOTE:\n${text}` concatenation), so a
regression that drops the fence trips the positive tests and fails the build.

### TASK 4 — `fix(LOGIN-TIMING)` `a837976` — the enumeration timing oracle
A certified property (no user enumeration) was quietly false via timing: the unknown-email dummy hash
(`scrypt$00$00`) short-circuited `verify()` before scrypt, so an unknown email answered in
~microseconds while a real one paid the full KDF.

**Fix:** a well-formed placeholder (`DUMMY_VERIFY_HASH`, 16-byte salt + full 64-byte key) that parses,
so the unknown-account path runs the complete scrypt exactly as a real account does.

**Empirical result (measured, not asserted from code shape):**
| Path | Median verify time |
|---|---|
| Known account (real hash, wrong password → full scrypt) | **28.9 ms** |
| Unknown account, AFTER the fix (`DUMMY_VERIFY_HASH` → full scrypt) | **28.5 ms** (ratio 0.99 — indistinguishable) |
| Unknown account, BEFORE the fix (`scrypt$00$00` → short-circuit) | **0.0006 ms** (~45,000× faster — the oracle) |

The test samples both paths and asserts the fixed path ≈ the real path **and** that the old dummy is
detectably faster — a built-in must-fail proof that catches any regression to the oracle.

**Reported, not built (per the task):** the login throttle is `IP+email`, in-process, and trusts the
first `X-Forwarded-For` hop. To make it durable + proxy-aware would take: (a) a shared-state limiter
(Postgres or Redis) so the window is not per-process under autoscaling; (b) an additional
**per-account / global** attempt ceiling alongside the IP+email key (the current key correctly avoids
victim lockout but doesn't bound an IP-rotating attacker against one account); and (c) trusting
`X-Forwarded-For` only from the known CloudFront/ALB hop (a fixed trusted-proxy count), so a client
cannot forge the source IP. Deferred — see below.

---

## Deferred to after the pilot — knowingly accepted risk

The following audit findings are **knowingly accepted for a controlled ~10-rep pilot**, on the
condition that **scaling past the pilot requires revisiting them plus an external penetration test:**

- **M-3** Gallery images served inline with attacker `Content-Type`, no `nosniff`/disposition (owner-
  scoped → largely self-XSS).
- **M-7 / M-8** Trial and referral farming via email aliasing / no per-referrer cap (monetary, not
  confidentiality; each farmed account is cost-bounded by the spend cap + extraction ceiling).
- **L-1** No rate limit on forgot-password (email bombing).
- **L-2** Long non-revocable sessions; no authenticated change-password / logout-everywhere.
- **L-3** `/version` build/prompt-version disclosure.
- **L-4/L-5** Ops: no failed-attempt audit, no rate limit, no token-rotation seam.
- **L-6/L-7** Two TOCTOU races (trial-extension double-grant, inventory decrement) — own-tenant only.
- **L-8** Spend cap is a soft ceiling under a concurrent burst (documented degrade-not-block).
- **L-9** 13 dev/build-only npm CVEs (`npm audit --production` = **0**); no API-layer security headers
  (belong at the CloudFront/ALB edge).
- **M-2 (partial)** The login throttle hardening described above (proxy-aware + per-account ceiling +
  shared state).

These are monetary, own-tenant, self-XSS, or hardening — none is an unauthenticated cross-tenant
confidentiality breach. The one finding of that shape, **H-1, is fixed** (Task 1).

---

## Verification summary
All four fixes: tests-first, one commit each, full suite green at each step (final **1573 passing**),
typecheck + lint clean. The audit report was committed before any fix. No production behaviour of the
certified extractor changed (gate re-run confirms). Nothing outside the four scoped fixes was altered.

**Verdict for the pilot:** the finding that gated it (H-1) is closed; the substantive prompt-injection
surface is now delimited and guarded by gating tests; the timing oracle is closed and measured. The
core isolation posture (no IDOR, RLS, parameterised everything, no XSS sink) was already sound. **Safe
for the controlled ~10-rep pilot; scaling past it still requires the deferred set + an external pen
test.**

---

## DELIBERATE CI-gate skip — credit outage (2026-09-12, temporary, MUST be undone when credits return)

This batch was pushed to git but **NOT deployed**, and CI was **skipped**, on purpose. The Anthropic
account is out of credits, so the CI P1-9 extraction gate (`ci.yml` → `gate`) fails on **spend, not on
anything in this change**: with no credits every model call returns empty, which the gate reads as
"extraction returned nothing (starved/timeout/invalid)" and fails the deploy. Proven: local
`GATE_RUNS=3` on this exact tree **passed cleanly hours earlier** (promises p=0.98 r=0.94, import
recall 1.00) and, re-run after the balance emptied, produced the **identical** all-runs-`r=0.00`
failure on byte-identical code. The only variable is the credit balance.

**Mechanism used: a `[skip ci]` marker on the push** (not a workflow edit). Why this one:
- It is the **most visible** — the marker is in the commit subject, self-documenting.
- CI's `gate` step only self-skips when `ANTHROPIC_API_KEY` is *unset*; the secret is set (just
  unfunded), so it would run and fail. Skipping *only* the gate is not enough anyway: `deploy.yml`
  fires on CI `conclusion == 'success'`, so a gate-skipped-but-verify-passed CI would **deploy** —
  which is explicitly not wanted. `[skip ci]` skips the whole CI workflow, so there is **no
  `workflow_run` event and therefore no deploy** — satisfying "git only, no gate, no deploy" in one
  marker.
- It is **per-commit, so it cannot silently persist** — no workflow file was changed, nothing is
  left disabled. The gate returns automatically on the very next push that does *not* carry the
  marker. That is the intended guard against the exact decay pattern (a red CI nobody investigates, or
  a silently-bypassed gate).

**What must happen when credits are back:** simply push normally (no marker) — CI runs the full gate
again. **No commit may be deployed until a funded CI gate has passed on it.** The security code itself
is validated (full suite 1573 green locally, typecheck + lint clean, and the gate passed on this tree
while credits existed), but the standing rule holds: the gate must be green on a funded run before
these commits reach production. Until then this batch lives on `main`, unshipped.
