import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AuthService } from '../services/auth/auth-service.js';
import type { ClientRepository } from '../ports/client-repository.js';
import type { NoteRepository } from '../ports/note-repository.js';
import { extractToken, sendJson } from './helpers.js';

export interface OnboardingRouteDeps {
  auth: AuthService;
  clients: ClientRepository;
  notes: NoteRepository;
}

/**
 * GET /onboarding/status (P5-3). Guides the rep to the first value moment — a
 * real brief — and, if they've skipped seeding, nudges them there rather than
 * leaving an empty, useless app.
 */
export async function handleOnboardingRoute(
  req: IncomingMessage,
  res: ServerResponse,
  deps: OnboardingRouteDeps,
): Promise<boolean> {
  if ((req.method ?? 'GET') !== 'GET' || (req.url ?? '/').split('?')[0] !== '/onboarding/status') return false;

  const identity = await deps.auth.authenticate(extractToken(req));
  if (!identity) {
    sendJson(res, 401, { error: 'unauthorized' });
    return true;
  }
  const clients = await deps.clients.listByUser(identity.userId);
  let notes = 0;
  for (const c of clients) notes += (await deps.notes.listByClient(identity.userId, c.id)).length;

  const hasClient = clients.length >= 1;
  const hasNote = notes >= 1;
  const briefReachable = hasClient && hasNote;
  sendJson(res, 200, {
    hasClient,
    hasNote,
    briefReachable,
    nextStep: !hasClient
      ? 'Add your first client.'
      : !hasNote
        ? 'Paste some history (a WhatsApp thread or an old note) so Tovira has something to work with.'
        : 'Open a client and generate your first pre-meeting brief.',
  });
  return true;
}
