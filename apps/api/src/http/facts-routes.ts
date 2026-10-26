import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AuthService } from '../services/auth/auth-service.js';
import type { FactsRepository, PromisePatch } from '../ports/facts-repository.js';
import type { NoteRepository } from '../ports/note-repository.js';
import type { CorrectionRepository } from '../ports/correction-repository.js';
import type { RepGlossaryRepository } from '../ports/rep-glossary-repository.js';
import type { ExtractionLogRepository } from '../ports/extraction-log-repository.js';
import type { LedgerService } from '../services/ledger/ledger-service.js';
import type { MeetingRepository } from '../ports/meeting-repository.js';
import { pendingConfirmations } from '../services/facts/confirmation.js';
import { isStalePromise } from '../services/facts/promise-lifecycle.js';
import { recordVerdict } from '../services/facts/verdict.js';
import { resolveDueDate, resolveDateTime } from '../services/extraction/resolve-date.js';
import { withinDateCardWindow } from '../services/facts/date-confirm-window.js';
import { meetingDay } from '../services/facts/meeting-day.js';
import { withReceipt } from '../services/receipts/receipt.js';
import { isValidDateOnly } from './validate-date.js';
import { BadJsonError, extractToken, readJsonBody, sendJson } from './helpers.js';

export interface FactsRouteDeps {
  auth: AuthService;
  facts: FactsRepository;
  corrections: CorrectionRepository;
  extractionLog: ExtractionLogRepository;
  /** [NO-TRAINING-RETENTION] operational per-rep glossary — edit verdicts upsert term pairs here. */
  glossary?: RepGlossaryRepository;
  ledger?: LedgerService;
  /** NUDGE-UNCONFIRMED: unconfirmed proposed meetings ride the same confirmation queue. */
  meetings?: MeetingRepository;
  /** MISFILE-POST (B2): notes with a pending move-suggestion ride the same queue. */
  notes?: NoteRepository;
  /** [PROMISE-STALE] days overdue after which an open promise is tagged stale in the tracker (the UI
   *  keeps it behind a filter and out of the active count/claret). Defaults to 90 when unset (tests). */
  promiseStaleThresholdDays?: number;
  /** [P34-2] Client names for the To Confirm cards (optional: absent → no clientName). */
  clients?: Pick<import('../ports/client-repository.js').ClientRepository, 'listByUser'>;
}

const CONFIRM_RE = /^\/promises\/([^/]+)\/confirm$/;
const DONE_RE = /^\/promises\/([^/]+)\/done$/;
const RESTORE_RE = /^\/promises\/([^/]+)\/restore$/; // [P20-2] Undo a soft delete
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
  const restoreMatch = method === 'POST' ? RESTORE_RE.exec(path) : null;
  const promiseMatch = method === 'PATCH' || method === 'DELETE' ? PROMISE_RE.exec(path) : null;
  if (!isConfirmations && !isTracker && !confirmMatch && !doneMatch && !restoreMatch && !promiseMatch) return false;

  const identity = await deps.auth.authenticate(extractToken(req));
  if (!identity) {
    sendJson(res, 401, { error: 'unauthorized' });
    return true;
  }
  const userId = identity.userId;

  if (isConfirmations) {
    const promises = await deps.facts.listPromisesByUser(userId);
    // [AUDIT item 3] `meetings` is KEPT — a test contract (NUDGE-UNCONFIRMED) reads the unconfirmed
    // proposed-meetings queue here, so it counts as "something reads it". Only /today's groups scan was
    // the clearly-dead work that was removed.
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
    // [P34-2] Every To Confirm card names its client.
    const names = deps.clients ? new Map((await deps.clients.listByUser(userId)).map((c) => [c.id, c.name])) : null;
    const named = <T extends { clientId: string | null }>(r: T) => (names ? { ...r, clientName: r.clientId ? names.get(r.clientId) ?? null : null } : r);
    // [P40-1] Promises whose date the resolver couldn't read, for the rep to answer — with a suggested date only
    // when the resolver (re-reading the phrase against its own message) now has one. Never the model's date.
    const datesToConfirm = promises
      .filter((p) => p.dateStatus === 'to_confirm' && !p.done && p.dueDate === null && withinDateCardWindow(p.sourceMessageAt ?? p.captureAt ?? p.createdAt, Date.now()))
      .map((p) => ({ ...named(withReceipt(p)), suggestedDate: resolveDueDate(p.dueRaw, p.sourceMessageAt ?? p.captureAt).date }));
    // [P40-1 · owner] meetings the resolver couldn't time get the same question card (same 90-day limit)
    const meetingDatesToConfirm = deps.meetings
      ? (await deps.meetings.listByUser(userId))
          .filter((m) => m.dateStatus === 'to_confirm' && m.datetime === null && withinDateCardWindow(m.sourceMessageAt ?? m.captureAt ?? m.createdAt, Date.now()))
          .map((m) => ({ ...named(withReceipt(m)), suggestedDatetime: resolveDateTime(m.datetimeRaw, m.sourceMessageAt ?? m.captureAt).datetime, day: meetingDay(m) }))
      : [];
    sendJson(res, 200, { promises: pendingConfirmations(promises).map(withReceipt).map(named), meetings: meetings.map(withReceipt), moveSuggestions, datesToConfirm, meetingDatesToConfirm });
    return true;
  }

  if (isTracker) {
    // Open promises across ALL clients, sorted by due date (no-date last). [PROMISE-STALE] each is
    // tagged `stale` (overdue past the window) — the tracker still LISTS them (searchable, behind a
    // filter) but the active count and claret key off `!stale`. Storage is untouched.
    const threshold = deps.promiseStaleThresholdDays ?? 90;
    const now = Date.now();
    const all = await deps.facts.listPromisesByUser(userId);
    const open = all.filter((p) => !p.done);
    open.sort(byDueDate);
    // [P46-6b] Every row names its client; done promises are listed for the Done chip (newest due first, at most 100);
    // the window is sent so the "Older than N days" chip says the real number.
    const names = deps.clients ? new Map((await deps.clients.listByUser(userId)).map((c) => [c.id, c.name])) : null;
    const named = <T extends { clientId: string | null }>(r: T) => ({ ...r, clientName: r.clientId && names ? names.get(r.clientId) ?? null : null });
    const promises = open.map((p) => named({ ...withReceipt(p), stale: isStalePromise(p, now, threshold) }));
    const done = all.filter((p) => p.done).sort((a, b) => (b.dueDate ?? '').localeCompare(a.dueDate ?? '')).slice(0, 100).map((p) => named(withReceipt(p)));
    sendJson(res, 200, { promises, done, staleThresholdDays: threshold });
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
        verdict: 'confirm',
        field: '',
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

  // [P20-2 / BOOK-09] POST /promises/:id/restore — Undo a soft delete within the window.
  if (restoreMatch) {
    const ok = await deps.facts.restorePromise(userId, decodeURIComponent(restoreMatch[1]!));
    sendJson(res, ok ? 200 : 404, ok ? { ok: true } : { error: 'not_found' });
    return true;
  }

  // PATCH or DELETE /promises/:id
  const id = decodeURIComponent(promiseMatch![1]!);

  if (method === 'DELETE') {
    // [P20-2 / BOOK-09] SOFT delete — undoable for 10s, hard-deleted after 30 days. The row leaves every
    // surface at once (listPromisesByUser filters deleted) but stays recoverable. Reject is still the
    // single most informative training row (the model produced this and a human said NO), captured
    // BEFORE the soft-delete. [CORRECTIONS-WIRE]
    const rejected = await deps.facts.getPromise(userId, id);
    const ok = await deps.facts.softDeletePromise(userId, id, Date.now());
    if (ok && rejected) {
      await recordVerdict(deps, userId, {
        noteId: rejected.noteId,
        entityType: 'promise',
        entityId: id,
        verdict: 'reject',
        field: '',
      });
    }
    // No orphaned value claims while it's off the surfaces: drop any ledger entry (P4-11). An Undo within
    // the window restores the promise; a value-touch is re-earned on the next keep, not resurrected here.
    if (ok && deps.ledger) await deps.ledger.removeBySource(userId, id);
    sendJson(res, ok ? 200 : 404, ok ? { ok: true } : { error: 'not_found' });
    return true;
  }

  // PATCH: edit + record the verdict (edit) and inferred kind — no before/after content retained.
  try {
    const before = await deps.facts.getPromise(userId, id);
    if (!before) {
      sendJson(res, 404, { error: 'not_found' });
      return true;
    }
    const body = (await readJsonBody(req)) as Record<string, unknown>;
    // [P18-6] Reject an invalid due date BEFORE any write — never let a malformed/empty value overwrite a
    // real stored date (data loss) or reach the DB (500). null is a valid explicit clear.
    if ('dueDate' in body) {
      const v = body.dueDate;
      if (v !== null && !(typeof v === 'string' && isValidDateOnly(v))) {
        sendJson(res, 400, { error: 'bad_request', message: 'Invalid due date.' });
        return true;
      }
    }
    // [P40-1] The answer to "When is it due?": a date (dueDate, above), or "Not sure" / "No due date".
    if ('dateStatus' in body && body.dateStatus !== 'not_sure' && body.dateStatus !== 'no_due_date') {
      sendJson(res, 400, { error: 'bad_request', message: 'Invalid date answer.' });
      return true;
    }
    const patch: PromisePatch = {};
    if (body.dateStatus === 'not_sure' || body.dateStatus === 'no_due_date') patch.dateStatus = body.dateStatus;
    else if (typeof body.dueDate === 'string') patch.dateStatus = null; // a date answers it
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
        { noteId: before.noteId, entityType: 'promise', entityId: id, verdict: 'edit', field: logField, before: beforeVal, after },
        promptVersion,
      );
    }
    await deps.facts.updatePromise(userId, id, patch);
    const updated = await deps.facts.getPromise(userId, id);
    sendJson(res, 200, updated ? withReceipt(updated) : updated);
    return true;
  } catch (err) {
    if (err instanceof BadJsonError) {
      sendJson(res, 400, { error: 'bad_request', message: 'Invalid request body.' });
      return true;
    }
    throw err;
  }
}
