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

## [P83-6] RESOLVED (owner, 22 Nov): "end of month" keeps resolving to the last day of the month. No certification. The v1 answer key's M07 now expects 2026-05-31; nothing was re-scored.
Owner, 21 Nov: "end of month must stay null (vague phrase; key M07)". The resolver does NOT leave it null today:
resolve-date.ts tryRelative has resolved "end of month" / "end of the month" (also after "by") to the last day of the
message's month since P16/P18, and the certified prompt (rule 2) lists "end of month" as a relative phrase to resolve.
So M07 ("if the bank approves by end of month we'll sign", sent 27 May) stores 2026-05-31 today. The same batch said
not to change anything that already resolves, so P83-6 left it as it is.
  - To decide: should "end of month" go to null + "date to confirm" (one line in tryRelative, plus a test from M07)?
    The answer key's M07 note says null; the prompt's rule 2 says resolve. Both touch what the gate scores
    (resolve-date.ts is in the gate's import graph), so a change runs the gate.

## [P84-3] Next batch: Arabic and Hindi observance words on the precise list (logged, not built)
Owner, 22 Nov: the English observance words (Umrah, Hajj, fasting, Ramadan as an observance) are on the precise list
since P83-7. The Arabic and Hindi forms were left out because a plain word match cuts far too much. To add later, with
the same rule as English (an observance is withheld; a time anchor, a trip and a trade are kept):
  - Arabic: عمرة / العمرة, حج / الحج / حاج, صيام / صائم / صايم, رمضان only as an observance ("أنا صايم"), اعتكاف.
  - Hindi / Hinglish: उमरा, हज, रोज़ा / रोजा / roza / roze (rakha hai), उपवास / व्रत / vrat / upvas, "fast rakha hai".
  - False-match tests to write first (each must stay unchanged, nothing cut):
    - "بعد رمضان نوقع العقد" (after Ramadan we sign: a time anchor)
    - "رجعنا من العمرة امس" (back from Umrah: a trip)
    - "عندنا باقات عمرة للعائلات" (Umrah packages: the trade) and "مكتب حج وعمرة" (a Hajj and Umrah office)
    - "الحاج محمد" (Hajji as an honorific for a person's name)
    - "حجز" / "حجزت الشقة" (booking: shares the letters ح ج)
    - "रोज़ाना डिलीवरी" / "roz delivery" (daily: shares the stem of roza)
    - "हज़ार" / "hazaar" (thousand: shares the letters of हज)
    - "vrat ke baad milte hain" (a time anchor, kept) vs "aaj mera vrat hai" (an observance, cut)
  - Positive tests: "أنا صايم اليوم", "رايحين عمرة في فبراير فبنكون مسافرين", "मेरा रोज़ा है", "hum Umrah pe ja rahe hain".
  - Only removal, never a word added or changed (P69-14). screening/precise-screen.ts is in the gate's import graph,
    so the batch runs the gate.

## [P85] Before January 2027: move the API runtime from Node 20 to Node 22 (logged, plan only, not done)

**Why.** Every API boot (the service and the backfill task alike, seen in /tovira/prod/api on 23 Nov) logs: "NodeVersionSupportWarning: The AWS SDK for JavaScript (v3) versions published after the first week of January 2027 will require node >=22. You are running node v20.20.2." (Node 20 itself reached end of life in April 2026.) Upgrade before January 2027 so the SDK keeps shipping fixes to us.

**Where Node 20 is pinned today.**
- `docker/api.prod.Dockerfile` (both stages: `node:20-bookworm-slim`), `docker/api.Dockerfile`, `docker/web.Dockerfile`.
- GitHub Actions `node-version: 20`: ci.yml (5), deploy.yml (3), extraction-gate.yml (1).
- `package.json` engines `"node": ">=20"` (raise to `>=22`).
- To check in the infra folder (human-gated): any Lambda runtime such as `nodejs20.x` (the stub EventBridge Lambda).

**Plan (one batch, owner approves the push).**
1. Local: switch to Node 22, `npm ci`, then the full verify (typecheck, lint, unit, integration, Playwright). Watch the native and Node-sensitive pieces: pg, scrypt hashing, `fetch`/undici behaviour, `node:test` helpers, timers in the suite.
2. Bump the three Dockerfiles to `node:22-bookworm-slim` and all workflow `node-version` pins in the same commit, plus engines.
3. Build the arm64 prod image in CI as usual (a real rebuild, not a retag). Boot checks: migrations run, `/api/health` 200, `/api/version` shows the build, the scheduled brain's `jobs[]` present, one backfill task run shows no Node 20 warning.
4. Any Lambda on `nodejs20.x`: change through provision.yml (plan, show the owner, apply on their yes).
5. Rollback: redeploy the previous commit through Deploy (the Node 20 image is still in ECR).

**Not now.** Owner, 22 Nov: plan only.

## [P87-3] Erasure: alerts and pointers built from a restricted person's words without naming them (fixed 25 Nov)

- What leaked, while an erasure window was open: a notification written before the window that quoted the person without naming them (fixed in P86); a stored pointer read from their own message whose wording did not name them, in the pre-meeting brief, the client's pointer card and (from 27 Oct) the data export; and the daily digest's count included a cached Today item the restriction withholds (a number, no words). Since the restriction shipped on 5 Oct 2026 (31ddbde).
- Nobody was exposed in prod, as far as the database can show. The gap shows something only while an erasure request is open. Prod check on 26 Nov (`erasure-exposure-check`, read-only): 0 erasure requests stored (all statuses), 0 completed erasures on record (receipts outlive account deletion), 0 erasure audit rows. Prod has 2 accounts: the one account the 18 Nov clean-up kept (created 1 Nov) and the owner's, created 19 Nov. Limit: a request is deleted with its account, so a request opened and then withdrawn, on one of the 13 accounts deleted on 18 Nov, would leave no trace. The API logs keep 30 days and cannot rule it out. Tests: http/erasure-unnamed-sources.test.ts, services/erasure/withheld-alerts.test.ts.

## [P88-2 → next gated deploy] Restriction registry and the unnamed-words fix, held (26 Nov)

Committed as 526a934 on the local branch `p88-2-restriction-registry`, not pushed: it changes `services/erasure/restrict-note.ts`, `services/erasure/surface-filter.ts` and `services/promises/kept-suggestion-service.ts`, which are in the extraction gate's import graph, so pushing it runs the gate (about AED 5 to 13). Full suite and Playwright green on the branch.
- Live in prod until it ships, each only while an erasure request is open (prod has none, 26 Nov): a note's own model output read from the restricted person's messages (summary, concerns, next steps, and the note's copies of each promise, key date, requirement, meeting and pointer, which quote their message word for word) on the client page, the brief, the notes list, Today's "cares" line and the export; the "Move it?" card naming them; a kept-promise suggestion whose delivery message is theirs when the promise is someone else's; old Ask answers quoting them in the export.
- Also on the branch: the restriction registry (`services/erasure/restriction-registry.ts`) and its guard, the P47 fixture carrying the unnamed class, and a CI step comparing the registry with a migrated real Postgres.
- To ship: merge the branch into main and push with the next change that runs the gate anyway, or on its own with the owner's yes.

## [P86 → next gated deploy] Two N+1 loops held back because they sit in the extraction gate's import graph

Ship both with the next change that runs the gate anyway (each spends a gate run on its own, about AED 5 to 13). Both are on the `ALLOWED` list in `db/n-plus-one.guard.test.ts`, marked HELD; remove them there when fixed.
- `services/extraction/extraction-service.ts` `detectAndStoreMisfile`: reads each candidate client's notes one client at a time after every extraction. Fix: `listForClients` (services/notes/list-for-clients.ts).
- `services/recall/structured-recall.ts` `forUser`: reads notes and requirements per client. Fix: `listForClients` for both.
- With them: give `InMemoryNoteRepository` and `InMemoryRequirementRepository` (also in the graph) a `listByClients`, and add it to the note port, like the Postgres repositories have.

## [P86] Indexes nothing uses (report only, nothing dropped)

No app query filters or sorts on these on the seeded audit database; each still costs a write. Re-check after 30 days of real usage with `SELECT relname, indexrelname, idx_scan FROM pg_stat_user_indexes WHERE idx_scan = 0 ORDER BY relname;` (run on prod by the owner), and drop only what is still at zero, in a no-transaction migration (`DROP INDEX CONCURRENTLY IF EXISTS`; the runner would need to allow it).
- `access_requests_work_email_idx`
- `extraction_logs_created_at_idx`
- `model_call_events_period` and `model_call_events_user_period`: the table is an audit log; the AED gate and the failsafe total a rep's spend from `ai_usage_month` and `spend_ledger`, and every read of the log is by time range, by conversation, or the whole table (the admin cost report)
- `revenue_events_user_period`
- `transcription_events_user_period`
- `hot_leads_became_hot`: the list sorts `became_hot_at DESC NULLS LAST`, which this index (`DESC`, nulls first) cannot serve; `hot_leads_status_hot_idx` (P86) does
