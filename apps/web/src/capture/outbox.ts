/**
 * The capture outbox — the guardrail behind "never lose a recording" (P1-3).
 *
 * A recording is persisted to a durable store BEFORE any upload is attempted, so
 * a refresh or crash mid-upload can't drop it. It is deleted only after the
 * upload is confirmed; a failed upload keeps it queued (with attempt count +
 * last error, for a "pending upload" UI) and is retried on flush().
 */

export interface PendingRecording {
  id: string;
  clientId: string;
  blob: Blob | Uint8Array;
  createdAt: number;
  attempts: number;
  lastError?: string;
}

export interface RecordingStore {
  put(rec: PendingRecording): Promise<void>;
  list(): Promise<PendingRecording[]>;
  delete(id: string): Promise<void>;
}

export interface Uploader {
  /** Upload the recording; resolve on success, throw on failure. */
  upload(rec: PendingRecording): Promise<void>;
}

export class Outbox {
  constructor(
    private readonly store: RecordingStore,
    private readonly uploader: Uploader,
  ) {}

  /** Persist immediately, then try to upload. Returns whether it uploaded now. */
  async enqueue(rec: Omit<PendingRecording, 'attempts'>): Promise<{ uploaded: boolean }> {
    await this.store.put({ ...rec, attempts: 0 });
    return this.tryUpload(rec.id);
  }

  private async tryUpload(id: string): Promise<{ uploaded: boolean }> {
    const rec = (await this.store.list()).find((r) => r.id === id);
    if (!rec) return { uploaded: false };
    try {
      await this.uploader.upload(rec);
      await this.store.delete(id); // only remove once confirmed
      return { uploaded: true };
    } catch (err) {
      await this.store.put({ ...rec, attempts: rec.attempts + 1, lastError: String(err) });
      return { uploaded: false };
    }
  }

  /** Retry every queued recording (call on reconnect / app start). */
  async flush(): Promise<void> {
    for (const rec of await this.store.list()) {
      await this.tryUpload(rec.id);
    }
  }

  /** Recordings still awaiting a confirmed upload (survives reloads). */
  async pending(): Promise<PendingRecording[]> {
    return this.store.list();
  }
}
