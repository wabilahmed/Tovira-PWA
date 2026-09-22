import type { IncomingMessage, ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { sendJson, readJsonBody, BadJsonError } from './helpers.js';
import type { SpendOverrideRepository } from '../ports/spend-override-repository.js';
import type { ErasureService, FuzzyKey } from '../services/erasure/erasure-service.js';
import type { ErasureRequestService } from '../services/erasure/erasure-request-service.js';
import type { ModelCallEventStore } from '../ports/model-call-event-store.js';
import { spendByClassReport } from '../services/spend/spend-by-class-report.js';
import { conversationCostReport } from '../services/spend/conversation-cost-report.js';

export interface OpsRouteDeps {
  /** Unset → the ops routes are disabled (always 403). Never a rep credential. */
  opsToken?: string;
  overrides: SpendOverrideRepository;
  spend: {
    status(userId: string): Promise<{ periodKey: string; spentAed: number; capAed: number; state: string }>;
    /** [SPEND-REPORT] per-rep Claude spend this period (AED + USD, per-class), for the ops cost view. */
    report(userIds: string[]): Promise<unknown[]>;
  };
  /** [SPEND-REPORT] every rep id, so the cost view can score each on their own current period. */
  allUserIds: () => Promise<string[]>;
  /** [ERASURE] single-counterparty erasure, operator-run (Terms 4.9). Absent → the routes no-op neutrally. */
  erasure?: Pick<ErasureService, 'preview'>;
  erasureRequests?: Pick<ErasureRequestService, 'open' | 'complete'>;
  /** [SPEND-INSTRUMENT] durable per-call event store — powers GET /ops/spend/by-class. Absent → 404. */
  modelCallEvents?: ModelCallEventStore;
}

/** Constant-time ops-token check (never leak validity via timing). Shared with the /health split so
 *  the identifying half of the health body is gated by exactly the same credential (HEALTH-LEAK). */
export function opsTokenOk(provided: string | undefined, expected: string | undefined): boolean {
  if (!expected || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * [SPEND-CAP · CAP-OVERRIDE] Ops-only endpoints. There is no admin auth in the product (Identity is
 * just a userId), so these are gated by an env OPS_TOKEN — NOT a rep session — and the write runs on
 * the superuser pool (an ops action, cross-tenant). A rep, however crafted their request, has no
 * token and cannot raise their own cap or release their own queue: this is not a client capability.
 *
 * POST /ops/spend-cap/override  { userId, capAed, reason, raisedBy? }
 *   Raises the cap for a rep's CURRENT period (audited). The rep is then under cap, so the sweep
 *   drains their queued extraction on its next pass — releasing work, never discarding it.
 * GET  /ops/spend-cap/audit
 *   The override audit trail (who, when, what value, why).
 */
export async function handleOpsRoute(req: IncomingMessage, res: ServerResponse, deps: OpsRouteDeps): Promise<boolean> {
  const url = (req.url ?? '').split('?')[0]!;
  if (!url.startsWith('/ops/')) return false; // not an ops route

  const provided = req.headers['x-ops-token'];
  const authed = opsTokenOk(typeof provided === 'string' ? provided : undefined, deps.opsToken);

  // [ERASURE] Operator intake (Terms 4.9). ANTI-ENUMERATION: on a bad/absent token OR an unknown
  // counterparty the response is byte-identical — an unauthenticated probe learns nothing about who
  // exists. Only a valid ops token performs the action. Handled BEFORE the generic 403 so a bad
  // token here returns the same neutral shape as an authenticated unknown-counterparty request.
  if (url.startsWith('/ops/erasure/')) {
    let body: { userId?: unknown; requesterNames?: unknown; requestId?: unknown; flaggedMentionIds?: unknown; confirmFuzzy?: unknown } = {};
    try { body = (req.method === 'POST' ? await readJsonBody(req) : {}) as typeof body; } catch { body = {}; }
    const userId = typeof body.userId === 'string' ? body.userId.trim() : '';
    const names = Array.isArray(body.requesterNames) ? (body.requesterNames as unknown[]).filter((x): x is string => typeof x === 'string') : [];
    // [ERASURE-FLAGS] operator flags + fuzzy confirmations for /complete (both ignored elsewhere).
    const flaggedMentionIds = Array.isArray(body.flaggedMentionIds) ? (body.flaggedMentionIds as unknown[]).filter((x): x is string => typeof x === 'string') : [];
    const confirmFuzzy = Array.isArray(body.confirmFuzzy)
      ? (body.confirmFuzzy as unknown[]).flatMap((x) => {
          const o = x as { noteId?: unknown; store?: unknown; who?: unknown };
          return typeof o?.noteId === 'string' && typeof o?.store === 'string' && typeof o?.who === 'string'
            ? [{ noteId: o.noteId, store: o.store as FuzzyKey['store'], who: o.who }]
            : [];
        })
      : [];

    if (req.method === 'POST' && url === '/ops/erasure/preview') {
      // Unauth (or a valid token on an unknown counterparty) → the SAME empty plan. Byte-identical.
      const empty = { requesterNames: names, autoDelete: [], fuzzyCandidates: [], keptMentions: [], logRowIds: [] };
      const plan = authed && deps.erasure && userId ? await deps.erasure.preview(userId, names) : empty;
      sendJson(res, 200, plan);
      return true;
    }
    if (req.method === 'POST' && url === '/ops/erasure/open') {
      if (authed && deps.erasureRequests && userId && names.length > 0) await deps.erasureRequests.open(userId, names);
      sendJson(res, 200, { ok: true }); // neutral ack — identical whether unauth, unknown, or known
      return true;
    }
    if (req.method === 'POST' && url === '/ops/erasure/complete') {
      const requestId = typeof body.requestId === 'string' ? body.requestId : '';
      if (authed && deps.erasureRequests && userId && requestId) {
        await deps.erasureRequests.complete(userId, requestId, { flaggedMentionIds, confirmFuzzy });
      }
      sendJson(res, 200, { ok: true }); // neutral ack
      return true;
    }
    sendJson(res, 200, { ok: true });
    return true;
  }

  // Ops auth — a single token, constant-time compared. No token configured → disabled.
  if (!authed) {
    sendJson(res, 403, { error: 'forbidden' });
    return true;
  }

  if (req.method === 'POST' && url === '/ops/spend-cap/override') {
    let body: { userId?: unknown; capAed?: unknown; reason?: unknown; raisedBy?: unknown };
    try {
      body = (await readJsonBody(req)) as typeof body;
    } catch (err) {
      sendJson(res, err instanceof BadJsonError ? 400 : 500, { error: 'bad_request' });
      return true;
    }
    const userId = typeof body.userId === 'string' ? body.userId.trim() : '';
    const capAed = typeof body.capAed === 'number' ? body.capAed : NaN;
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    const raisedBy = typeof body.raisedBy === 'string' && body.raisedBy.trim() ? body.raisedBy.trim() : 'ops';
    if (!userId || !reason || !(capAed > 0)) {
      sendJson(res, 400, { error: 'validation', message: 'userId, a positive capAed, and a reason are required.' });
      return true;
    }
    const status = await deps.spend.status(userId); // the CURRENT period the override applies to
    const override = await deps.overrides.set({ userId, periodKey: status.periodKey, capAed, raisedBy, reason });
    // The rep is now under cap → the sweep releases their queued extraction on its next pass.
    sendJson(res, 200, { override, spend: await deps.spend.status(userId) });
    return true;
  }

  if (req.method === 'GET' && url === '/ops/spend-cap/audit') {
    sendJson(res, 200, { audit: await deps.overrides.listAudit(50) });
    return true;
  }

  // [SPEND-INSTRUMENT B3] GET /ops/spend/by-class?from=&to=&userId= — cost BY FEATURE CLASS (with each
  // class's share) and BY MODEL (invoice-comparable, USD) over a TIME WINDOW. Reads the recorded per-call
  // events, never recomputes. `userId` → one account; omitted → all accounts + system (reconciles to the
  // Anthropic invoice for the window). Defaults to the current calendar month if from/to are absent.
  if (req.method === 'GET' && url === '/ops/spend/by-class') {
    if (!deps.modelCallEvents) { sendJson(res, 404, { error: 'not_found' }); return true; }
    const q = new URL(req.url ?? '/', 'http://x').searchParams;
    const now = new Date();
    const fromMs = q.get('from') ? Date.parse(q.get('from')!) : Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
    const toMs = q.get('to') ? Date.parse(q.get('to')!) : now.getTime();
    if (Number.isNaN(fromMs) || Number.isNaN(toMs) || fromMs >= toMs) {
      sendJson(res, 400, { error: 'validation', message: 'from/to must be valid ISO dates with from < to.' });
      return true;
    }
    const userId = q.get('userId')?.trim() || undefined;
    sendJson(res, 200, await spendByClassReport(deps.modelCallEvents, fromMs, toMs, userId));
    return true;
  }

  // [SPEND-INSTRUMENT B4 · ASK-CONVO] GET /ops/spend/conversation?userId=&conversationId= — per-turn cost
  // for one conversation (turn number, context size, cost, running total), read from the durable per-call
  // log. Makes conversation cost GROWTH visible; ops-only (a measurement surface, never rep-facing).
  if (req.method === 'GET' && url === '/ops/spend/conversation') {
    if (!deps.modelCallEvents) { sendJson(res, 404, { error: 'not_found' }); return true; }
    const q = new URL(req.url ?? '/', 'http://x').searchParams;
    const userId = q.get('userId')?.trim();
    const conversationId = q.get('conversationId')?.trim();
    if (!userId || !conversationId) {
      sendJson(res, 400, { error: 'validation', message: 'userId and conversationId are required.' });
      return true;
    }
    sendJson(res, 200, await conversationCostReport(deps.modelCallEvents, userId, conversationId));
    return true;
  }

  // [SPEND-REPORT] GET /ops/spend — per-rep Claude spend this billing period, most-expensive first,
  // in AED + USD with the per-class split. This is the "what is each rep costing" readout: the
  // spend_ledger already CAPTURES it on every model call; this exposes it (cross-tenant → ops-only).
  if (req.method === 'GET' && url === '/ops/spend') {
    const reps = (await deps.spend.report(await deps.allUserIds())) as Array<{ spentUsd?: number }>;
    const totalUsd = reps.reduce((sum, r) => sum + (r.spentUsd ?? 0), 0);
    sendJson(res, 200, { reps, totalUsd: Math.round(totalUsd * 100) / 100 });
    return true;
  }

  sendJson(res, 404, { error: 'not_found' });
  return true;
}
