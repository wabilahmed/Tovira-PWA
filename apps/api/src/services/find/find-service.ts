import type { ClientRepository, ClientRecord } from '../../ports/client-repository.js';
import type { FactsRepository, PromiseRecord } from '../../ports/facts-repository.js';
import type { NoteRepository } from '../../ports/note-repository.js';
import type { RequirementRepository, RequirementRecord } from '../../ports/requirement-repository.js';
import type { HeroService } from '../hero/hero-service.js';
import { isActivePromise } from '../facts/promise-lifecycle.js';
import { restrictNote } from '../erasure/restrict-note.js';
import { NO_RESTRICTION, type Restriction } from '../erasure/restriction.js';
import { budgetAmount, primaryRequirement, requirementFacets, summarizeRequirements } from '../clients/requirement-summary.js';

/**
 * [P39-7] Find: fixed questions with fixed answers, read from what is STORED — clients, promises, requirements,
 * chat messages. No free text, no vector search, NO MODEL CALL, so Find never uses the rep's allowance and can
 * only ever show what is on record, each line with its receipt. Every rule is written down here:
 *
 *   missed-promises    open (not done), past due, not stale (≤ the stale window, 90 days) — both sides, labelled.
 *   due-this-week      open, not stale, due Monday–Sunday of the current week (UTC, like Today).
 *   no-reply           not closed; the client's last message to the rep is more than 14 days old. A client with
 *                      no message from them on record is NOT listed (no receipt to show — a wrong fact is worse).
 *   wanting            the open-requirements set, filtered by property type / area / budget band — the options
 *                      are only the values stored for the rep's clients.
 *   deals-at-risk      the same as Today: hero risk, each client with at least one reason that has its receipt.
 *   open-requirements  the P35-1 rule: ≥ 1 open requirement, client not closed (won / lost_confirmed / Done).
 *   active-clients     status Warm, or no status with any message in the last COLD_THRESHOLD_DAYS (30).
 *   cold-clients       status Cold, plus any not-Done, not-closed client silent past COLD_THRESHOLD_DAYS
 *                      ("Gone quiet, 34 days"). Reading this never changes a status.
 *
 * An active erasure restriction withholds the restricted counterparty's messages and quotes (TASK 2).
 */
export const FIND_QUERIES = ['missed-promises', 'due-this-week', 'no-reply', 'wanting', 'deals-at-risk', 'open-requirements', 'active-clients', 'cold-clients'] as const;
export type FindQuery = (typeof FIND_QUERIES)[number];
export const isFindQuery = (q: string): q is FindQuery => (FIND_QUERIES as readonly string[]).includes(q);

export type WantingBy = 'type' | 'area' | 'budget' | 'beds';
export interface WantingFilter { by: WantingBy; value: string }

export interface FindReceipt {
  quote: string;
  /** ISO instant (a message) or YYYY-MM-DD; null when unknown. */
  at: string | null;
  noteId: string | null;
  clientId: string;
  sender: string | null;
}

export interface FindItem {
  clientId: string;
  clientName: string;
  /** The line: the promise, the wants, "Last replied 1 Sep". */
  line: string;
  /** The small line under it: "Due 1 Oct", "Gone quiet, 34 days". */
  meta: string | null;
  overdue: boolean;
  /** Whose promise — the screen labels "Yours" / "Theirs". */
  owner: 'rep' | 'client' | null;
  /** The narrowing chips this item belongs to (built from the result set). */
  tags: string[];
  receipt: FindReceipt | null;
}

export interface FindResult {
  query: FindQuery;
  count: number;
  items: FindItem[];
  /** Shown under the list (e.g. the stale-promise note); null when none. */
  footnote: string | null;
}

export interface WantingOptions {
  type: string[];
  area: string[];
  budget: Array<{ value: string; label: string }>;
}

export interface FindDeps {
  clients: Pick<ClientRepository, 'listByUser'>;
  facts: Pick<FactsRepository, 'listPromisesByUser'>;
  notes: Pick<NoteRepository, 'listByClient'>;
  requirements: Pick<RequirementRepository, 'listOpenByUser'>;
  hero: Pick<HeroService, 'risk'>;
  restriction?: { forUser(userId: string): Promise<Restriction> };
  coldThresholdDays: number;
  promiseStaleThresholdDays: number;
}

const DAY_MS = 86_400_000;
const NO_REPLY_DAYS = 14;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/** Budget bands for "Clients wanting… → Budget" — only bands holding at least one stored budget are offered. */
export const BUDGET_BANDS: Array<{ value: string; label: string; min: number; max: number }> = [
  { value: 'under-1m', label: 'Under AED 1M', min: 0, max: 1_000_000 },
  { value: '1m-2m', label: 'AED 1–2M', min: 1_000_000, max: 2_000_000 },
  { value: '2m-5m', label: 'AED 2–5M', min: 2_000_000, max: 5_000_000 },
  { value: '5m-10m', label: 'AED 5–10M', min: 5_000_000, max: 10_000_000 }, // [P40-3 · owner]
  { value: 'over-10m', label: 'Over AED 10M', min: 10_000_000, max: Infinity }, // [P40-3 · owner]
];

/** "2026-09-01…" → "1 Sep" this year, "1 Sep 2025" otherwise (read positionally — no timezone drift). */
export function shortDate(iso: string, nowMs: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const thisYear = new Date(nowMs).getUTCFullYear() === Number(m[1]);
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}${thisYear ? '' : ` ${m[1]}`}`;
}
const dayOf = (iso: string | null | undefined): string | null => (iso ? /^(\d{4}-\d{2}-\d{2})/.exec(iso)?.[1] ?? null : null);
const isClosed = (c: ClientRecord): boolean => c.outcome === 'won' || c.outcome === 'lost_confirmed' || c.leadStatus === 'done';
const statusTag = (c: ClientRecord): string => (c.leadStatus === 'warm' ? 'Warm' : c.leadStatus === 'cold' ? 'Cold' : c.leadStatus === 'done' ? 'Done' : 'No status');
const reqDay = (r: RequirementRecord) => r.statedOn ?? new Date(r.createdAt).toISOString().slice(0, 10);

export class FindService {
  constructor(private readonly deps: FindDeps) {}

  async run(userId: string, query: FindQuery, nowMs: number, filter?: WantingFilter | WantingFilter[]): Promise<FindResult> {
    switch (query) {
      case 'missed-promises': return this.promises(userId, query, nowMs, 'missed');
      case 'due-this-week': return this.promises(userId, query, nowMs, 'week');
      case 'no-reply': return this.noReply(userId, nowMs);
      case 'wanting': return this.requirementsList(userId, query, nowMs, filter ? (Array.isArray(filter) ? filter : [filter]) : null);
      case 'open-requirements': return this.requirementsList(userId, query, nowMs, null);
      case 'deals-at-risk': return this.risk(userId, nowMs);
      case 'active-clients': return this.activity(userId, nowMs, 'active');
      case 'cold-clients': return this.activity(userId, nowMs, 'cold');
    }
  }

  /** The "Clients wanting…" options: only property types, areas and budget bands stored for open requirements. */
  async wantingOptions(userId: string): Promise<WantingOptions> {
    const { perClient } = await this.openRequirements(userId);
    const types = new Set<string>();
    const areas = new Set<string>();
    const bands = new Set<string>();
    // [P40-5] each requirement's own values — never a type from one and an area from another
    for (const reqs of perClient.values()) for (const r of reqs) {
      const f = requirementFacets([r]);
      if (f.type) types.add(f.type);
      if (f.area) areas.add(f.area);
      const b = f.budgets[f.budgets.length - 1];
      if (b) { const v = budgetAmount(b); const band = BUDGET_BANDS.find((x) => v >= x.min && v < x.max); if (band) bands.add(band.value); }
    }
    return {
      type: [...types].sort(),
      area: [...areas].sort(),
      budget: BUDGET_BANDS.filter((b) => bands.has(b.value)).map(({ value, label }) => ({ value, label })),
    };
  }

  private async restriction(userId: string): Promise<Restriction> {
    return this.deps.restriction ? this.deps.restriction.forUser(userId) : NO_RESTRICTION;
  }

  /** [TASK 2] Is this quote the restricted counterparty's? It names them, the client IS them, or it was said in
   *  a message they sent. Loaded lazily, only while a restriction is active. */
  private withholder(userId: string, r: Restriction, nameOf: Map<string, string>): (clientId: string, noteId: string | null, quote: string) => Promise<boolean> {
    const restrictedBodies = new Map<string, string[]>();
    return async (clientId, noteId, quote) => {
      if (!r.active) return false;
      if (r.restrictsText(quote) || r.restrictsWho(nameOf.get(clientId) ?? '')) return true;
      if (!restrictedBodies.has(clientId)) {
        const bodies: string[] = [];
        for (const n of await this.deps.notes.listByClient(userId, clientId)) {
          for (const m of n.messages ?? []) if (r.restrictsWho(m.sender)) bodies.push(`${n.id}\u0000${m.body}`);
        }
        restrictedBodies.set(clientId, bodies);
      }
      const q = quote.trim().toLowerCase();
      return restrictedBodies.get(clientId)!.some((x) => {
        const [nid, body] = x.split('\u0000') as [string, string];
        const b = body.trim().toLowerCase();
        return (noteId === null || nid === noteId) && q.length > 0 && (b.includes(q) || q.includes(b));
      });
    };
  }

  private async promises(userId: string, query: FindQuery, nowMs: number, kind: 'missed' | 'week'): Promise<FindResult> {
    const [clients, promises, r] = await Promise.all([this.deps.clients.listByUser(userId), this.deps.facts.listPromisesByUser(userId), this.restriction(userId)]);
    const nameOf = new Map(clients.map((c) => [c.id, c.name]));
    const today = new Date(nowMs).toISOString().slice(0, 10);
    const weekday = (new Date(nowMs).getUTCDay() + 6) % 7; // Monday = 0
    const weekStart = new Date(nowMs - weekday * DAY_MS).toISOString().slice(0, 10);
    const weekEnd = new Date(nowMs + (6 - weekday) * DAY_MS).toISOString().slice(0, 10);
    const picked = promises
      .filter((p) => isActivePromise(p, nowMs, this.deps.promiseStaleThresholdDays) && p.dueDate !== null)
      .filter((p) => (kind === 'missed' ? p.dueDate! < today : p.dueDate! >= weekStart && p.dueDate! <= weekEnd))
      .sort((a, b) => a.dueDate!.localeCompare(b.dueDate!));
    const withheld = this.withholder(userId, r, nameOf);
    const items: FindItem[] = [];
    for (const p of picked) {
      const overdue = p.dueDate! < today;
      const owner = p.owner === 'client' ? 'client' : 'rep';
      const receipt = promiseReceipt(p, r);
      // A restricted counterparty's promise is withheld whole — its text is their words too.
      if (r.active) {
        const span = p.sourceSpan?.trim();
        if (span ? await withheld(p.clientId, p.noteId, span) : r.restrictsWho(nameOf.get(p.clientId) ?? '')) continue;
      }
      items.push({
        clientId: p.clientId,
        clientName: nameOf.get(p.clientId) ?? 'A client',
        line: p.text,
        meta: p.dueDate === today ? 'Due today' : `Due ${kind === 'week' ? `${WEEKDAYS[new Date(`${p.dueDate}T00:00:00Z`).getUTCDay()]} ` : ''}${shortDate(p.dueDate!, nowMs)}`,
        overdue,
        owner,
        tags: [owner === 'rep' ? 'Yours' : 'Theirs'],
        receipt,
      });
    }
    return {
      query,
      count: items.length,
      items,
      footnote: kind === 'missed' ? `Promises more than ${this.deps.promiseStaleThresholdDays} days overdue are kept, but not shown here.` : null,
    };
  }

  /** The newest message per client: theirs, and anyone's (restricted senders withheld). */
  private async lastMessages(userId: string, clients: ClientRecord[], r: Restriction): Promise<Map<string, { theirs: FindReceipt | null; anyAt: string | null }>> {
    const out = new Map<string, { theirs: FindReceipt | null; anyAt: string | null }>();
    for (const c of clients) {
      let theirs: FindReceipt | null = null;
      let anyAt: string | null = null;
      for (const raw of await this.deps.notes.listByClient(userId, c.id)) {
        const n = r.active ? restrictNote(raw, r) : raw;
        for (const m of n.messages ?? []) {
          if (m.excluded || !m.sentAt) continue;
          if (!anyAt || m.sentAt > anyAt) anyAt = m.sentAt;
          if (m.role === 'client' && (!theirs || m.sentAt > theirs.at!)) theirs = { quote: m.body, at: m.sentAt, noteId: n.id, clientId: c.id, sender: m.sender ?? c.name };
        }
      }
      out.set(c.id, { theirs, anyAt });
    }
    return out;
  }

  private async noReply(userId: string, nowMs: number): Promise<FindResult> {
    const r = await this.restriction(userId);
    const clients = (await this.deps.clients.listByUser(userId)).filter((c) => !isClosed(c));
    const last = await this.lastMessages(userId, clients, r);
    const cutoff = nowMs - NO_REPLY_DAYS * DAY_MS;
    const rows = clients
      .map((c) => ({ c, theirs: last.get(c.id)?.theirs ?? null }))
      .filter((x) => x.theirs && Date.parse(`${x.theirs.at!.slice(0, 16)}:00Z`) < cutoff)
      .sort((a, b) => a.theirs!.at!.localeCompare(b.theirs!.at!)); // longest silence first
    const items = rows.map(({ c, theirs }): FindItem => ({
      clientId: c.id, clientName: c.name, line: `Last replied ${shortDate(theirs!.at!, nowMs)}`, meta: null, overdue: false, owner: null, tags: [statusTag(c)], receipt: theirs,
    }));
    return { query: 'no-reply', count: items.length, items, footnote: null };
  }

  private async openRequirements(userId: string): Promise<{ clients: ClientRecord[]; perClient: Map<string, RequirementRecord[]> }> {
    const [clients, open] = await Promise.all([this.deps.clients.listByUser(userId), this.deps.requirements.listOpenByUser(userId)]);
    const perClient = new Map<string, RequirementRecord[]>();
    const live = new Set(clients.filter((c) => !isClosed(c)).map((c) => c.id));
    for (const req of open) if (live.has(req.clientId)) perClient.set(req.clientId, [...(perClient.get(req.clientId) ?? []), req]);
    return { clients, perClient };
  }

  private async requirementsList(userId: string, query: FindQuery, nowMs: number, filter: WantingFilter[] | null): Promise<FindResult> {
    const [{ clients, perClient }, r] = await Promise.all([this.openRequirements(userId), this.restriction(userId)]);
    const withheld = this.withholder(userId, r, new Map(clients.map((c) => [c.id, c.name])));
    const items: FindItem[] = [];
    for (const c of clients) {
      const reqs = perClient.get(c.id);
      if (!reqs || reqs.length === 0) continue;
      // [P40-5] every filter must hold on the SAME requirement
      if (filter && !reqs.some((r) => matchesAll(requirementFacets([r]), filter))) continue;
      const primary = primaryRequirement(reqs);
      const f = primary ? requirementFacets([primary]) : requirementFacets(reqs);
      const latest = reqs.slice().sort((a, b) => reqDay(b).localeCompare(reqDay(a)))[0]!;
      const quote = (latest.requirementRaw || latest.text).trim();
      // A restricted counterparty's wants are withheld whole (the line is read from their words).
      if (await withheld(c.id, latest.noteId, quote)) continue;
      items.push({
        clientId: c.id,
        clientName: c.name,
        line: summarizeRequirements(reqs).listLine ?? reqs.map((x) => x.text.trim()).filter(Boolean).join(', '),
        meta: null,
        overdue: false,
        owner: null,
        tags: [f.type ?? 'Other'],
        receipt: { quote, at: latest.statedOn, noteId: latest.noteId, clientId: c.id, sender: c.name },
      });
    }
    void nowMs;
    return { query, count: items.length, items, footnote: null };
  }

  private async risk(userId: string, nowMs: number): Promise<FindResult> {
    const items: FindItem[] = [];
    for (const r of await this.deps.hero.risk(userId, nowMs)) {
      const shown = (r.details ?? []).filter((d) => d.receipt && d.receipt.quote);
      if (shown.length === 0) continue; // a reason without its receipt is not shown (same rule as Today)
      const first = shown[0]!.receipt!;
      items.push({
        clientId: r.clientId,
        clientName: r.name,
        line: shown.map((d) => d.reason).join(' · '),
        meta: null,
        overdue: false,
        owner: null,
        tags: shown.map((d) => (/missed promise/.test(d.reason) ? 'Missed promise' : /No contact/.test(d.reason) ? 'No contact' : d.reason)),
        receipt: { quote: first.quote!, at: first.at, noteId: first.noteId ?? null, clientId: r.clientId, sender: r.name },
      });
    }
    return { query: 'deals-at-risk', count: items.length, items, footnote: null };
  }

  private async activity(userId: string, nowMs: number, kind: 'active' | 'cold'): Promise<FindResult> {
    const r = await this.restriction(userId);
    const clients = await this.deps.clients.listByUser(userId);
    const last = await this.lastMessages(userId, clients, r);
    const reqs = (await this.openRequirements(userId)).perClient;
    const threshold = this.deps.coldThresholdDays;
    const items: FindItem[] = [];
    for (const c of clients) {
      const silentDays = Math.floor((nowMs - c.lastTouchedAt) / DAY_MS);
      const m = last.get(c.id);
      const anyRecent = m?.anyAt ? nowMs - Date.parse(`${m.anyAt.slice(0, 16)}:00Z`) <= threshold * DAY_MS : false;
      const quiet = !isClosed(c) && silentDays > threshold;
      const include = kind === 'active'
        ? c.leadStatus === 'warm' || (c.leadStatus === null && !isClosed(c) && anyRecent)
        : c.leadStatus === 'cold' || quiet;
      if (!include) continue;
      const wants = reqs.get(c.id);
      items.push({
        clientId: c.id,
        clientName: c.name,
        line: (wants && summarizeRequirements(wants).listLine) || (m?.anyAt ? `Last message ${shortDate(m.anyAt, nowMs)}` : 'No messages on record'),
        meta: kind === 'cold' ? (quiet ? `Gone quiet, ${silentDays} days` : 'Marked Cold') : null,
        overdue: false,
        owner: null,
        tags: kind === 'cold' ? [quiet ? 'Gone quiet' : 'Marked Cold'] : [statusTag(c)],
        receipt: m?.theirs ?? null,
      });
    }
    return { query: kind === 'active' ? 'active-clients' : 'cold-clients', count: items.length, items, footnote: null };
  }
}

/** [P40-5] One requirement's facets against every filter. */
function matchesAll(f: ReturnType<typeof requirementFacets>, filters: WantingFilter[]): boolean {
  return filters.every((x) => {
    if (x.by === 'type') return f.type === x.value;
    if (x.by === 'area') return f.area === x.value;
    if (x.by === 'beds') return f.beds === x.value;
    const band = BUDGET_BANDS.find((b) => b.value === x.value);
    const b = f.budgets[f.budgets.length - 1];
    if (!band || !b) return false;
    const v = budgetAmount(b);
    return v >= band.min && v < band.max;
  });
}

/** A promise's receipt: its own stored words; withheld when they cite a restricted counterparty. */
function promiseReceipt(p: PromiseRecord, r: Restriction): FindReceipt | null {
  const quote = p.sourceSpan?.trim();
  if (!quote || (r.active && r.restrictsText(quote))) return null;
  return { quote, at: p.sourceMessageAt ?? p.captureAt ?? dayOf(new Date(p.createdAt).toISOString()), noteId: p.noteId, clientId: p.clientId, sender: null };
}
