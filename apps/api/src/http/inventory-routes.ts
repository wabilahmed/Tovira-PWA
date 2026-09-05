import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AuthService } from '../services/auth/auth-service.js';
import type { BillingService } from '../services/billing/billing-service.js';
import type { ClientRepository } from '../ports/client-repository.js';
import type { InventoryService } from '../services/inventory/inventory-service.js';
import type { MatchingService } from '../services/inventory/matching-service.js';
import type { InventoryItemRecord, InventoryShareRecord, ShareOutcome } from '../ports/inventory-repository.js';
import { BadJsonError, extractToken, readJsonBody, requireEntitled, sendJson } from './helpers.js';

export interface InventoryRouteDeps {
  auth: AuthService;
  inventory: InventoryService;
  clients: ClientRepository;
  billing: BillingService;
  /** INV-MATCH surfacing (A5): match suggestions, the badge, dismiss, and share-from-suggestion. */
  matching?: MatchingService;
}

const MATCHES_RE = /^\/inventory\/matches$/;                    // GET rep/client suggestions + badge
const MATCH_SEEN_RE = /^\/inventory\/matches\/seen$/;           // POST clear the badge
const MATCH_DISMISS_RE = /^\/inventory\/matches\/([^/]+)\/dismiss$/; // POST dismiss (everywhere)
const MATCH_SHARE_RE = /^\/inventory\/matches\/([^/]+)\/share$/;     // POST act on a suggestion
const ITEM_MATCHES_RE = /^\/inventory\/([^/]+)\/matches$/;      // GET reverse (per item)
const ITEM_RE = /^\/inventory\/([^/]+)$/;
const SHARES_RE = /^\/inventory\/([^/]+)\/shares$/;             // POST create + GET history
const SHARE_OUTCOME_RE = /^\/inventory\/shares\/([^/]+)$/;      // PATCH outcome
const BY_CLIENT_RE = /^\/inventory\/by-client\/([^/]+)$/;       // GET a client's shared items
const OUTCOMES: ShareOutcome[] = ['bought', 'declined', 'no_response'];

/** API shape — never exposes user_id or the raw embedding. */
export function itemDto(r: InventoryItemRecord): Omit<InventoryItemRecord, 'userId' | 'embedded'> {
  return { id: r.id, title: r.title, description: r.description, quantity: r.quantity, status: r.status, disabledReason: r.disabledReason, createdAt: r.createdAt, updatedAt: r.updatedAt };
}
export function shareDto(s: InventoryShareRecord): Omit<InventoryShareRecord, 'userId'> {
  return { id: s.id, itemId: s.itemId, clientId: s.clientId, sharedAt: s.sharedAt, outcome: s.outcome, outcomeSetBy: s.outcomeSetBy, quantityBought: s.quantityBought };
}

const isNonEmpty = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const isQuantity = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

/**
 * Inventory routes (feat(INV-CRUD), spec §Task 2). Reads (the tab) are a paid surface, gated
 * 402 with the shared Locked state. Create and edit stay OPEN on a lapsed account — a rep is
 * never locked out of managing their own data (same doctrine as capture + export). Nothing is
 * ever deleted: disabling is the only removal, and it is arithmetic (quantity 0), never inferred.
 */
export async function handleInventoryRoute(
  req: IncomingMessage,
  res: ServerResponse,
  deps: InventoryRouteDeps,
): Promise<boolean> {
  const method = req.method ?? 'GET';
  const path = (req.url ?? '/').split('?')[0]!;
  if (path !== '/inventory' && !path.startsWith('/inventory/')) return false;

  const identity = await deps.auth.authenticate(extractToken(req));
  if (!identity) {
    sendJson(res, 401, { error: 'unauthorized' });
    return true;
  }
  const userId = identity.userId;

  // ---- INV-MATCH surfacing (A5). Matched BEFORE /inventory/:id so "matches" isn't read as an id.
  // A match is a suggestion: reads are trial-included (§11.6, not gated); dismiss/share/seen are
  // the rep acting on their own data (OPEN on a lapsed account, like create/edit). ----
  if (deps.matching) {
    if (method === 'GET' && MATCHES_RE.test(path)) {
      // ?clientId= → a client's suggestions (brief); otherwise the rep's strong ones (Today). Plus
      // the badge count (strong + unseen). Every suggestion carries its receipt.
      const clientId = new URL(req.url ?? '', 'http://x').searchParams.get('clientId');
      const suggestions = clientId
        ? await deps.matching.suggestionsForClient(userId, clientId)
        : await deps.matching.suggestionsForUser(userId);
      const badge = await deps.matching.badgeCount(userId);
      sendJson(res, 200, { suggestions, badge });
      return true;
    }
    if (method === 'POST' && MATCH_SEEN_RE.test(path)) {
      await deps.matching.markBadgeViewed(userId, Date.now());
      sendJson(res, 200, { ok: true });
      return true;
    }
    const dm = method === 'POST' ? MATCH_DISMISS_RE.exec(path) : null;
    if (dm) {
      // One row, so dismissing here removes it from EVERY surface (brief, Today, tab, Monday, badge).
      await deps.matching.dismiss(userId, decodeURIComponent(dm[1]!));
      sendJson(res, 200, { ok: true });
      return true;
    }
    const sm = method === 'POST' ? MATCH_SHARE_RE.exec(path) : null;
    if (sm) {
      // Act on a suggestion → a share the LEDGER credits as suggestion-originated. Only this path
      // sets outcome_set_by='confirmed_suggestion'; an independent share of the same item credits
      // nothing — that distinction is the ledger's honesty.
      const m = await deps.matching.getMatch(userId, decodeURIComponent(sm[1]!));
      if (!m || m.status !== 'open') { sendJson(res, 404, { error: 'not_found' }); return true; }
      const result = await deps.inventory.share(userId, m.itemId, m.clientId, 'confirmed_suggestion');
      if (!result.ok) { sendJson(res, 409, { error: result.reason }); return true; }
      await deps.matching.dismiss(userId, m.id); // acted on — resolve the open suggestion
      sendJson(res, 200, { share: shareDto(result.share), warning: result.warning?.map(shareDto) ?? null });
      return true;
    }
    const im = method === 'GET' ? ITEM_MATCHES_RE.exec(path) : null;
    if (im) {
      // Reverse direction — "N clients asked for something like this", with names + their quotes.
      const suggestions = await deps.matching.suggestionsForItem(userId, decodeURIComponent(im[1]!));
      sendJson(res, 200, { suggestions });
      return true;
    }
  }

  // ---- Create — OPEN on a lapsed account (managing your own data) ----
  if (method === 'POST' && path === '/inventory') {
    let body: { title?: unknown; description?: unknown; quantity?: unknown };
    try {
      body = (await readJsonBody(req)) as typeof body;
    } catch (e) {
      if (e instanceof BadJsonError) { sendJson(res, 400, { error: 'validation', message: 'Invalid JSON.' }); return true; }
      throw e;
    }
    if (!isNonEmpty(body.title)) { sendJson(res, 400, { error: 'validation', message: 'A title is required.' }); return true; }
    if (!isNonEmpty(body.description)) { sendJson(res, 400, { error: 'validation', message: 'A description is required.' }); return true; }
    if (body.quantity !== undefined && !isQuantity(body.quantity)) { sendJson(res, 400, { error: 'validation', message: 'Quantity must be a whole number, zero or more.' }); return true; }
    const item = await deps.inventory.create(userId, { title: body.title.trim(), description: body.description.trim(), quantity: body.quantity ?? 1 });
    sendJson(res, 201, itemDto(item));
    return true;
  }

  // ---- Record a share — OPEN. Never reserves, never decrements; outcome starts pending. ----
  const sharesMatch = SHARES_RE.exec(path);
  if (sharesMatch && method === 'POST') {
    const itemId = decodeURIComponent(sharesMatch[1]!);
    let body: { clientId?: unknown };
    try { body = (await readJsonBody(req)) as typeof body; }
    catch (e) { if (e instanceof BadJsonError) { sendJson(res, 400, { error: 'validation', message: 'Invalid JSON.' }); return true; } throw e; }
    if (!isNonEmpty(body.clientId)) { sendJson(res, 400, { error: 'validation', message: 'A client is required.' }); return true; }
    if (!(await deps.clients.findByIdForUser(userId, body.clientId))) { sendJson(res, 404, { error: 'not_found' }); return true; } // foreign/unknown client
    const result = await deps.inventory.share(userId, itemId, body.clientId);
    if (!result.ok) {
      if (result.reason === 'disabled') { sendJson(res, 409, { error: 'item_disabled', message: 'Out of stock — set a quantity to share this.' }); return true; }
      sendJson(res, 404, { error: 'not_found' }); return true;
    }
    sendJson(res, 201, { share: shareDto(result.share), warning: result.warning ? result.warning.map(shareDto) : null });
    return true;
  }

  // ---- Set a share's outcome — bought decrements the item (→ sold_out at 0). ----
  const outcomeMatch = SHARE_OUTCOME_RE.exec(path);
  if (outcomeMatch && method === 'PATCH') {
    const shareId = decodeURIComponent(outcomeMatch[1]!);
    let body: { outcome?: unknown; quantityBought?: unknown };
    try { body = (await readJsonBody(req)) as typeof body; }
    catch (e) { if (e instanceof BadJsonError) { sendJson(res, 400, { error: 'validation', message: 'Invalid JSON.' }); return true; } throw e; }
    if (!OUTCOMES.includes(body.outcome as ShareOutcome)) { sendJson(res, 400, { error: 'validation', message: 'Outcome must be bought, declined, or no_response.' }); return true; }
    if (body.quantityBought !== undefined && !isQuantity(body.quantityBought)) { sendJson(res, 400, { error: 'validation', message: 'Quantity bought must be a whole number, zero or more.' }); return true; }
    const updated = await deps.inventory.setOutcome(userId, shareId, body.outcome as ShareOutcome, body.quantityBought as number | undefined);
    if (!updated) { sendJson(res, 404, { error: 'not_found' }); return true; }
    sendJson(res, 200, shareDto(updated));
    return true;
  }

  const idMatch = ITEM_RE.exec(path);
  const id = idMatch ? decodeURIComponent(idMatch[1]!) : null;

  // ---- Edit — OPEN (your own data). Quantity 0 disables (unlisted); >0 reactivates. ----
  if (method === 'PATCH' && id) {
    let body: { title?: unknown; description?: unknown; quantity?: unknown };
    try {
      body = (await readJsonBody(req)) as typeof body;
    } catch (e) {
      if (e instanceof BadJsonError) { sendJson(res, 400, { error: 'validation', message: 'Invalid JSON.' }); return true; }
      throw e;
    }
    if (body.title !== undefined && !isNonEmpty(body.title)) { sendJson(res, 400, { error: 'validation', message: 'A title cannot be blank.' }); return true; }
    if (body.description !== undefined && !isNonEmpty(body.description)) { sendJson(res, 400, { error: 'validation', message: 'A description cannot be blank.' }); return true; }
    if (body.quantity !== undefined && !isQuantity(body.quantity)) { sendJson(res, 400, { error: 'validation', message: 'Quantity must be a whole number, zero or more.' }); return true; }
    const patch: { title?: string; description?: string; quantity?: number } = {};
    if (body.title !== undefined) patch.title = (body.title as string).trim();
    if (body.description !== undefined) patch.description = (body.description as string).trim();
    if (body.quantity !== undefined) patch.quantity = body.quantity as number;
    const updated = await deps.inventory.edit(userId, id, patch);
    if (!updated) { sendJson(res, 404, { error: 'not_found' }); return true; }
    sendJson(res, 200, itemDto(updated));
    return true;
  }

  // ---- Reads — the paid surface: gated 402 on a lapsed account ----
  if (method === 'GET') {
    if (!(await requireEntitled(deps.billing, userId, res))) return true;

    if (path === '/inventory') {
      const status = new URL(req.url ?? '/', 'http://x').searchParams.get('status');
      const filter = status === 'active' || status === 'disabled' ? status : undefined;
      const items = await deps.inventory.list(userId, filter);
      sendJson(res, 200, { items: items.map(itemDto) });
      return true;
    }
    const sharesGet = SHARES_RE.exec(path);
    if (sharesGet) {
      const itemId = decodeURIComponent(sharesGet[1]!);
      if (!(await deps.inventory.get(userId, itemId))) { sendJson(res, 404, { error: 'not_found' }); return true; }
      const shares = await deps.inventory.sharesForItem(userId, itemId);
      sendJson(res, 200, { shares: shares.map(shareDto) });
      return true;
    }
    const byClient = BY_CLIENT_RE.exec(path);
    if (byClient) {
      const clientId = decodeURIComponent(byClient[1]!);
      if (!(await deps.clients.findByIdForUser(userId, clientId))) { sendJson(res, 404, { error: 'not_found' }); return true; }
      const rows = await deps.inventory.sharesForClientDetailed(userId, clientId);
      sendJson(res, 200, { shares: rows.map((r) => ({ ...shareDto(r.share), itemTitle: r.itemTitle, itemStatus: r.itemStatus })) });
      return true;
    }
    if (id) {
      const item = await deps.inventory.get(userId, id);
      if (!item) { sendJson(res, 404, { error: 'not_found' }); return true; } // same 404 for foreign or unknown
      sendJson(res, 200, itemDto(item));
      return true;
    }
  }

  sendJson(res, 405, { error: 'method_not_allowed' });
  return true;
}
