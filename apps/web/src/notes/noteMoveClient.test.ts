import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NoteMoveClient } from './noteMoveClient.js';

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const SUGGESTION = { noteId: 'n1', fromClientId: 'c1', toClientId: 'c2', toClientName: 'Meridian', mentioned: ['Meridian'], reason: 'mentions another client' };
const COUNTS = { messages: 4, promises: 2, keyDates: 1, meetings: 1, people: 2, requirements: 1 };

describe('NoteMoveClient', () => {
  it('reads move suggestions from the /confirmations payload', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { promises: [], meetings: [], moveSuggestions: [SUGGESTION] }));
    const list = await new NoteMoveClient('http://api.test').listMoveSuggestions();
    expect(list).toEqual([SUGGESTION]);
    expect(String(fetchMock.mock.calls[0]![0])).toBe('http://api.test/confirmations');
  });

  it('returns [] when /confirmations omits moveSuggestions or errors', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { promises: [] }));
    expect(await new NoteMoveClient().listMoveSuggestions()).toEqual([]);
    fetchMock.mockResolvedValueOnce(json(401, {}));
    expect(await new NoteMoveClient().listMoveSuggestions()).toEqual([]);
  });

  it('previews what a move carries (GET /notes/:id/move-preview)', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { noteId: 'n1', fromClientId: 'c1', counts: COUNTS }));
    const preview = await new NoteMoveClient('http://api.test').preview('n1');
    expect(preview?.counts).toEqual(COUNTS);
    expect(String(fetchMock.mock.calls[0]![0])).toBe('http://api.test/notes/n1/move-preview');
  });

  it('moves a note (POST /notes/:id/move {toClientId})', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { ok: true, counts: COUNTS }));
    const result = await new NoteMoveClient('http://api.test').move('n1', 'c2');
    expect(result).toEqual({ ok: true, counts: COUNTS });
    expect(String(fetchMock.mock.calls[0]![0])).toBe('http://api.test/notes/n1/move');
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ toClientId: 'c2' });
  });

  it('returns null when a move 409s/404s or throws', async () => {
    fetchMock.mockResolvedValueOnce(json(409, { error: 'same_client' }));
    expect(await new NoteMoveClient().move('n1', 'c1')).toBeNull();
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    expect(await new NoteMoveClient().move('n1', 'c2')).toBeNull();
  });

  it('[NOTE-MOVE] undo is a REVERSE move, never /notes/:id/undo (which would delete the note)', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { ok: true, counts: COUNTS }));
    await new NoteMoveClient('http://api.test').undo('n1', 'c1');
    // moved back to the ORIGINAL client — restore, not destroy
    expect(String(fetchMock.mock.calls[0]![0])).toBe('http://api.test/notes/n1/move');
    expect(JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string)).toEqual({ toClientId: 'c1' });
    // crucially, nothing hit the destructive import-undo route
    expect(fetchMock.mock.calls.some((c) => String(c[0]).endsWith('/undo'))).toBe(false);
  });
});
