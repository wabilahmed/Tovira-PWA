import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AuthService } from '../services/auth/auth-service.js';
import type { BillingService } from '../services/billing/billing-service.js';
import { isFindQuery, type FindService, type WantingBy } from '../services/find/find-service.js';
import { extractToken, sendJson, requireEntitled } from './helpers.js';

export interface FindRouteDeps {
  auth: AuthService;
  billing: BillingService;
  find: FindService;
}

const FIND_RE = /^\/find\/([a-z-]+)$/;
const BY = new Set<WantingBy>(['type', 'area', 'budget', 'beds']);

/** [P39-7] GET /find/:query — a fixed question, answered from stored data (no model call, no allowance).
 *  GET /find/wanting/options — the stored property types, areas and budget bands "Clients wanting…" offers.
 *  "wanting" takes ?by=type|area|budget&value=… . Premium like Today: a lapsed trial gets a 402. */
export async function handleFindRoute(req: IncomingMessage, res: ServerResponse, deps: FindRouteDeps): Promise<boolean> {
  if ((req.method ?? 'GET') !== 'GET') return false;
  const url = new URL(req.url ?? '/', 'http://local');
  const options = url.pathname === '/find/wanting/options';
  const m = options ? null : FIND_RE.exec(url.pathname);
  if (!options && !m) return false;

  const identity = await deps.auth.authenticate(extractToken(req));
  if (!identity) { sendJson(res, 401, { error: 'unauthorized' }); return true; }
  if (!(await requireEntitled(deps.billing, identity.userId, res))) return true;

  if (options) { sendJson(res, 200, await deps.find.wantingOptions(identity.userId)); return true; }
  const query = m![1]!;
  if (!isFindQuery(query)) { sendJson(res, 404, { error: 'not_found' }); return true; }
  let filter: { by: WantingBy; value: string } | undefined;
  if (query === 'wanting') {
    const by = url.searchParams.get('by') as WantingBy | null;
    const value = url.searchParams.get('value') ?? '';
    if (!by || !BY.has(by) || !value.trim()) { sendJson(res, 400, { error: 'validation', message: 'Choose what they want first.' }); return true; }
    filter = { by, value };
  }
  sendJson(res, 200, await deps.find.run(identity.userId, query, Date.now(), filter));
  return true;
}
