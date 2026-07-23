import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BillingClient } from './billingClient.js';

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('BillingClient', () => {
  it('reads the entitlement status on 200', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { entitled: true, status: 'trialing', trialEndsAt: 123 }));
    const s = await new BillingClient('http://api.test').status();
    expect(s).toMatchObject({ status: 'trialing', entitled: true });
    expect(String(fetchMock.mock.calls[0]![0])).toBe('http://api.test/billing/status');
  });

  it('returns null status on a non-200 or throw', async () => {
    fetchMock.mockResolvedValueOnce(json(401, {}));
    expect(await new BillingClient().status()).toBeNull();
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    expect(await new BillingClient().status()).toBeNull();
  });

  it('starts checkout and returns the URL (POST)', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { url: 'https://checkout.stripe.test/abc' }));
    expect(await new BillingClient('http://api.test').checkout()).toBe('https://checkout.stripe.test/abc');
    expect((fetchMock.mock.calls[0]![1] as RequestInit).method).toBe('POST');
  });

  it('returns null checkout URL on failure', async () => {
    fetchMock.mockResolvedValueOnce(json(500, {}));
    expect(await new BillingClient().checkout()).toBeNull();
  });
});
