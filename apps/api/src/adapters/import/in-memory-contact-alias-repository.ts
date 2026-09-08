import type { ContactAliasRepository, RepNameRepository } from '../../ports/contact-alias-repository.js';

const norm = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, ' ');

/** In-memory client-alias store (tests + local). Keyed userId → clientId → set of aliases. */
export class InMemoryContactAliasRepository implements ContactAliasRepository {
  private readonly rows: Array<{ userId: string; clientId: string; alias: string }> = [];

  async add(userId: string, clientId: string, alias: string): Promise<void> {
    const a = alias.trim();
    if (!a) return;
    if (this.rows.some((r) => r.userId === userId && r.clientId === clientId && norm(r.alias) === norm(a))) return;
    this.rows.push({ userId, clientId, alias: a });
  }

  async listByClient(userId: string, clientId: string): Promise<string[]> {
    return this.rows.filter((r) => r.userId === userId && r.clientId === clientId).map((r) => r.alias);
  }

  async listByUser(userId: string): Promise<Array<{ clientId: string; alias: string }>> {
    return this.rows.filter((r) => r.userId === userId).map((r) => ({ clientId: r.clientId, alias: r.alias }));
  }

  async purgeUser(userId: string): Promise<void> {
    for (let i = this.rows.length - 1; i >= 0; i--) if (this.rows[i]!.userId === userId) this.rows.splice(i, 1);
  }
}

/** In-memory rep-name store (tests + local). */
export class InMemoryRepNameRepository implements RepNameRepository {
  private readonly names = new Map<string, string>();
  async get(userId: string): Promise<string | null> {
    return this.names.get(userId) ?? null;
  }
  async set(userId: string, whatsappName: string): Promise<void> {
    const n = whatsappName.trim();
    if (n) this.names.set(userId, n);
  }
  async purgeUser(userId: string): Promise<void> {
    this.names.delete(userId);
  }
}
