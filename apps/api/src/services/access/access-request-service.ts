import type {
  AccessRequestRecord,
  AccessRequestRepository,
  ConversationOwnership,
  ExpectedVolume,
  Industry,
  Ownership,
} from '../../ports/access-request-repository.js';
import { CONFIRMATION_TEXT_VERSION } from '../legal/versions.js';

/** A field-level validation failure — never a silent pass (a wrong row is worse than a rejected one). */
export class AccessRequestValidationError extends Error {
  constructor(
    public readonly field: string,
    message: string,
  ) {
    super(message);
    this.name = 'AccessRequestValidationError';
  }
}

/** The raw, untrusted submission from the public form (every field validated before use). */
export interface RawAccessRequest {
  fullName?: unknown;
  workEmail?: unknown;
  phone?: unknown;
  companyName?: unknown;
  roleTitle?: unknown;
  ownership?: unknown;
  tradeLicenceNumber?: unknown;
  conversationOwnership?: unknown;
  conversationOwnershipOther?: unknown;
  expectedVolume?: unknown;
  /** [P42-A6] */
  industry?: unknown;
  industryOther?: unknown;
  confirmationAccepted?: unknown;
  /** [BETA-3b] Referral code captured from the landing URL (?ref=). Optional, opaque, persisted for
   *  application at approval. Never blocks submission. */
  referralCode?: unknown;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const OWNERSHIP: ReadonlySet<string> = new Set<Ownership>(['owns_or_manages', 'employed']);
const CONVO: ReadonlySet<string> = new Set<ConversationOwnership>(['own_clients', 'brokerage_i_manage', 'brokerage_employs_me', 'mix', 'other']);
const VOLUME: ReadonlySet<string> = new Set<ExpectedVolume>(['under_50', '50_200', '200_500', '500_plus']);
const INDUSTRY: ReadonlySet<string> = new Set<Industry>(['insurance', 'wealth_private_banking', 'b2b_key_accounts', 'luxury_client_advisory', 'recruitment', 'property', 'other']);

/** Max lengths — generous, but bound the row so a paste bomb can't be stored. Derivation: a name/company/
 *  role/phone is comfortably under 200 chars; free text and licence numbers under 2000. */
const MAX_SHORT = 200;
const MAX_TEXT = 2000;

function reqStr(v: unknown, field: string, max = MAX_SHORT): string {
  if (typeof v !== 'string' || v.trim() === '') throw new AccessRequestValidationError(field, `${field} is required.`);
  const s = v.trim();
  if (s.length > max) throw new AccessRequestValidationError(field, `${field} is too long.`);
  return s;
}

function optStr(v: unknown, field: string, max = MAX_TEXT): string | null {
  if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) return null;
  if (typeof v !== 'string') throw new AccessRequestValidationError(field, `${field} must be text.`);
  const s = v.trim();
  if (s.length > max) throw new AccessRequestValidationError(field, `${field} is too long.`);
  return s;
}

/** The form's answers about the rep's business (everything after name, email and company), validated. */
export interface AccessAnswers {
  ownership: Ownership; tradeLicenceNumber: string | null;
  conversationOwnership: ConversationOwnership; conversationOwnershipOther: string | null;
  expectedVolume: ExpectedVolume; industry: Industry; industryOther: string | null;
}

/**
 * [P46-6c.2] The form's ownership / conversations / volume / industry answers and the mandatory confirmation, shared by
 * the public form and a hot-lead invitee's first sign-in, so both ask exactly the same and store the same.
 */
export function validateAnswers(raw: RawAccessRequest): AccessAnswers {
  const ownership = raw.ownership;
  if (typeof ownership !== 'string' || !OWNERSHIP.has(ownership)) throw new AccessRequestValidationError('ownership', 'Choose whether you own/manage or are employed.');

  // Trade licence is conditional. Requiredness for owns_or_manages is OURS (app-owned, per the schema
  // decision); and an employed applicant must not carry one (mirrors the DB CHECK).
  const licenceRaw = optStr(raw.tradeLicenceNumber, 'tradeLicenceNumber', MAX_SHORT);
  let tradeLicenceNumber: string | null;
  if (ownership === 'owns_or_manages') {
    if (!licenceRaw) throw new AccessRequestValidationError('tradeLicenceNumber', 'A trade licence number is required when you own or manage the company.');
    tradeLicenceNumber = licenceRaw;
  } else {
    if (licenceRaw) throw new AccessRequestValidationError('tradeLicenceNumber', 'A trade licence number does not apply to an employed applicant.');
    tradeLicenceNumber = null;
  }

  const conversationOwnership = raw.conversationOwnership;
  if (typeof conversationOwnership !== 'string' || !CONVO.has(conversationOwnership)) throw new AccessRequestValidationError('conversationOwnership', 'Choose whose client conversations you intend to upload.');
  const otherRaw = optStr(raw.conversationOwnershipOther, 'conversationOwnershipOther', MAX_TEXT);
  let conversationOwnershipOther: string | null;
  if (conversationOwnership === 'other') {
    if (!otherRaw) throw new AccessRequestValidationError('conversationOwnershipOther', 'Please describe whose conversations you intend to upload.');
    conversationOwnershipOther = otherRaw;
  } else {
    if (otherRaw) throw new AccessRequestValidationError('conversationOwnershipOther', 'Free text only applies to the "Other" option.');
    conversationOwnershipOther = null;
  }

  const expectedVolume = raw.expectedVolume;
  if (typeof expectedVolume !== 'string' || !VOLUME.has(expectedVolume)) throw new AccessRequestValidationError('expectedVolume', 'Choose roughly how many conversations you expect to upload.');

  // [P42-A6] Industry is required on every new request; 'other' carries its own text (and only 'other' does).
  const industry = raw.industry;
  if (typeof industry !== 'string' || !INDUSTRY.has(industry)) throw new AccessRequestValidationError('industry', 'Choose the industry you sell in.');
  const industryOtherRaw = optStr(raw.industryOther, 'industryOther', MAX_SHORT);
  let industryOther: string | null;
  if (industry === 'other') {
    if (!industryOtherRaw) throw new AccessRequestValidationError('industryOther', 'Please say which industry you sell in.');
    industryOther = industryOtherRaw;
  } else {
    if (industryOtherRaw) throw new AccessRequestValidationError('industryOther', 'Free text only applies to the "Other" industry.');
    industryOther = null;
  }

  // The confirmation checkbox is mandatory. Its exact wording lives in the form; we store the VERSION
  // (not the sentence) so we can prove later which wording was shown. This is NOT terms acceptance.
  if (raw.confirmationAccepted !== true) throw new AccessRequestValidationError('confirmation', 'Please confirm the information is accurate and that you have authority to share these conversations.');

  return {
    ownership: ownership as Ownership, tradeLicenceNumber,
    conversationOwnership: conversationOwnership as ConversationOwnership, conversationOwnershipOther,
    expectedVolume: expectedVolume as ExpectedVolume, industry: industry as Industry, industryOther,
  };
}

export class AccessRequestService {
  constructor(
    private readonly repo: AccessRequestRepository,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async submit(raw: RawAccessRequest, meta: { sourceIp: string | null; userAgent: string | null }): Promise<AccessRequestRecord> {
    const fullName = reqStr(raw.fullName, 'fullName');
    const workEmail = reqStr(raw.workEmail, 'workEmail').toLowerCase();
    if (!EMAIL_RE.test(workEmail)) throw new AccessRequestValidationError('workEmail', 'A valid work email is required.');
    const phone = reqStr(raw.phone, 'phone');
    const companyName = reqStr(raw.companyName, 'companyName');
    const roleTitle = reqStr(raw.roleTitle, 'roleTitle');

    const answers = validateAnswers(raw);

    // Referral code is opaque + optional; a malformed value is simply ignored (never blocks the request,
    // mirroring how a bad code never blocks a signup today).
    const referralCode = typeof raw.referralCode === 'string' && raw.referralCode.trim() !== '' && raw.referralCode.trim().length <= MAX_SHORT ? raw.referralCode.trim() : null;

    return this.repo.create({
      fullName,
      workEmail,
      phone,
      companyName,
      roleTitle,
      ownership: answers.ownership,
      tradeLicenceNumber: answers.tradeLicenceNumber,
      conversationOwnership: answers.conversationOwnership,
      conversationOwnershipOther: answers.conversationOwnershipOther,
      expectedVolume: answers.expectedVolume,
      confirmationAcceptedAt: this.now(),
      confirmationTextVersion: CONFIRMATION_TEXT_VERSION,
      sourceIp: meta.sourceIp,
      userAgent: meta.userAgent,
      referralCode,
      industry: answers.industry,
      industryOther: answers.industryOther,
    });
  }
}
