import type { PendingRecording, RecordingStore } from './outbox.js';

/**
 * IndexedDB-backed durable store for pending recordings, so audio survives a
 * refresh, a crash, or the tab being killed before upload completes.
 */
const DB_NAME = 'tovira-capture';
const STORE = 'recordings';

function open(dbName: string, store: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(store)) {
        req.result.createObjectStore(store, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(dbName: string, store: string, mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open(dbName, store).then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const request = run(db.transaction(store, mode).objectStore(store));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      }),
  );
}

/** [P58-P1] A voice "new client" waiting for Create client or Discard: its own database, so the upload outbox (which
 *  needs a client) never sees it. */
export const VOICE_DRAFTS_DB = 'tovira-voice-drafts';

export class IdbRecordingStore implements RecordingStore {
  constructor(private readonly dbName: string = DB_NAME, private readonly store: string = STORE) {}
  async put(rec: PendingRecording): Promise<void> {
    await tx(this.dbName, this.store, 'readwrite', (s) => s.put(rec));
  }
  async list(): Promise<PendingRecording[]> {
    return tx(this.dbName, this.store, 'readonly', (s) => s.getAll() as IDBRequest<PendingRecording[]>);
  }
  async delete(id: string): Promise<void> {
    await tx(this.dbName, this.store, 'readwrite', (s) => s.delete(id));
  }
}
