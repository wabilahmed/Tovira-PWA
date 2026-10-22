import type { AllowanceStatus, TopUpChoice } from './allowanceClient.js';

/**
 * [P37] One place for the usage copy, shared by Settings → Subscription, the Today banner and the tour, so they
 * never disagree. Prices and percentages come from the server's config (the options), never from this file.
 */

/** "AED 50: +50% of your monthly allowance" — no AED-of-AI-cost figures. */
export function packLabel(o: TopUpChoice): string {
  return `AED ${o.priceAed}: ${o.label} of your monthly allowance`;
}

/** What the 100% message offers, from the real subscription state. */
export type ExhaustedAction = 'buy' | 'subscribe' | 'update_card';
export function exhaustedAction(s: Pick<AllowanceStatus, 'canTopUp' | 'subscription'>): ExhaustedAction {
  if (s.canTopUp) return 'buy';
  if (s.subscription === 'payment_failed' || s.subscription === 'past_due' || s.subscription === 'suspended') return 'update_card';
  return 'subscribe';
}

/** The 100% message — what stops and what keeps working, as the server actually behaves: imports, voice notes
 *  and note analysis pause; the book, Find (no AI, no allowance), briefs already made and data export keep
 *  working. [P39-7] Ask is gone, so it is no longer named. */
export function exhaustedMessage(s: Pick<AllowanceStatus, 'canTopUp' | 'subscription'>, resetWord: string): string {
  switch (exhaustedAction(s)) {
    case 'subscribe':
      return s.subscription === 'trialing'
        ? "You've used this trial's allowance. Subscribe to keep going."
        : 'Your plan has ended. Subscribe to keep going.';
    case 'update_card':
      return 'Your last payment failed, so AI is paused. Update your card to keep going.';
    default:
      return `AI features are paused until ${resetWord}. Your book, Find, briefs already made and exporting your data still work. Buy more usage to keep going now.`;
  }
}

/** The 80 / 95% line. */
export function warnMessage(percent: number): string {
  return `You've used ${percent}% of this month's AI usage.`;
}

/** "Extra usage: +80% left (never expires)". */
export function extraLine(extraPercentLeft: number): string {
  return `Extra usage: +${extraPercentLeft}% left (never expires)`;
}
