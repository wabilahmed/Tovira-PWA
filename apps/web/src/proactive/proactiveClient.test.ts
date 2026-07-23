import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProactiveClient } from './proactiveClient.js';

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('ProactiveClient', () => {
  it('lists cold clients on 200 and [] otherwise', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { clients: [{ id: 'c1', name: 'Quiet Co', createdAt: 1, lastTouchedAt: 1 }] }));
    expect(await new ProactiveClient('http://api.test').listCold()).toHaveLength(1);
    expect(String(fetchMock.mock.calls[0]![0])).toBe('http://api.test/cold');
    fetchMock.mockResolvedValueOnce(json(401, {}));
    expect(await new ProactiveClient().listCold()).toEqual([]);
  });

  it('lists notifications on 200 and [] on throw', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { notifications: [{ id: 'n1', type: 'going_cold', clientId: 'c1', title: 'Quiet Co has gone quiet', body: 'No contact in 30 days.', read: false, createdAt: 1 }] }));
    expect(await new ProactiveClient().listNotifications()).toHaveLength(1);
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    expect(await new ProactiveClient().listNotifications()).toEqual([]);
  });

  it('runs the scan (POST /scan) and reports success/failure', async () => {
    fetchMock.mockResolvedValueOnce(json(200, {}));
    expect(await new ProactiveClient('http://api.test').runScan()).toBe(true);
    expect((fetchMock.mock.calls[0]![1] as RequestInit).method).toBe('POST');
    fetchMock.mockResolvedValueOnce(json(500, {}));
    expect(await new ProactiveClient().runScan()).toBe(false);
  });
});
