# BLOCKERS

## Resolved

- **[P10 item 1] "Undo a move" cannot use `/notes/:id/undo` — that endpoint DELETES the note.**
  **Resolved (owner, P11): Undo-a-move = reverse move; /notes/:id/undo is import-undo only.**
  `/notes/:id/undo` is *import-undo*: `NoteMoveTx.undo` deletes the note and everything derived from it.
  So the Undo-move toast performs a **reverse move** (`POST /notes/:id/move {toClientId: <original
  client>}`), which restores the note, its facts, pointers, meetings and both clients' last-contact
  atomically. `/notes/:id/undo` stays reserved for undoing a whole *import*.

- **[TASK 2] Erasure window had no reject/withdraw state** — the lifecycle was only
  `pending | retention_asserted | completed`, so a restriction could end only by completion (erasure).
  **Decision (owner):** build `rejected` + `withdrawn` now (statuses + service methods + ops routes +
  a migration extending the `erasure_requests.status` CHECK constraint); restriction lifts on either.
- **[TASK 3] No in-app cancellation control vs Terms 6.5** — app had no cancel button / portal link /
  cancel route; Terms 6.5 says "cancel at any time from your account… access continues until the end of
  the period you have paid for." VAT is inclusive (decomposed, never added on top) and off by default.
  **Decision (owner):** build a **"Manage subscription"** button opening a **Stripe Customer Portal**
  session (cancel at period end, update payment method, invoice history); reuse the portal for the
  dunning "update your payment" link only if it can pay the open invoice with 3DS, else keep the hosted
  invoice page. Disclosure: prices include VAT, renews same date & time, cancel anytime from Billing,
  access continues to end of the paid period. Dashboard Customer Portal settings to be listed in the report.

## Resolved

- **Load-induced test-suite timing flakes** — `password.test.ts` `[LOGIN-TIMING]`,
  `share-referral.test.ts`, and `inventory-share.test.ts` intermittently failed the verify-on-stop full
  run under CPU contention (inflated wall-clock measurements; a starved scrypt signup returning a
  non-JSON body). **Fixed** by a sequential timing pool: those three files are excluded from the
  parallel `vitest.config.ts` and run alone, `fileParallelism: false`, in `vitest.timing.config.ts`,
  which `npm test` runs immediately after the main suite (so they still gate — locally and in CI, which
  invokes `npm test`). No assertion or timeout was changed; the timing tests' teeth were re-proven by
  mutation. See the `TIMING-POOL` commit.

## [P14-3] Ambiguous numeric dates: day-first vs month-first is a product decision (not resolved)
The deterministic date resolver (`resolve-date.ts`) resolves relative phrases against the message date
and resolves explicit numeric dates ONLY when the day/month order is forced (one component > 12, e.g.
`22/08/2026`). A fully-ambiguous numeric date where both components are ≤ 12 — `12/04/2026` is 12 Apr OR
4 Dec — stays **null**, exactly as the certified extraction prompt does (it refuses to guess a locale
because a WhatsApp export carries no reliable locale and the note origin is unknown).

The 14-Oct retest expected `12/04/2026 at 3pm` on a day-first (Android, UAE) device to resolve to 12 Apr.
Doing that requires a **day-first policy** for ambiguous numerics, which **contradicts the locked prompt
rule**. Per CLAUDE.md ("never invent a product decision; a wrong fact is worse than a missing one"), this
is left to the owner:
  - Option A (keep): ambiguous numeric → null + keep the raw phrase (current; safest, zero wrong dates).
  - Option B: adopt a documented day-first policy for the deterministic resolver (NOT the model), keyed
    off the rep's region/timezone (we store IANA tz per rep). Resolve `12/04/2026` → 12 Apr for a
    day-first rep, mark `resolution:'explicit'`. Risk: a month-first (US) rep's export mis-resolves.
Recommendation: Option B gated on a stored, explicit rep locale (not inferred), else Option A.

## [P30] Landing canonical: relative "/" (pinned by [SITE-5]) vs absolute https://tovira.io/ — owner call
`apps/web/index.html` has `<link rel="canonical" href="/">`, and `apps/web/src/marketing/a11y.test.ts`
([SITE-5]) pins exactly `'/'`. After the move to tovira.io, staging.tovira.io keeps serving the same page
(old invite links), and a relative canonical makes each host canonical to itself — so search engines may
index both. An absolute `https://tovira.io/` would consolidate them on tovira.io. Changing it means
changing the [SITE-5] test, which the rules forbid without an owner decision — so it is left as `/`.
The share tags (og:url, og:image, twitter:image) were made absolute (not pinned by any test).
  - Option A (keep): relative canonical; accept staging may be indexed until it is retired.
  - Option B: absolute `https://tovira.io/`, update [SITE-5] to pin that instead.
Recommendation: B (staging is a legacy alias now; tovira.io is the one public host).
