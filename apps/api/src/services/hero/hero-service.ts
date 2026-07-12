import type { ClientRepository } from '../../ports/client-repository.js';
import type { FactsRepository } from '../../ports/facts-repository.js';
import type { MeetingRepository } from '../../ports/meeting-repository.js';
import type { NoteRepository } from '../../ports/note-repository.js';
import { extractedOf } from '../insights/insights.js';
import { evaluateGate, type GateState, type VolumeGateConfig } from './volume-gate.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_PATTERN_SAMPLE = 2; // a pattern needs >= 2 supporting deals (thin-sample guard)

export interface ClientSignals {
  clientId: string;
  name: string;
  silentDays: number;
  hasDecisionMaker: boolean;
  missedPromises: number;
  openPromises: number;
  upcomingMeetings: number;
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
}

export interface TodayAction {
  kind: 'promise' | 'meeting' | 'cold' | 'risk';
  priority: number;
  text: string;
  clientId: string | null;
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

    const out: ClientSignals[] = [];
    for (const c of clients) {
      const cp = promises.filter((p) => p.clientId === c.id);
      const notes = await this.deps.notes.listByClient(userId, c.id);
      const people = notes.flatMap((n) => extractedOf(n.extracted).people);
      out.push({
        clientId: c.id,
        name: c.name,
        silentDays: (nowMs - c.lastTouchedAt) / DAY_MS,
        hasDecisionMaker: people.some((p) => p.decision_role === 'decision_maker'),
        missedPromises: cp.filter((p) => !p.done && p.dueDate !== null && p.dueDate < todayIso).length,
        openPromises: cp.filter((p) => !p.done).length,
        upcomingMeetings: meetings.filter((m) => m.clientId === c.id && m.datetime !== null && m.datetime >= nowIso).length,
      });
    }
    return out;
  }

  /** Cross-client patterns (P4b-1). Locked below threshold; every pattern cites
   *  its supporting deals; correlation is never phrased as causation. */
  async patterns(userId: string, nowMs: number): Promise<Pattern[]> {
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
        description: 'You have overdue commitments with these clients — a common precursor to lost trust.',
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
        const reasons: string[] = [];
        if (s.silentDays > this.coldThresholdDays) reasons.push(`No contact in ${Math.round(s.silentDays)} days`);
        if (s.missedPromises > 0) reasons.push(`${s.missedPromises} missed promise${s.missedPromises === 1 ? '' : 's'}`);
        if (!s.hasDecisionMaker) reasons.push('No decision-maker contact yet');
        return { clientId: s.clientId, name: s.name, reasons };
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

    const actions: TodayAction[] = [];
    for (const p of promises.filter((p) => !p.done)) {
      if (p.dueDate && p.dueDate <= soonDate) {
        const overdue = p.dueDate < todayDate;
        actions.push({ kind: 'promise', priority: overdue ? 4 : 3, text: `${overdue ? 'Overdue' : 'Due soon'}: ${p.text}`, clientId: p.clientId });
      }
    }
    for (const m of meetings) {
      if (m.datetime && m.datetime >= nowIso && m.datetime <= soonIso) {
        actions.push({ kind: 'meeting', priority: 3, text: `Prep for meeting (${m.datetimeRaw})`, clientId: m.clientId });
      }
    }
    for (const s of sig) {
      if (s.silentDays > this.coldThresholdDays) {
        actions.push({ kind: 'cold', priority: 1, text: `Reach out to ${s.name} — going cold`, clientId: s.clientId });
      }
    }
    return actions.sort((a, b) => b.priority - a.priority).slice(0, 10);
  }
}
