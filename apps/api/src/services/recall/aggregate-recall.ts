import type { ClientRepository, ClientRecord } from '../../ports/client-repository.js';
import type { RequirementRepository, RequirementRecord } from '../../ports/requirement-repository.js';
import type { FactsRepository } from '../../ports/facts-repository.js';
import type { NoteRepository } from '../../ports/note-repository.js';
import type { Receipt } from './recall-service.js';
import { queryTerms, termHits } from './query-terms.js';
import { asksAboutMyPromises } from './structured-recall.js';
import { isActivePromise } from '../facts/promise-lifecycle.js';

/**
 * [P35-1] Count and list questions ACROSS clients — "how many clients have open requirements?", "which clients
 * have a budget over 2M?", "who wants a villa?", "list my clients" — answered from the STRUCTURED tables
 * (clients, requirements), never from vector search and never with a model call: the count first, then one
 * line per client with its own receipts; over 10 → the first 10 and "and N more"; zero is an answer, never
 * "I don't have that on record". The listed clients become the "previous answer" a follow-up ("which of them
 * need parking?") is scoped to (P21-A2 — they are named in the answer text).
 *
 * OPEN REQUIREMENT (the rule): a client counts when it has ≥ 1 stored requirement whose status is 'open' (the
 * requirement lifecycle's 'met' and 'dormant' are excluded — listOpenByUser) AND the client is not closed:
 * outcome 'won' or 'lost_confirmed', or lead status 'done'. A silence-inferred loss ('lost_inferred') is NOT a
 * closure (D6: an inferred loss is treated as cold). There is no "archived" client state in the schema.
 *
 * Questions this does not recognise return null and go down the normal Ask path unchanged.
 */
export interface AggregateDeps {
  clients: Pick<ClientRepository, 'listByUser'>;
  requirements: Pick<RequirementRepository, 'listOpenByUser'>;
  facts?: Pick<FactsRepository, 'listPromisesByUser'>;
  notes?: Pick<NoteRepository, 'listByClient'>;
}

export interface AggregateItem {
  clientId: string;
  clientName: string;
  /** The line after the name: "2BR in JVC, budget around 1.5M, parking for two cars". */
  line: string;
  /** This line's own receipts (the matching ones first). */
  receipts: Receipt[];
}

export interface AggregateList {
  count: number;
  /** "3 clients have open requirements:" — or the zero sentence when count is 0. */
  headline: string;
  items: AggregateItem[];
  /** How many beyond the first 10 were not listed. */
  more: number;
}

export interface AggregateAnswer {
  /** Plain text: headline, "• Name: line" per item, "…and N more." — names every listed client. */
  answer: string;
  receipts: Receipt[];
  list: AggregateList;
}

const MAX_LINES = 10;
const COUNT = /\bhow many\b|\bnumber of\b|\bcount\b|كم|عدد/i;
const LIST = /\b(?:which|who|whom|list|show me|name)\b|^\s*what clients\b|مين|اذكر|اعرض|أي العملاء|اي العملاء|من هم|من عنده|من لديه|من يريد|من يبحث/i;
const CLIENT_WORD = /\bclients?\b|\bcustomers?\b|\bbuyers?\b|\bleads?\b|عملاء|عميل/i;
const REQ = /\brequirements?\b|\bneeds?\b|\bneeded\b|\blooking\b|\bwants?\b|\bwanted\b|\bsearching\b|\binterested\b|\bbudgets?\b|متطلب|طلبات|يبحث|يريد|يبي|يبغى|ميزانية/i;
/** Subjects that are never a requirements list (promises and silence have their own paths below). */
const OTHER_SUBJECT = /\bpromis\w*|\breplied\b|\breply\b|\bresponded\b|\bheard\b|\bcontacted\b|\bin touch\b|\bsilent\b|\bquiet\b|\bmeeting|\bvisit|وعد|رد/i;
// [P35-4] Promise questions with a time scope, and "who hasn't replied".
const PROMISE = /\bpromis\w*|\bcommitments?\b|وعد|وعود|التزام/i;
const OVERDUE = /\boverdue\b|\blate\b|\bpast due\b|متأخر|متاخر/i;
const THIS_WEEK = /\bthis week\b|هذا الأسبوع|هذا الاسبوع/i;
const NO_REPLY = /\bhaven'?t (?:replied|responded|answered|got(?:ten)? back|been in touch)|\bhasn'?t (?:replied|responded)|\bnot replied\b|\bno reply\b|\bhaven'?t heard\b|\bgone quiet\b|\bwent quiet\b|ما ردوا|ما رد|لم يرد|لم يردوا/i;
const NUMBER_WORD: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
const DAY_MS = 86_400_000;
const STALE_DAYS = 90;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "2026-09-01…" → "1 Sep 2026", read positionally (no timezone drift). */
function bodyDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : iso;
}
const dayOf = (iso: string | null | undefined): string | null => (iso ? /^(\d{4}-\d{2}-\d{2})/.exec(iso)?.[1] ?? null : null);

const TYPES: Array<{ label: string; ask: RegExp; has: RegExp }> = [
  { label: 'a villa', ask: /\bvillas?\b|فيلا|فلل/i, has: /\bvillas?\b|فيلا|فلل/i },
  { label: 'a townhouse', ask: /\btown ?houses?\b|تاون/i, has: /\btown ?houses?\b|تاون/i },
  { label: 'an apartment', ask: /\bapartments?\b|\bflats?\b|شقة|شقه|شقق/i, has: /\bapartments?\b|\bflats?\b|شقة|شقه|شقق/i },
  { label: 'a penthouse', ask: /\bpenthouses?\b/i, has: /\bpenthouses?\b/i },
  { label: 'a studio', ask: /\bstudios?\b|استوديو/i, has: /\bstudios?\b|استوديو/i },
  { label: 'an office', ask: /\boffices?\b|مكتب/i, has: /\boffices?\b|مكتب/i },
  { label: 'land', ask: /\bland\b|\bplots?\b|أرض|ارض/i, has: /\bland\b|\bplots?\b|أرض|ارض/i },
];
const BEDROOMS = /\b(\d)\s?(?:br|bed(?:room)?s?)\b/i;

// Scaffolding words of a count / list / requirement question — never a content filter.
const AGG_STOP = new Set(queryTerms([
  'how many number count which who whom list show name clients client customers buyers leads have has had with',
  'open requirement requirements requirement need needs needed looking wants want wanted searching interested in',
  'budget budgets over above more than greater under below less up to max maximum least aed dhs million mn',
  'villa villas townhouse apartment apartments flat flats penthouse studio office land plot bedroom bedrooms br bed beds',
  'currently right now today total all my do does any',
  'كم عدد العملاء الذين الذي لديهم لديه عندهم عنده عندي متطلبات متطلب طلبات مفتوحة مفتوحه يبحث يبحثون يريد يريدون يبي يبغى ميزانية فوق تحت اكثر اقل مليون فيلا شقة',
].join(' ')));

type Budget = { op: 'over' | 'under'; value: number; label: string };

/** "over 2M" / "under 1,500,000" / "أكثر من 2 مليون" → a budget filter. */
function budgetFilter(q: string): Budget | null {
  const m = /(over|above|more than|greater than|at least|under|below|less than|up to|max(?:imum)?|أكثر من|اكثر من|فوق|أقل من|اقل من|تحت)\s*(?:aed\s*|dhs\s*)?(\d+(?:[.,]\d+)*)\s*(m\b|mn\b|million\b|k\b|مليون|ألف|الف)?/i.exec(q);
  if (!m) return null;
  const value = amount(m[2]!, m[3]);
  if (value === null) return null;
  const op = /under|below|less|up to|max|أقل|اقل|تحت/i.test(m[1]!) ? 'under' : 'over';
  return { op, value, label: `budget ${op} ${m[2]}${m[3] ? m[3].trim().toUpperCase() === 'MILLION' ? 'M' : m[3].trim().replace(/^m$/i, 'M').replace(/^k$/i, 'K') : ''}` };
}

function amount(num: string, unit?: string): number | null {
  const n = Number(num.replace(/,/g, ''));
  if (!Number.isFinite(n)) return null;
  const u = (unit ?? '').trim().toLowerCase();
  if (u === 'm' || u === 'mn' || u === 'million' || u === 'مليون') return n * 1_000_000;
  if (u === 'k' || u === 'ألف' || u === 'الف') return n * 1_000;
  return n;
}

/** The latest stated amount in a client's requirements (a budget), or null. A bare small number ("2BR",
 *  "two cars") is never an amount: it needs a unit (M / K / million) or to be ≥ 10,000. */
function clientBudget(reqs: RequirementRecord[]): number | null {
  let best: { at: string; value: number } | null = null;
  for (const r of reqs) {
    const text = `${r.text} ${r.requirementRaw}`;
    const re = /(\d+(?:[.,]\d+)*)\s*(m\b|mn\b|million\b|k\b|مليون|ألف|الف)?(?!\s?(?:br|bed|bedroom|car|cars|parking|years?))/gi;
    for (const m of text.matchAll(re)) {
      const v = amount(m[1]!, m[2]);
      if (v === null || (!m[2] && v < 10_000)) continue;
      const at = r.statedOn ?? new Date(r.createdAt).toISOString().slice(0, 10);
      if (!best || at > best.at || (at === best.at && v > best.value)) best = { at, value: v };
    }
  }
  return best?.value ?? null;
}

const isClosed = (c: ClientRecord): boolean => c.outcome === 'won' || c.outcome === 'lost_confirmed' || c.leadStatus === 'done';
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
const day = (r: RequirementRecord) => r.statedOn ?? new Date(r.createdAt).toISOString().slice(0, 10);
const reqReceipt = (r: RequirementRecord): Receipt => ({ quote: (r.requirementRaw || r.text).trim(), date: day(r), clientId: r.clientId, noteId: r.noteId, span: r.requirementRaw || r.text, at: r.statedOn });

/** The count line for a requirements question, phrased by the filter asked for:
 *  "3 clients have open requirements:" · "1 client wants a villa:" · "2 clients have a budget over 2M:" ·
 *  "1 client mentions parking:" · several filters → "2 clients match: villa · budget over 2M:" — and the zero
 *  sentence for each ("None of your clients want a villa right now."). */
function requirementHeadline(n: number, f: { type: string | null; beds: string | null; budget: string | null; words: string[] }): string {
  const kinds = [f.type ?? f.beds, f.budget, f.words.length > 0 ? f.words.join(', ') : null].filter((x): x is string => x !== null);
  const one = n === 1;
  if (kinds.length === 0) return n === 0 ? 'None of your clients have open requirements right now.' : `${n} ${one ? 'client has' : 'clients have'} open requirements:`;
  if (kinds.length > 1) return n === 0 ? `None of your clients match ${kinds.join(' · ')} right now.` : `${n} ${one ? 'client matches' : 'clients match'}: ${kinds.join(' · ')}:`;
  if (f.type || f.beds) {
    const what = f.type ?? `a ${f.beds}`;
    return n === 0 ? `None of your clients want ${what} right now.` : `${n} ${one ? 'client wants' : 'clients want'} ${what}:`;
  }
  if (f.budget) {
    const what = `a ${f.budget}`;
    return n === 0 ? `None of your clients have ${what} right now.` : `${n} ${one ? 'client has' : 'clients have'} ${what}:`;
  }
  const what = f.words.join(', ');
  return n === 0 ? `None of your clients' open requirements mention ${what} right now.` : `${n} ${one ? 'client mentions' : 'clients mention'} ${what}:`;
}

function compose(headline: string, items: AggregateItem[], more: number): string {
  const lines = items.map((i) => `• ${i.clientName}${i.line ? `: ${i.line}` : ''}`);
  return [headline, ...lines, ...(more > 0 ? [`…and ${more} more.`] : [])].join('\n');
}

export class AggregateRecall {
  constructor(private readonly deps: AggregateDeps) {}

  /** A deterministic count / list answer, or null when the question isn't one (→ the normal Ask path). */
  async answer(userId: string, question: string, nowMs: number, opts: { clientIds?: string[] } = {}): Promise<AggregateAnswer | null> {
    const q = question.trim();
    const scopeIds = opts.clientIds && opts.clientIds.length > 0 ? new Set(opts.clientIds) : null;
    // [P35-4] "How many promises are overdue?" / "What have I promised this week?"
    if (PROMISE.test(q) && (OVERDUE.test(q) || THIS_WEEK.test(q))) return this.promiseList(userId, q, nowMs, scopeIds);
    // [P35-4] "Which clients haven't replied in 2 weeks?"
    if (NO_REPLY.test(q)) return this.silenceList(userId, q, nowMs, scopeIds);
    if (!(COUNT.test(q) || LIST.test(q)) || OTHER_SUBJECT.test(q)) return null;
    const type = TYPES.find((t) => t.ask.test(q)) ?? null;
    const beds = BEDROOMS.exec(q);
    const budget = budgetFilter(q);
    const keywords = queryTerms(q).filter((t) => !AGG_STOP.has(t) && !/^\d/.test(t));
    const aboutRequirements = REQ.test(q) || type !== null || beds !== null || budget !== null;
    const scope = opts.clientIds && opts.clientIds.length > 0 ? new Set(opts.clientIds) : null;

    const clients = (await this.deps.clients.listByUser(userId)).filter((c) => !scope || scope.has(c.id));

    // "How many clients do I have?" / "list my clients" — the total, from the database.
    if (!aboutRequirements) {
      if (!CLIENT_WORD.test(q) || keywords.length > 0) return null;
      const items = clients.map((c) => ({ clientId: c.id, clientName: c.name, line: '', receipts: [] as Receipt[] }));
      const shown = items.slice(0, MAX_LINES);
      const headline = items.length === 0 ? "You don't have any clients yet." : `You have ${items.length} ${plural(items.length, 'client', 'clients')}:`;
      const list: AggregateList = { count: items.length, headline, items: shown, more: items.length - shown.length };
      return { answer: items.length === 0 ? headline : compose(headline, shown, list.more), receipts: [], list };
    }

    // Requirements across clients, with the filters asked for.
    const open = await this.deps.requirements.listOpenByUser(userId);
    const byClient = new Map<string, RequirementRecord[]>();
    for (const r of open) byClient.set(r.clientId, [...(byClient.get(r.clientId) ?? []), r]);
    // The rep's own words for the content filters (the stems are only for matching): "parking", not "park".
    const qWords = q.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    const said = keywords.map((k) => qWords.find((w) => queryTerms(w)[0] === k) ?? k);

    const items: AggregateItem[] = [];
    for (const c of clients) {
      if (isClosed(c)) continue;
      const reqs = (byClient.get(c.id) ?? []).slice().sort((a, b) => day(a).localeCompare(day(b)));
      if (reqs.length === 0) continue;
      const text = (r: RequirementRecord) => `${r.text} ${r.requirementRaw}`;
      const matches = (r: RequirementRecord) =>
        (!type || type.has.test(text(r))) &&
        (!beds || new RegExp(`\\b${beds[1]}\\s?(?:br|bed)`, 'i').test(text(r))) &&
        (keywords.length === 0 || keywords.every((k) => termHits([k], text(r)) > 0));
      // Type / bedroom / keyword filters must hold for at least one requirement; the budget is the client's.
      const hit = reqs.filter(matches);
      if ((type || beds || keywords.length > 0) && hit.length === 0) continue;
      if (budget) {
        const b = clientBudget(reqs);
        if (b === null || (budget.op === 'over' ? !(b > budget.value) : !(b < budget.value))) continue;
      }
      const lead = hit.length > 0 && (type || beds || keywords.length > 0) ? hit : [];
      const receipts = [...lead, ...reqs.filter((r) => !lead.includes(r))].map(reqReceipt);
      items.push({ clientId: c.id, clientName: c.name, line: reqs.map((r) => r.text.trim()).filter(Boolean).join(', '), receipts });
    }

    const n = items.length;
    const headline = requirementHeadline(n, { type: type?.label ?? null, beds: beds ? `${beds[1]}BR` : null, budget: budget?.label ?? null, words: said });
    const shown = items.slice(0, MAX_LINES);
    const list: AggregateList = { count: n, headline, items: shown, more: n - shown.length };
    return { answer: n === 0 ? headline : compose(headline, shown, list.more), receipts: shown.flatMap((i) => i.receipts.slice(0, 1)), list };
  }

  /** [P35-4] Overdue promises (both sides), or this week's (yours when you ask about "I"/"my") — open, not stale. */
  private async promiseList(userId: string, q: string, nowMs: number, scope: Set<string> | null): Promise<AggregateAnswer | null> {
    if (!this.deps.facts) return null;
    const [clients, promises] = await Promise.all([this.deps.clients.listByUser(userId), this.deps.facts.listPromisesByUser(userId)]);
    const nameOf = new Map(clients.map((c) => [c.id, c.name]));
    const today = new Date(nowMs).toISOString().slice(0, 10);
    const weekday = (new Date(nowMs).getUTCDay() + 6) % 7; // Monday = 0
    const weekStart = new Date(nowMs - weekday * DAY_MS).toISOString().slice(0, 10);
    const weekEnd = new Date(nowMs + (6 - weekday) * DAY_MS).toISOString().slice(0, 10);
    const inWeek = (d: string | null) => d !== null && d >= weekStart && d <= weekEnd;
    const overdue = OVERDUE.test(q);
    const mine = asksAboutMyPromises(q);
    const picked = promises
      .filter((p) => (!scope || scope.has(p.clientId)) && isActivePromise(p, nowMs, STALE_DAYS))
      .filter((p) => (overdue
        ? p.dueDate !== null && p.dueDate < today
        : (!mine || p.owner !== 'client') && (inWeek(dayOf(p.sourceMessageAt) ?? p.captureAt ?? dayOf(new Date(p.createdAt).toISOString())) || inWeek(p.dueDate))))
      .sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'));
    const items: AggregateItem[] = picked.map((p) => ({
      clientId: p.clientId,
      clientName: nameOf.get(p.clientId) ?? 'A client',
      line: `${p.owner === 'client' ? 'promised' : 'you promised'} to ${p.text}${p.dueDate ? ` · due ${bodyDate(p.dueDate)}` : ''}`,
      receipts: [{ quote: (p.sourceSpan ?? p.text).trim(), date: dayOf(p.sourceMessageAt) ?? p.captureAt ?? new Date(p.createdAt).toISOString().slice(0, 10), clientId: p.clientId, noteId: p.noteId, span: p.sourceSpan, at: p.sourceMessageAt }],
    }));
    const n = items.length;
    const headline = overdue
      ? (n === 0 ? 'No promises are overdue right now.' : `${n} ${plural(n, 'promise is', 'promises are')} overdue:`)
      : mine
        ? (n === 0 ? "You haven't promised anything this week." : `You promised ${n} ${plural(n, 'thing', 'things')} this week:`)
        : (n === 0 ? 'No promises this week.' : `${n} ${plural(n, 'promise', 'promises')} this week:`);
    const shown = items.slice(0, MAX_LINES);
    const list: AggregateList = { count: n, headline, items: shown, more: n - shown.length };
    return { answer: n === 0 ? headline : compose(headline, shown, list.more), receipts: shown.flatMap((i) => i.receipts), list };
  }

  /** [P35-4] Clients (not closed) whose last message to you is older than the window — default 2 weeks. */
  private async silenceList(userId: string, q: string, nowMs: number, scope: Set<string> | null): Promise<AggregateAnswer | null> {
    if (!this.deps.notes) return null;
    const m = /\b(\d+|a|an|one|two|three|four|five|six)\s*(day|week|month)s?\b/i.exec(q);
    const num = m ? (/^\d+$/.test(m[1]!) ? Number(m[1]) : NUMBER_WORD[m[1]!.toLowerCase()] ?? 1) : 2;
    const unit = m ? m[2]!.toLowerCase() : 'week';
    const days = num * (unit === 'day' ? 1 : unit === 'week' ? 7 : 30);
    const window = `${num} ${unit}${num === 1 ? '' : 's'}`;
    const cutoff = nowMs - days * DAY_MS;
    const clients = (await this.deps.clients.listByUser(userId)).filter((c) => !isClosed(c) && (!scope || scope.has(c.id)));
    const rows: Array<{ item: AggregateItem; at: number }> = [];
    for (const c of clients) {
      let last: { at: string; body: string; noteId: string } | null = null;
      for (const n of await this.deps.notes.listByClient(userId, c.id)) {
        for (const msg of n.messages ?? []) {
          if (msg.role !== 'client' || msg.excluded || !msg.sentAt) continue;
          if (!last || msg.sentAt > last.at) last = { at: msg.sentAt, body: msg.body, noteId: n.id };
        }
      }
      const atMs = last ? Date.parse(`${last.at.slice(0, 16)}:00Z`) : c.lastTouchedAt;
      if (!(atMs < cutoff)) continue;
      const when = last ? bodyDate(last.at) : bodyDate(new Date(c.lastTouchedAt).toISOString());
      rows.push({
        at: atMs,
        item: {
          clientId: c.id,
          clientName: c.name,
          line: last ? `last replied ${when}` : `no reply on record — last contact ${when}`,
          receipts: last ? [{ quote: last.body.trim(), date: last.at.slice(0, 10), clientId: c.id, noteId: last.noteId, span: last.body, at: last.at }] : [],
        },
      });
    }
    rows.sort((a, b) => a.at - b.at); // longest silence first
    const items = rows.map((r) => r.item);
    const n = items.length;
    const headline = n === 0 ? `Every client has replied in the last ${window}.` : `${n} ${plural(n, "client hasn't", "clients haven't")} replied in ${window}:`;
    const shown = items.slice(0, MAX_LINES);
    const list: AggregateList = { count: n, headline, items: shown, more: n - shown.length };
    return { answer: n === 0 ? headline : compose(headline, shown, list.more), receipts: shown.flatMap((i) => i.receipts), list };
  }
}
