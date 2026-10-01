import type { ActivateInput, InviteActivationTx } from '../../ports/invite-activation-tx.js';
import type { InMemoryInviteRepository } from './in-memory-invite-repository.js';
import type { InMemoryUserRepository } from '../auth/in-memory-user-repository.js';
import type { InMemoryAccessRequestRepository } from './in-memory-access-request-repository.js';

/** In-memory invite acceptance. consume() is a synchronous check-and-set, so between awaits only one of
 *  several concurrent activate() calls can win it — matching the pg row-lock guarantee. */
export class InMemoryInviteActivationTx implements InviteActivationTx {
  constructor(
    private readonly invites: InMemoryInviteRepository,
    private readonly users: InMemoryUserRepository,
    private readonly requests: InMemoryAccessRequestRepository,
  ) {}

  async activate(input: ActivateInput): Promise<{ userId: string } | null> {
    const consumed = await this.invites.consume(input.tokenHash, input.now);
    if (!consumed) return null;
    await this.users.updatePassword(consumed.userId, input.passwordHash);
    this.users.recordTerms(consumed.userId, input.termsVersion, input.now, input.termsAcceptedIp);
    this.requests.setStatus(consumed.accessRequestId, 'activated');
    return { userId: consumed.userId };
  }
}
