import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CorpusClient } from './corpusClient.js';

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('CorpusClient.get', () => {
  it('returns the stats on 200', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { months: 14, moments: 2300 }));
    expect(await new CorpusClient('http://api.test').get()).toEqual({ months: 14, moments: 2300 });
    expect(String(fetchMock.mock.calls[0]![0])).toBe('http://api.test/corpus-stats');
  });

  it('returns null on a non-200 or a thrown request', async () => {
    fetchMock.mockResolvedValueOnce(json(401, {}));
    expect(await new CorpusClient().get()).toBeNull();
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    expect(await new CorpusClient().get()).toBeNull();
  });
});
