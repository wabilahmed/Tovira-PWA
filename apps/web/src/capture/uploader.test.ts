import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HttpUploader } from './uploader.js';
import type { PendingRecording } from './outbox.js';

describe('HttpUploader', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  const rec: PendingRecording = {
    id: 'r1',
    clientId: 'c1',
    blob: new Uint8Array([1, 2, 3]),
    createdAt: 1,
    attempts: 0,
  };

  it('POSTs the audio to the client voice endpoint with credentials', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 201 }));
    await new HttpUploader('http://api.test').upload(rec);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe('http://api.test/clients/c1/notes/voice');
    expect((init as RequestInit).method).toBe('POST');
    expect((init as RequestInit).credentials).toBe('include');
  });

  // NEGATIVE: a non-OK response must throw so the outbox keeps + retries it.
  it('throws on a failed upload (so the recording is retained)', async () => {
    fetchMock.mockResolvedValueOnce(new Response('nope', { status: 500 }));
    await expect(new HttpUploader('http://api.test').upload(rec)).rejects.toThrow();
  });

  it('[AUDIT item 4] 413 is PERMANENT with a specific message', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ message: 'Recording too long — keep it under 10 minutes.' }), { status: 413 }));
    await expect(new HttpUploader('http://api.test').upload(rec)).rejects.toMatchObject({ status: 413, permanent: true, userMessage: expect.stringMatching(/too long|too large/i) });
    expect(fetchMock).toHaveBeenCalledTimes(1); // not retried
  });

  it('[AUDIT item 4] 415 is PERMANENT with a specific message', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ message: 'Record in the app.' }), { status: 415 }));
    await expect(new HttpUploader('http://api.test').upload(rec)).rejects.toMatchObject({ status: 415, permanent: true });
  });

  it('[AUDIT item 4] 5xx is TRANSIENT (permanent=false) so the outbox keeps retrying', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 503 }));
    await expect(new HttpUploader('http://api.test').upload(rec)).rejects.toMatchObject({ permanent: false });
  });

  it('[AUDIT item 4] 410 retries once; succeeds on the retry', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('', { status: 410 }))
      .mockResolvedValueOnce(new Response('{}', { status: 201 }));
    await new HttpUploader('http://api.test').upload(rec); // resolves
    expect(fetchMock).toHaveBeenCalledTimes(2); // one fresh attempt
  });

  it('[AUDIT item 4] 410 twice is permanent after the single retry', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('', { status: 410 }))
      .mockResolvedValueOnce(new Response('', { status: 410 }));
    await expect(new HttpUploader('http://api.test').upload(rec)).rejects.toMatchObject({ status: 410, permanent: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
