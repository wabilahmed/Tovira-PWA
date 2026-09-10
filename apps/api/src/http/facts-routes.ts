import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AuthService } from '../services/auth/auth-service.js';
import type { FactsRepository, PromisePatch } from '../ports/facts-repository.js';
import type { NoteRepository } from '../ports/note-repository.js';
import type { CorrectionRepository } from '../ports/correction-repository.js';
import type { ExtractionLogRepository } from '../ports/extraction-log-repository.js';
import type { LedgerService } from '../services/ledger/ledger-service.js';
import type { MeetingRepository } from '../ports/meeting-repository.js';
import { pendingConfirmations } from '../services/facts/confirmation.js';
import { isStalePromise } from '../services/facts/promise-lifecycle.js';
import { recordVerdict, serialisePromise, REJECTED_FIELD, CONFIRMED_FIELD } from '../services/facts/verdict.js';
import { BadJsonError, extractToken, readJsonBody, sendJson } from './helpers.js';

export interface FactsRouteDeps {
  auth: AuthService;
  facts: FactsRepository;
  corrections: CorrectionRepository;
  extractionLog: ExtractionLogRepository;
  ledger?: LedgerService;
  /** NUDGE-UNCONFIRMED: unconfirmed proposed meetings ride the same confirmation queue. */
  meetings?: MeetingRepository;
  /** MISFILE-POST (B2): notes with a pending move-suggestion ride the same queue. */
  notes?: NoteRepository;
  /** [PROMISE-STALE] days overdue after which an open promise is tagged stale in the tracker (the UI
   *  keeps it behind a filter and out of the active count/claret). Defaults to 90 when unset (tests). */
  promiseStaleThresholdDays?: number;
}

const CONFIRM_RE = /^\/promises\/([^/]+)\/confirm$/;
const DONE_RE = /^\/promises\/([^/]+)\/done$/;
const PROMISE_RE = /^\/promises\/([^/]+)$/;

function byDueDate(a: { dueDate: string | null }, b: { dueDate: string | null }): number {
  if (a.dueDate === null && b.dueDate === null) return 0;
  if (a.dueDate === null) return 1; // no-date items sort last, not as if due today
  if (b.dueDate === null) return -1;
  return a.dueDate.localeCompare(b.dueDate);
}

/** Handle /confirmations and /promises/:id[/confirm]. Returns true if handled. */
export async function handleFactsRoute(
  req: IncomingMessage,
  res: ServerResponse,
  deps: FactsRouteDeps,
): Promise<boolean> {
  const method = req.method ?? 'GET';
  const path = (req.url ?? '/').split('?')[0]!;

  const isConfirmations = method === 'GET' && path === '/confirmations';
  const isTracker = method === 'GET' && path === '/promises';
  const confirmMatch = method === 'POST' ? CONFIRM_RE.exec(path) : null;
  const doneMatch = method === 'POST' ? DONE_RE.exec(path) : null;
  const promiseMatch = method === 'PATCH' || method === 'DELETE' ? PROMISE_RE.exec(path) : null;
  if (!isConfirmations && !isTracker && !confirmMatch && !doneMatch && !promiseMatch) return false;

  const identity = await deps.auth.authenticate(extractToken(req));
  if (!identity) {
    sendJson(res, 401, { error: 'unauthorized' });
    return true;
  }
  const userId = identity.userId;

  if (isConfirmations) {
    const promises = await deps.facts.listPromisesByUser(userId);
    // Unconfirmed proposed meetings sit in the same queue — "unconfirmed — is this right?".
    const meetings = deps.meetings ? await deps.meetings.listUnconfirmedByUser(userId) : [];
    // MISFILE-POST (B2): a note that looks like it belongs to another client rides here too — a
    // soft "Move it?" the rep resolves. Never auto-applied.
    const moveNotes = deps.notes ? await deps.notes.listMoveSuggestionsByUser(userId) : [];
    const moveSuggestions = moveNotes.map((n) => ({
      noteId: n.id,
      fromClientId: n.clientId,
      toClientId: n.moveSuggestion?.toClientId ?? null,
      toClientName: n.moveSuggestion?.toClientName ?? null,
      mentioned: n.moveSuggestion?.mentioned ?? [],
      reason: n.moveSuggestion?.reason ?? '',
    }));
    sendJson(res, 200, { promises: pendingConfirmations(promises), meetings, moveSuggestions });
    return true;
  }

  if (isTracker) {
    // Open promises across ALL clients, sorted by due date (no-date last). [PROMISE-STALE] each is
    // tagged `stale` (overdue past the window) — the tracker still LISTS them (searchable, behind a
    // filter) but the active count and claret key off `!stale`. Storage is untouched.
    const threshold = deps.promiseStaleThresholdDays ?? 90;
    const now = Date.now();
    const open = (await deps.facts.listPromisesByUser(userId)).filter((p) => !p.done);
    open.sort(byDueDate);
    const promises = open.map((p) => ({ ...p, stale: isStalePromise(p, now, threshold) }));
    sendJson(res, 200, { promises });
    return true;
  }

  if (confirmMatch) {
    const promiseId = decodeURIComponent(confirmMatch[1]!);
    // Capture the confirmed value BEFORE we flip the flag — a confirmed (esp. low-confidence) item
    // is training signal: the model was uncertain and a human said it was right. [CORRECTIONS-WIRE]
    const confirmed = await deps.facts.getPromise(userId, promiseId);
    const ok = await deps.facts.confirmPromise(userId, promiseId);
    if (ok && confirmed) {
      await recordVerdict(deps, userId, {
        noteId: confirmed.noteId,
        entityType: 'promise',
        entityId: promiseId,
        field: CONFIRMED_FIELD,
        before: serialisePromise(confirmed),
        after: 'confirmed',
      });
    }
    sendJson(res, ok ? 200 : 404, ok ? { ok: true } : { error: 'not_found' });
    return true;
  }

  if (doneMatch) {
    const promiseId = decodeURIComponent(doneMatch[1]!);
    const promise = await deps.facts.getPromise(userId, promiseId);
    const ok = await deps.facts.markPromiseDone(userId, promiseId);
    // Ledger (P4-11): a promise KEPT ON TIME is a real value-touch. Only when it
    // was done on/before its due date — flagging or lateness is never "value".
    if (ok && deps.ledger && promise?.dueDate) {
      const today = new Date().toISOString().slice(0, 10);
      if (today <= promise.dueDate) {
        await deps.ledger.record(userId, { type: 'promise_kept', clientId: promise.clientId, sourceId: promiseId, dedupeKey: `kept:${promiseId}`, occurredAt: Date.now() });
      }
    }
    sendJson(res, ok ? 200 : 404, ok ? { ok: true } : { error: 'not_found' });
    return true;
  }

  // PATCH or DELETE /promises/:id
  const id = decodeURIComponent(promiseMatch![1]!);

  if (method === 'DELETE') {
    // Reject — the single most informative training row: the model produced this and a human said
    // NO. Capture the ORIGINAL value BEFORE deleting (after = null), then delete exactly as before.
    // [CORRECTIONS-WIRE]
    const rejected = await deps.facts.getPromise(userId, id);
    const ok = await deps.facts.deletePromise(userId, id);
    if (ok && rejected) {
      await recordVerdict(deps, userId, {
        noteId: rejected.noteId,
        entityType: 'promise',
        entityId: id,
        field: REJECTED_FIELD,
        before: serialisePromise(rejected),
        after: null,
      });
    }
    // No orphaned value claims: dropping the promise removes any ledger entry (P4-11).
    if (ok && deps.ledger) await deps.ledger.removeBySource(userId, id);
    sendJson(res, ok ? 200 : 404, ok ? { ok: true } : { error: 'not_found' });
    return true;
  }

  // PATCH: edit + record before/after as training data.
  try {
    const before = await deps.facts.getPromise(userId, id);
    if (!before) {
      sendJson(res, 404, { error: 'not_found' });
      return true;
    }
    const body = (await readJsonBody(req)) as Record<string, unknown>;
    const patch: PromisePatch = {};
    const fields: Array<[keyof PromisePatch, string, string | null]> = [
      ['text', 'text', before.text],
      ['owner', 'owner', before.owner],
      ['dueDate', 'due_date', before.dueDate],
      ['dueRaw', 'due_raw', before.dueRaw],
      ['confidence', 'confidence', before.confidence],
    ];
    // Resolve the prompt version that produced this fact once, up front (P7-2).
    // null if the note was never logged — we never fabricate a version.
    const promptVersion = await deps.extractionLog.findPromptVersionByNote(userId, before.noteId);
    for (const [key, logField, beforeVal] of fields) {
      if (!(key in body)) continue;
      const after = body[key] === null ? null : String(body[key]);
      if (after === beforeVal) continue; // no change → no correction (no double-count)
      (patch as Record<string, unknown>)[key] = after;
      // Isolated: a failed correction write must never break the rep's edit. [CORRECTIONS-WIRE]
      await recordVerdict(
        deps,
        userId,
        { noteId: before.noteId, entityType: 'promise', entityId: id, field: logField, before: beforeVal, after },
        promptVersion,
      );
    }
    await deps.facts.updatePromise(userId, id, patch);
    sendJson(res, 200, await deps.facts.getPromise(userId, id));
    return true;
  } catch (err) {
    if (err instanceof BadJsonError) {
      sendJson(res, 400, { error: 'bad_request', message: 'Invalid request body.' });
      return true;
    }
    throw err;
  }
}
