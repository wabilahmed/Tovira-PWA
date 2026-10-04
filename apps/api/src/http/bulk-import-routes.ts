import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AuthService } from '../services/auth/auth-service.js';
import type { Storage } from '../ports/storage.js';
import type { NoteRepository } from '../ports/note-repository.js';
import { extractionState } from '../services/notes/extraction-state.js';
import type { BulkImportService, BulkDecision, ChatJob } from '../services/import/bulk-import-service.js';
import type { ChatJobState } from '../services/import/bulk-extraction.js';
import type { BulkUpsellService } from '../services/import/bulk-upsell.js';
import type { ImportAckRepository } from '../ports/import-ack-repository.js';
import { FIRST_IMPORT_NOTICE } from '../ports/import-ack-repository.js';
import { BULK_MAX_FILES, type RowState } from '../services/import/bulk-parse.js';
import { decodeBulkFiles, decodeBulkFileBytes, MAX_IMPORT_UPLOAD_BYTES } from '../services/import/bulk-decode.js';
import { putBatchFile, listBatchFiles, writeBatchStatus, readBatchStatus, clearBatch } from '../services/import/bulk-batch-store.js';
import { extractToken, readJsonBody, readRawBody, sendJson, BadJsonError } from './helpers.js';

/**
 * [BULK-IMPORT page] The bulk endpoints. The API caps a JSON body at 1 MB and 20 exports far exceed that,
 * so the page uploads ONE file per request into a durable pending batch (Storage), then:
 *   POST /import/bulk/files            — one file → decoded + stashed (iOS .zip supported, media dropped).
 *   POST /import/bulk/parse  {batchId} — deterministic local parse (NO model, D2) + % estimate + upsell.
 *   POST /import/bulk        {batchId} — confirmed decisions → extraction runs in the background (202).
 *   GET  /import/bulk/:id/status       — poll per-chat job state; done=true carries the result upsell.
 */
export interface BulkImportRouteDeps {
  auth: AuthService;
  bulkImport?: BulkImportService;
  importAck: ImportAckRepository;
  storage: Storage;
  /** [FIX 3] used to re-derive started chats' state when healing an interrupted batch. */
  notes: NoteRepository;
  /** [RULING 2] the top-up / subscribe upsell. Optional — without it, no upsell is attached. */
  bulkUpsell?: BulkUpsellService;
}

/**
 * [FIX 3] If the background import worker dies mid-batch, the status blob freezes. onProgress stamps
 * updatedAt on every per-chat transition, so a LIVE import refreshes it within one chat's extraction
 * (≈1–2 min worst case). A gap longer than this means the worker is gone: the status endpoint then heals
 * the batch — unstarted chats (no note) become failed_interrupted, started chats are re-derived from
 * their notes (the sweep finishes those) — so the view can never show "importing" forever.
 */
const INTERRUPTED_TIMEOUT_MS = 5 * 60 * 1000;
const TERMINAL: ReadonlySet<ChatJobState> = new Set<ChatJobState>(['done', 'failed', 'failed_usage_limit', 'failed_interrupted']);

function stateFromNote(note: { status: string; sweepAttempts?: number } | null): ChatJobState {
  if (!note) return 'failed_interrupted'; // the note vanished — treat as interrupted
  switch (extractionState(note)) {
    case 'done': return 'done';
    case 'failed': return 'failed';
    default: return 'extracting'; // queued/processing — the sweep will finish it
  }
}

const NON_IMPORTABLE: ReadonlySet<RowState> = new Set<RowState>(['group', 'duplicate', 'unparseable']);
const STATUS_RE = /^\/import\/bulk\/([^/]+)\/status$/;
const ABANDON_RE = /^\/import\/bulk\/([^/]+)$/; // DELETE — the rep left the review without importing
const BATCH_ID_RE = /^[A-Za-z0-9_-]{1,100}$/;

interface BatchStatus {
  jobs: ChatJob[];
  done: boolean;
  upsell?: unknown;
  /** Last write time (ms); staleness past INTERRUPTED_TIMEOUT_MS triggers the heal. */
  updatedAt?: number;
}

export async function handleBulkImportRoute(req: IncomingMessage, res: ServerResponse, deps: BulkImportRouteDeps): Promise<boolean> {
  const method = req.method ?? 'GET';
  const path = (req.url ?? '/').split('?')[0]!;
  const statusMatch = method === 'GET' ? STATUS_RE.exec(path) : null;
  const abandonMatch = method === 'DELETE' ? ABANDON_RE.exec(path) : null;
  const isFiles = method === 'POST' && path === '/import/bulk/files';
  const isParse = method === 'POST' && path === '/import/bulk/parse';
  const isImport = method === 'POST' && path === '/import/bulk';
  if (!statusMatch && !abandonMatch && !isFiles && !isParse && !isImport) return false;

  const identity = await deps.auth.authenticate(extractToken(req));
  if (!identity) {
    sendJson(res, 401, { error: 'unauthorized' });
    return true;
  }
  const userId = identity.userId;
  if (!deps.bulkImport) {
    sendJson(res, 501, { error: 'not_available', message: 'Bulk import is not configured.' });
    return true;
  }

  // GET status — read-only (except the one-shot heal of an interrupted batch).
  if (statusMatch) {
    const batchId = decodeURIComponent(statusMatch[1]!);
    const status = await readBatchStatus<BatchStatus>(deps.storage, userId, batchId);
    if (!status) { sendJson(res, 200, { jobs: [], done: false }); return true; }
    // [FIX 3] A not-done batch whose status has gone stale = a crashed background worker. Heal it so the
    // view finishes: unstarted chats fail "interrupted"; started chats reflect their note (sweep-driven).
    if (!status.done && typeof status.updatedAt === 'number' && Date.now() - status.updatedAt > INTERRUPTED_TIMEOUT_MS) {
      const jobs: ChatJob[] = [];
      for (const job of status.jobs) {
        if (TERMINAL.has(job.state)) { jobs.push(job); continue; }
        if (job.noteId) { jobs.push({ ...job, state: stateFromNote(await deps.notes.findByIdForUser(userId, job.noteId)) }); continue; }
        jobs.push({ ...job, state: 'failed_interrupted' }); // never started → no note → discarded
      }
      const done = jobs.every((j) => TERMINAL.has(j.state));
      const healed: BatchStatus = { jobs, done, updatedAt: Date.now(), ...(status.upsell ? { upsell: status.upsell } : {}) };
      await writeBatchStatus(deps.storage, userId, batchId, healed);
      sendJson(res, 200, healed);
      return true;
    }
    sendJson(res, 200, status);
    return true;
  }

  // [FIX 2b] Abandon — the rep left the review screen without importing. Delete the staged content now
  // (best-effort; the client calls this on leaving, and the retention sweep is the backstop).
  if (abandonMatch) {
    const batchId = decodeURIComponent(abandonMatch[1]!);
    if (BATCH_ID_RE.test(batchId)) await clearBatch(deps.storage, userId, batchId);
    sendJson(res, 200, { ok: true });
    return true;
  }

  // [FIX 1] One file uploads as RAW BINARY (no base64 + no 1 MB JSON cap): the bytes ARE the body and
  // the small metadata rides in the query. JSON uploads still work (legacy, below).
  if (isFiles && !String(req.headers['content-type'] ?? '').includes('json')) {
    // [FOLLOW-UP 1] metadata in X-Tovira-* headers, never the URL — a file name is personal data and
    // query strings land in access logs. The name is percent-encoded on the client (UTF-8 names).
    const h = req.headers;
    const batchId = typeof h['x-tovira-batch-id'] === 'string' ? h['x-tovira-batch-id'] : '';
    const rawName = typeof h['x-tovira-name'] === 'string' ? h['x-tovira-name'] : '';
    const name = rawName ? decodeURIComponent(rawName) : '';
    const index = Number.parseInt(typeof h['x-tovira-index'] === 'string' ? h['x-tovira-index'] : '', 10);
    if (!BATCH_ID_RE.test(batchId) || !name || !Number.isInteger(index)) {
      sendJson(res, 400, { error: 'validation', message: 'A file upload needs batchId, index and name.' });
      return true;
    }
    if (index < 0 || index >= BULK_MAX_FILES) {
      sendJson(res, 413, { error: 'too_many_files', message: `Import up to ${BULK_MAX_FILES} chats at a time.` });
      return true;
    }
    let bytes: Buffer;
    try {
      bytes = await readRawBody(req, MAX_IMPORT_UPLOAD_BYTES);
    } catch {
      sendJson(res, 413, { error: 'too_large', message: 'This file is too large.' });
      return true;
    }
    const file = decodeBulkFileBytes(name, new Uint8Array(bytes));
    await putBatchFile(deps.storage, userId, batchId, index, file, Date.now());
    sendJson(res, 200, { ok: true, fileName: file.name });
    return true;
  }

  let body: { batchId?: unknown; index?: unknown; name?: unknown; content?: unknown; contentBase64?: unknown; decisions?: unknown; repName?: unknown; firstImportAck?: unknown };
  try {
    body = (await readJsonBody(req)) as typeof body;
  } catch (err) {
    // A file whose base64 overflows the 1 MB JSON cap lands here; the page shows it on its own row.
    sendJson(res, err instanceof BadJsonError ? 413 : 400, { error: 'too_large', message: 'This file is too large.' });
    return true;
  }
  const batchId = typeof body.batchId === 'string' ? body.batchId : '';
  if (!BATCH_ID_RE.test(batchId)) {
    sendJson(res, 400, { error: 'validation', message: 'Missing or invalid batch id.' });
    return true;
  }

  // POST one file into the pending batch.
  if (isFiles) {
    if (typeof body.name !== 'string' || (typeof body.content !== 'string' && typeof body.contentBase64 !== 'string')) {
      sendJson(res, 400, { error: 'validation', message: 'A file needs a name and its content.' });
      return true;
    }
    const index = typeof body.index === 'number' && Number.isInteger(body.index) ? body.index : 0;
    if (index < 0 || index >= BULK_MAX_FILES) {
      sendJson(res, 413, { error: 'too_many_files', message: `Import up to ${BULK_MAX_FILES} chats at a time.` });
      return true;
    }
    const [file] = decodeBulkFiles([{ name: body.name, ...(typeof body.content === 'string' ? { content: body.content } : {}), ...(typeof body.contentBase64 === 'string' ? { contentBase64: body.contentBase64 } : {}) }]);
    await putBatchFile(deps.storage, userId, batchId, index, file!, Date.now());
    sendJson(res, 200, { ok: true, fileName: file!.name });
    return true;
  }

  const files = await listBatchFiles(deps.storage, userId, batchId);
  if (files.length === 0) {
    sendJson(res, 400, { error: 'validation', message: 'Upload at least one chat export first.' });
    return true;
  }

  if (isParse) {
    const repName = typeof body.repName === 'string' ? body.repName : null;
    const out = await deps.bulkImport.parse(userId, files, repName);
    const n = out.result.rows.filter((r) => !NON_IMPORTABLE.has(r.state)).length;
    const upsell = deps.bulkUpsell ? await deps.bulkUpsell.forBatch(userId, out.estimateAed, n) : undefined;
    // D3: the client sees the % of allowance and the upsell (prices + labels) — NEVER the raw AED estimate.
    sendJson(res, 200, { result: out.result, percentOfAllowance: out.percentOfAllowance, ...(upsell ? { upsell } : {}) });
    return true;
  }

  // Import: the first upload in an account needs the right-to-upload acknowledgement (same as single import).
  if ((await deps.importAck.acknowledgedAt(userId)) === null) {
    if (body.firstImportAck === true) await deps.importAck.acknowledge(userId, Date.now());
    else {
      sendJson(res, 428, { error: 'acknowledgement_required', notice: FIRST_IMPORT_NOTICE });
      return true;
    }
  }
  if (!Array.isArray(body.decisions)) {
    sendJson(res, 400, { error: 'validation', message: 'Confirm each chat before importing.' });
    return true;
  }
  const decisions = body.decisions as BulkDecision[];
  const today = new Date().toISOString().slice(0, 10);

  // Extraction can take far longer than a gateway allows, so run it in the BACKGROUND and let the page
  // poll /status. Live per-chat state is streamed to the status blob via onProgress; the final write
  // carries done=true plus the result upsell (top-ups) for any chats that failed at the usage limit.
  await writeBatchStatus(deps.storage, userId, batchId, { jobs: decisions.map((d) => ({ key: d.fileName, state: 'queued' as const })), done: false, updatedAt: Date.now() });
  const onProgress = (jobs: ChatJob[]): void => { void writeBatchStatus(deps.storage, userId, batchId, { jobs, done: false, updatedAt: Date.now() }); };
  void deps.bulkImport.importConfirmed(userId, files, decisions, today, onProgress)
    .then(async (result) => {
      // [FIX 2a] Delete the staged files BEFORE marking the batch done, so a client that polls done=true
      // can trust the staged conversation content is already gone.
      await clearBatchInputs(deps.storage, userId, batchId);
      const limited = result.jobs.filter((j) => j.state === 'failed_usage_limit').length;
      const upsell = limited > 0 && deps.bulkUpsell ? await deps.bulkUpsell.forResult(userId, limited) : undefined;
      await writeBatchStatus(deps.storage, userId, batchId, { jobs: result.jobs, done: true, updatedAt: Date.now(), ...(upsell ? { upsell } : {}) });
    })
    .catch(async () => {
      await clearBatchInputs(deps.storage, userId, batchId);
      await writeBatchStatus(deps.storage, userId, batchId, { jobs: decisions.map((d) => ({ key: d.fileName, state: 'failed' as const })), done: true, updatedAt: Date.now() });
    });

  sendJson(res, 202, { batchId });
  return true;
}

/** Remove the uploaded input files once extraction has consumed them; the status blob is kept for polling. */
async function clearBatchInputs(storage: Storage, userId: string, batchId: string): Promise<void> {
  try {
    for (const k of (await storage.list(`bulk-import/${userId}/${batchId}/`)).filter((x) => /\/f\d+\.json$/.test(x))) await storage.delete(k);
  } catch { /* best-effort cleanup */ }
}

// Re-exported for symmetry with other route modules; clearBatch wipes status too (abandon path).
export { clearBatch };
