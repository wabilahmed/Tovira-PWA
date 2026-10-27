import type { AuthService } from '../auth/auth-service.js';
import type { ClientRepository } from '../../ports/client-repository.js';
import type { NoteRepository } from '../../ports/note-repository.js';
import type { FactsRepository } from '../../ports/facts-repository.js';
import type { MeetingRepository } from '../../ports/meeting-repository.js';
import type { ImageRepository } from '../../ports/image-repository.js';
import type { RecallSessionRepository } from '../../ports/recall-session-repository.js';
import type { Storage } from '../../ports/storage.js';
import { restrictNote, noteIsAboutRestricted } from '../erasure/restrict-note.js';
import { factWithholder, withoutRestricted, type RestrictionSource } from '../erasure/surface-filter.js';
import { NO_RESTRICTION } from '../erasure/restriction.js';
import { liveNames } from '../clients/live-names.js';

/** [P48] The book's exact placeholder, on a restricted note in the export too. */
const NOTE_RESTRICTION_NOTICE = 'Restricted while a privacy request is reviewed.';
/** [P48] Said once, at the top of an export that withholds anything. */
export const EXPORT_RESTRICTION_NOTICE = 'Some data is restricted while a privacy request is reviewed. It is not deleted: it will be in your export again when the review ends, unless it is erased.';

export interface UserPurgeable {
  purgeUser(userId: string): Promise<void>;
}

/**
 * Data trust & control (P5-4). Export gives the rep the data they own — their clients, notes
 * (raw text/transcripts, with the extracted facts inside each note record), promises, key dates,
 * meetings, images, recall sessions, contact aliases, AND their operational extraction metadata
 * (extraction_logs + corrections + rep_glossary) [NO-TRAINING-RETENTION: these hold no conversation
 * content]. Delete removes it — on Postgres via FK cascade (incl. the extraction log + corrections)
 * and the purgeables list (rep_glossary), and in-memory via explicit purge — so it can't reappear in
 * briefs/search.
 *
 * Intentionally NOT in the export (operational/billing records, not rep content): notifications,
 * push subscriptions, daily priorities, the value + spend ledgers, email log, billing/subscription
 * rows, referrals, activation analytics. These are retained for operation/compliance; the export's
 * scope is the rep's content + their extracted facts + operational metadata, which is now complete.
 *
 * [P48 · owner] During a third-party erasure review the export withholds the restricted person like every other
 * surface (it used to keep their data, TASK 2): their messages and who-fields (restrictNote, flagged like the book),
 * promises, key dates and meetings read from them, pointers and glossary entries naming them, and Find turns about
 * them. Nothing is deleted; the export says data is withheld, and it all returns when the request is withdrawn or
 * rejected.
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
    /** [EXPORT-TRAINING → operational] the extraction log — operational metadata (no conversation
     *  content; [NO-TRAINING-RETENTION]). Still the rep's data, exported; purged on delete via the users
     *  FK cascade. */
    private readonly extractionLog?: { listByUser(userId: string): Promise<unknown[]> },
    /** rep verdicts on extracted facts — operational metadata (no before/after content). The rep's data. */
    private readonly corrections?: { listByUser(userId: string): Promise<unknown[]> },
    /** [NO-TRAINING-RETENTION] the per-rep glossary (P4-9) — the rep's operational data; exported here,
     *  purged on delete via the purgeables list. */
    private readonly repGlossary?: { listByUser(userId: string): Promise<unknown[]> },
    /** [MEDIA-DELETE] the MAIN blob store (audio + gallery images). The users FK cascade removes the
     *  note/image ROWS but NOT the S3 objects they point at, so account deletion must delete the blobs
     *  too — row-driven (the keys the rows hold), collected BEFORE the cascade, with a prefix sweep as a
     *  backstop for orphans. Absent → skipped (dev without a blob store). */
    private readonly blobStorage?: Pick<Storage, 'delete' | 'list'>,
    /** [POINTERS · D10] the rep's per-client pointer sets — carried in the DSAR export. Deletion is
     *  handled by the purgeables list (pg cascades too). */
    private readonly pointers?: { listByUser(userId: string): Promise<unknown[]> },
    /** [P18-10j] the rep's inventory items — their own data, carried in the export (deletion cascades on
     *  the users FK on pg). Absent → an empty inventory array. */
    private readonly inventory?: { listByUser(userId: string): Promise<unknown[]> },
    /** [P48] the active erasure restriction; absent → nothing withheld. */
    private readonly restriction?: RestrictionSource,
  ) {}

  async exportData(userId: string): Promise<unknown> {
    const r = this.restriction ? await this.restriction.forUser(userId) : NO_RESTRICTION;
    const clients = await this.clients.listByUser(userId);
    const live = await liveNames(this.clients, userId); // [P49] a stored move suggestion names the client as they are now
    const named = <N extends { moveSuggestion?: { toClientId: string | null; toClientName: string | null; reason: string } | null }>(n: N): N =>
      n.moveSuggestion ? { ...n, moveSuggestion: { ...n.moveSuggestion, toClientName: (n.moveSuggestion.toClientId && live.name(n.moveSuggestion.toClientId)) ?? n.moveSuggestion.toClientName, reason: live.rewrite(n.moveSuggestion.toClientId, n.moveSuggestion.reason) } } : n;
    const notes = [];
    const images = [];
    for (const c of clients) {
      // [P48] a restricted note reads as the book shows it: their part withheld, flagged with the book's notice
      for (const n of await this.notes.listByClient(userId, c.id)) {
        notes.push(named(r.active ? { ...restrictNote(n, r), ...(noteIsAboutRestricted(n, r) ? { restricted: true, restrictionNotice: NOTE_RESTRICTION_NOTICE } : {}) } : n));
      }
      // Image metadata + retrievable id — the "usable format" for the gallery
      // (each fetched from /images/:id). Completes the full-corpus export (P5-4).
      images.push(...(await this.images.listByClient(userId, c.id)));
    }
    // [P48] facts read from the restricted person (their quote, or the client is them) are withheld; mentions stay
    const names = new Map(clients.map((c) => [c.id, c.name]));
    const withheld = await factWithholder(userId, this.restriction, this.notes, (id) => names.get(id));
    const spanned = (x: { clientId: string; noteId: string | null; sourceSpan: string | null }) => ({ clientId: x.clientId, noteId: x.noteId, quote: x.sourceSpan });
    const recallSessions = await this.recallSessions.exportForUser(userId);
    const repGlossary = this.repGlossary ? ((await this.repGlossary.listByUser(userId)) as Array<{ wrongTerm: string; rightTerm: string }>) : [];
    const clientPointers = this.pointers ? ((await this.pointers.listByUser(userId)) as Array<{ clientId: string; pointers: Array<{ text: string }> }>) : [];
    return {
      exportedAt: new Date().toISOString(),
      ...(r.active ? { restrictionNotice: EXPORT_RESTRICTION_NOTICE } : {}),
      clients,
      notes, // raw text / transcripts live here
      // [P20-2] include soft-deleted promises (with their deleted_at) — the rep's own data in a DSAR.
      promises: await withoutRestricted(await this.facts.listPromisesByUser(userId, { includeDeleted: true }), withheld, spanned),
      keyDates: await withoutRestricted(await this.facts.listKeyDatesByUser(userId), withheld, spanned),
      meetings: await withoutRestricted(await this.meetings.listByUser(userId), withheld, spanned),
      images,
      recallSessions: r.active ? recallSessions.map((s) => ({ ...s, messages: s.messages.filter((m) => !r.restrictsText(m.content)) })) : recallSessions,
      // [P49] name records: an alias or a rename naming the restricted person is withheld during the review, like a
      // glossary entry naming them
      contactAliases: (this.aliases ? await this.aliases.listByUser(userId) : []).filter((a) => !(r.active && r.restrictsWho(a.alias))),
      // [P49] every rename of every client (old name, new name, when): the rep's record of what each client was called
      clientNameHistory: (await this.clients.listRenamesByUser(userId)).filter((h) => !(r.active && (r.restrictsWho(h.oldName) || r.restrictsWho(h.newName)))),
      // [NO-TRAINING-RETENTION] the rep's operational extraction metadata + verdicts (no content), and
      // their per-rep glossary — all the rep's own data, carried in a DSAR export.
      extractionLogs: this.extractionLog ? await this.extractionLog.listByUser(userId) : [],
      corrections: this.corrections ? await this.corrections.listByUser(userId) : [],
      repGlossary: r.active ? repGlossary.filter((g) => !r.restrictsText(`${g.wrongTerm} ${g.rightTerm}`)) : repGlossary,
      // [POINTERS · D10] the rep's per-client relationship/closing pointers.
      clientPointers: r.active
        ? clientPointers.map((set) => ({ ...set, pointers: r.restrictsWho(names.get(set.clientId) ?? '') ? [] : set.pointers.filter((p) => !r.restrictsText(p.text)) }))
        : clientPointers,
      // [P18-10j] the rep's inventory — their own data, previously missing from the export.
      inventory: this.inventory ? await this.inventory.listByUser(userId) : [],
    };
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
    await this.purgeBlobs(userId); // [MEDIA-DELETE] audio + image objects — keys read from rows BEFORE the cascade
    await this.recallSessions.purgeUser(userId); // pg also cascades on the users FK; explicit for in-memory
    for (const p of this.purgeables) await p.purgeUser(userId); // incl. rep_glossary ([NO-TRAINING-RETENTION])
    await this.auth.deleteUser(userId); // cascades hot extraction_logs + corrections + rep_glossary
  }

  /** Delete every archived training object for the rep, then its index rows. Attempts all objects and,
   *  if ANY failed, throws an aggregate error — a partial purge is REPORTED, never silently partial,
   *  and the index stays intact so a retry can complete it. */
  /**
   * [MEDIA-DELETE] Delete this rep's audio + gallery-image objects from blob storage.
   * PRIMARY (row-driven): the keys the DB rows hold, collected NOW — while the rows still exist, because
   *   the users FK cascade (auth.deleteUser, below) is about to remove them and a key lost to the
   *   cascade is unreachable forever. A row that knows its key is more reliable than guessing a prefix.
   * BACKSTOP (prefix sweep): catch orphans no row points at (e.g. from a prior partial deletion).
   * Known-key deletes are AWAITED — a failure fails the whole deletion (reported 500, retryable, with
   *   the rows + keys still intact). The backstop is BEST-EFFORT — a List failure (e.g. missing
   *   s3:ListBucket) is logged, never fatal, since the known blobs are already gone.
   */
  private async purgeBlobs(userId: string): Promise<void> {
    if (!this.blobStorage) return;
    const known = new Set<string>();
    for (const c of await this.clients.listByUser(userId)) {
      for (const n of await this.notes.listByClient(userId, c.id)) if (n.audioKey) known.add(n.audioKey);
      for (const img of await this.images.listByClient(userId, c.id)) known.add(img.storageKey);
    }
    for (const key of known) await this.blobStorage.delete(key);
    try {
      const orphans: string[] = [];
      // [BULK-IMPORT · FIX 2] staged (pre-review) chat uploads are this rep's third-party content too.
      for (const prefix of [`audio/${userId}/`, `images/${userId}/`, `bulk-import/${userId}/`]) orphans.push(...(await this.blobStorage.list(prefix)));
      for (const key of orphans) if (!known.has(key)) await this.blobStorage.delete(key);
    } catch (err) {
      console.warn(`[account-delete] blob prefix-sweep backstop failed for ${userId}; known-key blobs were deleted, orphans may remain`, err);
    }
  }

}
