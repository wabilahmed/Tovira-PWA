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

// [P46-6b] One read for the Promises screen: open promises, done promises, and the "older" window.
describe('[P46-6b] PromisesClient.tracker', () => {
  it('reads promises, done and staleThresholdDays from /promises', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { promises: [PROMISE], done: [{ ...PROMISE, id: 'd1', done: true }], staleThresholdDays: 60 }));
    const t = await new PromisesClient('http://api.test').tracker();
    expect(t.promises).toHaveLength(1);
    expect(t.done.map((p) => p.id)).toEqual(['d1']);
    expect(t.staleThresholdDays).toBe(60);
  });
  it('NEGATIVE: an older server (no done, no window) → [] and 90; a failure → empty', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { promises: [PROMISE] }));
    expect(await new PromisesClient().tracker()).toEqual({ promises: [PROMISE], done: [], staleThresholdDays: 90 });
    fetchMock.mockResolvedValueOnce(json(500, {}));
    expect(await new PromisesClient().tracker()).toEqual({ promises: [], done: [], staleThresholdDays: 90 });
  });
});
