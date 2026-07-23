import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AccountClient } from './accountClient.js';

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('AccountClient', () => {
  it('exports the rep\'s data on 200', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { clients: [], notes: [] }));
    expect(await new AccountClient('http://api.test').exportData()).toMatchObject({ clients: [] });
    expect(String(fetchMock.mock.calls[0]![0])).toBe('http://api.test/account/export');
  });

  it('returns null export on a non-200 or throw', async () => {
    fetchMock.mockResolvedValueOnce(json(401, {}));
    expect(await new AccountClient().exportData()).toBeNull();
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    expect(await new AccountClient().exportData()).toBeNull();
  });

  it('deletes the account (DELETE) and reports success/failure', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { ok: true }));
    expect(await new AccountClient('http://api.test').deleteAccount()).toBe(true);
    expect((fetchMock.mock.calls[0]![1] as RequestInit).method).toBe('DELETE');
    fetchMock.mockResolvedValueOnce(json(500, {}));
    expect(await new AccountClient().deleteAccount()).toBe(false);
  });
});
