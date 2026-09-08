# VAT flip-day runbook

UAE VAT is **fully built and switched off**. Prospera is below the AED 375k threshold today, so no
VAT is charged and none is owed. The code is ready; **turning it on is an accountant's decision to
trigger, not an engineering one** — the timing is a compliance judgement about when registration
takes effect. This document makes the switch a checklist, not a project.

## The two rulings the build encodes
1. **AED 299 is VAT-inclusive when VAT applies.** The price never changes on registration day — its
   composition does. Before: AED 299 revenue, no tax. After: **AED 284.76 net + AED 14.24 VAT**.
   Prospera absorbs the VAT; a customer paying 299 today pays 299 after, no notice, no price rise.
2. **A registration date, not just a flag.** An invoice's tax status is a property of **its own
   date** vs `VAT_REGISTERED_FROM`. Invoices before it are ordinary invoices forever; on/after it are
   tax invoices. Nothing is ever reclassified retroactively — the treatment is frozen at issue in the
   `invoice_tax` record and a later config change never rewrites it.

## Flip-day sequence (in order)
1. **Obtain the TRN** from the FTA (the registration outcome).
2. **Configure Stripe** (Dashboard — see below): enable Stripe Tax, set the price **tax behaviour to
   `inclusive`**, add the TRN to the tax registration. **Do not delete/replace live prices** — set tax
   behaviour on the existing price, or create a new inclusive price and point checkout at it.
3. **Set the app config:** `VAT_TRN=<trn>`, `VAT_REGISTERED_FROM=<the effective date, YYYY-MM-DD>`,
   leave `VAT_RATE=0.05`.
4. **Enable** `VAT_REGISTERED=true` and redeploy. `assertDeployReady` refuses to boot if the TRN or
   the date is missing — a half-configured VAT state can't reach production.
5. **Verify a test invoice** (Stripe test mode): a UAE customer's invoice shows "Tax Invoice", the
   TRN, and VAT decomposed (284.76 + 14.24 = 299); a non-UAE customer shows 299 with 0% (zero-rated).

## What changes for customers
**Nothing.** Same AED 299, same charge date, same card. The change is invisible to them.

## What changes for the business
- **Net revenue per UAE customer: 299 → 284.76 — a ~5% drop** on the day the switch flips (Prospera
  absorbs the VAT).
- **The COGS model already assumes VAT-inclusive**, so it becomes *accurate* on that day rather than
  before it. Consequence worth stating plainly: **today's real margin is slightly better than
  modelled** — the ~AED 14.24/customer that the model treats as tax is currently retained revenue.
- **Non-UAE customers are zero-rated exports** — 299, no VAT — even with registration on. This is
  already load-bearing in the COGS model and is asserted in code (a non-'AE' country → 0%; an unknown
  country defaults to UAE/taxed, since zero-rating an export needs positive proof of location).
  **Because the unknown-default is UAE/taxed, capturing the country reliably matters:** with VAT on,
  checkout requires a billing address (`billing_address_collection: required`) so the country is
  present on the invoice and export customers are correctly zero-rated rather than silently taxed —
  otherwise the ~5% advantage those accounts carry in the COGS model would erode. While VAT is off,
  an unknown country is harmless (everyone is 299, no tax).

## Dashboard actions only Wabil can perform
**Stripe Tax + price (Task VAT-STRIPE):**
- Enable **Stripe Tax**; register the UAE TRN under Tax settings.
- Set **tax behaviour = inclusive** on the AED 299 price object (or create a new inclusive price and
  repoint checkout). The code never creates or modifies live Stripe prices.
- Confirm Stripe places the required tax-invoice fields (the "Tax Invoice" wording, the VAT line, the
  supplier TRN) once Tax is on.

**Invoice template / branding (from the earlier BILLING-REPORT):**
- Business name **Prospera Technologies FZ-LLC**, the product-of line, logo, colours, support email,
  footer, memo.

## Who supplies which required tax-invoice field
| Required on a UAE tax invoice | Supplied by |
|---|---|
| The words "Tax Invoice" | **Stripe** (Stripe Tax / invoice template) |
| Supplier (Prospera) TRN | **Stripe** Dashboard tax registration (app also stores it in each `invoice_tax` record) |
| VAT shown separately + the rate | **Stripe** (from the inclusive price + Stripe Tax) |
| Sequential invoice numbering | **Stripe** (its invoice numbering — not ours; confirmed) |
| Supply date | **Stripe** (invoice date; app records it as the boundary anchor) |
| **Customer TRN** (business input-tax recovery) | **App** — `tax_id_collection` at checkout, enabled **only when VAT is on** (deliberately off until then) |
| **Customer country** (decides UAE-taxed vs non-UAE zero-rated) | **App** — `billing_address_collection: required` at checkout, enabled with VAT on, so `invoice.customer_address.country` is reliably populated and our frozen record classifies exports correctly (Stripe Tax's `automatic_tax` also forces address capture) |
| Customer name + account traceability | **App** — customer name + `tovira_user_id` metadata (BILLING-REPORT) |

## What the code does now (VAT off)
- Treats every invoice as non-VAT (299 = 299, no tax line), regardless of country.
- Does **not** collect a customer TRN at checkout.
- Still records a frozen `invoice_tax` row per paid invoice (all non-tax today) — so the historical
  boundary is already a property of the data before the switch ever flips.

## Statement
The engineering is complete and reversible-safe: flipping `VAT_REGISTERED` changes only how **new**
invoices are treated, never past ones. **When to flip it is Prospera's compliance decision** — on the
FTA's registration effective date — made with the accountant, not by engineering.
