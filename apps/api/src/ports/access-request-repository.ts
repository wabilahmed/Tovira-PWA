/**
 * Port: the beta access-request store (BETA-3). A PRE-TENANT table — written by the public request form
 * before any user/tenant exists — so, like users/password_resets, it is not RLS-scoped (see migration
 * 0073 + the RLS_EXEMPT allowlist). Task 3 needs only create; the review/approve surface (BETA-5) extends
 * this port.
 */

export type AccessRequestStatus = 'pending' | 'approved' | 'rejected' | 'invited' | 'activated';
export type Ownership = 'owns_or_manages' | 'employed';
export type ConversationOwnership = 'own_clients' | 'brokerage_i_manage' | 'brokerage_employs_me' | 'mix' | 'other';
export type ExpectedVolume = 'under_50' | '50_200' | '200_500' | '500_plus';
/** [P42-A6] The segment the rep sells in (migration 0095). */
export type Industry = 'insurance' | 'wealth_private_banking' | 'b2b_key_accounts' | 'luxury_client_advisory' | 'recruitment' | 'property' | 'other';

/** The validated, submitted fields (no provenance/review fields — those are set by the store/reviewer). */
export interface AccessRequestInput {
  fullName: string;
  workEmail: string;
  /** null only for a request made from a hot lead (source 'hot_lead'): the lead never answered the form. */
  phone: string | null;
  companyName: string;
  roleTitle: string;
  ownership: Ownership | null;
  /** Only meaningful for owns_or_manages; always null for employed (DB CHECK enforces it too). */
  tradeLicenceNumber: string | null;
  conversationOwnership: ConversationOwnership | null;
  /** Free text, only when conversationOwnership === 'other'; null otherwise. */
  conversationOwnershipOther: string | null;
  expectedVolume: ExpectedVolume | null;
  /** The mandatory truth/authority confirmation (NOT terms acceptance). */
  confirmationAcceptedAt: number | null;
  confirmationTextVersion: string | null;
  /** Provenance of the submission (best-effort). */
  sourceIp: string | null;
  userAgent: string | null;
  /** [BETA-3b] Referral code captured from the landing URL, applied at approval (BETA-5), or null. */
  referralCode: string | null;
  /** [P42-A6] Required on new requests (the service validates it); null on requests made before migration 0095. */
  industry?: Industry | null;
  /** Free text, only when industry === 'other'. */
  industryOther?: string | null;
  /** [P45-3] 'form' (the public form, every answer given) or 'hot_lead' (made by the admin from a hot lead). */
  source?: 'form' | 'hot_lead';
}

export interface AccessRequestRecord extends AccessRequestInput {
  id: string;
  createdAt: number;
  status: AccessRequestStatus;
  reviewedAt: number | null;
  reviewedNote: string | null;
  linkedUserId: string | null;
  /** null = a request made before the field existed ("Not given"). */
  industry: Industry | null;
  industryOther: string | null;
  source: 'form' | 'hot_lead';
}

/** A review-outcome patch applied to a request (BETA-5). */
export interface AccessRequestReview {
  status: AccessRequestStatus;
  reviewedAt: number;
  reviewedNote?: string | null;
  linkedUserId?: string | null;
}

export interface AccessRequestRepository {
  /** Persist a new request (status defaults to 'pending'). */
  create(input: AccessRequestInput): Promise<AccessRequestRecord>;
  /** Fetch one request by id, or null. */
  get(id: string): Promise<AccessRequestRecord | null>;
  /** List requests, newest first, optionally filtered by status. */
  list(status?: AccessRequestStatus): Promise<AccessRequestRecord[]>;
  /** Apply a review outcome (status + reviewer note + optional linked user). Returns the updated row. */
  review(id: string, patch: AccessRequestReview): Promise<AccessRequestRecord | null>;
  /** [BETA-8] Delete stale requests created before `cutoffMs` — ONLY 'pending' (abandoned) and
   *  'rejected'. Approved/invited/activated are the authority record and are never deleted. Returns the
   *  number removed. */
  deleteStale(cutoffMs: number): Promise<number>;
}
