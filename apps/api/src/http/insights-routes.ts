import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AuthService } from '../services/auth/auth-service.js';
import type { NoteRepository } from '../ports/note-repository.js';
import { aggregatePeople, aggregatePersonalFacts, extractedOf } from '../services/insights/insights.js';
import { withExtractedReceipt } from '../services/receipts/receipt.js';
import { extractToken, sendJson } from './helpers.js';

export interface InsightsRouteDeps {
  auth: AuthService;
  notes: NoteRepository;
}

const STAKEHOLDERS_RE = /^\/clients\/([^/]+)\/stakeholders$/;
const PERSONAL_RE = /^\/clients\/([^/]+)\/personal-facts$/;

/** GET /clients/:id/stakeholders and /clients/:id/personal-facts. */
export async function handleInsightsRoute(
  req: IncomingMessage,
  res: ServerResponse,
  deps: InsightsRouteDeps,
): Promise<boolean> {
  if ((req.method ?? 'GET') !== 'GET') return false;
  const path = (req.url ?? '/').split('?')[0]!;
  const stakeholders = STAKEHOLDERS_RE.exec(path);
  const personal = PERSONAL_RE.exec(path);
  if (!stakeholders && !personal) return false;

  const identity = await deps.auth.authenticate(extractToken(req));
  if (!identity) {
    sendJson(res, 401, { error: 'unauthorized' });
    return true;
  }
  const userId = identity.userId;
  const clientId = decodeURIComponent((stakeholders ?? personal)![1]!);
  const notes = await deps.notes.listByClient(userId, clientId); // RLS/user-scoped
  // Bind each person/personal_fact's receipt to its originating note's created_at (capture date)
  // before aggregating across notes — these facts carry no created_at of their own.
  const extractions = notes.map((n) => {
    const ex = extractedOf(n.extracted);
    return {
      ...ex,
      people: ex.people.map((p) => withExtractedReceipt(p, n.createdAt)),
      personal_facts: ex.personal_facts.map((pf) => withExtractedReceipt(pf, n.createdAt)),
    };
  });

  if (stakeholders) {
    sendJson(res, 200, { people: aggregatePeople(extractions) });
  } else {
    sendJson(res, 200, { facts: aggregatePersonalFacts(extractions) });
  }
  return true;
}
