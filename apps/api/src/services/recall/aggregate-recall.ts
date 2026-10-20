import type { ClientRepository, ClientRecord } from '../../ports/client-repository.js';
import type { RequirementRepository, RequirementRecord } from '../../ports/requirement-repository.js';
import type { FactsRepository } from '../../ports/facts-repository.js';
import type { NoteRepository } from '../../ports/note-repository.js';
import type { Receipt } from './recall-service.js';
import { queryTerms, termHits } from './query-terms.js';

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
/** Promise / silence questions are answered elsewhere (P35-4) — never as a requirements list. */
const OTHER_SUBJECT = /\bpromis\w*|\breplied\b|\breply\b|\bresponded\b|\bheard\b|\bcontacted\b|\bin touch\b|\bsilent\b|\bquiet\b|\bmeeting|\bvisit|وعد|رد/i;

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
const reqReceipt = (r: RequirementRecord): Receipt => ({ quote: (r.requirementRaw || r.text).trim(), date: day(r), clientId: r.clientId, noteId: r.noteId });

function compose(headline: string, items: AggregateItem[], more: number): string {
  const lines = items.map((i) => `• ${i.clientName}${i.line ? `: ${i.line}` : ''}`);
  return [headline, ...lines, ...(more > 0 ? [`…and ${more} more.`] : [])].join('\n');
}

export class AggregateRecall {
  constructor(private readonly deps: AggregateDeps) {}

  /** A deterministic count / list answer, or null when the question isn't one (→ the normal Ask path). */
  async answer(userId: string, question: string, _nowMs: number, opts: { clientIds?: string[] } = {}): Promise<AggregateAnswer | null> {
    const q = question.trim();
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
    const filters: string[] = [];
    if (type) filters.push(type.label);
    if (beds) filters.push(`${beds[1]}BR`);
    if (budget) filters.push(budget.label);
    if (keywords.length > 0) filters.push(keywords.join(', '));

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
    const what = filters.length > 0 ? `open requirements matching ${filters.join(' · ')}` : 'open requirements';
    const headline = n === 0
      ? `None of your clients have ${what} right now.`
      : `${n} ${plural(n, 'client has', 'clients have')} ${what}:`;
    const shown = items.slice(0, MAX_LINES);
    const list: AggregateList = { count: n, headline, items: shown, more: n - shown.length };
    return { answer: n === 0 ? headline : compose(headline, shown, list.more), receipts: shown.flatMap((i) => i.receipts.slice(0, 1)), list };
  }
}
