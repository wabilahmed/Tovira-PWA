import type { KeptSuggestionRepository } from '../../ports/kept-suggestion-repository.js';
import type { FactsRepository } from '../../ports/facts-repository.js';
import type { ClientRepository } from '../../ports/client-repository.js';
import type { ImportedMessage } from '../../ports/note-repository.js';
import type { ExtractedPromise } from '../extraction/types.js';
import { deliveryFor } from '../extraction/windowed.js';
import { promiseDedupeKey } from '../facts/promise-identity.js';

/**
 * [P24-2] Kept promises are a SUGGESTION, never an automatic completion. After a chat is extracted (single
 * pass or windowed — the same code), a promise whose owner later says it was delivered gets a To Confirm
 * suggestion with BOTH receipts; the promise stays open everywhere until the rep taps Mark done (undoable).
 * "Not yet" dismisses it, and that delivery message never suggests again (a new one can). No model call.
 */
export interface KeptSuggestionView {
  id: string;
  promiseId: string;
  clientId: string;
  clientName: string;
  message: string;
  promise: { quote: string; date: string | null };
  delivery: { quote: string; date: string };
}

const PAST: Record<string, string> = {
  send: 'sent', share: 'shared', email: 'emailed', forward: 'forwarded', drop: 'dropped', deliver: 'delivered', submit: 'submitted',
  provide: 'provided', give: 'gave', pass: 'passed', return: 'returned', confirm: 'confirmed', book: 'booked', pay: 'paid',
};
const WITH = new Set(['share']);

/** "Looks like you sent the options to QA P14 Gate Client. Mark done?" — built only from the promise text. */
export function keptSuggestionCopy(owner: 'rep' | 'client' | string, text: string, clientName: string): string {
  const t = text.trim().replace(/[.!]+$/, '');
  const [verb, ...rest] = t.split(/\s+/);
  const past = verb ? PAST[verb.toLowerCase()] : undefined;
  if (owner === 'client') return past ? `Looks like ${clientName} ${past} ${rest.join(' ')}. Mark done?` : `Looks like ${clientName} did this: "${t}". Mark done?`;
  if (!past) return `Looks like you did this for ${clientName}: "${t}". Mark done?`;
  return `Looks like you ${past} ${rest.join(' ')} ${WITH.has(verb!.toLowerCase()) ? 'with' : 'to'} ${clientName}. Mark done?`;
}

const day = (at: string | null): string | null => (at ? at.slice(0, 10) : null);

export class KeptSuggestionService {
  constructor(private readonly deps: {
    suggestions: KeptSuggestionRepository;
    facts: Pick<FactsRepository, 'listPromisesByUser' | 'markPromiseDone' | 'reopenPromise'>;
    clients: Pick<ClientRepository, 'listByUser'>;
    now?: () => number;
  }) {}

  /** After a chat's extraction is saved: suggest each delivered promise once per delivery message. */
  async detect(userId: string, clientId: string, noteId: string, promises: ExtractedPromise[], messages: ImportedMessage[]): Promise<number> {
    let created = 0;
    for (const p of promises) {
      const key = promiseDedupeKey(p.owner, p.text);
      const seen = await this.deps.suggestions.deliveryTimes(userId, clientId, key);
      const d = deliveryFor(p, messages, seen);
      if (!d) continue;
      if (await this.deps.suggestions.createIfAbsent(userId, {
        clientId, noteId, promiseKey: key, promiseOwner: p.owner, promiseText: p.text,
        promiseSpan: p.source_span ?? null, promiseAt: p.source_message_at ?? null, deliveryAt: d.at, deliveryBody: d.body.slice(0, 500),
      })) created += 1;
    }
    return created;
  }

  /** The OPEN promise row a suggestion currently points at (by client + key), or null (done / gone). */
  private async currentPromise(userId: string, clientId: string, key: string, includeDone = false) {
    const all = await this.deps.facts.listPromisesByUser(userId);
    return all.find((p) => p.clientId === clientId && p.mergedInto === null && (includeDone || !p.done) && promiseDedupeKey(p.owner, p.text) === key) ?? null;
  }

  /** Open suggestions whose promise is still open, with both receipts and the copy. */
  async listOpen(userId: string): Promise<KeptSuggestionView[]> {
    const [rows, clients] = await Promise.all([this.deps.suggestions.listOpen(userId), this.deps.clients.listByUser(userId)]);
    const nameOf = new Map(clients.map((c) => [c.id, c.name]));
    const out: KeptSuggestionView[] = [];
    for (const r of rows) {
      const p = await this.currentPromise(userId, r.clientId, r.promiseKey);
      if (!p) continue;
      const clientName = nameOf.get(r.clientId) ?? 'your client';
      out.push({
        id: r.id, promiseId: p.id, clientId: r.clientId, clientName,
        message: keptSuggestionCopy(r.promiseOwner, r.promiseText, clientName),
        promise: { quote: r.promiseSpan ?? r.promiseText, date: day(r.promiseAt) },
        delivery: { quote: r.deliveryBody, date: day(r.deliveryAt)! },
      });
    }
    return out;
  }

  /** Mark done: the rep's say-so closes the promise. Undoable via undo(). */
  async markDone(userId: string, id: string): Promise<boolean> {
    const r = await this.deps.suggestions.get(userId, id);
    if (!r || r.status !== 'open') return false;
    const p = await this.currentPromise(userId, r.clientId, r.promiseKey);
    if (!p || !(await this.deps.facts.markPromiseDone(userId, p.id))) return false;
    return this.deps.suggestions.setStatus(userId, id, 'accepted', (this.deps.now ?? Date.now)());
  }

  /** Undo a Mark done: the promise is open again and the suggestion is back in To Confirm. */
  async undo(userId: string, id: string): Promise<boolean> {
    const r = await this.deps.suggestions.get(userId, id);
    if (!r || r.status !== 'accepted') return false;
    const p = await this.currentPromise(userId, r.clientId, r.promiseKey, true);
    if (p && p.done) await this.deps.facts.reopenPromise(userId, p.id);
    return this.deps.suggestions.setStatus(userId, id, 'open', (this.deps.now ?? Date.now)());
  }

  /** Not yet: dismissed — this delivery message never suggests again; a new one can. */
  async notYet(userId: string, id: string): Promise<boolean> {
    const r = await this.deps.suggestions.get(userId, id);
    if (!r || r.status !== 'open') return false;
    return this.deps.suggestions.setStatus(userId, id, 'dismissed', (this.deps.now ?? Date.now)());
  }

  /** Book Scan / surfaces: "clientId|promiseKey" of promises with an open suggestion. */
  async openKeys(userId: string): Promise<Set<string>> {
    return new Set((await this.deps.suggestions.listOpen(userId)).map((r) => `${r.clientId}|${r.promiseKey}`));
  }
}
