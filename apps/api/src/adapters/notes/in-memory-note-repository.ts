import { randomUUID } from 'node:crypto';
import type { NewNote, NotePatch, NoteRecord, NoteRepository, SimilarNote } from '../../ports/note-repository.js';

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na === 0 || nb === 0 ? 0 : dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** In-memory note store mirroring the RLS isolation contract, for tests. */
export class InMemoryNoteRepository implements NoteRepository {
  private readonly byId = new Map<string, NoteRecord>();
  private readonly embeddings = new Map<string, number[]>();
  private seq = 0;

  async create(userId: string, note: NewNote): Promise<NoteRecord> {
    const record: NoteRecord = {
      id: randomUUID(),
      userId,
      clientId: note.clientId,
      source: note.source,
      rawText: note.rawText,
      audioKey: note.audioKey,
      status: note.status,
      sweepAttempts: 0,
      extracted: null,
      messages: note.messages ?? null,
      createdAt: Date.now() + this.seq++,
    };
    this.byId.set(record.id, record);
    return record;
  }

  async listByClient(userId: string, clientId: string): Promise<NoteRecord[]> {
    // [ASK-CAPTURE] pending-confirmation notes are held OUT of the vault at this single choke point
    // — every surface that lists a client's notes (brief, corpus, Monday, Book Scan, client detail)
    // excludes them here, so none can leak an unconfirmed statement. The capture queue reads them via
    // listByStatusForUser instead.
    return [...this.byId.values()]
      .filter((n) => n.userId === userId && n.clientId === clientId && n.status !== 'pending_confirmation')
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  async listPendingByUser(userId: string): Promise<NoteRecord[]> {
    return [...this.byId.values()]
      .filter((n) => n.userId === userId && (n.status === 'pending_transcription' || n.status === 'pending_extraction'))
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  async listByStatusForUser(userId: string, status: string): Promise<NoteRecord[]> {
    return [...this.byId.values()]
      .filter((n) => n.userId === userId && n.status === status)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  async findByIdForUser(userId: string, id: string): Promise<NoteRecord | null> {
    const note = this.byId.get(id);
    return note && note.userId === userId ? note : null;
  }

  async delete(userId: string, id: string): Promise<boolean> {
    const note = this.byId.get(id);
    if (!note || note.userId !== userId) return false;
    this.byId.delete(id);
    this.embeddings.delete(id);
    return true;
  }

  async update(userId: string, id: string, patch: NotePatch): Promise<void> {
    const note = this.byId.get(id);
    if (!note || note.userId !== userId) return;
    if (patch.rawText !== undefined) note.rawText = patch.rawText;
    if (patch.status !== undefined) note.status = patch.status;
    if (patch.sweepAttempts !== undefined) note.sweepAttempts = patch.sweepAttempts;
    if (patch.extracted !== undefined) note.extracted = patch.extracted;
    if (patch.messages !== undefined) note.messages = patch.messages;
    if (patch.embedding !== undefined) {
      if (patch.embedding === null) this.embeddings.delete(id);
      else this.embeddings.set(id, patch.embedding);
    }
  }

  async purgeUser(userId: string): Promise<void> {
    for (const [id, n] of this.byId) if (n.userId === userId) { this.byId.delete(id); this.embeddings.delete(id); }
  }

  async searchSimilar(
    userId: string,
    clientId: string,
    queryEmbedding: number[],
    limit: number,
  ): Promise<SimilarNote[]> {
    return [...this.byId.values()]
      .filter((n) => n.userId === userId && n.clientId === clientId && this.embeddings.has(n.id))
      .map((note) => ({ note, similarity: cosine(queryEmbedding, this.embeddings.get(note.id)!) }))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);
  }

  async searchSimilarByUser(userId: string, queryEmbedding: number[], limit: number): Promise<SimilarNote[]> {
    return [...this.byId.values()]
      .filter((n) => n.userId === userId && this.embeddings.has(n.id))
      .map((note) => ({ note, similarity: cosine(queryEmbedding, this.embeddings.get(note.id)!) }))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);
  }
}
