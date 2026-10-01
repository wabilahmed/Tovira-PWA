import type {
  AccessRequestRecord,
  AccessRequestRepository,
  ConversationOwnership,
  ExpectedVolume,
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
  confirmationAccepted?: unknown;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const OWNERSHIP: ReadonlySet<string> = new Set<Ownership>(['owns_or_manages', 'employed']);
const CONVO: ReadonlySet<string> = new Set<ConversationOwnership>(['own_clients', 'brokerage_i_manage', 'brokerage_employs_me', 'mix', 'other']);
const VOLUME: ReadonlySet<string> = new Set<ExpectedVolume>(['under_50', '50_200', '200_500', '500_plus']);

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

    // The confirmation checkbox is mandatory. Its exact wording lives in the form; we store the VERSION
    // (not the sentence) so we can prove later which wording was shown. This is NOT terms acceptance.
    if (raw.confirmationAccepted !== true) throw new AccessRequestValidationError('confirmation', 'Please confirm the information is accurate and that you have authority to share these conversations.');

    return this.repo.create({
      fullName,
      workEmail,
      phone,
      companyName,
      roleTitle,
      ownership: ownership as Ownership,
      tradeLicenceNumber,
      conversationOwnership: conversationOwnership as ConversationOwnership,
      conversationOwnershipOther,
      expectedVolume: expectedVolume as ExpectedVolume,
      confirmationAcceptedAt: this.now(),
      confirmationTextVersion: CONFIRMATION_TEXT_VERSION,
      sourceIp: meta.sourceIp,
      userAgent: meta.userAgent,
    });
  }
}
