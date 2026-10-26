import type { EmailSender } from '../../ports/email.js';
import { ExpleeError, type ExpleeApi, type ExpleeHotLead, type HotLead, type HotLeadInput, type HotLeadsStore } from '../../ports/hot-leads.js';

/**
 * [P45-3 · owner] The hot-leads job (every 10 minutes, one instance under the scheduler's advisory lock).
 *  - since = the cursor (the newest became_hot_at saved; at-or-after); the first run fetches the last 30 days.
 *  - pages of 200 until Explee says there are no more; dedupe on (person_id, campaign_id); the campaign name is
 *    looked up once per run.
 *  - the cursor moves only after the whole batch is saved.
 *  - 429 → stop this run · 402 → banner "Explee credit is out" · 401 → banner "Explee key rejected" ·
 *    5xx/504/network → retry once, then stop until the next run.
 *  - each NEW lead → one email to the admin(s); several in one run → one digest. No push. No model calls.
 * Logs carry counts and statuses only: never the key, never a lead's details.
 */
const FIRST_RUN_MS = 30 * 86_400_000;
const PAGE = 200;
const MAX_PAGES = 100; // 20,000 leads in one run is far past any real backlog: stop rather than loop forever

export type SyncResult = { status: 'ok'; saved: number; fresh: number } | { status: 'not_configured' | 'rate_limited' | 'no_credit' | 'key_rejected' | 'unavailable' | 'save_failed' };

export interface HotLeadSyncDeps {
  api: ExpleeApi;
  store: HotLeadsStore;
  /** EXPLEE_API_KEY is set (the key itself stays inside the client). */
  apiKeyConfigured: boolean;
  adminEmails: string[];
  appBaseUrl: string;
  email?: EmailSender;
  log?: (msg: string) => void;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const toInput = (l: ExpleeHotLead, campaignName: string | null): HotLeadInput => ({
  personId: String(l.person_id), campaignId: Number(l.campaign_id), campaignName,
  name: l.name ?? null, email: l.email ?? null, jobTitle: l.job_title ?? null, companyName: l.company_name ?? null, companyDomain: l.company_domain ?? null,
  linkedinUrl: l.linkedin_url ?? null, country: l.country ?? null, phone: l.phone ?? null, whyHot: l.why_hot ?? null,
  becameHotAt: l.became_hot_at ? Date.parse(l.became_hot_at) : null, erased: l.erased === true,
});

export class HotLeadSyncService {
  private readonly log: (m: string) => void;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  constructor(private readonly deps: HotLeadSyncDeps) {
    this.log = deps.log ?? ((m) => console.log(m));
    this.now = deps.now ?? (() => Date.now());
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  /** One call, retried once on a 5xx / 504 / network failure (after a short pause). */
  private async call<T>(fn: () => Promise<T>): Promise<T> {
    try { return await fn(); } catch (err) {
      if (err instanceof ExpleeError && (err.status === 0 || err.status >= 500)) { await this.sleep(2_000); return fn(); }
      throw err;
    }
  }

  async run(): Promise<SyncResult> {
    const at = this.now();
    if (!this.deps.apiKeyConfigured) {
      this.log('[hot-leads] Explee key not configured');
      await this.deps.store.setState({ lastRunAt: at, lastStatus: 'not_configured' });
      return { status: 'not_configured' };
    }
    const state = await this.deps.store.getState();
    const since = new Date(state.cursor ?? at - FIRST_RUN_MS).toISOString();
    let leads: ExpleeHotLead[] = [];
    let names = new Map<number, string>();
    try {
      names = new Map((await this.call(() => this.deps.api.campaigns())).map((c) => [c.id, c.name ?? `Campaign ${c.id}`]));
      let offset = 0;
      for (let pages = 0; pages < MAX_PAGES; pages++) {
        const p = await this.call(() => this.deps.api.hotLeads({ since, limit: PAGE, offset }));
        leads.push(...(p.leads ?? []));
        if (!p.has_more) break;
        offset = typeof p.next_offset === 'number' ? p.next_offset : offset + PAGE;
      }
    } catch (err) {
      const status = err instanceof ExpleeError ? err.status : 0;
      const outcome = status === 429 ? 'rate_limited' : status === 402 ? 'no_credit' : status === 401 ? 'key_rejected' : 'unavailable';
      const banner = outcome === 'no_credit' ? 'Explee credit is out' : outcome === 'key_rejected' ? 'Explee key rejected' : undefined;
      this.log(`[hot-leads] Explee ${status || 'unreachable'}: ${outcome}; stopped this run, the cursor is unchanged`);
      await this.deps.store.setState({ lastRunAt: at, lastStatus: outcome, ...(banner ? { banner } : {}) });
      return { status: outcome };
    }

    leads = leads.filter((l) => l.person_id && Number.isFinite(Number(l.campaign_id)));
    let fresh: HotLead[];
    try {
      fresh = await this.deps.store.saveBatch(leads.map((l) => toInput(l, names.get(Number(l.campaign_id)) ?? null)), at);
    } catch {
      this.log(`[hot-leads] saving ${leads.length} lead(s) failed; the cursor is unchanged`);
      await this.deps.store.setState({ lastRunAt: at, lastStatus: 'save_failed' });
      return { status: 'save_failed' };
    }
    const newest = Math.max(...leads.map((l) => (l.became_hot_at ? Date.parse(l.became_hot_at) : 0)), state.cursor ?? 0);
    await this.deps.store.setState({ cursor: newest > 0 ? newest : state.cursor, lastRunAt: at, lastStatus: 'ok', banner: null });
    this.log(`[hot-leads] ${leads.length} fetched, ${fresh.length} new`);
    if (fresh.length) await this.notify(fresh);
    return { status: 'ok', saved: leads.length, fresh: fresh.length };
  }

  private async notify(fresh: HotLead[]): Promise<void> {
    if (!this.deps.email || this.deps.adminEmails.length === 0) return;
    const link = (l: HotLead) => `${this.deps.appBaseUrl}/admin/leads?id=${encodeURIComponent(l.id)}`;
    const who = (l: HotLead) => [l.name ?? 'Someone', [l.jobTitle, l.companyName].filter(Boolean).join(' at ')].filter(Boolean).join(', ');
    const block = (l: HotLead) => [who(l), l.whyHot ? `"${l.whyHot}"` : '', link(l)].filter(Boolean).join('\n');
    const msg = fresh.length === 1
      ? { subject: `New hot lead: ${who(fresh[0]!)}`, text: `${block(fresh[0]!)}\n` }
      : { subject: `${fresh.length} new hot leads`, text: `${fresh.map(block).join('\n\n')}\n\nAll leads: ${this.deps.appBaseUrl}/admin/leads\n` };
    for (const to of this.deps.adminEmails) {
      try { await this.deps.email.send({ to, ...msg }); } catch { this.log('[hot-leads] the new-lead email failed (the leads are saved)'); }
    }
  }
}
