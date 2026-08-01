import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MondayClient } from './mondayClient.js';

const fetchMock = vi.fn();
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); });
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('MondayClient.get', () => {
  it('returns the digest on 200', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { weekOf: '2026-08-03', isLight: true, promisesDue: [], coolingClients: [], unansweredQuestions: [], upcomingDates: [] }));
    const d = await new MondayClient('http://api.test').get();
    expect(d?.isLight).toBe(true);
    expect(String(fetchMock.mock.calls[0]![0])).toBe('http://api.test/monday-digest');
  });

  it('returns null on non-200 or throw', async () => {
    fetchMock.mockResolvedValueOnce(json(401, {}));
    expect(await new MondayClient().get()).toBeNull();
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    expect(await new MondayClient().get()).toBeNull();
  });
});
