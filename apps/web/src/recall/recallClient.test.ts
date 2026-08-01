import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RecallClient } from './recallClient.js';

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('RecallClient.ask', () => {
  it('POSTs the question and returns the answer + receipts', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { answer: 'Ahmed said pricing is high.', receipts: [{ quote: 'pricing is too high', date: '2026-01-16', clientId: 'c1', noteId: 'n1' }] }));
    const r = await new RecallClient('http://api.test').ask('what did Ahmed say?');
    expect(r?.receipts).toHaveLength(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe('http://api.test/recall');
    expect((init as RequestInit).method).toBe('POST');
    expect((init as RequestInit).body).toBe(JSON.stringify({ question: 'what did Ahmed say?' }));
  });

  it('returns null on a non-200 or a thrown request', async () => {
    fetchMock.mockResolvedValueOnce(json(400, {}));
    expect(await new RecallClient().ask('x')).toBeNull();
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    expect(await new RecallClient().ask('x')).toBeNull();
  });
});
