# B2 — import-sized gate fixtures + invariant scorer (non-spend build complete; spend paused)

The multi-message regime the single-note eval set never covered — the blind spot behind the
max_tokens starvation AND the 30s-timeout abort — is now built, wired, and self-tested. The
certification run (the spend) is **not** run, per agreement.

## 1. The scorer bug — what could have passed while broken

The self-test caught it before the scorer could gate anything. **`scoreInvariants`' `mustNotMerge`
check used substring matching** (`name.includes(wanted)`) to confirm both names of a
must-not-merge pair were present as distinct people. For the canonical pair **Sara / Sarah** —
deliberately near-identical, which is the entire reason that check exists — `"Sarah".includes("sara")`
is `true`. So when the model **merged Sara into Sarah** (emitting only "Sarah" — the exact failure the
check exists to catch), the scorer found "sara" as a substring of "Sarah" and scored the merge as
**PASS**.

- **Which invariant could pass while broken:** the no-merge / tenant-confusion rule — *two distinct
  people must never be collapsed into one.* A real merge would have certified clean.
- **Is it a class?** It's the dangerous shape — *a violated anchor scoring as satisfied* (a false
  PASS), not a false fail. I audited the other clauses:
  - `requiredPromises` / `requiredPeople` / `requiredDates` match a **distinctive** substring of a
    present item. A genuinely missing anchor leaves nothing to match → correctly flagged. Collision
    (unrelated text containing the substring) is possible but unlikely for distinctive anchors.
  - `forbiddenEntities` substring matching errs toward **over**-flagging — the safe direction for a
    leak check.
  - **`mustNotMerge` was uniquely exposed** because it is the one clause that compares *near-identical
    strings by design* — exactly where substring matching collides. Fixed to exact (trimmed,
    case-insensitive) name equality.
- **Takeaway:** contained to the one clause that compares similar names; the shape (substring where
  equality is meant) is worth watching anywhere a check compares look-alike strings. This is the 4th
  new gate metric to need a must-fail self-test to prove it could fail.

## 2. The transcripts plant the certified anchors (the check pass)

`import-fixtures.test.ts` runs a consistency pass over every fixture, so nothing fails certification
"for the wrong reason":
- Every asserted anchor — required promises, people, dates, AND the trap material (retracted promise,
  competitor, prior-vendor) — **appears in that fixture's transcript**.
- All three transcripts parse as WhatsApp exports; sizes are in-regime (**~28 / ≥350 / ≥5,000**
  messages); the hard fixture **spans 2019 → 2024**; the small fixture contains **exactly 3 rep
  commitments** (the 3 anchors, no incidental ones); the generator is deterministic.
- Each real contract **fails an empty result** (anchors enforced) and **passes a compliant one** (no
  false-fail).

**A real issue this pass caught, pre-spend:** mirroring production, `extractImportFixture` resolves the
reference date from the **last message** (`referenceDateFor`), and the DATE-INVARIANT nulls any promise
`due_date` before it. In a multi-message import, historical promise dates are therefore **clamped to
null by design**. My first draft asserted `dueYear` (2021 / 2024) on historical promises — which would
have failed at certification for a *pipeline* reason, not a model one. Fixed: **multi-year date
integrity is asserted on key_dates** (not clamped — 2020 signing, 2023 renewal); promises assert recall
+ the vague-date-stays-null trap. The small fixture's dates (2024-06-06 / -12) survive because they
fall *after* its last message (2024-06-05).

## 3. What's wired, and the gating policy (for your cert-standard sign-off)

- `extractImportFixture` mirrors production exactly (parse → `renderThread` → last-message reference
  date → DATE-INVARIANT clamp), so the gate certifies the real import pipeline.
- The gate runs the **CI subset** (small, full-output) every run; the **cert-only** set (medium/hard,
  invariant) under `GATE_IMPORT_FULL=1`.
- It **gates on the robust trust rules** — 0 fabricated / guessed / leaked / null-named / false-certain
  promises, and 0 invariant violations — and **reports** full-output exact recall rather than making it
  a brittle per-push blocker. **This new gate surface's policy is flagged for your sign-off**, per the
  P1-9 governance (I didn't bake a cert-standard change in unilaterally).

## 4. Status
- Built + green: scorer + self-test (10), fixtures + consistency + integration self-test (8). Full
  suite **1488** green; typecheck + lint clean.
- **The certification spend (`npm run gate` with `GATE_IMPORT_FULL=1`) is NOT run** — paused for your
  go. Estimated ~AED 10–11 for a 3-run pass incl. the hard fixture; per-run cost will be captured.
- Commits are local (eval-harness + this doc change nothing at runtime); not pushed yet.

## Live confirmation that closes the arc
`extraction-canary` flipped **green in production at 08:23:06** after the boot-retry deploy: the failed
canary re-ran on boot (not 6h later), its real ~63s reasoning extraction **completed** under the new
300s timeout, and a text block came back. That is the first live proof that the timeout fix AND
boot-retry both work — extraction is genuinely working in prod again, now guarded by a canary proven to
catch the failure and a scheduler that re-checks every deploy.
