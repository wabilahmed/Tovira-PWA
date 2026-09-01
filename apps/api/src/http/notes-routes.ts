import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AuthService } from '../services/auth/auth-service.js';
import type { ClientRepository } from '../ports/client-repository.js';
import type { NoteRepository } from '../ports/note-repository.js';
import type { Storage } from '../ports/storage.js';
import type { TranscriptionService } from '../services/transcription/transcription-service.js';
import type { ExtractionService } from '../services/extraction/extraction-service.js';
import type { FollowUpService } from '../services/followup/follow-up-service.js';
import type { NotificationRepository } from '../ports/notification-repository.js';
import type { LedgerService } from '../services/ledger/ledger-service.js';
import type { BillingService } from '../services/billing/billing-service.js';
import { parseWhatsAppExport } from '../services/import/whatsapp.js';
import { assignSpeakerRoles } from '../services/import/unanswered.js';
import { dedupeMessages, renderThread } from '../services/import/dedup.js';
import { BadJsonError, extractToken, readJsonBody, readRawBody, sendJson, requireEntitled } from './helpers.js';

const MAX_PASTE_CHARS = 100_000;
const MAX_IMPORT_CHARS = 5_000_000; // a full multi-year chat export

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export interface NoteRouteDeps {
  auth: AuthService;
  clients: ClientRepository;
  notes: NoteRepository;
  storage: Storage;
  transcription: TranscriptionService;
  extraction: ExtractionService;
  followUp: FollowUpService;
  notifications?: NotificationRepository;
  ledger?: LedgerService;
  billing?: BillingService;
}

/** Ledger (P4-11): capturing a note for a client that a scan flagged (going cold
 *  or chat-refresh) is a real "thread reopened" value-touch — once per flag. */
async function recordReopenIfFlagged(deps: NoteRouteDeps, userId: string, clientId: string): Promise<void> {
  if (!deps.ledger || !deps.notifications) return;
  const flag = (await deps.notifications.listByUser(userId)).find(
    (n) => n.clientId === clientId && (n.type === 'going_cold' || n.type === 'chat_refresh'),
  );
  if (flag) {
    await deps.ledger.record(userId, { type: 'thread_reopened', clientId, sourceId: flag.id, dedupeKey: `reopen:${flag.id}`, occurredAt: Date.now() });
  }
}

/** Count the rep's clients that have at least one note — the exact signal that
 *  earns the P5-1 extension, shared with the incentive display so the two agree. */
export async function countDistinctClientsWithNotes(
  clients: ClientRepository,
  notes: NoteRepository,
  userId: string,
): Promise<number> {
  let distinct = 0;
  for (const c of await clients.listByUser(userId)) {
    if ((await notes.listByClient(userId, c.id)).length > 0) distinct += 1;
  }
  return distinct;
}

/** Activity-gated trial extension (P5-1): notes on 3+ distinct clients → +7 days
 *  once. Enforced server-side, on the capture path — never client-triggerable. */
async function maybeExtendTrial(deps: NoteRouteDeps, userId: string): Promise<void> {
  if (!deps.billing) return;
  const distinct = await countDistinctClientsWithNotes(deps.clients, deps.notes, userId);
  await deps.billing.extendTrialForActivity(userId, distinct);
}

const VOICE_RE = /^\/clients\/([^/]+)\/notes\/voice$/;
const PASTE_RE = /^\/clients\/([^/]+)\/notes\/paste$/;
const IMPORT_RE = /^\/clients\/([^/]+)\/notes\/import$/;
const LIST_RE = /^\/clients\/([^/]+)\/notes$/;
const AUDIO_RE = /^\/notes\/([^/]+)\/audio$/;
const TRANSCRIBE_RE = /^\/notes\/([^/]+)\/transcribe$/;
const EXTRACT_RE = /^\/notes\/([^/]+)\/extract$/;
const FOLLOWUP_RE = /^\/notes\/([^/]+)\/follow-up$/;

/** Handle /clients/:id/notes* and /notes/:id/audio. Returns true if handled. */
export async function handleNoteRoute(
  req: IncomingMessage,
  res: ServerResponse,
  deps: NoteRouteDeps,
): Promise<boolean> {
  const method = req.method ?? 'GET';
  const path = (req.url ?? '/').split('?')[0]!;

  const voiceMatch = method === 'POST' ? VOICE_RE.exec(path) : null;
  const pasteMatch = method === 'POST' ? PASTE_RE.exec(path) : null;
  const importMatch = method === 'POST' ? IMPORT_RE.exec(path) : null;
  const listMatch = method === 'GET' ? LIST_RE.exec(path) : null;
  const pendingMatch = method === 'GET' && path === '/notes/pending';
  const audioMatch = method === 'GET' ? AUDIO_RE.exec(path) : null;
  const transcribeMatch = method === 'POST' ? TRANSCRIBE_RE.exec(path) : null;
  const extractMatch = method === 'POST' ? EXTRACT_RE.exec(path) : null;
  const followUpMatch = method === 'POST' ? FOLLOWUP_RE.exec(path) : null;
  if (!voiceMatch && !pasteMatch && !importMatch && !listMatch && !pendingMatch && !audioMatch && !transcribeMatch && !extractMatch && !followUpMatch) return false;

  const identity = await deps.auth.authenticate(extractToken(req));
  if (!identity) {
    sendJson(res, 401, { error: 'unauthorized' });
    return true;
  }
  const userId = identity.userId;

  try {
    if (voiceMatch) {
      const clientId = decodeURIComponent(voiceMatch[1]!);
      // The client must belong to the caller (guards IDOR + attribution).
      const client = await deps.clients.findByIdForUser(userId, clientId);
      if (!client) {
        sendJson(res, 404, { error: 'not_found' });
        return true;
      }
      const audio = await readRawBody(req);
      if (audio.length === 0) {
        sendJson(res, 400, { error: 'validation', message: 'No audio was uploaded.' });
        return true;
      }
      const audioKey = `audio/${userId}/${randomUUID()}.webm`;
      await deps.storage.put(audioKey, new Uint8Array(audio));
      const note = await deps.notes.create(userId, {
        clientId,
        source: 'voice',
        rawText: null,
        audioKey,
        status: 'pending_transcription',
      });
      await deps.clients.touch(userId, clientId); // bump recency
      await recordReopenIfFlagged(deps, userId, clientId);
      await maybeExtendTrial(deps, userId);
      sendJson(res, 201, note);
      return true;
    }

    if (pasteMatch) {
      const clientId = decodeURIComponent(pasteMatch[1]!);
      const client = await deps.clients.findByIdForUser(userId, clientId);
      if (!client) {
        sendJson(res, 404, { error: 'not_found' });
        return true;
      }
      const body = (await readJsonBody(req)) as { text?: unknown };
      const text = typeof body.text === 'string' ? body.text : '';
      if (!text.trim()) {
        sendJson(res, 400, { error: 'validation', message: 'A message is required.' });
        return true;
      }
      if (text.length > MAX_PASTE_CHARS) {
        sendJson(res, 413, {
          error: 'too_large',
          message: `Message is too long (max ${MAX_PASTE_CHARS.toLocaleString()} characters). Split it into smaller notes.`,
        });
        return true;
      }
      // Stored verbatim — emojis and line breaks preserved. Queued for extraction.
      const note = await deps.notes.create(userId, {
        clientId,
        source: 'paste',
        rawText: text,
        audioKey: null,
        status: 'pending_extraction',
      });
      await deps.clients.touch(userId, clientId);
      await recordReopenIfFlagged(deps, userId, clientId);
      await maybeExtendTrial(deps, userId);
      sendJson(res, 201, note);
      return true;
    }

    if (importMatch) {
      const clientId = decodeURIComponent(importMatch[1]!);
      const client = await deps.clients.findByIdForUser(userId, clientId);
      if (!client) {
        sendJson(res, 404, { error: 'not_found' });
        return true;
      }
      const body = (await readJsonBody(req)) as { content?: unknown; consent?: unknown };
      // A full export contains everything in the chat — require explicit consent.
      if (body.consent !== true) {
        sendJson(res, 400, {
          error: 'consent_required',
          message: 'A WhatsApp export contains the entire chat. Confirm consent before importing.',
        });
        return true;
      }
      const content = typeof body.content === 'string' ? body.content : '';
      if (!content.trim()) {
        sendJson(res, 400, { error: 'validation', message: 'The export file is empty.' });
        return true;
      }
      if (content.length > MAX_IMPORT_CHARS) {
        sendJson(res, 413, {
          error: 'too_large',
          message: `Export is too large (max ${MAX_IMPORT_CHARS.toLocaleString()} characters).`,
        });
        return true;
      }
      let parsed;
      try {
        parsed = parseWhatsAppExport(content);
      } catch {
        parsed = { ok: false as const, reason: 'The export could not be parsed.' };
      }
      if (!parsed.ok) {
        // Preserve the raw file, flagged — a parse failure is never a half-import.
        await deps.notes.create(userId, { clientId, source: 'whatsapp_export', rawText: content, audioKey: null, status: 'import_failed' });
        sendJson(res, 422, { error: 'import_failed', reason: parsed.reason });
        return true;
      }
      // Dedupe against everything already imported for this client (P3-7): a
      // re-export overlaps the last one, so store overlapping messages once and
      // extract only the new tail. An identical re-import adds nothing.
      const priorNotes = await deps.notes.listByClient(userId, clientId);
      const existing = priorNotes.flatMap((n) => n.messages ?? []);
      const fresh = dedupeMessages(existing, parsed.messages);
      if (fresh.length === 0) {
        sendJson(res, 200, { note: null, imported: 0, duplicate: true });
        return true;
      }
      // Tag each speaker as client/rep so the extractor can flag unanswered
      // client questions (P1-6). Store ONLY the new slice.
      const messages = assignSpeakerRoles(fresh, client.name);
      const note = await deps.notes.create(userId, {
        clientId,
        source: 'whatsapp_export',
        rawText: renderThread(messages),
        audioKey: null,
        status: 'pending_extraction',
        messages,
      });
      await deps.clients.touch(userId, clientId);
      // IMPORT-ASYNC: the chat + its messages are now durably stored. Extraction is
      // an unbounded LLM call — running it inline blew the ~30s gateway timeout (a
      // 504) for anything past a tiny chat. So we return immediately with the note
      // 'pending_extraction'; the NoteSweepService drains it in the background, the
      // same seam paste uses. The client polls note status. A failed extraction
      // never half-writes: messages stay stored, facts are written atomically on
      // success, and the sweep retries. The trial ceiling is discovered by the
      // sweep (the note simply stays pending), not computed here.
      sendJson(res, 202, { note, imported: fresh.length, status: note.status });
      return true;
    }

    if (listMatch) {
      const clientId = decodeURIComponent(listMatch[1]!);
      sendJson(res, 200, { notes: await deps.notes.listByClient(userId, clientId) });
      return true;
    }

    // The resume path: every note still awaiting transcription/extraction, across
    // all the rep's clients, so the app can advance them on load (FLOWS-5).
    if (pendingMatch) {
      sendJson(res, 200, { notes: await deps.notes.listPendingByUser(userId) });
      return true;
    }

    if (transcribeMatch) {
      const noteId = decodeURIComponent(transcribeMatch[1]!);
      const note = await deps.notes.findByIdForUser(userId, noteId);
      if (!note) {
        sendJson(res, 404, { error: 'not_found' });
        return true;
      }
      const outcome = await deps.transcription.transcribeNote(userId, noteId);
      const updated = await deps.notes.findByIdForUser(userId, noteId);
      sendJson(res, 200, { note: updated, ...outcome });
      return true;
    }

    if (extractMatch) {
      const noteId = decodeURIComponent(extractMatch[1]!);
      const note = await deps.notes.findByIdForUser(userId, noteId);
      if (!note) {
        sendJson(res, 404, { error: 'not_found' });
        return true;
      }
      const outcome = await deps.extraction.extractNote(userId, noteId, todayIso());
      const updated = await deps.notes.findByIdForUser(userId, noteId);
      sendJson(res, 200, { note: updated, ...outcome });
      return true;
    }

    if (followUpMatch) {
      // Follow-up drafting is premium (capture itself stays free); gate it.
      if (deps.billing && !(await requireEntitled(deps.billing, userId, res))) return true;
      // Draft only — never sends. Returns editable text for the rep.
      const result = await deps.followUp.draft(userId, decodeURIComponent(followUpMatch[1]!));
      if (!result) {
        sendJson(res, 404, { error: 'not_found' });
        return true;
      }
      sendJson(res, 200, result);
      return true;
    }

    if (audioMatch) {
      const noteId = decodeURIComponent(audioMatch[1]!);
      const note = await deps.notes.findByIdForUser(userId, noteId);
      if (!note || !note.audioKey || !(await deps.storage.exists(note.audioKey))) {
        sendJson(res, 404, { error: 'not_found' });
        return true;
      }
      const bytes = await deps.storage.get(note.audioKey);
      res.writeHead(200, { 'content-type': 'audio/webm', 'content-length': String(bytes.byteLength) });
      res.end(Buffer.from(bytes));
      return true;
    }

    return false;
  } catch (err) {
    if (err instanceof BadJsonError) {
      sendJson(res, 400, { error: 'bad_request', message: 'Invalid request body.' });
      return true;
    }
    throw err;
  }
}
