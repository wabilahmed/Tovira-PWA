# Import cost — the real number

**Verdict up front:** a chat import is **one** Claude call, not ~100. That one call bills the
**entire transcript as uncached input**, so the "$0.005/call warm" figure (which is a 307-token
*daily note*) does not apply to it. Measured on the existing bake-off ladder: a 10,000-message
import costs **~AED 3.5 warm**, a 1,500-message import **~AED 0.66**, a 300-message import
**~AED 0.22**. Cold vs warm barely differs for large imports (+6%). **Import *count* is the wrong
unit** — imports differ ~25–195× in cost by size. At realistic usage the **AED 67 ceiling is
unreachable**, so the tier idea solves a non-problem. **Recommendation: no limit; keep one price**;
if a backstop is ever wanted, express it in *messages imported*, never import count. Per-import cost
is now instrumented (`/health → imports`) so beta answers this with data.

---

## What changed the picture (the two premise errors)

The AED 8–9 figure that motivated tiers was wrong in **two opposite directions**:

1. **Call count.** An import is not chunked into ~100 calls. `notes-routes.ts` creates **one note**
   carrying the whole transcript; the sweep runs **one** `extractNote` → **one** `model.complete`
   over the full text (`extraction-service.ts:316`, `maxTokens: 2048`). Retry only on malformed
   output (≤2 calls, rare). So the "×100" overcounted.
2. **Per-call rate.** But that single call's *variable input is the entire transcript*, billed at the
   full input rate ($3/MTok Sonnet) and **never cached** (only the fixed system prefix caches). The
   warm $0.005/call number is a 307-token daily note; it is irrelevant to a 50,000-token import.

Net: the true number sits **between** the two bad estimates — ~AED 3.5 for the largest import — and
is **transcript-driven**, not cache-driven.

## Task 1 — Query what exists (COST-QUERY): too thin, fell back to Task 2

The training log **does** persist per-call usage: `extraction_logs` (Postgres, RLS) records `model`,
`prompt_version`, `input_tokens`, `output_tokens`, `cache_creation_tokens`, `cache_read_tokens`,
`latency_ms`, `created_at`, per user/note (migrations `0009`, `0035`). But it is **not queryable for
cost**, and there is no populated dataset to mine:

- **No cost column, no aggregate/time-range query** — only `listByUser` (used merely as a row count).
  Cost must be applied externally via `callCostUsd` + `USD_TO_AED` (`model-budget.ts`).
- **Historical gap:** rows before migration `0035` have zero cache tokens — cache split (hence true
  cost) is unrecoverable for them.
- **Embeddings untracked:** the Bedrock/Titan adapter returns only a vector — no token count, and no
  embedding price constant existed.
- **Staging is near-empty**, and local/test runs write to an **in-memory** log against a **stub model
  that returns zero tokens**. There is no real import history to reconstruct from.

Per the batch's own guidance, I state this plainly and fall back to direct measurement.

## Task 2 — Measure directly (COST-MEASURE): spend-free, exact token counts

Method (`tests/staging/import-cost-measure.ts`): reuse the deterministic bake-off ladder
(51/301/1501/5001/10001 lines), build the **exact** user message each import sends, and get **exact
input tokens** from Anthropic's **free `count_tokens`** endpoint (tokens are not billed). Apply the
committed `PRICING` table — which is **validated** against `CACHE-REPORT.md` (warm $0.005 = prefix
read $0.0021 + 307 var-in + 130 out; cold $0.045 = prefix *write* $0.042 + …). **Zero generation was
billed.** Cached prefix (current v0.9.3 prompt): **9,743 tokens**.

Cost shown at output = 2,048 (the `maxTokens` cap — a **conservative upper bound**; real extraction
output is a few hundred tokens, which only lowers the small-import figures):

| export | messages | transcript tokens | warm USD | **warm AED** | cold USD | cold AED | Δ cold−warm |
|---|---|---|---|---|---|---|---|
| export-1 | 51 | 1,599 | $0.0384 | **0.141** | $0.0940 | 0.345 | **+145%** |
| export-2 | 301 | 9,091 | $0.0609 | **0.224** | $0.1165 | 0.428 | +91% |
| export-3 | 1,501 | 48,652 | $0.1796 | **0.660** | $0.2351 | 0.863 | +31% |
| export-4 | 5,001 | 162,530 | $0.5212 | **1.914** | $0.5768 | 2.118 | +11% |
| export-5 | 10,001 | 311,956 | $0.9695 | **3.561** | $1.0250 | 3.764 | **+6%** |

**Distribution (warm AED):** min **0.141** (51 msgs), median **0.660** (1,501 msgs), max **3.561**
(10,001 msgs). The small end is inflated by the max-output assumption; the deterministic **input
driver** is a near-constant **~31 tokens/message** across the whole ladder.

- **Per 1,000 messages: ~AED 0.34** (input-driven, scale-invariant: 31 tok × $3/MTok × 3.6725).
- **Per line: ~AED 0.00034** (these fixtures are one message per line).
- **Cold−warm delta collapses with size** (+145% → +6%): the prefix *write* premium (~AED 0.21) is
  fixed, so it dominates a tiny import but is a rounding error on a large one. **The 9× cold/warm
  ratio in CACHE-REPORT is a small-note artifact** — imports are transcript-dominated and largely
  cache-insensitive. *This is exactly where the 5× error came from.*
- **Embeddings: negligible.** One note embed is capped at Titan V2's 8,192-token input
  (≤ $0.00016 at $0.02/MTok) + N tiny requirement embeds → **≤ ~AED 0.001/import even at 100
  requirements.** (Titan pricing is not in the codebase; noted as a gap.)
- **Caveat (conservative):** the bake-off fixtures are multilingual filler and tokenize *dense*
  (~2 chars/token). A single-language chat may be cheaper per message, so these are an upper-ish bound.

*(Wall-clock/chunk count: one call per import; a 10k-message import is a single large-context call —
the UX fact is that a big import is one long request, not many, and the sweep drains it async so the
rep isn't blocked. Live latency not re-measured to avoid spend; the extraction call is already known
to be the long pole.)*

## Task 3 — The ceiling, modelled honestly (COST-MODEL)

Ceiling: **AED 67/rep/month** of Claude spend (a legacy figure; the current modelled AI COGS line is
~AED 18.8/user — `docs/tovira-spec.md:214`). Non-import baseline: daily-note extraction ~60/mo ×
warm $0.009 ≈ **AED 2** (`CACHE-REPORT.md`), plus briefs/recall/priorities. Call baseline **AED 3–5**;
**headroom for imports ≈ AED 62.**

**Imports-to-ceiling, by size** (warm, output-capped → conservative):

| import size | AED / import | imports to hit AED 67 |
|---|---|---|
| small (300 msgs) | 0.22 | **~280 / month** |
| medium (1,500 msgs) | 0.66 | **~94 / month** |
| large (5,000 msgs) | 1.91 | **~32 / month** |
| very large (10,000 msgs) | 3.56 | **~17 / month** |

**Worst realistic case.** The heaviest plausible rep doing *nothing but* 10k-message imports breaches
the ceiling at ~17/month. But imports are **one-time client seeding** (importing a client's chat
history), not a recurring monthly volume — steady state is cheap daily-note capture plus the
occasional new-client import. A heavy onboarding month (say 10 large imports) = **~AED 19** on imports
+ baseline ≈ **AED 22**, comfortably under 67. The ceiling is breached only by a pathological pattern
(dozens of the very largest chats, every month, indefinitely) that does not match real use.

**Is import *count* a valid unit? No.** By cost, a 51-message and a 10,000-message import differ
**~25×** (warm) to **~195×** (input-only: AED 0.018 vs 3.44). A "30 imports/month" cap could mean
**AED 0.5 or AED 100+**. Count is uncorrelated with cost; the only honest cost unit is **messages (or
lines) imported.**

**Vs the 10 / 20 / 30 tier proposal.** These bands correspond to nothing real. Even the strictest
(10/mo) sits far under the true limit for every size but a steady diet of the largest chats, while
punishing 10 small imports (AED 2) identically to 10 huge ones (AED 36). There is no evidence reps
cluster into 10/20/30 bands, and the unit itself is wrong.

## Task 4 — Recommendation (COST-RECOMMEND)

**Recommended: no limit. Keep one price. Revisit with beta data.**
- **Why:** at realistic usage the ceiling is unreachable; imports are dominated by one-time seeding;
  the AED 67 figure is itself loose (real AI COGS ~AED 18.8). Task 5 now makes per-rep import spend
  observable, so beta answers this with data instead of another estimate.
- **Build cost:** zero. **Positioning cost:** zero — preserves *"One price. Everything included. No
  tiers, no add-ons, no seats to count."* (`apps/web/index.html:251,265`).

**If a backstop is ever wanted — a single generous allowance in _messages imported_ (not count).**
- **Derivation:** AED 62 headroom ÷ ~AED 0.00034/message ≈ **~180,000 messages/month**. A round
  **~150,000 messages/month** never binds a real rep (the full history of ~15 very-large clients,
  *every month*) yet caps runaway use. Prefer a **soft warning**, never a hard block (never lose a
  capture).
- **Build cost:** modest — the Task 5 metric already records per-import tokens/cost; add a
  per-billing-period message counter + threshold + warning. **Positioning cost:** low but non-zero —
  any allowance dents "nothing to count," though messages-imported is invisible in normal use (unlike
  import count, felt immediately). Only worth it if beta shows reps actually approaching the ceiling.

**Rejected: tiers (10/20/30).** No clustering evidence, wrong unit, and they break the headline
one-price promise for *every* user to constrain a case that realistic usage never reaches.

## Task 5 — Instrumented for the future (COST-IMPORT-METRIC)

Per-import cost is now recorded at extraction time and surfaced live:

- `ImportCostMetrics` (`services/metrics/import-cost-metrics.ts`) — rolling per-rep import spend,
  same shape as `RecallMetrics`. Records `{ calls, inputTokens, outputTokens, cachedTokens,
  cacheWriteTokens, embeddingCalls, costAed }` per import, attributed to the rep.
- `ExtractionService` records it **only for `whatsapp_export` notes** (a daily note's cost is
  prefix-dominated and not the ceiling concern), summing token spend across any retry. Embedding cost
  is included via `estimateEmbedUsd` (Titan price + 8,192-token cap now live in `model-budget.ts`).
- Surfaced on **`/health → imports`** (`{ imports, totalAed, avgAed, totalUncachedInputTokens }`),
  beside `recall` and `cache` — so beta reads the real distribution instead of estimating it.

Nothing from the recommendation is implemented; this is measurement + instrumentation only.

## Provenance
- Measured: `tests/staging/import-cost-measure.ts` (run `npx tsx --env-file=.env …`), raw output in
  `tests/staging/IMPORT-COST-MEASURE.out.md`. Ladder: `tests/staging/lib/bakeoff-exports.ts` +
  `planting.ts`. Pricing: `services/metrics/model-budget.ts` (validated against `CACHE-REPORT.md`).
- Prior measured numbers reused, not re-run: `CACHE-REPORT.md` (warm $0.005 / cold $0.045 per note),
  `BAKEOFF-REPORT.md` ($0.795 total, one call per import confirmed at export-5).
