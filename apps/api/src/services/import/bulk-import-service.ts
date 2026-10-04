/**
 * [BULK-IMPORT · Task 4] The service behind the bulk endpoint. The rep uploaded up to 20 files, the
 * review screen (Task 3) confirmed who each chat is, and now the confirmed decisions arrive here.
 *
 * `parse` runs the deterministic local parse (parseBatch, Task 2) — NO model call (D2) — and returns the
 * review rows plus the up-front spend estimate as a % of the allowance.
 *
 * `importConfirmed` persists one note per confirmed chat (reusing the single-import pipeline: redact →
 * screen/hold → dedupe → speaker-roles → render), then drives extraction through the
 * BulkExtractionOrchestrator: one chat = one call (D1), cache warm-up then bounded fan-out, one failure
 * contained, and a stop at the allowance limit. The review screen already confirmed the counterpart, so
 * (unlike single import) there is no 409 counterpart round-trip here — the decision IS the confirmation.
 */
import type { ClientRepository } from '../../ports/client-repository.js';
import type { NoteRepository, ImportedMessage } from '../../ports/note-repository.js';
import type { RepNameRepository } from '../../ports/contact-alias-repository.js';
import type { ExtractOutcome } from '../extraction/extraction-service.js';
import { parseWhatsAppExport } from './whatsapp.js';
import { parseBatch, type BulkInputFile, type BulkClient, type BulkParseResult, type RowState } from './bulk-parse.js';
import { dedupeMessages, renderThread } from './dedup.js';
import { assignSpeakerRoles } from './unanswered.js';
import { redactSensitive } from '../redaction/redact.js';
import { screenSensitive } from '../screening/sensitive-screen.js';
import { estimateBulkAed, percentOfAllowance } from './bulk-estimate.js';
import { BulkExtractionOrchestrator, type ChatJob } from './bulk-extraction.js';

/** A confirmed instruction from the review screen — one per imported chat. Mirrors the web ReviewDecision. */
export type BulkDecision =
  | { fileName: string; action: 'new'; name: string }
  | { fileName: string; action: 'merge'; clientId: string };

export interface BulkImportDeps {
  clients: ClientRepository;
  notes: NoteRepository;
  /** Extract one persisted note (ExtractionService.extractNote), used by the orchestrator. */
  extract: (userId: string, noteId: string, today: string) => Promise<ExtractOutcome>;
  isExhausted: (userId: string) => Promise<boolean>;
  concurrency: number;
  allowanceAed: number;
  modelId: string;
  repNames?: RepNameRepository;
}

export interface BulkParseOutcome {
  result: BulkParseResult;
  estimateAed: number;
  percentOfAllowance: number;
}

export interface BulkImportOutcome {
  jobs: ChatJob[];
  created: number;
  skipped: number;
}

/** States parse marks as NOT importable — they never become a note or a model call. */
const NON_IMPORTABLE: ReadonlySet<RowState> = new Set<RowState>(['group', 'duplicate', 'unparseable']);

export class BulkImportService {
  constructor(private readonly deps: BulkImportDeps) {}

  async parse(userId: string, files: BulkInputFile[], storedRepName?: string | null): Promise<BulkParseOutcome> {
    const existing = await this.deps.clients.listByUser(userId);
    const bulkClients: BulkClient[] = existing.map((c) => ({ id: c.id, name: c.name, phone: c.phone }));
    const repName = storedRepName ?? (this.deps.repNames ? await this.deps.repNames.get(userId) : null);
    const result = parseBatch(files, bulkClients, repName);

    // Estimate over the chats that would actually be imported — one call each (D1).
    const byName = new Map(files.map((f) => [f.name, f.content]));
    const chats = result.rows.filter((r) => !NON_IMPORTABLE.has(r.state)).map((r) => byName.get(r.fileName) ?? '');
    const estimateAed = estimateBulkAed(chats, this.deps.modelId);
    return { result, estimateAed, percentOfAllowance: percentOfAllowance(estimateAed, this.deps.allowanceAed) };
  }

  async importConfirmed(userId: string, files: BulkInputFile[], decisions: BulkDecision[], today: string): Promise<BulkImportOutcome> {
    const byName = new Map(files.map((f) => [f.name, f]));
    const clientNameCache = new Map<string, string>();
    const noteIds: string[] = [];
    let skipped = 0;

    for (const decision of decisions) {
      const file = byName.get(decision.fileName);
      if (!file) { skipped += 1; continue; }
      const parsed = parseWhatsAppExport(file.content);
      if (!parsed.ok || parsed.messages.length === 0) { skipped += 1; continue; }

      // Resolve the target client: a confirmed match merges; otherwise a new client under the chat name.
      let clientId: string;
      let clientName: string;
      if (decision.action === 'merge') {
        clientId = decision.clientId;
        clientName = await this.clientName(userId, clientId, clientNameCache);
      } else {
        const created = await this.deps.clients.create(userId, decision.name);
        clientId = created.id;
        clientName = created.name;
      }

      // Same per-message pipeline as single import: redact Tier-1 values, then screen+HOLD
      // special-category messages (excluded=true → never sent to a model until a rep restores them).
      const screened: ImportedMessage[] = parsed.messages.map((m) => {
        const r = redactSensitive(m.body);
        const flags = screenSensitive(r.redacted);
        return { ...m, body: r.redacted, ...(flags.length > 0 ? { sensitive: flags, excluded: true } : {}) } as ImportedMessage;
      });

      // Dedupe against this client's existing imported messages — a re-export stores its overlap once.
      const prior = await this.deps.notes.listByClient(userId, clientId);
      const existingMsgs = prior.flatMap((n) => n.messages ?? []);
      const fresh = dedupeMessages(existingMsgs, screened);
      if (fresh.length === 0) { skipped += 1; continue; } // nothing new — a duplicate upload

      const messages = assignSpeakerRoles(fresh, clientName);
      const note = await this.deps.notes.create(userId, {
        clientId,
        source: 'whatsapp_export',
        rawText: renderThread(messages),
        audioKey: null,
        status: 'pending_extraction',
        messages,
      });
      await this.deps.clients.touch(userId, clientId);
      noteIds.push(note.id);
    }

    const orchestrator = new BulkExtractionOrchestrator({
      extract: this.deps.extract,
      isExhausted: this.deps.isExhausted,
      concurrency: this.deps.concurrency,
    });
    const jobs = await orchestrator.run(userId, noteIds, today);
    return { jobs, created: noteIds.length, skipped };
  }

  private async clientName(userId: string, clientId: string, cache: Map<string, string>): Promise<string> {
    const hit = cache.get(clientId);
    if (hit !== undefined) return hit;
    const found = (await this.deps.clients.listByUser(userId)).find((c) => c.id === clientId);
    const name = found?.name ?? '';
    cache.set(clientId, name);
    return name;
  }
}
