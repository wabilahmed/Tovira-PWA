import type { ClientRepository } from '../../ports/client-repository.js';
import type { NoteRepository, NoteRecord, ImportedMessage } from '../../ports/note-repository.js';
import type { ExtractionLogRepository } from '../../ports/extraction-log-repository.js';
import type { ErasureAuditRepository, ErasureCategoryCount } from '../../ports/erasure-audit-repository.js';
import { renderThread } from '../import/dedup.js';

/**
 * [ERASURE] Single-counterparty erasure (Privacy Policy §10 / Terms 4.9): delete facts ABOUT a named
 * third party from one rep's account, keep facts that merely MENTION them, keep the client record.
 *
 * THE RULE, made deterministic (owner-ruled): a fact is ABOUT the requester when the requester is the
 * SUBJECT/SPEAKER in a STRUCTURED who-field — people[].name, personal_facts[].subject,
 * unanswered_questions[].sender, or a message's sender. A free-text appearance of the name inside
 * someone else's fact (promise.text, summary, a receipt quote) is a MENTION → kept, byte-identical.
 *
 * Attribution is name-matching (there is no third-party entity — see ERASURE-TASK1-FINDINGS). So:
 *   - EXACT (normalised) name/alias match on a who-field → auto-delete.
 *   - FUZZY (shares a word, not exact) → an operator-confirmed candidate, never auto-deleted.
 *   - free-text mention → kept (the operator may separately FLAG a relational fact to delete).
 * No model is ever consulted — classification is structural + name-match only.
 *
 * Reversible up to commitment: preview() lists exactly what will be deleted and kept; commit() then
 * executes. Kept facts and their receipts are never edited. An audit records that it happened +
 * category counts, never the erased content.
 */

const norm = (s: string | null | undefined): string => (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const wordsOf = (s: string): string[] => norm(s).split(' ').filter((w) => w.length > 1);

type MatchKind = 'exact' | 'fuzzy' | 'none';
function matchName(who: string | null | undefined, requesterNorm: string[]): MatchKind {
  const w = norm(who);
  if (!w) return 'none';
  if (requesterNorm.includes(w)) return 'exact';
  const whoWords = new Set(wordsOf(w));
  for (const rn of requesterNorm) for (const rw of rn.split(' ')) if (rw.length > 1 && whoWords.has(rw)) return 'fuzzy';
  return 'none';
}
/** A free-text field MENTIONS the requester if it contains a requester name token as a whole word.
 *  Punctuation is treated as a boundary so "(Khalid" / "Khalid," / "Khalid's" all count. */
function mentions(text: string | null | undefined, requesterNorm: string[]): boolean {
  const t = ` ${(text ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;
  return requesterNorm.some((rn) => rn.split(' ').some((w) => w.length > 1 && t.includes(` ${w} `)));
}

type WhoStore = 'people' | 'personal_facts' | 'unanswered_questions' | 'messages';

export interface ErasureItem {
  noteId: string;
  clientId: string;
  store: WhoStore;
  match: 'exact' | 'fuzzy';
  who: string; // the matched who-field value (shown in the preview; not persisted to the audit)
}
export interface MentionItem {
  noteId: string;
  clientId: string;
  store: string; // 'summary' | 'promise' | 'key_date' | 'meeting' | 'requirement' | 'next_step' | 'concern' | 'personal_fact_body'
  snippet: string; // the kept free-text (preview only)
}
export interface ErasurePlan {
  requesterNames: string[];
  autoDelete: ErasureItem[]; // exact structured matches — deleted on commit
  fuzzyCandidates: ErasureItem[]; // partial matches — deleted ONLY if confirmed
  keptMentions: MentionItem[]; // free-text mentions — kept
  logRowIds: string[]; // extraction-log rows referencing the requester — purged on commit
}

/** Which fuzzy candidates the operator confirmed (by note + store + who). */
export interface FuzzyKey { noteId: string; store: WhoStore; who: string }
export interface CommitOptions { confirmFuzzy?: FuzzyKey[] }
export interface ErasureResult { categories: ErasureCategoryCount[] }

interface Extraction2 { [k: string]: unknown }

export interface ErasureDeps {
  clients: ClientRepository;
  notes: NoteRepository;
  extractionLog: ExtractionLogRepository;
  audit: ErasureAuditRepository;
}

export class ErasureService {
  constructor(private readonly deps: ErasureDeps) {}

  private async allNotes(userId: string): Promise<NoteRecord[]> {
    const clients = await this.deps.clients.listByUser(userId);
    const out: NoteRecord[] = [];
    for (const c of clients) out.push(...(await this.deps.notes.listByClient(userId, c.id)));
    return out;
  }

  /** Compute the erasure plan WITHOUT changing anything. */
  async preview(userId: string, requesterNames: string[]): Promise<ErasurePlan> {
    const rn = requesterNames.map(norm).filter(Boolean);
    const plan: ErasurePlan = { requesterNames, autoDelete: [], fuzzyCandidates: [], keptMentions: [], logRowIds: [] };
    if (rn.length === 0) return plan; // no identity → nothing (unknown-counterparty is a no-op)

    for (const note of await this.allNotes(userId)) {
      const ex = (note.extracted && typeof note.extracted === 'object' ? note.extracted : {}) as Extraction2;
      const push = (store: WhoStore, who: string, m: MatchKind) => {
        if (m === 'none') return;
        (m === 'exact' ? plan.autoDelete : plan.fuzzyCandidates).push({ noteId: note.id, clientId: note.clientId, store, match: m, who });
      };
      // Structured who-fields → about the requester.
      for (const p of asArr(ex.people)) push('people', String(p.name ?? ''), matchName(p.name as string, rn));
      for (const f of asArr(ex.personal_facts)) push('personal_facts', String(f.subject ?? ''), matchName(f.subject as string, rn));
      for (const q of asArr(ex.unanswered_questions)) push('unanswered_questions', String(q.sender ?? ''), matchName(q.sender as string, rn));
      for (const m of (note.messages ?? [])) push('messages', m.sender, matchName(m.sender, rn));

      // Free-text MENTIONS → kept (listed so the operator can see what remains).
      if (mentions(ex.summary as string, rn)) plan.keptMentions.push({ noteId: note.id, clientId: note.clientId, store: 'summary', snippet: String(ex.summary) });
      for (const p of asArr(ex.promises)) if (matchName((p as { subject?: string }).subject, rn) === 'none' && mentions(p.text as string, rn)) plan.keptMentions.push({ noteId: note.id, clientId: note.clientId, store: 'promise', snippet: String(p.text) });
      for (const d of asArr(ex.key_dates)) if (mentions(d.description as string, rn)) plan.keptMentions.push({ noteId: note.id, clientId: note.clientId, store: 'key_date', snippet: String(d.description) });
      for (const s of asStrArr(ex.next_steps)) if (mentions(s, rn)) plan.keptMentions.push({ noteId: note.id, clientId: note.clientId, store: 'next_step', snippet: s });
      for (const s of asStrArr(ex.concerns)) if (mentions(s, rn)) plan.keptMentions.push({ noteId: note.id, clientId: note.clientId, store: 'concern', snippet: s });
      // A personal_fact whose SUBJECT is someone else but whose FACT text names the requester → mention (kept).
      for (const f of asArr(ex.personal_facts)) if (matchName(f.subject as string, rn) === 'none' && mentions(f.fact as string, rn)) plan.keptMentions.push({ noteId: note.id, clientId: note.clientId, store: 'personal_fact_body', snippet: String(f.fact) });
    }

    // Training-log hot table (ruling 3): rows whose free-text input/output names the requester.
    for (const row of await this.deps.extractionLog.listByUser(userId)) {
      if (mentions(row.input, rn) || mentions(row.rawOutput, rn)) plan.logRowIds.push(row.id);
    }
    return plan;
  }

  /** Execute the erasure. Deletes exact structured matches + confirmed fuzzy + log rows; keeps mentions. */
  async commit(userId: string, requesterNames: string[], opts: CommitOptions = {}): Promise<ErasureResult> {
    const rn = requesterNames.map(norm).filter(Boolean);
    const counts: Record<string, number> = { people: 0, personal_facts: 0, unanswered_questions: 0, messages: 0, embeddings_cleared: 0, training_logs: 0 };
    if (rn.length === 0) return { categories: [] }; // unknown counterparty → nothing happens, nothing recorded

    const confirmed = new Set((opts.confirmFuzzy ?? []).map((k) => `${k.noteId}|${k.store}|${norm(k.who)}`));
    const shouldDelete = (noteId: string, store: WhoStore, who: string | null | undefined): boolean => {
      const m = matchName(who, rn);
      if (m === 'exact') return true;
      if (m === 'fuzzy') return confirmed.has(`${noteId}|${store}|${norm(who)}`);
      return false;
    };

    for (const note of await this.allNotes(userId)) {
      const ex = (note.extracted && typeof note.extracted === 'object' ? { ...(note.extracted as Extraction2) } : null);
      let changed = false;
      if (ex) {
        for (const [store, field] of [['people', 'name'], ['personal_facts', 'subject'], ['unanswered_questions', 'sender']] as Array<[WhoStore, string]>) {
          if (!Array.isArray(ex[store])) continue;
          const before = (ex[store] as Array<Record<string, unknown>>).length;
          ex[store] = (ex[store] as Array<Record<string, unknown>>).filter((e) => !shouldDelete(note.id, store, e[field] as string));
          const removed = before - (ex[store] as unknown[]).length;
          if (removed > 0) { counts[store]! += removed; changed = true; }
        }
      }
      // The requester's OWN messages go; rawText is re-rendered from the survivors (deterministic).
      let messages = note.messages;
      let rawText = note.rawText;
      let clearEmbedding = false;
      if (note.messages && note.messages.length > 0) {
        const kept = note.messages.filter((m) => !shouldDelete(note.id, 'messages', m.sender));
        if (kept.length !== note.messages.length) {
          counts.messages! += note.messages.length - kept.length;
          messages = kept as ImportedMessage[];
          rawText = renderThread(kept as ImportedMessage[]);
          changed = true;
          // [ERASURE Task 3] The note embedding is one vector over the WHOLE rawText (all speakers),
          // so it cannot be surgically cleared for one requester. We clear it ONLY when the note is
          // WHOLLY the requester's (no messages survive) — then the vector was entirely their content.
          // For a SHARED note we leave the (now stale) vector rather than delete more than the rule
          // allows (clearing would drop recall for the KEPT facts too); that residual is reported.
          if (kept.length === 0) { clearEmbedding = true; counts.embeddings_cleared! += 1; }
        }
      }
      if (changed) {
        await this.deps.notes.update(userId, note.id, {
          ...(ex ? { extracted: ex } : {}),
          ...(messages !== note.messages ? { messages, rawText } : {}),
          ...(clearEmbedding ? { embedding: null } : {}),
        });
      }
    }

    const logIds = (await this.deps.extractionLog.listByUser(userId)).filter((r) => mentions(r.input, rn) || mentions(r.rawOutput, rn)).map((r) => r.id);
    if (logIds.length > 0) counts.training_logs = await this.deps.extractionLog.deleteByIds(userId, logIds);

    const categories = toCategories(counts);
    await this.deps.audit.record(userId, { requesterNames, categories, outcome: 'committed' });
    return { categories };
  }
}

function asArr(v: unknown): Array<Record<string, unknown>> {
  return Array.isArray(v) ? (v as Array<Record<string, unknown>>) : [];
}
function asStrArr(v: unknown): string[] {
  return Array.isArray(v) ? (v as unknown[]).filter((x): x is string => typeof x === 'string') : [];
}
function toCategories(counts: Record<string, number>): ErasureCategoryCount[] {
  return Object.entries(counts).filter(([, n]) => n > 0).map(([category, deleted]) => ({ category, deleted }));
}
