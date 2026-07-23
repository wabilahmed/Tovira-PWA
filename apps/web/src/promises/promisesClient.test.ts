import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PromisesClient } from './promisesClient.js';

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const PROMISE = { id: 'p1', clientId: 'c1', text: 'send quote', owner: 'rep', dueDate: '2026-08-01', dueRaw: null, confidence: 'high', done: false, confirmed: true };

describe('PromisesClient.listOpen / listConfirmations', () => {
  it('returns the open promises on 200', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { promises: [PROMISE] }));
    const list = await new PromisesClient('http://api.test').listOpen();
    expect(list).toHaveLength(1);
    expect(String(fetchMock.mock.calls[0]![0])).toBe('http://api.test/promises');
    expect((fetchMock.mock.calls[0]![1] as RequestInit).credentials).toBe('include');
  });

  it('returns [] on a non-200 or a thrown request', async () => {
    fetchMock.mockResolvedValueOnce(json(401, {}));
    expect(await new PromisesClient().listOpen()).toEqual([]);
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    expect(await new PromisesClient().listOpen()).toEqual([]);
  });

  it('fetches the confirmation queue from /confirmations', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { promises: [PROMISE] }));
    await new PromisesClient('http://api.test').listConfirmations();
    expect(String(fetchMock.mock.calls[0]![0])).toBe('http://api.test/confirmations');
  });
});

describe('PromisesClient mutations', () => {
  it('marks a promise done (POST /promises/:id/done)', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { ok: true }));
    expect(await new PromisesClient('http://api.test').markDone('p1')).toBe(true);
    expect(String(fetchMock.mock.calls[0]![0])).toBe('http://api.test/promises/p1/done');
    expect((fetchMock.mock.calls[0]![1] as RequestInit).method).toBe('POST');
  });

  it('returns false when mark-done 404s or throws', async () => {
    fetchMock.mockResolvedValueOnce(json(404, {}));
    expect(await new PromisesClient().markDone('nope')).toBe(false);
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    expect(await new PromisesClient().markDone('p1')).toBe(false);
  });

  it('confirms (POST) and rejects (DELETE)', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { ok: true }));
    expect(await new PromisesClient('http://api.test').confirm('p1')).toBe(true);
    expect((fetchMock.mock.calls[0]![1] as RequestInit).method).toBe('POST');

    fetchMock.mockResolvedValueOnce(json(200, { ok: true }));
    expect(await new PromisesClient('http://api.test').reject('p1')).toBe(true);
    expect((fetchMock.mock.calls[1]![1] as RequestInit).method).toBe('DELETE');
  });

  it('returns false when reject 404s', async () => {
    fetchMock.mockResolvedValueOnce(json(404, {}));
    expect(await new PromisesClient().reject('nope')).toBe(false);
  });
});
