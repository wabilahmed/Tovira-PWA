/**
 * [P45-3] Hot leads from the outreach platform (Explee), for the admin console. Personal data about prospects: owner
 * pool only, never a rep route, never sent to any model.
 */
export type LeadStatus = 'new' | 'contacted' | 'invited' | 'signed_up' | 'not_interested';
export const LEAD_STATUSES: readonly LeadStatus[] = ['new', 'contacted', 'invited', 'signed_up', 'not_interested'];

/** One item of GET /public/api/v1/autogtm/hot-leads (the confirmed schema). Every contact field may be null. */
export interface ExpleeHotLead {
  person_id: string;
  campaign_id: number;
  erased?: boolean;
  name?: string | null; email?: string | null; job_title?: string | null; company_name?: string | null; company_domain?: string | null;
  linkedin_url?: string | null; country?: string | null; phone?: string | null;
  why_hot?: string | null; became_hot_at?: string | null;
  note?: string | null; note_updated_at?: string | null; note_updated_by?: string | null;
}
export interface ExpleeHotLeadsPage { leads: ExpleeHotLead[]; total: number; has_more: boolean; next_offset?: number | null }
export interface ExpleeCampaign { id: number; project_id: number; name?: string | null; status: string }

/** The Explee calls the sync needs (the HTTP client lives in adapters/leads). */
export class ExpleeError extends Error {
  /** 0 = network failure / timeout (treated like a 5xx). */
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'ExpleeError';
  }
}

export interface ExpleeApi {
  hotLeads(q: { since: string | null; limit: number; offset: number }): Promise<ExpleeHotLeadsPage>;
  campaigns(): Promise<ExpleeCampaign[]>;
}


export interface HotLead {
  id: string;
  personId: string; campaignId: number; campaignName: string | null;
  name: string | null; email: string | null; jobTitle: string | null; companyName: string | null; companyDomain: string | null;
  linkedinUrl: string | null; country: string | null; phone: string | null; whyHot: string | null; becameHotAt: number | null;
  erased: boolean; status: LeadStatus; notes: string | null; accessRequestId: string | null;
  firstSeenAt: number; updatedAt: number;
}
export type HotLeadInput = Omit<HotLead, 'id' | 'status' | 'notes' | 'accessRequestId' | 'firstSeenAt' | 'updatedAt'>;

export interface ExpleeSyncState { cursor: number | null; lastRunAt: number | null; lastStatus: string | null; banner: string | null }

export interface HotLeadsStore {
  /** Insert new leads, refresh known ones (never their status/notes); an erased lead keeps nothing of the person.
   *  Returns the leads that were NEW (for the notification). One transaction. */
  saveBatch(leads: HotLeadInput[], at: number): Promise<HotLead[]>;
  getState(): Promise<ExpleeSyncState>;
  setState(patch: Partial<ExpleeSyncState>): Promise<void>;
  list(filter: { status?: LeadStatus; country?: string }): Promise<HotLead[]>;
  get(id: string): Promise<HotLead | null>;
  update(id: string, patch: { status?: LeadStatus; notes?: string | null; accessRequestId?: string | null }, at: number): Promise<HotLead | null>;
  /** Leads with this email (case-insensitive) become "Signed up". Returns how many changed. */
  markSignedUpByEmail(email: string, at: number): Promise<number>;
}
