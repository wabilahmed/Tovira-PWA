# Tovira — Acceptance Criteria & Tests

*For every user story: detailed acceptance criteria, positive tests (correct behaviour on valid input, including meaningful variations), and negative tests (wrong input, edge cases, security boundaries, and explicit "must-not-do" behaviours). Tests are written to catch real failure modes and encode Tovira's principles — not to pad coverage.*
Last updated: 2026-07-09

Legend: **AC** = acceptance criteria · **✓** = positive test · **✗** = negative test. Each test reads *scenario → expected result*.

---

## Phase 0 — Local foundations & skeleton

### [P0-1] One-command local environment
**AC**
- `docker compose up` starts Postgres+pgvector, backend, and web app; all report healthy.
- pgvector extension is present; migrations apply on boot; data survives restart via a named volume.

**✓ Positive**
- Run `docker compose up` on a clean checkout → all three services reach healthy state with no manual steps.
- `SELECT * FROM pg_extension WHERE extname='vector'` → returns one row.
- Stop and restart the stack → previously seeded rows are still present (volume persists).
- Edit a backend source file → change is live without a full rebuild (hot reload).

**✗ Negative**
- Start with a required env var missing → stack fails fast with a named, actionable error, not a silent crash or a half-up state.
- Host port already in use → clear port-conflict message, not a hang.
- Corrupt/parseless migration → boot aborts and reports the offending migration; DB is not left half-migrated.

### [P0-2] Swap-ready interfaces
**AC**
- Auth, model calls, storage, and scheduler are each accessed only through an interface with a local implementation.
- Switching an implementation needs no change to business-logic code.

**✓ Positive**
- Grep the codebase → business logic imports the interface, never a concrete vendor SDK directly.
- Swap the AI implementation from "Anthropic API" to a stub returning canned JSON via config only → extraction flow still runs, no code edits.

**✗ Negative**
- Introduce a direct vendor SDK call inside business logic → a lint/architecture test fails the build.
- Point the model interface at an unreachable endpoint → the interface surfaces a typed error; the caller handles it (no unhandled crash leaking vendor internals).

### [P0-3] Sign up & log in
**AC**
- Signup, login, logout work; session persists across refresh; unauthenticated API calls are rejected.

**✓ Positive**
- New email + valid password → account created, logged in, session cookie/token issued.
- Refresh the page while logged in → still authenticated.
- Log out → session invalidated; protected routes redirect to login.

**✗ Negative**
- API request with no/invalid/expired token → 401, no data returned.
- Signup with an already-registered email → rejected with a clear message; no duplicate account.
- Wrong password → login fails; error does not reveal whether the email exists (no user enumeration).

### [P0-4] Tenant isolation
**AC**
- Every table carries `user_id`; Row-Level Security enforces isolation at the DB, independent of app-layer filters.

**✓ Positive**
- Rep A creates a client → it appears in A's list.
- Query as Rep A → returns only A's rows across every table.

**✗ Negative** *(the important ones — these encode the isolation principle)*
- Rep A requests Rep B's client by its exact ID/URL → 404/403, never the record (guards against IDOR).
- In Rep A's DB session, run a raw query for Rep B's `user_id` with the app filter removed → **zero rows** (proves RLS enforces it, not just app code).
- Rep A attempts to create/patch a row carrying Rep B's `user_id` → rejected or forced to caller's id; A can never write into B's data.
- Deliberately drop the app-layer `WHERE user_id` filter in a test build → isolation still holds because of RLS (regression guard).

### [P0-5] Installable PWA shell
**AC**
- App is installable; service worker registers; app shell loads offline.

**✓ Positive**
- Load on a secure context → install prompt available; service worker activates.
- Go offline → app shell still renders (no blank page).

**✗ Negative**
- Ship a new build → returning users get the new version, not a stale cached shell (update strategy works).
- Service worker fails to register → app still loads (degrades, doesn't white-screen).

### [P0-6] Seed data
**AC**
- Realistic fixtures load on demand (clients, notes, extracted facts) for fast iteration.

**✓ Positive**
- Run the seed command → a set of clients with varied, realistic notes exists.
**✗ Negative**
- Run seed twice → no duplicate/inconsistent data (idempotent) or a clear reset step.

---

## Phase 1 — The spine ★ CORE

### [P1-1] Create a client
**AC**
- A rep can create and name a client; it appears in their list; it is owned only by them.

**✓ Positive**
- Create "Meridian Corp" → appears in my list immediately.
- Create two clients with the same name → both allowed, distinguishable (no false uniqueness constraint).

**✗ Negative**
- Create with an empty name → rejected with a validation message.
- Create while logged out → 401, nothing created.
- Rep B never sees Rep A's newly created client.

### [P1-2] Fast client selection
**AC**
- Recents surface first; search by name works; defaults to last-touched; reaching capture takes minimal taps.

**✓ Positive**
- Open capture → the most recently touched client is pre-selected/top of list.
- Type a partial name → matching clients filter in as you type.
- Client touched most recently ranks above older ones.

**✗ Negative**
- Search with no matches → clear "no results", not a spinner or error.
- 500+ clients → list/search stays responsive (performance budget met, not visibly laggy).
- Selecting a client never requires more than the agreed max taps (guards the capture-friction principle).

### [P1-3] Record a voice note
**AC**
- Records in-browser; raw audio persisted immediately and survives refresh/crash; upload is reliable with visible state.

**✓ Positive**
- Record 30s → audio saved under the selected client; playable back.
- Record, then refresh mid-upload → recording is still present and completes upload.

**✗ Negative** *(encodes "never lose a recording")*
- Network drops mid-upload → recording is queued and retried; user sees a "pending upload" state; audio is not lost.
- Kill the tab right after stopping recording → on reopen, the recording is recoverable (persisted before upload confirmation).
- Upload fails permanently → user is notified and the audio is retained for retry — never silently discarded.
- Deny microphone permission → clear guidance shown; app doesn't crash or appear to record silently.

### [P1-4] Paste a message
**AC**
- Pasted text is stored raw under the selected client.

**✓ Positive**
- Paste a WhatsApp thread → stored verbatim under that client, then queued for extraction.
- Paste text with emojis/line breaks → preserved intact.

**✗ Negative**
- Paste empty/whitespace → rejected, nothing stored.
- Paste an extremely long thread → handled (chunked or accepted up to a stated limit), no truncation-without-warning.

### [P1-4b] Import a WhatsApp chat export
**AC**
- Accepts WhatsApp Export Chat .txt; parses `[date] Name: message` lines into per-message, speaker-attributed records under the selected client; raw file persisted before parsing; explicit consent shown at upload.

**✓ Positive**
- Upload a real-format export with two speakers over 3 months → messages stored with correct sender + timestamp, in order, under the right client.
- Multi-line messages (a message containing line breaks) → kept as one message, not split.
- After import → batch extraction runs and facts appear like any other input.

**✗ Negative**
- A non-WhatsApp .txt (random text) → rejected with a clear "doesn't look like a WhatsApp export," nothing stored as messages.
- An export "with media" (media placeholders present) → placeholders handled gracefully, not stored as garbage facts.
- Upload without confirming consent → import does not proceed.
- A parse failure mid-file → no partial client history written; the file is flagged, not half-imported.
- Another rep can never access the uploaded file or its messages (isolation).

### [P1-5] Transcribe voice
**AC**
- Audio → Groq/Whisper → transcript stored; typical 30–60s notes handled.

**✓ Positive**
- Clear 45s note → accurate transcript stored and linked to the note.
- Note with sales jargon → transcript is usable (feeds extraction acceptably).

**✗ Negative**
- Transcription API errors/times out → note is not lost; marked "transcription pending" and retried, not dropped.
- Silent/empty audio → produces empty transcript handled gracefully (no crash, note flagged).
- Very noisy audio → low-quality transcript still stored and flagged, not silently discarded.

### [P1-6] Extract structured facts
**AC**
- Output validates against the v0.1 schema (all keys present, correct types).
- Explicitly stated promises captured with correct `owner`; relative dates resolved against the supplied today's date; unresolvable dates → `null` with `due_raw` kept.
- People, personal facts, concerns, meeting captured per schema.
- Nothing unstated is fabricated.
- Cacheable prefix ≥4,096 tokens; today's date only in the variable message.
- Malformed model output retried once, then the note flagged — never a partial write.

**✓ Positive**
- "I'll send the revised quote by Friday" with today = 2026-07-09 → a promise {owner: rep, due_date: 2026-07-10, confidence: high}.
- "Jordan, the VP, is the one who signs off" → `people` has Jordan with `decision_role: decision_maker`.
- "her son just started college" → `personal_facts` has a family fact for the correct subject.
- "can we do a call Thursday 3pm" → `meeting.datetime_raw = "Thursday 3pm"`, `confirmed: false`.
- Two identical-prefix calls in a row → response usage shows cache *write* on the first, cache *read* on the second (caching is actually active).

**✗ Negative** *(these encode "a wrong fact is worse than a missing one")*
- A pure catch-up note with no commitment → `promises: []` (does **not** invent a promise).
- "maybe we should loop in finance" → lands in `next_steps`, **not** `promises` (soft vs firm).
- "sometime after the holidays" → `due_date: null`, `due_raw` preserved (**no** guessed date).
- Model returns invalid JSON → system retries once; on second failure writes **no** structured rows and flags the note (no partial data).
- Put today's date into the cached prefix (fault injection) → the next call is a cache miss (regression guard: date must stay variable).
- "Sarah" and "Sara" mentioned without clear identity → **not** silently merged into one person.
- (Multilingual ✓) A voice note switching Arabic→English mid-sentence with a promise stated across the switch → the promise is extracted correctly.
- (Multilingual ✓) A pasted Hindi–English WhatsApp thread with a date in one language and the commitment in another → both captured and linked.
- (Multilingual ✗) Code-switched input never causes silent field-dropping — if the model can't parse a segment, the item is flagged low-confidence, not omitted without trace.
- (Unanswered questions, chat input) Client asks "can you do bulk pricing?" and the thread ends → flagged as an unanswered client question, quoting the message.
- (Unanswered questions) Client asks and the rep replies substantively after → **not** flagged (no false accusations).
- A prompt/example block under 4,096 tokens → test asserts caching does not silently no-op (build warns).

### [P1-7] Flag uncertainty
**AC**
- Low-confidence items and unresolved dates are marked for confirmation, not acted on silently.

**✓ Positive**
- Ambiguous owner of a promise → item stored with `confidence: low` and queued for confirmation.
- Unresolved relative date → flagged for the rep to set.

**✗ Negative**
- A low-confidence item is never used to fire an alert or a reminder before confirmation.
- Nothing marked low-confidence is displayed in the brief as a settled fact.

### [P1-8] Log every extraction
**AC**
- Each call writes a log row with input, output, model, and prompt version.

**✓ Positive**
- Run an extraction → exactly one log row with input, raw output, model id, and `prompt_version`.
- Change the prompt and run again → new rows carry the new `prompt_version`.

**✗ Negative**
- Extraction fails → a log row still records the attempt + failure (so failures are analysable), without partial structured writes.
- Log rows are not readable across tenants (the log is PII — isolation applies here too).

### [P1-9] ★ Extraction quality gate
**AC**
- A curated eval set of real, messy notes exists with a known "correct" extraction, **including code-switched Arabic–English–Hindi–Urdu notes** (multilingual is a locked requirement — proven here, not assumed).
- Precision/recall on promises, dates, and people is measured; a pass threshold is defined; the model decision is recorded. Phase 2 does not start until it passes.

**✓ Positive**
- Run the eval harness on Haiku and on Sonnet → produces precision/recall numbers per field for each.
- On the eval set, promises precision meets the agreed bar (e.g. no fabricated promises across the set).

**✗ Negative**
- If any note yields a fabricated promise or a guessed date, the gate is marked **not passed** (the harness flags it, not a human eyeballing).
- Regression guard: a later prompt edit that drops recall below threshold fails the gate in CI.

---

## Phase 2 — The payoff (pre-meeting brief)

### [P2-1] Pre-meeting brief
**AC**
- Brief assembles from spine + JSONB + semantic search over past notes; shows recent context, open items, key people, personal notes; loads fast.

**✓ Positive**
- Client with several logged notes → brief shows their open promises, latest concern, decision-maker, and a personal note.
- A past note only semantically related (different words, same theme) is surfaced via vector search.
- Brief renders within the agreed latency budget.

**✗ Negative**
- Client with no data yet → brief shows an honest "nothing logged yet", not a fabricated summary.
- An unconfirmed low-confidence fact does not appear as settled in the brief.
- Semantic search returns nothing relevant → brief omits that section rather than padding with unrelated notes.

### [P2-2] Client timeline
**AC**
- All logged interactions for a client are viewable in chronological order.

**✓ Positive**
- Open timeline → notes appear newest-first with dates and source (voice/paste).
**✗ Negative**
- Another rep's notes never appear in this client's timeline.
- A note mid-processing shows a clear "processing" state, not a blank/broken entry.

### [P2-3] Confirm & correct
**AC**
- Low-confidence items, unresolved dates, and meetings surface with one-tap confirm/edit; corrections are saved and captured as training data.

**✓ Positive**
- Confirm a flagged promise → it becomes active and can drive reminders.
- Edit a wrong extracted name → corrected value saved; a correction record is written to the training log with before/after.

**✗ Negative**
- Reject an extracted item → it is removed and never surfaces again for that note.
- A correction is not double-counted or lost on refresh.
- Corrections respect isolation (only the owning rep can confirm/edit their items).

### [P2-4] No guesses as facts
**AC**
- Uncertain items are visibly marked or withheld; the brief never presents a guess as a fact.

**✓ Positive**
- A `confidence: low` item shown in review is visually distinct (e.g. "needs confirming").
**✗ Negative**
- No item lacking confirmation is rendered in the client-facing brief as a plain fact.
- A resolved-to-null date never displays a made-up specific date.

---

## Phase 3 — Proactive layer (know when)

### [P3-1] Add a meeting
**AC**
- Meetings can be created and client-tagged directly, or via natural language parsed by the engine and confirmed before saving.

**✓ Positive**
- Create "Meridian, Fri 10am" via form → appears on the calendar tagged to Meridian.
- Say "meeting with Sarah next Tuesday 3pm" → parsed to the correct date/time, shown for confirmation.

**✗ Negative**
- Ambiguous NL ("meeting sometime next week") → asks for specifics rather than inventing a time.
- "meeting with Sarah" when two clients named Sarah exist → prompts which one; does not silently pick.
- Reject the parsed meeting → nothing is saved to the calendar.

### [P3-2] Pre-meeting nudge
**AC**
- The rep receives a reminder ahead of a scheduled meeting, timed to a configurable lead.

**✓ Positive**
- Meeting in the nudge window → a nudge is generated once, linking to that client's brief.
**✗ Negative**
- No duplicate nudge for the same meeting (idempotent).
- A cancelled/deleted meeting produces no nudge.

### [P3-3] Going-cold alert
**AC**
- Configurable threshold; daily scan; alert generated when last-contact exceeds it; idempotent.

**✓ Positive**
- Client with last contact older than the threshold → appears as going-cold after the scan.
- Log a new interaction → the client drops off the cold list.

**✗ Negative**
- Client contacted within the threshold → **no** alert.
- Re-running the scan the same day → does not re-fire an already-sent alert (no double-send).
- Threshold change to a larger value → previously-cold clients recompute correctly.

### [P3-4] Date reminders
**AC**
- Birthdays, anniversaries, and launches generate timely reminders.

**✓ Positive**
- A stored birthday one day out → reminder generated.
**✗ Negative**
- A date with a `null` resolved value (only `date_raw`) → no misfired reminder on a wrong day; it's surfaced for the rep to set instead.
- Past one-off dates don't re-fire every year unless they're recurring by type.

### [P3-5] In-app cold list (fallback)
**AC**
- An in-app list of cold clients exists independent of push.

**✓ Positive**
- With notifications disabled entirely → the rep can still open the app and see who's going cold.
**✗ Negative**
- Push delivery failure → value is still reachable via the in-app list (not push-dependent).

### [P3-7] Chat refresh nudges
**AC**
- After a configurable staleness gap, a refresh nudge fires for that client; re-import dedupes; only new content is extracted; Book Scan re-runs on the fresh slice.

**✓ Positive**
- Client whose last import exceeds the gap → one nudge generated, naming the client.
- Re-import an export overlapping the previous one → overlapping messages stored once; only the new tail is extracted; scan reveals only new findings.
**✗ Negative**
- Re-importing the identical file twice → zero duplicate messages, zero duplicate extracted facts (idempotent).
- A recently refreshed client → no nudge (respects the gap).
- The nudge is not re-fired daily for the same staleness (no nagging).

### [P3-8] Monday Morning Scan
**AC**
- Runs weekly (Mondays); digests promises due this week, cooling clients, unanswered questions, upcoming dates; idempotent; in-app fallback.

**✓ Positive**
- A rep with 2 promises due and 1 cooling client → Monday digest lists exactly those, with links into each item.
- Digest is viewable in-app even with push disabled.
**✗ Negative**
- Re-running the Monday job the same day → no second digest (idempotent).
- A week with nothing due → an honest light digest ("clear week"), never padded with stale or fabricated items.
- Digest items never include another rep's data.

### [P3-6] Enable notifications in onboarding
**AC**
- Onboarding walks the rep through home-screen install and enabling notifications (critical on iOS).

**✓ Positive**
- Complete onboarding on iOS → app is installed to home screen and a test notification is received.
**✗ Negative**
- Rep skips install → they're clearly told notifications won't work until installed, and the in-app fallback is pointed out (no silent dead feature).

---

## Phase 4 — Feature completion

### [P4-1] Open promises tracker
**AC**
- Aggregates `promises` across all clients; shows due date + status; can mark done.

**✓ Positive**
- Promises from three different clients → all appear in one list, sorted by due date.
- Mark one done → it leaves the open list and is timestamped.

**✗ Negative**
- A rejected/deleted promise never appears in the tracker.
- Another rep's promises never appear.
- A promise with a null due date is shown as "no date", not sorted as if due today.

### [P4-2] Stakeholder map
**AC**
- Shows people for a client with roles and reporting/decision relationships.

**✓ Positive**
- Notes mentioning "Jordan (VP, signs off)" and "Sarah (influencer, reports to Jordan)" → map shows the link and roles.
**✗ Negative**
- A person with unknown role shows `unknown`, not a fabricated title.
- Two distinct people aren't merged unless clearly the same.

### [P4-3] Personal-facts memory
**AC**
- Personal facts for a contact are surfaced, attributed to the right person.

**✓ Positive**
- "her son started college" → shown under the correct contact as a family fact.
**✗ Negative**
- A fact about one person is never shown under a different person.
- No sensitive fact is invented from an unrelated note.

### [P4-4] Follow-up draft
**AC**
- Generates an editable follow-up from a note, in the rep's tone; can copy/send.

**✓ Positive**
- A post-meeting note → a coherent draft referencing what was discussed and the promised next step.
**✗ Negative**
- The draft doesn't state commitments the rep never made (no invented promises in outgoing text).
- Nothing is auto-sent without the rep's explicit action.

### [P4-5] Business-card scan
**AC**
- Photo → vision model → structured contact; confirmed before save.

**✓ Positive**
- Clear card photo → name, title, phone, email extracted and shown for confirmation.
**✗ Negative**
- Blurry/partial card → fields it can't read are left blank, not guessed; rep can fill them.
- Non-card image → detects it isn't a card rather than inventing a contact.
- Nothing saved until the rep confirms.

### [P4-6] Client gallery
**AC**
- Per-client image storage; images live server-side (S3 at deploy), not only on device.

**✓ Positive**
- Upload an image → appears in that client's gallery and persists across devices/logins.
**✗ Negative**
- Another rep can't access the image via its URL/ID (authorised access only).
- Upload failure → clear error; no broken thumbnail left behind.

### [P4-7] WhatsApp send loop
**AC**
- One tap on a draft opens WhatsApp via wa.me deep link with the message pre-filled; Tovira never sends anything itself.

**✓ Positive**
- Tap "send via WhatsApp" on a draft → WhatsApp opens with the exact draft text pre-filled (correct URL-encoding of emojis, line breaks, Arabic text).
**✗ Negative**
- No message is ever sent without the rep tapping send inside WhatsApp (Tovira has no send path — asserted by design/test).
- Editing the draft then tapping → the edited text is what's pre-filled, not a stale version.

### [P4-8] Conversational recall
**AC**
- Voice/text questions answered from retrieval (capped top-k); every answer cites receipts; empty retrieval → honest "I don't have that."

**✓ Positive**
- "What did Ahmed say about pricing?" with a matching note → answer quotes the actual message with its date.
- Asked by voice → transcribed, answered the same as text.
**✗ Negative** *(the trust rules under interrogation)*
- A question about something never discussed → "I don't have that on record" — no fabricated answer (asserted against a fixture set).
- The answer never cites a receipt that doesn't exist (every cited quote must match a stored message verbatim).
- Retrieval never crosses tenants; asking about another rep's client returns nothing.
- Retrieval is capped (top-k) — a question over a huge book doesn't trigger an unbounded-context call (cost guard).

### [P4-9] Personalized extraction
**AC**
- Per-rep glossary built from corrections; injected into the VARIABLE prompt section only; improves that rep's extraction.

**✓ Positive**
- Rep corrects "Meridian" twice from a mis-transcription → the glossary carries it, and the next note containing the garbled form extracts the right client name.
**✗ Negative**
- The cached prefix remains byte-identical after glossary injection (cache-hit regression test — the glossary must never break caching).
- One rep's glossary never influences another rep's extraction (isolation).
- A glossary entry never overrides an explicit statement in the note (the note wins over the profile).

### [P4-11] Recovered Value Ledger ★
**AC**
- Records only real value-touch events; monthly + renew-moment summary; "touched" language; AED only from rep-entered deal values; every entry links to its event.

**✓ Positive**
- Scan flags a dead thread → rep sends a message to that client afterwards → a "thread reopened" ledger entry appears, linked to the thread.
- Rep marks a promise done before its due date → "promise kept" entry.
- Rep enters a deal value for a client → AED totals include it from then on.
**✗ Negative** *(honesty rules — the ledger must never oversell)*
- A flagged thread the rep never re-engaged → NO ledger entry (flagging alone is not value).
- No client deal values entered → the summary shows event counts only; NO AED figure anywhere (never estimated).
- Ledger copy never uses "closed," "won," or causal claims — asserted over rendered output.
- Deleting the underlying event removes the ledger entry (no orphaned value claims).
- The renew-moment summary never inflates: totals recompute from stored events, not a cached counter.

### [P4-10] Corpus-value visibility
**AC**
- An accurate "X months, Y moments" stat, updating as the bank grows.

**✓ Positive**
- After importing 3 months of history + 10 notes → the stat reflects the true span and count.
**✗ Negative**
- The stat never inflates (deleted content decrements it; failed imports don't count).

---

## Phase 4b — Hero features (the hook) ★

### [P4b-1] Cross-client pattern intelligence ★
**AC**
- Surfaces patterns across the rep's whole book; each pattern cites its supporting deals/signals; confidence is stated honestly.
- Only computed/shown above the volume threshold.

**✓ Positive**
- A rep whose last 3 stalled deals all stalled after a pricing objection with no decision-maker contact → Tovira surfaces that pattern, listing those 3 deals as evidence.
- A rep with a strong close-rate correlation (e.g. meeting the decision-maker early) → pattern surfaced with the supporting deal set.
- Clicking a pattern → shows exactly which clients/signals produced it.

**✗ Negative** *(these encode "a wrong pattern is worse than a missed fact")*
- Rep with 2 clients and 5 notes → **no patterns shown at all** (below threshold; locked state instead of noise).
- A "pattern" supported by a single deal → **not** surfaced (thin-sample guard).
- A pattern is never stated as fact without its evidence attached (test asserts evidence is non-empty for every displayed pattern).
- A low-confidence / thin-sample pattern never fires a notification or a risk alert.
- Correlation is not presented as causation in the copy (no "you lose deals *because* X" from correlation alone).
- Patterns never draw on another rep's data (isolation holds across the pattern engine).

### [P4b-2] Deal-risk radar
**AC**
- Flags slipping deals from cross-client patterns; shows *why*; volume-gated.

**✓ Positive**
- A deal matching a known stall pattern (silence + missed promise + no decision-maker) → flagged as at-risk, with the reasons listed.
- Rep logs a new interaction that resolves the signal → the deal drops off the radar.

**✗ Negative**
- Below the volume threshold → radar is inactive, not guessing.
- A healthy, recently-advanced deal is **not** flagged (no false-alarm spam — measured against a fixture set).
- The reason shown always maps to real underlying signals (no unexplained "this deal is risky").

### [P4b-3] What should I do today?
**AC**
- Always on; ranks highest-leverage actions across all clients; degrades gracefully with thin data.
- **Precomputed nightly; app-opens serve the cached result** (cost guard #3).

**✓ Positive**
- Brand-new rep with a few promises and one meeting → still gets a sensible ranked list (basics only).
- Rep with rich history → list incorporates pattern-derived priorities.
- The nightly job computes the list once; a later app-open renders it with **zero new model calls** (asserted via call-count instrumentation).

**✗ Negative** *(cost guards — these protect the margin)*
- Opening the app 10 times in a day → still exactly ONE priorities computation for that day (call-count asserted).
- Manual refresh is rate-limited — hammering refresh cannot trigger unbounded model calls.
- With zero data → shows an honest empty/onboarding state, not fabricated tasks.
- Completed items don't reappear the next day.
- Never surfaces another rep's actions.

### [P4b-4] Volume gate & warming-up state
**AC**
- Below threshold: a clear state explaining exactly what unlocks patterns. Above: features activate.

**✓ Positive**
- Rep below threshold → sees "warming up" with concrete unlock criteria (e.g. how many more clients/interactions).
- Rep crosses the threshold → features activate on the next computation, and the rep is told.

**✗ Negative**
- The gate cannot be bypassed by the client (server-side enforced) — a crafted request can't force patterns on thin data.
- The locked state never shows a teaser "sample pattern" fabricated from insufficient data.

---

## Phase 5 — Monetization & launch readiness

### [P5-1] Free trial
**AC**
- 7-day trial starts at signup with full access; at day 7 it converts to paid (**AED 299/mo**) or locks.
- **Trial seeding is bounded** (cost guard #4): a per-trial extraction ceiling, generous enough for the Book Scan on several chats.

**✓ Positive**
- New signup → full feature access; trial end date = signup + 7 days.
- Add a card during trial → converts to paid at AED 299/mo at day 7 seamlessly.
- A trial user imports 3 chats and gets full Book Scans — comfortably inside the ceiling.
- Capturing notes on 3 distinct clients → trial end date extends by exactly 7 days, once, with a clear in-app confirmation.

**✗ Negative**
- Day 8 with no payment → access is locked (or restricted to the agreed state); the rep can't keep using paid features free.
- Deleting/recreating an account doesn't grant a fresh trial (no trial farming) — tied to a durable identifier.
- A trial account attempting to import an extreme volume (e.g. 50 chats) hits the ceiling with a clear message — extraction stops, nothing breaks, and the ceiling is enforced **server-side**.
- The +7 extension cannot be earned twice (re-qualifying does nothing), cannot be triggered client-side, and 3 notes on ONE client do not qualify (3 distinct clients required).

### [P5-2] Subscribe & manage billing
**AC**
- Stripe Checkout charges **AED 299/mo in AED** (never USD — charging in AED avoids the 1% FX fee); subscription state driven by webhooks as source of truth; failed payments handled; Stripe Billing (0.7%) is part of the fee model.

**✓ Positive**
- Complete Checkout → `checkout.session.completed` webhook flips the account to active.
- Cancel in the portal → `customer.subscription.deleted` webhook downgrades access.

**✗ Negative** *(encodes "webhooks, not the client, are the source of truth")*
- Client-side "success" redirect **without** a corresponding webhook → account is **not** marked paid (can't spoof access by hitting the success URL).
- Failed renewal payment → account moves to past-due/locked per policy; access isn't left open indefinitely.
- Replayed/duplicate webhook → processed idempotently (no double-provisioning); invalid signature → rejected.

### [P5-3] Day-one seeding via WhatsApp export
**AC**
- Onboarding walks the rep through exporting ONE chat and uploading it; the Book Scan fires on it in the first session; fallbacks exist for reps who skip.

**✓ Positive**
- New rep follows onboarding with one exported chat → client created, history imported, Book Scan shown, all within the first session.
- On Android → Tovira appears as a share target for the export; on iOS → the Files-then-upload path is guided step-by-step.
**✗ Negative**
- A rep who skips the export isn't left with an empty app — they're offered the voice-note micro-wow or the sample book.
- Onboarding never demands paste-based bulk data entry (the thing reps won't do).

### [P5-3b] Day-One Book Scan ★
**AC**
- Scans seeded history; reveals open promises, unanswered client questions, going-cold gaps, upcoming dates; every item carries its receipt; ends by inviting the next export.

**✓ Positive**
- Seeded history containing a clear unfulfilled promise → scan shows it with the quoted message and date.
- A client question with no reply → shown as an unanswered thread, quoting the question.
- Scan screen ends with the "export your next chat" invitation.
**✗ Negative** *(the trust rules, at the most fragile moment — first impressions)*
- No scan item is ever shown without its receipt (quote + date) — asserted as a test over every rendered item.
- A promise the rep plausibly fulfilled off-channel is framed "worth checking," never "you never did this."
- An empty/thin seed → an honest "not much here yet — export more chats," never fabricated findings.
- Scan findings never leak across tenants; the scan never fires on another rep's data.

### [P5-4] Data trust & control
**AC**
- Consent captured at signup; retention policy stated; export and delete paths exist.

**✓ Positive**
- Request export → rep receives their COMPLETE corpus: raw notes, transcripts, extracted facts, and images, in a usable format (verified against a seeded account's full contents).
- Request delete → the rep's data (and their clients' personal data) is removed within the stated window, including from the training log per policy.

**✗ Negative**
- No consent → sensitive storage/processing doesn't proceed silently.
- After a delete request, the data does not reappear in briefs, search, or the training log.

### [P5-7] Trial-grade extraction
**AC**
- Trial accounts route extraction to Sonnet; paid accounts use the P1-9-selected model; seeding cap unaffected.

**✓ Positive**
- A trial account's extraction calls carry the Sonnet model id (asserted in the extraction log).
- On conversion to paid → subsequent calls carry the production model id.
**✗ Negative**
- The trial's Sonnet routing does NOT bypass the seeding ceiling (cost guard holds regardless of model).
- Model routing never mixes within one note's retry sequence (a retry uses the same model as the original — cache + training-log consistency).

### [P5-5] Annual plan
**AC**
- AED 2,990/yr SKU alongside monthly; switching handled via Stripe Billing.

**✓ Positive**
- Subscribe annually → charged AED 2,990 once; access for 12 months; webhook-driven state.
- Switch monthly→annual mid-cycle → prorated correctly by Stripe; no double charge.
**✗ Negative**
- Annual cancellation mid-term follows the stated policy — no silent auto-refund logic invented by the app.
- Annual price is never displayed as a monthly charge (no misleading billing copy).

### [P5-6] Book-Scan share card + referral
**AC**
- Share card = counts only; referral grants tracked through signup.

**✓ Positive**
- Generate a share card → shows stats ("7 open promises found") with zero client-identifying content.
- Referred signup converts → both accounts receive one free month, exactly once.
**✗ Negative** *(privacy is the whole game here)*
- The share card NEVER contains a client name, quote, company, or any extractable identifier — asserted over the full rendered output.
- Referral credits cannot be farmed (self-referral, repeat referral of the same person → no credit).
- A share card cannot be generated from another rep's scan.

---

## Phase 6 — Cloud infrastructure & deployment (AWS)

### [P6-1] Deploy on AWS
**AC**
- Provisioned per the infra design; CI/CD deploys repeatably.

**✓ Positive**
- Run the pipeline → app is live on AWS; a smoke test (signup → log a note → get a brief) passes end to end.
- Redeploy → repeatable, no manual drift.

**✗ Negative**
- Infra scan confirms **no NAT Gateway** and **single-AZ RDS** (cost guardrails actually in place).
- A failed deploy rolls back / doesn't leave the app half-broken.

### [P6-2] Swap stand-ins via config
**AC**
- Managed services replace local stand-ins through config; prod behaviour matches dev.

**✓ Positive**
- With prod config, AI routes through **Bedrock**, auth through **Cognito**, scan via **EventBridge+Lambda** → same flows pass as locally.
- Confirm prompt caching is active on Bedrock (usage shows cache reads).

**✗ Negative**
- No local stub/emulator endpoint is reachable from prod config (stand-ins fully swapped out).

### [P6-3] iOS push works on a real device
**AC**
- On a real iPhone, after home-screen install, push notifications are delivered over HTTPS.

**✓ Positive**
- Install on a physical iPhone → trigger a pre-meeting nudge → notification arrives.

**✗ Negative** *(the localhost-lies guard)*
- Not installed to home screen → the app correctly reflects that push is unavailable and falls back to the in-app list (no false "notifications on").
- Push send failure → logged and retried per policy; the rep still gets value via fallback.

### [P6-4] Ops safety net
**AC**
- Billing/cost alarms, monitoring/error tracking, and backups are live.

**✓ Positive**
- Spend crosses a set threshold → a billing alarm fires.
- Trigger a handled error → it appears in error tracking.
- Perform a restore drill → backup restores successfully.

**✗ Negative**
- An unhandled backend error is captured and alerted, not silently swallowed.
- Backups are verified by an actual restore, not merely "enabled".

### [P6-5] Isolation verified in prod
**AC**
- Tenant isolation holds under real Cognito auth in production.

**✓ Positive**
- Two real prod accounts → neither can read the other's clients, notes, images, or logs.
**✗ Negative**
- Attempt cross-tenant access by ID with a valid session for a different user → denied at the DB (RLS) even if an app check were bypassed.

---

## Phase 7 — Beta & iterate

### [P7-1] Real-workflow beta
**AC**
- Field reps use Tovira in daily work; feedback and usage are collected.

**✓ Positive**
- A beta rep logs real meetings for a week and pulls briefs before real calls → flow completes without blocking bugs.
**✗ Negative**
- No beta-blocking data loss or wrong-client attribution occurs during the period (tracked as a release gate).

### [P7-2] Capture corrections
**AC**
- Every rep correction is stored as training data with before/after and context.

**✓ Positive**
- Rep fixes an extracted date → a correction record captures original, corrected, note id, and prompt version.
**✗ Negative**
- Corrections don't leak across tenants; PII in the training store is access-controlled and retained per policy.

### [P7-3] Instrument activation & churn
**AC**
- Activation ("aha" = first useful brief viewed within trial) and churn are defined and measured accurately.

**✓ Positive**
- A rep views their first real brief → an activation event fires exactly once, timestamped within the trial window.
- Trial ends without conversion → counted as churn per definition.

**✗ Negative**
- Activation isn't double-counted on repeat views.
- No raw client PII is sent to the analytics pipeline (only the necessary event + ids).

---

## How to use this
- Treat each **✗ negative test** as a first-class requirement — most of Tovira's trust and safety lives there.
- The **★ P1-9 gate** tests are release-blocking: wire them into CI so a prompt or model change can't regress extraction quality unnoticed.
- Isolation (P0-4, P6-5), capture-never-loses-data (P1-3), cache-correctness (P1-6), and webhooks-as-source-of-truth (P5-2) are the highest-value negative suites — keep them green at all times.
