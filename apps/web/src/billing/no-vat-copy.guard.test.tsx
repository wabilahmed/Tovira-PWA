import { describe, it, expect, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Billing, type BillingApi } from './Billing.js';
import { SubscribeNow } from './SubscribeUpsell.js';
import { UsageMeter, type UsageMeterApi } from '../usage/UsageMeter.js';
import type { Entitlement } from './billingClient.js';
import type { AllowanceStatus } from '../usage/allowanceClient.js';
import { manifest } from '../pwa/manifest.js';

/**
 * [P32] Prospera Technologies FZ-LLC is NOT VAT-registered, so no rep-facing surface may say a price includes
 * VAT (or mention VAT / TRN at all) while the app's VAT switch is off — which is the only state the web app
 * knows. Renders the landing page, the PWA manifest, Settings → Billing (every state), the top-up picker and
 * the subscribe upsell, and fails on: "VAT", "incl." next to a price, "inclusive", "TRN", or the Arabic VAT
 * words. Prices are unchanged: AED 299 / month, AED 2,990 / year, and the top-ups.
 */
const FORBIDDEN: Array<[string, RegExp]> = [
  ['VAT', /\bVAT\b/i],
  ['incl. next to a price', /AED\s*[\d,.]+[^.\n]{0,24}\bincl\b|\bincl\b[^.\n]{0,24}AED\s*[\d,.]+/i],
  ['inclusive', /inclusive/i],
  ['TRN', /\bTRN\b/],
  ['Arabic VAT words', /ضريبة|القيمة المضافة/],
];
const offences = (text: string) => FORBIDDEN.filter(([, re]) => re.test(text)).map(([name]) => name);

const NOW = Date.parse('2026-07-15T00:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const billingApi = (status: Entitlement | null): BillingApi => ({ status: vi.fn().mockResolvedValue(status), checkout: vi.fn().mockResolvedValue(null), portal: vi.fn().mockResolvedValue(null) });
const OPTIONS = [15, 25, 50, 75, 100].map((pct, i) => ({ id: `topup_${pct}`, label: `+${pct}%`, priceAed: [50, 65, 85, 100, 120][i]! }));
const allowance = (over: Partial<AllowanceStatus>): AllowanceStatus => ({ percentUsed: 40, exhausted: false, resetAt: '2026-11-01T00:00:00.000Z', canTopUp: true, options: OPTIONS, ...over });
const usageApi = (s: AllowanceStatus): UsageMeterApi => ({ status: vi.fn().mockResolvedValue(s), topUp: vi.fn().mockResolvedValue(null) });

describe('[P32] no VAT wording on rep-facing surfaces (VAT switch off)', () => {
  it('the landing page — visible text, meta and share descriptions — never mentions VAT', () => {
    const html = readFileSync(resolve(process.cwd(), 'apps/web/index.html'), 'utf8');
    const d = new DOMParser().parseFromString(html, 'text/html');
    const metas = [...d.querySelectorAll('meta[content]')].map((m) => m.getAttribute('content') ?? '').join('\n');
    const text = `${d.body.textContent ?? ''}\n${metas}\n${d.title}`;
    expect(text).toMatch(/AED 299/);
    expect(text).toMatch(/AED 2,990/);
    expect(offences(text)).toEqual([]);
  });

  it('the PWA manifest never mentions VAT', () => {
    expect(offences(JSON.stringify(manifest))).toEqual([]);
  });

  it('Settings → Billing, in every state, never mentions VAT', async () => {
    const states: Array<Entitlement | null> = [
      { entitled: true, status: 'trialing', trialEndsAt: NOW + 3 * DAY },
      { entitled: false, status: 'none', trialEndsAt: NOW - DAY },
      { entitled: true, status: 'active', trialEndsAt: 0, renewsAt: NOW + 30 * DAY },
      { entitled: false, status: 'canceled', trialEndsAt: 0 },
    ];
    for (const s of states) {
      const { container } = render(<Billing api={billingApi(s)} now={NOW} />);
      await screen.findAllByText(/./);
      await new Promise((r) => setTimeout(r, 0));
      expect(offences(container.textContent ?? ''), `Billing (${s?.status})`).toEqual([]);
      cleanup();
    }
  });

  it('the top-up picker and the subscribe upsell never mention VAT', async () => {
    for (const s of [allowance({}), allowance({ percentUsed: 100, exhausted: true }), allowance({ canTopUp: false })]) {
      const { container } = render(<UsageMeter api={usageApi(s)} />);
      await screen.findAllByText(/./);
      await new Promise((r) => setTimeout(r, 0));
      expect(offences(container.textContent ?? '')).toEqual([]);
      cleanup();
    }
    const { container } = render(<SubscribeNow onSubscribe={vi.fn()} />);
    expect(offences(container.textContent ?? '')).toEqual([]);
  });

  it('the guard itself catches the old wording (so it can fail)', () => {
    expect(offences('Prices include VAT.')).toEqual(['VAT']);
    expect(offences('AED 299/month incl. VAT')).toEqual(['VAT', 'incl. next to a price']);
    expect(offences('Prices are VAT-inclusive')).toEqual(['VAT', 'inclusive']);
    expect(offences('Our TRN is 100…')).toEqual(['TRN']);
    expect(offences('شامل ضريبة القيمة المضافة')).toEqual(['Arabic VAT words']);
    expect(offences('AED 299 / month · AED 2,990 / year')).toEqual([]);
  });
});
