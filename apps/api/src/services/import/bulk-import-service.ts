/**
 * [BULK-IMPORT · Task 4 / RULING 2] The service behind the bulk endpoint.
 *
 * `parse` runs the deterministic local parse (parseBatch, Task 2) — NO model call (D2) — and returns the
 * review rows plus the up-front spend estimate as a % of the allowance.
 *
 * `importConfirmed` does the cheap deterministic work up front (parse, redact/screen, dedupe) to decide
 * which decisions are real imports, then hands those to the BulkExtractionOrchestrator. Persistence is
 * DEFERRED into the orchestrator's `start` callback so that a chat which never starts (allowance
 * exhausted) leaves nothing behind — its content is discarded, not stored (RULING 2). A started chat
 * always finishes; the gate absorbs any overshoot.
 */
import type { ClientRepository } from '../../ports/client-repository.js';
import type { NoteRepository, ImportedMessage } from '../../ports/note-repository.js';
import type { RepNameRepository } from '../../ports/contact-alias-repository.js';
import type { ExtractOutcome } from '../extraction/extraction-service.js';
import { parseWhatsAppExport, type ParsedMessage } from './whatsapp.js';
import { parseBatch, type BulkInputFile, type BulkClient, type BulkParseResult, type RowState } from './bulk-parse.js';
import { dedupeMessages, renderThread } from './dedup.js';
import { assignSpeakerRoles } from './unanswered.js';
import { redactSensitive } from '../redaction/redact.js';
import { screenSensitive } from '../screening/sensitive-screen.js';
import { estimateBulkAed, percentOfAllowance } from './bulk-estimate.js';
import { BulkExtractionOrchestrator, type ChatJob } from './bulk-extraction.js';

export type BulkDecision =
  | { fileName: string; action: 'new'; name: string }
  | { fileName: string; action: 'merge'; clientId: string };

export interface BulkImportDeps {
  clients: ClientRepository;
  notes: NoteRepository;
  /** Extract one persisted note (ExtractionService.extractNote, with the started-chat allowance bypass). */
  extract: (userId: string, noteId: string, today: string) => Promise<ExtractOutcome>;
  isExhausted: (userId: string) => Promise<boolean>;
  /** Kill switch — stops new chats from starting. */
  isPaused?: () => Promise<boolean>;
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

/** A real import, ready to persist — the cheap deterministic work is already done. */
interface PlanItem {
  decision: BulkDecision;
  fresh: ImportedMessage[];
}

const NON_IMPORTABLE: ReadonlySet<RowState> = new Set<RowState>(['group', 'duplicate', 'unparseable']);

export class BulkImportService {
  constructor(private readonly deps: BulkImportDeps) {}

  async parse(userId: string, files: BulkInputFile[], storedRepName?: string | null): Promise<BulkParseOutcome> {
    const existing = await this.deps.clients.listByUser(userId);
    const bulkClients: BulkClient[] = existing.map((c) => ({ id: c.id, name: c.name, phone: c.phone }));
    const repName = storedRepName ?? (this.deps.repNames ? await this.deps.repNames.get(userId) : null);
    const result = parseBatch(files, bulkClients, repName);

    // [RULING 2 item 4] Enrich with stored-note knowledge (parseBatch has none): detect a same-chat
    // re-export (message overlap → auto-attach, even without a phone/name match), and compute how many
    // messages are NEW vs already stored for an auto-attached client (0 → "already up to date").
    const byName = new Map(files.map((f) => [f.name, f]));
    const storedCache = new Map<string, ImportedMessage[]>();
    const storedFor = async (clientId: string): Promise<ImportedMessage[]> => {
      const hit = storedCache.get(clientId);
      if (hit) return hit;
      const msgs = (await this.deps.notes.listByClient(userId, clientId)).flatMap((n) => n.messages ?? []);
      storedCache.set(clientId, msgs);
      return msgs;
    };

    const rows = [];
    for (const row of result.rows) {
      const r = { ...row };
      const file = byName.get(r.fileName);
      const parsed = file ? parseWhatsAppExport(file.content) : null;
      const msgs = parsed && parsed.ok ? this.screen(parsed.messages) : [];

      // Same-chat re-export: a new/name-match row whose messages overlap an existing client attaches to it.
      if (msgs.length > 0 && (r.state === 'new' || r.state === 'possible_match')) {
        const overlap = await this.overlapClient(msgs, existing, storedFor, r.matchClientId);
        if (overlap) { r.state = 'existing'; r.matchClientId = overlap.id; r.matchClientName = overlap.name; }
      }
      if (r.state === 'existing' && r.matchClientId) {
        r.newMessageCount = dedupeMessages(await storedFor(r.matchClientId), msgs).length;
      }
      rows.push(r);
    }
    result.rows = rows;

    // Estimate only over chats that will actually extract: importable, and not an already-up-to-date attach.
    const chats = result.rows
      .filter((r) => !NON_IMPORTABLE.has(r.state) && !(r.state === 'existing' && r.newMessageCount === 0))
      .map((r) => byName.get(r.fileName)?.content ?? '');
    const estimateAed = estimateBulkAed(chats, this.deps.modelId);
    return { result, estimateAed, percentOfAllowance: percentOfAllowance(estimateAed, this.deps.allowanceAed) };
  }

  /** Redact + screen each message exactly as the import pipeline does, so dedupe compares like-for-like. */
  private screen(messages: ParsedMessage[]): ImportedMessage[] {
    return messages.map((m) => {
      const red = redactSensitive(m.body);
      const flags = screenSensitive(red.redacted);
      return { ...m, body: red.redacted, ...(flags.length > 0 ? { sensitive: flags, excluded: true } : {}) } as ImportedMessage;
    });
  }

  /** The client this chat is a re-export of: prefer the already-matched client if its stored messages
   *  overlap, else the first client with any overlap. Null when the chat shares nothing with any client. */
  private async overlapClient(
    msgs: ImportedMessage[],
    clients: Array<{ id: string; name: string }>,
    storedFor: (clientId: string) => Promise<ImportedMessage[]>,
    preferId?: string,
  ): Promise<{ id: string; name: string } | null> {
    const overlaps = async (clientId: string): Promise<boolean> => dedupeMessages(await storedFor(clientId), msgs).length < msgs.length;
    if (preferId) {
      const pc = clients.find((c) => c.id === preferId);
      if (pc && (await overlaps(pc.id))) return pc;
    }
    for (const c of clients) {
      if (c.id === preferId) continue;
      if (await overlaps(c.id)) return c;
    }
    return null;
  }

  async importConfirmed(userId: string, files: BulkInputFile[], decisions: BulkDecision[], today: string): Promise<BulkImportOutcome> {
    const byName = new Map(files.map((f) => [f.name, f]));
    const clientNameCache = new Map<string, string>();
    const plan: PlanItem[] = [];
    let skipped = 0;

    // Cheap deterministic pass — parse, redact/screen, dedupe. No model, no persistence, no client
    // creation yet, so a chat that is never started (allowance) leaves nothing behind.
    for (const decision of decisions) {
      const file = byName.get(decision.fileName);
      if (!file) { skipped += 1; continue; }
      const parsed = parseWhatsAppExport(file.content);
      if (!parsed.ok || parsed.messages.length === 0) { skipped += 1; continue; }

      const screened = this.screen(parsed.messages);

      const targetClientId = decision.action === 'merge' ? decision.clientId : null;
      const prior = targetClientId ? await this.deps.notes.listByClient(userId, targetClientId) : [];
      const fresh = dedupeMessages(prior.flatMap((n) => n.messages ?? []), screened);
      if (fresh.length === 0) { skipped += 1; continue; } // nothing new — a duplicate upload

      plan.push({ decision, fresh });
    }

    let created = 0;
    const orchestrator = new BulkExtractionOrchestrator<PlanItem>({
      items: plan,
      keyOf: (it) => it.decision.fileName,
      isExhausted: () => this.deps.isExhausted(userId),
      isPaused: this.deps.isPaused,
      concurrency: this.deps.concurrency,
      // Persist + extract — called ONLY once the start-gate passes, so an unstarted chat is never stored.
      start: async (it) => {
        let clientId: string;
        let clientName: string;
        if (it.decision.action === 'merge') {
          clientId = it.decision.clientId;
          clientName = await this.clientName(userId, clientId, clientNameCache);
        } else {
          const c = await this.deps.clients.create(userId, it.decision.name);
          clientId = c.id;
          clientName = c.name;
        }
        const messages = assignSpeakerRoles(it.fresh, clientName);
        const note = await this.deps.notes.create(userId, {
          clientId,
          source: 'whatsapp_export',
          rawText: renderThread(messages),
          audioKey: null,
          status: 'pending_extraction',
          messages,
        });
        await this.deps.clients.touch(userId, clientId);
        created += 1;
        const outcome = await this.deps.extract(userId, note.id, today);
        return { noteId: note.id, outcome };
      },
    });

    const jobs = await orchestrator.run();
    return { jobs, created, skipped };
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
