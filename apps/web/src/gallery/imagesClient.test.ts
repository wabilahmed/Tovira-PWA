import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ImagesClient } from './imagesClient.js';

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const IMG = { id: 'i1', clientId: 'c1', contentType: 'image/png', createdAt: 1 };

describe('ImagesClient', () => {
  it('lists a client\'s images on 200 and [] otherwise', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { images: [IMG] }));
    expect(await new ImagesClient('http://api.test').list('c1')).toHaveLength(1);
    expect(String(fetchMock.mock.calls[0]![0])).toBe('http://api.test/clients/c1/images');
    fetchMock.mockResolvedValueOnce(json(500, {}));
    expect(await new ImagesClient().list('c1')).toEqual([]);
  });

  it('uploads an image (201) and returns null on failure', async () => {
    fetchMock.mockResolvedValueOnce(json(201, IMG));
    const r = await new ImagesClient('http://api.test').upload('c1', new Blob(['x'], { type: 'image/png' }));
    expect(r).toMatchObject({ id: 'i1' });
    expect((fetchMock.mock.calls[0]![1] as RequestInit).method).toBe('POST');
    fetchMock.mockResolvedValueOnce(json(400, {}));
    expect(await new ImagesClient().upload('c1', new Blob(['x']))).toBeNull();
  });

  it('builds the same-origin bytes URL', () => {
    expect(new ImagesClient('http://api.test').url('i1')).toBe('http://api.test/images/i1');
  });
});
