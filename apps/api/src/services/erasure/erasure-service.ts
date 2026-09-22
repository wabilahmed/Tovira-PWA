import type { ClientRepository } from '../../ports/client-repository.js';
import type { NoteRepository, NoteRecord, ImportedMessage } from '../../ports/note-repository.js';
import type { ExtractionLogRepository } from '../../ports/extraction-log-repository.js';
import type { ErasureAuditRepository, ErasureCategoryCount } from '../../ports/erasure-audit-repository.js';
import type { ArchiveIndexRepository } from '../../ports/archive-index-repository.js';
import type { Storage } from '../../ports/storage.js';
import type { ModelClient } from '../../ports/model.js';
import { renderThread } from '../import/dedup.js';
import { EXTRACTION_SYSTEM_PROMPT, EXTRACTION_MAX_TOKENS, buildUserMessage } from '../extraction/prompt.js';

const enc = new TextEncoder();
const dec = new TextDecoder();

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

type WhoStore = 'people' | 'personal_facts' | 'unanswered_questions' | 'messages' | 'archive';

export interface ErasureItem {
  noteId: string;
  clientId: string;
  store: WhoStore;
  match: 'exact' | 'fuzzy';
  who: string; // the matched who-field value (shown in the preview; not persisted to the audit)
  /** [ARCHIVE] set for archived-blob rows: which object + row this item points at (for commit). */
  objectKey?: string;
  rowId?: string;
}

/** Classify one archived NDJSON row (an extraction-log or correction record) by the SAME who-field
 *  rule as the DB stores, using its rawOutput extraction. exact/fuzzy → about; mention → name present
 *  only in free text; none → not the requester. */
function classifyArchiveRow(row: Record<string, unknown>, requesterNorm: string[]): { match: 'exact' | 'fuzzy' | 'mention' | 'none'; who: string } {
  let best: MatchKind = 'none';
  let who = '';
  const rawOutput = typeof row.rawOutput === 'string' ? row.rawOutput : '';
  try {
    const ex = JSON.parse(rawOutput) as Record<string, unknown>;
    for (const [store, field] of [['people', 'name'], ['personal_facts', 'subject'], ['unanswered_questions', 'sender']] as Array<[string, string]>) {
      for (const e of asArr(ex[store])) {
        const m = matchName(e[field] as string, requesterNorm);
        if (rankOf(m) > rankOf(best)) { best = m; who = String(e[field] ?? ''); }
      }
    }
  } catch { /* not an extraction row (e.g. a correction) → fall through to mention check */ }
  if (best !== 'none') return { match: best, who };
  if (mentions(rawOutput, requesterNorm) || mentions(String(row.input ?? ''), requesterNorm) || mentions(JSON.stringify(row), requesterNorm)) {
    return { match: 'mention', who: '' };
  }
  return { match: 'none', who: '' };
}
const rankOf = (m: MatchKind): number => (m === 'exact' ? 2 : m === 'fuzzy' ? 1 : 0);
export interface MentionItem {
  /** Stable id the operator references to FLAG this mention for whole deletion (ERASURE-FLAGS). Derived
   *  from note+store+array-index, so it is identical across previews of the same extraction and lets
   *  commit re-derive-and-match without persisting anything about the requester. */
  id: string;
  noteId: string;
  clientId: string;
  store: string; // 'summary' | 'promise' | 'key_date' | 'meeting' | 'requirement' | 'next_step' | 'concern' | 'personal_fact_body'
  snippet: string; // the kept free-text (preview only)
}
/** The stable flag id for a free-text mention: note + store + index within that store's array (or the
 *  scalar summary). Re-derived identically in preview and commit — no ordering surprise, no residue. */
function mentionId(noteId: string, store: string, index: number): string {
  return `${noteId}:${store}:${index}`;
}
/** Free-text array stores whose mentions the operator may FLAG for whole-element deletion. `summary`
 *  is deliberately NOT here — it is a scalar the rewrite path handles (ERASURE-SUMMARY), never edited. */
const FLAGGABLE_ARRAY_STORES = ['key_date', 'next_step', 'concern'] as const;
export interface ErasurePlan {
  requesterNames: string[];
  autoDelete: ErasureItem[]; // exact structured matches — deleted on commit
  fuzzyCandidates: ErasureItem[]; // partial matches — deleted ONLY if confirmed
  keptMentions: MentionItem[]; // free-text mentions — kept
  logRowIds: string[]; // extraction-log rows referencing the requester — purged on commit
}

/** Which fuzzy candidates the operator confirmed (by note + store + who). */
export interface FuzzyKey { noteId: string; store: WhoStore; who: string }
export interface CommitOptions {
  confirmFuzzy?: FuzzyKey[];
  /** [ARCHIVE] fuzzy-match archive rows the operator confirmed (by object + row id). */
  confirmArchiveRows?: Array<{ objectKey: string; rowId: string }>;
  /** [ERASURE-FLAGS] keptMention ids the operator judged to be ABOUT the requester. Each names a
   *  free-text array element (key_date/next_step/concern) by its stable id; commit deletes that element
   *  WHOLE — never edits it, never touches an unflagged sibling. Ids for other notes/stores are ignored. */
  flaggedMentionIds?: string[];
}
/** [ERASURE-SUMMARY] A note whose REWRITTEN summary still names the requester after her messages were
 *  removed — surfaced for the operator to flag (delete whole), never silently accepted. */
export interface SummaryCandidate { noteId: string; clientId: string; id: string; snippet: string }
export interface ErasureResult {
  categories: ErasureCategoryCount[];
  /** Non-empty → the erasure is NOT fully complete: these rewritten summaries still name the requester
   *  and need the operator to flag them (by `id`) before completion is honest. */
  needsReview: SummaryCandidate[];
}

interface Extraction2 { [k: string]: unknown }

export interface ErasureDeps {
  clients: ClientRepository;
  notes: NoteRepository;
  extractionLog: ExtractionLogRepository;
  audit: ErasureAuditRepository;
  /** [ARCHIVE] the training archive (object storage, outside the DB cascade). Both required to cover
   *  it; absent → the archive is not scanned (dev/in-memory without archival). */
  archiveIndex?: ArchiveIndexRepository;
  archiveStorage?: Storage;
  /** [ERASURE-SUMMARY] The certified extractor, used to RE-summarise a note after the requester's
   *  messages are removed. Wired in prod to a metered client that classes the call `erasure` with NO
   *  userId — it is Prospera's legal obligation, never the rep's usage, so it never touches their spend
   *  cap or extraction ceiling. Absent → no rewrite (dev/in-memory); the old summary is left, and if it
   *  still names the requester it surfaces as an unreviewed candidate. */
  summariser?: ModelClient;
  now?: () => number;
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

      // Free-text MENTIONS → kept, each with a stable id (note+store+FULL-array index) so the operator
      // can FLAG a fact-about hiding in free text for WHOLE deletion (ERASURE-FLAGS). The index is the
      // real array position, so commit removes exactly that element and never a sibling.
      if (mentions(ex.summary as string, rn)) plan.keptMentions.push({ id: mentionId(note.id, 'summary', 0), noteId: note.id, clientId: note.clientId, store: 'summary', snippet: String(ex.summary) });
      asArr(ex.promises).forEach((p, idx) => { if (matchName((p as { subject?: string }).subject, rn) === 'none' && mentions(p.text as string, rn)) plan.keptMentions.push({ id: mentionId(note.id, 'promise', idx), noteId: note.id, clientId: note.clientId, store: 'promise', snippet: String(p.text) }); });
      asArr(ex.key_dates).forEach((d, idx) => { if (mentions(d.description as string, rn)) plan.keptMentions.push({ id: mentionId(note.id, 'key_date', idx), noteId: note.id, clientId: note.clientId, store: 'key_date', snippet: String(d.description) }); });
      (Array.isArray(ex.next_steps) ? ex.next_steps : []).forEach((s, idx) => { if (typeof s === 'string' && mentions(s, rn)) plan.keptMentions.push({ id: mentionId(note.id, 'next_step', idx), noteId: note.id, clientId: note.clientId, store: 'next_step', snippet: s }); });
      (Array.isArray(ex.concerns) ? ex.concerns : []).forEach((s, idx) => { if (typeof s === 'string' && mentions(s, rn)) plan.keptMentions.push({ id: mentionId(note.id, 'concern', idx), noteId: note.id, clientId: note.clientId, store: 'concern', snippet: s }); });
      // A personal_fact whose SUBJECT is someone else but whose FACT text names the requester → mention (kept).
      asArr(ex.personal_facts).forEach((f, idx) => { if (matchName(f.subject as string, rn) === 'none' && mentions(f.fact as string, rn)) plan.keptMentions.push({ id: mentionId(note.id, 'personal_fact_body', idx), noteId: note.id, clientId: note.clientId, store: 'personal_fact_body', snippet: String(f.fact) }); });
    }

    // Training-log hot table (ruling 3): rows whose free-text input/output names the requester.
    for (const row of await this.deps.extractionLog.listByUser(userId)) {
      if (mentions(row.input, rn) || mentions(row.rawOutput, rn)) plan.logRowIds.push(row.id);
    }

    // Training ARCHIVE (object storage, outside the DB cascade) — same who-field rule per row. Listed
    // alongside the DB rows so the operator sees one preview. Best-effort per object here; commit is
    // the fail-loud gate (Task 4).
    if (this.deps.archiveIndex && this.deps.archiveStorage) {
      for (const obj of await this.deps.archiveIndex.listByUser(userId)) {
        let rows: Array<Record<string, unknown>>;
        try { rows = parseNdjson(await this.deps.archiveStorage.get(obj.objectKey)); } catch { continue; }
        for (const row of rows) {
          const { match, who } = classifyArchiveRow(row, rn);
          if (match === 'exact' || match === 'fuzzy') {
            const item: ErasureItem = { noteId: String(row.noteId ?? ''), clientId: '', store: 'archive', match, who, objectKey: obj.objectKey, rowId: String(row.id ?? '') };
            (match === 'exact' ? plan.autoDelete : plan.fuzzyCandidates).push(item);
          } else if (match === 'mention') {
            plan.keptMentions.push({ id: mentionId(String(row.noteId ?? ''), `archive:${obj.collection}`, 0), noteId: String(row.noteId ?? ''), clientId: '', store: `archive:${obj.collection}`, snippet: '(archived training row — mention only)' });
          }
        }
      }
    }
    return plan;
  }

  /** Execute the erasure. Deletes exact structured matches + confirmed fuzzy + log rows; keeps mentions. */
  async commit(userId: string, requesterNames: string[], opts: CommitOptions = {}): Promise<ErasureResult> {
    const rn = requesterNames.map(norm).filter(Boolean);
    const counts: Record<string, number> = { people: 0, personal_facts: 0, unanswered_questions: 0, messages: 0, embeddings_cleared: 0, training_logs: 0, training_archive: 0 };
    const needsReview: SummaryCandidate[] = []; // [ERASURE-SUMMARY] rewritten summaries still naming her
    if (rn.length === 0) return { categories: [], needsReview }; // unknown counterparty → nothing happens, nothing recorded
    const clientNames = new Map((await this.deps.clients.listByUser(userId)).map((c) => [c.id, c.name]));

    // [ARCHIVE] Purge the training archive FIRST (Task 2). It is object storage outside the DB cascade
    // and the riskiest step; going first keeps a storage failure retryable (nothing else changed yet)
    // and makes commit the fail-loud gate — a throw here means the erasure does NOT complete (Task 4).
    if (this.deps.archiveIndex && this.deps.archiveStorage) {
      const confirmedArchive = new Set((opts.confirmArchiveRows ?? []).map((k) => `${k.objectKey}|${k.rowId}`));
      for (const obj of await this.deps.archiveIndex.listByUser(userId)) {
        const rows = parseNdjson(await this.deps.archiveStorage.get(obj.objectKey)); // throws if unreachable → fail loud
        const survivors = rows.filter((row) => {
          const { match } = classifyArchiveRow(row, rn);
          if (match === 'exact') return false; // about → purge (whole row)
          if (match === 'fuzzy') return !confirmedArchive.has(`${obj.objectKey}|${String(row.id ?? '')}`);
          return true; // mention / none → keep whole
        });
        if (survivors.length !== rows.length) {
          counts.training_archive! += rows.length - survivors.length;
          await this.deps.archiveStorage.put(obj.objectKey, enc.encode(toNdjson(survivors)));
          await this.deps.archiveIndex.upsert(userId, { collection: obj.collection, partition: obj.partition, objectKey: obj.objectKey, rowCount: survivors.length });
        }
      }
    }

    const confirmed = new Set((opts.confirmFuzzy ?? []).map((k) => `${k.noteId}|${k.store}|${norm(k.who)}`));
    const flagged = new Set(opts.flaggedMentionIds ?? []); // [ERASURE-FLAGS] operator-flagged free-text ids
    const STORE_KEY: Record<string, string> = { key_date: 'key_dates', next_step: 'next_steps', concern: 'concerns' };
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
        // [ERASURE-FLAGS] Delete operator-flagged free-text mentions WHOLE — drop the flagged array
        // element by its stable id; NEVER edit the text, NEVER touch an unflagged sibling. Counted per
        // store (audit shape only, no content).
        for (const store of FLAGGABLE_ARRAY_STORES) {
          const key = STORE_KEY[store]!;
          if (!Array.isArray(ex[key])) continue;
          const arr = ex[key] as unknown[];
          const kept = arr.filter((_, idx) => !flagged.has(mentionId(note.id, store, idx)));
          const removed = arr.length - kept.length;
          if (removed > 0) { ex[key] = kept; counts[key] = (counts[key] ?? 0) + removed; changed = true; }
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
      // [ERASURE-SUMMARY] The summary is free text that routinely carries a fact ABOUT the requester
      // (the live-UAT finding). If the operator FLAGGED it (or the whole note was hers), delete it WHOLE.
      // Otherwise, when her messages were removed, RE-summarise the survivors with the certified extractor
      // (classed `erasure`, no userId) and take ONLY the new summary — no other field is touched. If the
      // new summary STILL names her, surface it for the operator to flag; never silently accept it.
      if (ex && typeof ex.summary === 'string') {
        const summaryFlagged = flagged.has(mentionId(note.id, 'summary', 0));
        const survivors = (messages ?? []) as ImportedMessage[];
        const msgsRemoved = messages !== note.messages;
        if (summaryFlagged || (msgsRemoved && survivors.length === 0)) {
          ex.summary = null; counts.summaries = (counts.summaries ?? 0) + 1; changed = true; // deleted WHOLE
        } else if (msgsRemoved && survivors.length > 0 && this.deps.summariser) {
          const rewritten = await this.resummarise(clientNames.get(note.clientId) ?? 'the client', survivors);
          if (rewritten !== null) { ex.summary = rewritten; changed = true; } // ONLY the summary — never another field
          if (mentions(typeof ex.summary === 'string' ? ex.summary : '', rn)) {
            needsReview.push({ noteId: note.id, clientId: note.clientId, id: mentionId(note.id, 'summary', 0), snippet: String(ex.summary ?? '') });
          }
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
    return { categories, needsReview };
  }

  /** [ERASURE-SUMMARY] Re-summarise the SURVIVING messages with the certified extractor, returning ONLY
   *  the new summary string (or null on any failure — the caller then surfaces the old one for review).
   *  Classed `erasure` with NO userId, so it is charged to no account: Prospera's legal obligation, never
   *  the rep's spend cap or extraction ceiling. Same certified prompt as production extraction. */
  private async resummarise(clientName: string, survivors: ImportedMessage[]): Promise<string | null> {
    if (!this.deps.summariser) return null;
    const today = new Date((this.deps.now ?? Date.now)()).toISOString().slice(0, 10);
    try {
      const res = await this.deps.summariser.complete({
        system: EXTRACTION_SYSTEM_PROMPT,
        cacheSystemPrompt: true,
        cacheTtl: '1h',
        maxTokens: EXTRACTION_MAX_TOKENS,
        spendClass: 'erasure', // no userId below → recorded account-less, never billed to a rep
        messages: [{ role: 'user', content: buildUserMessage({ today, clientName, source: 'whatsapp_export', text: renderThread(survivors) }) }],
      });
      const parsed = JSON.parse((res.text ?? '').trim()) as { summary?: unknown };
      return typeof parsed.summary === 'string' ? parsed.summary : null;
    } catch {
      return null; // transport or parse failure → leave the old summary; it surfaces as a candidate
    }
  }
}

function asArr(v: unknown): Array<Record<string, unknown>> {
  return Array.isArray(v) ? (v as Array<Record<string, unknown>>) : [];
}
function toNdjson(rows: unknown[]): string {
  return rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '');
}
function parseNdjson(bytes: Uint8Array): Array<Record<string, unknown>> {
  const text = dec.decode(bytes).trim();
  if (!text) return [];
  return text.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l) as Record<string, unknown>);
}
function toCategories(counts: Record<string, number>): ErasureCategoryCount[] {
  return Object.entries(counts).filter(([, n]) => n > 0).map(([category, deleted]) => ({ category, deleted }));
}
