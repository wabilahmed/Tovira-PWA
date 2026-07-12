import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AuthService } from '../services/auth/auth-service.js';
import type { FactsRepository, PromisePatch } from '../ports/facts-repository.js';
import type { CorrectionRepository } from '../ports/correction-repository.js';
import { pendingConfirmations } from '../services/facts/confirmation.js';
import { BadJsonError, extractToken, readJsonBody, sendJson } from './helpers.js';

export interface FactsRouteDeps {
  auth: AuthService;
  facts: FactsRepository;
  corrections: CorrectionRepository;
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
    sendJson(res, 200, { promises: pendingConfirmations(promises) });
    return true;
  }

  if (isTracker) {
    // Open promises across ALL clients, sorted by due date (no-date last).
    const open = (await deps.facts.listPromisesByUser(userId)).filter((p) => !p.done);
    open.sort(byDueDate);
    sendJson(res, 200, { promises: open });
    return true;
  }

  if (confirmMatch) {
    const ok = await deps.facts.confirmPromise(userId, decodeURIComponent(confirmMatch[1]!));
    sendJson(res, ok ? 200 : 404, ok ? { ok: true } : { error: 'not_found' });
    return true;
  }

  if (doneMatch) {
    const ok = await deps.facts.markPromiseDone(userId, decodeURIComponent(doneMatch[1]!));
    sendJson(res, ok ? 200 : 404, ok ? { ok: true } : { error: 'not_found' });
    return true;
  }

  // PATCH or DELETE /promises/:id
  const id = decodeURIComponent(promiseMatch![1]!);

  if (method === 'DELETE') {
    // Reject: remove the item so it never surfaces again for that note.
    const ok = await deps.facts.deletePromise(userId, id);
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
    for (const [key, logField, beforeVal] of fields) {
      if (!(key in body)) continue;
      const after = body[key] === null ? null : String(body[key]);
      if (after === beforeVal) continue; // no change → no correction (no double-count)
      (patch as Record<string, unknown>)[key] = after;
      await deps.corrections.record(userId, {
        noteId: before.noteId,
        entityType: 'promise',
        entityId: id,
        field: logField,
        before: beforeVal,
        after,
      });
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
