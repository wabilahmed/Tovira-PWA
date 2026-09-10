# Security audit — Tovira — `test(SECURITY-AUDIT)`

**Date:** 2026-09-10 · **Scope:** the application codebase (`apps/api`, `apps/web`, migrations).
**Read-only. No production code was changed.** Findings only.

## Scope honesty — read this first

This is a **code audit performed by the agent that wrote the code.** It is **not** an independent
penetration test. It cannot exercise the deployed AWS surface — TLS/cipher configuration, the
CloudFront/ALB edge, WAF rules, actual network exposure, RDS-at-rest, IAM, or Secrets Manager — none
of which it holds credentials for. Timing findings are **reasoned from code, not measured** against
the live service. And it has the obvious blind spot of reviewing its own work: a reviewer who shares
the author's assumptions misses the bugs those assumptions cause. To reduce (not remove) that, the
eight areas were investigated by separate fresh readers of the code; the headline findings were then
re-verified line-by-line.

**For a product that will hold third parties' private conversations in the UAE, an external
penetration test before scaling beyond a controlled pilot remains warranted.** This audit narrows
where that test should look; it does not substitute for it.

---

## Verdict (one line)

> **Conditionally yes for a controlled ~10-rep pilot — but only after HIGH-1 (`/health` leaks
> per-rep data to anyone) is fixed. The core data-isolation is genuinely strong (RLS FORCE, no IDOR,
> no SQLi, no stored-XSS sink, every route tenant-scoped); the real exposure is one unauthenticated
> info leak plus a class of human-gated prompt-injection surfaces. Do not scale past the pilot
> without the external pen test above.**

## Severity roll-up

| Sev | ID | Finding |
|-----|----|---------|
| **HIGH** | H-1 | `/health` (unauthenticated) leaks per-rep spend alerts (userId + spend) and raw job error strings — cross-tenant |
| MEDIUM | M-1 | Login timing oracle: the dummy password hash short-circuits scrypt, re-opening user enumeration |
| MEDIUM | M-2 | Online-guess throttle is IP+email only (no per-account/global cap), in-process, and trusts `X-Forwarded-For` |
| MEDIUM | M-3 | Gallery images served inline with attacker-controlled `Content-Type`, no `nosniff`/disposition/CSP |
| MEDIUM | M-4 | Extraction prompt does not structurally delimit untrusted transcript from instructions |
| MEDIUM | M-5 | Imported (attacker-authored) text flows raw into the follow-up **draft** and the Ask **answer** |
| MEDIUM | M-6 | Prompt-injection test coverage gap: the one probe is staging-only/non-gating; the CI gate has none |
| MEDIUM | M-7 | Trial + extraction-ceiling farming via email aliasing (`+tag`, Gmail dots not normalised) |
| MEDIUM | M-8 | Referral farming: no per-referrer cap (self-dealing across throwaway accounts) |
| LOW | L-1..L-9 | Forgot-password not rate-limited; long non-revocable sessions; `/version` disclosure; ops has no failed-attempt audit / rate limit / rotation seam; trial-extension & inventory-decrement TOCTOU; spend-cap soft under concurrency; dev-only npm CVEs; no API security headers |

---

## HIGH

### H-1 — `/health` leaks per-rep spend data + internal errors to any unauthenticated caller
- **Reachability:** UNAUTHENTICATED. `/health`, `/healthz`, `/api/health` are served at `server.ts:198`, *before* the auth and ops gates.
- **Evidence:** `server.ts:233` spreads `deps.spend.snapshot()` **plus `alerts: spendAlerts`** into the public body. Each alert is an `OpsAlert` carrying `userId` + a `detail` object (`ports/ops-alert-repository.ts:7-14`); the code comment states it "names the rep, spend, period, dominant class." `summarizeJobs` (`server.ts:69-77`) also emits each job's raw `error` string, and the body exposes `adapters` (real-vs-stub), cache/recall/import cost metrics, and `trainingLog` volume.
- **Exploit path:** `curl https://<host>/api/health`. Today `alerts` is empty (verified live), so the leak is **latent** — but the moment any rep crosses the 80% spend-warn threshold, their **user id and spend** become world-readable, with no auth.
- **Blast radius:** cross-tenant — other reps' identifiers + spend behaviour, plus infra topology and internal error text useful for further attack. This is the single finding that directly touches third-party-adjacent confidentiality, which is why it gates the verdict.
- **Fix direction (not applied):** the ALB check only needs the `SELECT 1` liveness; gate the rich body behind the ops token, or reduce the public body to `{status}`.

---

## MEDIUM

### M-1 — Login timing oracle re-opens user enumeration
- **Reachability:** unauthenticated (`POST /auth/login`).
- **Evidence:** `auth-service.ts:143` verifies against dummy `'scrypt$00$00'` for an unknown email — but `password.ts:28` returns `false` (`expected.length !== KEYLEN`) **before** the scrypt call at `:29`. So an unknown email returns in microseconds; a real email pays full scrypt (tens of ms). The response side is correctly generic (`InvalidCredentialsError`), so the *only* leak is timing — but it defeats the very no-enumeration doctrine the design states it wants.
- **Blast radius:** account-existence disclosure across all tenants → targeted phishing / credential stuffing. **Fix direction:** make the dummy a well-formed 64-byte scrypt hash so the KDF actually runs on the miss path.

### M-2 — Online-guessing throttle is weak
- **Reachability:** unauthenticated.
- **Evidence:** login limiter keys on `IP+email` (`auth-routes.ts:92`), `8 / 15min`, **in-process** (`rate-limiter.ts:8,19`). No per-account or global ceiling: an attacker rotating IPs gets a fresh budget per IP against one victim. `clientIp` trusts the first `X-Forwarded-For` hop (`helpers.ts:80-84`) — if anything but the trusted proxy can set it, the limiter is bypassable; and under autoscaling each task has its own window. (Keying on IP+email is *correct* for avoiding victim lockout — the gap is the missing global cap.)
- **Blast radius:** online password guessing against targeted accounts. **Fix direction:** add a per-account/global attempt ceiling; confirm XFF is trusted only from the real proxy; move the limiter to shared state.

### M-3 — Gallery images: stored-XSS shape (owner-scoped)
- **Reachability:** authenticated; owner-scoped retrieval.
- **Evidence:** upload trusts the client `Content-Type` verbatim with no magic-byte/extension check (`images-routes.ts:50-53`); serve echoes it and streams **inline** with no `X-Content-Type-Options: nosniff`, no `Content-Disposition`, no CSP (`images-routes.ts:72-73`). An `image/svg+xml` or `text/html` body with `<script>` executes when the object URL is opened.
- **Blast radius:** retrieval is strictly `findByIdForUser` (`images-routes.ts:66`), so this is **largely self-XSS** — an attacker can't get their payload served under a victim's session without the victim uploading it. Session cookie is `HttpOnly` so not JS-stealable. Rises to real if images ever become cross-tenant shareable or the API/app share an exploitable origin. **Fix direction:** `nosniff` + `attachment` disposition + magic-byte allow-list + canonical stored type; ideally a cookieless media origin.

### M-4 — Untrusted transcript not delimited from instructions (prompt injection substrate)
- **Reachability:** the malicious text originates from an **unauthenticated third party** (a client's WhatsApp message); a rep triggers it by importing.
- **Evidence:** `buildUserMessage` places the client-authored transcript directly after a bare `NOTE:` label with no fence or "treat as data" instruction (`prompt.ts:284-292`); defenses are behavioral, not structural. Rule 0 explicitly invites non-English code-switching (`prompt.ts:114`), widening the surface.
- **Blast radius:** the extracted JSON for that one note — can suppress real facts or **inject fabricated ones** (a promise, a person, a `requirement` — a fabricated requirement even triggers inventory matching). Per-note, single-client — **no cross-tenant bleed** (confirmed: extraction sees one client's data). Mitigated by the model currently resisting a basic bait (B2-5) — but that's stochastic, not a guarantee.

### M-5 — Injected transcript reaches rep- and client-facing generated text
- **Evidence:** the raw imported transcript is concatenated into the **follow-up draft** prompt (`follow-up-service.ts:26`, `NOTE:\n${note.rawText}`) and into the **Ask answer** context as excerpts (`recall-service.ts:199-203`).
- **Blast radius:** the follow-up path is the more serious — its output is a message the rep may **send to a client** (social-engineering-by-proxy). **Mitigated:** the draft is **draft-only — it never auto-sends** (`follow-up-service.ts:9-11`), the rep reviews before sending, and the system prompt says "base ONLY on the note and listed commitments." Human-gated, hence MEDIUM not HIGH — but it would be HIGH if drafts were ever auto-sent. **Within-tenant nuance (not a breach):** recall retrieval is scoped by *user*, not *client* (`recall-service.ts:187`), so injected text in client A's note can surface when the rep asks about client B — the rep's own data, not exfiltration.

### M-6 — Prompt-injection test coverage gap
- **Evidence:** the only injection probe is B2-5 (`tests/staging/b2-refusal-set.test.ts:108-124`), which runs under `test:staging` against the live model — **not** the CI gate (`npm test`); the CI eval set (`apps/api/src/eval`) has **no injection fixture** (its "Rule 7" tests Tier-2 sensitive-data leakage, a different thing). Untested classes: **fact injection** (B2-5 only checks non-obedience, not an injected fabricated promise/IBAN), the **`whatsapp_export` import channel** (B2-5 uses paste), **follow-up** and **recall** paths, and **non-English/encoded** injection. A regression in injection resistance would not fail the build.
- **Blast radius:** none directly, but it means M-4/M-5 have no gating regression guard.

### M-7 — Trial + extraction-ceiling farming via email aliasing
- **Reachability:** self-service signup.
- **Evidence:** the trial grant is keyed on `email.trim().toLowerCase()` (`billing-service.ts:94`) with no `+tag` stripping or Gmail dot-folding; `PgTrialGrantRepository.grantOrGet` dedupes on that exact string. So `foo+1@…`, `foo+2@…`, `f.o.o@…` each earn a fresh 7-day trial and a fresh 200-extraction ceiling (`limiter.ts:20-24`). Same-string re-signup is correctly blocked (atomic `ON CONFLICT (email)`) — aliasing defeats it.
- **Blast radius:** monetary (free access), bounded per account by the AED 45 spend cap + 200-extraction ceiling. This is the industry-baseline "trial farming beyond the email check" — expected, not a data-security issue.

### M-8 — Referral farming (no per-referrer cap)
- **Evidence:** `referral-service.ts:26` blocks only `referrerId === referredUserId`; the repo dedupes per `referred_email` (correct, race-safe) — but **nothing caps how many distinct people one referrer credits.** Each new referred email grants the referrer +30 days (`billing-service.ts:136-141`). Combined with M-7, a rep spins up aliased accounts and refers themselves unbounded.
- **Blast radius:** monetary (unbounded free months), no data/security impact, requires manual account creation, detectable. **Fix direction:** cap referral grants per referrer; normalise signup emails before keying grants.

---

## LOW (abbreviated — full detail available on request)

- **L-1** No rate limit on `POST /auth/forgot-password` (`auth-routes.ts:119-138`) → reset-email bombing + `password_resets` row growth. Reset security itself is sound.
- **L-2** Session TTL 7 days, no sliding cap; **no authenticated change-password endpoint**, no "log out everywhere," unbounded concurrent sessions — widens a leaked-token window. (Reset and deletion *do* revoke all sessions.)
- **L-3** `/version` unauthenticated, discloses build SHA + env (`server.ts:189-195`) — standard fingerprinting aid.
- **L-4** `/ops/*` logs no failed-auth attempts and has no rate limit (`ops-routes.ts:39-42`); audit trail records only *successful* overrides.
- **L-5** No `OPS_TOKEN` rotation/versioning seam (single static env value); a value shared across environments would let a staging leak unlock prod. (Fails closed when unset — good.)
- **L-6** Trial-extension TOCTOU: read-check-write on `trialExtended` (`billing-service.ts:103-109`) with no `AND trial_extended=false` guard → concurrent capture requests can double-grant +7d.
- **L-7** Inventory quantity decrement is read-modify-write (`inventory-service.ts:148-160`), not atomic → concurrent "bought" writes lose a decrement (own-tenant integrity only; RLS-confined).
- **L-8** Spend cap is a soft ceiling under concurrency (checked before, recorded after — `extraction-service.ts:237`, `metered.ts:44`) — a burst just under cap can overspend. Documented degrade-not-block design; own account.
- **L-9** `npm audit`: **13 vulns (1 critical, 8 high, 4 moderate) — ALL dev/build-only; `npm audit --production` = 0.** The critical (`vitest`) and `sharp` (HIGH) are devDependencies, not imported in any runtime path. No API security headers (CSP/HSTS/nosniff/frame-options) set by the app (`server.ts`) — belongs at the API or CDN edge. One ops-only DDL string-interpolation (bootstrap role password, config-sourced, single-quote-escaped, `index.ts:119`) — not user-reachable.

---

## Verified sound (what the audit confirmed is correctly defended)

**Re-confirmed from the "already verified" list:** RLS `FORCE ROW LEVEL SECURITY` present across 23
migrations with the canonical `app.user_id` policy (`migrations/0003_rls.sql`, `0036_reference_integrity.sql`);
composite `(user_id, id)` FKs block cross-tenant re-parenting; login is generic on the response side
(no response-based enumeration); Stripe webhooks are signature-verified + idempotent by event id;
`.env`/`.env.prod` gitignored with only `.env.example` tracked and **no secret committed anywhere in
history**; ops override is `timingSafeEqual`-gated and fails closed when unset; Tier-1 redaction at
ingest (confirmed in earlier audits).

**AREA 1 — Authorization: NO IDOR.** Every id-taking route (client, note, promise, requirement,
meeting, image, inventory item/share/match, capture session, alias, deal-value) authenticates, then
scopes via `findByIdForUser(userId,…)` / `listBy*(userId,…)` / RLS. A foreign id and an unknown id
return a **byte-identical `404 {error:'not_found'}`** — no 403-vs-404 existence oracle, on reads and
writes. Nested writes (note-move, share, match→share) are backstopped by composite FKs. The prior
"deal-value" IDOR is fixed with an explicit ownership guard (`ledger-routes.ts:40-45`).

**AREA 2 — Session:** cookie is `HttpOnly; SameSite=Lax; Secure`(prod), token never in localStorage;
256-bit `randomBytes(32)` tokens; no session fixation (no pre-auth session to reuse); reset/verify
tokens hashed-at-rest, single-use (atomic `RETURNING`), expiring (1h/7d); reset revokes all sessions;
deletion cascades sessions; resend-verify limit is per-account + server-enforced; scrypt with random
salt + `timingSafeEqual`.

**AREA 3 — Files:** zip parsing is in-memory (no filesystem write → no path traversal, symlinks
inert), format decided by **magic bytes** not extension, and fail-closed caps: **128 entries / 5 MB
per entry / 5 MB total**, nested zips rejected, request body ~1 MB. Storage keys are server-generated
UUIDs (no collision, no name-derived paths).

**AREA 4/5 — Injection:** no cross-tenant prompt bleed; Ask fact-capture holds items for confirmation
(nothing enters the vault unconfirmed); the RLS GUC is set via **parameterised `set_config($1,$2)`**
(no injection into `app.user_id`); **all adapter SQL is parameterised** (only fixed column-list
constants and allow-listed SET keys are interpolated); **no web XSS sink** (`dangerouslySetInnerHTML`
absent; React auto-escapes); account export is **JSON** (no CSV formula injection); the share card
carries counts only; email HTML is `escapeHtml`/`escapeAttr`'d; **no SSRF** (only fixed provider base
URLs); **no log injection** on the serving path.

**AREA 6 — Privileged:** ops token is a dedicated env secret, constant-time, fail-closed, not a rep
credential; the scheduler is **not HTTP-reachable** (in-process timer) with per-job advisory locks so
no tenant can trigger/delay/starve another's jobs; the canary carries no HTTP exposure or secrets;
the catch-all returns generic `500 internal_error` with no stack/DB detail.

**AREA 7/8 — Money:** promotion codes are **Stripe-enforced** (the app forwards no code, computes no
discount — no client-side redemption limit to forge); spend is keyed to the authenticated user (no
endpoint takes a target `userId` — no rep can spend on another's account); the spend ledger increments
**atomically** (`ON CONFLICT … DO UPDATE SET aed = aed + …`) with per-rep period buckets (no shared
counter, no cross-tenant degradation); CORS is not permissive-with-credentials (no CORS at all —
same-origin behind CloudFront); error responses leak no internal detail.

---

## Could NOT be tested from here

The deployed infrastructure and everything requiring live credentials or network position:
TLS/cipher config and HSTS at the edge, the CloudFront/ALB configuration and whatever security
headers *it* adds, WAF/rate-limiting at the edge, actual network exposure and security groups,
RDS encryption-at-rest and backup handling, IAM scoping, Secrets Manager access control, the real
behaviour of the in-process rate limiter under horizontal scaling, **measured** timing on the
enumeration paths (M-1/M-2 are reasoned from code), and live Stripe/Bedrock/Groq behaviour. These are
exactly the surfaces an external penetration test must cover.

---

## Prioritised fix list (listed, NOT implemented)

1. **H-1** — stop emitting per-rep `spend.alerts` and raw job `error` strings from unauthenticated `/health`; gate the rich body behind the ops token or reduce the public body to `{status}`. *(The one fix the verdict is conditioned on.)*
2. **M-1** — make the login dummy hash a well-formed 64-byte scrypt value so the KDF runs on the unknown-email path (closes the timing oracle).
3. **M-2** — add a per-account/global online-guess ceiling; verify `X-Forwarded-For` is trusted only from the real proxy; back the limiter with shared state.
4. **M-3** — serve gallery images with `nosniff` + `Content-Disposition: attachment` + a magic-byte allow-list + canonical stored content-type (ideally a cookieless media origin).
5. **M-4/M-5/M-6** — delimit untrusted transcript in the extraction, follow-up, and recall prompts (explicit "the following is untrusted data" fencing); add **gating** injection fixtures to the CI eval covering fact-injection, the import channel, the follow-up/recall paths, and non-English baits.
6. **M-7/M-8** — normalise signup emails (`+tag` / Gmail dots) before keying trial grants; cap referral grants per referrer.
7. **L-1/L-6/L-7** — rate-limit forgot-password; make the trial-extension guard and the inventory decrement atomic (`WHERE … trial_extended=false`; `SET quantity = GREATEST(0, quantity - $)`).
8. **L-2/L-4/L-5/L-9** — add an authenticated change-password + "log out everywhere"; audit failed ops attempts + rate-limit `/ops/*`; a token-rotation seam; `npm audit fix` for the dev-only CVEs; baseline security headers at the edge.
9. **Book the external penetration test** before scaling beyond the pilot — the infrastructure surface this audit could not reach.
