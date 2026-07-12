import type { AuthService } from '../auth/auth-service.js';
import type { ClientRepository } from '../../ports/client-repository.js';
import type { NoteRepository } from '../../ports/note-repository.js';
import type { FactsRepository } from '../../ports/facts-repository.js';
import type { MeetingRepository } from '../../ports/meeting-repository.js';

export interface UserPurgeable {
  purgeUser(userId: string): Promise<void>;
}

/**
 * Data trust & control (P5-4). Export gives the rep all their data; delete
 * removes it — on Postgres via FK cascade (incl. the training log), and
 * in-memory via explicit purge — so it can't reappear in briefs/search/training.
 */
export class AccountService {
  constructor(
    private readonly auth: AuthService,
    private readonly clients: ClientRepository,
    private readonly notes: NoteRepository,
    private readonly facts: FactsRepository,
    private readonly meetings: MeetingRepository,
    private readonly purgeables: UserPurgeable[],
  ) {}

  async exportData(userId: string): Promise<unknown> {
    const clients = await this.clients.listByUser(userId);
    const notes = [];
    for (const c of clients) notes.push(...(await this.notes.listByClient(userId, c.id)));
    return {
      exportedAt: new Date().toISOString(),
      clients,
      notes,
      promises: await this.facts.listPromisesByUser(userId),
      keyDates: await this.facts.listKeyDatesByUser(userId),
      meetings: await this.meetings.listByUser(userId),
    };
  }

  async deleteAccount(userId: string): Promise<void> {
    for (const p of this.purgeables) await p.purgeUser(userId);
    await this.auth.deleteUser(userId);
  }
}
