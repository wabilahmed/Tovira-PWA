import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ClientsClient } from './clientsClient.js';

describe('ClientsClient', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  it('lists the rep\'s clients', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { clients: [{ id: '1', name: 'Meridian Corp', createdAt: 1 }] }));
    const client = new ClientsClient('http://api.test');
    const list = await client.list();
    expect(list).toHaveLength(1);
    expect(list[0]!.name).toBe('Meridian Corp');
    expect((fetchMock.mock.calls[0]![1] as RequestInit).credentials).toBe('include');
  });

  it('creates a client and returns it', async () => {
    fetchMock.mockResolvedValueOnce(json(201, { id: '2', name: 'Acme', createdAt: 2 }));
    const client = new ClientsClient('http://api.test');
    const created = await client.create('Acme');
    expect(created.name).toBe('Acme');
    const [, init] = fetchMock.mock.calls[0]!;
    expect((init as RequestInit).method).toBe('POST');
    expect((init as RequestInit).credentials).toBe('include');
  });

  it('creates a pasted note under a client', async () => {
    fetchMock.mockResolvedValueOnce(json(201, { id: 'n1', source: 'paste', rawText: 'hi', status: 'pending_extraction', createdAt: 1 }));
    const client = new ClientsClient('http://api.test');
    const note = await client.createPasteNote('c1', 'hi');
    expect(note.source).toBe('paste');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe('http://api.test/clients/c1/notes/paste');
    expect((init as RequestInit).method).toBe('POST');
  });

  it('throws when a paste is rejected', async () => {
    fetchMock.mockResolvedValueOnce(json(400, { error: 'validation', message: 'A message is required.' }));
    const client = new ClientsClient('http://api.test');
    await expect(client.createPasteNote('c1', '')).rejects.toThrow(/required/i);
  });

  it('passes a search query to the server', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { clients: [] }));
    const client = new ClientsClient('http://api.test');
    await client.list('meri');
    expect(String(fetchMock.mock.calls[0]![0])).toContain('q=meri');
  });

  // NEGATIVE: a rejected create surfaces the server's validation message.
  it('throws with the server message when create is rejected (empty name)', async () => {
    fetchMock.mockResolvedValueOnce(json(400, { error: 'validation', message: 'A client name is required.' }));
    const client = new ClientsClient('http://api.test');
    await expect(client.create('')).rejects.toThrow(/name is required/i);
  });

  // --- WhatsApp import (P1-4b) ---
  it('imports a WhatsApp export: POSTs content + consent, returns the imported count', async () => {
    fetchMock.mockResolvedValueOnce(json(201, { imported: 4, note: {} }));
    const client = new ClientsClient('http://api.test');
    const r = await client.importWhatsApp('c1', 'chat', true);
    expect(r).toEqual({ ok: true, imported: 4 });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe('http://api.test/clients/c1/notes/import');
    expect((init as RequestInit).method).toBe('POST');
    expect((init as RequestInit).body).toBe(JSON.stringify({ content: 'chat', consent: true }));
  });

  it('maps 400 → consent error', async () => {
    fetchMock.mockResolvedValueOnce(json(400, { error: 'consent_required' }));
    const r = await new ClientsClient('http://api.test').importWhatsApp('c1', 'chat', false);
    expect(r).toMatchObject({ ok: false, error: 'consent' });
  });

  it('maps 422 → not_whatsapp, carrying the server reason', async () => {
    fetchMock.mockResolvedValueOnce(json(422, { reason: "This doesn't look like a WhatsApp export." }));
    const r = await new ClientsClient('http://api.test').importWhatsApp('c1', 'junk', true);
    expect(r).toMatchObject({ ok: false, error: 'not_whatsapp' });
    if (!r.ok) expect(r.message).toMatch(/whatsapp/i);
  });

  it('maps 413 → too_large and 404 → not_found', async () => {
    fetchMock.mockResolvedValueOnce(json(413, {}));
    expect(await new ClientsClient('http://api.test').importWhatsApp('c1', 'x', true)).toMatchObject({ ok: false, error: 'too_large' });
    fetchMock.mockResolvedValueOnce(json(404, {}));
    expect(await new ClientsClient('http://api.test').importWhatsApp('c1', 'x', true)).toMatchObject({ ok: false, error: 'not_found' });
  });

  it('maps a network error → generic failure', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    expect(await new ClientsClient('http://api.test').importWhatsApp('c1', 'x', true)).toMatchObject({ ok: false, error: 'other' });
  });

  // --- brief + promise actions ---
  it('returns the brief on 200 and null on a non-200', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { clientName: 'Acme', empty: true }));
    expect(await new ClientsClient('http://api.test').getBrief('c1')).toMatchObject({ clientName: 'Acme' });
    fetchMock.mockResolvedValueOnce(json(404, {}));
    expect(await new ClientsClient('http://api.test').getBrief('c1')).toBeNull();
  });

  it('confirms a promise (POST) and rejects a promise (DELETE)', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { ok: true }));
    await new ClientsClient('http://api.test').confirmPromise('p1');
    expect(String(fetchMock.mock.calls[0]![0])).toBe('http://api.test/promises/p1/confirm');
    expect((fetchMock.mock.calls[0]![1] as RequestInit).method).toBe('POST');

    fetchMock.mockResolvedValueOnce(json(200, { ok: true }));
    await new ClientsClient('http://api.test').rejectPromise('p1');
    expect((fetchMock.mock.calls[1]![1] as RequestInit).method).toBe('DELETE');
  });

  it('lists notes on 200 and returns [] on failure', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { notes: [{ id: 'n1', source: 'paste', rawText: 'hi', status: 'extracted', createdAt: 1 }] }));
    expect(await new ClientsClient('http://api.test').listNotes('c1')).toHaveLength(1);
    fetchMock.mockResolvedValueOnce(json(500, {}));
    expect(await new ClientsClient('http://api.test').listNotes('c1')).toEqual([]);
  });
});
