# BLOCKERS

## Open

- **[P10 item 1] "Undo a move" cannot use `/notes/:id/undo` — that endpoint DELETES the note.**
  Item 1 asks: after moving a misfiled note, show an Undo toast "calling `/notes/:id/undo`", then
  "undo, check restored". But `/notes/:id/undo` is *import-undo*: `NoteMoveTx.undo` deletes the note
  and everything derived from it (`notes.delete`, destructive step last) — it does NOT restore a moved
  note to its original client. Wiring it to an Undo-move toast would DELETE the rep's note on "undo",
  which contradicts "check restored" and violates "Never lose a recording" / "a wrong fact is worse
  than a missing one". **Decision taken (safe, internally consistent — flag for owner review):** the
  Undo-move toast performs a **reverse move** (`POST /notes/:id/move {toClientId: <original client>}`),
  which restores the note, its facts, pointers, meetings and both clients' last-contact atomically —
  exactly what "restored" means. `/notes/:id/undo` stays reserved for undoing a whole *import*. If the
  owner actually wants undo-move to delete, say so and I'll rewire; I will not delete on "restore"
  without that word.

## Resolved

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
