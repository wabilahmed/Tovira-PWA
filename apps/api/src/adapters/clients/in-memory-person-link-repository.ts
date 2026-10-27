import { randomUUID } from 'node:crypto';
import type { NewPersonLinkQuestion, PersonLinkQuestion, PersonLinkRepository } from '../../ports/person-link-repository.js';

/** [P50-2] In-memory person-link questions, mirroring the one-per-pair key and tenant isolation. */
export class InMemoryPersonLinkRepository implements PersonLinkRepository {
  private rows: Array<PersonLinkQuestion & { userId: string }> = [];

  async askOnce(userId: string, q: NewPersonLinkQuestion): Promise<boolean> {
    if (this.rows.some((r) => r.userId === userId && r.clientId === q.clientId && r.personKey === q.personKey)) return false;
    this.rows.push({ ...q, id: randomUUID(), userId, status: 'pending', createdAt: Date.now() });
    return true;
  }

  async listPending(userId: string): Promise<PersonLinkQuestion[]> {
    return this.rows.filter((r) => r.userId === userId && r.status === 'pending').sort((a, b) => b.createdAt - a.createdAt).map(({ userId: _u, ...r }) => { void _u; return { ...r }; });
  }

  async findById(userId: string, id: string): Promise<PersonLinkQuestion | null> {
    const r = this.rows.find((x) => x.userId === userId && x.id === id);
    if (!r) return null;
    const { userId: _u, ...rest } = r; void _u;
    return { ...rest };
  }

  async answer(userId: string, id: string, status: 'same' | 'different'): Promise<boolean> {
    const r = this.rows.find((x) => x.userId === userId && x.id === id && x.status === 'pending');
    if (!r) return false;
    r.status = status;
    return true;
  }

  async purgeUser(userId: string): Promise<void> {
    this.rows = this.rows.filter((r) => r.userId !== userId);
  }
}
