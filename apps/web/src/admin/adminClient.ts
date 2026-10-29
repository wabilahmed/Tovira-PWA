/**
 * [P45-4] Client for the admin console API (/api/admin/…). The admin session is an HttpOnly cookie scoped to
 * /api/admin; this client never sees a token and never sends the rep session. A 401 means "signed out" (the console
 * shows sign-in); a 403 means "finish two-factor first".
 */
export class AdminSignedOutError extends Error {
  constructor() { super('signed out'); this.name = 'AdminSignedOutError'; }
}

export type AdminStage = 'enrol_required' | 'mfa_required' | 'ok';
export type AccessStatus = 'pending' | 'approved' | 'rejected' | 'invited' | 'activated';
export interface AccessRequest {
  id: string; fullName: string; workEmail: string; phone: string | null; companyName: string; roleTitle: string;
  ownership: 'owns_or_manages' | 'employed' | null; tradeLicenceNumber: string | null;
  conversationOwnership: string | null; conversationOwnershipOther: string | null; expectedVolume: string | null;
  industry: string | null; industryOther: string | null; source?: 'form' | 'hot_lead';
  /** [P59] an employed invitee's employer-permission tick: when, and the wording */
  employerPermissionAcceptedAt?: number | null; employerPermissionText?: string | null;
  createdAt: number; status: AccessStatus; reviewedAt: number | null; reviewedNote: string | null; linkedUserId: string | null;
}
export type CostView = 'period' | 'month';
export interface CostRow {
  userId: string; email: string; plan: string; key: string; periodLabel: string; group: string;
  claudeAed: number; calls: number; byClass: Record<string, number>;
  voiceSeconds: number | null; voiceAed: number | null; voiceEstimated: boolean;
  totalCostAed: number; revenueAed: number; marginAed: number; marginPct: number | null;
  overCeiling: boolean; cap: { capAed: number; spentAed: number; reached: boolean } | null;
}
export interface CostTotals { group: string; label: string; costAed: number; revenueAed: number; marginAed: number; marginPct: number | null }
export interface CostReport { view: CostView; ceilingAed: number; voiceRecordedSince: number | null; rows: CostRow[]; totals: CostTotals[] }
export type LeadStatus = 'new' | 'contacted' | 'invited' | 'requested' | 'signed_up' | 'not_interested';
export interface HotLead {
  id: string; personId: string; campaignId: number; campaignName: string | null;
  name: string | null; email: string | null; jobTitle: string | null; companyName: string | null; companyDomain: string | null;
  linkedinUrl: string | null; country: string | null; phone: string | null; whyHot: string | null; becameHotAt: number | null;
  erased: boolean; status: LeadStatus; notes: string | null; accessRequestId: string | null; firstSeenAt: number; updatedAt: number;
  /** [P58] the owner's test lead; the invite email: sent, re-sent, link expiry, form submitted */
  isTest?: boolean; inviteSentAt?: number | null; inviteResentAt?: number | null; inviteExpiresAt?: number | null; requestedAt?: number | null;
}
/** [P58] What "Send invite email" would send, and why it can't (null when it can). */
export interface InvitePreview { to: string; from: string; replyTo: string; subject: string; html: string; text: string; refusal: { code: string; message: string } | null }
export interface LeadsView { leads: HotLead[]; newCount: number; countries: string[]; sync: { cursor: number | null; lastRunAt: number | null; lastStatus: string | null; banner: string | null } }
export interface AuditEntry { adminEmail: string; action: string; target: string | null; detail: Record<string, unknown> | null; at: number }

export interface AdminApi {
  me(): Promise<{ email: string; stage: AdminStage } | null>;
  login(email: string, password: string): Promise<AdminStage>;
  setPassword(token: string, password: string): Promise<void>;
  enrolStart(): Promise<{ secret: string; otpauthUrl: string }>;
  enrolConfirm(code: string): Promise<string[]>;
  verifyMfa(code: string): Promise<void>;
  logout(): Promise<void>;
  audit(): Promise<AuditEntry[]>;
  accessList(status?: AccessStatus): Promise<AccessRequest[]>;
  approve(id: string): Promise<AccessRequest>;
  reject(id: string, note: string): Promise<AccessRequest>;
  reinvite(id: string): Promise<AccessRequest>;
  costs(view: CostView): Promise<CostReport>;
  leads(filter: { status?: LeadStatus; country?: string }): Promise<LeadsView>;
  updateLead(id: string, patch: { status?: LeadStatus; notes?: string | null }): Promise<HotLead>;
  previewInvite(id: string, personalLine: string): Promise<InvitePreview>;
  sendInvite(id: string, personalLine: string, resend: boolean): Promise<HotLead>;
  addTestLead(t: { name: string; email: string; companyName?: string; jobTitle?: string }): Promise<HotLead>;
  /** Fetches a CSV with the admin cookie and saves it (costs or leads). */
  downloadCsv(path: string, filename: string): Promise<void>;
}

/** A request failed with a message for the admin (e.g. "That code is not right."). */
export class AdminRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); this.name = 'AdminRequestError'; }
}

export class HttpAdminClient implements AdminApi {
  constructor(private readonly baseUrl: string = '/api') {}

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}/admin${path}`, {
      method,
      credentials: 'include',
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (res.status === 401 && !path.startsWith('/auth/login') && !path.startsWith('/auth/set-password') && !path.startsWith('/auth/mfa') && !path.startsWith('/auth/enrol')) throw new AdminSignedOutError();
    const data = (await res.json().catch(() => ({}))) as T & { message?: string; error?: string };
    if (!res.ok) throw new AdminRequestError(data.message ?? data.error ?? `Request failed (${res.status})`, res.status);
    return data;
  }

  async me() {
    try { return await this.call<{ email: string; stage: AdminStage }>('GET', '/auth/me'); } catch (e) { if (e instanceof AdminSignedOutError) return null; throw e; }
  }
  async login(email: string, password: string) { return (await this.call<{ stage: AdminStage }>('POST', '/auth/login', { email, password })).stage; }
  async setPassword(token: string, password: string) { await this.call('POST', '/auth/set-password', { token, password }); }
  enrolStart() { return this.call<{ secret: string; otpauthUrl: string }>('POST', '/auth/enrol/start', {}); }
  async enrolConfirm(code: string) { return (await this.call<{ recoveryCodes: string[] }>('POST', '/auth/enrol/confirm', { code })).recoveryCodes; }
  async verifyMfa(code: string) { await this.call('POST', '/auth/mfa', { code }); }
  async logout() { await this.call('POST', '/auth/logout', {}); }
  async audit() { return (await this.call<{ entries: AuditEntry[] }>('GET', '/audit')).entries; }
  async accessList(status?: AccessStatus) { return (await this.call<{ requests: AccessRequest[] }>('GET', `/access-requests${status ? `?status=${status}` : ''}`)).requests; }
  async approve(id: string) { return (await this.call<{ request: AccessRequest }>('POST', `/access-requests/${encodeURIComponent(id)}/approve`, {})).request; }
  async reject(id: string, note: string) { return (await this.call<{ request: AccessRequest }>('POST', `/access-requests/${encodeURIComponent(id)}/reject`, { note })).request; }
  async reinvite(id: string) { return (await this.call<{ request: AccessRequest }>('POST', `/access-requests/${encodeURIComponent(id)}/reinvite`, {})).request; }
  costs(view: CostView) { return this.call<CostReport>('GET', `/costs?view=${view}`); }
  leads(f: { status?: LeadStatus; country?: string }) {
    const q = new URLSearchParams(Object.entries(f).filter(([, v]) => v) as Array<[string, string]>).toString();
    return this.call<LeadsView>('GET', `/leads${q ? `?${q}` : ''}`);
  }
  async updateLead(id: string, patch: { status?: LeadStatus; notes?: string | null }) { return (await this.call<{ lead: HotLead }>('PATCH', `/leads/${encodeURIComponent(id)}`, patch)).lead; }
  /** [P58] the invite email: a preview (nothing sent), Send / Resend, and the owner's test lead */
  previewInvite(id: string, personalLine: string) { return this.call<InvitePreview>('POST', `/leads/${encodeURIComponent(id)}/invite-email/preview`, { personalLine }); }
  async sendInvite(id: string, personalLine: string, resend: boolean) { return (await this.call<{ lead: HotLead }>('POST', `/leads/${encodeURIComponent(id)}/invite-email`, { personalLine, resend })).lead; }
  async addTestLead(t: { name: string; email: string; companyName?: string; jobTitle?: string }) { return (await this.call<{ lead: HotLead }>('POST', '/leads/test', t)).lead; }
  async downloadCsv(path: string, filename: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/admin${path}`, { credentials: 'include' });
    if (res.status === 401) throw new AdminSignedOutError();
    if (!res.ok) throw new AdminRequestError(`Download failed (${res.status})`, res.status);
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }
}
