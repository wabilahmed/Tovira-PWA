# Tovira PWA — Frontend Pages & Functionality

The web app (`apps/web`) is a **single-page React PWA**. It has two top-level
states — a **Login/Sign-up screen** when unauthenticated, and an **authed shell**
otherwise. The authed shell has a persistent nav that switches between "pages"
(view states); one page (**Clients**) drills into a **Client detail** sub-screen.

Every page is backed by a typed API client (`credentials: 'include'`, cookie
session) and has positive + negative tests. Endpoints each page calls are listed
under **How**.

Navigation (authed): `Clients · Today · Week · Ask · Promises · Meetings · Alerts · Book Scan · Value · Settings` (+ a conditional **Get started** and a header **corpus badge**).

---

## 1. Login / Sign-up  (`App.tsx` → `LoginScreen`)
**Scope:** P0-3 (auth), P5-6 (referral capture).

**Functionality**
- **Log in** with email + password.
- **Toggle to Sign-up** ("Need an account? Sign up") → "Create account".
- **Session persistence** — on load the app asks the server who it is; a valid
  cookie keeps you logged in across refresh.
- **Log out** (from the header).
- **Referral capture** — if the page URL carries `?ref=<code>`, that code rides
  along on sign-up so the referrer and the new rep both get a free month (P5-6).
- **Error handling** — a rejected login/signup (e.g. duplicate email) shows the
  server's message and stays on the form.

**How:** `AuthClient` → `POST /auth/login`, `POST /auth/signup` (body includes
`ref` when present in `window.location.search`), `POST /auth/logout`, `GET /me`
(bootstrap). The session object is held in React state; `getSession()` on mount
gates the whole app.

---

## 2. Clients  (`App.tsx` → `ClientsScreen`, list view)
**Scope:** P1-1 (create client), P1-2 (fast selection). *(P4-5 business-card scan removed 2026-09-02 — feat(REMOVE-CARDSCAN).)*

**Functionality**
- **List clients**, most-recently-touched first.
- **Search** clients by name (debounced reload as you type).
- **Create a client** by name.
- **Open a client** → Client detail.

**How:** `ClientsClient.list(query)` → `GET /clients` / `GET /clients?q=`,
`create(name, phone?, {title?, email?})` → `POST /clients` (title/email/phone settable manually).

---

## 3. Client detail  (`App.tsx` → `ClientDetail`)
The richest screen — reached by opening a client. Bundles capture, recall, and
per-client intelligence.

**Scope:** P1-3/P1-4/P1-4b/P1-5, P2-1/P2-2/P2-3, P3-7, P4-2/P4-3/P4-4/P4-6/P4-7.

**Functionality**
- **Pre-meeting brief** (P2-1): open promises, items to confirm, key people,
  concerns, personal notes — assembled server-side from facts + semantic search.
- **Confirm / reject** low-confidence promises inside the brief (P1-7/P2-3).
- **Stakeholder map** (`StakeholderMap`, P4-2): a collapsible "who's who" —
  people grouped by decision role (decision-maker / influencer / blocker /
  others) with reporting lines.
- **Record a voice note** (P1-3): in-browser capture → saved to an offline
  outbox that survives refresh/crash and uploads with retry.
- **Paste a message** (P1-4): stored verbatim, queued for extraction.
- **Import a WhatsApp chat export** (`ImportChat`, P1-4b): file upload or paste,
  **required consent**, then batch extraction. Re-importing dedupes — an
  identical file adds nothing; a re-export imports only the new tail (P3-7).
- **Notes timeline** (P2-2): each note with its source + processing state; the
  UI advances notes through transcribe → extract automatically.
- **Follow-up draft** per note (`FollowUpDraft`, P4-4): generate an editable
  draft, edit it, **Copy**, or **Send via WhatsApp** (P4-7) — a `wa.me` deep link
  pre-filled with the (edited) text. Tovira never auto-sends; the rep taps send
  in WhatsApp.
- **Photo gallery** (`Gallery`, P4-6): per-client images with upload.

**How:** `ClientsClient` → `GET /clients/:id/brief`, `POST /promises/:id/confirm`,
`DELETE /promises/:id`, `GET /clients/:id/stakeholders`, `POST /clients/:id/notes/voice`
(via the offline `Outbox`/`HttpUploader`), `POST /clients/:id/notes/paste`,
`POST /clients/:id/notes/import`, `GET /clients/:id/notes`, `POST /notes/:id/transcribe`,
`POST /notes/:id/extract`, `POST /notes/:id/follow-up`. `ImagesClient` →
`GET/POST /clients/:id/images`, `GET /images/:id`. WhatsApp link built by
`whatsappLink(text, phone?)` (pure `wa.me` URL-encoder).

---

## 4. Get started  (`onboarding/GetStarted.tsx` → `SeedingBanner` + `ImportChat`)
Shown as a highlighted nav item until the rep has seeded (imported a chat).

**Scope:** P5-3 (day-one seeding via WhatsApp export).

**Functionality**
- **Guided seeding** — per-platform steps (Android: share the export to Tovira;
  iOS: Export Chat → Files → upload). Never asks for paste-based bulk entry.
- **Create-client-if-needed** — if the rep has no client yet, the flow first
  asks who the chat is with and creates them.
- **Import → hand off to Book Scan** — a successful import flips the view to the
  Book Scan so the "wow" fires in the first session.
- **Skip fallbacks** — a rep who isn't ready is offered a voice-note micro-wow or
  a sample book (so they're never left with an empty app).

**How:** `OnboardingClient.status()` → `GET /onboarding/status` (reports
`seeded`, per-platform `steps`, `fallbacks`, `requiresPasteEntry:false`). Import
reuses `ClientsClient.importWhatsApp` → `POST /clients/:id/notes/import`.

---

## 5. Today  (`hero/HeroInsights.tsx`)
**Scope:** P4b-1 (patterns), P4b-2 (deal-risk radar), P4b-3 (what to do today),
P4b-4 (volume gate).

**Functionality**
- **"What to do today"** — an always-on ranked action list (chase promises,
  upcoming meetings, cold clients).
- **Cross-client patterns** — surfaced with evidence (which deals) and honest
  confidence language; only above the volume threshold.
- **Deal-risk radar** — at-risk clients with the reasons why.
- **Warming-up state** — below threshold, an honest "keep feeding Tovira" panel
  saying exactly what unlocks patterns (N more clients / notes), not a broken
  empty feature.

**How:** `HeroClient` → `GET /today` (actions), `GET /hero/status` (volume gate),
`GET /hero/patterns`, `GET /hero/risk`. The gate's `unlocked` flag chooses
between the warming-up card and the patterns/risk lists.

---

## 6. Week  (`monday/MondayDigest.tsx`)
**Scope:** P3-8 (Monday Morning Scan).

**Functionality**
- **Weekly digest** — promises due this week, cooling clients, unanswered client
  questions, and upcoming dates, each in its own section (sections with no items
  are hidden).
- **Honest "clear week"** — a light week says so plainly, never padded with
  stale/fabricated items.
- Viewable in-app regardless of whether push is enabled.

**How:** `MondayClient.get()` → `GET /monday-digest`.

---

## 7. Ask  (`recall/Ask.tsx`)
**Scope:** P4-8 (conversational recall).

**Functionality**
- **Ask your memory** a question by text (e.g. "what did Ahmed say about
  pricing?").
- **Ask by voice** — an optional mic button uses the browser's SpeechRecognition
  to transcribe speech into the question box, then answers the same as text.
- **Answer with receipts** — every answer shows its receipts (verbatim quote +
  date from the rep's own notes).
- **Honest "I don't have that"** — when nothing relevant is retrieved, no
  fabrication; error state on failure.

**How:** `RecallClient.ask(question)` → `POST /recall`. Voice via an injected
`listen()` built on `window.SpeechRecognition` (feature-detected; button hidden
if unsupported).

---

## 8. Promises  (`promises/PromisesTracker.tsx`)
**Scope:** P4-1 (open-promises tracker), P1-7 / P2-3 (confirmation queue).

**Functionality**
- **Open promises across all clients**, with due dates; **mark Done** removes an
  item (and, server-side, credits the value ledger when kept on time).
- **Confirmation queue** — uncertain/low-confidence items with **Confirm** /
  **Reject**.
- Failure handling — a failed mark-done keeps the item and shows an error.

**How:** `PromisesClient` → `GET /promises`, `GET /confirmations`,
`POST /promises/:id/done`, `POST /promises/:id/confirm`, `DELETE /promises/:id`.

---

## 9. Meetings  (`meetings/Meetings.tsx`)
**Scope:** P3-1 (add a meeting, incl. natural language).

**Functionality**
- **Add via natural language** — type "meeting with Acme next Tuesday 3pm" →
  **parse to a preview** → pick the client → **confirm to save** (never saved
  without confirmation).
- **List meetings** with client name and time; **Remove**.
- Error handling — an unparseable description shows an error and no preview.

**How:** `MeetingsClient` → `GET /meetings`, `POST /meetings/parse` (preview),
`POST /clients/:id/meetings` (save), `DELETE /meetings/:id`.

---

## 10. Alerts  (`proactive/Alerts.tsx`)
**Scope:** P3-3 (going-cold), P3-5 (in-app cold list), P3-7 (chat refresh),
P3-2/P3-4 (nudges & date reminders surface here too).

**Functionality**
- **In-app notifications** — pre-meeting nudges, going-cold alerts, date
  reminders, and **chat-refresh nudges** (re-export a stale chat) all render here
  — value even when push is off.
- **Going-quiet list** — clients that have gone cold, with last-contact dates.
- **Refresh** — re-runs the daily scan on demand and reloads.

**How:** `ProactiveClient` → `GET /notifications`, `GET /cold`, `POST /scan`
(refresh). Notification types render generically, so new server-side types
(e.g. `chat_refresh`) appear automatically.

---

## 11. Book Scan  (`bookscan/BookScan.tsx` + `share/ShareCard.tsx`)
**Scope:** P5-3b (Day-One Book Scan), P5-6 (share card + referral).

**Functionality**
- **Relationship X-Ray** — reveals open promises, unanswered client questions,
  going-cold gaps, and upcoming dates. **Every item carries a receipt** (quote +
  date); promises are framed "worth checking", never accusatory.
- **Honest empty state** — a thin seed gets "not much here yet — export another
  chat", never fabricated findings; ends with the "export your next chat"
  invitation.
- **Share card** (`ShareCard`, P5-6) — a **counts-only** card ("7 open promises
  found…") with **zero client-identifying content**, plus a **referral link**
  (`/?ref=<your id>`) with copy-to-share (give a month / get a month).

**How:** `BookScanClient.scan()` → `GET /book-scan` (items with receipts).
`ShareCardClient.get()` → `GET /share-card` (numbers only). The referral link is
built client-side from the logged-in user's id.

---

## 12. Value  (`ledger/Ledger.tsx`)
**Scope:** P4-11 (Recovered Value Ledger).

**Functionality**
- **Value touched** summary — counts of real value-touch events (promises kept on
  time, threads reopened after a flag, briefs viewed before meetings).
- **"Touched", never "closed"** — the copy never uses "closed"/"won" or causal
  claims (asserted in tests).
- **AED figure only when earned** — the pipeline AED total appears only after the
  rep enters deal values; never estimated.
- **Enter a deal value** per client (client picker + AED), which then feeds the
  AED total.
- **Empty state** — "nothing yet — act on flags and keep promises".

**How:** `LedgerClient.summary()` → `GET /ledger`, `setDealValue(clientId, aed)`
→ `POST /clients/:id/deal-value`. (The ledger events themselves are recorded
server-side by triggers on the done/brief/capture paths.)

---

## 13. Settings  (`billing/Billing.tsx` + `push/NotificationSetup.tsx` + `account/AccountControls.tsx`)
**Scope:** P5-1/P5-2/P5-5 (trial & billing), P3-6 (notifications), P5-4 (data control).

**Functionality**
- **Plan status** (`Billing`) — trial days remaining, subscribed, past-due, or
  expired states.
- **Subscribe** — **monthly (AED 299/mo)** or **annual (AED 2,990/yr)**; each
  starts Stripe Checkout for that plan and redirects. Annual is shown as a yearly
  charge, never as a monthly one. Webhooks remain the server's source of truth.
- **Enable notifications** (`NotificationSetup`, P3-6) — install-first guidance on
  iOS, then request permission → subscribe via the service worker's push manager
  → persist the subscription; enabled/denied/unsupported/error states, with the
  in-app cold list always the fallback. **Send a test** notification.
- **Export my data** (`AccountControls`, P5-4) — download the full corpus (clients,
  notes/transcripts, facts, meetings, images) as JSON.
- **Delete my account** — guarded by an explicit confirmation (one click never
  deletes; Cancel aborts); on success it logs the rep out.

**How:** `BillingClient` → `GET /billing/status`, `POST /billing/checkout {plan}`.
`PushClient` → `POST /push/subscribe`, `POST /push/test` (browser dance in
`enablePush()` with injected permission/registration for testability).
`AccountClient` → `GET /account/export`, `DELETE /account`.

---

## Header — Corpus badge  (`corpus/CorpusBadge.tsx`)
**Scope:** P4-10 (corpus-value visibility).

**Functionality:** shows "🧠 X months · Y moments" — how much Tovira remembers —
hidden until there's something to show (no zero-taunt on a fresh account).

**How:** `CorpusClient.get()` → `GET /corpus-stats`.

---

## Cross-cutting: the PWA shell  (`main.tsx`, `pwa/*`)
**Scope:** P0-5 (installable PWA), P5-3 (Android share target).

**Functionality**
- **Installable** — web manifest (name, icons incl. maskable, standalone display,
  theme colors); registers a service worker; app shell renders offline.
- **Auto-update** — a new service worker skips waiting and reloads once so
  returning users get the fresh build.
- **Android share target** — the manifest declares a `share_target` accepting a
  `.txt`, so WhatsApp's "Export chat" can share directly into Tovira.
- **Offline capture** — voice recordings are stored in IndexedDB (`Outbox`) and
  upload with retry, so a recording is never lost.

**How:** `registerServiceWorker.ts`, `manifest.ts` (consumed by
`vite-plugin-pwa`), and the `capture/*` modules (recorder, IndexedDB store,
uploader, outbox).

---

### Summary table

| Page / screen | Component(s) | Stories | Primary endpoints |
|---|---|---|---|
| Login / Sign-up | `LoginScreen` | P0-3, P5-6 | `/auth/*`, `/me` |
| Clients | `ClientsScreen` | P1-1/1-2 | `/clients` |
| Client detail | `ClientDetail`, `StakeholderMap`, `ImportChat`, `FollowUpDraft`, `Gallery` | P1-3/1-4/1-4b/1-5, P2-1/2-2/2-3, P3-7, P4-2/4-3/4-4/4-6/4-7 | `/clients/:id/*`, `/notes/:id/*`, `/images/*` |
| Get started | `GetStarted`, `SeedingBanner` | P5-3 | `/onboarding/status`, import |
| Today | `HeroInsights` | P4b-1/2/3/4 | `/today`, `/hero/*` |
| Week | `MondayDigest` | P3-8 | `/monday-digest` |
| Ask | `Ask` | P4-8 | `/recall` |
| Promises | `PromisesTracker` | P4-1, P1-7, P2-3 | `/promises`, `/confirmations` |
| Meetings | `Meetings` | P3-1 | `/meetings*` |
| Alerts | `Alerts` | P3-3/3-5/3-7 | `/notifications`, `/cold`, `/scan` |
| Book Scan | `BookScan`, `ShareCard` | P5-3b, P5-6 | `/book-scan`, `/share-card` |
| Value | `Ledger` | P4-11 | `/ledger`, `/clients/:id/deal-value` |
| Settings | `Billing`, `NotificationSetup`, `AccountControls` | P5-1/2/5, P3-6, P5-4 | `/billing/*`, `/push/*`, `/account*` |
| Header badge | `CorpusBadge` | P4-10 | `/corpus-stats` |
| PWA shell | `pwa/*`, `capture/*` | P0-5, P5-3 | (offline / manifest / SW) |
