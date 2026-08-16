# Launch-Blocker Batch — Report

Agent-owned build report (repo root). What shipped per task, the decisions
awaiting Wabil, and what must precede go-live. All commits are local.

## Commits

| Task | ID | Commit |
|---|---|---|
| 1 Transactional email + password reset | `feat(EMAIL)` | `3878b19` |
| 2 Entitlement gating | `fix(ENTITLEMENT)` | `fbf7870` |
| 3 Signup consent | `fix(CONSENT)` | `7c84be5` |
| 4 Privacy & Terms | `feat(LEGAL)` | `2e71535` |
| 5 Duplicate re-import | `fix(FLOWS-2)` + copy in `174f4f7` | prior + housekeeping |
| 6 Android share-target | `fix(FLOWS-1)` | prior batch |
| 7 Voice-note stall | `fix(VOICE-STALL)` | `48eed9b` |
| 8 Meetings parse union | `fix(MEETINGS-UNION)` | `e334c61` |
| 9 Card scan fields | `fix(CARD-FIELDS)` | `7fa0b45` |
| 10 Housekeeping | `fix(HOUSEKEEPING)` (+ Monday `4fd8553`, referral `de214e6`) | `174f4f7` |

Suite: **891 passing** (154 files); typecheck + lint clean. Migrations added:
0029 (password_resets), 0030 (email_log), 0031 (consent_version), 0032
(client title/email), 0033 (note sweep_attempts).

## TASK 1 — Email + password reset
- EmailSender port + stub (records, for tests) + AWS SES v2 adapter (injected
  client; only the adapter touches the SDK). `EMAIL_SENDER=stub|ses`.
- Password reset: single-use, 60-min, hashed-at-rest tokens; forgot-password
  always 200 (no enumeration); reset revokes every session + clears tokens; full
  web flow. All negative cases tested.
- Lifecycle emails composed + tested (welcome, trial-ending, trial-ended,
  payment-failed, subscription-confirmed, canceled, account-deleted), idempotent
  per (user, event). WIRED: reset + welcome-on-signup.
- **REMAINING (mechanical, on the tested service):** wire payment-failed /
  subscription-confirmed / canceled into `BillingService.handleWebhook`,
  account-deleted into `AccountService.deleteAccount`, and a trial-ending
  scheduled job (2 days before `trialEndsAt`). These need an email + user-email
  dependency inside those services.

## TASK 1d — Email verification (DECISION NEEDED)
Not implemented. Trade-off: verification improves deliverability of the
commercially-critical lifecycle emails and prevents mistyped-address lockout, but
adds signup friction. **Recommendation: soft verification** (full use + an
unverified banner + re-send). Awaiting Wabil.

## TASK 2 — Entitlement (full table in USER-FLOWS.md)
Only `/brief` was gated. Now server-enforced 402 (no data) on: brief, recall,
book-scan, monday, today + hero patterns/risk, follow-up, card-scan. Always open:
auth, capture (voice/paste/import), Settings, Billing, export, delete. Web shows
one `<Locked>` state on the primary gated views (Today, Ask, Monday, Book Scan).
- **Small follow-up:** a `<Locked>` on the embedded surfaces (brief panel,
  follow-up draft, card scan) — they are server-gated and fall back to their
  empty/error state today.

## TASK 4 — Legal (LAWYER REVIEW REQUIRED before go-live)
`/privacy` and `/terms` (+ `/ar` scaffolds) are structured skeletons with
`LAWYER REVIEW REQUIRED` markers covering data collected (incl. third-party
client messages in exports), sub-processors (AWS + region, Anthropic, Groq,
Stripe) + processing locations, retention, the training-log usage/retention,
export/deletion rights, and UAE contact. **A qualified UAE lawyer must complete
these before launch** — no legal text was invented.

## TASK 6 — Android share-target: IMPLEMENTED
The service worker (injectManifest) receives the share POST, stashes the `.txt`,
and routes into the import flow prefilled. On-device Android share + offline SW
behavior can only be fully verified on an installed PWA (deploy-time).

## TASK 10 — Story-ID additions for Wabil (user-stories file is guard-blocked)
Please add to `docs/tovira-user-stories.md`:
- **P4-SILENCE** — the push silence budget (max 2/rep/day, ranked). Currently
  documented only in `docs/tovira-brand.md`; used as a story ID in code.
- **P5-1-UI** — the trial-extension incentive UI (server-computed). Used in code.
- **Theme toggle** — the Vault/Ledger appearance control has no story ID and is
  omitted from the Settings section.

## Pre-launch checklist (owner: Wabil)
1. Decide email verification (soft recommended).
2. Complete Privacy & Terms with a UAE lawyer.
3. Wire the remaining lifecycle email event hooks (or accept reset+welcome for v1).
4. Fill SES (`EMAIL_SENDER=ses`, `EMAIL_FROM`, `SES_REGION`) + `APP_BASE_URL`.
5. Add the three story IDs above.
6. On-device: Android share-target + iOS push.
