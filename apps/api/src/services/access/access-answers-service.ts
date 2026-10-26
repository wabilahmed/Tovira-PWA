import type { AccessRequestRepository, AccessRequestRecord } from '../../ports/access-request-repository.js';
import { AccessRequestValidationError, validateAnswers, type RawAccessRequest } from './access-request-service.js';
import { CONFIRMATION_TEXT_VERSION } from '../legal/versions.js';
import { canonicalPhone } from '../clients/phone.js';

/**
 * [P46-6c.2] A request made from a hot lead was approved with the form's questions unanswered and without the
 * confirmation. On first sign-in that rep answers the blank questions and ticks the confirmation (the same wording and
 * version as the public form) before using the app; the server refuses captures until then. A form sign-up, who already
 * answered, and an account with no request are never asked.
 */
export type MissingAnswer = 'phone' | 'ownership' | 'conversationOwnership' | 'expectedVolume' | 'industry' | 'confirmation';

export class AccessAnswersService {
  constructor(private readonly repo: Pick<AccessRequestRepository, 'findByLinkedUser' | 'completeAnswers'>, private readonly now: () => number = () => Date.now()) {}

  private static missing(r: AccessRequestRecord): MissingAnswer[] {
    const m: MissingAnswer[] = [];
    if (!r.phone) m.push('phone');
    if (!r.ownership) m.push('ownership');
    if (!r.conversationOwnership) m.push('conversationOwnership');
    if (!r.expectedVolume) m.push('expectedVolume');
    if (!r.industry) m.push('industry');
    if (!r.confirmationAcceptedAt) m.push('confirmation');
    return m;
  }

  async status(userId: string): Promise<{ required: boolean; missing: MissingAnswer[] }> {
    const r = await this.repo.findByLinkedUser(userId);
    if (!r || r.source !== 'hot_lead' || r.confirmationAcceptedAt) return { required: false, missing: [] };
    return { required: true, missing: AccessAnswersService.missing(r) };
  }

  /** True while captures must be refused (a hot-lead invitee who has not ticked the confirmation). */
  async required(userId: string): Promise<boolean> {
    return (await this.status(userId)).required;
  }

  async submit(userId: string, raw: RawAccessRequest): Promise<void> {
    const r = await this.repo.findByLinkedUser(userId);
    if (!r || r.source !== 'hot_lead' || r.confirmationAcceptedAt) return; // nothing to collect
    if (typeof raw.phone !== 'string' || !raw.phone.trim()) throw new AccessRequestValidationError('phone', 'A phone number is required.');
    const phone = canonicalPhone(raw.phone);
    if (!phone.ok) throw new AccessRequestValidationError('phone', phone.message);
    const a = validateAnswers(raw); // the same questions and the mandatory confirmation as the public form
    await this.repo.completeAnswers(r.id, {
      phone: raw.phone.trim(), ...a, confirmationAcceptedAt: this.now(), confirmationTextVersion: CONFIRMATION_TEXT_VERSION,
    });
  }
}
