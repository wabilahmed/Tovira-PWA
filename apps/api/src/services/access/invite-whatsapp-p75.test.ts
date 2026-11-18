import { describe, it, expect, vi } from 'vitest';
import { AccessApprovalService } from './access-approval-service.js';
import { InMemoryAccessRequestRepository } from '../../adapters/access/in-memory-access-request-repository.js';
import { InMemoryInviteRepository } from '../../adapters/access/in-memory-invite-repository.js';
import { InMemoryAccessApprovalTx } from '../../adapters/access/in-memory-access-approval-tx.js';
import { InMemoryUserRepository } from '../../adapters/auth/in-memory-user-repository.js';
import { ScryptHasher } from '../auth/password.js';
import { AccountEmailService } from '../email/account-email-service.js';
import { StubEmailSender } from '../../adapters/email/stub-email-sender.js';
import { InMemoryEmailLogRepository } from '../../adapters/email/in-memory-email-log-repository.js';
import type { AccessRequestInput } from '../../ports/access-request-repository.js';

/**
 * [P75 · owner] The invite email carries a "Verify your WhatsApp" button (one of the four places a rep can verify).
 * It opens the app's verify step (/app?verify=whatsapp), after the rep has set their password and signed in. It is
 * only in the email when WhatsApp is open to that rep (switched on, and on the allowlist while testing).
 */
const REQ = (over: Partial<AccessRequestInput> = {}): AccessRequestInput => ({
  fullName: 'Dana', workEmail: 'dana@x.ae', phone: '+971501234567', companyName: 'Co', roleTitle: 'Broker',
  ownership: 'owns_or_manages', tradeLicenceNumber: 'TL-1', conversationOwnership: 'own_clients',
  conversationOwnershipOther: null, expectedVolume: 'under_50', confirmationAcceptedAt: 1, confirmationTextVersion: 'v',
  sourceIp: null, userAgent: null, referralCode: null, whatsappNumber: '+971501234567', ...over,
});

function wire(offered: (email: string) => boolean) {
  const requests = new InMemoryAccessRequestRepository();
  const invites = new InMemoryInviteRepository();
  const users = new InMemoryUserRepository();
  const sender = new StubEmailSender();
  const email = new AccountEmailService(sender, new InMemoryEmailLogRepository(), 'https://tovira.io');
  const sendInvite = vi.fn((to: string, url: string, extra?: { verifyWhatsAppUrl?: string }) => email.sendInvite(to, url, extra));
  const svc = new AccessApprovalService({
    requests, tx: new InMemoryAccessApprovalTx(users, invites, requests), hasher: new ScryptHasher(),
    sendInvite, appBaseUrl: 'https://tovira.io', invites, whatsappOffered: offered,
  });
  return { requests, svc, sender, sendInvite };
}

describe('[P75] the invite email: Verify your WhatsApp', () => {
  it('approved with WhatsApp open to them: the email has a "Verify your WhatsApp" button to the verify step', async () => {
    const { requests, svc, sender } = wire(() => true);
    const r = await requests.create(REQ());
    await svc.approve(r.id, { createdBy: 'admin' });
    const [mail] = sender.to('dana@x.ae');
    expect(mail!.html).toContain('Verify your WhatsApp');
    expect(mail!.html).toContain('href="https://tovira.io/app?verify=whatsapp"');
    expect(mail!.text).toContain('Verify your WhatsApp: https://tovira.io/app?verify=whatsapp');
    expect(mail!.text).toMatch(/after you set your password/i);
    expect(mail!.html).toContain('Set up my account'); // setting up the account stays the main button
    expect(mail!.text).not.toMatch(/—/);
  });

  it('a re-invite carries it too', async () => {
    const { requests, svc, sender } = wire(() => true);
    const r = await requests.create(REQ());
    await svc.approve(r.id, { createdBy: 'admin' });
    await svc.reissueByRequestId(r.id, { createdBy: 'admin' });
    expect(sender.to('dana@x.ae')).toHaveLength(2);
    expect(sender.to('dana@x.ae')[1]!.html).toContain('Verify your WhatsApp');
  });

  it('NEGATIVE: WhatsApp not open to them (switched off, or not on the allowlist): no WhatsApp button or line', async () => {
    const { requests, svc, sender, sendInvite } = wire((e) => e === 'someone-else@x.ae');
    const r = await requests.create(REQ());
    await svc.approve(r.id, { createdBy: 'admin' });
    const [mail] = sender.to('dana@x.ae');
    expect(mail!.html).not.toMatch(/WhatsApp/);
    expect(mail!.text).not.toMatch(/WhatsApp/);
    expect(sendInvite.mock.calls[0]).toHaveLength(2); // the same call as before P75
  });
});
