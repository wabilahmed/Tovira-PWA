import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AuthService } from '../services/auth/auth-service.js';
import type { ClientRepository } from '../ports/client-repository.js';
import type { NoteRepository } from '../ports/note-repository.js';
import type { Storage } from '../ports/storage.js';
import type { TranscriptionService } from '../services/transcription/transcription-service.js';
import type { ExtractionService } from '../services/extraction/extraction-service.js';
import type { FollowUpService } from '../services/followup/follow-up-service.js';
import { parseWhatsAppExport } from '../services/import/whatsapp.js';
import { BadJsonError, extractToken, readJsonBody, readRawBody, sendJson } from './helpers.js';

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
  const audioMatch = method === 'GET' ? AUDIO_RE.exec(path) : null;
  const transcribeMatch = method === 'POST' ? TRANSCRIBE_RE.exec(path) : null;
  const extractMatch = method === 'POST' ? EXTRACT_RE.exec(path) : null;
  const followUpMatch = method === 'POST' ? FOLLOWUP_RE.exec(path) : null;
  if (!voiceMatch && !pasteMatch && !importMatch && !listMatch && !audioMatch && !transcribeMatch && !extractMatch && !followUpMatch) return false;

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
      // Persist the raw file FIRST, then parse. A parse failure flags this note;
      // messages are written only on a WHOLE success — never a half-import.
      const note = await deps.notes.create(userId, {
        clientId,
        source: 'whatsapp_export',
        rawText: content,
        audioKey: null,
        status: 'importing',
      });
      let parsed;
      try {
        parsed = parseWhatsAppExport(content);
      } catch {
        parsed = { ok: false as const, reason: 'The export could not be parsed.' };
      }
      if (!parsed.ok) {
        await deps.notes.update(userId, note.id, { status: 'import_failed' });
        sendJson(res, 422, { error: 'import_failed', reason: parsed.reason });
        return true;
      }
      await deps.notes.update(userId, note.id, {
        messages: parsed.messages,
        status: 'pending_extraction',
      });
      await deps.clients.touch(userId, clientId);
      // Batch-extract the imported thread, exactly like any other captured input.
      await deps.extraction.extractNote(userId, note.id, todayIso());
      const updated = await deps.notes.findByIdForUser(userId, note.id);
      sendJson(res, 201, { note: updated, imported: parsed.messages.length });
      return true;
    }

    if (listMatch) {
      const clientId = decodeURIComponent(listMatch[1]!);
      sendJson(res, 200, { notes: await deps.notes.listByClient(userId, clientId) });
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
