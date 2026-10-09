/**
 * [P11-ship] The single source of the plan ids and their displayed prices, shared by the Billing page
 * and every SubscribeNow upsell so a price can never drift between two surfaces. The AED amounts are
 * the published subscription prices (VAT-inclusive); they mirror the Stripe prices behind
 * STRIPE_PRICE_ID / STRIPE_ANNUAL_PRICE_ID. `annual.save` is the two-months-free saving (2 × 299 = 598).
 */
export type Plan = 'monthly' | 'annual';

export const PLANS: Record<Plan, { id: Plan; price: string }> & { annual: { save: string } } = {
  monthly: { id: 'monthly', price: 'AED 299 / month' },
  annual: { id: 'annual', price: 'AED 2,990 / year', save: 'save AED 598' },
};
