# Close trial farming — Task 1 findings (report only, no edits)

**TL;DR — two findings materially change the plan; the Stripe answer does not stop it:**

1. **A per-trial extraction ceiling ALREADY EXISTS and is wired in prod** — `TRIAL_EXTRACTION_CEILING`, **default 200**, enforced *before* the model call (`extraction-service.ts:233`), but **only while `trialing`**. So **Task 3 is hardening/tuning an existing gate, not building one.** Two weaknesses (below) mean it does not currently stop farming.
2. **Email verification EXISTS end-to-end but is deliberately SOFT — it "NEVER gates access"** (`auth-service.ts:41`). **Task 2 reverses an explicit, documented product decision.** The owner is entitled to make that call — flagging it so the reversal is deliberate, and because it likely touches `docs/` (guard-protected).
3. **Stripe requires NO card at signup** — the 14-day trial is granted card-free (`billing-service.ts:72-76`). So there is no payment gate that would make this batch unnecessary; **the Stripe answer does NOT materially change the design** (it confirms the exposure). *Not stopping on the Stripe condition.*

---

## 1. Signup → entitlement → extraction path (file:line)

- **Signup** `POST /auth/signup` — `auth-routes.ts:59-95`. Body `{email, password, consent, timezone?, ref?}` → `auth.signup(...)` → returns `{user, token}` + session cookie (201). **No invite/allowlist gate.**
- **On signup** `server.ts:259-274`: `deps.billing.onSignup(...)` **starts the trial**; then a *best-effort* welcome email that **mints an email-verification token** (`createEmailVerification`, `server.ts:269`) and carries the verify link (`server.ts:271-272`). Email send never blocks signup.
- **Trial grant** `billing-service.ts:72-76`: flat **14-day** trial (`config.trialDays`), keyed by **email** via `trials.grantOrGet(email)`. **[TRIAL-14]** re-signing up with the *same* email reuses the original grant (no fresh trial) — but a *new* email gets a fresh 14 days. So the existing anti-farming measure stops trial *resets*, not *new-email* farming.
- **Entitlement** `billing-service.ts:90-97`: `status==='trialing' && now < trialEndsAt` ⇒ **`entitled: true`**. `requireEntitled` (`helpers.ts:15-22`) sends 402 only when *not* entitled.

**What a fresh, unverified account gets:** a fully **entitled `trialing`** account. Every premium surface that gates on `requireEntitled` (recall, brief, hero, monday-digest, inventory reads, follow-up drafting, etc.) treats `trialing` as entitled — so an unverified account has the **full product**, including extraction.

## 2. Does email verification exist, and what does it gate?

**Exists, fully wired, gates NOTHING:**
- Column `users.email_verified` (`pg-user-repository.ts:11,77`), default false (`in-memory-user-repository.ts:32`).
- Token minted at signup (`server.ts:269`), consumed at `POST|GET /auth/verify-email` (`auth-routes.ts:157-170`), 7-day token (`auth-service.ts:94`); resend at `POST /auth/resend-verification` (`auth-routes.ts:175+`, rate-limited).
- **Explicitly soft:** `auth-service.ts:41-43` — *"Soft email verification (EMAIL-VERIFY) — NEVER gates access; only drives the quiet in-app 'confirm your email' banner and the Settings verified state."*
- **No `requireVerified` exists anywhere.** Nothing reads `emailVerified` to allow/deny an action.

⇒ **Task 2 introduces the first access gate on verification, reversing the documented "never gates access" stance.**

## 3. Every path that can trigger an extraction call, and which are reachable unverified

`extraction.extractNote(...)` callers:

| # | Path | file:line | Entitlement gate? | Verify gate? | Reachable by unverified trial? |
|---|---|---|---|---|---|
| a | `POST /notes/:id/extract` | `notes-routes.ts:438-448` | **NO** (route has no `requireEntitled`) | **NO** | **YES** |
| b | Background `NoteSweepService` (drains queued paste/voice/import notes) | wired `index.ts:240`; runs `note-sweep-service.ts:50,66` | **NO** (only a `canSpend` check, line 50) | **NO** | **YES** — a queued note is swept on its own |
| c | Ask-capture (captured statement → extract, hold-for-confirm) | `ask-capture-service.ts:69` | capture queue **not** entitlement-gated (`recall-routes.ts:41-42`) | **NO** | **YES** |
| d | Extraction canary (system, 6h) / CI gate | `index.ts:338` / `eval/gate.ts` | n/a (system) | n/a | No (not user-triggered) |

All three user paths (a,b,c) are reachable by an unverified `trialing` account. **Note:** the primary `/extract` route (a) has **no route-level entitlement gate at all** — extraction is bounded only by the internal trial ceiling (trialing-only) + spend cap. A *post-trial* (`trial_expired`) account would pass the trialing-only ceiling and be bounded only by the AED spend cap (adjacent gap; out of this batch's scope, flagged).

## 4. Per-account spend cap on a trial — before or after the spend?

- **`SpendService`**, cap **`config.spendCapAed` (AED 45)** per rep per billing period (`index.ts:172`), durable `spend_ledger`.
- Enforced in extraction **BEFORE the model call**: `extraction-service.ts:240` — `spendGate.canSpend(userId)` false ⇒ returns `spend_capped`, note stays pending (deferred, not broken). Same gate in the sweep (`note-sweep-service.ts:50`).
- Applies to trial accounts (per-account, period-bucketed). **But it bounds ONE account's spend, never N** — a farmer spins up new accounts, each with its own AED 45 headroom.

### The existing trial extraction ceiling (relevant to Task 3)
- `TrialExtractionLimiter` (`limiter.ts`), ceiling `config.trialExtractionCeiling` **default 200** (`config.ts:229`, env `TRIAL_EXTRACTION_CEILING`).
- Enforced **BEFORE the model call**: `extraction-service.ts:233` — `limiter.allow` false ⇒ `trial_limit`, note stays pending. **Only while `trialing`** (`limiter.ts`: non-trial ⇒ unlimited).
- **Count = `extractionLogs.listByUser(uid).length`** (`index.ts:179`) — a count of **hot** extraction-log rows. **Weakness:** the training-archive sweep and erasure both delete `extraction_logs` rows, so the count can DROP over time, letting a long-lived trial exceed the intended ceiling. Not a durable counter.
- **Farming math:** 200 extractions/account × ~AED 0.3–0.7 each ≈ **AED 60–140 of headroom per free account**, multiplied by unlimited new-email signups.

## 5. Stripe trial flow assumption about verification / card

- **No card at signup.** `billing.onSignup` → `startTrial` grants a flat 14-day trial with **no checkout, no payment method** (`billing-service.ts:72-76`). A card is required only at `checkout()` → `active` (`billing-service.ts:100+`).
- Verification is irrelevant to billing today (soft).
- ⇒ **No payment-based farming gate exists.** The Stripe answer confirms the exposure rather than closing it, so it **does not materially change the design** — proceeding is warranted.

---

## Recommendation / STOP for direction

Task 1 is complete and findings-only (no code touched). Before implementing, two items need the owner's confirmation because they change the batch's premise:

- **Task 3 is tuning, not building.** The gate (`TrialExtractionLimiter`, pre-spend, trialing-only) exists at **200**. Proposed hardening (for your ruling): (i) **lower the ceiling** to an anti-farming number — see Task 3 derivation when authorized; (ii) **make the counter durable** so archival/erasure can't reduce it (count from `spend_ledger` or a dedicated `trial_extractions_used` counter, not hot `extraction_logs`); (iii) confirm the trialing-only scope is intended (post-trial extraction currently relies on the spend cap alone).
- **Task 2 reverses "verification NEVER gates access."** Confirm the reversal, and note it likely needs a `docs/` change (I will *list* the proposed doc edit, not apply it). The verify token + email + endpoint already exist end-to-end, so Task 2 is: add the gate + the queued-note UX message; nothing new in the token plumbing.

I have **not** proceeded to Tasks 2–4. Awaiting your go-ahead (and any adjustment to the ceiling target and the durable-counter decision).
