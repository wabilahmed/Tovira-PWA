# B1 — import-sized gate fixtures (DRAFT — stopped for certification)

**Status: DRAFTED, NOT self-approved. Two human decisions are needed before this can run.**

The extraction gate is 47 fixtures of tiny single notes. That is the exact blind spot that let the
`max_tokens` starvation ship: **the test data never resembled a real multi-message import.** This adds
the missing regime. Scaffold: `tests/staging/import-gate-fixtures.draft.ts` (kept in staging, so the
live gate's N is unchanged and green until certification).

## The three fixtures (built from the blind-test exports)

| id | export | client | messages | input tok | tier | notes |
|---|---|---|---|---|---|---|
| `import-easy-omar` | Omar_Al_Mansouri.zip | Omar Al Mansouri | ~68 | 12,077 | **CI subset** | representative small import |
| `import-medium-farah` | Farah_Insurance.zip | Farah Haddad | ~401 | 21,152 | cert-only | mid-size |
| `import-hard-imtinan` | Bubu_DXB.zip | Imtinan Qureshi | ~5,615 | 170,045 | cert-only | **spans 2019→2024**, near context limit |

## Two decisions for Wabil (why this stops here)

1. **Certify the expected outputs against your held answer key.** Per draft-then-certify governance,
   a gate fixture's `expected` must be human-certified, never self-approved by the model under test.
   Fabricating an `expected: Extraction` for a 5,615-message multi-year export is the exact risk the
   gate exists to catch. Each fixture therefore carries a **contract** (the invariants — no fabricated
   promise, no guessed date, dates track the message's own reference date, no merged people, no
   cross-chat leakage) but its concrete values are `PENDING_CERTIFICATION`. Fill them from your key,
   then promote into `eval-set.ts`.

2. **Clear the transcripts for commit.** Omar / Farah / Imtinan are real customer chats; the prior
   batch deliberately kept the exports untracked. Committing them as permanent fixtures is a privacy
   call — options: (a) commit as-is, (b) anonymise names/numbers first, (c) synthesise size-matched
   look-alikes. The scaffold references transcripts **by path**, so whichever you choose, no customer
   content is inlined until you say so.

## Proposed full-vs-CI cost split (warm AED, from the corrected model)

- **Every CI gate:** the **CI subset** = `import-easy-omar` only (~68 msgs, ~AED 0.37/run). One
  import-sized fixture on every gate proves the multi-message path stays wired and un-starved, for a
  per-gate adder of well under **AED 1**.
- **Full certification only:** all three, both scoring subsets, 3 runs. The hard fixture dominates:
  ~AED 2.55 × 3 runs ≈ **AED ~7.7**; medium ~AED 0.58 × 3 ≈ AED 1.7; easy ~AED 0.37 × 3 ≈ AED 1.1.
  **Import-sized certification adder ≈ AED 10–11** on top of the existing single-note cert, run only
  when re-certifying — not on CI.

This keeps CI cheap and fast while certification exercises the real worst case (multi-year, near the
context ceiling) that the single-note set never touched.

## Then B2 (blocked on the above)
Once certified + promoted: full 3-run gate, Sonnet, warm, N≥960, both subsets, v0.9.3 standard, **now
including these import-sized fixtures**. Report every metric beside its prior value. If fabrication or
precision degrades on multi-message inputs → report and stop; **do not tune.** This is real spend and
cannot be self-run in-session.
