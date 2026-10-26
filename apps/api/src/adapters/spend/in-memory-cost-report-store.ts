import type {
  CapSpendRow, ClaudeCostRow, CostReportStore, CostView, LegacyInvoiceRow, RevenueEvent, RevenueRow, SubscriptionRow, TranscriptionEvent, VoiceRow,
} from '../../ports/cost-report.js';

/** A Claude call as the report reads it (the model_call_events columns it needs). */
export interface ClaudeCallSeed { userId: string; periodKey: string | null; spendClass: string; costAed: number; at: number }

const month = (ms: number): string => new Date(ms).toISOString().slice(0, 7);

/** [P44-2] In-memory cost-report store for tests and local runs. Seed the read-only sources with `seed`. */
export class InMemoryCostReportStore implements CostReportStore {
  readonly transcriptions: TranscriptionEvent[] = [];
  readonly revenues: RevenueEvent[] = [];
  private calls: ClaudeCallSeed[] = [];
  private legacy: Array<LegacyInvoiceRow & { invoiceId: string }> = [];
  private caps: CapSpendRow[] = [];
  private subs: SubscriptionRow[] = [];

  seed(s: { calls?: ClaudeCallSeed[]; legacyInvoices?: Array<LegacyInvoiceRow & { invoiceId: string }>; capSpend?: CapSpendRow[]; subscriptions?: SubscriptionRow[] }): this {
    if (s.calls) this.calls.push(...s.calls);
    if (s.legacyInvoices) this.legacy.push(...s.legacyInvoices);
    if (s.capSpend) this.caps.push(...s.capSpend);
    if (s.subscriptions) this.subs.push(...s.subscriptions);
    return this;
  }

  async recordTranscription(e: TranscriptionEvent): Promise<void> { this.transcriptions.push({ ...e }); }
  async recordRevenue(e: RevenueEvent): Promise<void> {
    if (this.revenues.some((r) => r.stripeId === e.stripeId)) return; // one row per Stripe object
    this.revenues.push({ ...e });
  }

  async claude(view: CostView): Promise<ClaudeCostRow[]> {
    const out = new Map<string, ClaudeCostRow>();
    for (const c of this.calls) {
      const key = view === 'period' ? c.periodKey : month(c.at);
      if (!key) continue;
      const k = `${c.userId}|${key}|${c.spendClass}`;
      const row = out.get(k) ?? { userId: c.userId, key, spendClass: c.spendClass, aed: 0, calls: 0 };
      row.aed += c.costAed; row.calls += 1;
      out.set(k, row);
    }
    return [...out.values()];
  }

  async voice(view: CostView): Promise<VoiceRow[]> {
    return this.transcriptions.flatMap((t) => {
      const key = view === 'period' ? t.periodKey : month(t.at);
      return key ? [{ userId: t.userId, key, model: t.model, audioSeconds: t.audioSeconds, estimated: t.estimated }] : [];
    });
  }

  async revenue(view: CostView): Promise<RevenueRow[]> {
    return this.revenues.flatMap((r) => {
      const key = view === 'period' ? r.periodKey : month(r.paidAt);
      return r.userId && key ? [{ userId: r.userId, key, kind: r.kind, fils: r.amountFils }] : [];
    });
  }

  async legacyInvoices(): Promise<LegacyInvoiceRow[]> {
    const recorded = new Set(this.revenues.map((r) => r.stripeId));
    return this.legacy.filter((l) => !recorded.has(l.invoiceId)).map(({ userId, issuedAt, fils }) => ({ userId, issuedAt, fils }));
  }

  async capSpend(): Promise<CapSpendRow[]> { return this.caps.map((c) => ({ ...c })); }
  async subscriptions(): Promise<SubscriptionRow[]> { return this.subs.map((u) => ({ ...u })); }
  async voiceRecordedSince(): Promise<number | null> {
    return this.transcriptions.length ? Math.min(...this.transcriptions.map((t) => t.at)) : null;
  }
}
