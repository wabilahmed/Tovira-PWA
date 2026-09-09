# Client-as-person, promise staleness, and the attribution diagnostic

Covers the three-part batch: the diagnostic that attributed a failed certification, the client-as-person
ruling and re-cert, and the promise-staleness surfacing rule. Plus the gate-policy fix the CI gate
surfaced along the way.

## Part A — the diagnostic (attribution, no tuning)

The prior certification failed on all three import fixtures. Dumping the raw extractions
(`IMPORT-DIAG`, AED 2.41) attributed the failures precisely, and the headline is: **no engine problem.**
- **Client-as-person** (dominant cause) — the engine already emitted the counterpart as a person on
  some runs and not others (non-deterministic), while the fixtures asserted `people:[]`. A fixture/spec
  gap, not engine loss.
- **Scorer brittleness** — the invariant matcher checked only `.text`; the engine legitimately split a
  promise across `text`+`due_raw` and reworded others, so "3 promises lost" was a **false negative**.
  Every anchor had in fact been extracted; multi-year dates (2020/2023) resolved perfectly; the
  retracted promise and the competitor were correctly excluded.
- **Filler confound** — the ~5,000-line benign "ok/thanks" filler was replaced with realistic,
  fact-free-but-varied chatter (`FIXTURE-FILLER`) so the fixture is trustworthy; the diagnostic showed
  it had not actually suppressed extraction.

## Part B — client-as-person (v0.9.4), certified

**Ruling:** a named-individual client **is** a person and appears in `people` under their real name
(never a chat alias), `decision_role` `unknown` unless the note states their authority; an organization
client (company/group/family/account) is an account, not a person.

**Fixtures the ruling changed** (7 eval-set + 3 import + 3 new; Nassar Family unchanged — an account):
`req-client-question` (Ahmed), `req-conditional` (Fatima), `req-beside-tier1` (Ravi),
`req-past-purchase-not-requirement` (Rashid), `req-third-party-referral` (Omar), `req-on-behalf-of`
(Layla), `req-actor-split` (Faisal) — each gains the client as a person, `unknown`. New:
`client-person-authority` (stated authority → decision_maker), `client-person-alias` (alias → real
name), `client-person-org-negative` (org → only the named individual). Import fixtures: client roles
→ `unknown`; the small fixture moved to an invariant contract (see the gate-policy fix).

**Re-cert (3-run, GATE_IMPORT_FULL, warm), every metric beside its prior value:**

| metric | v0.9.3 | v0.9.4 |
|---|---|---|
| **people precision** | 0.88 | **1.00** |
| people recall | 0.98 | 0.99 |
| promises precision / recall | 1.00 / 0.95 | 0.98 / 0.95 |
| guessed / merged / leaked / null-named | 0 | **0** |
| fabrication | 0/138 | 1/147 = 0.68% (≤1.2% bar, **provisional**) |
| import fixtures | all FAIL | **all PASS, recall 1.00** |
| deploy gate | PASS | **PASS** |

**The people-precision headline:** the 0.88–0.90 "dip" reported as an *engine caveat* across several
certifications was the engine emitting the client correctly while the answer key was wrong. Correcting
the fixtures took it to **1.00** — a false signal removed, not a regression fixed. *A measurement that
disagrees with the system may be wrong about the system.*

**Fabrication framing:** 1/147 is a 3-run **provisional** with a huge interval — NOT a rate. The
published certified rate stays **0.50%** (from the N≥960 v0.9.3 run) until a full N≥960 run re-derives
it. That full run is owed before beta (the prompt has changed three times since the last one).

## The gate-policy fix (surfaced by the now-live CI gate)

`ANTHROPIC_API_KEY` is now in CI secrets, so the P1-9 gate runs on every push — the long-standing
"wire the gate into CI" item is finally live. Its first act was to fail v0.9.4 on the small import
fixture (`fab 1, recall 0.71` one run, `fab 0, recall 1.00` the next). `OMAR-FAB` attribution (5 runs)
showed every "fab" was a reworded follow-up or the onboarding **contingent** promise (Rule 4 says keep
it at low confidence) — **no genuine fabrication**. Full-output exact-match on a rich input manufactures
false fabrications from legitimate variance.

**Fix (owner-ruled, aligned to the certified single-note policy):**
- `scoreInvariants` splits violations into **WRONGNESS** (commission — guessed-date-on-null, wrong-year,
  forbidden/retracted promise, leaked entity, merged people) which gates per-run, and **RECALL MISSES**
  (omission — missing anchor, off role) which are **reported, not gated**.
- **Fabrication** is the single-note **aggregate** bar (≤1.2%), not a per-run import gate.
- The small fixture moved to an **invariant contract** — its anchors passed all 5 attribution runs, so
  the gate is now stable where full-output flaked 4/5.
- Also fixed: a merge is a *collapse* (one of the pair survives), not both-absent (that's recall).

## Part C — promise staleness (surfacing only; extraction unchanged)

A promise overdue past a window goes **stale**: still stored, still searchable, still answerable by
recall, but off the active count, off claret, off Today's register. **Extraction is unchanged** — every
promise is captured regardless of age (proven: `saveExtraction`, `listPromisesByUser`, and account
export are untouched; the predicate is computed at surfacing time only).

**Threshold — 90 days overdue, configurable (`PROMISE_STALE_THRESHOLD_DAYS`), derivation recorded:** a
six-week-old miss is recoverable and is exactly what the Book Scan sells ("you told Sarah you'd send the
quote on the 12th, no sign you did"); a years-old promise is dead. 30 days would gut the feature to
solve a problem that only bites at the multi-year (import) end. **[flag] owner may set 30.**

**Surfacing (excluded when stale):** hero `today()`/`signals()` (active count + Today's register), the
daily overdue-promise alert, the promises tracker (endpoint tags each promise `stale`; the UI keeps the
active count/claret on the active set and puts older ones behind a "Show N older" filter).

**The import flood (C2):** because staleness is *computed*, an imported historical promise is stale on
arrival with no migration. The **Book Scan lists the recoverable ones and reports a count of the older
ones** (`report.stalePromises`) — importing seven years is a curated reveal, not forty red rows. And
**the Book Scan still surfaces genuinely dropped promises** within the window: a promise missed weeks
ago is still listed with its receipt, framed "worth checking" — the headline is intact.

Doctrine sibling: requirement 60-day dormancy and disabled inventory — retired from the active surface,
never deleted.

## Status
v0.9.4 certified and deploying (client-as-person). Gate policy aligned and stable. Promise staleness
landed (backend + tracker UI), extraction provably unchanged, the import flood handled. Full suite
green; typecheck + lint clean. Owed before beta: one full **N≥960** certification to put the published
fabrication/precision numbers back on measured ground. `docs/tovira-extraction-prompt.md` (the contract)
needs the human v0.9.4 edit (guarded file; exact text handed over).
