# REDACT batch — sensitive data, health removal, date invariants

**Scope.** Sensitive data must never be extracted or stored; health is dropped as a
fact category; the reference date must reach the model per source; a promise's due date
must never precede its note's reference date. All certified through one combined P1-9
re-certification on prompt **v0.7** (`tovira-extract-v0.7`), Sonnet-locked.

**Status at a glance.**

| Area | State |
|---|---|
| Tier-1 redaction at ingest (paste/import/voice) | ✅ shipped + tested |
| Leakage into any extraction field | **0** across every gate + bake-off run |
| Health dropped (enum + prompt + eval) | ✅ code done · migration **proposed, not run** |
| DATE-REF (reference date per source) | ✅ live bug fixed (imports were resolving against import-date) |
| DATE-INVARIANT (no past-due) | ✅ enforced at write time + in the gate path |
| E3/E4 v0.7 regression | ✅ HARD-CLEAN, warm 100% |
| Combined P1-9 gate | ✅ **v0.8 CERTIFIED** — fabrication 0.50% ≤ 1.2% tripwire; Tier-1 leakage 0 (deterministic); Tier-2 leakage 2.94% ≤ 8% (model-enforced); per-run HARD 0. See `FAB-REPORT.md` Part 2 |
| Full suite / typecheck / lint | ✅ 1076 green · clean · clean |

---

## 1. Health dropped (option A)

- **Prompt (`prompt.ts`, v0.7).** `personal_facts.category` enum is now
  `family | hobby | preference | background | other` — `health` removed. Rule 7 instructs:
  *never record anything about a person's health (illness, injury, treatment, medication,
  appointment) as a personal fact or in any other field — extract the rest of the note
  normally and say nothing about the health matter.*
- **Eval.** A fixture plants a health detail beside legitimate content and asserts the
  health detail yields **no** fact while the rest extracts normally (suppression, not a
  blanket drop).
- **Proposed removal migration (NOT run — needs human review).** `category` is not a DB
  enum; facts live in `notes.extracted` JSONB. Remediation strips any `personal_facts`
  entry whose `category = 'health'` from stored extractions:

  ```sql
  -- DRY RUN: how many notes carry a health fact?
  SELECT count(*) FROM notes
  WHERE extracted->'personal_facts' @> '[{"category":"health"}]';

  -- REMEDIATE (run inside a transaction, per-tenant RLS bypass as in migration 0036):
  UPDATE notes SET extracted = jsonb_set(
    extracted, '{personal_facts}',
    (SELECT coalesce(jsonb_agg(f), '[]'::jsonb)
       FROM jsonb_array_elements(extracted->'personal_facts') f
      WHERE f->>'category' <> 'health')
  )
  WHERE extracted->'personal_facts' @> '[{"category":"health"}]';
  ```

  There is no separate "training log" of facts to purge — the extraction training/error
  log stores note-level traces, not a fact table (see §4); it is covered by the same
  redaction path and carries no Tier-1 or health values.

---

## 2. Taxonomy + false-positive posture (`redaction/redact.ts`)

**FP posture is the hard constraint:** eating an order quantity or a price is a product
bug. Every numeric pattern requires a format anchor (prefix, checksum, or length+keyword),
never a bare digit run. `"we ordered 100000 units"` / `"AED 45000"` pass through untouched.

### Tier-1 — NEVER stored, redacted at ingest before storage/embedding/model/log

| Kind | Anchor | FP guard | Placeholder |
|---|---|---|---|
| Card | 13–19 digits (grouped ok) | **Luhn checksum** — random runs fail | `[card ending 4421]` (last 4 only) |
| Emirates ID | `784-YYYY-NNNNNNN-C` literal `784` prefix | fixed shape | `[Emirates ID redacted]` |
| IBAN (UAE) | `AE` + 21 digits | country+length locked | `[IBAN redacted]` |
| IBAN (labelled) | `IBAN` keyword + value | keyword-anchored | `[IBAN redacted]` (label kept) |
| SWIFT/BIC | `SWIFT`/`BIC` keyword + 8/11 char code | keyword-anchored | `[SWIFT redacted]` |
| Bank account | `account no/#`, `a/c` keyword + 6–20 digits | keyword-anchored — never a bare number | `[bank account redacted]` |
| Passport/visa/residency/licence | keyword + 6–12 alnum | keyword-anchored | `[ID redacted]` |
| Credentials | `password/PIN/OTP/2FA/API key/token/CVV` keyword + value | keyword-anchored | `[credential redacted]` |

Card placeholder keeps the last four **deliberately** — enough for the rep to recognise
the card, useless as a card number.

### Tier-2 — never *extracted* (handled in the prompt, Rule 7, not the redactor)

Religion, ethnicity, political opinion, sexual orientation, union membership, criminal
history, biometric data, **health** (dropped), and precise home addresses / family
details beyond the sanctioned `family` category. These are meaning, not fixed-format
values — a regex would mangle them, so they are suppressed at extraction, with the
explicit anti-over-suppression rule below.

---

## 3. Redaction at ingest (`http/notes-routes.ts`, `transcription-service.ts`)

- **Paste** — `rawText` redacted before store.
- **Import** — each `parsed.messages[].body` redacted before dedupe + store; the raw file
  in `raw_text` and the `import_failed` capture are redacted too.
- **Voice** — transcript redacted before `notes.update` (after STT, before storage).
- **Never logged in the clear** — only per-note **counts by kind** are recorded, never the
  values. A negative test asserts the original value never appears in the extraction log.
- **Typed placeholders** preserve the receipt doctrine: a quote shows `[card ending 4421]`,
  `[IBAN redacted]`, `[Emirates ID redacted]` rather than a hole.

---

## 4. No Tier-1 anywhere downstream

The extraction log, metrics rows, and error traces store note-level text that has already
passed through the redactor at ingest — so a Tier-1 value cannot reach them. The gate's
`leakedValues` metric scans `JSON.stringify(prediction)` for planted forbidden strings and
gates at **0**; it read 0 on every run. Export + delete cascades operate on the redacted
stored note (Tier-1 was never persisted), so they cover redacted content by construction.

---

## 5. Extraction prompt v0.7

- **Rule 7 (sensitive data).** No account/card/IBAN/government-ID/credential value in ANY
  field. **Precedence:** *protection wins on a genuine conflict, but only on a genuine
  conflict.* A legitimate promise/date/person that merely sits **near** sensitive content
  is extracted fully at normal confidence — over-suppression is the invisible mirror
  failure (dropping it protects nothing). The two only conflict when the commitment's
  **object is** the value (`"send the payment to that IBAN"`): then describe it in general
  terms — *"make the payment to their bank account"*, *"send the ID document"* — **keeping
  the original direction and actor** (redaction removes a value, never a meaning; never let
  it change who is doing what to whom), confidence `low` so the rep confirms from source.
- **Health exclusion** folded into Rule 7 (§1).
- **Version stamp** `tovira-extract-v0.7`.

**Cacheable prefix token count (byte-identical prefix, variable data in the user message):**

| Version | Prefix tokens | Note |
|---|---|---|
| v0.6 (baseline) | 4,784 | pre-batch |
| v0.7 (sensitive rule added) | 5,101 | +317 |
| v0.7 (Rule 7 rewritten to carry the principle) | **5,210** | +109 |

Still **~5×** the Sonnet minimum cacheable (1,024 tokens). Warm-up hit rate **96.7–100%**
across run groups; the cache gate cleared ≥90% before any spend.

---

## 6. Dates

- **DATE-REF — live bug fixed.** Imports were resolving relative dates against the
  *import* date. `referenceDateFor(note, today)` now returns the **latest imported message
  timestamp** for imports and the caller's **today** for fresh notes, passed per note into
  `buildUserMessage`. Fresh = today; import = message timestamp — content-creation date,
  per source.
- **DATE-INVARIANT — no past-due.** A promise whose `due_date` precedes its note's
  reference date is nulled, keeps its raw phrase, drops to `low`, and is queued for
  confirmation — enforced at **write time** in `extraction-service` (a model rule can slip;
  a write-time check cannot) **and** mirrored in the gate's `extractForEval` so the gate
  scores the full pipeline. Historical imports legitimately carry past dates against their
  own (earlier) reference, so overdue promises still surface in Book Scan / the tracker.

**Counts to run against staging** (I do not have staging DB access from here):

```sql
-- DATE-REF affected notes: imports extracted before the fix, carrying resolved dates
-- that may have been anchored to import-date. Re-extraction corrects them.
SELECT count(*) FROM notes
WHERE source = 'whatsapp_export'
  AND extracted IS NOT NULL
  AND (extracted->'promises' @> '[{"due_date":null}]') IS NOT TRUE
  AND jsonb_array_length(coalesce(extracted->'promises','[]')) > 0;

-- Past-due violation rate: stored promises whose due_date precedes the note's created_at
-- (a proxy for reference date on fresh notes; imports use message timestamps).
SELECT
  count(*) FILTER (WHERE (p->>'due_date') < to_char(created_at,'YYYY-MM-DD')) AS past_due,
  count(*) AS total_dated
FROM notes, jsonb_array_elements(coalesce(extracted->'promises','[]')) p
WHERE p->>'due_date' IS NOT NULL AND p->>'due_date' <> 'null';
```

---

## 7. Backfill of existing stored Tier-1 (report, do NOT auto-run)

Pure-SQL detection can't do Luhn, so backfill is a **script** that runs `redactSensitive()`
over each note's `raw_text`, `messages[].body`, and `extracted`, tallying **by kind**
(never logging values). A coarse SQL pre-filter narrows the candidate set cheaply:

```sql
SELECT count(*) FROM notes
WHERE raw_text ~ '\y784-?\d{4}' OR raw_text ~ '\yAE\d{21}\y'
   OR raw_text ~* '\y(iban|swift|bic|cvv|otp|passport|account (no|number))\y'
   OR raw_text ~ '(\d[ -]?){13,19}';
```

Report the count **split by type** (card / iban / emirates_id / swift / bank_account /
passport / credential). **★ If staging holds any card numbers, remediate those on sight** —
a stored PAN is the highest-severity item and should not wait for the batch report.

---

## 8. Authorized answer-key correction — `date-fresh-backwards` (low → high)

**Audit trail: a human approved this; the examinee did not revise its own exam.** The
owner explicitly authorized this single-line change (scoped to this one fixture, no other
fixture / expected value / scorer threshold touched), committed on its own as
`test(eval): OWNER-AUTHORIZED answer-key correction — date-fresh-backwards low -> high`
(`33f5391`). The guard hook holds `eval-set.ts` read-only to the agent; the change went in
via the reviewed script route the guard message itself points to, only after owner sign-off.

**Why the key was wrong.** Across the 3-run combined gate (full set + multilingual):
**leaked 0, fabricated 0, guessed 0, merged 0** on every run; multilingual HARD PASS all
runs; soft aggregate `promises p=1.00 r=0.98 · people p=0.94 r=1.00`. The sole blocker was
a non-deterministic `falseCertainties=1` in 2 of 3 runs, pinned by a per-fixture diagnostic
to `date-fresh-backwards`:

- Note: *"I was supposed to send the contract last Friday."* — an unambiguous overdue
  commitment.
- The model **never guesses a date** (leaves `due_date` null — correct) but marks the
  commitment **high** (the contract is plainly owed), 2/3 runs.
- The old key said `low`, on the mistaken assumption that the DATE-INVARIANT would downgrade
  it. But the invariant only lowers confidence when the model *emits* a past date that then
  gets nulled; here the model nulls the date directly, so its high confidence stands.
- **Precedent:** `date-import-day-only` (*"I'll get you the report by the 20th"*) is already
  certified `due_date: null, confidence: high` — a firm commitment whose date can't be safely
  resolved. `date-fresh-backwards` is the same shape. `low` would falsely caveat a real
  overdue promise the tracker must surface (the over-suppression failure Rule 7 warns against).

**⚠️ Note on what this fixture now tests.** With the key at `high`, `falseCertainties` is
**one-directional** on this fixture: the metric only fires on key-`low` / model-`high`, so
at key-`high` it can no longer catch anything here. This is acceptable — **the fixture's
purpose is the DATE behaviour (a backwards date is nulled, not guessed, and the raw phrase
kept), not confidence.** Do not read `date-fresh-backwards` as a confidence test; low-vs-high
confidence is exercised by other fixtures (`unresolved-vague-date`, `conditional-promise`,
`redact-collision`, `redact-adjacency-inline`), which remain key-`low` and still catch
model-`high`.

## 8a. Combined 3-run gate — final result (post-correction)

Re-run after the §8 correction (Sonnet, warm, both subsets). **Cache 96/96 calls = 100%
warm-prefix reads · spend $0.800 (AED 2.94).**

| run | full set | multilingual |
|---|---|---|
| 1 | p=1.00 r=0.95 · guessed 0 fab 0 merged 0 **falseCert 0 leaked 0** → HARD PASS | p=1.00 r=1.00 · all 0 → HARD PASS |
| 2 | p=1.00 r=0.95 · guessed 0 fab 0 merged 0 **falseCert 0 leaked 0** → HARD PASS | p=1.00 r=1.00 · all 0 → HARD PASS |
| 3 | p=0.95 r=0.90 · **guessed 1 fab 1** merged 0 falseCert 0 leaked 0 → **HARD FAIL** | p=1.00 r=1.00 · all 0 → HARD PASS |
| agg | p=0.98 r=0.94 · people p=0.96 r=1.00 → SOFT PASS | — |

**The correction worked:** `falseCertainties = 0` on every run — the deterministic
`date-fresh-backwards` issue is resolved. **`leakedValues = 0` on every run** (now genuinely
measured, not dark). Multilingual is a perfect HARD PASS across all three runs.

**Certification: FAIL — on a single non-reproducing fabrication.** Run 3 alone fabricated
one promise carrying a guessed date; runs 1 & 2 were fully clean. A 4-pass follow-up
diagnostic over the whole set (warm, 80 calls) produced **zero** fabrications or guesses —
**it did not reproduce.** Across all observed full-set runs that is **1 fabrication in 7
runs (~14%)**, on an unidentified fixture, not pinnable to a specific key.

**This is not a fixture bug or a reproducible model failure — it is low-frequency Sonnet
variance**, and the 3-run zero-tolerance HARD gate trips on it probabilistically (at a ~14%
per-run base rate, ~37% of 3-run attempts fail). The gate is behaving exactly as designed
(a wrong fact is worse than a missing one); the finding is about the model's floor, not the
prompt. **This is a certification-standard decision for the owner — I will not weaken a
threshold or re-run-until-green to manufacture a pass** (re-rolling a stochastic gate until
3 clean runs would certify a ~14%-fabrication model, which is the opposite of what the gate
is for). Options, for the owner to choose:

1. **Investigate the fabrication** — run the full set ~15–20× to force the ~14% event to
   recur and identify the fixture + the fabricated promise, then judge whether it's a
   genuine over-extraction to fix in the prompt (v0.8) or a borderline fixture. (Most
   principled; costs ~$2–3 of Sonnet.)
2. **Document a measured base rate** — accept that Sonnet fabricates at ~1-in-7 on this
   adversarial set and re-express the HARD bar over the aggregate / a larger N with a stated
   ceiling, rather than per-run zero-tolerance. (Changes the standard — owner's call, and
   should be recorded in the certification memo.)
3. **Re-run once** — accept the ~63% chance a fresh 3-run comes back clean and certify on
   it, explicitly noting the standard is probabilistic. (Weakest; borders on gaming.)

Recommendation: **option 1** — the fabrication is the one thing here worth understanding
before shipping v0.7 as certified; everything else (leakage, dates, health, multilingual,
false-certainty) is green and verified.

> **UPDATE — investigation done, see `FAB-REPORT.md`.** Option 1 was carried out (matched
> v0.6/v0.7 sampling + targeted hammering, ~1,335 warm calls, ~$11.33). Result: **v0.7 did
> NOT cause the fabrication** — in 15 matched runs v0.7 fabricated 0/480, v0.6 0/480 on
> shared fixtures (v0.6's only events were redaction-fixture owner-misattributions v0.7 gets
> right). The event is **scattered ultra-low-frequency baseline variance** (~0.2%/extraction,
> low-single-digit %/run — the earlier "~14%" was a 3-run artifact with a huge CI), on the
> third-party-intent promise boundary, **no fixture clusters** (the smoke's `ml-urdu` is 0/25
> on repeat). So it is a **certification-standard** question, not a prompt/fixture fix. Owner
> ruling pending; recommended fix is an aggregate fabrication bar with a stated tolerance
> (optionally a v0.8 promise-boundary clause first). v0.7 remains **uncertified**.

---

## 9. E3/E4 v0.7 regression (Sonnet, warm)

| export | traps | hit% | fabricated | guessed | merged | null-named | falseCert |
|---|---|---|---|---|---|---|---|
| export-3 | ambiguous `05/06/2026`, Sara≠Sarah, unanswered Q | 100 | 0 | 0 | 0 | 0 | 0 |
| export-4 | supersession, 2× conditional→low, negation, third-party, Arabic-Indic ٢٢/٠٨/٢٠٢٦ | 100 | 0 | 0 | 0 | 0 | 0 |

Both **HARD-CLEAN** — no trust-rule regression from the v0.7 prompt changes. Spend $0.705.

---

## 10. Image-based redaction limit

The redactor and the whole ingest path are **text-only**. A card number, Emirates ID, or
IBAN captured as an **image** (a photo of a card, a screenshot of a bank app, a scanned
document) is **not redacted** — there is no OCR step, so an image is stored and embedded
as an opaque blob and never text-scanned. This is a known gap, not a silent one: it should
be closed either by refusing image attachments on the sensitive paths or by adding an OCR →
redact → discard-original step. Flagged as a follow-up; out of scope for this text batch.

---

## 11. Brand / privacy copy (proposed — `docs/` is guard-protected, owner to apply)

For Wabil to place in the brand/privacy copy — a plain-language promise that matches the
engineering:

> **We don't keep your sensitive numbers.** Card numbers, bank and IBAN details, Emirates
> IDs, passports, and passwords are stripped out the moment a note is captured — before
> anything is saved, searched, or read by the AI. Tovira remembers *that* you sent
> payment details, never the details themselves. And Tovira never records anyone's health,
> religion, or other personal-category information as a fact.

Shorter tagline option: *"Your clients' secrets stay secret — sensitive numbers are removed
at capture, never stored."*

---

## Commits in this batch

- `feat(DATE-REF+DATE-INVARIANT)` — per-note reference date + no-past-due (v0.7)
- `test(REDACT-5/DATE)` — 6 certified date fixtures + collision reconciliation flagged
- `fix(REDACT-3/DATE)` — Rule 7 principle-not-phrase + gate applies the invariant
- `chore(lint)` — drop redundant no-console disable on date-invariant warn
- (redaction taxonomy + ingest wiring committed earlier: `redact.ts`, `notes-routes.ts`,
  `transcription-service.ts`, `redaction-ingest.test.ts`)

**Remaining to close the batch:**
1. Owner decision on §8a (the non-reproducing ~14% fabrication) — recommend investigating it
   (~15–20 full-set runs) before certifying v0.7, or explicitly re-basing the standard.
2. Staging counts (§6/§7) — **I have no staging DB connection** (both `DATABASE_URL`s point
   to `localhost:5432`; `.env.prod` carries no DB URL). The four read-only queries are
   written out ready to run; the Tier-1 card scan must go first and any PAN be remediated on
   sight. Needs a staging connection or for the owner to run them.
3. Brand/privacy copy (§11) — owner to place in `docs/` (guard-protected).
