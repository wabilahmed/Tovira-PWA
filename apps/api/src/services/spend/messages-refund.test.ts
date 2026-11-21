import { describe, it, expect } from 'vitest';
import { AllowanceStatusService } from './allowance-status.js';
import { InMemoryAiAllowanceRepository } from '../../adapters/spend/in-memory-ai-allowance-repository.js';
import { createClaimAndExtract } from '../notes/claim-and-extract.js';
import { NoteSweepService } from '../notes/note-sweep-service.js';

/**
 * [P84-6 · owner, 22 Nov] "If reading a chat fails permanently, refund the messages counted for it." A chat's messages
 * are counted before it is read (P83); when the read ends in a permanent failure (needs_review: unreadable, or the
 * sweep gave up after its retries), the count is given back, once. Try again counts it again, once, like a first read.
 */
const WIN = { status: 'active', trialEndsAt: null, renewsAt: null, periodStart: Date.parse('2026-11-01T00:00:00Z') };
const NOW = Date.parse('2026-11-10T00:00:00Z');
const make = () => {
  const repo = new InMemoryAiAllowanceRepository();
  return { repo, svc: new AllowanceStatusService({ allowance: repo, allowanceAed: 60, messagesAllowance: 10_000, billingWindowFor: async () => WIN, now: () => NOW }) };
};

describe('[P84-6] the refund itself', () => {
  it('gives back exactly what was counted for that chat', async () => {
    const { svc } = make();
    await svc.chargeMessages('u', 'keep', 300);
    await svc.chargeMessages('u', 'bad', 1240);
    expect(await svc.refundMessages('u', 'bad')).toBe(1240);
    expect((await svc.status('u')).messagesUsed).toBe(300);
  });
  it('NEGATIVE: refunding twice gives back once', async () => {
    const { svc } = make();
    await svc.chargeMessages('u', 'bad', 1240);
    await svc.refundMessages('u', 'bad');
    expect(await svc.refundMessages('u', 'bad')).toBe(0);
    expect((await svc.status('u')).messagesUsed).toBe(0);
  });
  it('NEGATIVE: a chat that was never counted (a typed note, a set-aside chat) refunds nothing', async () => {
    const { svc } = make();
    await svc.chargeMessages('u', 'other', 500);
    expect(await svc.refundMessages('u', 'never')).toBe(0);
    expect((await svc.status('u')).messagesUsed).toBe(500);
  });
  it('NEGATIVE: another rep cannot refund my chat', async () => {
    const { svc } = make();
    await svc.chargeMessages('u', 'bad', 800);
    expect(await svc.refundMessages('someone-else', 'bad')).toBe(0);
    expect((await svc.status('u')).messagesUsed).toBe(800);
  });
  it('after a refund, Try again counts the chat again (once)', async () => {
    const { svc } = make();
    await svc.chargeMessages('u', 'bad', 1240);
    await svc.refundMessages('u', 'bad');
    expect(await svc.chargeMessages('u', 'bad', 1240)).toBe(true);
    expect(await svc.chargeMessages('u', 'bad', 1240)).toBe(true);
    expect((await svc.status('u')).messagesUsed).toBe(1240);
  });
  it('a pack used by the failed chat is given back to the pack', async () => {
    const { repo, svc } = make();
    await svc.status('u');
    await repo.creditTopUpOnce('evt', 'u', 'm:2026-11', WIN.periodStart, 60, 9, 1500);
    await svc.chargeMessages('u', 'month', 10_000);
    await svc.chargeMessages('u', 'bad', 1000);
    expect((await svc.status('u')).packMessagesLeft).toBe(500);
    await svc.refundMessages('u', 'bad');
    expect((await svc.status('u')).packMessagesLeft).toBe(1500);
  });
});

describe('[P84-6] when the read fails permanently, the messages are given back', () => {
  const run = async (outcome: string) => {
    const { svc } = make();
    const claimAndExtract = createClaimAndExtract({
      claim: async () => true,
      extract: async () => ({ status: outcome }),
      chargeMessages: (u, id) => svc.chargeMessages(u, id, 900),
      refundMessages: async (u, id) => { await svc.refundMessages(u, id); },
    });
    await claimAndExtract('u', 'chat', '2026-11-10');
    return (await svc.status('u')).messagesUsed;
  };
  it('unreadable (needs_review): nothing is used', async () => {
    expect(await run('needs_review')).toBe(0);
  });
  it('NEGATIVE: read fine: the messages stay counted', async () => {
    expect(await run('extracted')).toBe(900);
  });
  it('NEGATIVE: paused mid-chat by the money gate (it waits and resumes): the messages stay counted', async () => {
    expect(await run('spend_capped')).toBe(900);
  });
  it('NEGATIVE: a read that throws (it will be retried) keeps the count until the retries run out', async () => {
    const { svc } = make();
    const claimAndExtract = createClaimAndExtract({
      claim: async () => true,
      extract: async () => { throw new Error('model down'); },
      chargeMessages: (u, id) => svc.chargeMessages(u, id, 900),
      refundMessages: async (u, id) => { await svc.refundMessages(u, id); },
    });
    await expect(claimAndExtract('u', 'chat', '2026-11-10')).rejects.toThrow();
    expect((await svc.status('u')).messagesUsed).toBe(900);
  });
  it('the sweep gives up after its retries: the chat is marked failed and its messages are given back', async () => {
    const { svc } = make();
    await svc.chargeMessages('u', 'chat', 900);
    const marked: string[] = [];
    const sweep = new NoteSweepService({
      allUserIds: async () => ['u'],
      listPending: async () => [{ id: 'chat', status: 'pending_extraction', sweepAttempts: 5 }],
      transcribe: async () => {},
      extract: async () => {},
      setAttempts: async () => {},
      markNeedsReview: async (_u, id) => { marked.push(id); },
      refundMessages: async (u, id) => { await svc.refundMessages(u, id); },
    }, 5);
    await sweep.sweep('2026-11-10');
    expect(marked).toEqual(['chat']);
    expect((await svc.status('u')).messagesUsed).toBe(0);
  });
});
