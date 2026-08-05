import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BillingClient } from './billingClient.js';

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('BillingClient.incentive (P5-1-UI)', () => {
  it('GETs the server-computed incentive', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { state: 'progress', distinctClients: 2, needed: 3, remaining: 1, extensionDays: 7, trialEndsAt: 123 }));
    const inc = await new BillingClient('http://api.test').incentive();
    expect(inc).toMatchObject({ state: 'progress', remaining: 1 });
    expect(String(fetchMock.mock.calls[0]![0])).toBe('http://api.test/billing/incentive');
  });

  it('falls back to a hidden state on a non-200 (never guesses eligibility)', async () => {
    fetchMock.mockResolvedValueOnce(json(401, {}));
    expect((await new BillingClient().incentive()).state).toBe('hidden');
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    expect((await new BillingClient().incentive()).state).toBe('hidden');
  });
});
