import { randomUUID } from 'node:crypto';
import type { CreateUserInput, UserRecord, UserRepository } from '../../ports/user-repository.js';

/** In-memory user store for tests and quick local runs. */
export class InMemoryUserRepository implements UserRepository {
  private readonly byId = new Map<string, UserRecord>();
  private readonly byEmail = new Map<string, string>();

  async findByEmail(email: string): Promise<UserRecord | null> {
    const id = this.byEmail.get(email);
    return id ? (this.byId.get(id) ?? null) : null;
  }

  async findById(id: string): Promise<UserRecord | null> {
    return this.byId.get(id) ?? null;
  }

  async create(input: CreateUserInput): Promise<UserRecord> {
    const record: UserRecord = {
      id: randomUUID(),
      email: input.email,
      passwordHash: input.passwordHash,
      createdAt: Date.now(),
    };
    this.byId.set(record.id, record);
    this.byEmail.set(record.email, record.id);
    return record;
  }

  async delete(id: string): Promise<void> {
    const rec = this.byId.get(id);
    if (rec) {
      this.byId.delete(id);
      this.byEmail.delete(rec.email);
    }
  }

  count(): number {
    return this.byId.size;
  }
}
