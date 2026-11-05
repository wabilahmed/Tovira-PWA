import type { NoteRecord, NoteRepository } from '../../ports/note-repository.js';
import type { ClientRepository } from '../../ports/client-repository.js';
import type { PushableAlert } from '../push/push-dispatch-service.js';

/**
 * [IMPORT-DONE] Notify the rep when a deferred WhatsApp import finishes. Import returns 202 and the
 * sweep extracts in the background — until now nothing told the rep it was done, on the
 * trial-critical path where they are actively waiting. Called from the sweep's terminal hook.
 *
 * - Success: how many messages were processed + what was found, linking to the client's Book Scan.
 * - Failure / needs_review: says so plainly — silent failure here is the worst outcome.
 * - Bypasses the 2/day silence budget (import_complete is the second documented brand §10 exception).
 * - Idempotent: dedupeKey `import:<noteId>`; the sweep also only settles a note once.
 * - In-app regardless of push: dispatch records the alert in-app even with no devices.
 *
 * [P65-5 · owner] When the app is closed and reading took over 30 seconds, the push says "Tovira finished reading your
 * chat with Anjali Mehra." (or your voice note / your note about …), for every kind the app wires (`kinds`). With
 * `shouldPush` wired, nothing is pushed while the app is open or for something done in 30 seconds or less: a chat is
 * then recorded in the in-app list only, and a voice or typed note not at all (the toast and the page say it). A push
 * goes only to a device the rep turned notifications on for. [P65-6] A failure on our side also emails the admins.
 */
export type SettledKind = 'chat' | 'voice' | 'typed';
export interface ImportCompletionDeps {
  notes: Pick<NoteRepository, 'findByIdForUser'>;
  clients: Pick<ClientRepository, 'findByIdForUser'>;
  dispatch: (userId: string, alerts: PushableAlert[], nowMs: number) => Promise<unknown>;
  /** [P20-3 / BULK-08] True while a note belongs to an in-flight bulk batch: its per-note notification is
   *  suppressed, because the batch emits ONE aggregate "Imported N chats …" notification instead. */
  isBulkNote?: (noteId: string) => boolean;
  now?: () => number;
  /** [P65-5] Which kinds notify (default: chats only, as before). */
  kinds?: SettledKind[];
  /** [P65-5] Push only when this is true (the app is closed and it took over 30 seconds). Absent: always, as before. */
  shouldPush?: (userId: string, note: NoteRecord) => boolean;
  /** [P65-6] A failure on our side: the admins are told (rep, path, error class; never content). Best-effort. */
  onFailure?: (userId: string, note: NoteRecord, kind: SettledKind) => Promise<void>;
}

const TERMINAL: ReadonlySet<string> = new Set(['extracted', 'needs_review', 'import_failed', 'transcription_failed']);
const kindOf = (n: NoteRecord): SettledKind | null => (n.source === 'whatsapp_export' ? 'chat' : n.source === 'voice' ? 'voice' : n.source === 'paste' ? 'typed' : null);
/** "your chat with Anjali Mehra", "your voice note about Anjali Mehra", "your note about Anjali Mehra" */
export const yourCapture = (kind: SettledKind, name: string): string => (kind === 'chat' ? `your chat with ${name}` : `your ${kind === 'voice' ? 'voice note' : 'note'} about ${name}`);

export class ImportCompletionService {
  private readonly now: () => number;
  constructor(private readonly deps: ImportCompletionDeps) {
    this.now = deps.now ?? (() => Date.now());
  }

  async onNoteSettled(userId: string, noteId: string): Promise<void> {
    // [P20-3 / BULK-08] A note in an in-flight bulk batch gets NO per-note notification — the batch's one
    // aggregate "Imported N chats …" covers it. (The sweep can still win the claim for a bulk note; this
    // is where that per-note notification is suppressed.)
    if (this.deps.isBulkNote?.(noteId)) return;
    const note = await this.deps.notes.findByIdForUser(userId, noteId);
    if (!note || !TERMINAL.has(note.status)) return;
    const kind = kindOf(note);
    if (!kind) return;
    const failed = note.status !== 'extracted';
    if (failed && this.deps.onFailure) await this.deps.onFailure(userId, note, kind).catch(() => undefined); // [P65-6]
    // Only the kinds wired notify (chats only, by default).
    if (!(this.deps.kinds ?? ['chat']).includes(kind)) return;

    const client = await this.deps.clients.findByIdForUser(userId, note.clientId);
    const name = client?.name ?? 'your client';
    const url = `/app?client=${note.clientId}`;
    const push = this.deps.shouldPush ? this.deps.shouldPush(userId, note) : true;
    // [P65-5] a voice or typed note that is not pushed is not recorded either: the app is open and says it
    if (!push && kind !== 'chat') return;

    let title: string;
    let body: string;
    if (kind === 'chat') {
      const messages = note.messages?.length ?? 0;
      if (!failed) {
        const ex = (note.extracted ?? {}) as {
          promises?: unknown[]; requirements?: unknown[]; key_dates?: unknown[]; people?: unknown[];
        };
        const found: string[] = [];
        const plural = (n: number, one: string): string => `${n} ${one}${n === 1 ? '' : 's'}`;
        if (ex.promises?.length) found.push(plural(ex.promises.length, 'promise'));
        if (ex.requirements?.length) found.push(plural(ex.requirements.length, 'requirement'));
        if (ex.key_dates?.length) found.push(plural(ex.key_dates.length, 'key date'));
        if (ex.people?.length) found.push(plural(ex.people.length, 'person').replace('persons', 'people'));
        const summary = found.length > 0 ? `found ${found.join(', ')}` : 'no new facts to surface';
        title = `Tovira finished reading ${yourCapture(kind, name)}.`; // [P65-5 · owner] was "Import ready: <name>"
        body = `Processed ${messages.toLocaleString()} message${messages === 1 ? '' : 's'}. ${summary}. Open the Book Scan.`;
      } else {
        // needs_review / import_failed — say so; the rep is waiting and a silent failure is the worst case.
        title = `Import needs a look: ${name}`;
        body = `We couldn't finish reading that chat with ${name}. Open it to review or try again.`;
      }
    } else {
      title = failed ? `Tovira couldn't read ${yourCapture(kind, name)}.` : `Tovira finished reading ${yourCapture(kind, name)}.`;
      body = failed ? 'Open it to see why, or try again.' : `Open ${name} to see what it found.`;
    }

    await this.deps.dispatch(
      userId,
      [{ type: 'import_complete', dedupeKey: `import:${noteId}`, clientId: note.clientId, title, body, url, ...(push ? {} : { inAppOnly: true }) }],
      this.now(),
    );
  }
}
