import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MeetingsClient } from './meetingsClient.js';

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const MEETING = { id: 'm1', clientId: 'c1', datetime: '2026-08-01T15:00', datetimeRaw: 'Tue 3pm', title: 'Review', confirmed: true, createdAt: 1 };

describe('MeetingsClient', () => {
  it('lists meetings on 200 and [] otherwise', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { meetings: [MEETING] }));
    expect(await new MeetingsClient('http://api.test').list()).toHaveLength(1);
    expect(String(fetchMock.mock.calls[0]![0])).toBe('http://api.test/meetings');
    fetchMock.mockResolvedValueOnce(json(500, {}));
    expect(await new MeetingsClient().list()).toEqual([]);
  });

  it('parses natural language, returning a preview (200) or null (non-200)', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { clientId: 'c1', datetime: '2026-08-01T15:00', datetimeRaw: 'Tue 3pm', title: null }));
    const parsed = await new MeetingsClient('http://api.test').parse('meeting with Acme Tue 3pm');
    expect(parsed).toMatchObject({ datetimeRaw: 'Tue 3pm' });
    expect((fetchMock.mock.calls[0]![1] as RequestInit).method).toBe('POST');
    fetchMock.mockResolvedValueOnce(json(422, {}));
    expect(await new MeetingsClient().parse('gibberish')).toBeNull();
  });

  it('creates a meeting for a client (201) and returns null on failure', async () => {
    fetchMock.mockResolvedValueOnce(json(201, MEETING));
    const m = await new MeetingsClient('http://api.test').createForClient('c1', { datetime: '2026-08-01T15:00', datetimeRaw: 'Tue 3pm', title: 'Review' });
    expect(m).toMatchObject({ id: 'm1' });
    expect(String(fetchMock.mock.calls[0]![0])).toBe('http://api.test/clients/c1/meetings');
    fetchMock.mockResolvedValueOnce(json(400, {}));
    expect(await new MeetingsClient().createForClient('c1', { datetime: null, datetimeRaw: 'x', title: null })).toBeNull();
  });

  it('removes a meeting (DELETE) and reports success/failure', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { ok: true }));
    expect(await new MeetingsClient('http://api.test').remove('m1')).toBe(true);
    expect((fetchMock.mock.calls[0]![1] as RequestInit).method).toBe('DELETE');
    fetchMock.mockResolvedValueOnce(json(404, {}));
    expect(await new MeetingsClient().remove('nope')).toBe(false);
  });
});
