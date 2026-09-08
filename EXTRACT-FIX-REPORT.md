# Extraction fix, gate coverage, and corrected costs

Fixes the live production breakage found by the blind test (`EXTRACTION-TEST-RESULTS.md`), makes the
failure loud, and re-measures cost on a *working* extraction — where every prior figure was measured
on calls that produced only thinking tokens and no output.

## How long it was broken, and for what

`claude-sonnet-5` emits reasoning by default, and `max_tokens` bounds **thinking + text together**.
At the shipped `maxTokens: 2048`, any input that provoked ≥2,048 reasoning tokens hit the cap during
thinking and returned **no text block** → empty output → `needs_review`, silently. Measured
threshold: a **10-message** chat already reasons ~3,280 tokens, so **anything roughly ≥10 messages
was broken**; single short daily notes (~415 thinking) survived. It broke whenever the model started
defaulting to reasoning under `claude-sonnet-5` — a provider-side change that post-dates the last
successful bake-off/certification (which scored real text at 2,048), so nothing in the codebase
changed to cause it and nothing re-validated the live model afterwards. **This is a distinct failure
shape from the six wiring findings: nothing was unwired — the test data (tiny single notes) never
resembled reality (multi-message imports).** The wiring guard would not have caught it.

## A1 — the thinking-budget curve (measured, real Sonnet)

Instrumented calls at a high `max_tokens` (no truncation), thinking counted separately:

| messages | input tokens | thinking tokens | text tokens | stop_reason |
|---|---|---|---|---|
| 1 | 9,832 | 415 | 183 | end_turn |
| 10 | 10,233 | 3,280 | 476 | end_turn |
| 68 | 12,077 | 5,014 | 1,012 | end_turn |
| 401 | 21,152 | 7,036 | 974 | end_turn |
| 1,500 | 52,780 | 6,531 | 754 | end_turn |
| 5,615 | 170,045 | **12,303** | 1,655 | end_turn |

Shape: thinking rises steeply to ~5–7k by a few hundred messages, is roughly flat 400→1,500, then
rises again to ~12.3k at the largest real import (near Sonnet's ~200k-token context limit). So one
fixed ceiling works, derived from the **worst case**, not a per-input scaling budget.

## A2 — the fix

- **`EXTRACTION_MAX_TOKENS = 20,000`**, derived from the worst-case total output (13,958 = 12,303
  thinking + 1,655 text) + ~43% headroom, and **proven to complete** (the 5,615-message measurement
  ran at exactly 20,000 with `stop_reason: end_turn`). The derivation is recorded beside the constant
  so it isn't "optimised" back into breakage. Billing is on **actual** output, so the generous
  ceiling costs nothing in the normal case.
- **Shared by extraction AND the gate** (one constant) so their calls stay byte-identical.
- **Cached prefix unaffected** — `max_tokens` is a request parameter, not prompt content; the
  prefix-identity guard still passes.
- **Other task classes checked:** only `extraction` and the **meeting parser** run on Sonnet (a
  reasoning model). Every other class defaults to Haiku, which was **probed and emits no thinking**
  (`thinking_tokens: none`), so recall/priorities/drafts/detector are unaffected. The meeting parser
  ran on Sonnet at `maxTokens: 256` — latently truncating the same way — and was **raised to 4,096**.

## A3 — the failure is now loud

A no-text response (`stop_reason: max_tokens`, or a thinking-only block) is a **distinct named
failure**, not generic malformed JSON:
- Logged loudly: `[extract] OUTPUT_STARVED note=… inputTokens=… outputTokens=…`.
- Counted in a new `ExtractionHealthRegistry`, surfaced on **`/health → extraction.starvedOutputs`**.
- **Not** retried as invalid JSON (a retry starves identically and burns the budget again); genuine
  malformed JSON still follows the ordinary retry path. Both paths are tested.

## PART B — gate coverage (drafted; **stopped for certification**)

The gate's model call is byte-identical to production; the gap was purely the **input** — every
fixture is a tiny single note. Plan:

- **B1 — import-sized fixtures.** Use the three blind-test exports as the basis (small ~68, medium
  ~401, large ~5,615 messages; the large one spans 2019→2024, exercising multi-year reference dates).
  **An answer key exists and is held by Wabil** — per draft-then-certify governance the expected
  outputs must be certified, not self-approved, so this is **stopped here for certification** rather
  than fabricating a key.
- **Cost split proposed:** the large fixture is expensive (~AED 2.5 warm/run × 3 runs × 2 subsets),
  so run the **full import-sized set on certification only**; run a **size-representative subset**
  (the ~68-message import) on every CI gate. Approx per-gate CI adder ≈ one ~AED 0.37 import; full
  certification adder ≈ the three imports × runs (~AED 20–25 for the large one across a 3-run cert).
- **B2 — re-certify** (3-run, warm, N≥960, both subsets, incl. the import-sized fixtures) is
  **blocked on B1 certification** and is a real spend; it will report every metric beside its prior
  value and, if fabrication/precision degrade on multi-message inputs, report and stop (not tune).

## PART C — corrected cost model (working extraction, warm)

Computed from the A1 measurements with the real prefix economics (Sonnet: input $3, output $15, cache
read $0.3 per MTok; prefix ~9,743 tokens; USD→AED 3.6725). **Thinking is billed as output and is the
dominant output line** — it must be read as its own row:

| import size | var input | thinking | text | **warm AED** | of which thinking |
|---|---|---|---|---|---|
| 1 msg | ~89 | 415 | 183 | 0.045 | 0.023 |
| 68 msg | ~2,334 | 5,014 | 1,012 | **0.37** | 0.28 (~75%) |
| 401 msg | ~11,409 | 7,036 | 974 | **0.58** | 0.39 |
| 1,500 msg | ~43,037 | 6,531 | 754 | **0.89** | 0.36 |
| 5,615 msg | ~160,302 | 12,303 | 1,655 | **2.55** | 0.68 |

- **Cost per 1,000 messages** (large-import scale, warm): ~**AED 0.45** — input ~AED 0.31/1,000
  (28.5 tok/msg) plus an amortised reasoning overhead. For small imports the per-1,000 figure is
  higher because reasoning is a near-fixed ~5–12k-token overhead per call regardless of size.
- **Warm vs cold:** the cached prefix (~9,743 tokens) is now a *small* share of the bill — the
  transcript input and the reasoning output dominate — so caching saves ~AED 0.10/import (prefix
  write $6 vs read $0.3 per MTok), not the headline it was for tiny daily notes.

### Every prior figure, corrected

- **~AED 2/import estimate** (IMPORT-COST-REPORT): was measured on empty output. A *working* large
  import is **~AED 2.5 warm** (one call); most imports are smaller (~AED 0.4–0.9). Coincidentally
  close for a large import because input dominates, but it was measuring nothing and missed thinking.
- **Daily-note extraction** (~AED 0.005–0.009 in CACHE-REPORT, pre-reasoning): now **~AED 0.04–0.37**
  depending on length, because every note now carries reasoning tokens. ~5–40× the old figure.
- **AED 45 spend cap:** still comfortable. A working large import ≈ AED 2.5, so ~17 large imports fit
  the cap; imports are one-time client seeding, and steady-state daily use (~60 notes ≈ AED 3–20/mo
  depending on length + recall) sits well under it. **The cap is not too tight — it stands.**
- **AED 67 margin ceiling:** unaffected — the cap sits inside it with room.
- **~AED 23/user AI model:** the building blocks have moved (extraction per note up several ×,
  thinking now a line item); the precise recompute needs the product's usage mix (notes/mo, imports/mo)
  and should be redone against that. Directionally: steady-state per-user AI is still modest (a few
  AED/mo) with a one-time seeding bump per imported client; thinking makes each unit cost more than
  the pre-reasoning model assumed.

### C2 — instrumentation corrected

`thinkingTokens` now flows through `ImportCostRecord` and is surfaced on `/health → imports.totalThinkingTokens`,
so the dominant cost line is tracked and priced separately from here on, not folded into a total.

## Definition-of-done status
Done: A1 (measured, derivation recorded), A2 (fix + other classes checked), A3 (loud + observable),
C1/C2 (costs re-measured with thinking split; instrumentation updated), corrected model above. **Stopped
for certification:** B1 import-sized fixtures (answer key held by Wabil) and therefore B2 re-cert —
these need the human certification step before the gate run, per governance.
