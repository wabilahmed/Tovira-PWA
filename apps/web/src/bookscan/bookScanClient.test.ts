import { describe, it, expect, vi, afterEach } from 'vitest';
import { BookScanClient } from './bookScanClient.js';

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status < 400, status, json: async () => body } as unknown as Response;
}

const REPORT = {
  items: [
    {
      kind: 'unanswered_question',
      clientId: 'c1',
      clientName: 'Sara Lee',
      headline: 'Sara Lee asked something and the thread went quiet',
      receipt: { quote: 'Can you do bulk pricing?', date: '2026-01-16T10:00:00' },
      framing: 'worth_checking',
    },
  ],
  isEmpty: false,
  message: null,
  invitation: 'Export your next chat.',
};

afterEach(() => vi.unstubAllGlobals());

describe('BookScanClient.scan', () => {
  it('GETs /book-scan with the session cookie and returns the report', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, REPORT));
    vi.stubGlobal('fetch', fetchMock);

    const result = await new BookScanClient().scan();
    expect(result).toEqual(REPORT);
    expect(fetchMock).toHaveBeenCalledWith('/book-scan', { credentials: 'include' });
  });

  it('returns null on a non-200', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(401, {})));
    expect(await new BookScanClient().scan()).toBeNull();
  });

  it('returns null when the request throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    expect(await new BookScanClient().scan()).toBeNull();
  });
});
