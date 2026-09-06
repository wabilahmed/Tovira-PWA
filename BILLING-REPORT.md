# Billing — period anchor, invoice data, and what only Wabil can do

Two code pieces shipped (period anchor + invoice data); the rest is Stripe **Dashboard**
configuration the application cannot do, listed precisely below. **The VAT item is the one that
needs a decision, not just a toggle — flagged ★.**

## What the app now sends to Stripe (after this batch)

On checkout the app creates a Stripe **customer** carrying:
- `email` (from the account),
- `name` — when collected (see the gap below),
- `metadata.tovira_user_id` — **always**, so any invoice traces back to an account without matching
  on email,
- `metadata.company` — when provided,

then opens a subscription checkout (`client_reference_id = userId`, monthly or annual price). A name
change in Settings syncs to the customer (`PATCH /billing/customer`). **No PII beyond email + name +
that metadata is sent.** Period start/end are stored from the webhook (source of truth).

**The gap to a compliant tax invoice** (what the app does NOT do, by design — it's Dashboard/decision
work): the **business name, branding, "Tax Invoice" label, TRN, and VAT breakdown**. Those are below.

---

## 1. Dashboard — branding (Settings → Branding, and Invoice template)

- **Business name:** **Prospera Technologies FZ-LLC**.
- A line stating **Tovira is a product of Prospera Technologies FZ-LLC** (invoice memo/footer).
- **Logo** and **brand colours** (Branding settings — used on invoices, receipts, hosted pages).
- **Support email** shown on the invoice.
- **Invoice footer** text (e.g. the product-of line + support contact).

## 2. Dashboard — invoice settings (Settings → Invoicing / Customer emails)

- Whether **customer-facing receipts** and **hosted invoice pages** are enabled (recommend on).
- **Invoice numbering scheme** (prefix + sequence).
- **Memo / footer** text (the product-of line, support, and — once VAT is decided — the TRN + any
  required statement).

## 3. ★ UAE VAT — a decision for the accountant, not a toggle

**Flag prominently.** At the ~170-user target the business is around **AED 610k/year**, past the
**AED 375,000 mandatory VAT-registration threshold**. A VAT-registered UAE business must issue proper
**tax invoices**:
- the words **"Tax Invoice"**,
- the supplier's **TRN**,
- **VAT shown separately** (the 5% line), not just a gross total.

Implications to resolve **in the professional engagement already running**:
- **Registration + TRN.** Once registered, the TRN must appear on every tax invoice. Stripe **Tax**
  can calculate VAT and place the required fields, but it must be **configured** and given the **TRN**.
- **★ Is AED 299 VAT-inclusive or -exclusive?** This is the load-bearing question. **The COGS model
  already assumes AED 299 is VAT-inclusive** — i.e. the net to the business is ~AED 284.75 and ~AED
  14.25 is output VAT. If instead VAT is added on top (AED 299 + 5% = AED 313.95), the displayed price,
  the landing copy, and the unit economics all change. **Do not change the price or the assumption
  without the accountant's confirmation** — it affects revenue recognition and the margin the spend
  cap sits inside.
- **Business-customer TRN capture.** A business customer who wants their TRN on the invoice (for
  input-tax recovery) needs Stripe's **customer tax ID** collected at checkout. **The checkout does
  NOT collect a tax ID today, and I did not enable it** — it interacts with the decisions above (only
  meaningful once we're registered and issuing tax invoices). Enabling it is a checkout setting
  (`tax_id_collection`) once the VAT path is decided.

**This is an accountant question.** It belongs in the professional engagement, not a code change.

---

## Code shipped in this batch
- `fix(PERIOD-ANCHOR)` — `current_period_start` persisted from the webhook (migration 0055); the spend
  cap buckets on the **stored** start, never an inferred one; plan changes roll to a clean new bucket
  and keep old spend where it was incurred; absent starts fall back to an **explicitly marked** key
  (`t:` / `pf:`), never an invented authoritative one. Closes the follow-up flagged after the
  spend-cap batch.
- `feat(INVOICE-DATA)` — customer name + `tovira_user_id` metadata supplied to Stripe; Settings sync;
  no extra PII. Migration 0056.

## Small follow-up (web, pairs with the Dashboard work)
The server endpoint + `billingClient.setCustomer()` exist and are tested, but **no name/company field
is surfaced in the checkout/Settings UI yet** — so today invoices carry email + traceable metadata but
a name only once that field is added. It's a one-component addition (a name/company input on the
billing section) and pairs naturally with configuring the invoice template. Until then, traceability
is intact (metadata) and the name is simply absent.
