import { useState } from 'react';
import type { AllowanceStatus, CheckoutResult } from './allowanceClient.js';
import { CHOOSE_OWN } from './usageCopy.js';
import { customCheck, customPriceFils, formatAed, packPriceLabel } from './purchaseCopy.js';

/**
 * [P83 · owner, 21 Nov] The purchase screen (Settings → Subscription): the three packs at their prices, and "Choose your
 * own amount", priced live as the rep types. A fixed pack or a custom amount each opens a one-off Stripe checkout; the
 * messages are added once Stripe confirms the payment.
 */
export function PurchaseMessages({ options, custom, busy, onBuy, onBuyCustom }: {
  options: AllowanceStatus['options'];
  custom: AllowanceStatus['custom'];
  busy: string | null;
  onBuy: (id: string) => void;
  onBuyCustom: (messages: number) => Promise<CheckoutResult>;
}): JSX.Element {
  const [raw, setRaw] = useState('');
  const [serverError, setServerError] = useState<string | null>(null);
  const n = raw.trim() === '' ? Number.NaN : Number(raw.replace(/,/g, ''));
  const check = custom && raw.trim() !== '' ? customCheck(n, custom) : null;
  const error = serverError ?? (check && !check.ok ? check.message : null);
  const valid = check?.ok === true;

  async function buyCustom(): Promise<void> {
    if (!valid) return;
    setServerError(null);
    const r = await onBuyCustom(n);
    if ('error' in r) setServerError(r.error);
  }

  return (
    <div data-testid="topup-sheet" style={{ display: 'grid', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
      {options.map((o) => (
        <button key={o.id} type="button" data-testid={`topup-${o.id}`} disabled={busy !== null} onClick={() => onBuy(o.id)}>
          {packPriceLabel(o)}
        </button>
      ))}
      {custom && (
        <div data-testid="custom-pack" style={{ display: 'grid', gap: 'var(--space-1)' }}>
          <strong>{CHOOSE_OWN}</strong>
          <label>
            How many messages?
            <input
              type="number"
              inputMode="numeric"
              min={custom.min}
              max={custom.max}
              step={custom.step}
              value={raw}
              onChange={(e) => { setRaw(e.target.value); setServerError(null); }}
              style={{ display: 'block', width: '100%' }}
            />
          </label>
          {valid && !serverError && <p data-testid="custom-price" style={{ margin: 0 }}>{formatAed(customPriceFils(n, custom))}</p>}
          {error && <p data-testid="custom-error" role="alert" style={{ margin: 0, color: 'var(--claret)' }}>{error}</p>}
          <button type="button" data-testid="custom-buy" className="tov-primary" disabled={!valid || busy !== null} onClick={() => void buyCustom()}>
            Buy
          </button>
        </div>
      )}
    </div>
  );
}
