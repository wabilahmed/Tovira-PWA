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
  /** [AUDIT item 4] A permanent failure (413 too large / 415 wrong type) that retrying can never fix.
   *  The recording is KEPT (the rep can still re-record or export it) but is not retried by flush(). */
  permanent?: boolean;
  /** [AUDIT item 4] A specific, rep-facing message for the failure (e.g. "Recording too large"). */
  userMessage?: string;
}

/** [AUDIT item 4] An upload failure carrying its HTTP status, whether retrying can ever help, and a
 *  rep-facing message. The uploader throws this; the outbox decides retry-vs-stop from `permanent`. */
export class UploadError extends Error {
  constructor(readonly status: number, readonly permanent: boolean, readonly userMessage: string) {
    super(`upload failed: ${status}`);
    this.name = 'UploadError';
  }
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
      // [AUDIT item 4] A permanent failure (413/415) is recorded as such so flush() never retries it —
      // but the recording is NEVER deleted on a failure; the rep can re-record or keep it.
      const permanent = err instanceof UploadError && err.permanent;
      const userMessage = err instanceof UploadError ? err.userMessage : undefined;
      await this.store.put({ ...rec, attempts: rec.attempts + 1, lastError: String(err), ...(permanent ? { permanent: true } : {}), ...(userMessage ? { userMessage } : {}) });
      return { uploaded: false };
    }
  }

  /** Retry every queued recording (call on reconnect / app start). A store that
   *  can't be read (e.g. IndexedDB unavailable) must never crash startup. */
  async flush(): Promise<void> {
    let queued: Awaited<ReturnType<RecordingStore['list']>>;
    try {
      queued = await this.store.list();
    } catch {
      return;
    }
    for (const rec of queued) {
      if (rec.permanent) continue; // [AUDIT item 4] a 413/415 can never succeed — don't retry it
      await this.tryUpload(rec.id);
    }
  }

  /** Recordings still awaiting a confirmed upload (survives reloads). An
   *  unreadable store (e.g. IndexedDB unavailable) reports nothing pending. */
  async pending(): Promise<PendingRecording[]> {
    try {
      return await this.store.list();
    } catch {
      return [];
    }
  }
}
