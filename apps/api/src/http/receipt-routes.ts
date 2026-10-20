import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AuthService } from '../services/auth/auth-service.js';
import type { ReceiptSourceService } from '../services/receipts/receipt-source-service.js';
import { MAX_REFS } from '../services/receipts/receipt-source-service.js';
import type { ReceiptRef } from '../services/receipts/receipt-source.js';
import { BadJsonError, extractToken, readJsonBody, sendJson } from './helpers.js';

/**
 * [P35-3] Receipts as WhatsApp-style chat, for every surface.
 *   POST /receipts/sources { refs: ReceiptRef[] }  → { sources }  — one request per list (≤ 60 refs), never one per card
 *   POST /receipts/thread  { ref, full?: boolean } → { source }   — tap: 3 messages either side, or the whole thread
 * Tenant-bound (the rep's own notes only) and erasure-restricted, via ReceiptSourceService.
 */
export interface ReceiptRouteDeps {
  auth: AuthService;
  receipts: ReceiptSourceService;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.slice(0, 2000) : null);
function toRef(v: unknown): ReceiptRef | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const ref: ReceiptRef = { noteId: str(o.noteId), clientId: str(o.clientId), span: str(o.span), at: str(o.at), quote: str(o.quote), sender: str(o.sender) };
  return ref.noteId || ref.clientId || ref.quote || ref.span ? ref : null;
}

export async function handleReceiptRoute(req: IncomingMessage, res: ServerResponse, deps: ReceiptRouteDeps): Promise<boolean> {
  const path = (req.url ?? '/').split('?')[0]!;
  if (req.method !== 'POST' || (path !== '/receipts/sources' && path !== '/receipts/thread')) return false;
  const identity = await deps.auth.authenticate(extractToken(req));
  if (!identity) {
    sendJson(res, 401, { error: 'unauthorized' });
    return true;
  }
  let body: Record<string, unknown> = {};
  try {
    body = (await readJsonBody(req)) as Record<string, unknown>;
  } catch (err) {
    if (!(err instanceof BadJsonError)) throw err;
    sendJson(res, 400, { error: 'validation', message: 'Expected JSON.' });
    return true;
  }
  if (path === '/receipts/sources') {
    const raw = Array.isArray(body.refs) ? body.refs.slice(0, MAX_REFS) : null;
    if (!raw) {
      sendJson(res, 400, { error: 'validation', message: 'refs must be an array.' });
      return true;
    }
    const refs = raw.map(toRef);
    const resolved = await deps.receipts.resolve(identity.userId, refs.filter((r): r is ReceiptRef => r !== null));
    let k = 0;
    sendJson(res, 200, { sources: refs.map((r) => (r ? resolved[k++] ?? null : null)) });
    return true;
  }
  const ref = toRef(body.ref);
  if (!ref) {
    sendJson(res, 400, { error: 'validation', message: 'ref is required.' });
    return true;
  }
  sendJson(res, 200, { source: await deps.receipts.thread(identity.userId, ref, body.full === true ? 'full' : 3) });
  return true;
}
