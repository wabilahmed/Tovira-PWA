import { describe, it, expect } from 'vitest';
import { AllowanceStatusService } from './allowance-status.js';
import { InMemoryAiAllowanceRepository } from '../../adapters/spend/in-memory-ai-allowance-repository.js';
import { createClaimAndExtract } from '../notes/claim-and-extract.js';

/**
 * [P83 · owner, 21 Nov] AED 299 = 10,000 messages a month. A chat's messages (stripped of chatter) are counted once
 * when it is read; packs add messages that never expire and are used after the month's. Notes and voice notes never
 * count. The AED 60 gate stays the money limit behind the messages.
 */
const OCT = { status: 'active', trialEndsAt: null, renewsAt: null, periodStart: Date.parse('2026-10-01T00:00:00Z') };
let nowMs = Date.parse('2026-10-10T00:00:00Z');
const make = (repo = new InMemoryAiAllowanceRepository(), win = OCT) =>
  ({ repo, svc: new AllowanceStatusService({ allowance: repo, allowanceAed: 60, messagesAllowance: 10_000, billingWindowFor: async () => win, now: () => nowMs }) });

describe('[P83] the messages allowance', () => {
  it('a new month: 10,000 messages, none read', async () => {
    const s = await make().svc.status('u');
    expect([s.messagesAllowance, s.messagesUsed, s.messagesLeft, s.messagesExhausted]).toEqual([10_000, 0, 10_000, false]);
  });

  it('a chat is counted once, even if it is read twice (a retry or a second worker)', async () => {
    const { svc } = make();
    expect(await svc.chargeMessages('u', 'note-1', 1240)).toBe(true);
    expect(await svc.chargeMessages('u', 'note-1', 1240)).toBe(true);
    expect((await svc.status('u')).messagesUsed).toBe(1240);
  });

  it('NEGATIVE: a chat bigger than what is left is not counted and does not run', async () => {
    const { svc } = make();
    await svc.chargeMessages('u', 'a', 9500);
    expect(await svc.chargeMessages('u', 'b', 600)).toBe(false);
    const s = await svc.status('u');
    expect([s.messagesUsed, s.messagesLeft]).toEqual([9500, 500]);
    expect((await svc.canRead('u', 600)).ok).toBe(false);
    expect((await svc.canRead('u', 500)).ok).toBe(true);
  });

  it('at exactly 10,000 read, messages are exhausted', async () => {
    const { svc } = make();
    await svc.chargeMessages('u', 'a', 10_000);
    const s = await svc.status('u');
    expect([s.messagesLeft, s.messagesExhausted]).toEqual([0, true]);
  });

  it('a pack adds messages, used after the month, and is remembered as "+N messages added"', async () => {
    const { repo, svc } = make();
    await svc.status('u');
    await repo.creditTopUpOnce('evt1', 'u', 'm:2026-10', OCT.periodStart, 60, 9, 1500);
    await svc.chargeMessages('u', 'a', 10_500);
    const s = await svc.status('u');
    expect([s.messagesTotal, s.messagesLeft, s.packMessagesLeft, s.lastTopupMessages]).toEqual([11_500, 1000, 1000, 1500]);
  });

  it('unused pack messages carry into the next month; the month itself does not', async () => {
    const { repo, svc } = make();
    await svc.status('u');
    await repo.creditTopUpOnce('evt2', 'u', 'm:2026-10', OCT.periodStart, 60, 18, 3000);
    await svc.chargeMessages('u', 'a', 11_000); // the month's 10,000, then 1,000 of the pack
    const nov = { ...OCT, periodStart: Date.parse('2026-11-01T00:00:00Z') };
    nowMs = Date.parse('2026-11-05T00:00:00Z');
    const s = await make(repo, nov).svc.status('u');
    expect([s.messagesUsed, s.messagesTotal, s.packMessagesLeft]).toEqual([0, 12_000, 2000]);
    nowMs = Date.parse('2026-10-10T00:00:00Z');
  });

  it('a chat with nothing to read (a typed or voice note) never counts', async () => {
    const { svc } = make();
    expect(await svc.chargeMessages('u', 'typed', 0)).toBe(true);
    expect((await svc.status('u')).messagesUsed).toBe(0);
  });

  it('NEGATIVE: the AED gate still stops reading when it is spent, even with messages left', async () => {
    const { repo, svc } = make();
    await svc.status('u');
    const r = await repo.reserve('u', 'm:2026-10', 60, nowMs + 1000);
    await repo.settle('u', r.reservationId!, 60);
    expect((await svc.canRead('u', 10)).ok).toBe(false);
  });
});

describe('[P83 item 5] the background sweep counts packs, not just the month', () => {
  const run = async (packMessages: number) => {
    const { repo, svc } = make();
    await svc.status('u');
    await svc.chargeMessages('u', 'earlier', 10_000); // the month is used up
    if (packMessages) await repo.creditTopUpOnce(`evt-${packMessages}`, 'u', 'm:2026-10', OCT.periodStart, 60, 6, packMessages);
    const extracted: string[] = [];
    const claimAndExtract = createClaimAndExtract({
      claim: async () => true,
      extract: async (_u, id) => { extracted.push(id); return { status: 'extracted' }; },
      chargeMessages: (u, id) => svc.chargeMessages(u, id, 800),
    });
    const outcome = await claimAndExtract('u', 'chat', '2026-10-10');
    return { outcome, extracted, status: await svc.status('u') };
  };
  it('a fixed or custom pack left: the queued chat is read and its messages come off the pack', async () => {
    const r = await run(1000);
    expect(r.extracted).toEqual(['chat']);
    expect(r.status.packMessagesLeft).toBe(200);
  });
  it('NEGATIVE: no pack and the month used up: the chat waits, unread and unclaimed', async () => {
    const r = await run(0);
    expect(r.extracted).toEqual([]);
    expect(r.outcome.status).toBe('out_of_messages');
  });
});
