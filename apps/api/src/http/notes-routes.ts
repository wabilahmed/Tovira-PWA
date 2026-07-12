import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AuthService } from '../services/auth/auth-service.js';
import type { ClientRepository } from '../ports/client-repository.js';
import type { NoteRepository } from '../ports/note-repository.js';
import type { Storage } from '../ports/storage.js';
import type { TranscriptionService } from '../services/transcription/transcription-service.js';
import type { ExtractionService } from '../services/extraction/extraction-service.js';
import { BadJsonError, extractToken, readJsonBody, readRawBody, sendJson } from './helpers.js';

const MAX_PASTE_CHARS = 100_000;

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
}

const VOICE_RE = /^\/clients\/([^/]+)\/notes\/voice$/;
const PASTE_RE = /^\/clients\/([^/]+)\/notes\/paste$/;
const LIST_RE = /^\/clients\/([^/]+)\/notes$/;
const AUDIO_RE = /^\/notes\/([^/]+)\/audio$/;
const TRANSCRIBE_RE = /^\/notes\/([^/]+)\/transcribe$/;
const EXTRACT_RE = /^\/notes\/([^/]+)\/extract$/;

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
  const listMatch = method === 'GET' ? LIST_RE.exec(path) : null;
  const audioMatch = method === 'GET' ? AUDIO_RE.exec(path) : null;
  const transcribeMatch = method === 'POST' ? TRANSCRIBE_RE.exec(path) : null;
  const extractMatch = method === 'POST' ? EXTRACT_RE.exec(path) : null;
  if (!voiceMatch && !pasteMatch && !listMatch && !audioMatch && !transcribeMatch && !extractMatch) return false;

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
