# Tovira — Project Status & Handover

**As of this build.** Everything a coding agent can implement — backend, frontend,
and cloud infrastructure-as-code — is **built, tested, committed, and pushed to
`main`**. What remains is exclusively deploy / device / real-user work that
requires you.

- **Unit + component tests:** 729 passing (131 test files) · **Integration:** 10
  (real Postgres, migrations 0001–0025) · **E2E:** 3 (Playwright PWA shell)
- **Typecheck + lint:** clean · **Commits:** 68 on `main`
- **DB migrations:** 25 · **Backend services:** 25 dirs · **Frontend feature
  modules:** 21 dirs
- **Model routing:** hybrid per-task-class — extraction on Sonnet 5 (P1-9 gate
  lock), all other AI classes default to Haiku 4.5, each config-overridable via
  `MODEL_<CLASS>` (no code change).

---

## 1. What Tovira is

An **AI memory bank for field salespeople**. It captures voice notes, pasted
messages, and WhatsApp chat exports about clients; extracts structured facts
(promises, people, dates, concerns, meetings, unanswered questions); and surfaces
them before the next meeting. Home-market edge: **multilingual (code-switched
Arabic/Hindi/Urdu ↔ English)** extraction.

**Locked product principles (enforced in code + tests):**
- A wrong fact is worse than a missing one — never fabricate a promise, guess a
  date, or merge two people. When unsure → flag, don't guess.
- The server is the source of truth; the phone is a window. Nothing important
  lives only on the device.
- Tenant isolation is enforced at the DB (Postgres Row-Level Security), not just
  in app code.
- Capture friction kills the product — protect the speed of the capture path.
- Prompt caching: the cacheable prefix is byte-identical every call; today's date
  and client names live in the variable part only.

---

## 2. Architecture (locked stack)

TypeScript end-to-end · **React PWA (Vite)** · **Node API** (no framework, plain
`http`) · **PostgreSQL + pgvector** · **Docker Compose** locally · **Vitest +
Playwright** · Claude via a model interface (Anthropic API locally → Bedrock in
prod) · Groq for STT · Stripe **test mode only**.

**Ports & adapters (hexagonal):** every external dependency sits behind a port
with a local stub + a real adapter, selected by config at a composition root
(`apps/api/src/container.ts`). Business logic in `services/` never imports a
vendor SDK — enforced by an architecture test.

**Tenant isolation:** the API connects at runtime as a non-superuser role
(`tovira_app`); every tenant table has `user_id` + `ENABLE/FORCE ROW LEVEL
SECURITY` + a policy comparing `user_id = current_setting('app.user_id')`.
`withTenant(pool, userId, fn)` sets the tx-local GUC. Billing/anti-abuse tables
(subscriptions, trial_grants, referrals) are intentionally non-RLS.

**Repo map:**
```
apps/api/            Node API
  src/ports/         interfaces (the seams)
  src/adapters/      in-memory + pg/real implementations per port
  src/services/      business logic (extraction, recall, ledger, billing, …)
  src/http/          route handlers + test-deps (in-memory dep builder)
  src/container.ts   composition root (real vs stub by config)
  src/index.ts       server bootstrap (migrate on boot, wire everything)
  migrations/        0001–0023 (.sql, run in order on boot)
apps/web/            React PWA (see FRONTEND-PAGES.md for every screen)
infra/terraform/     AWS infra-as-code (authored, NOT applied)
docs/                spec, user stories, acceptance tests, prompt, infra design
docker-compose.yml               local stack (stub AI)
docker-compose.real-ai.yml       opt-in override → real Claude/Groq/Stripe
FRONTEND-PAGES.md    per-page frontend documentation
```

---

## 3. What's built — by phase

Legend: ✅ done & tested · ⚠️ partial/deferred · 🔒 needs you (deploy/device/beta)

### Phase 0 — Foundations
| Story | Status | Notes |
|---|---|---|
| P0-1 one-command local env | ✅ | `docker compose up`; migrations run on boot |
| P0-2 swap-ready interfaces | ✅ | ports & adapters + architecture test |
| P0-3 sign up / log in | ✅ | sessions, cookie auth |
| P0-4 tenant isolation | ✅ | Postgres RLS + integration test |
| P0-5 installable PWA | ✅ | manifest, service worker, offline shell |
| P0-6 seed data | ✅ | `npm run seed` (demo@tovira.local) |

### Phase 1 — Capture → extract → store
| Story | Status | Notes |
|---|---|---|
| P1-1..P1-4 client, selection, voice, paste | ✅ | offline outbox for voice |
| P1-4b WhatsApp chat import | ✅ | parser, consent, batch extract |
| P1-5 transcription | ✅ | Groq/Whisper adapter + stub |
| P1-6 structured extraction | ✅ | v0.1 schema + unanswered-question detection |
| P1-7 flag uncertainty | ✅ | confirmation queue |
| P1-8 log every extraction | ✅ | training log w/ prompt version |
| **P1-9 ★ quality gate** | ✅ | **run against real Sonnet 5 (passes, 0 guessed dates)**; eval set includes code-switched Arabic/Hindi/Urdu notes |

### Phase 2 — Pre-meeting brief
| P2-1 brief · P2-2 timeline · P2-3 confirm & correct · P2-4 no guesses as facts | ✅ |

### Phase 3 — Proactive
| Story | Status |
|---|---|
| P3-1 meetings · P3-2 nudges · P3-3 going-cold · P3-4 date reminders · P3-5 in-app cold list · P3-6 enable notifications | ✅ |
| P3-7 chat refresh nudges (dedup on re-import + staleness nudge) | ✅ |
| P3-8 Monday Morning Scan (weekly digest) | ✅ |

### Phase 4 — Feature completion + hero + new loop
| Story | Status |
|---|---|
| P4-1 promises tracker · P4-2 stakeholder map · P4-3 personal facts · P4-4 follow-up draft · P4-5 card scan · P4-6 gallery | ✅ |
| P4-7 WhatsApp send loop (`wa.me`, never auto-sends) | ✅ |
| P4-8 conversational recall (RAG w/ receipts, "I don't have that") | ✅ |
| P4-9 personalized extraction (per-rep glossary from corrections) | ✅ |
| P4-10 corpus-value visibility ("X months, Y moments") | ✅ |
| P4-11 Recovered Value Ledger ("touched" not "closed") | ✅ |
| P4b-1..4 pattern intelligence, risk radar, today, volume gate | ✅ |

### Phase 5 — Monetization & launch
| Story | Status |
|---|---|
| P5-1 free trial + **extraction ceiling** + **activity-gated +7 extension** (+ server-computed extension-incentive UI, non-scary ceiling state) | ✅ |
| P5-2 subscribe & manage (Stripe, webhooks = source of truth) | ✅ |
| P5-3 day-one seeding via WhatsApp export | ✅ |
| P5-3b ★ Day-One Book Scan (trial wow) | ✅ |
| P5-4 data trust & control (full export incl. images, delete) | ✅ |
| P5-5 annual plan (AED 2,990/yr) | ✅ |
| P5-6 share card (counts only) + referral (give/get a month) | ✅ |
| P5-7 trial-grade extraction (trial → Sonnet) | ✅ |

### Phase 6 — Cloud (AWS)
| Story | Status |
|---|---|
| P6-1 deploy on AWS | ⚠️🔒 Terraform authored + `terraform validate`-clean; **not applied** |
| P6-2 swap stand-ins via config | ✅ real adapters (Bedrock/web-push/Stripe SDK) built + tested |
| P6-3 iOS push on a real device | 🔒 needs a device |
| P6-4 ops safety net (alarms/backups) | ⚠️🔒 authored in Terraform; **live-verify needs apply** |
| P6-5 isolation verified in prod | 🔒 needs deployed Cognito |

### Phase 7 — Beta & iterate
| P7-1 real-workflow beta | 🔒 needs real reps |
| P7-2 capture corrections (training data + prompt version) | ✅ |
| P7-3 instrument activation & churn | ✅ |

**Cost-guard architecture rules (tested requirements):** ① pattern runs read
compact per-client structured signals, never the raw book — ✅ already so; ②
conversational recall capped top-k — ✅; ③ daily priorities precomputed nightly —
✅ (nightly `priorities-nightly` job → `daily_priorities` cache; `/today` serves
the stored result with zero model calls on read; manual refresh rate-limited
2/rep/day); ④ bounded trial seeding — ✅ (extraction ceiling).

---

## 4. What YOU need to do (the pending work)

None of this is codeable from here — it needs cloud accounts, a physical device,
real keys, or real users. In recommended order:

### A. Run the P1-9 gate with a real key (5 min, optional re-check)
Already run and passing on Sonnet 5, but to re-verify (esp. the multilingual
notes):
```bash
# .env already has your Anthropic key
set -a; . ./.env; set +a
ANTHROPIC_MODEL=claude-sonnet-5 npm run gate
```

### B. Provision AWS (P6-1) — ~30–60 min, one `terraform apply`
The stack is written to the locked cost design (~$25–30/mo fixed: **no NAT
Gateway**, single-AZ Graviton RDS, ARM Fargate, Cognito TOTP, CloudFront). Two
`check` blocks fail the plan if anyone re-adds a NAT Gateway or flips RDS to
Multi-AZ.
```bash
cd infra/terraform
terraform init
terraform plan  -var alarm_email=you@example.com          # review carefully
terraform apply -var alarm_email=you@example.com
```
Then (see `infra/terraform/README.md` for the full checklist):
1. **Fill the runtime-config secret** (output `runtime_config_secret_arn`) with
   the real `GROQ_API_KEY`, `STRIPE_SECRET_KEY` (**`sk_test_…` until go-live**),
   `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID`, `STRIPE_ANNUAL_PRICE_ID`, and a
   VAPID keypair (`npx web-push generate-vapid-keys`).
2. **Create the `tovira_app` DB role** (the non-superuser RLS role) — migration
   `0003` does this locally; in prod run it once as superuser (or let the boot
   migration create it).
3. **Build + push** the API image to the ECR repo output; set `-var api_image=…`;
   re-apply (or let CI update the service).
4. **Build + sync** the PWA: `npm run build -w apps/web` → `aws s3 sync
   apps/web/dist s3://<frontend_bucket>` → invalidate CloudFront.
5. **Set `VITE_VAPID_PUBLIC_KEY`** at the web build so the Enable-notifications
   flow can subscribe (otherwise it reports "unsupported").

### C. Verify on real infra
- **P6-3 iOS push:** home-screen-install the PWA over the CloudFront HTTPS URL on
  an iPhone → Enable notifications → confirm a test push arrives. (The subscribe
  flow is built + unit-tested; on-device delivery can only be verified here.)
- **P6-4 ops:** confirm the CloudWatch **billing + ALB-5xx alarms** fire to your
  SNS email; do one RDS **restore drill**.
- **P6-5 prod isolation:** create two Cognito accounts, confirm neither can see
  the other's data (RLS already enforces this; verify under real Cognito auth).

### D. Create the real Stripe SKUs (before go-live)
In Stripe (test → then live): a **monthly AED 299** price and an **annual AED
2,990** price; put their price IDs in the runtime secret. Configure the webhook
endpoint → your `/billing/webhook`. Keep **test mode** until launch.

### E. Beta (P7-1)
Put it in front of real field reps in their daily workflow; watch the activation
(first useful brief within trial) and churn metrics that P7-3 already instruments.

---

## 5. Local testing (quick pointer)

Full runbook is in the chat / your notes; the essentials:
```bash
docker compose up -d --wait
docker compose exec api npm run seed -w apps/api
# PWA http://localhost:5173  ·  API http://localhost:3001
# Log in: demo@tovira.local / demo-password-123
```
Real AI locally (uses your `.env` keys, small spend):
```bash
docker compose -f docker-compose.yml -f docker-compose.real-ai.yml up -d --wait
```
Test suites: `npm test` · `npm run test:integration` · `npm run test:e2e` ·
`npm run typecheck` · `npm run lint`.

---

## 6. Deferred / optional (built to work, could be optimized)

- **Book Scan / patterns precompute** — same theme as the priorities nightly
  precompute (now shipped, cost-guard ③): move the Book Scan / cross-client
  pattern computation onto a scheduled precompute + cache for prod cost control.
  A perf optimization, not a feature gap.

*Shipped since the previous status: cost-guard ③ nightly-precomputed priorities
(CG3), client phone for the WhatsApp send loop (P4-7 — stored per client, targets
the `wa.me` deep link, picker fallback when no country code), the trial-extension
incentive UI (P5-1-UI), and the non-scary seeding-ceiling state (P5-1-CEILING-UI).*

---

## 7. Known caveats / graceful degradations (local & pre-deploy)

- **Hero "Today"** stays "warming up" until the volume gate (≈5 clients + 20
  notes) — seed more to unlock patterns/risk.
- **Push notifications** show install-first guidance and report "unsupported"
  until `VITE_VAPID_PUBLIC_KEY` is set and the PWA is installed over HTTPS on a
  device.
- **Stripe** annual/referral use test placeholder price IDs until you create the
  real SKUs.
- **Multilingual + real extraction quality** are only exercised with a real key
  (`docker-compose.real-ai.yml` or `npm run gate`); stub mode returns canned
  extractions.
- **Docker Desktop** was intermittently flaky this build — if `docker compose up`
  hangs/500s, `pkill -f com.docker` → `open -a Docker`, wait for `docker images`
  to respond, retry.

---

## 8. Guardrails that stay true (do not cross)

- Stripe stays **test mode** until go-live; never commit secrets (`.env` is
  gitignored; secrets live in AWS Secrets Manager in prod).
- No WhatsApp Business API anywhere — the chat **export** (.txt) is user-driven,
  no Meta integration.
- The extraction model default is **Sonnet 5** (the P1-9 gate rejected Haiku for
  guessing dates). Any cheaper model must pass the gate (0 guessed dates, 0
  fabricated promises) before switching.
- Deleting a rep's account cascades all data (incl. the training log); a delete
  must never let data reappear in briefs, search, or training.

---

## 9. Bottom line

**Build complete.** Backend + frontend are feature-for-feature with the (updated)
docs; 651 unit / 10 integration / 3 e2e green; validated cloud infra is one
`terraform apply` away. The only remaining work is **deploy → verify on device →
run a beta**, all of which is yours because it needs the physical/cloud world.
