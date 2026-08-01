import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ShareCardClient } from './shareCardClient.js';

const fetchMock = vi.fn();
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); });
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('ShareCardClient.get', () => {
  it('returns the stats on 200', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { openPromises: 7, unansweredQuestions: 3, goingCold: 2, upcomingDates: 0, total: 12 }));
    const c = await new ShareCardClient('http://api.test').get();
    expect(c?.openPromises).toBe(7);
    expect(String(fetchMock.mock.calls[0]![0])).toBe('http://api.test/share-card');
  });

  it('returns null on non-200 or throw', async () => {
    fetchMock.mockResolvedValueOnce(json(401, {}));
    expect(await new ShareCardClient().get()).toBeNull();
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    expect(await new ShareCardClient().get()).toBeNull();
  });
});
