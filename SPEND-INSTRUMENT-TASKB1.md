# Part B / Task B1 — spend instrumentation findings (report only)

## ⛔ STOP — the dominant class isn't recorded at all in production. Scope decision below.

Extraction/import spend **bypasses the metered sink in prod**, so it is in neither the durable ledger nor
the spend cap. That is a correctness gap the batch's premise didn't anticipate, and it interacts with a
cost guard that is out of scope to *change* — so I'm stopping for a scope decision before B2.

---

## 1. Every model call site (`model.complete`), model, and class

Model is chosen by task class (`config.ts` `resolveModels`): `extraction` → **Sonnet**; everything else →
**Haiku**. `spendClass` (billing) is a separate string set per call.

| # | file:line | feature | model | spendClass | metered in prod? |
|---|---|---|---|---|---|
| 1 | `extraction-service.ts:445` | extraction (daily note) / import (chat) | **Sonnet** (via router) | `'extraction'` / `'import'` (`:280`) | **NO — see §2** |
| 2 | `extraction-canary.ts:81` | canary health probe (real prod call, no userId) | Sonnet | `'extraction'` | no (no userId) |
| 3 | `recall-service.ts:210` | recall / Ask answer | Haiku | `'recall'` | yes |
| 4 | `statement-detector.ts:39` | Ask-capture statement detection | Haiku | `'capture'` | yes |
| 5 | `meeting-parser.ts:61` | NL meeting parser | Sonnet | `'meeting'` | yes |
| 6 | `priorities-service.ts:108` | daily priorities ranking | Haiku | `'priorities'` | yes |
| 7 | `follow-up-service.ts:37` | follow-up draft | Haiku | `'followup'` | yes |
| — | `eval/gate.ts:178,211`, `eval/index.ts:90`, `scripts/*` | eval gate / cache scripts | Sonnet/under-test | none | no (no sink in eval) |

**No model call exists for `brief` or `inventory`** — `BriefService` is computed from stored facts (no
`.complete`), and inventory matching is "pure vector retrieval, never a model call". The batch's premise
that *"briefs … run on Haiku"* is **incorrect** — briefs cost zero model spend today. Likewise inventory.

## 2. Where spend is recorded, at what granularity — and the gap

- **Per-class, durable, but aggregated:** `MeteredModelClient.complete` (`metered.ts:42-47`) reads
  `request.spendClass` + `userId` and calls `SpendService.record → ledger.add(user, periodKey, costClass,
  aed)`. The `spend_ledger` stores **AED + call count per (user, period, cost_class)** — so cost *by class*
  is durable and queryable (`SpendService.report` exposes `byClass`, ops-gated). It does **not** store
  tokens, cache, or anything per-call.
- **`SpendClass`** (`spend-ledger-repository.ts:8`): `extraction | import | recall | priorities | followup
  | meeting | capture` (7). The batch's list (extraction, recall, brief, priorities, draft, inventory,
  canary, gate) overlaps but differs: `brief`/`inventory` have no calls; `import`/`meeting`/`capture` are
  real classes not in the batch list; `canary`/`gate` aren't distinct today (canary records as
  `extraction`, gate records nothing).
- **`extraction_counters` (mig 0067)** is unrelated to cost — it is a monotonic COUNT of extractions per
  (user, period) backing the trial *ceiling*. It says nothing about AED or tokens.

### ⛔ The gap: extraction/import bypass metering in production
- The extraction call uses `route.model` from the **`BillingModelRouter`**, and
  `createExtractionModelRouter` (`container.ts:543-548`) builds **raw `AnthropicModelClient`s with no
  `MeteredModelClient` wrapper** (unlike `createModelClient`, which always wraps). `modelRouter` is always
  wired in prod, so extraction/import `.complete` never passes through the metered client — the `userId`
  and `spendClass:'extraction'|'import'` it deliberately sets (`extraction-service.ts:453-454`, "SPEND-CAP")
  are **silently ignored**.
- **Consequences:**
  1. Extraction/import cost — the **dominant, Sonnet cost** — is in **neither** the durable ledger **nor**
     the CACHE-1 cache-metrics registry (both live in `MeteredModelClient`). Its only capture is
     `ImportCostMetrics` — **in-memory, rolling, restart-lossy, and imports only**; daily-note extraction
     cost is recorded **nowhere durable**.
  2. **The spend cap does not count extraction.** `canSpend` reads the ledger; extraction never lands
     there, so the AED 45 / 15 cap bounds only recall/priorities/draft/meeting/capture — not the biggest
     cost. (The trial-farming analysis that "AED 45 bounds a trial" assumed extraction was metered; it
     isn't.) This is a *cost guard not working as intended*, i.e. a bug, not a value we'd change.

## 3. Token capture
`ModelUsage` (`model.ts:38-50`) carries **input, output, thinking, cache-creation, cache-read** tokens —
all separate — and the Anthropic adapter (`anthropic.ts:104-117`) populates them from the response. So
every token field B2 wants is available **at the chokepoint**. But nothing durable stores them per call:
the ledger keeps only summed AED-by-class. (Recall is the one exception — see §5.)

## 4. Cache: distinguishable, but not for extraction, and concurrency may cool it
- A cold vs cached call is distinguishable: `cacheReadInputTokens > 0` = hit. `MeteredModelClient` records
  `{cacheable, hit}` per task class to the in-memory `modelMetrics` registry (CACHE-1, → /health).
- **Extraction cache outcomes are NOT recorded** — same bypass (§2): extraction skips the metered wrapper.
- **Concurrency likely lowers cache warmth on a cold burst.** The Sonnet extraction prefix is byte-identical
  and cached (5m/1h TTL). Serially, call 1 writes the prefix cache and calls 2..N read it. Under
  `SWEEP_CONCURRENCY=5`, up to 5 extractions can start before any has written the cache → a thundering herd
  that all cache-MISS the prefix (5 writes instead of 1 write + 4 reads), raising cost at the start of a
  drain. So the "caching is a daily-note economy, not an import economy" measurement **may no longer hold**
  during a concurrent import burst — but it is currently **unmeasurable** because extraction bypasses the
  cache metrics. Confirming this is a direct motivation for B2 recording extraction cache per call.

## 5. Ask (recall) context + turn growth
`recall-service.ts` `ask()`: **topK 5**, `minSimilarity 0.2`, retrieval capped at **maxRetrievalTokens
1200** (`capByTokenBudget`), answer `maxTokens 512`. Prior turns: the last **`historyWindow = 20`** messages
(rep + Tovira) are prepended **verbatim** (`RecallSessionRepository.recentMessages`), session resets after
**30 min** idle. **No summarisation** — a `HISTORY_DIRECTIVE` tells the model to use history for
interpretation only. So context grows with turn count and turn 18 re-sends ~18 messages that turn 2 didn't
— exactly the growth the batch flags. **Per-turn cost IS recorded** by `RecallMetrics.recordTurn`
(turnIndex, retrievalTokens, **historyTokens**, input/output/cached tokens, costAed) — but it is
**in-memory, rolling 1h, not durable**, so "what did a 20-turn conversation cost" is not answerable after
a month.

---

## The scope decision (why I stopped)
The recording architecture itself **extends cleanly** — the metered chokepoint already sees userId, class,
model, and full token/cache usage, so a durable per-call event log (B2) drops in there, alongside the
ledger. **But** B2's goal — "what did each feature cost" — is defeated unless the **extraction-metering
bypass (§2) is fixed first**, because extraction is the dominant cost and currently records nothing. Fixing
it means wrapping the router's clients in `MeteredModelClient` (a small container change) — an *extension*,
not a restructure — **but it has a side effect on a cost guard: the spend cap would start counting
extraction** (doing what it was always meant to). "Changing any cost guard" is out of scope, and although
this is a bug fix rather than a value change, it changes effective behaviour, so it's your call:

- **(A) Recommended:** B2 fixes the bypass (meter the router clients) so extraction cost + cache + per-call
  tokens are recorded, and accept that the spend cap will thereafter include extraction (the intended
  behaviour). I flag it explicitly so it's a decision, not a silent change.
- **(B)** B2 instruments only the already-metered classes and leaves extraction unrecorded — which misses
  the dominant cost and the whole point of the batch.

**I have not proceeded to B2.** Which scope — A or B? (And with A: is the spend-cap-now-counts-extraction
side effect acceptable, or should extraction be recorded to the new per-call log + a shadow ledger but
excluded from `canSpend` until you decide separately?)
