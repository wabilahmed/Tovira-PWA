import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AuthService } from '../services/auth/auth-service.js';
import type { BillingService } from '../services/billing/billing-service.js';
import type { InventoryService } from '../services/inventory/inventory-service.js';
import type { InventoryItemRecord } from '../ports/inventory-repository.js';
import { BadJsonError, extractToken, readJsonBody, requireEntitled, sendJson } from './helpers.js';

export interface InventoryRouteDeps {
  auth: AuthService;
  inventory: InventoryService;
  billing: BillingService;
}

const ITEM_RE = /^\/inventory\/([^/]+)$/;

/** API shape — never exposes user_id or the raw embedding. */
export function itemDto(r: InventoryItemRecord): Omit<InventoryItemRecord, 'userId' | 'embedded'> {
  return { id: r.id, title: r.title, description: r.description, quantity: r.quantity, status: r.status, disabledReason: r.disabledReason, createdAt: r.createdAt, updatedAt: r.updatedAt };
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
