import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AuthService } from '../services/auth/auth-service.js';
import type { BulkImportService, BulkDecision } from '../services/import/bulk-import-service.js';
import type { ImportAckRepository } from '../ports/import-ack-repository.js';
import { FIRST_IMPORT_NOTICE } from '../ports/import-ack-repository.js';
import { BULK_MAX_FILES, type BulkInputFile } from '../services/import/bulk-parse.js';
import { extractToken, readJsonBody, sendJson, BadJsonError } from './helpers.js';

/**
 * [BULK-IMPORT · Task 4] The bulk endpoint. Unlike single import (POST /clients/:id/notes/import, which
 * needs a client chosen up front), a bulk upload carries NO pre-chosen client — the review screen assigns
 * each chat. Two steps:
 *   POST /import/bulk/parse  — deterministic local parse (NO model, D2) + up-front % estimate → review.
 *   POST /import/bulk        — the confirmed decisions → one note per chat → parallel per-chat extraction.
 * Extraction isolation (D1), warm-up, bounded fan-out, one-failure containment and the allowance stop all
 * live in BulkImportService / the orchestrator; this layer is auth + validation + shape.
 */
export interface BulkImportRouteDeps {
  auth: AuthService;
  bulkImport?: BulkImportService;
  importAck: ImportAckRepository;
}

function parseFiles(raw: unknown): BulkInputFile[] | null {
  if (!Array.isArray(raw)) return null;
  const files: BulkInputFile[] = [];
  for (const f of raw) {
    if (!f || typeof f !== 'object') return null;
    const { name, content } = f as { name?: unknown; content?: unknown };
    if (typeof name !== 'string' || typeof content !== 'string') return null;
    files.push({ name, content });
  }
  return files;
}

export async function handleBulkImportRoute(req: IncomingMessage, res: ServerResponse, deps: BulkImportRouteDeps): Promise<boolean> {
  const method = req.method ?? 'GET';
  const path = (req.url ?? '/').split('?')[0]!;
  const isParse = method === 'POST' && path === '/import/bulk/parse';
  const isImport = method === 'POST' && path === '/import/bulk';
  if (!isParse && !isImport) return false;

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

  let body: { files?: unknown; decisions?: unknown; repName?: unknown; firstImportAck?: unknown };
  try {
    body = (await readJsonBody(req)) as typeof body;
  } catch (err) {
    sendJson(res, 400, { error: 'validation', message: err instanceof BadJsonError ? 'Invalid JSON.' : 'Could not read request.' });
    return true;
  }

  const files = parseFiles(body.files);
  if (!files || files.length === 0) {
    sendJson(res, 400, { error: 'validation', message: 'Upload at least one chat export.' });
    return true;
  }
  if (files.length > BULK_MAX_FILES) {
    sendJson(res, 413, { error: 'too_many_files', message: `Import up to ${BULK_MAX_FILES} chats at a time. You can run a second batch after.` });
    return true;
  }
  const repName = typeof body.repName === 'string' ? body.repName : null;

  if (isParse) {
    const out = await deps.bulkImport.parse(userId, files, repName);
    sendJson(res, 200, out);
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
  // Notes are created and durably stored even when the allowance is spent — extraction pauses per chat
  // ("paused: usage limit") rather than losing the rep's confirmed work (never lose a recording).
  const result = await deps.bulkImport.importConfirmed(userId, files, decisions, new Date().toISOString().slice(0, 10));
  sendJson(res, 202, result);
  return true;
}
