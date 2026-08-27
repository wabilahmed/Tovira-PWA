# Tovira — Every User Flow

Agent-owned reference (repo root). **The code is the source of truth** (`apps/api`,
`apps/web`, `apps/site`); where docs disagree, the code wins and the disagreement
is flagged in *Open questions* at the end. This documents behavior — it does not
change it. Real gaps found here are recorded in *Open questions* and `BLOCKERS.md`,
not repaired.

**The rule for every flow:** every flow starts on the marketing landing page
(`apps/site`, `/`); step 2 is always **Sign up** or **Log in**; then it
runs to its natural end. Step shape:

`N. <where> → <does> → <sees> · [screen/component] · [API] · [story ID]`

---

## Flow index

| # | Flow | Trigger | Key screens/components | Cold start |
|---|---|---|---|---|
| 1 | Sign up → empty app (with `?ref=`) | Landing CTA | LoginScreen, ClientsScreen | brand-new OK |
| 2 | Log in / log out | Landing CTA | LoginScreen, ClientsScreen | needs account |
| 4 | Day-one seeding → Book Scan | Get started | GetStarted, ImportChat, BookScan | ≥1 client + a chat export |
| 5 | Book Scan share card + referral | after scan | ShareCard | a scan with ≥1 finding |
| 6 | Trial extension (+7 days) | capture on 3 clients | TrialIncentive (Settings) | trialing + notes on 3 clients |
| 7 | Trial seeding ceiling | import past ceiling | CeilingNotice | trialing + a big import |
| 8 | Post-meeting voice note | Capture/record | Capture, outbox, NotesTimeline | ≥1 client |
| 9 | Paste a message | client detail | ClientDetail | ≥1 client |
| 10 | Pre-meeting brief + confirm | open client | BriefPanel (in App.tsx) | client + notes; **paid/trial** |
| 11 | Follow-up → Copy / WhatsApp | a note | FollowUpDraft, waLink | a note with rawText |
| 12 | Ask (recall), typed + voice | Ask view | Ask, Receipt | own notes with embeddings |
| 13 | Today's register → act | home/today | HeroInsights | a promise/meeting/cold client |
| 14 | Promises: done / confirm / reject | Promises view | PromisesTracker | extracted promises |
| 15 | Meetings: NL → parse → confirm | Meetings view | Meetings | ≥1 client |
| 16 | Business-card scan → create client | client-add | CardScan | none (creates first client) |
| 17 | Gallery: upload image | client detail | Gallery | an owned client |
| 18 | Going-cold alert + silence budget | scan/scheduler | Alerts, push | cold clients (+ push sub for buzz) |
| 19 | The Monday Statement | Monday view | MondayDigest | non-light week, else honest "clear week" |
| 20 | Chat refresh → dedupe → new-only | scan nudge → import | Alerts, ImportChat | a prior export per client |
| 21 | Enable notifications | Settings | NotificationSetup, enablePush | auth only |
| 22 | Hero volume gate → patterns/risk | home/today | HeroInsights | **≥5 clients AND ≥20 notes** |
| 23 | Subscribe monthly / annual | Settings→Billing | Billing | subscription row (from signup) |
| 24 | Failed/past-due + cancellation | Stripe webhook | Billing | an active/paid sub |
| 25 | Recovered Value Ledger + AED | Ledger view | Ledger | ≥1 ledger event |
| 26 | Export my data | Settings | AccountControls | auth only |
| 27 | Delete my account | Settings | AccountControls | auth only |
| 28 | Switch theme + Settings hub | Settings | ThemeToggle | brand-new OK |

---

## Shared mechanics (verified in code)

- **Marketing → app:** `apps/site` CTAs are plain `<a data-cta href="https://app.tovira.com/">`.
  `apps/site/src/ref.ts` `enhanceLinks()` (DOM-ready) rewrites each `[data-cta]`
  origin to `VITE_APP_URL` then appends the incoming query unchanged; `[data-langswitch]`
  gets the query too. `?ref=` / `utm_*` survive both the click and the language toggle.
  With JS disabled the CTAs still work but carry no `ref`.
- **Session:** cookie `session` — `Path=/; HttpOnly; SameSite=Lax; Max-Age=<ttl>`
  (+`Secure` when configured), set in `apps/api/src/http/helpers.ts`. `extractToken`
  reads `Authorization: Bearer` OR the cookie. Web calls use `credentials:'include'`.
- **Bootstrap:** `App.tsx` → `auth.getSession()` → `GET /me`; spinner, then
  `LoginScreen` (if 401) else `ClientsScreen`.

---

## Getting in

### FLOW 1 — New rep signs up → empty app (with `?ref=<code>`)
1. Landing `/` → clicks "Start a 7-day trial" → arrives `app.tovira.com/?ref=<code>` (query carried) · [apps/site/index.html + ref.ts] · [—] · [SITE-3 / P5-6]
2. App boots → `GET /me` 401 → sees login card → taps "Sign up" · [App.tsx → LoginScreen] · [GET /me] · [P0-3]
3. Enters email + password (≥8) → `LoginScreen.submit` reads `ref` from the URL → `auth.signup(email,password,ref)` · [App.tsx LoginScreen] · [POST /auth/signup] · [P0-3, P5-6]
4. Server creates user + session cookie (201) → `billing.onSignup` (trial sub, end = grant + trialDays) → if `ref`, `referral.apply` · [auth-routes.ts, server.ts] · [—] · [P5-1, P5-6]
5. Referral applied → blocks self-referral + repeat-per-email → else `grantReferralMonth` on both parties (+30d each) · [referral-service.ts, billing-service.ts] · [—] · [P5-6]
6. Authed → `ClientsScreen`, "No clients yet…", "Get started" seeding nudge · [App.tsx ClientsScreen] · [GET /clients, GET /onboarding/status] · [P5-3]

**Happy end:** trialing rep (+30d if valid ref), empty book, seeding nudge.
**What can go wrong:** duplicate email → 409 inline; password<8/bad email → 400 inline; `consent:false` → 400 `consent_required` (**API-only; UI never sends consent**); garbage/self/repeat ref → no credit, signup still succeeds; offline → "Authentication failed." inline.
**Trust rules:** invalid referrer credits no one; trial tied to a durable per-email grant (delete+recreate can't farm a fresh trial); referral is exactly-once per referred email.
**Cold start:** brand-new OK. The referral *reward* needs the referrer to be a real existing account.

### FLOW 2 — Returning rep logs in / logs out
1. Opens app → `GET /me`; live cookie → unexpired session → straight into `ClientsScreen` · [App.tsx] · [GET /me] · [P0-3]
2. Cookie missing/expired → login card → credentials → `auth.login` · [LoginScreen] · [POST /auth/login] · [P0-3]
3. Server verifies (generic even on unknown email — no enumeration) → new session cookie 200 · [auth-service.ts] · [—] · [P0-3]
4. In app → "Log out" → `auth.logout()` → clears cookie server-side → login card · [ClientsScreen] · [POST /auth/logout] · [P0-3]

**Happy end:** session restored on refresh with no re-entry; logout deletes server session (`Max-Age=0`).
**What can go wrong:** expired session → token deleted → 401 → login; wrong password/unknown email → single generic 401 "Invalid email or password."; offline on boot → login shown (PWA still usable offline; sign-in needs a connection).
**Trust rules:** no user enumeration (generic error + constant-time verify with a dummy hash); HttpOnly cookie (JS can't read the token); server owns identity.
**Cold start:** needs an existing account.

### FLOW 3b — Password reset (feat(EMAIL))
1. Login card → "Forgot password?" → request form · [App LoginScreen (forgot) → ForgotPassword] · [—] · [EMAIL]
2. Enter email → submit → identical confirmation whether or not the email exists: "If that email has an account, a reset link is on its way." · [ForgotPassword] · [POST /auth/forgot-password → always 200] · [EMAIL]
3. (email) The reset link → `{appBaseUrl}/reset-password?token=…`, valid one hour · [AccountEmailService.sendPasswordReset] · [—] · [EMAIL]
4. Open the link → App detects `/reset-password?token=` before auth → set a new password (≥8) → submit · [App → ResetPassword] · [POST /auth/reset-password] · [EMAIL]
5. Success → "password updated" → back to log in; every prior session was revoked and the token is now spent · [ResetPassword] · [—] · [EMAIL]

**What can go wrong:** unknown email → still 200, no email sent; expired/reused/garbage token → 400 "invalid or has expired"; weak password → 400.
**Trust rules:** no user enumeration (identical response + no email for unknown); only the token HASH is stored; single-use; all sessions revoked on reset.
**Cold start:** needs an existing account.

### FLOW 3c — Confirm your email (soft verification, feat(EMAIL-VERIFY))
1. On signup the welcome email carries a confirmation link → `{appBaseUrl}/verify-email?token=…`, single-use, valid 7 days · [AuthService.createEmailVerification → AccountEmailService.sendWelcome] · [—] · [EMAIL-VERIFY]
2. Until confirmed, a quiet dismissible banner rides above the app: "Confirm your email so we can reach you about your trial." with a **Resend** action · [App → VerifyBanner] · [POST /auth/resend-verification, rate-limited 3/UTC-day] · [EMAIL-VERIFY]
3. Open the link → App detects `/verify-email?token=` (works signed-in or out) → confirms → "Your email is confirmed." · [App → VerifyEmailPage] · [POST /auth/verify-email] · [EMAIL-VERIFY]
4. Settings shows the state (Confirmed / Not confirmed yet) and offers Resend there too · [App Settings] · [GET /me → user.emailVerified] · [EMAIL-VERIFY]

**Crucial:** verification is SOFT — an unverified rep has **full access to every feature**. It is never a gate; it only lets us reach them about the trial.
**What can go wrong:** expired / reused / another user's / garbage token → 400 "invalid or has expired" (no oracle — all look identical); resend past the daily budget → 429, surfaced calmly ("too many today, try again tomorrow").
**Trust rules:** only the token HASH is stored; single-use; another user's token verifies its OWN account, never a different one; the resend rate limit is server-enforced.
**Cold start:** a fresh signup (unverified by default).

**Lifecycle emails (feat(EMAIL-HOOKS)):** all transactional email is now wired and idempotent per `(user, event)`:
- **welcome** — on signup (carries the confirm link, FLOW 3c).
- **trial-ending** (~2 days out) + **trial-ended** — the `trial-emails` scheduled job over trialing subs; extension-aware (at most one ending-notice per trial).
- **payment-failed** / **subscription-confirmed** (renewal date only when the webhook supplies one) / **subscription-canceled** — fired from the Stripe webhook, idempotent per Stripe event id.
- **account-deleted** — sent BEFORE the purge (the address is about to be erased).
A failing send never breaks the business action (isolated try/catch everywhere).

---

## First value (the trial-critical path)

### FLOW 4 — Day-one seeding → Book Scan reveal
1. Just signed in, `seeded===false` → app forces Get Started → "Seed Tovira in three taps" + per-OS steps · [SeedingBanner/GetStarted] · [GET /onboarding/status] · [P5-3]
2. Taps "Import a chat" → if no client, "Who's this chat with?" name form → creates client · [GetStarted] · [POST /clients] · [P5-3]

**Android share-target (intended):**
3a. WhatsApp → Export chat → Without media → *Share to Tovira* · [manifest `share_target` → `/share-target`] · [P5-3] — **no handler exists; see Open questions.**
4a. In Tovira the `.txt` lands in the import form (in practice via the file picker) → tick consent → Import · [ImportChat] · [POST /clients/:id/notes/import] · [P1-4b/P5-3]

**iOS Files-then-upload:**
3b. WhatsApp → Export Chat → Without Media → *Save to Files* · [guidance from onboarding-routes.ts] · [P5-3]
4b. Import form → **Chat export (.txt)** input reads the file (`FileReader.readAsText`) → tick consent (button gated on `content && consent`) → Import · [ImportChat] · [POST /clients/:id/notes/import `{content, consent}`] · [P1-4b/P5-3]

**Convergence:**
5. Server parses (`parseWhatsAppExport`) → dedupes messages against prior notes → stores/extracts only the new tail · [notes-routes.ts, import/dedup.ts] · [P1-4b, P3-7]
6. Import ok → `onSeeded()` reloads seeding → switches to `bookscan` · [App.tsx] · [P5-3]
7. Book Scan → "Scanning your history…" then the reveal: "What your book has been hiding", meta `N findings · N clients · N chats read`, findings grouped (open promises / unanswered / going quiet / dates ahead), each a Receipt-chit · [BookScan.tsx] · [GET /book-scan] · [P5-3b]
8. Below → invitation "Export your next most important chat and I'll X-ray that one too." · [BookScan.tsx] · [P5-3b]

**Happy end:** one chat imported (deduped) + extracted; Book Scan rendered from real facts-with-receipts; `seeded` now true.
**What can go wrong:** empty export → 400; malformed/not-WhatsApp → raw file saved `import_failed`, 422 "That doesn't look like a WhatsApp export."; no consent → button disabled (API 400 if bypassed); >5,000,000 chars → 413; **duplicate re-import → 200 `{duplicate:true}` but the client shows red "Import failed."** (see Open questions); ceiling hit → chat saved, note pending, `ceilingReached:true` → CeilingNotice; offline → "Network error — please try again."; scan fetch fails → "Couldn't run the scan."; thin seed → honest "Not much here yet" + invitation, never a fabricated finding.
**Trust rules:** explicit consent for a full export; parse failure preserves the raw file (never silently dropped); dedupe prevents double-store/re-bill; every finding carries a quote+date receipt; promises framed "worth checking"; empty state honest; server owns extraction outcome (no client-side ceiling math).
**Cold start:** auth + ≥1 client (created inline) + a consented export + extraction reachable. Book Scan is ready only once a `whatsapp_export` note exists.

### FLOW 5 — Book Scan share card + referral link
1. In Book Scan → share card auto-loads → "Building your share card…" → a redacted "statement excerpt": **counts only** (open promises / unanswered / going quiet / upcoming dates) · [ShareCard.tsx] · [GET /share-card] · [P5-6]
2. Card shows "Share Tovira — you both get a free month." + link `{origin}/?ref={referralCode}` where **referralCode = the rep's own user id** → "Copy link" → clipboard → "Copied" · [ShareCard.tsx, App.tsx] · [—] · [P5-6]
3. A referred person opens `/?ref=<id>` → signs up; App passes `?ref` to signup · [App.tsx, authClient] · [POST /auth/signup] · [P5-6]
4. Post-signup → `onReferral` → both accounts +30 days, once · [auth-routes.ts, referral-service.ts] · [—] · [P5-6]

**Happy end:** card from the rep's own counts; link copied; a signup via it credits both parties a month.
**What can go wrong:** total 0 findings → card renders nothing; fetch fails → nothing; self-referral / repeat email / non-existent referrer → no credit; clipboard unavailable → silent no-op.
**Trust rules:** share card is **counts only** — no name/quote/company can leak (enforced server-side); a card can only be built from the caller's own scan; referral credit is exactly-once, no self, no double.
**Cold start:** a completed scan with ≥1 finding.

### FLOW 6 — Trial extension (+7 days for notes on 3 distinct clients)
1. Settings → "Earn +7 more trial days — Notes on 2 of 3 clients — capture one more…" · [TrialIncentive.tsx] · [GET /billing/incentive] · [P5-1-UI]
2. Rep captures notes on distinct clients (voice/paste/import) → each capture path calls `maybeExtendTrial` · [notes-routes.ts] · [POST /clients/:id/notes/*] · [P5-1]
3. Once notes on **3 distinct clients** + still trialing → `/billing/incentive` returns `earned` → one-time green "You earned +7 more trial days — trial now runs to <date>." + "Got it" · [TrialIncentive.tsx] · [P5-1-UI]
4. "Got it" sets `localStorage['tovira.trialExtensionSeen']` → banner goes quiet · [TrialIncentive.tsx] · [P5-1-UI]

**Server enforcement:** `BillingService.extendTrialForActivity` (triggered from note routes via `countDistinctClientsWithNotes`); `MIN_CLIENTS=3`, `DAYS=7`; extends once (`status==='trialing' && !trialExtended && distinct>=3`). The incentive read-model uses the **same** distinct-count so the shown progress can't disagree with what earns it.

**Happy end:** trial +7 days once; UI confirms then self-silences.
**What can go wrong:** <3 clients → `progress`, no extension; already extended → no-op; not trialing → `hidden`/false → renders nothing; `/billing/incentive` fails → client falls back to `HIDDEN_INCENTIVE` (never invents eligibility); private-mode localStorage throw on dismiss → caught, harmless.
**Trust rules:** eligibility decided **entirely server-side**; client never computes it; extension is once-only and lives on the capture path; progress figure and earning trigger share one code path.
**Cold start:** active trial + notes on ≥3 distinct clients.

### FLOW 7 — Trial seeding ceiling reached
1. Rep imports a chat that pushes past the per-trial extraction ceiling → import still 201 (chat saved), `ceilingReached:true` · [notes-routes.ts] · [POST /clients/:id/notes/import] · [P5-1 / cost-guard #4]
2. Timeline refreshes; ImportChat renders the amber notice · [ImportChat.tsx] · [P5-3]
3. Rep sees "**Your chats are saved.** We scanned N messages and reached your free-trial scanning limit. Nothing is lost — upgrade any time to scan the rest." (`role="status"`) · [CeilingNotice.tsx] · [P5-1-CEILING-UI]
4. To lift it → Settings → Billing → Subscribe · [Billing.tsx] · [POST /billing/checkout] · [P5-1]

**Enforcement:** `TrialExtractionLimiter.allow` — only trialing accounts are bounded (`countExtractions < ceiling`); paid never limited.
**Happy end:** the imported chat + messages are stored (note SAFE + pending), nothing lost; a calm upgrade nudge, not a failure.
**What can go wrong:** unknown message count → generic "You've reached your free-trial scanning limit."; paid → no ceiling ever; extraction refused but note persisted (pending).
**Trust rules:** server is source of truth (no client-side ceiling math); an import is never lost even when extraction is refused; hard stop against unbounded burn while keeping capture safe.
**Cold start:** a trialing account + an import that crosses the ceiling.

---

## The daily loop

### FLOW 8 — Post-meeting voice note
*(Two entry points feed the same `Outbox`: the Capture screen and the client-detail inline recorder.)*
1. Open a client / Capture → pick client (`<select>`, defaults to first) → "Record for {name}", "Kept on your device until it uploads. Never lost." · [capture/Capture.tsx] · [—] · [P1-3]
2. Tap Record → mic prompt → mono claret timer · [microphone.ts → recorder.ts] · [getUserMedia] · [P1-3]
3. Tap "Tap to stop" → haptic tick, "N recordings waiting for signal · uploads on its own" · [recorder.ts → Blob] · [—] · [P1-3]
4. On stop → `outbox.enqueue` **persists to IndexedDB FIRST**, then uploads → durable even offline · [capture/outbox.ts, idbRecordingStore.ts] · [—] · [P1-3]
5. Upload → `POST /clients/:id/notes/voice` (raw `audio/webm`); on 2xx the IDB row is deleted, else stays queued (`attempts++`) · [capture/uploader.ts] · [POST /clients/:id/notes/voice] · [P1-3]
6. Server stores bytes, note `source:'voice'`, `status:'pending_transcription'`, touches client, 201; side-effects `recordReopenIfFlagged` [P4-11] + `maybeExtendTrial` [P5-1] · [notes-routes.ts] · [P1-3]
7. Client re-lists notes; pipeline auto-advances: `POST /notes/:id/transcribe` (Groq STT) → `rawText`, `pending_extraction`; empty/low-quality → `needs_review` (flagged, kept); API error → stays pending (retry) · [App.tsx refresh] · [POST /notes/:id/transcribe] · [P1-5]
8. Then `POST /notes/:id/extract` (with today's date) → Claude → valid JSON → `extracted`, facts + embedding saved; invalid after **one retry** → `needs_review`, writes nothing structured; exactly one training-log row either way · [extraction-service.ts] · [POST /notes/:id/extract] · [P1-6, P1-8]
9. Timeline shows the note; uncertain promises → confirm queue (FLOW 10) · [NotesTimeline.tsx] · [P1-7]

**Happy end:** audio uploaded + removed from the device outbox; note `extracted`; transcript in timeline; promises/dates/people filed; a follow-up can now be drafted.
**What can go wrong:** mic denied/unsupported → red guidance, no silent recording; no client → "Add a client first…"; offline/upload fail → kept in IDB, "N recording(s) pending upload — saved, will retry"; empty audio → 400; transcription error → stays pending, retries next refresh; empty audio → `needs_review`; extraction malformed twice → `needs_review`, no fabricated facts; ceiling → `trial_limit`, note safe + pending, CeilingNotice.
**Trust rules:** recording persisted to IDB before upload, deleted only on confirmed 2xx (never lose a recording); no silent recording; extraction retries once then flags rather than guessing; uncertain items never shown as fact; one training-log row per extraction.
**Cold start:** auth + ≥1 client.

### FLOW 9 — Paste a message under a client
1. Client detail → paste into "Paste a message (WhatsApp, email…)" → "Save message" (disabled until non-empty) · [App.tsx ClientDetail] · [—] · [P1-6]
2. Submit → `POST /clients/:id/notes/paste {text}` · [clientsClient] · [POST /clients/:id/notes/paste] · [P1-6]
3. Server stores **verbatim** (emojis/line breaks preserved), `source:'paste'`, `pending_extraction`, touch, 201; side-effects reopen [P4-11] + extend-trial [P5-1] · [notes-routes.ts] · [P1-6]
4. `refresh()` → auto `POST /notes/:id/extract` · [App.tsx] · [POST /notes/:id/extract] · [P1-6]
5. Extract → as FLOW 8; success → `extracted`, facts filed; malformed twice → `needs_review` · [extraction-service.ts] · [P1-6]
6. Timeline shows the paste; uncertain promises → confirm queue · [NotesTimeline.tsx] · [P1-7]

**Happy end:** paste stored verbatim; note `extracted`; facts filed.
**What can go wrong:** empty/whitespace → 400 (button also disabled); >100,000 chars → 413 "…Split it into smaller notes."; extraction failure → `needs_review`, nothing structured; ceiling → `trial_limit`, CeilingNotice.
**Trust rules:** stored verbatim (no rewriting); no fabrication on failure; uncertain items become confirm-queue guesses, never facts.
**Cold start:** ≥1 client. *(A full WhatsApp export is the separate consent-gated, deduped `/notes/import` path — see FLOW 4/20.)*

### FLOW 10 — Pre-meeting brief + confirm a low-confidence item
1. Client detail → "Pre-meeting brief" → panel renders · [App.tsx BriefPanel (inline)] · [GET /clients/:id/brief] · [P2-1]
2. Server assembles: recent context (last 5 notes), **openPromises** (settled/certain), **needsConfirmation** (uncertain, separate), key people (deduped roles), personal notes, concerns, related notes (semantic, similarity ≥0.5) · [brief/brief-service.ts] · [P2-1, P2-4]
3. "Recent context" shows `<Receipt>` snippets (real note quotes) as evidence · [BriefPanel, Receipt] · [P2-1]
4. Low-confidence promises under amber "To confirm (not yet facts)" with Confirm / Reject · [BriefPanel] · [P1-7]
5. "Confirm" → `POST /promises/:id/confirm` → becomes a fact, brief re-fetched · [facts-routes.ts] · [POST /promises/:id/confirm] · [P1-7]
6. "Reject" → `DELETE /promises/:id` → removed for good (+ ledger entry removed) · [facts-routes.ts] · [DELETE /promises/:id] · [P1-7, P4-11]

*(The same queue also appears app-wide via `ConfirmChitQueue` on Today/Alerts/Monday, self-fetching `GET /confirmations`.)*
**Happy end:** brief with receipts; a low-confidence promise moves "To confirm" → settled open promise.
**What can go wrong:** trial ended unpaid → **`GET /brief` 402 payment_required** → the panel now renders the shared **`<Locked>`** state (Subscribe → Billing), not an empty screen (fix(LOCKED-EMBEDDED)); no notes → honest empty "Nothing logged yet…", never a fabricated summary; no close notes → related-notes section omitted; confirm/reject on missing → 404, UI keeps the item.
**Trust rules:** uncertain items surfaced separately "(not yet facts)", never as facts; receipts = real note snippets; empty brief is honest; confirmed tick brass, unconfirmed amber; reject removes so a wrong fact can't persist.
**Cold start:** a client with notes; brief is **entitlement-gated** (paid or in-window trial).

### FLOW 11 — Follow-up draft → edit → Copy / WhatsApp
1. Client detail → each note with `rawText` shows "Draft follow-up" · [NotesTimeline → followup/FollowUpDraft.tsx] · [—] · [P4-4]
2. Tap → "Drafting…" → `POST /notes/:id/follow-up` · [FollowUpDraft] · [POST /notes/:id/follow-up] · [P4-4]
3. Server drafts via Claude grounded **only** on the note's rawText + its real promises/next-steps; returns `{draft}`; never sends · [followup/follow-up-service.ts] · [P4-4]
4. Draft in an editable textarea → rep edits freely · [FollowUpDraft] · [P4-4]
5. "Copy" → `navigator.clipboard.writeText` → "Copied" · [FollowUpDraft] · [P4-4]
6a. "Send via WhatsApp" **with** a stored phone (E.164, 8–15 digits) → `https://wa.me/{digits}?text={encoded}` → WhatsApp opens **to that contact**, text pre-filled; rep taps send · [FollowUpDraft → whatsapp/waLink.ts] · [wa.me] · [P4-7]
6b. **Without** a valid phone → `toDialableDigits` null → `https://wa.me/?text={encoded}` → WhatsApp **contact picker**, text pre-filled; country code never guessed · [waLink.ts] · [P4-7]

*(Phone is entered manually via `ClientPhoneField` → `PATCH /clients/:id {phone}`, stored as typed.)*
**Happy end:** WhatsApp opens with the edited text pre-filled (to the contact if a valid international number is stored, else the picker); Tovira sent nothing.
**What can go wrong:** trial ended unpaid → **`POST /notes/:id/follow-up` 402** → the draft area renders the shared **`<Locked>`** state, not the error (fix(LOCKED-EMBEDDED)); draft fails → "Could not draft a follow-up — try again."; note without rawText → button not shown; clipboard unavailable → silent no-op (select+copy still works); no/invalid phone → picker (never a wrong number); phone save by non-owner → kept locally only.
**Trust rules:** **never auto-sends** — wa.me only opens WhatsApp pre-filled; draft grounded only on the note + real commitments (invents no promises/dates); country code never guessed; URL-encoding preserves emojis/Arabic/line breaks.
**Cold start:** a note with rawText under a client.

### FLOW 12 — Ask (conversational recall), typed + voice
1. `ask` view → type a question → "Ask" enables · [recall/Ask.tsx] · [—] · [P4-8]
2. (Voice) "Voice" → browser **Web Speech API** transcribes locally → fills the box · [Ask.tsx / App.tsx makeSpeechListener] · [—] · [P4-8]
3. Submit → "Thinking…" → `POST /recall {question}` · [Ask.tsx] · [POST /recall] · [P4-8]
4. Server embeds the question, top-k=5 similarity (`minSimilarity 0.2`) over the rep's notes, one grounded model call · [recall/recall-service.ts] · [—] · [P4-8]
5. "On record" stamp + answer + Receipts (verbatim quote ≤280 chars + ISO date) · [Ask.tsx, Receipt] · [—] · [P4-8]

**Happy end:** `{answer, receipts[]}`; each receipt is a real stored note.
**What can go wrong:** no relevant note (0 matches / below threshold / empty rawText) → `answer = "I don't have that on record."`, no receipts; empty question → 400 (button disabled); model throws → fallback "Here is what I found in your notes." with receipts still shown (never fabricates); non-200/network → "Something went wrong — please try again."; no `SpeechRecognition` → Voice button simply not rendered.
**Trust rules:** every answer carries receipts; honest "I don't have that on record." with no plausible fill; prompt forbids inventing facts/names/dates; retrieval capped top-k (cost guard); label is provenance ("On record").
**Cold start:** own notes with embeddings; zero notes → always "I don't have that on record."

### FLOW 13 — Today's register → acting on a ranked item
1. Home/hero loads → parallel status/today/patterns/risk → "Working out your day…" · [hero/HeroInsights.tsx] · [GET /hero/status, /today, /hero/patterns, /hero/risk] · [P4b-3]
2. "Today's register", N entries, "X need acting on" (cold/risk = claret dot), each with a factual subline ("overdue since 1 Jul 2026", "silent 21 days", "meeting <raw>") · [HeroInsights.tsx] · [—] · [P4b-3]
3. `GET /today` serves the **precomputed cache** (zero model calls); missing row → computes once and stores · [hero-routes.ts → priorities-service.ts] · [—] · [P4b-3]
4. Rep acts externally (call/prep); **no per-item "complete" endpoint** — promises close via FLOW 14, meetings via FLOW 15 · [HeroInsights renders text only] · [—] · [story ?]
5. "Refresh" → model reranks candidates → new order + "N refreshes left today" · [HeroInsights] · [POST /today/refresh] · [P4b-3]

**Happy end:** ranked `TodayAction[]` (≤10) by priority (overdue promise 4 > due-soon/meeting 3 > cold 1). Actions built deterministically; the model may only **reorder** by index (invalid dropped, omitted appended — never fabricates/loses a task).
**What can go wrong:** zero data → "Nothing on the register today. Capture a note…" (no fabricated tasks); refresh limit (default 2/rep/day) → 429 → "Daily refresh limit reached…", button disabled; rank model garbage → deterministic-order fallback; unresolved promise dates / null-datetime meetings never enter the register.
**Trust rules:** grounded rerank (index-mapped); factual sublines; cost-guard #3 = one model rank/rep/day, refreshes capped server-side.
**Cold start:** works from the first promise/meeting/cold client; **no volume gate on `/today`.**

### FLOW 14 — Promises: done / confirm / reject
1. `promises` view → parallel open + confirmations → "Loading your promises…" · [promises/PromisesTracker.tsx] · [GET /promises, /confirmations] · [P4-1 / P1-7]
2. Open list (due-date order, no-date last; overdue = claret dot + claret date), header "N open · X overdue · Y to confirm" · [PromisesTracker] · [—] · [P4-1]
3. "Done" → row removed, haptic tick · [PromisesTracker] · [POST /promises/:id/done] · [P4-1]
4. Server marks done; if due date + on time (today ≤ dueDate) records a ledger `promise_kept` value-touch (late/no-date = not value) · [facts-routes.ts] · [—] · [P4-11]
5. In "To confirm (not yet facts)" (amber) → "Confirm" → row removed, becomes a settled fact · [PromisesTracker] · [POST /promises/:id/confirm] · [P1-7]
6. "Reject" → row removed permanently (+ `ledger.removeBySource`) · [PromisesTracker → promisesClient.reject] · [DELETE /promises/:id] · [P1-7, P4-11]

**Happy end:** done → dropped (ledger entry if kept on time); confirm → cleared, now actionable; reject → promise + any ledger claim deleted.
**What can go wrong:** no open promises → "…you're all caught up."; empty queue → section hidden; `markDone` non-200 → "Could not mark that done…"; confirm/reject on missing id → 404, row stays; the PATCH edit path records before/after as correction training data (unchanged field = no correction; `promptVersion` null if the note was never logged).
**Trust rules:** confirmation queue = `confidence==='low'` OR unresolved relative date; until confirmed, never drives a reminder and never shown as a settled fact; amber "not yet facts"; ledger counts a promise kept **only on time**.
**Cold start:** promises extracted from notes.

### FLOW 15 — Meetings: natural language → parse → preview → confirm → saved
1. `meetings` view → list loads · [meetings/Meetings.tsx] · [GET /meetings] · [P3-1]
2. Type "meeting with Acme next Tuesday 3pm" → "Parse" · [Meetings.tsx] · [POST /meetings/parse {text}] · [P3-1]
3. Server: one model call resolves relative time vs today into `datetime` (or null if vague) + matches client name → a `ParseResult` union · [meetings/meeting-parser.ts] · [—] · [P3-1]
4. Preview: title, `datetimeRaw`, `(datetime)` or "(time unconfirmed)", client `<select>` · [Meetings.tsx] · [—] · [P3-1]
5. "Save meeting" → row appended, form cleared · [Meetings.tsx] · [POST /clients/:id/meetings {datetime, datetimeRaw, title}] · [P3-1]

**Happy end:** meeting persisted `confirmed:true`; client `lastTouchedAt` bumped; in the list.
**What can go wrong:** empty text → 400 (button disabled); parser ambiguity → `kind: ambiguous_time | no_client | ambiguous_client`; model throws/invalid → `ambiguous_time`; `parse()` returns null only on non-200/network → "Couldn't read a meeting from that…"; save with unknown/foreign client → 404; no datetime and no raw → 400 "A meeting time is required."
**Trust rules:** parse **never writes** the calendar — only "Save meeting" does; vague time → `datetime` null, phrase kept, "(time unconfirmed)"; ambiguous client → asks which (server-side).
**Cold start:** ≥1 client for name-match/select. **Discrepancy:** the web client casts the union to a flat `ParsedMeeting` and reads `clientId`/`title`; the `ambiguous_client`/`no_client` kinds are never surfaced — see Open questions.

### FLOW 16 — Business-card scan → preview → confirm → client created
1. Client-add → "Scan a business card" → pick/snap photo → "Reading the card…" · [cards/CardScan.tsx] · [POST /cards/scan (raw bytes)] · [P4-5]
2. Server sniffs media type from magic bytes → vision model + strict prompt → `parseCardScan` → `{isCard, contact}` · [cards-routes.ts → adapters/vision/anthropic-card-scanner.ts] · [—] · [P4-5]
3. Preview: name (bold), title, email, editable Phone (prefilled) · [CardScan.tsx] · [—] · [P4-5]
4. "Create client from card" → `POST /clients {name, phone?}` → 201 · [App.tsx onCreateClient] · [POST /clients] · [P4-5/P4-7]
5. "Contact created."; new client prepended · [App.tsx] · [—] · [P4-5]

**Happy end:** client created from `contact.name` (+trimmed phone if present); preview cleared.
**What can go wrong:** trial ended unpaid → **`POST /cards/scan` 402** → the scanner renders the shared **`<Locked>`** state, not the scan error (fix(LOCKED-EMBEDDED)); scan null (non-200/network) → "Couldn't read that image — try again."; `isCard===false`/no contact (non-card, blur, garbage) → "That doesn't look like a business card."; blurry fields → null; name null → "(no name found)", Save disabled, "No name detected — add it manually instead."; empty upload → 400; vision failure → typed `ModelError` → non-card.
**Trust rules:** any field not read with confidence = null, never guessed/pattern-completed; values verbatim (no normalising phone/email); non-card reported as such; nothing saved until explicit confirm (scan returns a proposal only).
**Cold start:** none — a client-creation entry point. **Discrepancy:** scanned title/email are shown then **discarded** on create (only name+phone sent) — see Open questions.

### FLOW 17 — Gallery: upload an image to a client
1. Client detail → "Add a photo" input; list loads · [gallery/Gallery.tsx] · [GET /clients/:id/images] · [P4-6]
2. Pick a photo → upload · [Gallery] · [POST /clients/:id/images (raw bytes)] · [P4-6]
3. Server verifies ownership, stores under `images/:userId/:uuid`, creates record, touch, 201 → grid reloads · [images-routes.ts] · [—] · [P4-6]
4. Thumbnails served owner-only · [Gallery `<img>`] · [GET /images/:id] · [P4-6]

**Happy end:** image stored + record; client touched; thumbnail visible.
**What can go wrong:** no images → "No photos yet."; foreign/unknown client → 404; empty body → 400 "No image was uploaded."; `GET /images/:id` for non-owner/missing blob → 404.
**Trust rules:** tenant isolation — upload/list/serve all scoped by `userId`; bytes served only to the owner; storage key namespaced per user.
**Cold start:** an existing owned client.

---

## Proactive

### FLOW 18 — Going-cold alert + the silence budget
1. Scheduler (prod) or rep → triggers the daily brain → server generates alerts and pushes the loudest ≤2 · [scheduler / no screen] · [POST /scan] · [P3-3]
2. `ScanService.runAll` runs 5 generators → each alert recorded in-app via `notifications.createIfAbsent` (idempotent, deduped e.g. `cold:<id>`), collecting a `pushables[]` · [scan-service.ts] · [P3-3]
3. `PushDispatchService.dispatch` records ALL candidates in-app first, then ranks, then sends: `remaining = cap − budget.countSent(user, UTCday)`; sends top-`remaining` to every device; `budget.recordSent` · [push-dispatch-service.ts] · [P4-SILENCE (doc-only)]
4. Phone receives ≤2 web-push ("Client going cold" / "<name> hasn't been touched in a while.") · [OS] · [push sender] · [P3-3]
5. Rep opens Alerts → in-app notifications + cold list (independent of push) · [proactive/Alerts.tsx] · [GET /notifications, GET /cold] · [P3-5]
6. Sees "Needs you" (every alert incl. push-suppressed) + "Going quiet" ("· silent N days") · [Alerts.tsx] · [—] · [P3-5]
7. "Rescan" → re-run then reload · [Alerts.tsx] · [POST /scan → GET /notifications, /cold] · [P3-5]
8. (Follow-on) capturing a note on a flagged client records a `thread_reopened` ledger event · [notes-routes.ts] · [—] · [P4-11]

**Ranking:** `overdue_promise(0) > going_cold(1) > pre_meeting_nudge(2) > date_reminder(3) > chat_refresh(4) > monday_digest(5)`. **Cap:** `DAILY_PUSH_CAP = 2`.
**Happy end:** every qualifying alert exists in-app; the phone buzzed for at most 2 (highest-ranked); today's budget decremented; cold clients listed with silence duration.
**What can go wrong:** no push subscription → nothing pushed but ALL alerts in-app (`pushed:0`); budget exhausted → all suppressed-from-push, still in-app; >2 qualify → top-2 pushed, rest suppressed but in-app; unauthed → 401; `/cold?days=` invalid → falls back to `coldThresholdDays`; nothing to show → "…this is what quiet looks like."
**Trust rules:** cap = 2/rep/day at the single send path, counting **alerts not device fan-out**; suppressed ≠ lost — in-app recording happens **before** the budget check; loudest wins by fixed rank; idempotent dedupe keys prevent double-send across re-scans.
**Cold start:** a push subscription for the phone to buzz; clients past `coldThresholdDays` for the cold list.

### FLOW 19 — The Monday Statement
1. Rep opens the Monday view → weekly digest (built server-side for `now`) · [monday/MondayDigest.tsx] · [GET /monday-digest] · [P3-8]
2. Server assembles: promises due this week, cooling clients, upcoming key dates, unanswered client questions → `isLight` if all four empty · [monday-service.ts] · [P3-8]
3. Rep sees "The Monday Statement", "Week of <range> · N entries", four ruled sections (empty ones hidden) · [MondayDigest.tsx] · [—] · [P3-8]
4. (Push, separate) `notifyMonday` emits one `monday_digest` in-app notification per week (`monday:<weekOf>`) · [monday-service.ts] · [P3-8]

**Happy end:** the week ahead as a statement with real counts + mono dates.
**What can go wrong:** light week → "A clear week — nothing due, no one cooling." / "0 entries" (never padded); fetch null → "The Monday Statement could not be loaded."; unauthed → 401; missing `weekOf` → client computes Monday from `now`.
**Trust rules:** honest light week; idempotent weekly push; in-app view exists regardless of push; `monday_digest` is lowest rank so it never preempts an overdue promise.
**Cold start:** non-light content, else the honest "clear week" is correct. **Note:** the Monday push is emitted by `notifyMonday`, **not** through `PushDispatchService` — so it does not consume the /scan silence budget (see Open questions).

### FLOW 20 — Chat refresh nudge → dedupe → new-only extraction
1. Scan → `chatRefreshNudges` finds clients whose latest `whatsapp_export` note is older than `chatRefreshStaleDays` → `chat_refresh` alert (`refresh:<clientId>:<latestNoteId>`) · [scan-service.ts] · [POST /scan] · [P3-7]
2. Rep → Alerts → "Refresh this chat — re-export <name>'s WhatsApp chat (3 taps)…" · [Alerts.tsx] · [GET /notifications] · [P3-7]
3. Rep re-exports and imports (consent:true) · [ImportChat] · [POST /clients/:id/notes/import] · [P1-4b]
4. Server dedupes against all prior messages (identity `sentAt+sender+body`) → keeps only the new tail · [import/dedup.ts, notes-routes.ts] · [P3-7]
5. `fresh.length===0` → `200 {duplicate:true}`, nothing stored/extracted · [notes-routes.ts] · [P3-7]
6. Else store only the new slice as a note, touch, extract only that note · [notes-routes.ts] · [P1-4b/P1-6]
7. Next scan → the dedupe key now points at the new latest note (`createdAt >= cutoff`) → no re-nudge until it goes stale; fresh facts feed later generators · [scan-service.ts] · [P3-7]

**Happy end:** only genuinely new messages stored once + extracted; the nudge self-clears; an identical re-import changes nothing.
**What can go wrong:** identical re-import → `duplicate:true`, 0 imported (**but client shows "Import failed." — see Open questions**); no consent → 400; empty → 400; over `MAX_IMPORT_CHARS` → 413; unparseable → raw saved `import_failed`, 422; client not found → 404; ceiling → note SAFE + pending, `ceilingReached:true`; never imported before → no nudge (onboarding's job).
**Trust rules:** message-level dedupe makes re-import idempotent; nudge is non-nagging (one fire per stale import); raw file never lost on parse failure; extraction runs only on the new slice.
**Cold start:** ≥1 prior `whatsapp_export` note per client. **Note:** import does not itself trigger `/scan`; the scan generators pick up the fresh facts on the next scheduled/manual `POST /scan`.

### FLOW 21 — Enable notifications
1. Settings → "Notifications" section; message from `onboardingStep(readPushState())` (standalone / `Notification.permission` / push support) · [push/NotificationSetup.tsx, onboarding/onboarding.ts] · [—] · [P3-6]
2. **iOS not installed / unsupported** → stage `install`: "Add Tovira to your home screen to turn on notifications…" — no Enable button · [NotificationSetup.tsx] · [—] · [P3-6]
3. **Android / installed, permission default** → "Enable notifications" → `enablePush`: `Notification.requestPermission()` → `serviceWorker.ready.pushManager.subscribe({userVisibleOnly:true, applicationServerKey: VAPID})` · [enablePush.ts] · [—] · [P3-6]
4. Subscription → `pushClient.saveSubscription` → persisted per user · [push/pushClient.ts] · [POST /push/subscribe → 201] · [P3-6]
5. Enabled → "Notifications are on." + "Send a test notification" → `POST /push/test` → "Sent to N devices." · [NotificationSetup.tsx] · [POST /push/test → 200 {sent}] · [P3-6]

**Happy end:** subscription stored server-side; a test confirms delivery (VAPID from `VITE_VAPID_PUBLIC_KEY`).
**What can go wrong:** no VAPID key or no `pushManager` → `unsupported` → "…On iPhone, add Tovira to your home screen first."; permission not granted → `denied` → "…enable them in your browser settings, or rely on the in-app cold list." (amber alert); exception → `error`; `/push/subscribe` invalid → 400; per-sub `/push/test` failure swallowed (count reflects successes only); unauthed → 401.
**Trust rules:** the in-app cold list is always the fallback; a failed individual push never breaks the flow; no dead Enable button when unsupported/iOS-not-installed.
**Cold start:** auth only; subscription is independent of any client/note data.

---

## Hero (volume-gated)

### FLOW 22 — Warming-up → threshold crossed → patterns + deal-risk radar
1. Hero loads status alongside today/patterns/risk · [HeroInsights.tsx] · [GET /hero/status] · [P4b-4]
2. **Below gate:** "Patterns & risk" shows a warming-up box: `status.message`, "Clients on file NN / MM", "Notes captured NN / MM", "X more clients and Y more notes." · [HeroInsights.tsx] · [—] · [P4b-4]
3. Server counts clients + all their notes, `evaluateGate` → `{unlocked, counts, needed, message}` · [hero-service.ts → volume-gate.ts] · [GET /hero/status] · [P4b-4]
4. `GET /hero/patterns` and `GET /hero/risk` **return `[]` while locked** (guard runs before any computation) · [hero-service.ts] · [—] · [P4b-1/P4b-2]
5. **Threshold crossed** (≥ minClients AND ≥ minNotes) → warming box replaced by pattern cards (title, confidence, description, evidence names) + at-risk cards (name + ≥2 reason bullets) · [HeroInsights.tsx] · [GET /hero/patterns, /hero/risk] · [P4b-1/P4b-2]

**Enforcement:** server-side; `HeroService` built with `{minClients: HERO_MIN_CLIENTS=5, minNotes: HERO_MIN_NOTES=20}` (config). `patterns()`/`risk()` early-return `[]` when locked — the client cannot flip it. `/today` is **not** gated.
**Happy end (unlocked):** patterns with ≥2 supporting deals + risk items with ≥2 signals surface; empty → "No patterns or risks surfaced yet."
**What can go wrong:** below gate → warming box (not a broken feature); thin evidence → single-signal clients never flagged (pattern needs ≥2 deals, risk ≥2 reasons); loading → "Working out your day…".
**Trust rules:** a confident-but-wrong pattern is worse than a missed one → locked until threshold (server-enforced); warming box states exactly what unlocks it; patterns cite supporting deals; correlation phrased "has often shown up before", never causation; risk needs multiple signals, each shown.
**Cold start:** hidden until ≥5 clients AND ≥20 notes; below that only "Today" and the gate meter are live.

---

## Money and data

### FLOW 23 — Subscribe monthly / annual
1. Settings → Billing → status; if not active, "Subscribe monthly — AED 299 / month" + "Subscribe annually — AED 2,990 / year (2 months free)" · [billing/Billing.tsx] · [GET /billing/status] · [P5-2]
2. Click a plan → `subscribe('monthly'|'annual')` → Stripe Checkout session · [Billing.tsx] · [POST /billing/checkout {plan}] · [P5-2]
3. Redirect to Stripe Checkout → pay · [Stripe hosted] · [—] · [P5-2]
4. Stripe → webhook (unauthenticated, signature-verified) → `checkout.session.completed` → `status:'active'`, stamps customer/subscription ids, stamps `currentPeriodEnd` only if present · [billing-routes.ts, billing-service.ts] · [POST /billing/webhook] · [P5-2]
5. Back on Billing → "You're subscribed…" + "Renews <DD MON YYYY>" from `renewsAt` (`formatStamp`) · [Billing.tsx] · [GET /billing/status] · [P5-2]
6. (Renewal) `invoice.payment_succeeded` → keeps `active`, advances `currentPeriodEnd` → new date · [billing-service.ts] · [—] · [P5-2]

**Happy end:** `active`, `entitled`, renewal line from the webhook. Monthly/annual differ only by the `plan` passed to Stripe.
**What can go wrong:** no checkout URL → "Could not start checkout…"; invalid webhook signature → 400; duplicate webhook → 200 idempotent, no change; webhook without `current_period_end` → renewal NOT invented (`renewsAt` null → line hidden); client "success" redirect alone → grants nothing.
**Trust rules:** **webhooks are the ONLY thing that grants access** — no client redirect activates; renewal date never invented; webhook signature-verified + idempotent by event id.
**Cold start:** a subscription row (created at signup, tied to a durable email trial grant).

### FLOW 24 — Failed / past-due payment & cancellation
1. Stripe → `invoice.payment_failed` → `status:'past_due'` · [billing-service.ts] · [POST /billing/webhook] · [P5-2]
2. Billing → amber "Your last payment failed. Update billing to keep access." + subscribe buttons still shown · [Billing.tsx] · [GET /billing/status] · [P5-2]
3. Stripe → `customer.subscription.deleted` → `status:'canceled'` · [billing-service.ts] · [—] · [P5-2]
4. Billing → `entitled:false, status:'canceled'` → generic "Your trial has ended. Subscribe to keep your memory bank." + buttons · [Billing.tsx] · [—] · [P5-2]

**Happy end (system view):** `past_due` and `canceled` both make `entitled:false` (only `active` or in-window `trialing` are entitled), locking premium; the rep sees a recovery prompt.
**What can go wrong:** `past_due` → amber "payment failed" (`data-testid=past-due`); `canceled`/`trial_expired` → generic "trial ended" copy (no dedicated canceled branch — see Open questions); webhook for unknown customer → no-op; invalid signature → 400.
**Trust rules:** access is server-decided by webhooks only; idempotent + signature-verified; an out-of-window trial is never entitled.
**Cold start:** an existing sub with a `stripeCustomerId` so the webhook resolves to a user.

### FLOW 25 — Recovered Value Ledger
1. Capturing a note on a scan-flagged client records a `thread_reopened` event (`reopen:<flagId>`); `promise_kept`/`brief_before_meeting` recorded by their own paths · [notes-routes.ts] · [note capture endpoints] · [P4-11]
2. Open The Ledger → summary (recomputed from stored events every call) · [ledger/Ledger.tsx] · [GET /ledger] · [P4-11]
3. Sees "Tovira touched N opportunities" + per-type rows ("thread reopened", "promise kept on time", "brief before a meeting") — **"touched", never "closed"/"won"** · [Ledger.tsx] · [—] · [P4-11]
4. Enter a deal value: pick client, type AED, Save · [Ledger.tsx] · [POST /clients/:id/deal-value {aed}] · [P4-11]
5. Server recomputes: AED = sum of rep-entered deal values for clients the ledger actually touched; null if none entered · [ledger-service.ts] · [—] · [P4-11]
6. Headline appends "· AED <total> of your pipeline" · [Ledger.tsx] · [—] · [P4-11]

**Happy end:** touched-opportunity count + per-type rows; AED appears only after a rep enters values, summing only touched clients.
**What can go wrong:** no events → "Nothing yet — as you act on flags and keep promises, they'll show here."; no deal values → AED clause hidden; invalid/negative AED → 400; bad JSON → 400; summary null → "Couldn't load your ledger."; value for an untouched client → excluded; deleted event → drops out (recomputed, never cached).
**Trust rules:** **no AED without a rep-entered value** (never estimated); "touched" language, no "closed"/"won" claims; every item links to its source event; totals recomputed so deletes propagate.
**Cold start:** ≥1 recorded event; deal values are opt-in per client.

### FLOW 26 — Export my data
1. Settings → "Your data" → "Export my data" · [account/AccountControls.tsx] · [GET /account/export] · [P5-4]
2. Server gathers the full corpus: clients, notes (raw text/transcripts), promises, key dates, meetings, image metadata · [account-service.ts] · [—] · [P5-4]
3. A "Download export" link appears (`data:application/json`), downloads `tovira-export.json` · [AccountControls.tsx] · [—] · [P5-4]

**Happy end:** a complete JSON export (`exportedAt` + all data) as a file.
**What can go wrong:** export null (offline/failed) → "Could not export your data — please try again."; unauthed → 401.
**Trust rules:** the full corpus in a usable format (nothing important lives only on-device).
**Cold start:** auth only; empty account exports empty arrays + a timestamp.

### FLOW 27 — Delete my account
1. Settings → "Your data" → "Delete my account" → inline confirm "Are you sure? This is permanent." · [AccountControls.tsx] · [—] · [P5-4]
2. "Yes, delete everything" → `doDelete` · [AccountControls.tsx] · [DELETE /account] · [P5-4]
3. Server runs every `UserPurgeable.purgeUser` then `auth.deleteUser` → Postgres FK cascade (incl. the training log); in-memory purges explicitly — data can't reappear in briefs/search/training · [account-service.ts] · [—] · [P5-4]
4. Success → `onDeleted()` (logged out) → landing/auth · [AccountControls.tsx] · [—] · [P5-4]

**Happy end:** account + all client data (incl. training records) removed via cascade; rep logged out.
**What can go wrong:** delete false → "Could not delete your account — please try again." (stays logged in); Cancel → dismissed, no deletion; unauthed → 401.
**Trust rules:** two-step confirmation before an irreversible delete; cascade includes the training log so deleted data can't reappear.
**Cold start:** auth only; the `purgeables` set must cover every store holding user data for the guarantee to hold.

---

## Settings

### FLOW 28 — Switch theme (Vault ↔ Ledger) + Settings hub
1. Settings → "Appearance" segmented control (System / Vault / Ledger), current from `getTheme()` (localStorage `tovira.theme`) · [settings/ThemeToggle.tsx, styles/theme.ts] · [—] · [brand §1 / story ?]
2. "Ledger" → `setTheme('ledger')` (localStorage + `<html data-theme='ledger'>`); "Vault" → `'vault'`; "System" → removes key + attribute (CSS follows device) · [theme.ts] · [—] · [story ?]
3. The Settings view also renders (top→bottom): `TrialIncentive`, `Billing`, `ThemeToggle`, `NotificationSetup`, `AccountControls` · [App.tsx `view==='settings'`] · [GET /billing/status, …] · [P5-1/2/5, P3-6, P5-4]
4. "Export my data" → FLOW 26; "Delete my account" → FLOW 27 · [AccountControls.tsx] · [GET /account/export, DELETE /account] · [P5-4]

**Happy end:** theme pinned on `<html data-theme>` and persisted; System reverts to device preference. Settings is the hub for billing, notifications, and data control.
**What can go wrong:** private-mode localStorage throw → `getTheme` returns `'system'`, `setTheme` doesn't persist (still applies for the session); export/delete failures as in FLOWS 26/27; unauthed on `/account*` → 401.
**Trust rules:** delete is guarded (one click never deletes); export is the full corpus.
**Cold start:** theme switching works brand-new (pure client state); export/delete work immediately.

---

## Cross-flow map (what feeds what)

- **Capture (8/9) → everything downstream.** A note's extracted facts feed the
  brief (10), promises tracker (14), Today's register (13), Ask/recall (12), the
  Book Scan (4), the Monday Statement (19), hero patterns/risk (22), and the
  ledger (25).
- **Seeding (4) → Book Scan (5) → referral (1/3).** Import produces the scan; the
  scan produces the share card; the share card's `?ref` link drives new signups.
- **Capture on a flagged client → ledger (25).** A `going_cold`/`chat_refresh`
  flag + a new note → a `thread_reopened` value-touch (18 → 25).
- **Promise kept on time (14) → ledger (25).** `promise_kept` value-touch.
- **Confirm/reject (10/14) share one queue.** `ConfirmChitQueue` surfaces the same
  `/confirmations` on Today/Alerts/Monday; the brief has its own inline confirm.
- **Scan (18) fans out.** `runAll` emits overdue-promise, going-cold, meeting,
  date, and chat-refresh alerts; the silence budget (2/day) gates the push; all
  land in Alerts regardless. Chat-refresh (20) loops back into capture.
- **Capture volume → hero gate (22).** Enough clients+notes unlock patterns/risk.
- **Signup (1) → trial (6/7) → subscribe (23) → renewal (23)/past-due (24).**

---

## Manual-test checklist (landing page first; shortest paths first)

Walk top to bottom in one sitting. **⚠ = cannot be fully verified locally.**

1. [ ] Landing `/` renders; "Start a 7-day trial" → `app.tovira.com/` (FLOW 1)
2. [ ] Landing `/?ref=demo` → CTA href carries `ref=demo` (FLOW 1)
3. [ ] Sign up (new email) → lands in empty ClientsScreen (FLOW 1)
3a. [ ] Unverified banner shows "Confirm your email…"; Resend works; dismiss hides it; **every feature still usable while unverified** (FLOW 3c)
3b. [ ] Open the welcome/verify link (`/verify-email?token=…`) → "confirmed" → banner gone; Settings shows Confirmed (FLOW 3c) — ⚠ needs a real mailer for the live email
3c. [ ] Resend 4× in a day → 4th is refused calmly (server rate limit) (FLOW 3c)
3d. [ ] Forgot password → email → reset link → new password logs in, old sessions dead (FLOW 3b) — ⚠ needs a real mailer for the live email
4. [ ] Log out → log back in → session restored on refresh (FLOW 2)
5. [ ] Settings → switch theme Vault ↔ Ledger ↔ System (FLOW 28)
6. [ ] Enable notifications: Android/desktop Enable, or iOS install-first / unsupported copy (FLOW 21) — ⚠ real device push delivery
7. [ ] Add a client (name form) (FLOWS 4/16)
8. [ ] Paste a message under the client → note appears → extracted (FLOW 9)
9. [ ] Record a voice note (or offline: airplane mode → record → reconnect → auto-upload) (FLOW 8)
10. [ ] Open the client → Pre-meeting brief → receipts; confirm a low-confidence item (FLOW 10)
11. [ ] Draft a follow-up → edit → Copy; Send via WhatsApp with and without a stored phone (FLOW 11)
12. [ ] Ask a typed question → answer + receipts; ask something absent → "I don't have that on record."; Voice (if supported) (FLOW 12)
13. [ ] Promises → mark done, confirm, reject (FLOW 14)
14. [ ] Meetings → "meeting with <client> next Tuesday 3pm" → parse → preview → save (FLOW 15)
15. [ ] Scan a business card → preview → create client (FLOW 16) — ⚠ needs a real key for vision
16. [ ] Gallery → upload an image to a client (FLOW 17)
17. [ ] Today's register → shows ranked items; Refresh (twice → rate-limit) (FLOW 13)
18. [ ] The Monday Statement → sections or honest "clear week" (FLOW 19)
19. [ ] Seed a WhatsApp export (iOS Files path) → import → Book Scan reveal → share card + referral link (FLOWS 4, 5) — ⚠ Android share-target (no handler)
20. [ ] Re-import the same export → expect a no-op (⚠ currently shows "Import failed."); import new messages → only new extracted (FLOW 20)
21. [ ] Trial extension: capture notes on 3 clients → Settings shows "earned +7 days" (FLOW 6)
22. [ ] Trial ceiling: import a very large chat → CeilingNotice, chats saved (FLOW 7)
23. [ ] Hero gate: reach ≥5 clients + ≥20 notes → patterns/risk appear (FLOW 22)
24. [ ] Going-cold + silence budget: trigger `POST /scan` with >2 alerts → ≤2 pushed, all in Alerts (FLOW 18) — ⚠ real push delivery
25. [ ] Ledger: act on a flagged client + keep a promise on time → touched count; enter a deal value → AED (FLOW 25)
26. [ ] Subscribe monthly, then annual → Stripe Checkout → webhook → "Renews …" (FLOW 23) — ⚠ real Stripe / webhook
27. [ ] Past-due + cancellation copy (FLOW 24) — ⚠ real Stripe webhooks
27a. [ ] Lifecycle emails land: trial-ending (~2d out) + trial-ended (job), payment-failed / confirmed / canceled (webhook) — ⚠ real mailer + scheduler; verify idempotency (no duplicate on re-run/replay)
28. [ ] Export my data → download JSON (FLOW 26)
29. [ ] Delete my account → confirm → **deletion email arrives BEFORE the purge** → cascade → logged out (FLOW 27) — ⚠ real mailer for the live email
30. [ ] Embedded Locked: let the trial lapse (or force a 402) → brief panel, follow-up draft, and card scan each show the shared **Locked** state with Subscribe → Billing (FLOWS 10/11/16, fix(LOCKED-EMBEDDED))

**Locally unverifiable:** iOS push delivery (needs an installed PWA on a device),
real Stripe Checkout/webhooks (test-mode keys + a tunnel), the Android
share-target POST (no handler — see below), and any vision/AI-quality step without
a real model key (`docker-compose.real-ai.yml`).

---

## Entitlement inventory (fix(ENTITLEMENT))

The policy: a lapsed trial is never locked out of its own data or the ability to
leave with it; premium *features* return one calm 402 → "Your trial has ended.
Subscribe to reopen your book."

| Endpoint | Gated (402) | Notes |
|---|---|---|
| `POST /auth/*`, `GET /me` | no | auth is always open |
| `POST /clients/:id/notes/{voice,paste,import}` | **no** | capture is always open |
| `GET /account/export`, `DELETE /account` | **no** | never trap a rep's data or exit |
| `GET/POST /billing/*`, Settings | no | must be able to subscribe |
| `POST /clients`, `GET /clients`, gallery, meetings, promises, ledger, alerts | no | not premium features |
| `GET /clients/:id/brief` | **yes** | was already gated |
| `POST /recall` | **yes** | added |
| `GET /book-scan` | **yes** | added |
| `GET /monday-digest` | **yes** | added |
| `GET /today`, `/hero/status`, `/hero/patterns`, `/hero/risk`, `POST /today/refresh` | **yes** | added |
| `POST /notes/:id/follow-up` | **yes** | added (capture stays free) |
| `POST /cards/scan` | **yes** | added |

Enforced server-side via `requireEntitled` (402, no data in the body). The web
shows the one `<Locked>` state on the primary gated views (Today, Ask, the Monday
Statement, Book Scan); the embedded surfaces (brief panel, follow-up draft, card
scan) are server-gated and fall back to their empty/error state — a consistent
`<Locked>` on those is a small follow-up noted in the report.

---

## Open questions / discrepancies (code vs docs — nothing changed)

**RESOLVED in the launch-blocker batch:** items 1–5 below are now fixed — #1
Android share-target (`fix(FLOWS-1)`), #2 duplicate re-import (`fix(FLOWS-2)`),
#3 meetings parse union (`fix(MEETINGS-UNION)` `e334c61`), #4 card fields
(`fix(CARD-FIELDS)` `7fa0b45`), #5 voice stall (client `fix(FLOWS-5)` + server
`fix(VOICE-STALL)` `48eed9b`). Labelling items 6–13 partly addressed (Monday in
the silence budget `4fd8553`; opaque referral code `de214e6`; canceled copy
`174f4f7`; the empty-audio "contradiction" is not one — an empty upload BODY is
400 while SILENT audio is `needs_review`, two distinct cases; story-IDs listed
for Wabil in `LAUNCH-BLOCKERS-REPORT.md`). **#10 (consent unreachable from the
UI) is also resolved** — `LoginScreen` now ticks "accept terms" and sends
`consent:true`.

**RESOLVED in the pre-launch close-out batch** (see `PRE-LAUNCH-REPORT.md`):
lifecycle emails wired to their events + **soft email verification** (FLOW 3c);
the embedded `<Locked>` state on the brief / follow-up / card surfaces on a 402
(FLOWS 10/11/16). The extraction prompt is confirmed at **v0.5** in `docs/` — no
version-label discrepancy remains.

Original descriptions kept for record:

1. **Android share-target has no handler.** `apps/web/src/pwa/manifest.ts` declares
   `share_target.action = '/share-target'`, but no server route and no
   service-worker `fetch` handler exists for it. A real Android "Share to Tovira"
   POST would not be received; seeding works only via the in-app file picker /
   paste. The manifest/onboarding copy describes a path the code doesn't implement.
2. **Duplicate re-import surfaces as an error.** The server returns **HTTP 200**
   `{note:null, imported:0, duplicate:true}` (intended idempotent success), but
   `clientsClient.importWhatsApp` treats only **201** as success, so a fully-
   overlapping re-import shows a red "Import failed." The `duplicate` flag is never
   read client-side. (FLOWS 4, 20.)
3. **Meetings parse contract mismatch.** The server returns a discriminated
   `ParseResult` (`kind: proposal | ambiguous_time | ambiguous_client | no_client`),
   but the web client casts it to a flat `ParsedMeeting` and reads `clientId`/`title`.
   Only `proposal` carries `clientId`; no kind carries `title`; the
   `ambiguous_client` candidates and `no_client` name are never surfaced. The web
   "Couldn't read a meeting" error fires only on transport failure, not on the
   parser's ambiguity kinds. (FLOW 15.)
4. **Card scan drops fields on create.** The preview shows scanned `title` and
   `email`, but `onCreateClient` sends only `name` (+`phone`) to `POST /clients`;
   title and email are displayed then discarded. (FLOW 16.)
5. **Voice pipeline is client-orchestrated, not a worker.** `pending_transcription
   → pending_extraction → extracted` is advanced by the browser (`App.tsx refresh()`).
   If the rep never revisits the client-detail/Capture screen, a voice note can sit
   at `pending_transcription` indefinitely (no background job). (FLOW 8.)

Documentation/labelling discrepancies (no code fix implied):

6. **Referral "code" is the raw user id.** The share link is `/?ref={user.id}` — no
   opaque token; the UUID is exposed in the shareable URL. (FLOWS 1, 5.)
7. **`P4-SILENCE` and `P5-1-UI` story IDs** are used in code but do not exist in
   `docs/tovira-user-stories.md`. The silence-budget cap (2/day) is documented only
   in `docs/tovira-brand.md`. The going-cold alert itself is `P3-3`.
8. **Monday push bypasses the silence budget.** `monday_digest` has a rank in the
   push map but is emitted by `notifyMonday` (in-app only), not through
   `PushDispatchService`, so it never consumes the `/scan` push budget. (FLOW 19.)
9. **`canceled`/`trial_expired` share the generic "trial ended" copy.** `Billing.tsx`
   special-cases only `active`/`trialing`/`past_due`; a canceled *paid* sub still
   reads "Your trial has ended." (FLOW 24.)
10. **`consent` on signup is unreachable from the UI.** The API rejects `consent:false`
    with 400 `consent_required`, but the web `LoginScreen` never sends a `consent`
    field. (FLOW 1.)
11. **Theme toggle has no story ID** and is omitted from the Settings section of the
    frontend docs, though `App.tsx` renders it there. (FLOW 28.)
12. **Recall voice uses the Web Speech API, not Groq.** A `recall-routes.ts` comment
    implies the Groq STT pipeline; the actual Voice button uses the browser
    `SpeechRecognition` (Groq is the capture path only). If unsupported, the button
    isn't rendered. (FLOW 12.)
13. **`docs/FRONTEND-PAGES.md` is not in `docs/`** — it was moved to the repo root
    (`FRONTEND-PAGES.md`) in the marketing-site batch; story IDs here were taken
    from code comments and `docs/tovira-user-stories.md` where the two disagree.
