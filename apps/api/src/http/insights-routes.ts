import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AuthService } from '../services/auth/auth-service.js';
import type { NoteRepository } from '../ports/note-repository.js';
import { aggregatePeople, aggregatePersonalFacts, extractedOf } from '../services/insights/insights.js';
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
  const extractions = notes.map((n) => extractedOf(n.extracted));

  if (stakeholders) {
    sendJson(res, 200, { people: aggregatePeople(extractions) });
  } else {
    sendJson(res, 200, { facts: aggregatePersonalFacts(extractions) });
  }
  return true;
}
