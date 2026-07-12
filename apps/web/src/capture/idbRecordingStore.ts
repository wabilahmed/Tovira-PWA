import type { PendingRecording, RecordingStore } from './outbox.js';

/**
 * IndexedDB-backed durable store for pending recordings, so audio survives a
 * refresh, a crash, or the tab being killed before upload completes.
 */
const DB_NAME = 'tovira-capture';
const STORE = 'recordings';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const request = run(db.transaction(STORE, mode).objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      }),
  );
}

export class IdbRecordingStore implements RecordingStore {
  async put(rec: PendingRecording): Promise<void> {
    await tx('readwrite', (s) => s.put(rec));
  }
  async list(): Promise<PendingRecording[]> {
    return tx('readonly', (s) => s.getAll() as IDBRequest<PendingRecording[]>);
  }
  async delete(id: string): Promise<void> {
    await tx('readwrite', (s) => s.delete(id));
  }
}
