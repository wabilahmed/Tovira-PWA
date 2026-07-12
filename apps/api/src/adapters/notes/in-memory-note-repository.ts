import { randomUUID } from 'node:crypto';
import type { NewNote, NotePatch, NoteRecord, NoteRepository } from '../../ports/note-repository.js';

/** In-memory note store mirroring the RLS isolation contract, for tests. */
export class InMemoryNoteRepository implements NoteRepository {
  private readonly byId = new Map<string, NoteRecord>();
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
      extracted: null,
      createdAt: Date.now() + this.seq++,
    };
    this.byId.set(record.id, record);
    return record;
  }

  async listByClient(userId: string, clientId: string): Promise<NoteRecord[]> {
    return [...this.byId.values()]
      .filter((n) => n.userId === userId && n.clientId === clientId)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  async findByIdForUser(userId: string, id: string): Promise<NoteRecord | null> {
    const note = this.byId.get(id);
    return note && note.userId === userId ? note : null;
  }

  async update(userId: string, id: string, patch: NotePatch): Promise<void> {
    const note = this.byId.get(id);
    if (!note || note.userId !== userId) return;
    if (patch.rawText !== undefined) note.rawText = patch.rawText;
    if (patch.status !== undefined) note.status = patch.status;
    if (patch.extracted !== undefined) note.extracted = patch.extracted;
  }
}
