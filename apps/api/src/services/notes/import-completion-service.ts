import type { NoteRepository } from '../../ports/note-repository.js';
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
 */
export interface ImportCompletionDeps {
  notes: Pick<NoteRepository, 'findByIdForUser'>;
  clients: Pick<ClientRepository, 'findByIdForUser'>;
  dispatch: (userId: string, alerts: PushableAlert[], nowMs: number) => Promise<unknown>;
  now?: () => number;
}

const TERMINAL: ReadonlySet<string> = new Set(['extracted', 'needs_review', 'import_failed']);

export class ImportCompletionService {
  private readonly now: () => number;
  constructor(private readonly deps: ImportCompletionDeps) {
    this.now = deps.now ?? (() => Date.now());
  }

  async onNoteSettled(userId: string, noteId: string): Promise<void> {
    const note = await this.deps.notes.findByIdForUser(userId, noteId);
    // Only WhatsApp imports notify; only once a terminal state is reached.
    if (!note || note.source !== 'whatsapp_export' || !TERMINAL.has(note.status)) return;

    const client = await this.deps.clients.findByIdForUser(userId, note.clientId);
    const name = client?.name ?? 'your client';
    const messages = note.messages?.length ?? 0;
    const url = `/app?client=${note.clientId}`;

    let title: string;
    let body: string;
    if (note.status === 'extracted') {
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
      title = `Import ready — ${name}`;
      body = `Processed ${messages.toLocaleString()} message${messages === 1 ? '' : 's'} — ${summary}. Open the Book Scan.`;
    } else {
      // needs_review / import_failed — say so; the rep is waiting and a silent failure is the worst case.
      title = `Import needs a look — ${name}`;
      body = `We couldn't finish reading that chat with ${name}. Open it to review or try again.`;
    }

    await this.deps.dispatch(
      userId,
      [{ type: 'import_complete', dedupeKey: `import:${noteId}`, clientId: note.clientId, title, body, url }],
      this.now(),
    );
  }
}
