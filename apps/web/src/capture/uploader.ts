import { UploadError, type PendingRecording, type Uploader } from './outbox.js';

/**
 * Uploads a recording's audio to the API. Distinguishes PERMANENT failures (413 too large, 415 wrong
 * type) — which it throws as permanent so the outbox stops retrying and shows a specific message — from
 * transient ones (5xx / network), which it throws as retryable. A 410 (the upload target is gone) gets
 * ONE fresh attempt before being treated as permanent. NOTE: the voice upload is a direct POST, not a
 * presigned-URL PUT, so there is no separate URL to re-mint — "retry once" is a single re-POST.
 */
export class HttpUploader implements Uploader {
  constructor(private readonly baseUrl: string = '') {}

  private post(rec: PendingRecording): Promise<Response> {
    return fetch(`${this.baseUrl}/clients/${rec.clientId}/notes/voice`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'audio/webm' },
      body: rec.blob as BodyInit,
    });
  }

  async upload(rec: PendingRecording): Promise<void> {
    let res = await this.post(rec);
    if (res.status === 410) res = await this.post(rec); // [AUDIT item 4] expired target — one fresh attempt
    if (res.ok) return;
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    const msg = typeof body.message === 'string' && body.message ? body.message : undefined;
    if (res.status === 413) throw new UploadError(413, true, msg ?? 'Recording too large to upload.');
    if (res.status === 415) throw new UploadError(415, true, msg ?? 'That recording format can’t be uploaded.');
    if (res.status === 410) throw new UploadError(410, true, msg ?? 'That upload expired — please record again.');
    throw new UploadError(res.status, false, msg ?? 'Upload failed — we’ll keep retrying.'); // transient
  }
}
