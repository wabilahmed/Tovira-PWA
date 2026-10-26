import type { ExpleeSyncState, HotLead, HotLeadInput, HotLeadsStore, LeadStatus } from '../../ports/hot-leads.js';

/** [P45-3] In-memory hot leads for tests and local runs (same rules as the pg store). */
export class InMemoryHotLeadsStore implements HotLeadsStore {
  private leads: HotLead[] = [];
  private seq = 0;
  private state: ExpleeSyncState = { cursor: null, lastRunAt: null, lastStatus: null, banner: null };

  /** [P46-6c.4] Leads erased at Explee: person_id + campaign_id only, so a later poll never imports them again. */
  readonly tombstones: Array<{ personId: string; campaignId: number }> = [];

  async saveBatch(batch: HotLeadInput[], at: number): Promise<HotLead[]> {
    const fresh: HotLead[] = [];
    for (const input of batch) {
      const key = (t: { personId: string; campaignId: number }) => t.personId === input.personId && t.campaignId === input.campaignId;
      if (this.tombstones.some(key)) continue; // wiped once: never imported again
      if (input.erased) {
        // nothing of the person is kept: the row goes, only the tombstone stays
        this.leads = this.leads.filter((l) => !key(l));
        this.tombstones.push({ personId: input.personId, campaignId: input.campaignId });
        continue;
      }
      const existing = this.leads.find(key);
      if (existing) { Object.assign(existing, input, { updatedAt: at }); continue; }
      const l: HotLead = { ...input, id: String(++this.seq), status: 'new', notes: null, accessRequestId: null, firstSeenAt: at, updatedAt: at };
      this.leads.push(l);
      fresh.push({ ...l });
    }
    return fresh;
  }
  async getState(): Promise<ExpleeSyncState> { return { ...this.state }; }
  async setState(patch: Partial<ExpleeSyncState>): Promise<void> { this.state = { ...this.state, ...patch }; }
  async list(f: { status?: LeadStatus; country?: string }): Promise<HotLead[]> {
    return this.leads
      .filter((l) => (!f.status || l.status === f.status) && (!f.country || l.country === f.country))
      .sort((a, b) => (b.becameHotAt ?? 0) - (a.becameHotAt ?? 0) || Number(b.id) - Number(a.id))
      .map((l) => ({ ...l }));
  }
  async get(id: string): Promise<HotLead | null> { const l = this.leads.find((x) => x.id === id); return l ? { ...l } : null; }
  async update(id: string, patch: { status?: LeadStatus; notes?: string | null; accessRequestId?: string | null }, at: number): Promise<HotLead | null> {
    const l = this.leads.find((x) => x.id === id);
    if (!l) return null;
    Object.assign(l, Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)), { updatedAt: at });
    return { ...l };
  }
  async markSignedUpByEmail(email: string, at: number): Promise<number> {
    let n = 0;
    for (const l of this.leads) if (l.email && l.email.toLowerCase() === email.trim().toLowerCase() && l.status !== 'signed_up') { l.status = 'signed_up'; l.updatedAt = at; n++; }
    return n;
  }
}
