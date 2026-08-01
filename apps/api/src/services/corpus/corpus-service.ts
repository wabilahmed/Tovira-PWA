import type { ClientRepository } from '../../ports/client-repository.js';
import type { NoteRepository } from '../../ports/note-repository.js';

/**
 * Corpus-value visibility (P4-10): "X months, Y moments". Recomputed from stored
 * data every call — never a cached counter — so deleting content decrements it
 * and failed imports never count. A "moment" is a captured note or an imported
 * message; the span is the calendar range those moments cover.
 */

export interface CorpusStats {
  months: number;
  moments: number;
}

function monthsBetween(earliestMs: number, latestMs: number): number {
  const a = new Date(earliestMs);
  const b = new Date(latestMs);
  const months = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
  return Math.max(0, months);
}

export class CorpusStatsService {
  constructor(
    private readonly clients: ClientRepository,
    private readonly notes: NoteRepository,
  ) {}

  async compute(userId: string): Promise<CorpusStats> {
    const clients = await this.clients.listByUser(userId);
    let moments = 0;
    const times: number[] = [];

    for (const c of clients) {
      for (const n of await this.notes.listByClient(userId, c.id)) {
        if (n.status === 'import_failed') continue; // a failed import is not a moment
        if (n.source === 'whatsapp_export' && n.messages) {
          moments += n.messages.length;
          for (const m of n.messages) {
            const t = m.sentAt ? Date.parse(m.sentAt) : n.createdAt;
            if (!Number.isNaN(t)) times.push(t);
          }
        } else {
          moments += 1;
          times.push(n.createdAt);
        }
      }
    }

    if (times.length === 0) return { months: 0, moments: 0 };
    return { months: monthsBetween(Math.min(...times), Math.max(...times)), moments };
  }
}
