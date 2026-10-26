import type { Pool } from 'pg';
import type {
  CapSpendRow, ClaudeCostRow, CostReportStore, CostView, LegacyInvoiceRow, RevenueEvent, RevenueRow, SubscriptionRow, TranscriptionEvent, VoiceRow,
} from '../../ports/cost-report.js';

/** The grouping key for a view: the stored billing-period key, or the calendar month (UTC) of a timestamp column. */
const keyExpr = (view: CostView, periodCol: string, timeCol: string): string =>
  view === 'period' ? periodCol : `to_char(${timeCol} AT TIME ZONE 'UTC', 'YYYY-MM')`;

/**
 * [P44-2] Postgres cost-report store. Root pool (no RLS): cross-tenant cost accounting for OPS, read behind the ops
 * token. Writes are append-only; revenue is keyed by its Stripe id (ON CONFLICT DO NOTHING, so a replay is a no-op).
 * Reads aggregate in SQL; nothing here calls a model.
 */
export class PgCostReportStore implements CostReportStore {
  constructor(private readonly pool: Pool) {}

  async recordTranscription(e: TranscriptionEvent): Promise<void> {
    await this.pool.query(
      `INSERT INTO transcription_events (user_id, period_key, model, audio_seconds, estimated, created_at)
       VALUES ($1, $2, $3, $4, $5, to_timestamp($6 / 1000.0))`,
      [e.userId, e.periodKey, e.model, e.audioSeconds, e.estimated, e.at],
    );
  }

  async recordRevenue(e: RevenueEvent): Promise<void> {
    await this.pool.query(
      `INSERT INTO revenue_events (stripe_id, user_id, kind, amount_fils, currency, paid_at, period_key)
       VALUES ($1, $2, $3, $4, $5, to_timestamp($6 / 1000.0), $7) ON CONFLICT (stripe_id) DO NOTHING`,
      [e.stripeId, e.userId, e.kind, e.amountFils, e.currency, e.paidAt, e.periodKey],
    );
  }

  async claude(view: CostView): Promise<ClaudeCostRow[]> {
    const key = keyExpr(view, 'period_key', 'created_at');
    const { rows } = await this.pool.query<{ user_id: string; key: string; spend_class: string; aed: string | number; calls: number }>(
      `SELECT user_id, ${key} AS key, spend_class, sum(cost_aed) AS aed, count(*)::int AS calls
         FROM model_call_events
        WHERE user_id IS NOT NULL AND ${key} IS NOT NULL
        GROUP BY user_id, ${key}, spend_class`,
    );
    return rows.map((r) => ({ userId: r.user_id, key: r.key, spendClass: r.spend_class, aed: Number(r.aed), calls: r.calls }));
  }

  async voice(view: CostView): Promise<VoiceRow[]> {
    const key = keyExpr(view, 'period_key', 'created_at');
    const { rows } = await this.pool.query<{ user_id: string; key: string; model: string; audio_seconds: number; estimated: boolean }>(
      `SELECT user_id, ${key} AS key, model, audio_seconds, estimated FROM transcription_events WHERE ${key} IS NOT NULL`,
    );
    return rows.map((r) => ({ userId: r.user_id, key: r.key, model: r.model, audioSeconds: Number(r.audio_seconds), estimated: r.estimated }));
  }

  async revenue(view: CostView): Promise<RevenueRow[]> {
    const key = keyExpr(view, 'period_key', 'paid_at');
    const { rows } = await this.pool.query<{ user_id: string; key: string; kind: 'subscription' | 'topup'; fils: string | number }>(
      `SELECT user_id, ${key} AS key, kind, sum(amount_fils) AS fils
         FROM revenue_events
        WHERE user_id IS NOT NULL AND ${key} IS NOT NULL
        GROUP BY user_id, ${key}, kind`,
    );
    return rows.map((r) => ({ userId: r.user_id, key: r.key, kind: r.kind, fils: Number(r.fils) }));
  }

  async legacyInvoices(): Promise<LegacyInvoiceRow[]> {
    const { rows } = await this.pool.query<{ user_id: string; issued_at: Date; total_fils: string | number }>(
      `SELECT it.user_id::text AS user_id, it.issued_at, it.total_fils
         FROM invoice_tax it
        WHERE it.user_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM revenue_events re WHERE re.stripe_id = it.invoice_id)`,
    );
    return rows.map((r) => ({ userId: r.user_id, issuedAt: r.issued_at.getTime(), fils: Number(r.total_fils) }));
  }

  async capSpend(): Promise<CapSpendRow[]> {
    const { rows } = await this.pool.query<{ user_id: string; period_key: string; aed: string | number }>(
      'SELECT user_id, period_key, sum(aed) AS aed FROM spend_ledger GROUP BY user_id, period_key',
    );
    return rows.map((r) => ({ userId: r.user_id, periodKey: r.period_key, aed: Number(r.aed) }));
  }

  async subscriptions(): Promise<SubscriptionRow[]> {
    const { rows } = await this.pool.query<{ user_id: string; status: string | null; current_period_start: Date | null; current_period_end: Date | null }>(
      'SELECT user_id::text AS user_id, status, current_period_start, current_period_end FROM subscriptions',
    );
    return rows.map((r) => ({ userId: r.user_id, status: r.status, periodStart: r.current_period_start?.getTime() ?? null, periodEnd: r.current_period_end?.getTime() ?? null }));
  }

  async voiceRecordedSince(): Promise<number | null> {
    const { rows } = await this.pool.query<{ first: Date | null }>('SELECT min(created_at) AS first FROM transcription_events');
    return rows[0]?.first ? rows[0].first.getTime() : null;
  }
}
