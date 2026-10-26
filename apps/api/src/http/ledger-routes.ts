import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AuthService } from '../services/auth/auth-service.js';
import type { LedgerService } from '../services/ledger/ledger-service.js';
import type { ClientRepository } from '../ports/client-repository.js';
import type { LedgerEntry } from '../services/ledger/ledger-entries.js';
import { BadJsonError, extractToken, readJsonBody, sendJson } from './helpers.js';

export interface LedgerRouteDeps {
  auth: AuthService;
  ledger: LedgerService;
  clients: ClientRepository;
  /** [P46-5] The Ledger's entries (what Tovira suggested, the sale, the deal value). Optional for older wiring. */
  entries?: (userId: string) => Promise<LedgerEntry[]>;
}

const ENTRY_VALUE_RE = /^\/ledger\/entries\/([^/]+)\/deal-value$/;

const DEAL_VALUE_RE = /^\/clients\/([^/]+)\/deal-value$/;

/** GET /ledger, PUT /ledger/entries/:id/deal-value [P46-5], and POST /clients/:id/deal-value (P4-11). */
export async function handleLedgerRoute(
  req: IncomingMessage,
  res: ServerResponse,
  deps: LedgerRouteDeps,
): Promise<boolean> {
  const method = req.method ?? 'GET';
  const path = (req.url ?? '/').split('?')[0]!;
  const isSummary = method === 'GET' && path === '/ledger';
  const dealMatch = method === 'POST' ? DEAL_VALUE_RE.exec(path) : null;
  const entryMatch = method === 'PUT' ? ENTRY_VALUE_RE.exec(path) : null;
  if (!isSummary && !dealMatch && !entryMatch) return false;

  const identity = await deps.auth.authenticate(extractToken(req));
  if (!identity) {
    sendJson(res, 401, { error: 'unauthorized' });
    return true;
  }

  if (isSummary) {
    const summary = await deps.ledger.summary(identity.userId);
    sendJson(res, 200, { ...summary, entries: deps.entries ? await deps.entries(identity.userId) : [] });
    return true;
  }

  try {
    if (entryMatch) {
      // [P46-5] The deal value on one entry: a non-negative AED amount, or null to clear it. Never estimated.
      const body = (await readJsonBody(req)) as { aed?: unknown };
      const aed = body.aed === null ? null : typeof body.aed === 'number' && Number.isFinite(body.aed) && body.aed >= 0 ? body.aed : undefined;
      if (aed === undefined) {
        sendJson(res, 400, { error: 'validation', message: 'Enter the deal value in AED (zero or more), or clear it.' });
        return true;
      }
      const ok = await deps.ledger.setEntryDealValue(identity.userId, decodeURIComponent(entryMatch[1]!), aed);
      sendJson(res, ok ? 200 : 404, ok ? { ok: true } : { error: 'not_found' });
      return true;
    }
    const clientId = decodeURIComponent(dealMatch![1]!);
    // [P0-4] Ownership guard: a foreign or unknown client id is a 404, identical to
    // a non-existent one — never write a deal value onto another tenant's client.
    if (!(await deps.clients.findByIdForUser(identity.userId, clientId))) {
      sendJson(res, 404, { error: 'not_found' });
      return true;
    }
    const body = (await readJsonBody(req)) as { aed?: unknown };
    const aed = typeof body.aed === 'number' ? body.aed : NaN;
    if (!Number.isFinite(aed) || aed < 0) {
      sendJson(res, 400, { error: 'validation', message: 'A non-negative deal value (AED) is required.' });
      return true;
    }
    await deps.ledger.setDealValue(identity.userId, clientId, aed);
    sendJson(res, 200, { ok: true });
    return true;
  } catch (err) {
    if (err instanceof BadJsonError) {
      sendJson(res, 400, { error: 'bad_request', message: 'Invalid request body.' });
      return true;
    }
    throw err;
  }
}
