import { randomUUID } from 'node:crypto';
import { promiseDedupeKey } from './dedupe.js';
import type {
  FactsRepository,
  PromiseRecord,
  PromisePatch,
  KeyDateRecord,
  SaveExtractionInput,
} from '../../ports/facts-repository.js';

/** In-memory spine store mirroring the RLS isolation contract, for tests. */
export class InMemoryFactsRepository implements FactsRepository {
  private promises: PromiseRecord[] = [];
  private keyDates: KeyDateRecord[] = [];

  async saveExtraction(userId: string, input: SaveExtractionInput): Promise<void> {
    // Idempotent per note: drop this note's existing spine rows first. Mirror the
    // Postgres FK ON DELETE SET NULL — any promise that was merged INTO a row we are
    // removing is promoted back to a canonical (its mergedInto → null).
    const removed = new Set(
      this.promises.filter((p) => p.userId === userId && p.noteId === input.noteId).map((p) => p.id),
    );
    this.promises = this.promises.filter((p) => !(p.userId === userId && p.noteId === input.noteId));
    for (const p of this.promises) if (p.mergedInto !== null && removed.has(p.mergedInto)) p.mergedInto = null;
    this.keyDates = this.keyDates.filter((d) => !(d.userId === userId && d.noteId === input.noteId));
    for (const kd of input.keyDates ?? []) {
      this.keyDates.push({
        id: randomUUID(),
        userId,
        noteId: input.noteId,
        clientId: input.clientId,
        description: kd.description,
        date: kd.date,
        dateRaw: kd.date_raw,
        type: kd.type,
        createdAt: Date.now(),
      });
    }
    for (const promise of input.promises) {
      // Strict write-time dedup: an OPEN canonical for this (user, client) with the
      // same owner + normalized text is the same commitment. Link this note to it
      // instead of creating a second tracker row; a done promise is not a target.
      const key = promiseDedupeKey(promise.owner, promise.text);
      const canonical = this.promises.find(
        (p) =>
          p.userId === userId &&
          p.clientId === input.clientId &&
          p.mergedInto === null &&
          !p.done &&
          promiseDedupeKey(p.owner, p.text) === key,
      );
      this.promises.push({
        id: randomUUID(),
        userId,
        noteId: input.noteId,
        clientId: input.clientId,
        text: promise.text,
        owner: promise.owner,
        dueDate: promise.due_date,
        dueRaw: promise.due_raw,
        confidence: promise.confidence,
        done: false,
        doneAt: null,
        confirmed: false,
        mergedInto: canonical ? canonical.id : null,
        createdAt: Date.now(),
      });
      // Specific date wins: a duplicate that carries a resolved date fills the
      // canonical's null date (the second source genuinely adds information).
      if (canonical && canonical.dueDate === null && promise.due_date !== null) {
        canonical.dueDate = promise.due_date;
        canonical.dueRaw = promise.due_raw;
      }
    }
  }

  async confirmPromise(userId: string, id: string): Promise<boolean> {
    const p = this.promises.find((x) => x.userId === userId && x.id === id);
    if (!p) return false;
    p.confirmed = true;
    return true;
  }

  async getPromise(userId: string, id: string): Promise<PromiseRecord | null> {
    return this.promises.find((x) => x.userId === userId && x.id === id) ?? null;
  }

  async updatePromise(userId: string, id: string, patch: PromisePatch): Promise<boolean> {
    const p = this.promises.find((x) => x.userId === userId && x.id === id);
    if (!p) return false;
    if (patch.text !== undefined) p.text = patch.text;
    if (patch.owner !== undefined) p.owner = patch.owner;
    if (patch.dueDate !== undefined) p.dueDate = patch.dueDate;
    if (patch.dueRaw !== undefined) p.dueRaw = patch.dueRaw;
    if (patch.confidence !== undefined) p.confidence = patch.confidence;
    if (patch.done !== undefined) p.done = patch.done;
    return true;
  }

  async deletePromise(userId: string, id: string): Promise<boolean> {
    const before = this.promises.length;
    this.promises = this.promises.filter((x) => !(x.userId === userId && x.id === id));
    return this.promises.length < before;
  }

  async markPromiseDone(userId: string, id: string): Promise<boolean> {
    const p = this.promises.find((x) => x.userId === userId && x.id === id);
    if (!p) return false;
    p.done = true;
    p.doneAt = Date.now();
    return true;
  }

  async purgeUser(userId: string): Promise<void> {
    this.promises = this.promises.filter((p) => p.userId !== userId);
    this.keyDates = this.keyDates.filter((d) => d.userId !== userId);
  }

  async listKeyDatesByUser(userId: string): Promise<KeyDateRecord[]> {
    return this.keyDates.filter((d) => d.userId === userId);
  }

  async listPromisesByUser(userId: string): Promise<PromiseRecord[]> {
    // Tracker + every counting surface: canonicals only, so a deduped commitment
    // appears once everywhere (B2-9).
    return this.promises.filter((p) => p.userId === userId && p.mergedInto === null);
  }

  async listPromisesByNote(userId: string, noteId: string): Promise<PromiseRecord[]> {
    return this.promises.filter((p) => p.userId === userId && p.noteId === noteId);
  }
}
