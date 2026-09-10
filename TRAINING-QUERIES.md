# Training-log queries to run — `docs(TRAINING-QUERIES)`

The audit could not reach a live database (docker down locally; no staging DSN in the workspace;
infra human-gated). These are ready to paste. Run them and paste back the numbers.

## ⚠️ RLS-owner caveat — READ FIRST, or every count comes back near-zero

`extraction_logs` and `corrections` have `FORCE ROW LEVEL SECURITY` with a policy of
`user_id = current_setting('app.user_id')`. On a normal app connection that setting is unset, so the
policy matches **nothing** and every aggregate silently returns 0 — it will *look* like an empty log
even if it's full.

Run these as the **table owner / superuser** (the `DATABASE_URL` role, e.g. `tovira`), **not** the
app role (`tovira_app`). The owner bypasses the policy and sees every tenant. On RDS:

```bash
psql "$DATABASE_URL"   # the superuser URL — NOT APP_DATABASE_URL
```

(The `training-retention` sweep and the `/health` training-log aggregate already use the superuser
pool for exactly this reason.)

---

## TASK 1 — content

```sql
-- Row count + date range.
SELECT count(*) AS rows, min(created_at) AS first, max(created_at) AS last
FROM extraction_logs;

-- By prompt version (v0.1 → v0.9.4) — gaps = periods that produced nothing.
SELECT prompt_version, count(*)
FROM extraction_logs
GROUP BY prompt_version
ORDER BY prompt_version;

-- Empty / starved output — logged but UNUSABLE as training data. Their date span dates the
-- max_tokens breakage (fixed 2026-09-09 by the MODEL_TIMEOUT_MS/EXTRACTION_MAX_TOKENS work).
SELECT count(*)                                                      AS empty_output,
       min(created_at) FILTER (WHERE raw_output IS NULL OR btrim(raw_output) = '') AS first_empty,
       max(created_at) FILTER (WHERE raw_output IS NULL OR btrim(raw_output) = '') AS last_empty
FROM extraction_logs
WHERE raw_output IS NULL OR btrim(raw_output) = '';

-- By source (voice / paste / whatsapp_export / ask_conversation). extraction_logs has no source
-- column — join to notes. NB: rows whose note was deleted (every rejected ask-capture) have
-- note_id = NULL (migration 0045) and show source = NULL — expected, not a bug.
SELECT COALESCE(n.source, '(orphaned — note deleted)') AS source, count(*)
FROM extraction_logs e
LEFT JOIN notes n ON n.id = e.note_id
GROUP BY 1
ORDER BY 2 DESC;

-- Average sizes — are these real extractions or trivial ones?
SELECT round(avg(length(input)))      AS avg_input_chars,
       round(avg(length(raw_output))) AS avg_output_chars,
       round(avg(input_tokens))       AS avg_input_tokens,
       round(avg(output_tokens))      AS avg_output_tokens
FROM extraction_logs;
```

## TASK 2 — corrections (run once NOW as the baseline, then again after beta reps use the queue)

```sql
-- Total corrections, and the split by field. After this batch, rejections/confirmations appear as
-- the sentinel fields '__rejected__' / '__confirmed__'; real edits appear as 'text','owner',etc.
-- '__rejected__' count ÷ extraction rows is the Condition-4 production rejection-rate proxy.
SELECT field, count(*)
FROM corrections
GROUP BY field
ORDER BY count(*) DESC;

SELECT count(*) AS corrections_total FROM corrections;

-- By the entity type judged (promise / meeting / ask_capture).
SELECT entity_type, count(*) FROM corrections GROUP BY entity_type ORDER BY 2 DESC;
```

## TASK 3 — privacy: Tier-1 in rows written BEFORE ingest redaction shipped (2026-09-02)

Redaction (`redact.ts`, commit `0648edb`) shipped **2026-09-02**. Rows on/after that date should be
Tier-1-clean; rows **before** it predate redaction and may carry raw Tier-1 in `input`/`raw_output`.
**Counts only — never SELECT the values.** This is the same five-minute scan as the earlier card scan.

```sql
-- How many pre-redaction rows exist at all (the exposure window's size).
SELECT count(*) AS pre_redaction_rows,
       min(created_at) AS earliest, max(created_at) AS latest
FROM extraction_logs
WHERE created_at < '2026-09-02';

-- Tier-1 pattern matches among those rows — COUNTS ONLY. Patterns mirror redact.ts (Luhn is done in
-- app code, so this card regex is a loose superset; treat a non-zero count as "inspect + purge",
-- never as a value to read).
SELECT
  count(*) FILTER (WHERE (input ~ '[0-9](?:[ -]?[0-9]){12,18}') OR (raw_output ~ '[0-9](?:[ -]?[0-9]){12,18}')) AS maybe_card_or_long_number,
  count(*) FILTER (WHERE (input ~* '\yAE[0-9]{2}[0-9A-Z]{10,30}\y') OR (raw_output ~* '\yAE[0-9]{2}[0-9A-Z]{10,30}\y')) AS maybe_ae_iban,
  count(*) FILTER (WHERE (input ~ '\y784[- ]?[0-9]{4}[- ]?[0-9]{7}[- ]?[0-9]\y') OR (raw_output ~ '\y784[- ]?[0-9]{4}[- ]?[0-9]{7}[- ]?[0-9]\y')) AS maybe_emirates_id
FROM extraction_logs
WHERE created_at < '2026-09-02';
```

If `maybe_*` counts are all 0 → the pre-redaction window is clean, exposure discharged. If any are
non-zero → those rows are the exposure; purge or scrub them (they are old, so the retention sweep,
once enabled, removes them anyway). Rows on/after 2026-09-02 are redacted at ingest and are not scanned.

---

### Expected honest shape
Staging has been near-empty throughout, and extraction was dead in production for anything over
~10 messages until the 2026-09-09 fix — so a **small** row count with a visible block of empty-output
rows ending 2026-09-09, and **near-zero** corrections until beta reps start using the queue, is the
expected honest answer, not a failure.
