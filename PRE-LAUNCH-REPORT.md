# Tovira — Pre-Launch Close-Out Report

Five tasks, five commits, on `main` (local — **push pending your review**). The
full suite is **947 passing (160 files)**, typecheck + lint clean, no cloud calls,
no spend. Nothing left in `BLOCKERS.md` that a coding agent could resolve.

| # | Commit | ID | Suite after |
|---|---|---|---|
| 1 | `feat(EMAIL-HOOKS)` — wire the remaining lifecycle emails | `481cf78` | 903 |
| 2 | `feat(EMAIL-VERIFY)` — soft email verification | `a758d8d` | 928 |
| 3 | `fix(LOCKED-EMBEDDED)` — `<Locked>` on the embedded gated surfaces | `200569f` | 934 |
| 4 | `chore(DEPLOY-READY)` — config audit, env docs, migration + SES infra | `7098afc` | 947 |
| 5 | `docs(RECONCILE)` — USER-FLOWS + PROJECT-STATUS + this report | *(this commit)* | 947 |

---

## Task 1 — `feat(EMAIL-HOOKS)`: lifecycle emails wired

Every transactional email is now fired from its real event source, idempotent per
`(user, event)`, and isolated so a failing send never breaks the business action.

- **1a — trial-ending / trial-ended.** New `TrialEmailService` + `trial-emails`
  scheduled job over trialing subs (`SubscriptionRepository.listTrialing`).
  Trial-ending fires ~2 days out; trial-ended once the trial has lapsed unconverted.
  Extension-aware: at most one ending-notice per trial (email-log keyed), so a +7
  extension can't double-send.
- **1b — billing webhook hooks.** `BillingEmailHook` fired inside
  `handleWebhook`: `invoice.payment_failed` → payment-failed;
  `checkout.session.completed` → subscription-confirmed (**renewsAt only when the
  webhook supplies `current_period_end`** — never invented);
  `customer.subscription.deleted` → canceled. Idempotent per Stripe **event id**.
- **1c — account-deleted.** Sent **before** the purge (the address is about to be
  erased), inside `AccountService.deleteAccount`.
- **1d — failure isolation.** Every send is wrapped so a throw is logged and
  swallowed; the webhook, the deletion, and the job all complete regardless.
- **Tests:** call-count assertions across `trial-email-service.test.ts` (5),
  `billing-service.test.ts` webhook hooks (4), `account-service.test.ts` (3,
  including the email-before-purge ordering).

## Task 2 — `feat(EMAIL-VERIFY)`: soft verification

Decision honored: **soft**. A rep has full access from signup; verification never
gates anything — it only lets us reach them about their trial.

- **Tokens:** single-use, hashed at rest (sha256), 7-day expiry (migration
  `0034_email_verification`, new `EmailVerificationRepository` port + in-memory/pg
  adapters; `users.email_verified`).
- **Flow:** the welcome email carries `{APP_BASE_URL}/verify-email?token=…`;
  `GET/POST /auth/verify-email {token}` consumes it and marks the account verified;
  a quiet dismissible in-app banner ("Confirm your email so we can reach you about
  your trial.") with a **Resend** action rate-limited to **3 per user per UTC day,
  server-enforced**; Settings shows Confirmed / Not confirmed yet.
- **Trust:** another user's token verifies its **own** account, never a different
  one; expired / reused / unknown all 400 identically (no oracle).
- **Tests:** `auth-service.test.ts` (+8: expired, reused, another-user's, garbage,
  rate-limit + next-day reset, resend verifies), `auth-verify.test.ts` HTTP (+7,
  incl. **an unverified rep creates a client AND passes an entitlement-gated read**
  — asserted), `authClient.test.ts` (+4), `EmailVerification.test.tsx` (+5),
  `App.test.tsx` banner shows + dismisses (+1).

## Task 3 — `fix(LOCKED-EMBEDDED)`: `<Locked>` on the embedded surfaces

The brief panel, follow-up draft, and card scan collapsed a 402 into an empty
screen or a raw error. They now render the same calm `<Locked>` state as the
full-screen gated views, with Subscribe → Billing.

- Shared `LOCKED` sentinel (`billing/gated.ts`); `getBrief` / `draftFollowUp` /
  `cardsClient.scan` return it on 402 (distinct from `null` = genuine empty/error).
- `FollowUpDraft` + `CardScan` take `onSubscribe` and render `<Locked>`; the brief
  surface in `ClientDetail` does the same (Subscribe closes the detail → Billing).
- Bonus robustness: `outbox.flush/pending` no longer throw when the store is
  unreadable (IndexedDB unavailable), so opening a client never crashes on start.
- **Tests:** each surface renders `<Locked>` on a 402 (asserted **not** the error
  path) with Subscribe → Billing; the three client methods map 402 → `LOCKED`;
  entitled reps unaffected.

## Task 4 — `chore(DEPLOY-READY)`: deploy-readiness sweep

- **`assertDeployReady(config, env)`** (called at boot right after `loadConfig`):
  fails fast with **every** offending key named at once, but **only for the
  providers actually selected** — all-stub local dev stays zero-config. Coverage in
  the checklist below.
- **`.env.example`** completed (AI/model routing, `STRIPE_ANNUAL_PRICE_ID`,
  transactional email, `APP_BASE_URL`), grouped/commented, names only.
- **Migrations audit** (`migrations-inventory.test.ts`): the real runner over the
  real set — contiguous **0001–0034**, each applied once in order from empty,
  idempotent second run. Live SQL application is proven by the Docker boot (same
  runner).
- **SES Terraform** (`infra/terraform/ses.tf`), **authored, not applied**: domain
  identity + Easy DKIM + custom MAIL FROM + shared-IP config set + task-scoped send
  policy, all gated on `var.ses_domain` so the default plan creates nothing. Cost
  guards kept: no NAT (IGW), a `check` block failing the plan on a dedicated IP.
  `terraform validate` passes.

## Task 5 — `docs(RECONCILE)`

- **USER-FLOWS.md:** added FLOW 3c (email verification) + the lifecycle-email
  matrix; updated FLOW 10/11/16 to note the embedded `<Locked>` state; extended
  the manual-test checklist (verification, resend limit, lifecycle emails,
  deletion-before-purge, embedded locked).
- **PROJECT-STATUS.md:** test count 947 / 160 files, migrations 0001–0034, a §3b
  entry for these batches, and human-only email/SES go-live steps.
- **BLOCKERS.md:** cleared of everything a coding agent could resolve (see below).
- `docs/` is edit-guarded — proposed human changes are listed at the end.

---

## Scheduled-job inventory

Jobs are registered in-process (`LocalScheduler`) and driven on-demand locally;
production invokes them via the EventBridge scheduler (infra, lands with P6-1).

| Job | What it does | Trigger (prod) | Idempotency |
|---|---|---|---|
| `priorities-nightly` | Precompute every rep's ranked priorities → Today/Hero cache | EventBridge, nightly | Recompute overwrites; safe to re-run |
| `notes-sweep` | Advance stuck `pending_transcription`/`pending_extraction` notes; bounded retries → terminal `needs_review` | EventBridge, daily | `sweepAttempts` counter; terminal state stops retries |
| `trial-emails` | trial-ending (~2 days out) + trial-ended over trialing subs | EventBridge, daily | `email_log` per (user, `trial_ending`/`trial_ended`) — at most one per trial, extension-aware |
| Proactive **scan** (`POST /scan`) | Going-cold, nudges, date reminders, chat-refresh; push under the 2/rep/day budget | EventBridge `cron(0 7 * * ? *)` → Lambda → `/scan` (`scheduler.tf`, already authored) | Alerts recorded in-app; push budget caps device fan-out |

Event-driven emails (welcome, payment-failed, subscription-confirmed, canceled,
account-deleted) are **not** scheduled — they fire from their request/webhook and
are idempotent per (user, event) / Stripe event id.

**Human-only:** the EventBridge rules that invoke `priorities-nightly`,
`notes-sweep`, and `trial-emails` on a schedule are infra and land with the cloud
deploy. Until then these run only when triggered.

---

## Config-key checklist (enforced by `assertDeployReady`)

| Key(s) | Required when | Local default | Fails boot if… |
|---|---|---|---|
| `DATABASE_URL` | always | compose supplies it | missing/blank (in `loadConfig`) |
| `ANTHROPIC_API_KEY` | `MODEL_PROVIDER=anthropic` | stub, no key | provider real, key blank |
| `MODEL_<CLASS>` map | always | Sonnet (extraction) / Haiku | any class resolves blank |
| `GROQ_API_KEY` | `TRANSCRIBER=groq` | stub, no key | provider real, key blank |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | `PUSH_SENDER=webpush` | stub, blank | provider real, either blank |
| `SES_REGION` | `EMAIL_SENDER=ses` | inherits region | ses + `SES_REGION` unset |
| `EMAIL_FROM` | `EMAIL_SENDER=ses` | `*.local` placeholder | ses + placeholder/blank sender |
| `APP_BASE_URL` | `EMAIL_SENDER=ses` | `localhost` | ses + still localhost |
| `STRIPE_WEBHOOK_SECRET` | `STRIPE_SECRET_KEY` set | `whsec_test` | real key + test placeholder |
| `STRIPE_PRICE_ID` | `STRIPE_SECRET_KEY` set | `price_test` | real key + test placeholder |
| `STRIPE_ANNUAL_PRICE_ID` | `STRIPE_SECRET_KEY` set | `price_test_annual` | real key + test placeholder |

All-stub local dev requires only `DATABASE_URL`. Each real provider you turn on
makes exactly its own keys mandatory, and a half-configured provider names every
missing key at once.

---

## Final human-only remaining work

1. **Turn on SES** (before go-live): `terraform apply -var ses_domain=…`, add the
   DKIM CNAMEs + MAIL-FROM MX/SPF (or pass `ses_route53_zone_id`), move out of the
   SES sandbox; then set `EMAIL_SENDER=ses` + a verified `EMAIL_FROM` + `SES_REGION`
   + a public `APP_BASE_URL` in the runtime secret.
2. **EventBridge rules** for `priorities-nightly`, `notes-sweep`, `trial-emails`
   (+ the already-authored daily scan). Infra; lands with the cloud deploy.
3. **Real Stripe SKUs** (monthly AED 299, annual AED 2,990), webhook endpoint →
   `/billing/webhook`; keep test mode until launch.
4. **`terraform apply`** the stack (cost-guarded), then verify on real infra.
5. **Device push** (iOS installed PWA) and **beta** with real reps.

---

## Proposed `docs/` changes (guard-blocked — for a human to apply)

`docs/` is edit-protected; these are contract updates a human should make so the
LOCKED specs match shipped behavior:

- **`docs/tovira-user-stories.md` + `docs/tovira-acceptance-tests.md`:** add stories
  + positive/negative acceptance for **soft email verification** (EMAIL-VERIFY),
  **lifecycle emails** (EMAIL-HOOKS), and **embedded `<Locked>`** (LOCKED-EMBEDDED)
  if you want them tracked as first-class stories rather than launch-blocker tasks.
- **`docs/tovira-spec.md`:** record the **soft-verification** decision (full access,
  never a gate) and the lifecycle-email matrix + idempotency rule.
- **`docs/tovira-aws-infra.md`:** add **SES** (domain identity, DKIM, custom MAIL
  FROM, shared-IP cost guard) to the infra design, and the EventBridge rules for
  the three scheduled jobs.
- **`docs/tovira-extraction-prompt.md`:** resolve the **v0.1 → v0.2 label** (the one
  remaining open item in `BLOCKERS.md`) — behavior already matches v0.2; only the
  version label + "multilingual Rule 0" text need reconciling. A human decision.
