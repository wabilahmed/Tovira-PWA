import type { AuthService } from '../auth/auth-service.js';
import type { ClientRepository } from '../../ports/client-repository.js';
import type { NoteRepository } from '../../ports/note-repository.js';
import type { FactsRepository } from '../../ports/facts-repository.js';
import type { MeetingRepository } from '../../ports/meeting-repository.js';
import type { ImageRepository } from '../../ports/image-repository.js';
import type { RecallSessionRepository } from '../../ports/recall-session-repository.js';
import type { ArchiveIndexRepository } from '../../ports/archive-index-repository.js';
import type { Storage } from '../../ports/storage.js';

export interface UserPurgeable {
  purgeUser(userId: string): Promise<void>;
}

const dec = new TextDecoder();

/**
 * Data trust & control (P5-4). Export gives the rep the data they own — their clients, notes
 * (raw text/transcripts, with the extracted facts inside each note record), promises, key dates,
 * meetings, images, recall sessions, contact aliases, AND the training log (extraction_logs +
 * corrections) [EXPORT-TRAINING]. Delete removes it — on Postgres via FK cascade (incl. the training
 * log), and in-memory via explicit purge — so it can't reappear in briefs/search/training.
 *
 * Intentionally NOT in the export (operational/billing records, not rep content): notifications,
 * push subscriptions, daily priorities, the value + spend ledgers, email log, billing/subscription
 * rows, referrals, activation analytics. These are retained for operation/compliance and are
 * audited in TRAINING-FIX-REPORT.md; the export's scope is the rep's content + extracted/training
 * data, which is now complete.
 */
export class AccountService {
  constructor(
    private readonly auth: AuthService,
    private readonly clients: ClientRepository,
    private readonly notes: NoteRepository,
    private readonly facts: FactsRepository,
    private readonly meetings: MeetingRepository,
    private readonly images: ImageRepository,
    /** Ask conversation sessions (ASK-SESSION) — the rep's own data: exported + purged. */
    private readonly recallSessions: RecallSessionRepository,
    private readonly purgeables: UserPurgeable[],
    /** Sends the deletion confirmation. Called BEFORE the purge (the address is
     *  about to be erased); a failing send never blocks or rolls back delete. */
    private readonly onDeleted?: (userId: string, email: string) => Promise<void>,
    /** [ALIAS] learned contact aliases — the rep's own data, included in export. */
    private readonly aliases?: { listByUser(userId: string): Promise<Array<{ clientId: string; alias: string }>> },
    /** [EXPORT-TRAINING] the extraction training log — the highest-concentration PII store in the
     *  product, retained specifically to train on. It is the rep's data and MUST export (it was
     *  silently omitted, a false "all their data" claim in a DSAR context). Purged on delete via the
     *  users FK cascade, like every other tenant table. */
    private readonly extractionLog?: { listByUser(userId: string): Promise<unknown[]> },
    /** [EXPORT-TRAINING] rep corrections — the human verdicts on extracted facts. The rep's data. */
    private readonly corrections?: { listByUser(userId: string): Promise<unknown[]> },
    /** [TRAINING-DELETE] the archive index + blob store. Needed because archived training rows live in
     *  object storage, which the FK cascade does NOT reach — they must be purged and exported
     *  explicitly. Absent → no archive (in-memory/dev without archival); behaves as before. */
    private readonly archiveIndex?: ArchiveIndexRepository,
    private readonly archiveStorage?: Pick<Storage, 'get' | 'delete'>,
  ) {}

  async exportData(userId: string): Promise<unknown> {
    const clients = await this.clients.listByUser(userId);
    const notes = [];
    const images = [];
    for (const c of clients) {
      notes.push(...(await this.notes.listByClient(userId, c.id)));
      // Image metadata + retrievable id — the "usable format" for the gallery
      // (each fetched from /images/:id). Completes the full-corpus export (P5-4).
      images.push(...(await this.images.listByClient(userId, c.id)));
    }
    return {
      exportedAt: new Date().toISOString(),
      clients,
      notes, // raw text / transcripts live here
      promises: await this.facts.listPromisesByUser(userId),
      keyDates: await this.facts.listKeyDatesByUser(userId),
      meetings: await this.meetings.listByUser(userId),
      images,
      recallSessions: await this.recallSessions.exportForUser(userId),
      contactAliases: this.aliases ? await this.aliases.listByUser(userId) : [],
      // [EXPORT-TRAINING] the training corpus this rep generated — raw inputs, model outputs, and the
      // human verdicts on them. The highest-concentration PII they own; a DSAR export must carry it.
      extractionLogs: this.extractionLog ? await this.extractionLog.listByUser(userId) : [],
      corrections: this.corrections ? await this.corrections.listByUser(userId) : [],
      // [TRAINING-DELETE] archived training rows live in object storage, not the hot tables — "all
      // their data" must include them too, or the export silently omits everything older than the
      // archive age.
      archivedTraining: await this.readArchivedRows(userId),
    };
  }

  /** Read back this rep's archived training rows from object storage (via the index). Best-effort per
   *  object — a single unreadable archive object must not sink the whole export. */
  private async readArchivedRows(userId: string): Promise<unknown[]> {
    if (!this.archiveIndex || !this.archiveStorage) return [];
    const objects = await this.archiveIndex.listByUser(userId);
    const out: unknown[] = [];
    for (const obj of objects) {
      try {
        const text = dec.decode(await this.archiveStorage.get(obj.objectKey)).trim();
        for (const line of text.split('\n')) if (line.trim()) out.push(JSON.parse(line));
      } catch (err) {
        console.warn(`[account] export: archive object ${obj.objectKey} unreadable: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return out;
  }

  async deleteAccount(userId: string): Promise<void> {
    // Confirm BEFORE the purge — the email is about to be erased. A failing send
    // must never block or roll back the deletion (1d), so it is fully isolated.
    if (this.onDeleted) {
      try {
        const user = await this.auth.getPublicUser(userId);
        if (user) await this.onDeleted(userId, user.email);
      } catch (err) {
        console.warn(`[account] delete-confirmation email failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    // [TRAINING-DELETE] Purge archived training objects FIRST — they live in object storage, which the
    // users FK cascade does NOT reach. Do it before deleteUser so that if any object delete fails, the
    // index + user remain intact and the purge is retryable (never a silent partial that orphans PII).
    await this.purgeArchive(userId);
    await this.recallSessions.purgeUser(userId); // pg also cascades on the users FK; explicit for in-memory
    for (const p of this.purgeables) await p.purgeUser(userId);
    await this.auth.deleteUser(userId); // cascades hot extraction_logs + corrections + the archive index
  }

  /** Delete every archived training object for the rep, then its index rows. Attempts all objects and,
   *  if ANY failed, throws an aggregate error — a partial purge is REPORTED, never silently partial,
   *  and the index stays intact so a retry can complete it. */
  private async purgeArchive(userId: string): Promise<void> {
    if (!this.archiveIndex || !this.archiveStorage) return;
    const objects = await this.archiveIndex.listByUser(userId);
    const failed: string[] = [];
    for (const obj of objects) {
      try {
        await this.archiveStorage.delete(obj.objectKey);
      } catch (err) {
        failed.push(`${obj.objectKey} (${err instanceof Error ? err.message : String(err)})`);
      }
    }
    if (failed.length > 0) {
      throw new Error(`[account] archive purge incomplete for ${userId}: ${failed.length}/${objects.length} objects not deleted — ${failed.join('; ')}`);
    }
    await this.archiveIndex.deleteByUser(userId); // objects gone → drop the index (pg also cascades)
  }
}
