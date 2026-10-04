/**
 * [BULK-IMPORT page] A durable, short-lived holding area for an in-progress multi-file upload.
 *
 * The API caps a JSON body at 1 MB, and 20 chat exports (base64) are many times that, so the page
 * uploads ONE file per request. Each decoded transcript is stashed here (keyed by rep + batch) until the
 * rep confirms the review screen, then read for parse/import and cleared. It lives in blob Storage (S3 in
 * prod, in-memory/filesystem in tests) so an upload and a later parse that land on different API
 * instances still see the same batch — in-process memory would not survive that.
 */
import type { Storage } from '../../ports/storage.js';
import type { BulkInputFile } from './bulk-parse.js';

const enc = new TextEncoder();
const dec = new TextDecoder();

/** A file's slot key. Zero-padded index keeps the natural upload order on a prefix list. */
function fileKey(userId: string, batchId: string, index: number): string {
  return `bulk-import/${userId}/${batchId}/f${String(index).padStart(3, '0')}.json`;
}
function statusKey(userId: string, batchId: string): string {
  return `bulk-import/${userId}/${batchId}/status.json`;
}
function prefix(userId: string, batchId: string): string {
  return `bulk-import/${userId}/${batchId}/`;
}

export async function putBatchFile(storage: Storage, userId: string, batchId: string, index: number, file: BulkInputFile): Promise<void> {
  await storage.put(fileKey(userId, batchId, index), enc.encode(JSON.stringify(file)));
}

/** All uploaded files for a batch, in upload order (the status blob is skipped). */
export async function listBatchFiles(storage: Storage, userId: string, batchId: string): Promise<BulkInputFile[]> {
  const keys = (await storage.list(prefix(userId, batchId))).filter((k) => /\/f\d+\.json$/.test(k)).sort();
  const out: BulkInputFile[] = [];
  for (const k of keys) {
    try {
      out.push(JSON.parse(dec.decode(await storage.get(k))) as BulkInputFile);
    } catch {
      // A missing/corrupt slot is skipped rather than failing the whole batch.
    }
  }
  return out;
}

export async function writeBatchStatus(storage: Storage, userId: string, batchId: string, status: unknown): Promise<void> {
  await storage.put(statusKey(userId, batchId), enc.encode(JSON.stringify(status)));
}

export async function readBatchStatus<T>(storage: Storage, userId: string, batchId: string): Promise<T | null> {
  try {
    return JSON.parse(dec.decode(await storage.get(statusKey(userId, batchId)))) as T;
  } catch {
    return null;
  }
}

/** Remove the whole batch (input files + status) once it is imported or abandoned. */
export async function clearBatch(storage: Storage, userId: string, batchId: string): Promise<void> {
  for (const k of await storage.list(prefix(userId, batchId))) await storage.delete(k);
}
