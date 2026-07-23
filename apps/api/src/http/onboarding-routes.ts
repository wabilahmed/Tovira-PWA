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
  let seeded = false; // has the rep imported at least one WhatsApp chat export?
  for (const c of clients) {
    const cn = await deps.notes.listByClient(identity.userId, c.id);
    notes += cn.length;
    if (cn.some((n) => n.source === 'whatsapp_export')) seeded = true;
  }

  const hasClient = clients.length >= 1;
  const hasNote = notes >= 1;
  const briefReachable = hasClient && hasNote;
  sendJson(res, 200, {
    hasClient,
    hasNote,
    briefReachable,
    seeded,
    bookScanReady: seeded, // once seeded, the Day-One Book Scan can fire (P5-3b)
    nextStep: !hasClient
      ? 'Add your first client — your most important one.'
      : !hasNote
        ? "Export that client's WhatsApp chat and upload it — three taps, no typing."
        : 'Open a client and generate your first pre-meeting brief.',
    // Seeding is a WhatsApp EXPORT, never paste-based bulk data entry (the CRM
    // disease Tovira exists to kill).
    seeding: {
      primary: 'whatsapp_export',
      requiresPasteEntry: false,
      steps: {
        android: [
          'Open WhatsApp and pick your most important client’s chat.',
          'Tap ⋮ → More → Export chat → Without media.',
          'Share it straight to Tovira.',
        ],
        ios: [
          'Open WhatsApp and pick your most important client’s chat.',
          'Tap the contact name → Export Chat → Without Media → Save to Files.',
          'In Tovira, upload the saved .txt from Files.',
        ],
      },
    },
    // If they skip the export, don't leave them with an empty app.
    fallbacks: [
      { kind: 'voice_note', label: 'Record a 30-second voice note instead.' },
      { kind: 'sample_book', label: 'Explore a sample book to see how it works.' },
    ],
  });
  return true;
}
