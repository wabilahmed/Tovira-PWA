import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PaymentBanner } from './PaymentBanner.js';
import type { Entitlement } from './billingClient.js';

const ent = (over: Partial<Entitlement>): Entitlement => ({ entitled: true, status: 'active', trialEndsAt: 0, ...over });

describe('<PaymentBanner> (BILLING-DUNNING · D3/D4/D5/D7)', () => {
  it('shows nothing when active or unknown', () => {
    render(<PaymentBanner ent={ent({ billingState: 'active' })} />);
    render(<PaymentBanner ent={null} />);
    expect(screen.queryByTestId('payment-banner')).toBeNull();
  });

  it('[AUDIT] styles the banner from tokens, no raw hex (contrast holds in dark mode)', () => {
    render(<PaymentBanner ent={ent({ status: 'payment_failed', billingState: 'payment_failed', hostedInvoiceUrl: 'https://pay.stripe.test/in_1' })} />);
    const style = screen.getByTestId('payment-banner').getAttribute('style') ?? '';
    expect(style).not.toMatch(/#[0-9a-f]{3,6}/i);          // no raw hex (was #fff and a #8a5a00 fallback)
    expect(style).toMatch(/background:\s*var\(--amber\)/); // theme token, no hardcoded fallback
    expect(style).toMatch(/color:\s*var\(--brass-ink\)/);  // ink that contrasts with amber in both themes
  });

  it('payment_failed: lists a paused feature and links to the hosted payment page', () => {
    render(<PaymentBanner ent={ent({ status: 'payment_failed', billingState: 'payment_failed', hostedInvoiceUrl: 'https://pay.stripe.test/in_1' })} />);
    const b = screen.getByTestId('payment-banner');
    expect(b).toHaveTextContent(/pre-meeting briefs/); // a D3 paused feature
    expect(b).toHaveTextContent(/export/i); // everything else keeps working
    expect(screen.getByRole('link', { name: /update your payment details/i })).toHaveAttribute('href', 'https://pay.stripe.test/in_1');
  });

  it('suspended: still offers payment + export, points at the pay page', () => {
    render(<PaymentBanner ent={ent({ status: 'suspended', billingState: 'suspended', hostedInvoiceUrl: 'https://pay.stripe.test/in_1' })} />);
    expect(screen.getByTestId('payment-banner')).toHaveTextContent(/suspended.*export your data/i);
  });

  it('ended: points at hello@tovira.io to restore', () => {
    render(<PaymentBanner ent={ent({ status: 'ended', billingState: 'ended' })} />);
    expect(screen.getByRole('link', { name: 'hello@tovira.io' })).toHaveAttribute('href', 'mailto:hello@tovira.io');
  });
});
