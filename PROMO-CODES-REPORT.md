# Bulk discount codes — `feat(PROMO-CODES)`

## What shipped (the app's small part)

One line: `allow_promotion_codes: true` on the Checkout session. Stripe-hosted Checkout now shows an
"Add promotion code" field, and **Stripe enforces everything** — validity, expiry, `max_redemptions`,
and `duration: forever`. The app never accepts or forwards a code, so:

- An invalid / expired / exhausted code is rejected inline by Stripe; the rep still subscribes at full
  price. **Nothing in our code can block the purchase** (we pass no code, so session creation can't
  400 on one).
- The discount lands in the invoice **total** (post-discount). Our webhook already reads `invoice.total`
  (not `subtotal`), and the VAT decomposition already runs on that total — so **VAT decomposes from the
  discounted amount automatically**, on every renewal. No local discount tracking, nothing to drift.

Tested: `allow_promotion_codes` is set and no discount is forwarded; the webhook reads the discounted
total (16744, not the 29900 subtotal); VAT decomposes from the discounted total (797 VAT / 15947 net,
not the list 1424 / 28476); the decomposition is identical across renewal invoices (duration:forever);
and a discounted `invoice.payment_succeeded` records the discounted treatment end-to-end.

**Why `allow_promotion_codes` over a pass-through `discounts: [{ promotion_code }]` field:** the
hosted field means Stripe owns validation and enforcement; a pass-through would make us look the code
up, handle its errors, and risk a 400 that blocks an otherwise-valid checkout. Less code, less risk,
and it can never block a full-price purchase.

---

## For Wabil

### Create a 10-redemption, forever coupon (Stripe Dashboard)

1. **Product catalog → Coupons → New coupon.**
2. Discount: **Percent off** (e.g. 20%) — or amount off. **Duration: Forever** (so it holds on every
   renewal).
3. Create the coupon.
4. On the coupon, **Create promotion code** — this is the customer-facing code:
   - **Code:** a memorable string, e.g. `ACME2026`.
   - **Max redemptions:** `10` (Stripe stops accepting it after the 10th rep — you never count).
   - Optional: an expiry date, and "first-time order only" off (renewals must keep it).
5. Share the code with the company. Each rep enters it in the "Add promotion code" field at checkout;
   Stripe enforces the cap and the forever duration. One coupon, one code, N redemptions.

### The margin floor — the wall for a negotiation

COGS ≈ **AED 48/rep**. Gross margin must stay **≥ 70%**, which needs net revenue ≥ **~AED 160**. On the
conservative **net-of-VAT** basis (price ÷ 1.05, so the floor still holds once VAT is switched on):

| Discount | Price (AED, VAT-incl.) | Net revenue | Gross margin |
|---|---|---|---|
| 0% | 299.00 | 284.76 | **83.1%** |
| 10% | 269.10 | 256.29 | **81.3%** |
| 20% | 239.20 | 227.81 | **78.9%** |
| 30% | 209.30 | 199.33 | **75.9%** |
| **44%** | **167.44** | **159.47** | **69.9%** ← floor |

**~44% off (≈ AED 168) is the wall.** Past it, gross margin drops under 70%. (VAT is off today, which
gives a hair more headroom — ~46% — but quote the net-basis 44% so the floor survives registration.)

### Interaction with the AED 45 spend cap — recommendation, your decision

The AED 45/rep/period extraction cap is **flat** — it doesn't know what the rep paid. A deeply
discounted rep (net ~AED 160) who runs all the way to the cap has a thinner cushion than a full-price
rep: their worst-case period margin is squeezed from both sides (lower revenue, same cost ceiling).

**Recommendation (not a decision):** **keep the cap flat** for now. It's a rarely-hit failsafe, not a
typical cost; scaling it per paid-price adds billing complexity for an edge that may never bite. But
**revisit if** bulk-discount deals become common *and* capped reps are frequent in the same cohort —
at which point a cap that scales with the paid price (or a per-deal cap) would protect the floor. This
is yours to call; the code change would be small either way.

### Positioning — a decision, not a drift

The landing page says *"One price. Everything included. No tiers, no add-ons, no seats to count."* A
**private code negotiated with a company does not contradict that publicly** — the list price and the
public promise are unchanged; the discount is invisible on the site and never presented as a tier.

But it **is** a de-facto volume arrangement. Stated plainly so it's a choice: this stays a **private,
negotiated** instrument. If it ever becomes a **published** volume/seat discount on the site, *that*
would contradict the one-price positioning — so the line to hold is "private deal, yes; public tier,
no." Flagging it so the call is made on purpose.
