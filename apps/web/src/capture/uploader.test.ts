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
});
