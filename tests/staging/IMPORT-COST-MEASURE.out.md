## import-cost-measure.ts output

## Measured per-import extraction cost (warm, upper-bound output=2048)

| export | messages | lines | transcript tokens | warm USD | warm AED | cold USD | cold AED | Δ cold−warm |
|---|---|---|---|---|---|---|---|---|
| export-1 | 51 | 51 | 1599 | $0.0384 | 0.141 | $0.0940 | 0.345 | 144% |
| export-2 | 301 | 301 | 9091 | $0.0609 | 0.224 | $0.1165 | 0.428 | 91% |
| export-3 | 1501 | 1501 | 48652 | $0.1796 | 0.660 | $0.2351 | 0.864 | 31% |
| export-4 | 5001 | 5001 | 162530 | $0.5212 | 1.914 | $0.5768 | 2.118 | 11% |
| export-5 | 10001 | 10001 | 311956 | $0.9695 | 3.561 | $1.0250 | 3.764 | 6% |

Prefix (cached) tokens: **9743**. Distribution (warm AED): min **0.141** (export-1), median **0.660** (export-3), max **3.561** (export-5).

Per-line (from export-5): $0.000097 (AED 0.000356). Per 1,000 messages: AED **0.356**.
Embedding cost/import: ≤ $0.00016 note embed (Titan V2, capped at 8192 tok) + N×~$0.0000006 per requirement → **negligible (≤ AED 0.0008 even at 100 requirements)**.
