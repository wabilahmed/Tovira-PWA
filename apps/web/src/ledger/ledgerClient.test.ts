import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LedgerClient } from './ledgerClient.js';

const fetchMock = vi.fn();
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); });
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('LedgerClient', () => {
  it('gets the summary on 200', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { totalTouched: 1, byType: { promise_kept: 1, thread_reopened: 0, brief_before_meeting: 0 }, aed: null, items: [] }));
    const s = await new LedgerClient('http://api.test').summary();
    expect(s?.totalTouched).toBe(1);
    expect(String(fetchMock.mock.calls[0]![0])).toBe('http://api.test/ledger');
  });

  it('returns null summary on non-200 or throw', async () => {
    fetchMock.mockResolvedValueOnce(json(401, {}));
    expect(await new LedgerClient().summary()).toBeNull();
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    expect(await new LedgerClient().summary()).toBeNull();
  });

  it('POSTs a deal value and reports success/failure', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { ok: true }));
    expect(await new LedgerClient('http://api.test').setDealValue('c1', 500000)).toBe(true);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe('http://api.test/clients/c1/deal-value');
    expect((init as RequestInit).body).toBe(JSON.stringify({ aed: 500000 }));
    fetchMock.mockResolvedValueOnce(json(400, {}));
    expect(await new LedgerClient().setDealValue('c1', -1)).toBe(false);
  });
});
