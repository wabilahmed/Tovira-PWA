import type { PushableAlert } from '../push/push-dispatch-service.js';
import type { BulkImportSummary } from './bulk-import-service.js';

/**
 * [P20-3 / P21-D / BULK-08] One bulk batch → ONE "Imported N chats …" notification. While a batch runs,
 * its notes are marked in-flight so the per-note import_complete (ImportCompletionService, fired when the
 * sweep settles a note) is suppressed; when the batch finishes, a single aggregate is dispatched that
 * opens the Book Scan. Shared by index.ts and test-deps so the integration test runs the production code.
 */
export class BulkBatchNotifier {
  private readonly inFlight = new Set<string>();

  constructor(
    private readonly dispatch: (userId: string, alerts: PushableAlert[], nowMs: number) => Promise<unknown>,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** BulkImportService.bulkNotes */
  readonly bulkNotes = {
    add: (noteId: string): void => { this.inFlight.add(noteId); },
    remove: (noteId: string): void => { this.inFlight.delete(noteId); },
  };

  /** ImportCompletionService.isBulkNote */
  readonly isBulkNote = (noteId: string): boolean => this.inFlight.has(noteId);

  /** BulkImportService.onBatchComplete */
  readonly onBatchComplete = async (userId: string, summary: BulkImportSummary): Promise<void> => {
    if (summary.chatsImported === 0) return; // nothing landed → no notification
    const plural = (n: number, one: string): string => `${n} ${one}${n === 1 ? '' : 's'}`;
    const found = [plural(summary.promises, 'promise'), plural(summary.requirements, 'requirement')].join(', ');
    const nowMs = this.now();
    await this.dispatch(userId, [{
      type: 'import_complete',
      dedupeKey: `bulk:${nowMs}`,
      clientId: null,
      title: 'Import ready',
      body: `Imported ${plural(summary.chatsImported, 'chat')} — found ${found}. Open the Book Scan.`,
      url: '/app?view=bookscan',
    }], nowMs);
  };
}
