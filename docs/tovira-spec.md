# Tovira — Product Spec

*Living document. Updated each time a decision is locked.*
Last updated: 2026-07-09

---

## 1. What Tovira is

A memory bank for salespeople. It stores everything a rep knows about a client or prospect, turns it into actionable insight, and surfaces it when the rep needs it.

**The problem:** A rep deals with many clients, and what they know about each one grows with every conversation. No one can hold all of it in their head. Details blur, commitments get forgotten, and the edge that wins a deal lives in a notebook or nowhere at all.

**The gap Tovira owns:** The market is full of "conversation intelligence" tools (Gong, Sybill, Jiminny, Fathom) — but they only work on *recorded* calls (Zoom, Meet). Tovira is built for the **un-recorded world**: in-person meetings, coffees, dinners, phone calls — where nothing gets captured automatically and the rep has to feed it in. That world is underserved (conversation intelligence adoption is ~80% in inside sales but only ~28% in field sales).

**One-line positioning:** Everyone built memory for recorded conversations. Tovira builds memory for the ones that never get recorded.

---

## 2. Target user — LOCKED

Field / in-person, **relationship-driven** sellers. Not inside-sales / call-and-demo teams.

**Focus is the individual salesperson for now.** Team / org-level features (e.g. relationship handoff when a rep leaves) are explicitly deferred — they're the later path to selling into orgs, not part of the initial product.

---

## 3. The core spine

`capture → store → know when → surface`

Every design decision serves one of these four stages.

---

## 4. Locked decisions

### Capture
- **Input methods, in priority order:** (1) voice notes, (2) pasted messages from social apps (e.g. WhatsApp), (3) gallery images, (4) typing — last resort only.
- **Everything is captured *inside a client's tab*.** The rep opens the specific client first, then records / pastes / uploads. This is how Tovira knows which client a memory belongs to (no guessing).
- Voice notes go through client tabs too — consistency over raw capture speed.

### Structure
- Reps create **clients** in the app. Each client has its own tab.
- Each client tab includes a **gallery** section for storing images.

### Calendar
- Tovira has its **own internal calendar** per rep (no external calendar integration at launch).
- Meetings can be added two ways: (1) create a meeting and tag a client, or (2) send a voice note / text ("meeting with [client] on X date at Y time") and Tovira updates the calendar.
- **The calendar is not mandatory to keep updated.**

### Surface (how insights reach the rep)
- **Primary path is PULL:** the rep opens a client tab and asks for insights before a meeting.
- Calendar-based nudges (push) are a **bonus delighter**, not the core mechanism.

### Platform & architecture
- **PWA** (one build for iPhone + Android; no app store; instant updates).
- **The server is the source of truth. The phone is a window, not the vault.** Nothing important lives only on the device.
- **Payments: Stripe** (gateway locked). Likely Stripe Checkout + Billing for a self-serve monthly subscription. Pricing *model* (flat per-seat vs usage-based) still open — see open questions.

### Tech stack & infrastructure — LOCKED
**Cloud: AWS. Target scale: thousands of users → keep it boring, managed, single-ecosystem. No microservices / Kubernetes / sharding / multi-region (all premature).**

- **Frontend:** React PWA (Vite), served as static files from **S3 + CloudFront**.
- **Backend:** one **TypeScript (Node) API** in a container on **AWS App Runner** (or ECS Fargate). Single service (monolith), not microservices. A persistent container holds a healthy Postgres connection pool — avoids the connection-limit problems of an all-Lambda backend.
- **Database:** **Amazon RDS for PostgreSQL** (or Aurora Serverless v2 Postgres) with the **pgvector** extension. Single shared DB; every table carries `user_id`; **Postgres Row-Level Security** on as a hard safety net for per-rep isolation. No per-tenant databases.
- **Auth:** **Amazon Cognito** (email/password + Google + MFA, AWS-native, scales easily). Caveat: clunky DX — Clerk/Auth0 are nicer if DX > pure-AWS.
- **Background jobs:** **EventBridge Scheduler → Lambda** for the daily "who's gone cold / who has a meeting soon" scan.
- **Notifications:** browser-standard **Web Push (VAPID)**, sent from the backend/Lambda. AWS has no clean first-party web-push-for-PWA service, so this one piece sits outside the AWS catalog. Keep an in-app "cold clients" list as fallback (iOS push is flaky).
- **Gallery images:** S3.
- **AI routing:** run **Haiku extraction + embeddings both through Amazon Bedrock** — one vendor, one bill, one security boundary, data stays in AWS. Bedrock supports Claude prompt caching (same 4,096-token min, incl. 1-hour TTL), so the caching strategy still applies. Transcription (Groq) and payments (Stripe) are the external pieces.
- **Language:** TypeScript end-to-end (shared types, one language for a small team). Python is an acceptable alternative if preferred.

### Data storage — LOCKED
**One PostgreSQL database, three layers. Not a standalone vector DB.**

Reasoning: most of what Tovira does is exact-fact work (dates, promise status, last-contact, who-links-to-who), which a vector DB handles badly. Vectors only fit one job: semantic search over free text. Postgres does both in one system, avoiding a second store to keep in sync. Below ~10–50M vectors a dedicated vector DB isn't justified — pgvector is the 2026 default when you're already on Postgres.

1. **The messy pile** — raw voice transcripts + pasted messages, stored as text with **pgvector** embeddings. This is the bulk of the data and absorbs all the industry-specific variation. Powers semantic search for the pre-meeting brief.
2. **Flexible notes (JSONB)** — for varied, unpredictable details that differ by rep/industry. Schema-less: holds any-shaped notes without predefining labels.
3. **A thin, universal spine of real columns** — only the few fields features must *act* on: due dates, last-contact date, promise status, stakeholder links, calendar entries. Identical shape across every industry (a promise has a "by when" and a "done?" whether you sell houses or medication).

**Critical dependency:** the spine only works if Tovira *extracts* those facts out of the messy input ("that was a promise, due Friday"). This extraction engine is the same one that powers the pre-meeting brief and the proactive alerts — if extraction is weak, the whole structured layer (and the proactive features) go dark.

### AI pipeline — LOCKED
The flow for a voice note: **audio → transcription (STT) → extraction → storage.**

- **Transcription (speech-to-text): Groq (Whisper).** Fast (~4–5x faster than routing through OpenAI) and cheap (~$0.04/hr of audio vs OpenAI's ~$0.36/hr). Note: *STT, not TTS* — TTS is the opposite (machine speaking). Known limits (no speaker separation, 25MB file cap) don't matter here — it's one rep talking into their own phone.
- **Extraction: Claude Haiku 4.5 as the default**, with the model treated as a swappable knob. Haiku ($1/$5 per M tokens) is purpose-built for extraction/summarization and is the cheap/fast default. **Benchmark Haiku vs Claude Sonnet 5** ($2/$10 intro through 2026-08-31, then $3/$15) on *real, messy* voice notes before committing. Since extraction quality is the heart of the product, escalate to Sonnet if Haiku drops promises/dates. Swapping models is a one-line change.

**Prompt caching (Haiku) — leverage aggressively, but structured correctly:**
- Structure every extraction call as **[fixed cacheable prefix] → [varying content]**. Cacheable = extraction instructions + few-shot examples (identical every call). Not cacheable = the transcript + client/rep specifics (new every call). Cache reads bill at ~10% of normal input.
- **Minimum cacheable prefix on Haiku 4.5 is 4,096 tokens** — below that, caching silently does nothing. This is a feature, not a bug: it pushes toward a rich instruction + examples block, which also improves extraction accuracy.
- **Never put anything variable in the cached prefix** (no client/rep name, no dates, no timestamps) — the cache requires a byte-identical match, so any variation = full-price miss. Variable content goes *after* the breakpoint.
- **Don't flip models mid-stream** — Haiku and Sonnet keep separate caches; switching forces a cold rebuild.
- **Caching is a volume win.** Default cache stays warm ~5 min (each reuse resets the timer). Bursts of notes = big savings; sporadic single-user traffic may see little/none. Optional 1-hour TTL (2x write cost) bridges gaps once read volume justifies it. Set the structure up now; savings switch on as usage grows.

**Embeddings (for pgvector): Amazon Bedrock (Titan Text Embeddings V2 or Cohere Embed).** Creates the vectors for the "messy pile" so semantic search works. Keeps embeddings in-AWS alongside extraction. **Standardize on one model — switching later forces a full re-embed of all stored text.** Fallback if quality disappoints: OpenAI `text-embedding-3-small` (leaves AWS).

**Extraction logging → future self-hosted model (distillation):**
- **Log every extraction from day one** into a dedicated table: input (transcript + prompt version), raw model output, model + version, token counts/cost, latency, timestamp. Training data is free to collect now and impossible to recover later.
- **Also log rep corrections** when they edit an extraction. This is the highest-value data: training only on raw Haiku output caps a future model at "slightly worse Haiku"; human-corrected examples are what could make it *better* than Haiku, not just cheaper.
- **Version the prompt per row.** The extraction prompt will evolve; mixing outputs across prompt versions poisons the training set.
- **Terms:** Anthropic permits using outputs to train non-competing specialized tools/classifiers that structure your data (which this is). The prohibited case is training a model that competes with Claude itself. Re-verify current terms before training; not legal advice.
- **Cost reality check — don't assume savings.** Haiku (esp. with caching) is very cheap. A self-hosted model adds fine-tuning + 24/7 GPU hosting + eval/retrain overhead, which typically only beats per-call Haiku at high, steady volume. Treat the migration as "validate the economics later," not a certainty. Caching is the cost win that pays off first.
- **Privacy:** this table becomes a large, permanent, growing store of real client data (transcripts + personal facts) held specifically to train on. Needs a retention + consent story designed in now, not retrofitted.

---

## 5. Locked features

All features below are **locked**. Ordered roughly by importance within each stage. The pre-meeting brief and open promises tracker are the core value — everything else supports them.

### Surface (the payoff)
- **Pre-meeting brief.** Rep opens a client, taps once, and gets a tight summary of what matters before the meeting — recent context, open items, key people, personal notes. This is the product's magic moment; the whole app leans on it.
- **Open promises tracker.** A running list of everything the rep has committed to, across all clients. Never drop a promise = never break trust.
- **Follow-up draft.** After a meeting, Tovira turns the rep's voice note into a ready-to-send WhatsApp/email in their own tone; rep reviews and sends in seconds.

### Relationship intelligence (the moat)
- **Personal-facts memory.** Spouse, kids, hobbies, dietary prefs, etc. The human details that make a relationship seller great — exactly what recording tools miss.
- **Stakeholder map.** Who reports to whom, who's the real decision-maker, who's the blocker. Critical for multi-person field deals.

### Know when (proactive)
- **Going-cold alerts.** Flags clients the rep hasn't touched in a while, before the relationship slips.
- **Personal-date reminders.** Birthdays, anniversaries, client product launches, and similar dates worth acting on.

### Capture
- **Business-card scan.** Snap a card, get a structured contact. (Makes the gallery a *smart* input, at least for cards — see open questions for the rest.)

---

## 5b. Hero features (the hook) — LOCKED

**The problem these solve:** the eight features above all *give back what the rep put in* — organized, timed, structured, but fundamentally a mirror. Useful, not *wow*. Nothing there does something the rep **couldn't do themselves**. The hero tier crosses that line: it tells the rep something they **could not have known**, because it sees *across* their whole book — the one thing no human can hold in their head.

**Strategic role:** this is what makes the memory bank *worth feeding*, makes leaving expensive (value compounds with use), and turns the 7-day-trial weakness into the pitch — seed your history on day one and Tovira immediately tells you something about yourself you didn't know.

### 1. Cross-client pattern intelligence ★ THE HERO — *volume-gated*
Finds patterns *across* the rep's entire client history that are invisible from inside any single relationship.
- *"The last 3 deals that stalled, stalled at this exact point — after the pricing objection, with no CFO in the room. Meridian is here now."*
- *"You close ~80% of deals where you meet the decision-maker before week 3. You haven't met Jordan yet."*
- *"Every client who went quiet 3+ weeks after a demo never came back. Acme just went quiet."*

Uses data already being captured — no new capture surface required. Sits on top of the extraction spine.

### 2. Deal-risk radar — *volume-gated*
A live "this deal is slipping" signal derived from the same cross-client patterns (silence, missed promises, no decision-maker contact, stall-point matches). Effectively a focused, always-on subset of #1 — punchier to demo, easier to act on.

### 3. "What should I do today?" — *always on*
One screen: the rep's few highest-leverage actions across the whole book, ranked. Drives the **daily habit** (retention). Not volume-gated — it degrades gracefully: with little data it ranks on the basics (open promises, upcoming meetings, cold clients), and gets smarter as patterns emerge.

### Volume gating — LOCKED
**Features 1 and 2 only activate once the rep's data passes a volume threshold. Feature 3 is always on.**

Rationale: with three clients, any "pattern" is noise. Firing a confident-but-wrong pattern is the fastest way to destroy trust — **a wrong pattern is worse than a missed fact**, and it's worse here than anywhere else in the product, because the rep is being told something about *themselves*.

Rules:
- Define an explicit activation threshold (e.g. minimum clients + logged interactions + closed outcomes). **Open question: the exact numbers** — tune on real beta data.
- Below threshold: show a clear, motivating "locked / warming up" state that tells the rep what unlocks it. This doubles as a **seeding incentive** — it gives them a reason to feed the bank.
- Above threshold: state patterns with **honest confidence language** and show the supporting evidence (which deals, which signals) so the rep can judge for themselves. Never assert a pattern as fact without the receipts.
- Never let a low-confidence or thin-sample pattern drive an alert.

**Build position:** Phase 4+ in the dev plan. These sit *on top of* good extraction — they cannot rescue a weak spine, and building them early on shaky extraction would produce confidently wrong insights (the worst possible outcome). Ship the core loop first.

---

## 6. Open questions (not yet decided)

**Must decide before the product is usable end-to-end (implementation blockers):**
- *(All previously-listed blockers now resolved — see Tech stack & infrastructure. Remaining item below.)*
- **Pricing model detail.** Stripe locked, 7-day trial locked. Still open: flat per-seat monthly vs usage-based.

**Can decide during build (not blockers):**
- **Hero-feature volume threshold.** The exact numbers that activate pattern intelligence + deal-risk radar (min clients / interactions / closed outcomes). Tune on real beta data — too low produces confidently-wrong patterns, too high delays the wow.
- **Day-one onboarding / seeding (trial watch-item).** 7-day trial is locked, but Tovira's value *compounds* (empty on day 1), so the trial may end before the rep hits the "aha" (an insight resurfaced before a meeting). Mitigate with aggressive day-one seeding (paste old threads/notes so it's useful immediately), or an event-based trial ("until first resurfaced insight"). Design during build.
- **The payoff moment:** exact format of the pre-meeting brief when it lands in front of the rep. (Extraction v0.1 now defines its *inputs* — see `tovira-extraction-prompt.md`.)
- **Gallery: how smart, beyond cards?** Card-scanning locked. Open: whether Tovira also *reads* other images (whiteboards, sites) or just stores them. Needs a vision/OCR step if yes.
- **Going-cold threshold:** how many days of no contact = "cold."
- **Client-selection speed:** how "pick the client" is made near-instant (recents, search, default to last-touched).
- **Natural-language confirmation UX:** showing what Tovira understood ("which Sarah? this Tuesday or next?") before it acts.

**Resolved:**
- **Extraction prompt** — drafted as v0.1 (`tovira-extraction-prompt.md`); defines the schema, rules, and the cacheable prefix. To be benchmarked (Haiku vs Sonnet) and refined.

---

## 7. Risks / things to design around

- **Data-in friction is make-or-break.** Reps hate note-taking; that's why CRMs are full of garbage. If capture isn't near-effortless, the memory bank stays empty — and an empty memory bank is a dead product.
- **Client selection must be fast.** Since voice now routes through tabs, a slow "pick client" step adds friction at the exact moment that decides whether Tovira gets fed.
- **Calendar double-entry.** Reps keep a real calendar elsewhere; Tovira's is a second one to maintain. Mitigated by pull-first design + cheap natural-language updates. (Reading the real calendar is the likely long-term answer, not now.)
- **iOS PWA limits:**
  - Notifications only work if the rep *installs* the PWA to their home screen — onboarding must force this step.
  - Web notification delivery is flakier than native; don't make push the only way value reaches the rep.
  - iOS can wipe local storage (~7 days idle) and has no background sync — so server is source of truth, and offline voice notes can't be trusted to auto-upload later.
- **Privacy / buyer security.** Pasting client WhatsApp messages and storing photos of clients/premises will draw legal & security questions from any real sales org. Not a blocker — a question to be ready for.
- **Competitive framing.** Don't claim "nobody does this." Lean into the un-recorded / field-sales angle.

---

## 8. Changelog

- **2026-07-09** — Initial spec. Locked: target user (field/relationship sellers), positioning (un-recorded world), capture methods & priority, client-tab routing (incl. voice), internal calendar with NL input, pull-first insights, PWA, server-as-source-of-truth, per-client gallery.
- **2026-07-09** — Narrowed focus to the individual salesperson; deferred team/org features (incl. relationship handoff). Locked 8 features: pre-meeting brief, open promises tracker, follow-up draft, personal-facts memory, stakeholder map, going-cold alerts, personal-date reminders, business-card scan. Updated gallery open question (card-scanning now locked).
- **2026-07-09** — Locked data storage: one PostgreSQL database — messy text as pgvector embeddings + flexible JSONB + a thin universal spine of columns. Rejected standalone vector DB. Flagged the extraction engine as the critical dependency feeding the spine and the pre-meeting brief.
- **2026-07-09** — Locked AI pipeline: Groq (Whisper) for transcription/STT; Claude Haiku 4.5 as default extractor, benchmark against Sonnet 5, model swappable. Corrected "TTS" → "STT".
- **2026-07-09** — Added Haiku prompt-caching strategy: cache the fixed instruction+examples prefix (≥4,096 tokens min on Haiku 4.5), keep all variable content after the breakpoint, don't flip models mid-stream, treat as a volume-driven win.
- **2026-07-09** — Locked extraction logging (distillation): log every input/output + rep corrections + prompt version from day one for a future self-hosted model. Confirmed Anthropic terms allow non-competing extraction models. Flagged that self-hosting may not actually be cheaper than Haiku (validate later) and that the log needs a retention/consent plan.
- **2026-07-09** — Drafted extraction prompt v0.1 (separate artifact). Locked Stripe as payment gateway (pricing model still open). Reorganized open questions into implementation-blockers (embeddings model, notifications infra, auth, tech stack, pricing model) vs decide-during-build. Core spine assessed as ready to start building.
- **2026-07-09** — Locked 7-day free trial. Flagged the compounding-value risk (trial may end before the "aha") and mitigations (day-one seeding / event-based trial).
- **2026-07-09** — Locked tech stack & infra (AWS, thousands-of-users scale): React PWA on S3+CloudFront; TypeScript container backend on App Runner/Fargate; RDS Postgres + pgvector with Row-Level Security; Cognito auth; EventBridge+Lambda scheduled jobs; Web Push notifications; embeddings + Haiku extraction via Bedrock (caching confirmed on Bedrock); S3 for images. Resolved the embeddings/notifications/auth/tech-stack blockers.
- **2026-07-09** — Produced cost-optimized AWS infra design (separate artifact `tovira-aws-infra.md`). ~$25–30/mo fixed floor, <$100/mo all-in at thousands of users. Key tactics: Graviton/ARM everywhere, single-AZ RDS early, Cognito Lite free tier, and avoiding the NAT Gateway / Multi-AZ / RDS Proxy money pits.
- **2026-07-09** — Locked the **hero feature tier** (§5b): cross-client pattern intelligence (★ the hook), deal-risk radar, and "what should I do today?". Features 1 & 2 are **volume-gated** (patterns on thin data are noise; a wrong pattern is worse than a missed fact); feature 3 is always on and degrades gracefully. Positioned as Phase 4+ — they sit on top of good extraction and can't rescue a weak spine. Exact volume threshold left as an open question to tune on beta data.
