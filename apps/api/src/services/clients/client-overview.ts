import type { ClientRepository } from '../../ports/client-repository.js';
import type { NoteRepository } from '../../ports/note-repository.js';
import type { RequirementRepository } from '../../ports/requirement-repository.js';
import type { FactsRepository, PromiseRecord } from '../../ports/facts-repository.js';
import type { MeetingRepository } from '../../ports/meeting-repository.js';
import type { ContactAliasRepository } from '../../ports/contact-alias-repository.js';
import { withReceipt } from '../receipts/receipt.js';
import { isStalePromise } from '../facts/promise-lifecycle.js';
import { summarizeRequirements } from './requirement-summary.js';

/**
 * [P36-5] Everything the client page's header and sections summarise, read from the stored record — no model
 * call, nothing guessed. [P36-7] It also carries the status the EXISTING inference would suggest (going cold
 * past COLD_THRESHOLD_DAYS of silence, or the nightly lost_inferred outcome) — as a suggestion only: nothing
 * here writes a status; only the rep's tap does.
 */
export interface ClientOverviewDeps {
  clients: ClientRepository;
  notes: NoteRepository;
  requirements: RequirementRepository;
  facts: FactsRepository;
  meetings?: MeetingRepository;
  /** [P36-6] learned per-client aliases — shown for search on the Clients list. */
  aliases?: Pick<ContactAliasRepository, 'listByUser'>;
  /** The going-cold threshold the Today / Monday alerts use (config.coldThresholdDays). */
  coldThresholdDays: number;
  /** Overdue past this many days → stale (off the active count, still listed). Default 90. */
  promiseStaleThresholdDays?: number;
}

export type ConversationKind = 'whatsapp' | 'voice' | 'paste' | 'note';
export interface ConversationEntry {
  noteId: string;
  kind: ConversationKind;
  /** Messages in an imported chat; null for a voice note / pasted message (one piece of text). */
  messageCount: number | null;
  /** The latest message's time ("YYYY-MM-DDTHH:MM"), or null when the note has no per-message times. */
  lastAt: string | null;
  /** When it was captured / imported (ms). */
  createdAt: number;
}
export interface StatusSuggestion {
  status: 'cold' | 'done';
  /** With 'done': the outcome the inference points at. */
  outcome?: 'lost';
  /** One plain sentence, e.g. "No reply in 34 days." */
  reason: string;
}
export interface ClientRowSummary { listLine: string | null; lastMessageAt: string | null; overduePromises: number; aliases: string[] }

export interface ClientOverview {
  lastMessageAt: string | null;
  openPromises: number;
  overduePromises: number;
  wants: {
    summary: string | null;
    listLine: string | null;
    budgets: string[];
    items: Array<{ id: string; text: string; quote: string; noteId: string; statedOn: string | null }>;
  };
  promises: Array<ReturnType<typeof withReceipt<PromiseRecord>> & { overdue: boolean; stale: boolean }>;
  nextMeeting: { id: string; datetime: string; title: string | null; confirmed: boolean } | null;
  meetingsCount: number;
  conversations: ConversationEntry[];
  statusSuggestion: StatusSuggestion | null;
}

const DAY_MS = 86_400_000;
const KIND: Record<string, ConversationKind> = { whatsapp_export: 'whatsapp', voice: 'voice', paste: 'paste' };

export class ClientOverviewService {
  constructor(private readonly deps: ClientOverviewDeps) {}

  async forClient(userId: string, clientId: string, nowMs: number): Promise<ClientOverview | null> {
    const client = await this.deps.clients.findByIdForUser(userId, clientId);
    if (!client) return null;
    const [notes, reqs, promisesAll, meetingsAll] = await Promise.all([
      this.deps.notes.listByClient(userId, clientId),
      this.deps.requirements.listByClient(userId, clientId),
      this.deps.facts.listPromisesByUser(userId),
      this.deps.meetings ? this.deps.meetings.listByUser(userId) : Promise.resolve([]),
    ]);

    // Last message: the latest timed message in any of the client's chats (either side); else the latest note.
    let lastMessageAt: string | null = null;
    let lastClientMessageAt: string | null = null;
    const conversations: ConversationEntry[] = [];
    for (const n of notes) {
      let last: string | null = null;
      for (const m of n.messages ?? []) {
        if (m.excluded || !m.sentAt) continue;
        if (!last || m.sentAt > last) last = m.sentAt;
        if (m.role === 'client' && (!lastClientMessageAt || m.sentAt > lastClientMessageAt)) lastClientMessageAt = m.sentAt;
      }
      if (last && (!lastMessageAt || last > lastMessageAt)) lastMessageAt = last;
      conversations.push({ noteId: n.id, kind: KIND[n.source] ?? 'note', messageCount: n.messages && n.messages.length > 0 ? n.messages.length : null, lastAt: last, createdAt: n.createdAt });
    }
    if (!lastMessageAt && notes.length > 0) lastMessageAt = new Date(Math.max(...notes.map((n) => n.createdAt))).toISOString().slice(0, 16);
    conversations.sort((a, b) => (b.lastAt ?? new Date(b.createdAt).toISOString()).localeCompare(a.lastAt ?? new Date(a.createdAt).toISOString()));

    const today = new Date(nowMs).toISOString().slice(0, 10);
    const threshold = this.deps.promiseStaleThresholdDays ?? 90;
    const promises = promisesAll
      .filter((p) => p.clientId === clientId)
      .map((p) => ({ ...withReceipt(p), overdue: !p.done && p.dueDate !== null && p.dueDate < today, stale: !p.done && isStalePromise(p, nowMs, threshold) }))
      .sort((a, b) => Number(a.done) - Number(b.done) || (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'));
    const active = promises.filter((p) => !p.done && !p.stale);

    const open = reqs.filter((r) => r.status === 'open').sort((a, b) => (a.statedOn ?? '').localeCompare(b.statedOn ?? '') || a.createdAt - b.createdAt);
    const s = summarizeRequirements(open);

    const meetings = meetingsAll.filter((m) => m.clientId === clientId);
    const upcoming = meetings
      .filter((m): m is typeof m & { datetime: string } => m.datetime !== null && Date.parse(m.datetime) >= nowMs)
      .sort((a, b) => a.datetime.localeCompare(b.datetime))[0];

    return {
      lastMessageAt,
      openPromises: active.length,
      overduePromises: active.filter((p) => p.overdue).length,
      wants: {
        summary: s.summary,
        listLine: s.listLine,
        budgets: s.budgets,
        items: open.map((r) => ({ id: r.id, text: r.text, quote: r.requirementRaw, noteId: r.noteId, statedOn: r.statedOn })),
      },
      promises,
      nextMeeting: upcoming ? { id: upcoming.id, datetime: upcoming.datetime, title: upcoming.title, confirmed: upcoming.confirmed } : null,
      meetingsCount: meetings.length,
      conversations,
      statusSuggestion: this.suggest(client, nowMs),
    };
  }

  /** [P36-6] One line of facts per client for the Clients list: the wants line (stored requirements), the last
   *  message, the overdue promises (active, not stale) and the learned aliases (for search). */
  async rowSummaries(userId: string, nowMs: number): Promise<Record<string, ClientRowSummary>> {
    const [clients, reqs, promises, aliases] = await Promise.all([
      this.deps.clients.listByUser(userId),
      this.deps.requirements.listOpenByUser(userId),
      this.deps.facts.listPromisesByUser(userId),
      this.deps.aliases ? this.deps.aliases.listByUser(userId) : Promise.resolve([]),
    ]);
    const today = new Date(nowMs).toISOString().slice(0, 10);
    const threshold = this.deps.promiseStaleThresholdDays ?? 90;
    const out: Record<string, ClientRowSummary> = {};
    for (const c of clients) {
      let last: string | null = null;
      for (const n of await this.deps.notes.listByClient(userId, c.id)) {
        for (const m of n.messages ?? []) if (!m.excluded && m.sentAt && (!last || m.sentAt > last)) last = m.sentAt;
      }
      out[c.id] = {
        listLine: summarizeRequirements(reqs.filter((r) => r.clientId === c.id)).listLine,
        lastMessageAt: last,
        overduePromises: promises.filter((p) => p.clientId === c.id && !p.done && p.dueDate !== null && p.dueDate < today && !isStalePromise(p, nowMs, threshold)).length,
        aliases: aliases.filter((a) => a.clientId === c.id).map((a) => a.alias),
      };
    }
    return out;
  }

  /** [P36-7] Every client whose status the existing inference would change — To Confirm cards. Reads only. */
  async suggestions(userId: string, nowMs: number): Promise<Array<StatusSuggestion & { clientId: string; clientName: string }>> {
    const out: Array<StatusSuggestion & { clientId: string; clientName: string }> = [];
    for (const c of await this.deps.clients.listByUser(userId)) {
      const s = this.suggest(c, nowMs);
      if (s) out.push({ clientId: c.id, clientName: c.name, ...s });
    }
    return out;
  }

  /** The status the existing inference points at, if the rep hasn't already said so. Never applied here. */
  private suggest(client: { outcome: string; leadStatus: string | null; lastTouchedAt: number }, nowMs: number): StatusSuggestion | null {
    if (client.leadStatus === 'done') return null;
    const silentDays = Math.floor((nowMs - client.lastTouchedAt) / DAY_MS);
    if (client.outcome === 'lost_inferred') return { status: 'done', outcome: 'lost', reason: `No reply in ${silentDays} days — this deal looks lost.` };
    if (client.outcome !== 'open' || client.leadStatus === 'cold') return null;
    if (silentDays > this.deps.coldThresholdDays) return { status: 'cold', reason: `No reply in ${silentDays} days.` };
    return null;
  }
}
