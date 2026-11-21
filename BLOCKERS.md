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

## [P30] RESOLVED (owner, 2026-11-15, P70-4): Option B. Canonical and hreflang are absolute: https://tovira.io/ on the landing page, https://tovira.io/privacy and https://tovira.io/terms on the legal pages; [SITE-5] now pins the absolute URL
_Original entry, kept for the record:_ Landing canonical: relative "/" (pinned by [SITE-5]) vs absolute https://tovira.io/
`apps/web/index.html` has `<link rel="canonical" href="/">`, and `apps/web/src/marketing/a11y.test.ts`
([SITE-5]) pins exactly `'/'`. After the move to tovira.io, staging.tovira.io keeps serving the same page
(old invite links), and a relative canonical makes each host canonical to itself — so search engines may
index both. An absolute `https://tovira.io/` would consolidate them on tovira.io. Changing it means
changing the [SITE-5] test, which the rules forbid without an owner decision — so it is left as `/`.
The share tags (og:url, og:image, twitter:image) were made absolute (not pinned by any test).
  - Option A (keep): relative canonical; accept staging may be indexed until it is retired.
  - Option B: absolute `https://tovira.io/`, update [SITE-5] to pin that instead.
Recommendation: B (staging is a legacy alias now; tovira.io is the one public host).

## [P70-3] Next certification batch: "who really decides" is unreliable inside longer chats (logged, not fixed)
Owner, 2026-11-15: log for the next certification batch, don't fix now. The landing claim check (real model,
Sonnet 5, shipped prompt) caught "the CFO makes the call" (MD signs, CFO decides) as follows:
  - alone, one message (the B2B tab): 5/5.
  - inside an 8-message B2B chat, three versions: 2/5 (support worry said "she" right after it, so the two
    merged), 4/5 (reordered, with "the office is chaos this week"), 0/5 (same, with "noted").
It is only ever stored as a concern; there is no decision-maker field, so in a longer chat it is dropped.
The landing page no longer claims it inside a chat (game chat 4 now uses "Wants a named account manager";
"How it works" drops "who really decides"); the B2B tab and marquee keep "The CFO really decides" (5/5 alone).
  - To do in the next cert batch: add an eval fixture for it in apps/api/src/eval/eval-set.ts (CERT_SURFACE),
    next to the guessed-details / vague-date fixture ('unresolved-vague-date'): the 8-message chat above,
    expecting the decider captured. That changes the certified surface, so it needs the full certification run.

## [P71] Next certification batch: a bare budget is dropped (logged, not fixed)
Owner, 2026-11-17: log for the next certification batch, don't fix now. Budgets are one of the most useful things a
rep can know, so a bare budget should be stored. The landing claim check (real model, Sonnet 5, shipped prompt):
  - "budget is around 800 a month", inside a 6-message insurance chat: 0/5. Nothing about the budget was stored in
    any run (only the scuba-diving fact and its next step).
  - Cause: prompt rule 8 stores a requirement only when it is something the client wants found, so a budget not tied
    to a product is dropped. Tied to one, it is kept ("my husband signs off on anything over 3M": 5/5).
The landing game now ties both budgets to what the client wants ("I'm looking for a policy around 800 a month",
"I'm looking for something around 20k").
  - To do in the next cert batch: add an eval fixture with a bare budget in apps/api/src/eval/eval-set.ts
    (CERT_SURFACE), next to the decision-maker fixture above and the guessed-details / vague-date fixture
    ('unresolved-vague-date'): the insurance chat above with "budget is around 800 a month", expecting the budget
    stored. Rule 8 (prompt.ts, also CERT_SURFACE) would change with it, so it needs the full certification run.
  - Same pattern seen later in the same check (evidence for that fixture, nothing else to do): a plain company fact
    ("we're 40 people now, maybe 60 next year": 0/5) and a condition ("if it saves us one hire, it pays for itself":
    0/5) were never stored; stated as a need or a worry they were 5/5. A fact about "she" with no one named
    ("she only wears gold, never silver": 0/5) was never stored either; "my wife only wears gold, never silver" was 5/5.

## [P73] Next API batch: game score buckets as percentages (logged, not changed)
Owner, 2026-11-17: log for the next API batch, don't change it now. The landing game's score bucket (Admin → Funnel,
the game_done / game_cta / game_signup events) is fixed to a 12-detail game: '0-3', '4-6', '7-9', '10-11', '12'
(apps/web/src/marketing/game-track.ts bucketOf, apps/api/src/services/visits/game-events.ts bucketOf, and the CHECK in
migration 0116_game_events.sql). Since P73 an industry has 10 or 11 details, so a perfect score lands in '10-11' and '12'
can't be reached.
  - To do: change the buckets to percentages of that industry's total: '0-25%', '26-50%', '51-75%', '76-99%', '100%', so
    they work whatever the totals are. The page sends the bucket from score and total; the API accepts the new five;
    a new migration replaces the CHECK (keep the old values readable, or map them, for the rows already stored); the
    Funnel card's bucket labels follow. Tests first, as usual.

## [P83-6] "end of month" resolves today; the owner's note says it should stay null (needs an owner decision)
Owner, 21 Nov: "end of month must stay null (vague phrase; key M07)". The resolver does NOT leave it null today:
resolve-date.ts tryRelative has resolved "end of month" / "end of the month" (also after "by") to the last day of the
message's month since P16/P18, and the certified prompt (rule 2) lists "end of month" as a relative phrase to resolve.
So M07 ("if the bank approves by end of month we'll sign", sent 27 May) stores 2026-05-31 today. The same batch said
not to change anything that already resolves, so P83-6 left it as it is.
  - To decide: should "end of month" go to null + "date to confirm" (one line in tryRelative, plus a test from M07)?
    The answer key's M07 note says null; the prompt's rule 2 says resolve. Both touch what the gate scores
    (resolve-date.ts is in the gate's import graph), so a change runs the gate.
