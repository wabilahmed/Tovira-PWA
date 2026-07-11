# Tovira — User Stories

*Each phase from the dev plan, broken into build-ready stories. Format: **As a [role], I want [capability], so that [benefit]**, with acceptance criteria (AC). Story IDs (P#-#) are for backlog tracking.*
Last updated: 2026-07-09

Roles: **Rep** (the salesperson, primary user) · **New/Prospective rep** (signup, trial, onboarding) · **Developer/Team** (enabler & infra work) · **Founder** (ops/cost).

---

## Phase 0 — Local foundations & skeleton  *(mostly developer/system stories)*

**[P0-1] One-command local environment** — *As a developer, I want the whole stack to run with a single command, so that I can iterate instantly.*
- `docker compose up` starts Postgres+pgvector, backend API, and web app.
- pgvector extension enabled; migrations run on boot; hot reload works.

**[P0-2] Swap-ready interfaces** — *As a developer, I want auth, model calls, storage, and the scheduler behind thin interfaces, so that swapping local stand-ins for AWS later is a config change, not a rewrite.*
- Each external dependency has a local implementation behind an interface.
- Switching an implementation requires no change to business logic.

**[P0-3] Sign up & log in** — *As a rep, I want to create an account and log in, so that my data is private to me.* (local stub auth)
- Signup, login, logout; session persists across refresh.
- Unauthenticated requests are rejected.

**[P0-4] Tenant isolation** — *As a rep, I want my data walled off from other reps, so that no one else can ever see my clients.*
- Every table carries `user_id`; Row-Level Security enforced at the DB.
- A query run as Rep A never returns Rep B's rows (covered by a test).

**[P0-5] Installable PWA shell** — *As a rep, I want to add the app to my home screen, so that it behaves like a real app.*
- Installable on localhost; service worker registers; app shell loads offline.

**[P0-6] Seed data** — *As a developer, I want realistic fixtures, so that I can build and test against representative data.*

---

## Phase 1 — The spine (capture → transcribe → extract → store)  *(rep + system)* ★ CORE

**[P1-1] Create a client** — *As a rep, I want to create a client, so that I have a place to store everything about them.*
- Create + name a client; appears in my client list; owned by me only.

**[P1-2] Fast client selection** — *As a rep, I want to find and open a client in seconds, so that capturing a note never feels like work.*
- Recents surfaced first; search by name; defaults to last-touched.
- Reaching the capture screen for a known client takes minimal taps.

**[P1-3] Record a voice note** — *As a rep, I want to record a voice note under a client, so that I can capture a meeting hands-free.*
- Record in-browser; raw audio persisted immediately (survives refresh/crash).

**[P1-4] Paste a message** — *As a rep, I want to paste a message (e.g. WhatsApp) under a client, so that I can capture their exact words.*
- Pasted text stored raw under the selected client.

**[P1-5] Transcribe voice** — *As a rep, I want my voice note turned into text, so that it becomes usable and searchable.*
- Audio → Groq/Whisper → transcript stored; handles typical 30–60s notes.

**[P1-6] Extract structured facts** — *As the system, I want to pull promises, dates, people, personal facts, concerns, and meetings out of each note, so that features can act on them.*
- Extraction returns valid JSON per the v0.1 schema.
- Spine fields → columns; personal facts/concerns/summary → JSONB; raw text → pgvector embedding.
- Cacheable prefix ≥4,096 tokens; today's date passed in the variable part.
- Malformed JSON is retried once, then flagged for review — never partially written.

**[P1-7] Flag uncertainty** — *As a rep, I want anything unclear flagged rather than guessed, so that I can trust what's stored.*
- Low-confidence items and unresolved dates are marked for later confirmation.

**[P1-8] Log every extraction** — *As a developer, I want each extraction's input, output, and model/prompt version logged, so that we can later train our own model.*
- Every call writes a log row stamped with model + prompt version.

**[P1-9] ★ Extraction quality gate** — *As the team, I want to benchmark Haiku vs Sonnet on real messy notes, so that we only proceed once extraction is trustworthy.*
- An eval set of real, messy notes exists; precision on promises/dates/people is measured; the model decision is recorded. **Do not start Phase 2 until this passes.**

---

## Phase 2 — The payoff (pre-meeting brief)  *(rep)* ★ MVP-completing

**[P2-1] Pre-meeting brief** — *As a rep, I want a brief when I open a client, so that I walk into the meeting prepared.*
- Assembled from spine + JSONB + semantic search over past notes.
- Shows recent context, open items, key people, and personal notes; loads fast.

**[P2-2] Client timeline** — *As a rep, I want to see everything logged for a client over time, so that I can review the relationship's history.*

**[P2-3] Confirm & correct** — *As a rep, I want to confirm or fix what Tovira understood, so that wrong facts don't persist.*
- Low-confidence items, unresolved dates, and meetings surface with one-tap confirm/edit.
- Corrections are saved and captured as training data.

**[P2-4] No guesses as facts** — *As a rep, I want the brief to never present a guess as a fact, so that I can rely on it in front of a client.*
- Uncertain items are visibly marked or withheld.

---

## Phase 3 — Proactive layer (know when)  *(rep)*

**[P3-1] Add a meeting** — *As a rep, I want to put a meeting on my Tovira calendar, so that it knows when I'll see a client.*
- Create + tag a client; also via natural language ("meeting with X Tue 3pm"), parsed by the engine and confirmed before saving.

**[P3-2] Pre-meeting nudge** — *As a rep, I want a reminder before a meeting, so that I get the brief at the right moment.*

**[P3-3] Going-cold alert** — *As a rep, I want to be told when a client goes quiet, so that relationships don't slip away.*
- Configurable threshold; daily scan; alert generated; job is idempotent (no double-sends).

**[P3-4] Date reminders** — *As a rep, I want reminders for birthdays, anniversaries, and launches, so that I reach out at meaningful moments.*

**[P3-5] In-app cold list (fallback)** — *As a rep, I want an in-app list of cold clients, so that I get value even when a push notification fails.*

**[P3-6] Enable notifications in onboarding** — *As a new rep, I want to install and enable notifications during setup, so that nudges actually reach me* (critical on iOS).

---

## Phase 4 — Feature completion  *(rep)*

**[P4-1] Open promises tracker** — *As a rep, I want one list of every promise I've made, so that I never drop a commitment.*
- Aggregates `promises` across clients; shows due date + status; mark done.

**[P4-2] Stakeholder map** — *As a rep, I want to see who's who in a deal, so that I know the decision-maker and the blocker.*

**[P4-3] Personal-facts memory** — *As a rep, I want a contact's personal details surfaced, so that I can build genuine rapport.*

**[P4-4] Follow-up draft** — *As a rep, I want a follow-up message drafted from my voice note, so that I can send it in seconds.*
- Note → draft in my tone; editable; copy/send.

**[P4-5] Business-card scan** — *As a rep, I want to snap a business card, so that a new contact is captured without typing.*
- Photo → vision model → structured contact; confirm before save.

**[P4-6] Client gallery** — *As a rep, I want an image gallery per client, so that I can store relevant photos.*

---

## Phase 4b — Hero features (the hook)  *(rep)* ★ DIFFERENTIATOR

**[P4b-1] Cross-client pattern intelligence** ★ — *As a rep, I want Tovira to show me patterns across all my deals, so that I learn things about my own selling I could never have spotted myself.*
- Surfaces patterns across the whole book (stall points, what correlates with closing, what precedes clients going dark).
- Every pattern shows its supporting evidence (which deals, which signals) and honest confidence language.
- Only active above the volume threshold.

**[P4b-2] Deal-risk radar** — *As a rep, I want to be warned when a deal is slipping, so that I can act before it's lost.*
- Live risk signal from cross-client patterns (silence, missed promises, no decision-maker contact, stall-point match).
- Shows *why* it's flagged, not just that it is.
- Only active above the volume threshold.

**[P4b-3] What should I do today?** — *As a rep, I want a ranked list of my highest-leverage actions, so that I know where to spend my day.*
- Always on. With thin data, ranks on basics (open promises, upcoming meetings, cold clients); gets smarter as patterns emerge.

**[P4b-4] Volume gate & warming-up state** — *As a new rep, I want to see what unlocks pattern insights, so that I'm motivated to feed Tovira rather than confused by a missing feature.*
- Below threshold: clear "warming up" state explaining exactly what unlocks it (doubles as a seeding incentive).
- Above threshold: features activate.

---

## Phase 5 — Monetization & launch readiness  *(new rep + rep)*

**[P5-1] Free trial** — *As a prospective rep, I want a 7-day free trial, so that I can experience the value before paying.*
- Trial starts at signup; full access; converts to paid or locks at day 7.

**[P5-2] Subscribe & manage billing** — *As a rep, I want to subscribe and manage my plan, so that I can keep using Tovira.*
- Stripe Checkout; subscription state driven by **webhooks (source of truth)**; failed-payment handling.

**[P5-3] Day-one seeding onboarding** — *As a new rep, I want guided setup that lets me paste old threads and add clients fast, so that Tovira is useful before my trial ends.*
- Onboarding prompts to add first clients + paste history; a first useful brief is reachable within the trial.

**[P5-4] Data trust & control** — *As a rep, I want clarity and control over my (and my clients') data, so that I feel safe storing it.*
- Consent at signup; stated retention policy; export/delete path.

---

## Phase 6 — Cloud infrastructure & deployment (AWS)  *(developer/founder + cloud-parity)*

**[P6-1] Deploy on AWS** — *As a developer, I want the app running on AWS per the infra design, so that real users can access it.*
- Provisioned per `tovira-aws-infra.md` (public subnet/no NAT, single-AZ RDS+pgvector, Bedrock routing, Cognito, EventBridge+Lambda); CI/CD deploys repeatably.

**[P6-2] Swap stand-ins via config** — *As a developer, I want local stand-ins replaced by managed services through config, so that prod behavior matches dev.*
- Auth→Cognito, cron→EventBridge/Lambda, AI→Bedrock, DB→RDS, hosting→S3/CloudFront, images→S3.

**[P6-3] iOS push works on a real device** — *As a rep on iPhone, I want notifications to actually arrive, so that the proactive features are real.* (cloud-parity)
- Verified on a real device over HTTPS after home-screen install.

**[P6-4] Ops safety net** — *As a founder, I want cost and error alarms plus backups, so that I'm never surprised by a bill or an outage.*
- Billing/cost alarms live; monitoring + error tracking; backups confirmed.

**[P6-5] Isolation verified in prod** — *As a developer, I want tenant isolation verified under real Cognito auth, so that there are no cross-tenant leaks in production.*

---

## Phase 7 — Beta & iterate  *(rep + team)*

**[P7-1] Real-workflow beta** — *As a field rep in beta, I want to use Tovira in my actual daily workflow, so that I can tell whether it genuinely helps.*

**[P7-2] Capture corrections** — *As the team, I want every rep correction captured, so that we build training data and improve extraction.*

**[P7-3] Instrument activation & churn** — *As the team, I want activation ("aha" within trial) and churn measured, so that we know whether the core magic lands.*

---

## Suggested cut for a first shippable slice (MVP)

The thinnest set that delivers the magic: **P0-1→P0-5, all of Phase 1, P2-1/P2-3/P2-4**, plus **P4-1 (open promises)** pulled forward, then **Phase 6** to get it on real devices. Everything else layers on after the core loop proves itself.
EOF
