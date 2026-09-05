import { randomUUID } from 'node:crypto';
import { cosine } from '../vector.js';
import type {
  RequirementRepository,
  RequirementRecord,
  RequirementInput,
  RequirementStatus,
  SimilarRequirement,
} from '../../ports/requirement-repository.js';

/** In-memory requirements spine, mirroring the RLS isolation contract — retains vectors (unlike the
 *  inventory in-memory adapter) so the reverse match direction can search them. For tests. */
export class InMemoryRequirementRepository implements RequirementRepository {
  private rows: Array<RequirementRecord & { vector: number[] | null }> = [];
  private seq = 0;

  private view(r: RequirementRecord & { vector: number[] | null }): RequirementRecord {
    const rest: RequirementRecord & { vector?: number[] | null } = { ...r };
    delete rest.vector; // the raw vector never leaves the repo (mirrors inventory `embedded`)
    return rest;
  }

  async saveForNote(userId: string, noteId: string, clientId: string, reqs: RequirementInput[]): Promise<RequirementRecord[]> {
    // Idempotent per note: drop this note's existing requirement rows first.
    this.rows = this.rows.filter((r) => !(r.userId === userId && r.noteId === noteId));
    const now = Date.now();
    const created: RequirementRecord[] = [];
    for (const req of reqs) {
      const row: RequirementRecord & { vector: number[] | null } = {
        id: randomUUID(),
        userId,
        noteId,
        clientId,
        text: req.text,
        requirementRaw: req.requirementRaw,
        statedOn: req.statedOn,
        confidence: req.confidence,
        status: 'open',
        embedded: req.embedding !== null,
        lastMentionedAt: now + this.seq++,
        createdAt: now + this.seq++,
        vector: req.embedding,
      };
      this.rows.push(row);
      created.push(this.view(row));
    }
    return created;
  }

  async listByClient(userId: string, clientId: string): Promise<RequirementRecord[]> {
    return this.rows.filter((r) => r.userId === userId && r.clientId === clientId).sort((a, b) => b.createdAt - a.createdAt).map((r) => this.view(r));
  }

  async listOpenByUser(userId: string): Promise<RequirementRecord[]> {
    return this.rows.filter((r) => r.userId === userId && r.status === 'open').map((r) => this.view(r));
  }

  async findByIdForUser(userId: string, id: string): Promise<RequirementRecord | null> {
    const r = this.rows.find((x) => x.userId === userId && x.id === id);
    return r ? this.view(r) : null;
  }

  async setStatus(userId: string, id: string, status: RequirementStatus): Promise<void> {
    const r = this.rows.find((x) => x.userId === userId && x.id === id);
    if (r) r.status = status;
  }

  async markMentioned(userId: string, id: string, at: number): Promise<void> {
    const r = this.rows.find((x) => x.userId === userId && x.id === id);
    if (r) {
      r.lastMentionedAt = at;
      if (r.status === 'dormant') r.status = 'open'; // a fresh mention revives a dormant need
    }
  }

  async searchByEmbedding(userId: string, queryEmbedding: number[], limit: number): Promise<SimilarRequirement[]> {
    return this.rows
      .filter((r) => r.userId === userId && r.status === 'open' && r.vector !== null)
      .map((r) => ({ requirement: this.view(r), similarity: cosine(queryEmbedding, r.vector!) }))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);
  }

  async markDormantBefore(userId: string, cutoffMs: number): Promise<number> {
    let n = 0;
    for (const r of this.rows) {
      if (r.userId === userId && r.status === 'open' && r.lastMentionedAt < cutoffMs) {
        r.status = 'dormant';
        n += 1;
      }
    }
    return n;
  }

  async purgeUser(userId: string): Promise<void> {
    this.rows = this.rows.filter((r) => r.userId !== userId);
  }
}
