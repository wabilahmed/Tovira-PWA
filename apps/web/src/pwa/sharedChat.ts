/**
 * Android share-target handoff (P5-3). A static PWA has no server to POST to, so
 * the manifest's `share_target` POST is caught by the service worker (`sw.ts`),
 * which reads the shared WhatsApp export and stashes it here; the app picks it up
 * on the next load and drops it into the import flow. iOS PWAs can't be share
 * targets — that path stays Files→upload.
 *
 * This module is SW-SAFE: it touches only FormData/File/IndexedDB, never
 * `window`/`document`, so the worker can import it.
 */

export interface SharedChat {
  text: string;
  title: string | null;
}

/** A tiny store the SW writes to and the app consumes from (one item). */
export interface SharedChatStore {
  put(chat: SharedChat): Promise<void>;
  take(): Promise<SharedChat | null>;
}

/** Extract the shared chat from a share-target POST's form data, or null when
 *  nothing usable was shared. Prefers the attached .txt file; falls back to a
 *  plain `text` field (some share sheets send text instead of a file). */
export async function readSharedChat(form: FormData): Promise<SharedChat | null> {
  const file = form.get('file');
  let text: string | null = null;
  if (file && typeof (file as Blob).text === 'function') {
    text = await (file as Blob).text();
  } else {
    const t = form.get('text');
    if (typeof t === 'string') text = t;
  }
  if (!text || text.trim() === '') return null;
  const title = form.get('title');
  return { text, title: typeof title === 'string' && title.trim() !== '' ? title : null };
}

/** Deliver a pending shared chat to the app exactly once (take-and-clear). Best
 *  effort: a failing store never throws — the app still loads normally. */
export async function consumeSharedChat(
  store: SharedChatStore,
  onChat: (chat: SharedChat) => void,
): Promise<boolean> {
  try {
    const chat = await store.take();
    if (!chat) return false;
    onChat(chat);
    return true;
  } catch {
    return false;
  }
}

// ── IndexedDB store shared between the service worker and the app ────────────
const DB_NAME = 'tovira-share';
const STORE = 'chats';
const KEY = 'pending';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const request = fn(db.transaction(STORE, mode).objectStore(STORE));
        request.onsuccess = () => resolve(request.result as T);
        request.onerror = () => reject(request.error);
      }),
  );
}

/** The real IndexedDB-backed store (used in the browser + the SW). */
export const idbSharedChatStore: SharedChatStore = {
  async put(chat: SharedChat): Promise<void> {
    await run('readwrite', (s) => s.put(chat, KEY));
  },
  async take(): Promise<SharedChat | null> {
    const chat = await run<SharedChat | undefined>('readonly', (s) => s.get(KEY));
    if (!chat) return null;
    await run('readwrite', (s) => s.delete(KEY)); // consume once
    return chat;
  },
};
