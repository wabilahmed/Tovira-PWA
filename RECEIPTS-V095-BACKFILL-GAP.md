# RECEIPTS v0.9.5 — Task 4: honest gap for pre-v0.9.5 facts

Every fact captured before v0.9.5 went live (~2026-09-15 01:35 UTC) has `source_span = NULL`
and **cannot be backfilled deterministically** — the verbatim span was never stored and cannot be
reconstructed from the note body without guessing (which would be a fabricated receipt). This batch
does **not** attempt reconstruction.

## How these facts render

They render an **honest no-receipt marker**, not a blank and not a fabricated quote. The marker is
produced by `buildReceipt` returning `{ quote: null, source: 'none', label: "No source quote was
saved for this fact" }`.

The marker is driven by **`source_span IS NULL`**, never by a date comparison. Consequences:
- A pre-v0.9.5 fact (null span) → marker. Correct.
- Any *future* fact that also lacks a span (e.g. the model returns `source_span: null` per Rule 9
  when it cannot point to a clear span) → same marker. Correct, automatically — no go-live date is
  hard-coded anywhere in the renderer.
- A receipted fact and a gap fact are visually distinguishable on every field a UI keys off:
  `source` (`'message'`/`'capture'` vs `'none'`), `quote` (string vs `null`), and `label`.

## Exact counts the owner can run against production

The agent has **no production DB access** — these are the queries to run; they are not estimates.

### Relational tables (promises, key_dates, meetings) — have a `source_span` column

```sql
-- Facts with no stored receipt (cannot be backfilled), per relational table.
SELECT 'promises'  AS tbl, count(*) FILTER (WHERE source_span IS NULL) AS no_receipt, count(*) AS total FROM promises
UNION ALL
SELECT 'key_dates', count(*) FILTER (WHERE source_span IS NULL), count(*) FROM key_dates
UNION ALL
SELECT 'meetings',  count(*) FILTER (WHERE source_span IS NULL), count(*) FROM meetings;
```

Optional cross-check that the gap aligns with go-live (informational only — the marker itself does
NOT use this date):

```sql
SELECT 'promises' AS tbl,
       count(*) FILTER (WHERE source_span IS NULL AND created_at <  timestamptz '2026-09-15 01:35:00+00') AS null_pre_golive,
       count(*) FILTER (WHERE source_span IS NULL AND created_at >= timestamptz '2026-09-15 01:35:00+00') AS null_post_golive
FROM promises
UNION ALL SELECT 'key_dates', count(*) FILTER (WHERE source_span IS NULL AND created_at <  timestamptz '2026-09-15 01:35:00+00'),
                              count(*) FILTER (WHERE source_span IS NULL AND created_at >= timestamptz '2026-09-15 01:35:00+00') FROM key_dates
UNION ALL SELECT 'meetings',  count(*) FILTER (WHERE source_span IS NULL AND created_at <  timestamptz '2026-09-15 01:35:00+00'),
                              count(*) FILTER (WHERE source_span IS NULL AND created_at >= timestamptz '2026-09-15 01:35:00+00') FROM meetings;
```

A non-zero `null_post_golive` is not a bug — it is the model legitimately declining to quote a span
(Rule 9), which the marker also covers.

### JSONB facts (people, personal_facts) — live inline in `notes.extracted`, no column

```sql
-- People entries with no stored receipt, across all notes.
SELECT count(*) AS people_no_receipt
FROM notes, LATERAL jsonb_array_elements(extracted -> 'people') AS p
WHERE jsonb_typeof(extracted -> 'people') = 'array'
  AND (p ->> 'source_span') IS NULL;

-- Total people entries, for the denominator.
SELECT count(*) AS people_total
FROM notes, LATERAL jsonb_array_elements(extracted -> 'people') AS p
WHERE jsonb_typeof(extracted -> 'people') = 'array';

-- Personal-fact entries with no stored receipt.
SELECT count(*) AS personal_facts_no_receipt
FROM notes, LATERAL jsonb_array_elements(extracted -> 'personal_facts') AS pf
WHERE jsonb_typeof(extracted -> 'personal_facts') = 'array'
  AND (pf ->> 'source_span') IS NULL;

-- Total personal-fact entries.
SELECT count(*) AS personal_facts_total
FROM notes, LATERAL jsonb_array_elements(extracted -> 'personal_facts') AS pf
WHERE jsonb_typeof(extracted -> 'personal_facts') = 'array';
```

(RLS note: run these as an owner/admin role or per-tenant; the app role is tenant-scoped, so an
app-role run would count only the current tenant.)

## What is NOT done

No reconstruction, no backfill, no migration. Pre-v0.9.5 facts keep `source_span NULL` and render the
honest marker. As reps capture new notes on v0.9.5, the share of marked facts declines naturally.
