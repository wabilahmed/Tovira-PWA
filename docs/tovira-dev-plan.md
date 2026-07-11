# Tovira — Development Plan (local-first)

*A complete, phased build order derived from the locked spec, extraction prompt, and AWS infra design. Sequenced by risk, and built **local-first**: prove everything on your machine, provision AWS and deploy last.*
Last updated: 2026-07-09

Companion docs: `tovira-spec.md` (decisions), `tovira-extraction-prompt.md` (the engine), `tovira-aws-infra.md` (cost-optimized infra).

---

## Build principles

1. **Local-first.** Build and validate the whole product on your machine — instant iteration, zero cloud cost. AWS provisioning and deployment come at the end, once it works.
2. **Spine first, risk first.** The one true unknown is whether extraction is good enough. The plan drives straight at it (Phase 1) and *gates* on it before building anything downstream — and now you hit that gate locally, before spending anything.
3. **Boring infra, on purpose.** Single-AZ, single container, ARM, no premature scaling. Effort goes into extraction + capture UX.
4. **An empty memory bank is a dead product.** Capture must be near-effortless; guard the speed of "open client → talk/paste."
5. **Validate before you widen.** Each phase ends with a testable outcome. Don't start the next until the gate is met.
6. **Log every extraction from day one** (for the future distillation model) — free now, unrecoverable later.

**Local stand-ins → cloud swaps (decided up front so the swap is trivial):**
- Postgres + pgvector → **Docker container locally**, → **RDS** at deploy (identical engine; RLS behaves the same).
- Auth → **local stub / Cognito Local emulator**, → **Cognito** at deploy.
- Scheduled jobs → **local cron/script**, → **EventBridge + Lambda** at deploy.
- AI (Haiku + embeddings) → call the **Anthropic API / Bedrock with local credentials** during dev, → route through **Bedrock** at deploy. Keep model calls behind one small interface so this is a config change, not a rewrite. Caching + prompt structure are identical either way.
- Groq (transcription) and Stripe (payments) → **just call the real APIs** from local dev (Groq normally; Stripe in **test mode** with the Stripe CLI forwarding webhooks to localhost).

---

## Phase 0 — Local foundations & skeleton  *(local)*

**Goal:** the full stack runs on your machine — a (mock) logged-in rep opens the PWA on localhost and it talks to a local API and local DB.

**▸ Phase principle:** *build every cloud-swappable piece behind a thin interface from the first commit, and turn RLS on now — retrofitting tenant isolation later is how leaks happen.*

- Docker Compose dev environment: **Postgres + pgvector** container, backend container, frontend dev server.
- Backend: TypeScript API skeleton running locally.
- Frontend: React PWA (Vite) on localhost; service worker + installability (localhost is a secure context, so this works locally).
- Auth: local stub or Cognito Local emulator; every table carries `user_id`; **Row-Level Security** on (identical to prod).
- Seed/test data + fixtures for fast iteration.

**Done when:** the local stack runs end to end with a fake-authenticated user.
**Effort:** M · **Depends on:** nothing.

---

## Phase 1 — The spine (capture → transcribe → extract → store)  *(local)* ★ CORE

**Goal:** a rep files a voice note (or pasted message) under a client, and correct structured data lands in local Postgres.

**▸ Phase principle:** *tune on the messiest real voice notes you can gather, not clean text — and hold the line on precision (a fabricated promise is worse than a missed one). Build a small eval set; never judge the prompt on three examples.*

- **Client tabs:** create/list clients; **fast client selection** (recents, search, default to last-touched) — protect this; capture friction lives here.
- **Capture:** in-browser voice recording + upload; paste-text input; persist raw immediately.
- **Transcription:** Groq/Whisper (real API call from local dev).
- **Extraction:** wire the v0.1 prompt (Anthropic API / Bedrock-with-creds); cacheable prefix + variable message (today's date in the variable part); confirm the prefix clears the 4,096-token cache floor.
- **Storage — three layers:** raw text + **pgvector embeddings** → messy pile; `personal_facts`/`concerns`/`summary` → JSONB; `promises`/`dates`/`people`/`meeting` → spine columns.
- **Logging table:** input + output + model/version + prompt version + (later) rep corrections.

**★ GATE — extraction quality (done locally, cheap & fast):** benchmark **Haiku vs Sonnet 5** on real, messy voice notes. Does it reliably catch promises, dates, people — without inventing them? If not, tune / escalate *before* moving on. This is the single biggest de-risking moment, and local-first lets you reach it for free.
**Effort:** L · **Depends on:** Phase 0.

---

## Phase 2 — The payoff (pre-meeting brief)  *(local)* ★ MVP-completing

**Goal:** a rep opens a client and gets a genuinely useful brief. The first "aha."

**▸ Phase principle:** *the brief must earn trust at a glance — never show an uncertain detail as if it were fact, and make it load fast enough to check in a parking lot.*

- **Pre-meeting brief:** assemble from spine data + JSONB + semantic search over the messy pile.
- **Client view / timeline** of stored memories.
- **Confirmation UX** for low-confidence / unresolved-date / meeting items.

**Done when:** a rep with a few logged interactions opens a client and sees something they'd have forgotten.
**Effort:** M · **Depends on:** Phase 1.

> **◆ MVP boundary — Phases 0–2.** The smallest lovable Tovira: capture → understand → surface. Consider pulling the **open promises tracker** (Phase 4) in here — high-value, nearly free from extraction.

---

## Phase 3 — Proactive layer (know when)  *(local, mostly)*

**Goal:** Tovira reaches out at the right moment.

**▸ Phase principle:** *assume the push never arrives — the in-app pull path is the reliable product; notifications are a bonus. Keep the cold-threshold configurable and scheduled jobs idempotent (never double-send).*

- **Internal calendar:** create meetings; natural-language entry parsed via the extraction engine.
- **Scheduled brain:** a **local cron/script** running the daily going-cold / upcoming-meeting / date-reminder scan (stands in for EventBridge + Lambda).
- **Web Push (VAPID):** build locally (localhost is a secure context). ⚠️ **Real iOS install + delivery can't be fully proven locally** — it needs a deployed HTTPS URL and a real device. Build it here; *verify it in the deploy phase* (see cloud-parity checklist).
- **Fallback:** in-app "clients going cold" list so value isn't push-only.

**Done when:** the cold-client and pre-meeting logic fire locally, with a non-push fallback in place.
**Effort:** M · **Depends on:** Phase 1; parallelizable with Phase 2.

---

## Phase 4 — Feature completion  *(local)*

**Goal:** the remaining locked features live (most fall out of the extraction engine).

**▸ Phase principle:** *reuse the engine, don't rebuild it — every feature reads the same extracted spine/JSONB. No per-feature extraction logic; keep features thin.*

- **Open promises tracker** (from `promises`) — pull earlier if possible.
- **Stakeholder map** (from `people` links).
- **Personal-facts memory** view (from JSONB).
- **Follow-up draft** generator (note → ready-to-send message in the rep's tone).
- **Business-card scan** (vision model → structured contact).
- **Gallery** (images stored locally now, → S3 at deploy).

**Done when:** all eight locked features work locally.
**Effort:** M–L · **Depends on:** Phase 1; individually parallelizable.

---

## Phase 4b — Hero features (the hook)  *(local)* ★ DIFFERENTIATOR

**Goal:** Tovira tells the rep something they **couldn't have known** — the wow that drives acquisition and retention.

**▸ Phase principle:** *a wrong pattern is worse than a missed fact — and worse here than anywhere else, because you're telling the rep something about themselves. Never assert a pattern without the receipts; never fire one on a thin sample.*

- **Cross-client pattern intelligence** ★ — patterns across the rep's whole book (stall points, what correlates with closing, what precedes going dark). **Volume-gated.**
- **Deal-risk radar** — live "this deal is slipping" signal from the same patterns. **Volume-gated.**
- **"What should I do today?"** — ranked highest-leverage actions across all clients. **Always on**; degrades gracefully (ranks on promises/meetings/cold clients when data is thin, gets smarter as patterns emerge).
- **Volume gate + locked state:** explicit activation threshold; below it, a motivating "warming up — here's what unlocks it" state that doubles as a seeding incentive.
- **Evidence UI:** every pattern shows the supporting deals/signals and honest confidence language.

**Done when:** a rep with sufficient history sees a true, evidenced pattern they'd never have spotted — and a rep with thin data sees an honest locked state, never a fabricated pattern.
**Effort:** L · **Depends on:** Phase 1 (needs trustworthy extraction) + Phase 4 data. **Do not build on a shaky spine** — confidently-wrong insights are the worst possible outcome.

---

## Phase 5 — Monetization & launch readiness  *(local, Stripe test mode)*

**Goal:** billing works and the app is safe to open to strangers.

**▸ Phase principle:** *design consent and retention before you store another byte, and treat Stripe webhooks — never the client — as the source of truth for who's paying.*

- **Stripe:** subscription + **7-day trial** in **test mode**; webhooks via the Stripe CLI to localhost.
- **Day-one seeding onboarding:** get a new rep to paste old threads / seed clients fast, so the compounding-value product feels useful before the 7-day trial ends.
- **Privacy & retention:** consent + retention policy for the memory store and the training-log table.
- **Hardening (logic-level, local):** RLS review, error handling, input validation.

**Done when:** the full paid flow works in Stripe test mode and the app is logically hardened.
**Effort:** M · **Depends on:** Phases 0–2 (min).

---

## Phase 6 — Cloud infrastructure & deployment (AWS)  *(the deploy step)*

**Goal:** stand up AWS per the infra doc, swap local stand-ins for managed services, and verify the things localhost couldn't prove.

**▸ Phase principle:** *make the first deploy boring and early — get the pipeline working on a skeleton, then validate the cloud-only behaviors (iOS push first) continuously. Least-privilege IAM and cost alarms on day one.*

- **Provision (per `tovira-aws-infra.md`):** VPC with **public subnet + tight SG, no NAT Gateway**; RDS `t4g.micro` single-AZ + pgvector; S3 + CloudFront; App Runner/Fargate (Graviton); Cognito; EventBridge + Lambda; IAM least-privilege; secrets; **billing/cost alarms**.
- **Swap the stand-ins:** local auth → Cognito; local cron → EventBridge+Lambda; AI routing → Bedrock; local Postgres → RDS; static hosting → S3+CloudFront; local images → S3.
- **CI/CD** for repeatable deploys; migrate/seed the DB.

**★ Cloud-parity checklist — verify what localhost can't:**
- **iOS PWA install + push delivery on a real device over HTTPS** (the big one — core to the proactive half).
- Cognito hosted sign-up / log-in / MFA flows.
- CloudFront + service-worker caching behavior on the real domain.
- RLS isolation under realistic access; IAM permissions actually least-privilege.
- Backups, monitoring/alerts, and cost alarms confirmed live.

**Done when:** the product runs on AWS and every cloud-only behavior is verified on real devices.
**Effort:** M · **Depends on:** whatever you're deploying (min: Phases 0–2).

---

## Phase 7 — Beta & iterate

**Goal:** validate product-market fit; feed the flywheel.

**▸ Phase principle:** *every rep correction is training data — capture it. Don't scale infra or build the custom model until activation and churn numbers justify it.*

- Closed beta with real **field reps** on the deployed app.
- Tune extraction on real **rep corrections** (gold data for the future model).
- Measure **activation** (aha within the trial?) and churn.
- Only after traction: scale-ups (Multi-AZ, Savings Plans/RIs) and the self-hosted extraction model (validate its economics vs Haiku first).

**Effort:** ongoing · **Depends on:** a deployed MVP in real hands.

---

## Common pitfalls & things to keep in mind

*Tovira-specific traps, not generic advice. Re-read before each phase.*

**The engine (AI & extraction)**
- **Never trust extraction output blindly.** Route low-confidence items, unresolved dates, and meetings through confirmation before acting — a silently-wrong fact erodes trust faster than a gap.
- **Guard the cache.** Nothing variable (today's date, client/rep name) in the cached prefix, or every call misses. Keep the prefix ≥4,096 tokens or caching silently does nothing — check the usage fields to confirm it's actually caching.
- **Version the prompt on every logged row**, and don't switch extraction models mid-stream (separate caches; mixed prompt versions poison training data).
- **LLM output isn't deterministic.** Always handle malformed JSON: retry once, then flag for review — never write partial data.

**Data & storage**
- **Don't ask vectors to do the spine's job.** "What's due Tuesday" / "who's gone cold" are date/column queries, not semantic search. Vectors are only for messy-pile similarity.
- **Standardize on one embedding model.** Mixing models makes vectors incomparable and forces a full re-embed.
- **The server is the vault; the phone is a window.** iOS can wipe local storage — never let anything important live only on the device.
- **Enforce isolation in the database (RLS), not just app code.** One missing `user_id` filter is a cross-tenant leak.

**Capture & UX (life-or-death for the product)**
- **Capture friction is the #1 killer.** Every extra tap between "I just met someone" and "it's recorded" loses data. Keep client selection near-instant.
- **Never lose a recording.** A voice note from a dead-signal parking lot must queue and retry *visibly* — don't rely on silent background sync (iOS won't do it).
- **Always show what Tovira understood.** Guessing silently (wrong Sarah, wrong Tuesday) quietly fills the memory bank with garbage.

**PWA & platform**
- **localhost lies about iOS.** Push, storage eviction, and install behavior differ on a real iPhone — verify on device (Phase 6), never assume.
- **Force the home-screen install in onboarding**, or iOS reps get zero notifications and your proactive half silently doesn't exist for them.
- **Have a service-worker update strategy**, or users get stuck on a stale cached build after you ship fixes.

**Security & privacy**
- **The extraction log is a pile of real client PII.** Protect it, set retention, and keep it out of plain logs and error traces.
- **Client WhatsApp pastes and site/face photos draw buyer legal & security questions.** Have a consent + retention story ready before selling.
- **No secrets in the repo; least-privilege IAM** once on AWS.

**Cost & scale**
- **Watch token spend per user, not just total** — one power user or a runaway loop can dominate the bill.
- **Don't pre-optimize infra or assume the self-hosted model will be cheaper.** Single-AZ, single container; validate economics later. Set billing alarms early.

**Process**
- **Don't build past the Phase 1 extraction gate on faith.** If it's shaky, that's a redesign signal, not a "keep going" one.
- **Test on real messy input, not the clean examples you wrote yourself** — those hide every failure mode that matters.

---

## Critical path

- **Serial and unskippable:** Phase 0 → 1 → 2 (all local). This is the value core.
- **The one gate that matters most:** extraction quality at the end of Phase 1 — now reached locally, for free, before any cloud spend.
- **Parallelizable after Phase 1:** Phases 3 and 4 (and Phase 2 polish).
- **Phase 6 (deploy) can run as soon as the MVP (0–2) is worth putting on real devices** — you don't have to finish 3–5 first, but the cloud-parity checklist (esp. iOS push) is the reason you deploy before calling the proactive features "done."

## What genuinely can't be tested locally (validate at Phase 6)

iOS PWA install + push on real devices · Cognito hosted flows · CloudFront/service-worker behavior on the real domain · IAM least-privilege · real backups & cost alarms. Everything else is fully local-testable.

## Explicitly deferred (not now)

Team/org features (relationship handoff), the self-hosted extraction model, Multi-AZ / Reserved Instances, smart-gallery beyond business cards, external calendar integration. Revisited only after PMF.

## Timelines

Sequenced by dependency and risk, not fixed dates — absolute durations depend on team size and velocity. Given headcount + weekly capacity, the S/M/L effort tags convert into a real calendar.
