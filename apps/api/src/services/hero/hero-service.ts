import type { ClientRepository } from '../../ports/client-repository.js';
import type { FactsRepository } from '../../ports/facts-repository.js';
import type { MeetingRepository } from '../../ports/meeting-repository.js';
import type { MatchingService } from '../inventory/matching-service.js';
import type { NoteRepository } from '../../ports/note-repository.js';
import { extractedOf } from '../insights/insights.js';
import { restrictNote } from '../erasure/restrict-note.js';
import { NO_RESTRICTION, type Restriction } from '../erasure/restriction.js';
import { isActivePromise } from '../facts/promise-lifecycle.js';
import { evaluateGate, type GateState, type VolumeGateConfig } from './volume-gate.js';
import { withReceipt } from '../receipts/receipt.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_PATTERN_SAMPLE = 2; // a pattern needs >= 2 supporting deals (thin-sample guard)

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** Body date form for register sub-lines (§10): `1 Jul 2026`. Reads a leading
 *  YYYY-MM-DD positionally so no timezone shifts the day. */
function bodyDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : iso;
}

export interface ClientSignals {
  clientId: string;
  name: string;
  silentDays: number;
  hasDecisionMaker: boolean;
  missedPromises: number;
  openPromises: number;
  upcomingMeetings: number;
  /** [P35-3] The client's last message to the rep — a cooling client's receipt. */
  lastClientMessage?: { noteId: string; body: string; at: string } | null;
  /** [P39-5] The oldest missed (overdue, active) promise — the missed-promise reason's receipt. */
  oldestMissed?: { sourceSpan: string | null; sourceMessageAt: string | null; captureAt: string | null; noteId?: string | null } | null;
}

export interface Pattern {
  id: string;
  title: string;
  description: string;
  confidence: 'observed' | 'tentative';
  evidence: Array<{ clientId: string; name: string }>;
}

export interface RiskItem {
  clientId: string;
  name: string;
  reasons: string[];
  /** [P39-5] Each reason with its own receipt — null when no message proves it (Today hides those). */
  details: Array<{ reason: string; receipt: TodayReceipt | null }>;
}

/** [NOTIF-REWORK Task 5] Why this item is on the register — drives the grouped surface. */
export type PriorityReason = 'promise_overdue' | 'promise_due' | 'meeting' | 'cooling' | 'match';

export interface TodayAction {
  kind: 'promise' | 'meeting' | 'cold' | 'risk' | 'match';
  /** The reason group this action belongs to (set at build time; grouping never parses text). */
  reason: PriorityReason;
  priority: number;
  text: string;
  /** A one-line fact with a date/elapsed count — the reason this is on the
   *  register (§10 body date form). e.g. "overdue since 1 Jul 2026", "silent 21 days". */
  subline?: string;
  clientId: string | null;
  /** [P34-2] The client's name (Today shows "Sara Khan · Send the floor plans"); null when none. Optional:
   *  a list cached before this field existed gets it at serve time (withClientNames). */
  clientName?: string | null;
  /** [P34-2] The bare action, without the client name or the "Due soon:" prefix (that is in the subline). */
  title?: string;
  /** [P34-2] Whose action it is — a client-owned promise reads "Sara Khan promised: …". */
  owner?: 'rep' | 'client';
  /** [P34-2] The promise / meeting this action came from (for its receipt). */
  refId?: string;
  /** [P39-5] A promise's due date (YYYY-MM-DD) — Today's "Overdue" / "Due today" / "Due Thu" badge. */
  dueDate?: string;
  /** [P34-7] Where this came from, fetched WITH the list: the stored verbatim span + when it was said
   *  ('message' = chat time, 'capture' = the rep's own note's date, 'none' = no span saved), or for a cooling
   *  client the last contact ('contact', date only). Absent on a list cached before this field existed. */
  receipt?: TodayReceipt;
}

export interface TodayReceipt {
  quote: string | null;
  source: 'message' | 'capture' | 'none' | 'contact';
  /** ISO instant ('message') or YYYY-MM-DD ('capture' / 'contact'); null when unknown. */
  at: string | null;
  /** [P35-3] The note it came from — the screen shows the message as a chat bubble. */
  noteId?: string;
}

const receiptOf = (f: { sourceSpan: string | null; sourceMessageAt: string | null; captureAt: string | null; noteId?: string | null }): TodayReceipt => {
  const r = withReceipt(f).receipt;
  return { quote: r.quote, source: r.source, at: r.at, ...(f.noteId ? { noteId: f.noteId } : {}) };
};

/** [P34-2] Fill in the client name on actions that lack it (a list cached before clientName existed). A name
 *  already present is kept; an unknown client → null. Pure: no model call, no extra fetch per action. */
export function withClientNames(actions: TodayAction[], names: ReadonlyMap<string, string>): TodayAction[] {
  return actions.map((a) => (a.clientName !== undefined ? a : { ...a, clientName: a.clientId ? names.get(a.clientId) ?? null : null }));
}

export interface HeroDeps {
  clients: ClientRepository;
  facts: FactsRepository;
  meetings: MeetingRepository;
  notes: NoteRepository;
}

export class HeroService {
  constructor(
    private readonly deps: HeroDeps,
    private readonly gateConfig: VolumeGateConfig,
    private readonly coldThresholdDays: number,
    /** [PROMISE-STALE] days overdue after which a promise drops off the active surface (Today's register,
     *  counts) — still stored/searchable. */
    private readonly promiseStaleThresholdDays: number,
    /** INV-MATCH (§11.4): STRONG matches enter Today's register, below every fact. Optional. */
    private readonly matching?: MatchingService,
    /** [TASK 2] Active erasure-window restriction — a restricted counterparty's facts never drive the
     *  daily list (e.g. its person entries are not counted as decision-makers). Absent → no restriction. */
    private readonly restriction?: { forUser(userId: string): Promise<Restriction> },
    /** [P40-3 · owner] Cross-client patterns are parked: OFF unless PATTERNS_ENABLED=true. The code is kept. */
    private readonly opts: { patternsEnabled?: boolean } = {},
  ) {}

  async status(userId: string): Promise<GateState> {
    const clients = await this.deps.clients.listByUser(userId);
    let notes = 0;
    for (const c of clients) notes += (await this.deps.notes.listByClient(userId, c.id)).length;
    return evaluateGate({ clients: clients.length, notes }, this.gateConfig);
  }

  private async signals(userId: string, nowMs: number): Promise<ClientSignals[]> {
    const clients = await this.deps.clients.listByUser(userId);
    const promises = await this.deps.facts.listPromisesByUser(userId);
    const meetings = await this.deps.meetings.listByUser(userId);
    const todayIso = new Date(nowMs).toISOString().slice(0, 10);
    const nowIso = new Date(nowMs).toISOString();
    // [TASK 2] A restricted counterparty's facts must not drive the daily list.
    const restriction = this.restriction ? await this.restriction.forUser(userId) : NO_RESTRICTION;

    const out: ClientSignals[] = [];
    for (const c of clients) {
      const cp = promises.filter((p) => p.clientId === c.id);
      const rawNotes = await this.deps.notes.listByClient(userId, c.id);
      const notes = restriction.active ? rawNotes.map((n) => restrictNote(n, restriction)) : rawNotes;
      const people = notes.flatMap((n) => extractedOf(n.extracted).people);
      let lastClientMessage: { noteId: string; body: string; at: string } | null = null;
      for (const n of notes) for (const m of n.messages ?? []) {
        if (m.role === 'client' && !m.excluded && m.sentAt && (!lastClientMessage || m.sentAt > lastClientMessage.at)) lastClientMessage = { noteId: n.id, body: m.body, at: m.sentAt };
      }
      const missed = cp
        .filter((p) => isActivePromise(p, nowMs, this.promiseStaleThresholdDays) && p.dueDate !== null && p.dueDate < todayIso)
        .sort((a, b) => (a.dueDate! < b.dueDate! ? -1 : a.dueDate! > b.dueDate! ? 1 : 0));
      out.push({
        clientId: c.id,
        oldestMissed: missed[0] ?? null,
        name: c.name,
        silentDays: (nowMs - c.lastTouchedAt) / DAY_MS,
        hasDecisionMaker: people.some((p) => p.decision_role === 'decision_maker'),
        // [PROMISE-STALE] active only: a promise overdue >threshold is stale — off the count/claret.
        missedPromises: cp.filter((p) => isActivePromise(p, nowMs, this.promiseStaleThresholdDays) && p.dueDate !== null && p.dueDate < todayIso).length,
        openPromises: cp.filter((p) => isActivePromise(p, nowMs, this.promiseStaleThresholdDays)).length,
        upcomingMeetings: meetings.filter((m) => m.clientId === c.id && m.datetime !== null && m.datetime >= nowIso).length,
        lastClientMessage,
      });
    }
    return out;
  }

  /** Cross-client patterns (P4b-1). Locked below threshold; every pattern cites
   *  its supporting deals; correlation is never phrased as causation. */
  async patterns(userId: string, nowMs: number): Promise<Pattern[]> {
    if (!this.opts.patternsEnabled) return []; // [P40-3] parked: shown nowhere while the switch is off
    if (!(await this.status(userId)).unlocked) return [];
    const sig = await this.signals(userId, nowMs);
    const patterns: Pattern[] = [];

    const quiet = sig.filter((s) => s.silentDays > this.coldThresholdDays && !s.hasDecisionMaker);
    if (quiet.length >= MIN_PATTERN_SAMPLE) {
      patterns.push({
        id: 'quiet-no-decision-maker',
        title: 'Quiet deals with no decision-maker reached',
        description:
          'These clients have gone quiet and you haven’t reached a decision-maker. Across your book, that combination has often shown up before a deal goes dark.',
        confidence: 'observed',
        evidence: quiet.map((s) => ({ clientId: s.clientId, name: s.name })),
      });
    }

    const overdue = sig.filter((s) => s.missedPromises > 0);
    if (overdue.length >= MIN_PATTERN_SAMPLE) {
      patterns.push({
        id: 'overdue-promises',
        title: 'Clients with overdue promises',
        description: 'You have overdue commitments with these clients, a common precursor to lost trust.',
        confidence: 'observed',
        evidence: overdue.map((s) => ({ clientId: s.clientId, name: s.name })),
      });
    }
    // Only patterns with real evidence are ever returned.
    return patterns.filter((p) => p.evidence.length >= MIN_PATTERN_SAMPLE);
  }

  /** Deal-risk radar (P4b-2). Locked below threshold; a deal is flagged only on
   *  MULTIPLE real signals, each shown as a reason. */
  async risk(userId: string, nowMs: number): Promise<RiskItem[]> {
    if (!(await this.status(userId)).unlocked) return [];
    const sig = await this.signals(userId, nowMs);
    return sig
      .map((s) => {
        const details: RiskItem['details'] = [];
        // [P39-5] Silence rests on the client's last message to the rep (none on file → no receipt).
        if (s.silentDays > this.coldThresholdDays) {
          const m = s.lastClientMessage;
          details.push({ reason: `No contact in ${Math.round(s.silentDays)} days`, receipt: m ? { quote: m.body, source: 'message', at: m.at, noteId: m.noteId } : null });
        }
        // Missed promises rest on the oldest one's own words (no saved words → no receipt).
        if (s.missedPromises > 0) {
          const r = s.oldestMissed ? receiptOf(s.oldestMissed) : null;
          details.push({ reason: `${s.missedPromises} missed promise${s.missedPromises === 1 ? '' : 's'}`, receipt: r && r.quote ? r : null });
        }
        // An absence: no message proves it, so never a quote.
        if (!s.hasDecisionMaker) details.push({ reason: 'No decision-maker contact yet', receipt: null });
        return { clientId: s.clientId, name: s.name, reasons: details.map((d) => d.reason), details };
      })
      .filter((r) => r.reasons.length >= 2);
  }

  /** "What should I do today?" (P4b-3). Always on; ranks the highest-leverage
   *  actions; degrades gracefully; zero data → empty (no fabricated tasks). */
  async today(userId: string, nowMs: number): Promise<TodayAction[]> {
    const sig = await this.signals(userId, nowMs);
    const promises = await this.deps.facts.listPromisesByUser(userId);
    const meetings = await this.deps.meetings.listByUser(userId);
    const soonIso = new Date(nowMs + 3 * DAY_MS).toISOString();
    const soonDate = soonIso.slice(0, 10);
    const nowIso = new Date(nowMs).toISOString();
    const todayDate = nowIso.slice(0, 10);

    const nameOf = new Map(sig.map((s) => [s.clientId, s.name]));
    const clientName = (id: string | null) => (id ? nameOf.get(id) ?? null : null);
    const actions: TodayAction[] = [];
    // [PROMISE-STALE] Today's register shows the ACTIVE set only — a promise overdue past the window
    // is stale and drops off here (still stored/searchable, and still surfaced by the Book Scan count).
    for (const p of promises.filter((p) => isActivePromise(p, nowMs, this.promiseStaleThresholdDays))) {
      if (p.dueDate && p.dueDate <= soonDate) {
        const overdue = p.dueDate < todayDate;
        actions.push({
          kind: 'promise',
          reason: overdue ? 'promise_overdue' : 'promise_due',
          priority: overdue ? 4 : 3,
          text: `${overdue ? 'Overdue' : 'Due soon'}: ${p.text}`,
          clientId: p.clientId,
          subline: `${overdue ? 'overdue since' : 'due'} ${bodyDate(p.dueDate)}`,
          clientName: clientName(p.clientId),
          title: p.text,
          owner: p.owner === 'client' ? 'client' : 'rep',
          refId: p.id,
          dueDate: p.dueDate,
          receipt: receiptOf(p),
        });
      }
    }
    for (const m of meetings) {
      if (m.datetime && m.datetime >= nowIso && m.datetime <= soonIso) {
        actions.push({ kind: 'meeting', reason: 'meeting', priority: 3, text: `Prep for meeting (${m.datetimeRaw})`, clientId: m.clientId, subline: `meeting ${m.datetimeRaw}`, clientName: clientName(m.clientId), title: `Prep for the meeting (${m.datetimeRaw})`, refId: m.id, receipt: receiptOf(m) });
      }
    }
    for (const s of sig) {
      if (s.silentDays > this.coldThresholdDays) {
        actions.push({ kind: 'cold', reason: 'cooling', priority: 1, text: `Reach out to ${s.name}. Going cold for ${Math.round(s.silentDays)} days`, clientId: s.clientId, subline: `silent ${Math.round(s.silentDays)} days`, clientName: s.name, title: `Reach out. Going cold for ${Math.round(s.silentDays)} days`, receipt: s.lastClientMessage
          // [P35-3] their last message to you, as the receipt; else the last-contact date
          ? { quote: s.lastClientMessage.body, source: 'message', at: s.lastClientMessage.at, noteId: s.lastClientMessage.noteId }
          : { quote: null, source: 'contact', at: new Date(nowMs - s.silentDays * DAY_MS).toISOString().slice(0, 10) } });
      }
    }
    // INV-MATCH: STRONG matches enter the register at priority 0 — BELOW every fact (overdue
    // promises, cooling clients, meetings), because a match is a guess and a guess ranks under a
    // fact. Each carries its receipt inline (the client's quoted words + date) — never a bare match.
    if (this.matching) {
      for (const s of await this.matching.suggestionsForUser(userId)) {
        const client = await this.deps.clients.findByIdForUser(userId, s.clientId);
        const when = s.receipt.statedOn ? ` · ${bodyDate(s.receipt.statedOn)}` : '';
        actions.push({
          kind: 'match',
          reason: 'match',
          priority: 0,
          text: `${s.itemTitle} may suit ${client?.name ?? 'a client'}`,
          clientId: s.clientId,
          subline: `asked: "${s.receipt.requirementRaw}"${when}`,
          clientName: client?.name ?? null,
          title: `${s.itemTitle} may suit them`,
          receipt: { quote: s.receipt.requirementRaw, source: 'message', at: s.receipt.statedOn },
        });
      }
    }
    return actions.sort((a, b) => b.priority - a.priority).slice(0, 10);
  }
}
