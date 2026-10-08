import { describe, it, expect } from 'vitest';
import { Outbox, UploadError, type PendingRecording, type RecordingStore, type Uploader } from './outbox.js';

class MemStore implements RecordingStore {
  map = new Map<string, PendingRecording>();
  async put(rec: PendingRecording): Promise<void> {
    this.map.set(rec.id, rec);
  }
  async list(): Promise<PendingRecording[]> {
    return [...this.map.values()];
  }
  async delete(id: string): Promise<void> {
    this.map.delete(id);
  }
}

function rec(id: string): PendingRecording {
  return { id, clientId: 'c1', blob: new Uint8Array([1, 2, 3]), createdAt: 1, attempts: 0 };
}

const okUploader: Uploader = { upload: async () => undefined };
const failUploader: Uploader = {
  upload: async () => {
    throw new Error('network down');
  },
};

// [P1-3] "Never lose a recording." The outbox persists BEFORE uploading, keeps a
// recording until upload is confirmed, and retries — so refresh, crash, or a
// failed upload never drops audio.
describe('Outbox', () => {
  it('persists the recording before attempting upload (survives a crash mid-upload)', async () => {
    const store = new MemStore();
    // An uploader that inspects the store at upload time proves persistence happened first.
    let persistedAtUpload = false;
    const inspecting: Uploader = {
      upload: async () => {
        persistedAtUpload = store.map.size === 1;
        throw new Error('crash');
      },
    };
    const outbox = new Outbox(store, inspecting);
    await outbox.enqueue(rec('r1'));
    expect(persistedAtUpload).toBe(true);
  });

  it('removes the recording from the store only after a confirmed upload', async () => {
    const store = new MemStore();
    const outbox = new Outbox(store, okUploader);
    const result = await outbox.enqueue(rec('r1'));
    expect(result.uploaded).toBe(true);
    expect(await outbox.pending()).toEqual([]);
  });

  // NEGATIVE: network drops mid-upload → recording queued and retried, not lost.
  it('retains a recording (pending) when upload fails, and retries on flush', async () => {
    const store = new MemStore();
    const flaky = { calls: 0, upload: async () => { flaky.calls++; if (flaky.calls < 2) throw new Error('down'); } };
    const outbox = new Outbox(store, flaky);
    const first = await outbox.enqueue(rec('r1'));
    expect(first.uploaded).toBe(false);
    expect((await outbox.pending()).map((p) => p.id)).toEqual(['r1']); // still there
    await outbox.flush(); // retry succeeds
    expect(await outbox.pending()).toEqual([]);
  });

  it('tracks attempts and never discards a permanently-failing recording', async () => {
    const store = new MemStore();
    const outbox = new Outbox(store, failUploader);
    await outbox.enqueue(rec('r1'));
    await outbox.flush();
    await outbox.flush();
    const pending = await outbox.pending();
    expect(pending).toHaveLength(1); // never dropped
    expect(pending[0]!.attempts).toBeGreaterThanOrEqual(3);
    expect(pending[0]!.lastError).toBeTruthy(); // surfaced for the UI
  });

  it('recovers pending recordings after a "refresh" (new Outbox, same durable store)', async () => {
    const store = new MemStore();
    await new Outbox(store, failUploader).enqueue(rec('r1'));
    // Simulate reload: a fresh Outbox over the same persisted store.
    const reloaded = new Outbox(store, okUploader);
    expect((await reloaded.pending()).map((p) => p.id)).toEqual(['r1']);
    await reloaded.flush();
    expect(await reloaded.pending()).toEqual([]);
  });
});

describe('[AUDIT item 4] permanent vs transient failures', () => {
  it('keeps a permanently-failed recording, marks it, and never retries it on flush', async () => {
    const store = new MemStore();
    let calls = 0;
    const permFail: Uploader = { upload: async () => { calls++; throw new UploadError(413, true, 'Recording too large to upload.'); } };
    const outbox = new Outbox(store, permFail);
    await outbox.enqueue(rec('r1'));
    const kept = (await store.list())[0]!;
    expect(kept).toBeDefined();                 // NEVER deleted on failure
    expect(kept.permanent).toBe(true);
    expect(kept.userMessage).toMatch(/too large/i);
    await outbox.flush();
    expect(calls).toBe(1);                       // the permanent one is NOT retried
  });

  it('keeps retrying a transient failure on flush', async () => {
    const store = new MemStore();
    let calls = 0;
    const transient: Uploader = { upload: async () => { calls++; throw new UploadError(503, false, 'Upload failed.'); } };
    const outbox = new Outbox(store, transient);
    await outbox.enqueue(rec('r1'));
    expect((await store.list())[0]!.permanent).toBeUndefined();
    await outbox.flush();
    expect(calls).toBe(2);                       // enqueue + flush both tried
  });

  it('a recording survives ANY failure — it is never deleted because an upload failed', async () => {
    const store = new MemStore();
    const outbox = new Outbox(store, failUploader);
    await outbox.enqueue(rec('r1'));
    expect(await store.list()).toHaveLength(1);  // still there after a failure
  });
});
