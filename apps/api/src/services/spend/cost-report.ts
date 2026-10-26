import type { CapSpendRow, ClaudeCostRow, CostView, LegacyInvoiceRow, RevenueRow, SubscriptionRow, VoiceRow } from '../../ports/cost-report.js';
import { transcriptionCostUsd, usdToAed } from './ai-prices.js';

/**
 * [P44-2 · owner] The ops cost report, built from stored data only (no model calls). One row per user per period:
 * the rep's BILLING period by default (lines up with what each rep pays, so the margin is per rep), or the calendar
 * month (UTC), for matching the Anthropic and Groq invoices.
 *
 *  - Claude cost: the recorded per-call costs (model_call_events), with the split by type.
 *  - Voice (Groq) cost: ESTIMATED from recorded audio seconds at the Groq rate, each transcription billed at Groq's
 *    10-second minimum. Recorded from P44-2 on; a period with no voice rows that began before recording started
 *    shows null ("not recorded"), never 0.
 *  - Revenue: what Stripe says was paid (subscription invoices + top-ups). An invoice paid before revenue events
 *    were recorded (from the VAT invoice record) goes to its month, or to the rep's period that starts at or before
 *    it (within a day; Stripe invoices a period at its start), else "unattributed".
 *  - Margin = revenue − cost (AED), and as a % of revenue (null when there is no revenue).
 *  - Flags: AI cost (Claude + voice) PAST the AED 67 margin ceiling; and, in the billing-period view, spend at or
 *    past the cap the app enforces for that period (the same cap: trial cap, AED 45, or an ops override).
 * Embeddings and infrastructure are not included (the page says so).
 */
export const MARGIN_CEILING_AED = 67;
const DAY_MS = 86_400_000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export interface BuildInput {
  view: CostView;
  claude: ClaudeCostRow[];
  voice: VoiceRow[];
  revenue: RevenueRow[];
  legacy: LegacyInvoiceRow[];
  capSpend: CapSpendRow[];
  subscriptions: SubscriptionRow[];
  emails: Map<string, string>;
  capFor: (userId: string, periodKey: string) => number;
  voiceSince: number | null;
}

export interface CostReportRow {
  userId: string;
  email: string;
  plan: string;
  key: string;
  periodLabel: string;
  group: string;
  claudeAed: number;
  calls: number;
  byClass: Record<string, number>;
  voiceSeconds: number | null;
  voiceAed: number | null;
  voiceEstimated: boolean;
  totalCostAed: number;
  revenueAed: number;
  marginAed: number;
  marginPct: number | null;
  overCeiling: boolean;
  cap: { capAed: number; spentAed: number; reached: boolean } | null;
}
export interface CostReportTotals { group: string; label: string; costAed: number; revenueAed: number; marginAed: number; marginPct: number | null }
export interface CostReport { view: CostView; ceilingAed: number; voiceRecordedSince: number | null; rows: CostReportRow[]; totals: CostReportTotals[] }

const ymd = (ms: number): string => { const d = new Date(ms); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
const monthLabel = (ym: string): string => { const [y, m] = ym.split('-'); return `${MONTHS[Number(m) - 1]} ${y}`; };

/** When a key's period starts (ms), when known. */
function keyStart(key: string): number | null {
  let m: RegExpExecArray | null;
  if ((m = /^p:(\d+)$/.exec(key))) return Number(m[1]);
  if ((m = /^(?:pf:m:)?(\d{4})-(\d{2})$/.exec(key))) return Date.UTC(Number(m[1]), Number(m[2]) - 1, 1);
  return null;
}
function periodLabel(view: CostView, key: string): string {
  let m: RegExpExecArray | null;
  if (view === 'month') return /^\d{4}-\d{2}$/.test(key) ? monthLabel(key) : key;
  if ((m = /^p:(\d+)$/.exec(key))) return `from ${ymd(Number(m[1]))}`;
  if ((m = /^t:(\d+)$/.exec(key))) return `trial, ends ${ymd(Number(m[1]))}`;
  if ((m = /^pf:m:(\d{4}-\d{2})$/.exec(key))) return `${monthLabel(m[1]!)} (derived)`;
  if ((m = /^pf:end:(\d+)$/.exec(key))) return `period ending ${ymd(Number(m[1]))}`;
  if (key === 'unattributed') return 'invoice before records';
  return key;
}
function groupOf(view: CostView, key: string): { group: string; label: string } {
  if (view === 'month') return { group: key, label: /^\d{4}-\d{2}$/.test(key) ? monthLabel(key) : key };
  const start = keyStart(key) ?? (/^t:(\d+)$/.exec(key) ? Number(/^t:(\d+)$/.exec(key)![1]) : /^pf:end:(\d+)$/.exec(key) ? Number(/^pf:end:(\d+)$/.exec(key)![1]) : null);
  if (start === null) return { group: 'other', label: 'Other periods' };
  const ym = new Date(start).toISOString().slice(0, 7);
  return { group: ym, label: `Periods starting ${monthLabel(ym)}` };
}
function planOf(s: SubscriptionRow | undefined): string {
  if (!s || !s.status) return '—';
  if (s.status === 'trialing') return 'Trial';
  if (s.status === 'active') {
    if (s.periodStart === null || s.periodEnd === null) return 'Active';
    return s.periodEnd - s.periodStart > 300 * DAY_MS ? 'Yearly' : 'Monthly';
  }
  return s.status[0]!.toUpperCase() + s.status.slice(1);
}

export function buildCostReport(input: BuildInput): CostReport {
  const { view } = input;
  type Acc = { userId: string; key: string; claudeAed: number; calls: number; byClass: Record<string, number>; voiceSeconds: number; voiceUsd: number; voiceRows: number; voiceEstimated: boolean; revenueFils: number };
  const acc = new Map<string, Acc>();
  const at = (userId: string, key: string): Acc => {
    const k = `${userId}|${key}`;
    let a = acc.get(k);
    if (!a) { a = { userId, key, claudeAed: 0, calls: 0, byClass: {}, voiceSeconds: 0, voiceUsd: 0, voiceRows: 0, voiceEstimated: false, revenueFils: 0 }; acc.set(k, a); }
    return a;
  };
  for (const c of input.claude) {
    const a = at(c.userId, c.key);
    a.claudeAed += c.aed; a.calls += c.calls;
    a.byClass[c.spendClass] = (a.byClass[c.spendClass] ?? 0) + c.aed;
  }
  for (const v of input.voice) {
    const a = at(v.userId, v.key);
    a.voiceSeconds += v.audioSeconds; a.voiceRows += 1;
    a.voiceUsd += transcriptionCostUsd(v.model, v.audioSeconds); // per transcription: Groq's 10-second minimum
    a.voiceEstimated ||= v.estimated;
  }
  for (const r of input.revenue) at(r.userId, r.key).revenueFils += r.fils;

  // Invoices from before revenue events: their month, or the rep's period starting at or before them.
  const periodStarts = new Map<string, number[]>();
  const notePeriod = (userId: string, key: string): void => {
    const s = /^p:(\d+)$/.exec(key);
    if (s) periodStarts.set(userId, [...(periodStarts.get(userId) ?? []), Number(s[1])]);
  };
  for (const a of acc.values()) notePeriod(a.userId, a.key);
  for (const c of input.capSpend) notePeriod(c.userId, c.periodKey);
  for (const s of input.subscriptions) if (s.periodStart !== null) notePeriod(s.userId, `p:${s.periodStart}`);
  for (const l of input.legacy) {
    let key: string;
    if (view === 'month') key = new Date(l.issuedAt).toISOString().slice(0, 7);
    else {
      const starts = (periodStarts.get(l.userId) ?? []).filter((s) => s <= l.issuedAt + DAY_MS);
      key = starts.length ? `p:${Math.max(...starts)}` : 'unattributed';
    }
    at(l.userId, key).revenueFils += l.fils;
  }

  const subs = new Map(input.subscriptions.map((s) => [s.userId, s]));
  const capSpent = new Map(input.capSpend.map((c) => [`${c.userId}|${c.periodKey}`, c.aed]));
  const rows: CostReportRow[] = [...acc.values()].map((a) => {
    const start = keyStart(a.key);
    const recorded = a.voiceRows > 0 || (input.voiceSince !== null && start !== null && start >= input.voiceSince);
    const voiceAed = a.voiceRows > 0 ? usdToAed(a.voiceUsd) : recorded ? 0 : null;
    const totalCostAed = a.claudeAed + (voiceAed ?? 0);
    const revenueAed = a.revenueFils / 100;
    const marginAed = revenueAed - totalCostAed;
    const spentAed = capSpent.get(`${a.userId}|${a.key}`) ?? a.claudeAed;
    const capAed = view === 'period' && a.key !== 'unattributed' ? input.capFor(a.userId, a.key) : null;
    const { group } = groupOf(view, a.key);
    return {
      userId: a.userId,
      email: input.emails.get(a.userId) ?? '(deleted account)',
      plan: planOf(subs.get(a.userId)),
      key: a.key,
      periodLabel: periodLabel(view, a.key),
      group,
      claudeAed: a.claudeAed,
      calls: a.calls,
      byClass: a.byClass,
      voiceSeconds: voiceAed === null ? null : a.voiceSeconds,
      voiceAed,
      voiceEstimated: a.voiceEstimated,
      totalCostAed,
      revenueAed,
      marginAed,
      marginPct: revenueAed > 0 ? (marginAed / revenueAed) * 100 : null,
      overCeiling: totalCostAed > MARGIN_CEILING_AED,
      cap: capAed === null ? null : { capAed, spentAed, reached: spentAed >= capAed },
    };
  });
  rows.sort((x, y) => y.group.localeCompare(x.group) || y.totalCostAed - x.totalCostAed || x.email.localeCompare(y.email));

  const totals = new Map<string, CostReportTotals>();
  for (const r of rows) {
    const g = groupOf(view, r.key);
    const t = totals.get(g.group) ?? { group: g.group, label: g.label, costAed: 0, revenueAed: 0, marginAed: 0, marginPct: null };
    t.costAed += r.totalCostAed; t.revenueAed += r.revenueAed; t.marginAed += r.marginAed;
    totals.set(g.group, t);
  }
  for (const t of totals.values()) t.marginPct = t.revenueAed > 0 ? (t.marginAed / t.revenueAed) * 100 : null;
  return { view, ceilingAed: MARGIN_CEILING_AED, voiceRecordedSince: input.voiceSince, rows, totals: [...totals.values()].sort((a, b) => b.group.localeCompare(a.group)) };
}

const q = (s: string): string => `"${s.replace(/"/g, '""')}"`;
const n2 = (x: number | null): string => (x === null ? '' : x.toFixed(2));
const pct = (x: number | null): string => (x === null ? '' : x.toFixed(1));

/** [P44-2] The report as CSV: a header, one line per row, then each period group's totals line. */
export function costReportCsv(r: CostReport): string {
  const lines = ['period,email,plan,claude_aed,voice_aed,voice_seconds,total_cost_aed,calls,by_type,revenue_aed,margin_aed,margin_pct,over_67,cap_aed,at_cap'];
  for (const x of r.rows) {
    const byType = Object.entries(x.byClass).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v.toFixed(2)}`).join('; ');
    lines.push([
      q(x.periodLabel), q(x.email), q(x.plan), n2(x.claudeAed), n2(x.voiceAed), x.voiceSeconds === null ? '' : String(Math.round(x.voiceSeconds)),
      n2(x.totalCostAed), String(x.calls), q(byType), n2(x.revenueAed), n2(x.marginAed), pct(x.marginPct),
      x.overCeiling ? 'yes' : 'no', x.cap ? String(x.cap.capAed) : '', x.cap ? (x.cap.reached ? 'yes' : 'no') : '',
    ].join(','));
  }
  for (const t of r.totals) {
    lines.push([q(`TOTAL ${t.label}`), q(''), q(''), '', '', '', n2(t.costAed), '', q(''), n2(t.revenueAed), n2(t.marginAed), pct(t.marginPct), '', '', ''].join(','));
  }
  return `${lines.join('\n')}\n`;
}
