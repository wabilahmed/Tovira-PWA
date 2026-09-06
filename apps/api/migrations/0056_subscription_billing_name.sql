-- 0056_subscription_billing_name.sql [INVOICE-DATA] — the customer name (+ optional company) the
-- app collects and syncs to the Stripe customer, so generated invoices carry a name, not just an
-- email. Stripe remains the invoice generator; this is only what the app must supply.
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS billing_name text;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS billing_company text;
