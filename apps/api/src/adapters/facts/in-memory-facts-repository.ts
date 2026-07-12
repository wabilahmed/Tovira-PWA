import { randomUUID } from 'node:crypto';
import type { FactsRepository, PromiseRecord, SaveExtractionInput } from '../../ports/facts-repository.js';

/** In-memory spine store mirroring the RLS isolation contract, for tests. */
export class InMemoryFactsRepository implements FactsRepository {
  private promises: PromiseRecord[] = [];

  async saveExtraction(userId: string, input: SaveExtractionInput): Promise<void> {
    // Idempotent per note: drop this note's existing promises, then insert.
    this.promises = this.promises.filter((p) => !(p.userId === userId && p.noteId === input.noteId));
    for (const promise of input.promises) {
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
        createdAt: Date.now(),
      });
    }
  }

  async listPromisesByUser(userId: string): Promise<PromiseRecord[]> {
    return this.promises.filter((p) => p.userId === userId);
  }

  async listPromisesByNote(userId: string, noteId: string): Promise<PromiseRecord[]> {
    return this.promises.filter((p) => p.userId === userId && p.noteId === noteId);
  }
}
