import type { NoteRepository } from '../../ports/note-repository.js';
import type { FactsRepository } from '../../ports/facts-repository.js';
import type { MeetingRepository } from '../../ports/meeting-repository.js';
import type { ClientRepository } from '../../ports/client-repository.js';
import type { NoteMoveAuditRepository, NoteMoveCounts } from '../../ports/note-move-audit-repository.js';
import type { NoteMoveTx, MoveOutcome, UndoOutcome } from '../../ports/note-move-tx.js';
import type { RequirementRepository } from '../../ports/requirement-repository.js';
import type { InventoryMatchRepository } from '../../ports/inventory-match-repository.js';

/** Steps a fault can be injected after — the seam that proves the move is atomic (test-only). */
export type MoveStep = 'facts' | 'requirements' | 'meetings' | 'note' | 'lastcontact';

/**
 * In-memory NoteMoveTx mirroring the transactional contract of the pg adapter. The move is
 * reversible (only client ids change), so we snapshot the affected fields and restore them on ANY
 * error — including a fault injected at the seam — so a partial move is impossible. The audit row
 * is written LAST, only on full success, so a rolled-back move leaves no trace. Undo deletes are
 * ordered destructive-last; the real transactional guarantee for undo is the pg adapter.
 */
export class InMemoryNoteMoveTx implements NoteMoveTx {
  constructor(
    private readonly notes: NoteRepository,
    private readonly facts: FactsRepository,
    private readonly meetings: MeetingRepository | undefined,
    private readonly clients: ClientRepository,
    private readonly audit: NoteMoveAuditRepository,
    /** INV-MATCH: a note's requirements (spine rows) + their inventory matches move/undo with it —
     *  else a misfiled-then-moved note keeps generating suggestions under the WRONG client. */
    private readonly requirements?: RequirementRepository,
    private readonly matches?: InventoryMatchRepository,
    /** Test-only: throw here to simulate a fault partway through a move. */
    private readonly fault?: (step: MoveStep) => void,
  ) {}

  private async recompute(userId: string, clientId: string): Promise<void> {
    const notes = await this.notes.listByClient(userId, clientId);
    const latest = notes.reduce((m, n) => Math.max(m, n.createdAt), 0);
    const client = await this.clients.findByIdForUser(userId, clientId);
    await this.clients.setLastTouched(userId, clientId, latest > 0 ? latest : client?.createdAt ?? Date.now());
  }

  async move(userId: string, noteId: string, toClientId: string): Promise<MoveOutcome> {
    const note = await this.notes.findByIdForUser(userId, noteId);
    if (!note) return { ok: false, error: 'note_not_found' };
    if (note.clientId === toClientId) return { ok: false, error: 'same_client' };
    const target = await this.clients.findByIdForUser(userId, toClientId);
    if (!target) return { ok: false, error: 'target_not_found' };
    const from = note.clientId;

    const snap = {
      suggestion: note.moveSuggestion ?? null,
      fromLast: (await this.clients.findByIdForUser(userId, from))?.lastTouchedAt ?? 0,
      toLast: target.lastTouchedAt,
    };

    let reqIds: string[] = [];
    try {
      const spine = await this.facts.reassignNote(userId, noteId, toClientId);
      this.fault?.('facts');
      // Requirements + their matches follow the note. The pairing/dismissal is preserved (the
      // requirement's vector is unchanged); only the client attribution moves — which corrects both
      // the client- and item-side views of a match (one row, two views).
      reqIds = this.requirements ? await this.requirements.reassignByNote(userId, noteId, toClientId) : [];
      if (this.matches && reqIds.length > 0) await this.matches.reassignByRequirements(userId, reqIds, toClientId);
      this.fault?.('requirements');
      const meetings = this.meetings ? await this.meetings.reassignByNote(userId, noteId, toClientId) : 0;
      this.fault?.('meetings');
      await this.notes.update(userId, noteId, { clientId: toClientId, moveSuggestion: null });
      this.fault?.('note');
      await this.recompute(userId, from);
      await this.recompute(userId, toClientId);
      this.fault?.('lastcontact');
      const counts: NoteMoveCounts = { messages: note.messages?.length ?? 0, promises: spine.promises, keyDates: spine.keyDates, meetings, requirements: reqIds.length };
      await this.audit.record(userId, { noteId, kind: 'move', fromClientId: from, toClientId, counts });
      return { ok: true, fromClientId: from, counts };
    } catch (err) {
      // Roll back every field we may have touched, in reverse — the move is fully reversible.
      await this.facts.reassignNote(userId, noteId, from);
      if (this.requirements) await this.requirements.reassignByNote(userId, noteId, from);
      if (this.matches && reqIds.length > 0) await this.matches.reassignByRequirements(userId, reqIds, from);
      if (this.meetings) await this.meetings.reassignByNote(userId, noteId, from);
      await this.notes.update(userId, noteId, { clientId: from, moveSuggestion: snap.suggestion });
      await this.clients.setLastTouched(userId, from, snap.fromLast);
      await this.clients.setLastTouched(userId, toClientId, snap.toLast);
      throw err;
    }
  }

  async undo(userId: string, noteId: string): Promise<UndoOutcome> {
    const note = await this.notes.findByIdForUser(userId, noteId);
    if (!note) return { ok: false, error: 'note_not_found' };
    const from = note.clientId;
    const spine = await this.facts.deleteByNote(userId, noteId);
    const reqIds = this.requirements ? await this.requirements.deleteByNote(userId, noteId) : [];
    if (this.matches && reqIds.length > 0) await this.matches.deleteByRequirements(userId, reqIds); // matches follow requirements
    const meetings = this.meetings ? await this.meetings.deleteByNote(userId, noteId) : 0;
    await this.notes.delete(userId, noteId); // destructive step last
    await this.recompute(userId, from);
    const counts: NoteMoveCounts = { messages: note.messages?.length ?? 0, promises: spine.promises, keyDates: spine.keyDates, meetings, requirements: reqIds.length };
    await this.audit.record(userId, { noteId, kind: 'undo', fromClientId: from, toClientId: null, counts });
    return { ok: true, fromClientId: from, counts };
  }
}
