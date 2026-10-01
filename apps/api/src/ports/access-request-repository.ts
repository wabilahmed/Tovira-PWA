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

/** The validated, submitted fields (no provenance/review fields — those are set by the store/reviewer). */
export interface AccessRequestInput {
  fullName: string;
  workEmail: string;
  phone: string;
  companyName: string;
  roleTitle: string;
  ownership: Ownership;
  /** Only meaningful for owns_or_manages; always null for employed (DB CHECK enforces it too). */
  tradeLicenceNumber: string | null;
  conversationOwnership: ConversationOwnership;
  /** Free text, only when conversationOwnership === 'other'; null otherwise. */
  conversationOwnershipOther: string | null;
  expectedVolume: ExpectedVolume;
  /** The mandatory truth/authority confirmation (NOT terms acceptance). */
  confirmationAcceptedAt: number;
  confirmationTextVersion: string;
  /** Provenance of the submission (best-effort). */
  sourceIp: string | null;
  userAgent: string | null;
  /** [BETA-3b] Referral code captured from the landing URL, applied at approval (BETA-5), or null. */
  referralCode: string | null;
}

export interface AccessRequestRecord extends AccessRequestInput {
  id: string;
  createdAt: number;
  status: AccessRequestStatus;
  reviewedAt: number | null;
  reviewedNote: string | null;
  linkedUserId: string | null;
}

export interface AccessRequestRepository {
  /** Persist a new request (status defaults to 'pending'). */
  create(input: AccessRequestInput): Promise<AccessRequestRecord>;
}
