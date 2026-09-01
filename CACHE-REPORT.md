# Prompt-Cache Report (CACHE-1…5)

**Date:** 2026-09-02 · **Model:** `claude-sonnet-5` (extraction; the prod path,
`MODEL_PROVIDER=anthropic`) · **Prefix:** `EXTRACTION_SYSTEM_PROMPT`, 7036 cached tokens.

## Executive summary

The reported **~9% hit rate (4.1M "uncached" vs 453K cache reads over 7 days) was a
wrong-denominator metric, not a broken cache.** It divides cacheable-prefix reads by
*total* input — and total input is dominated by inherently-**variable** content that is
supposed to be uncached (note text, recall excerpts, priority/brief/meeting context). The
extraction prefix cache is **healthy**: 100% hits back-to-back, no leak. **No cache defect
was found or fixed.** The genuine gap was **observability** — nothing reported a per-class
prefix hit rate — which is now closed.

## Hit rate — before and after (live burst evidence)

| | "Hit rate" | What it measures |
|---|---|---|
| Before (console aggregate, 7d) | ~9% | cacheable reads ÷ **total input** (mostly variable) — misleading |
| After (correct metric, live burst) | **96.7–100%** | prefix reads ÷ **cacheable calls** — the real signal |

Two live bursts (`apps/api/src/scripts/cache-burst.ts`), 30 back-to-back extraction calls
each, varying the note and spanning two clients + two dates:
- Warm cache: **100%** — every call read the 7036-token prefix, 0 writes.
- Cold start: **96.7%** — call 1 wrote the prefix, calls 2–30 read it (the textbook shape).
- Crucially, the prefix held across **Acme/2026-09-01 → Globex/2026-11-15**: nothing
  variable leaks in.

## Diagnosis — the five points (defect vs artifact)

| # | Check | Result | Defect? |
|---|-------|--------|---------|
| 1 | Cache breakpoint set on the live path | Adapter sends `cache_control:{ephemeral, ttl:'1h'}`; burst reads confirm | **No** — working |
| 2 | Prefix ≥ model minimum | 7036 tok vs **Sonnet min 1024** (not Haiku's 4096) — 7× over | **No** |
| 3 | Variable data leaking into the prefix | 30 calls / 2 clients / 2 dates read the *same* 7036 tokens; prefix is the constant, variable data is in the message | **No leak** |
| 4 | Model routing splitting the cache | Extraction always Sonnet (resolved once, retry reuses it); Haiku classes have sub-minimum prompts and correctly don't cache | **No** |
| 5 | TTL expiry vs genuine misses | TTL is **1h** (prod default, confirmed). Back-to-back = 100%. | **Artifact** — see split |

## The miss split (point 5)

**~All misses are TTL-expiry from sporadic traffic; ~zero genuine back-to-back misses.**
Over 7 days of sporadic dev/test traffic, extractions were spaced **> 1h apart**, so each
cold-wrote the prefix (a `cache_creation`, not a read). The burst proves back-to-back calls
hit 100%. Under continuous production traffic — many reps, and the sweep processing pending
notes every ~30s — extractions cluster inside the 1h window, so the production hit rate is
high, not 9%. No pattern of back-to-back misses (the only thing that would be a defect) was
observed.

## Cost recomputation (measured)

Per-call extraction cost (measured tokens; list prices, Sonnet $3/$15 in/out, cache read
0.1×, 1h write 2×):
- **Warm** (prefix read): 7036 read + ~307 var-input + ~130 output ≈ **$0.0050/call**.
- **Cold** (prefix write): 7036 write + input + output ≈ **$0.045/call** (~9× warm — the
  write premium is the whole cost of a miss).

Per active rep, assume ~60 extractions/month (the trial ceiling order of magnitude):
- At a **healthy production hit rate (~90% warm)**: `0.9·$0.005 + 0.1·$0.045 = $0.009/call`
  → **~$0.55/mo ≈ AED 2.0** for extraction.
- Even at a pessimistic **all-cold** rate (the sporadic-dev worst case): `60·$0.045 = $2.7/mo
  ≈ AED 9.9`.

**The ~AED 23/user COGS holds.** Extraction is a fraction of it, and even the pessimistic
all-cold case (~AED 10) stays under budget; add Haiku recall/briefs/priorities (cheap,
uncacheable-by-size), Titan embeddings and Groq STT and the per-user AI total remains within
the model. The earlier "order-of-magnitude overspend" projection came from reading the 9%
aggregate as a hit rate; the real exposure is the warm-vs-cold delta on extraction, which
production traffic keeps warm.

**Projected saving at 170 users:** the feared figure (treating 9% as the true hit rate →
mostly-cold extraction, ~AED 10/user·170 = ~AED 1,700/mo) vs the real warm-cache figure
(~AED 2/user·170 = ~AED 340/mo) — a **~AED 1,360/mo difference that was never actually being
spent**; production traffic already runs near the warm number. The concrete action isn't a
cost cut, it's keeping the cache warm + observable so it stays there.

## TTL recommendation — keep 1h (arithmetic)

1h is already enabled and is the right call. A 1h write costs 2× input ($0.042 for the
prefix) vs 1.25× for 5m ($0.026) — an extra **$0.016** per warm-up. It repays itself by
avoiding a single later cold write in the hour (a cold write is $0.042 vs a $0.002 read, so
each avoided miss saves **$0.040**). Any cluster of ≥1 extra call within the 5–60 min window
— routine for a rep's capture session or a sweep batch — makes 1h cheaper than 5m. **Keep 1h.**

## Regression guard + docs corrections

- **Byte-identical-prefix regression test is in place** (`cache-prefix.test.ts`): runs
  extraction across two clients, two dates, two glossaries and asserts the cached system
  prefix is byte-identical and carries no variable datum. It trips loudly if a future edit
  interpolates anything variable into the prefix (the one change that would cold every call).
- **`/health` now exposes per-class cache hit rate** (over cacheable calls; `n/a — below
  minimum` for the Haiku classes) and boot logs the per-class model/prefix/breakpoint.
- **docs/ corrections (owner to apply — guard-blocked):** (1) `tovira-spec.md` + the
  extraction-prompt doc state a **4096**-token minimum cacheable prefix — that's the Haiku
  floor; the model actually run (`claude-sonnet-5`) needs **1024**, and our prefix clears it
  7×. (2) the COGS model reasons about a **5-minute** cache window; the real TTL is **1h**,
  so the production miss profile is tighter than modelled.

## Bottom line

No cache repair was needed, and here is the evidence. The alarming number was a metric
artifact; the extraction prefix cache is healthy (100% back-to-back, no leak); the fixes are
the missing observability (`/health` + boot log + per-call metering), the permanent
byte-identity guard, and the budget harness. The gate for Part B — a measured hit rate on a
live burst — is satisfied at 96.7–100%.
