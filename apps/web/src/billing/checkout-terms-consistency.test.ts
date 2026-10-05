import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * [TASK 3] The checkout disclosure tells the rep: cancel anytime from Billing, access continues until the
 * end of the paid period. That must match what actually happens (the Stripe Customer Portal cancels at
 * period end) AND the committed Terms. This guard ties the disclosure to Terms 6.5 so the three can never
 * drift apart silently.
 */
const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('[TASK 3] the Terms cancellation clause matches the real cancellation behaviour', () => {
  const terms = read('../../terms/index.html');
  const billing = read('./Billing.tsx');

  it('Terms 6.5 says cancel from your account + access to the end of the paid period', () => {
    expect(terms).toMatch(/cancel at any time from your account/i);
    expect(terms).toMatch(/Access continues until the end of the period you have paid for/i);
  });

  it('the disclosure claims the same thing (cancel from Billing, access to period end)', () => {
    expect(billing).toMatch(/cancel anytime from Billing/i);
    expect(billing).toMatch(/until the end of the period you have paid for/i);
  });
});
