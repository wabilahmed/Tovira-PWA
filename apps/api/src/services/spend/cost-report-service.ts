import type { CostReportStore, CostView } from '../../ports/cost-report.js';
import { buildCostReport, type CostReport } from './cost-report.js';

/**
 * [P44-2] Assembles the ops cost report from stored data. Read-only, no model calls. Emails are looked up per id
 * through the auth service (users-table access stays in the audited user repository); the cap per (rep, period) is
 * the one the app enforces (SpendService).
 */
export class CostReportService {
  constructor(
    private readonly store: CostReportStore,
    private readonly emailFor: (userId: string) => Promise<string | null>,
    private readonly capFor: (userId: string, periodKey: string) => Promise<number>,
  ) {}

  async report(view: CostView): Promise<CostReport> {
    const [claude, voice, revenue, legacy, capSpend, subscriptions, voiceSince] = await Promise.all([
      this.store.claude(view), this.store.voice(view), this.store.revenue(view), this.store.legacyInvoices(),
      this.store.capSpend(), this.store.subscriptions(), this.store.voiceRecordedSince(),
    ]);
    const ids = new Set<string>([...claude, ...voice, ...revenue, ...legacy].map((r) => r.userId));
    const emails = new Map<string, string>();
    for (const id of ids) { const e = await this.emailFor(id); if (e) emails.set(id, e); }
    const keys = new Set<string>([...claude, ...voice, ...revenue].map((r) => `${r.userId}|${r.key}`));
    if (view === 'period') for (const c of capSpend) keys.add(`${c.userId}|${c.periodKey}`);
    const caps = new Map<string, number>();
    if (view === 'period') for (const k of keys) { const [u, p] = k.split('|') as [string, string]; caps.set(k, await this.capFor(u, p)); }
    return buildCostReport({
      view, claude, voice, revenue, legacy, capSpend, subscriptions, emails, voiceSince,
      capFor: (u, p) => caps.get(`${u}|${p}`) ?? 0,
    });
  }
}
