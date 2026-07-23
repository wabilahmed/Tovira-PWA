import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PushClient } from './pushClient.js';

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const SUB = { endpoint: 'https://push.test/abc', keys: { p256dh: 'k', auth: 'a' } };

describe('PushClient', () => {
  it('saves a subscription (POST /push/subscribe → 201)', async () => {
    fetchMock.mockResolvedValueOnce(json(201, { ok: true }));
    expect(await new PushClient('http://api.test').saveSubscription(SUB)).toBe(true);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe('http://api.test/push/subscribe');
    expect((init as RequestInit).body).toBe(JSON.stringify(SUB));
  });

  it('returns false when save is rejected (400) or throws', async () => {
    fetchMock.mockResolvedValueOnce(json(400, {}));
    expect(await new PushClient().saveSubscription({})).toBe(false);
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    expect(await new PushClient().saveSubscription(SUB)).toBe(false);
  });

  it('sends a test and returns the delivered count', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { sent: 2 }));
    expect(await new PushClient('http://api.test').sendTest()).toBe(2);
    expect((fetchMock.mock.calls[0]![1] as RequestInit).method).toBe('POST');
  });

  it('returns 0 delivered on failure', async () => {
    fetchMock.mockResolvedValueOnce(json(500, {}));
    expect(await new PushClient().sendTest()).toBe(0);
  });
});
