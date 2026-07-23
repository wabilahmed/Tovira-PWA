import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HeroClient } from './heroClient.js';

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('HeroClient', () => {
  it('gets the gate status on 200', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { unlocked: false, counts: { clients: 2, notes: 3 }, needed: { clients: 3, notes: 17 }, message: 'warming up' }));
    const s = await new HeroClient('http://api.test').status();
    expect(s).toMatchObject({ unlocked: false });
    expect(String(fetchMock.mock.calls[0]![0])).toBe('http://api.test/hero/status');
  });

  it('returns null status on a non-200', async () => {
    fetchMock.mockResolvedValueOnce(json(401, {}));
    expect(await new HeroClient().status()).toBeNull();
  });

  it('unwraps patterns, risk, and today; returns [] on failure', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { patterns: [{ id: 'p', title: 't', description: 'd', confidence: 'observed', evidence: [] }] }));
    expect(await new HeroClient().patterns()).toHaveLength(1);

    fetchMock.mockResolvedValueOnce(json(200, { atRisk: [{ clientId: 'c', name: 'Acme', reasons: ['silence'] }] }));
    expect(await new HeroClient().risk()).toHaveLength(1);

    fetchMock.mockResolvedValueOnce(json(200, { actions: [{ kind: 'promise', priority: 1, text: 'do it', clientId: 'c' }] }));
    expect(await new HeroClient().today()).toHaveLength(1);

    fetchMock.mockResolvedValueOnce(json(500, {}));
    expect(await new HeroClient().patterns()).toEqual([]);
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    expect(await new HeroClient().today()).toEqual([]);
  });

  it('calls the right endpoints', async () => {
    fetchMock.mockResolvedValue(json(200, { patterns: [], atRisk: [], actions: [] }));
    const c = new HeroClient('http://api.test');
    await c.patterns();
    await c.risk();
    await c.today();
    expect(String(fetchMock.mock.calls[0]![0])).toBe('http://api.test/hero/patterns');
    expect(String(fetchMock.mock.calls[1]![0])).toBe('http://api.test/hero/risk');
    expect(String(fetchMock.mock.calls[2]![0])).toBe('http://api.test/today');
  });
});
