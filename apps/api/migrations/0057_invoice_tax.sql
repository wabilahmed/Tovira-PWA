-- 0057_invoice_tax.sql [VAT-BOUNDARY] — the FROZEN per-invoice tax treatment. Computed at issue from
-- the invoice's own date + the VAT config in force then, written ONCE, never mutated by a later
-- config change. This is what makes the tax boundary a property of the record, not of today's flag.
-- SYSTEM table (populated from the Stripe webhook, no user context) — no RLS; keyed by Stripe id.
CREATE TABLE IF NOT EXISTS invoice_tax (
  invoice_id  text PRIMARY KEY,
  user_id     uuid,
  issued_at   timestamptz NOT NULL,
  country     text,
  total_fils  bigint NOT NULL,
  tax_invoice boolean NOT NULL,
  zero_rated  boolean NOT NULL,
  net_fils    bigint NOT NULL,
  vat_fils    bigint NOT NULL,
  rate        double precision NOT NULL,
  trn         text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON invoice_tax TO tovira_app; -- INSERT only: a frozen record is never updated
