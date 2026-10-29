/** [BETA-3] Client for the public beta access-request form. */

export interface AccessRequestPayload {
  fullName: string;
  workEmail: string;
  phone: string;
  companyName: string;
  roleTitle: string;
  ownership: 'owns_or_manages' | 'employed';
  tradeLicenceNumber: string | null;
  conversationOwnership: 'own_clients' | 'brokerage_i_manage' | 'brokerage_employs_me' | 'mix' | 'other';
  conversationOwnershipOther: string | null;
  expectedVolume: 'under_50' | '50_200' | '200_500' | '500_plus';
  /** [P42-A6] Required. */
  industry: 'insurance' | 'wealth_private_banking' | 'b2b_key_accounts' | 'luxury_client_advisory' | 'recruitment' | 'property' | 'other';
  /** Free text, only when industry === 'other'. */
  industryOther: string | null;
  confirmationAccepted: boolean;
  /** [BETA-3b] Referral code captured from the landing URL (?ref=), persisted for application at approval. */
  referralCode?: string | null;
  /** Honeypot — always empty for a human; the hidden field is named to look real to a bot. */
  company_url?: string;
  /** [P58-7] The founder's invite link token: the email is then the invited one, and the request is approved at once. */
  inviteToken?: string;
}

/** [P58-7] What an invite link prefills: the four fields the lead's record holds. */
export interface InvitePrefill { fullName: string; workEmail: string; companyName: string; roleTitle: string }

/** A field-level validation failure returned by the server (400). */
export class AccessRequestError extends Error {
  constructor(
    public readonly field: string | null,
    message: string,
  ) {
    super(message);
    this.name = 'AccessRequestError';
  }
}

export interface AccessRequestClient {
  submit(payload: AccessRequestPayload): Promise<{ id: string; approved?: boolean }>;
  /** [P58-7] The invite link's prefill, or null (expired, used or unknown: the normal empty form). */
  prefill?(token: string): Promise<InvitePrefill | null>;
}

export class HttpAccessRequestClient implements AccessRequestClient {
  constructor(private readonly baseUrl: string = '') {}

  async prefill(token: string): Promise<InvitePrefill | null> {
    try {
      // the token rides in the body, never a query string (it stays out of access logs)
      const res = await fetch(`${this.baseUrl}/access-request/invite`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) });
      return res.ok ? ((await res.json()) as InvitePrefill) : null;
    } catch {
      return null;
    }
  }

  async submit(payload: AccessRequestPayload): Promise<{ id: string; approved?: boolean }> {
    const res = await fetch(`${this.baseUrl}/access-request`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; id?: string; approved?: boolean; field?: string; message?: string };
    if (res.status === 429) throw new AccessRequestError(null, 'Too many requests. Please wait a little and try again.');
    if (res.status === 400) throw new AccessRequestError(json.field ?? null, json.message ?? 'Please check the form and try again.');
    if (!res.ok || !json.id) throw new AccessRequestError(null, 'Something went wrong. Please try again.');
    return { id: json.id, approved: json.approved === true };
  }
}
