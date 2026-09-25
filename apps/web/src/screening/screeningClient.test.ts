import { describe, it, expect, vi, afterEach } from 'vitest';
import { ScreeningClient } from './screeningClient.js';

const okJson = (body: unknown) => Promise.resolve({ status: 200, json: () => Promise.resolve(body) } as Response);

afterEach(() => vi.restoreAllMocks());

describe('ScreeningClient', () => {
  it('flags() GETs /notes/:id/flags and returns the grouped review', async () => {
    const data = { held: 1, groups: [{ category: 'health', count: 1, spans: [{ span: 'hospital', count: 1, messages: [{ index: 0, sender: 'Client', sentAt: 't', body: 'in hospital' }] }] }] };
    const fetchMock = vi.fn(() => okJson(data));
    vi.stubGlobal('fetch', fetchMock);
    const out = await new ScreeningClient('/api').flags('n1');
    expect(fetchMock).toHaveBeenCalledWith('/api/notes/n1/flags', { credentials: 'include' });
    expect(out).toEqual(data);
  });

  it('restore() POSTs the selector as JSON and returns the outcome', async () => {
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) => okJson({ restored: 2, status: 'pending_extraction' }));
    vi.stubGlobal('fetch', fetchMock);
    const out = await new ScreeningClient('/api').restore('n1', { category: 'political_opinion', span: 'party' });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/notes/n1/restore');
    expect(init!.method).toBe('POST');
    expect(JSON.parse(init!.body as string)).toEqual({ category: 'political_opinion', span: 'party' });
    expect(out).toEqual({ restored: 2, status: 'pending_extraction' });
  });

  it('held() GETs /notes/held and returns the notes list', async () => {
    const notes = [{ noteId: 'n1', clientId: 'c1', held: 3 }];
    const fetchMock = vi.fn(() => okJson({ notes }));
    vi.stubGlobal('fetch', fetchMock);
    const out = await new ScreeningClient('/api').held();
    expect(fetchMock).toHaveBeenCalledWith('/api/notes/held', { credentials: 'include' });
    expect(out).toEqual(notes);
  });

  it('returns null on a non-200 or a network error', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ status: 404 } as Response)));
    expect(await new ScreeningClient().flags('n1')).toBeNull();
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))));
    expect(await new ScreeningClient().restore('n1', { index: 0 })).toBeNull();
  });
});
