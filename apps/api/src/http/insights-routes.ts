import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AuthService } from '../services/auth/auth-service.js';
import type { NoteRepository } from '../ports/note-repository.js';
import type { ClientRepository } from '../ports/client-repository.js';
import { aggregatePeople, aggregatePersonalFacts, extractedOf } from '../services/insights/insights.js';
import { withExtractedReceipt } from '../services/receipts/receipt.js';
import { extractToken, sendJson } from './helpers.js';
import type { ContactAliasRepository } from '../ports/contact-alias-repository.js';
import { normalizeName } from '../services/text/normalize-name.js';

export interface InsightsRouteDeps {
  auth: AuthService;
  notes: NoteRepository;
  /** [SEC-01] to 404 a stakeholder/personal-facts read on an unknown / not-the-rep's client. */
  clients: ClientRepository;
  /** [P36-5] learned per-client aliases — the client under another name is still the client. */
  aliases?: ContactAliasRepository;
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
  // [SEC-01] An unknown / not-the-rep's client is 404 — not a 200 with an empty people/facts list.
  const client = await deps.clients.findByIdForUser(userId, clientId);
  if (!client) {
    sendJson(res, 404, { error: 'not_found' });
    return true;
  }
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
    // [P36-5] The client is never a stakeholder of their own record: drop anyone named as the client — the
    // client name, the name they write under in the chat (client-role senders), or a learned alias.
    const selfNames = new Set([
      client.name,
      ...notes.flatMap((n) => (n.messages ?? []).filter((m) => m.role === 'client').map((m) => m.sender)),
      ...(deps.aliases ? await deps.aliases.listByClient(userId, clientId) : []),
    ].map(normalizeName).filter(Boolean));
    sendJson(res, 200, { people: aggregatePeople(extractions).filter((p) => !(p.name && selfNames.has(normalizeName(p.name)))) });
  } else {
    sendJson(res, 200, { facts: aggregatePersonalFacts(extractions) });
  }
  return true;
}
