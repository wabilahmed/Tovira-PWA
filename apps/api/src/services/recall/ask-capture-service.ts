import type { NoteRepository } from '../../ports/note-repository.js';
import type { ClientRepository } from '../../ports/client-repository.js';
import type { FactsRepository } from '../../ports/facts-repository.js';
import type { Embedder } from '../../ports/embedder.js';
import type { ExtractedPromise } from '../extraction/types.js';

const PENDING = 'pending_confirmation';
const DEFAULT_TTL_MS = 14 * 24 * 60 * 60 * 1000; // ASK-CAPTURE constraint 3: 14-day expiry

export interface CaptureExtractor {
  /** The CERTIFIED extractor, held for confirmation (compute + training-log, no vault commit). */
  extractNote(userId: string, noteId: string, today: string, opts?: { holdForConfirmation?: boolean }): Promise<unknown>;
}

export interface PendingCapture {
  noteId: string;
  clientId: string;
  clientName: string;
  /** The rep's own verbatim words + when — the RECEIPT the confirmation must show (constraint 4). */
  statement: string;
  capturedAt: number;
}

export interface AskCaptureDeps {
  notes: NoteRepository;
  clients: ClientRepository;
  facts: FactsRepository;
  embedder: Embedder;
  extraction: CaptureExtractor;
  now?: () => number;
  ttlMs?: number;
}

/**
 * [ASK-CAPTURE stages 2–3: EXTRACT (certified) + CONFIRM] A detected statement becomes a pending
 * NOTE (source ask_conversation) run through the CERTIFIED extractor but held OUT of the vault; the
 * rep confirms it (→ committed) or rejects/lets it expire (→ deleted, training log survives). One
 * confirm per statement. Nothing enters the vault unconfirmed.
 */
export class AskCaptureService {
  private readonly now: () => number;
  private readonly ttlMs: number;
  constructor(private readonly deps: AskCaptureDeps) {
    this.now = deps.now ?? (() => Date.now());
    this.ttlMs = deps.ttlMs ?? DEFAULT_TTL_MS;
  }

  /** Create the pending note + run the certified (held) extraction. Client MUST be resolved by the
   *  caller — attribution is explicit (ambiguous → the caller asks which, and never calls this). */
  async capture(userId: string, clientId: string, statement: string, today: string): Promise<PendingCapture | null> {
    const client = await this.deps.clients.findByIdForUser(userId, clientId);
    if (!client) return null; // unknown/foreign client → capture nothing
    const note = await this.deps.notes.create(userId, {
      clientId,
      source: 'ask_conversation',
      rawText: statement, // the rep's verbatim words — the receipt
      audioKey: null,
      status: PENDING,
    });
    // Certified engine, held: facts computed into the note's JSONB + a training-log row, but NO
    // embedding / spine / touch — so it is invisible to the vault until confirmed.
    await this.deps.extraction.extractNote(userId, note.id, today, { holdForConfirmation: true });
    return { noteId: note.id, clientId, clientName: client.name, statement, capturedAt: this.now() };
  }

  /** The pending queue — expired captures are swept first, then the survivors returned with receipts. */
  async listPending(userId: string): Promise<PendingCapture[]> {
    await this.expire(userId);
    const notes = await this.deps.notes.listByStatusForUser(userId, PENDING);
    const out: PendingCapture[] = [];
    for (const n of notes) {
      const client = await this.deps.clients.findByIdForUser(userId, n.clientId);
      out.push({ noteId: n.id, clientId: n.clientId, clientName: client?.name ?? 'a client', statement: n.rawText ?? '', capturedAt: n.createdAt });
    }
    return out;
  }

  /** Confirm → COMMIT into the vault: embed (searchable), save facts to the spine, touch the client. */
  async confirm(userId: string, noteId: string): Promise<boolean> {
    const note = await this.deps.notes.findByIdForUser(userId, noteId);
    if (!note || note.status !== PENDING) return false;
    const ex = (note.extracted ?? {}) as { promises?: ExtractedPromise[]; key_dates?: unknown[] };
    let embedding: number[] | null = null;
    try { embedding = await this.deps.embedder.embed(note.rawText ?? ''); } catch { /* degraded search, still committed */ }
    await this.deps.notes.update(userId, noteId, { status: 'extracted', embedding });
    await this.deps.facts.saveExtraction(userId, {
      noteId,
      clientId: note.clientId,
      promises: ex.promises ?? [],
      keyDates: (ex.key_dates ?? []) as never,
    });
    await this.deps.clients.touch(userId, note.clientId);
    return true;
  }

  /** Reject → delete the pending note. The training-log row survives (constraint 2, migration 0045). */
  async reject(userId: string, noteId: string): Promise<boolean> {
    const note = await this.deps.notes.findByIdForUser(userId, noteId);
    if (!note || note.status !== PENDING) return false;
    return this.deps.notes.delete(userId, noteId);
  }

  /** Sweep pending captures older than the TTL — same treatment as reject (log survives). */
  async expire(userId: string): Promise<number> {
    const cutoff = this.now() - this.ttlMs;
    const notes = await this.deps.notes.listByStatusForUser(userId, PENDING);
    let removed = 0;
    for (const n of notes) {
      if (n.createdAt < cutoff) { await this.deps.notes.delete(userId, n.id); removed += 1; }
    }
    return removed;
  }
}
