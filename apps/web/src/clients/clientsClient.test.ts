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
});
