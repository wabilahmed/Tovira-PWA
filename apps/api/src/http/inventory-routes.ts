import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AuthService } from '../services/auth/auth-service.js';
import type { InventoryRepository, InventoryItemRecord } from '../ports/inventory-repository.js';
import { extractToken, sendJson } from './helpers.js';

export interface InventoryRouteDeps {
  auth: AuthService;
  inventory: InventoryRepository;
}

const ITEM_RE = /^\/inventory\/([^/]+)$/;

/** API shape — never exposes user_id or the raw embedding. */
export function itemDto(r: InventoryItemRecord): Omit<InventoryItemRecord, 'userId' | 'embedded'> {
  return { id: r.id, title: r.title, description: r.description, quantity: r.quantity, status: r.status, disabledReason: r.disabledReason, createdAt: r.createdAt, updatedAt: r.updatedAt };
}

/**
 * Inventory routes. This batch (feat(INV-DATA)) carries the reads that prove isolation;
 * create/edit/disable land in feat(INV-CRUD). Every id-taking route returns a byte-identical
 * 404 for a foreign or unknown id — no existence oracle.
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

  if (method === 'GET' && path === '/inventory') {
    const status = new URL(req.url ?? '/', 'http://x').searchParams.get('status');
    const filter = status === 'active' || status === 'disabled' ? status : undefined;
    const items = await deps.inventory.listByUser(userId, filter);
    sendJson(res, 200, { items: items.map(itemDto) });
    return true;
  }

  const idMatch = ITEM_RE.exec(path);
  if (idMatch && method === 'GET') {
    const id = decodeURIComponent(idMatch[1]!);
    const item = await deps.inventory.findByIdForUser(userId, id);
    if (!item) {
      sendJson(res, 404, { error: 'not_found' }); // same 404 for foreign or unknown id
      return true;
    }
    sendJson(res, 200, itemDto(item));
    return true;
  }

  sendJson(res, 405, { error: 'method_not_allowed' });
  return true;
}
