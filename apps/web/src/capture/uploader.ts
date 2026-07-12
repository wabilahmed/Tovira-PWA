import type { PendingRecording, Uploader } from './outbox.js';

/** Uploads a recording's audio to the API. Throws on failure so the outbox retries. */
export class HttpUploader implements Uploader {
  constructor(private readonly baseUrl: string = '') {}

  async upload(rec: PendingRecording): Promise<void> {
    const res = await fetch(`${this.baseUrl}/clients/${rec.clientId}/notes/voice`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'audio/webm' },
      body: rec.blob as BodyInit,
    });
    if (!res.ok) throw new Error(`upload failed: ${res.status}`);
  }
}
