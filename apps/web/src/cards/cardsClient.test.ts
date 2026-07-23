import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CardsClient } from './cardsClient.js';

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('CardsClient.scan', () => {
  it('POSTs the image and returns the scan result', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { isCard: true, contact: { name: 'Sara Lee', title: 'Ops Lead', phone: null, email: 's@acme.test' } }));
    const result = await new CardsClient('http://api.test').scan(new Blob(['img'], { type: 'image/png' }));
    expect(result).toMatchObject({ isCard: true });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe('http://api.test/cards/scan');
    expect((init as RequestInit).method).toBe('POST');
  });

  it('returns null on a non-200 or throw', async () => {
    fetchMock.mockResolvedValueOnce(json(422, {}));
    expect(await new CardsClient().scan(new Blob(['x']))).toBeNull();
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    expect(await new CardsClient().scan(new Blob(['x']))).toBeNull();
  });
});
