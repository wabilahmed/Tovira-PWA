import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AuthService } from '../services/auth/auth-service.js';
import type { BriefService } from '../services/brief/brief-service.js';
import type { BillingService } from '../services/billing/billing-service.js';
import type { ActivationService } from '../services/analytics/activation-service.js';
import type { MeetingRepository } from '../ports/meeting-repository.js';
import type { LedgerService } from '../services/ledger/ledger-service.js';
import { extractToken, sendJson } from './helpers.js';

export interface BriefRouteDeps {
  auth: AuthService;
  brief: BriefService;
  billing: BillingService;
  activation: ActivationService;
  meetings?: MeetingRepository;
  ledger?: LedgerService;
}

const BRIEF_RE = /^\/clients\/([^/]+)\/brief$/;

/** Handle GET /clients/:id/brief. Returns true if handled. */
export async function handleBriefRoute(
  req: IncomingMessage,
  res: ServerResponse,
  deps: BriefRouteDeps,
): Promise<boolean> {
  if ((req.method ?? 'GET') !== 'GET') return false;
  const match = BRIEF_RE.exec((req.url ?? '/').split('?')[0]!);
  if (!match) return false;

  const identity = await deps.auth.authenticate(extractToken(req));
  if (!identity) {
    sendJson(res, 401, { error: 'unauthorized' });
    return true;
  }
  // [P5-1] The brief is a paid feature — locked once the trial ends unpaid.
  const entitlement = await deps.billing.entitlement(identity.userId, Date.now());
  if (!entitlement.entitled) {
    sendJson(res, 402, { error: 'payment_required', status: entitlement.status });
    return true;
  }
  const brief = await deps.brief.buildBrief(identity.userId, decodeURIComponent(match[1]!));
  if (!brief) {
    sendJson(res, 404, { error: 'not_found' });
    return true;
  }
  // [P7-3] the "aha": first useful brief viewed → activation (fires once).
  if (!brief.empty) await deps.activation.onBriefViewed(identity.userId, Date.now());
  // [P4-11] a brief viewed before a logged meeting is a real value-touch.
  if (deps.ledger && deps.meetings) {
    const clientId = decodeURIComponent(match[1]!);
    const now = Date.now();
    const upcoming = (await deps.meetings.listByUser(identity.userId)).find(
      (m) => m.clientId === clientId && m.datetime && Date.parse(m.datetime) >= now,
    );
    if (upcoming) {
      await deps.ledger.record(identity.userId, { type: 'brief_before_meeting', clientId, sourceId: upcoming.id, dedupeKey: `brief:${upcoming.id}`, occurredAt: now });
    }
  }
  sendJson(res, 200, brief);
  return true;
}
