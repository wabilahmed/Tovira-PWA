import { describe, it, expect } from 'vitest';
import { AskCaptureService } from './ask-capture-service.js';
import { InMemoryClientRepository } from '../../adapters/clients/in-memory-client-repository.js';
import { InMemoryNoteRepository } from '../../adapters/notes/in-memory-note-repository.js';
import { InMemoryFactsRepository } from '../../adapters/facts/in-memory-facts-repository.js';
import { InMemoryRequirementRepository } from '../../adapters/requirements/in-memory-requirement-repository.js';
import { StubEmbedder } from '../../adapters/embedding/stub.js';

/**
 * [P85-3 · owner, 22 Nov] Capture from Find reads the client's CURRENT requirements (P84-7): a need a later count
 * replaced is left out before the budget card reads the stored budget. Here "At least 3 bedrooms" (Mar) is replaced
 * by "4 bedrooms not 3" (Jun), so the client has ONE property need, and the later budget-only "Budget AED 2M" (Aug)
 * is read as its budget: "Did Sara Khan's budget change from AED 2M to AED 2.2M?". Read with the replaced need, the
 * client would have two property needs and no budget would be shown.
 */
const row = (text: string, statedOn: string) => ({ text, requirementRaw: text, statedOn, confidence: 'high' as const, embedding: null });
async function pending(reqs: Array<[string, string]>) {
  const clients = new InMemoryClientRepository();
  const notes = new InMemoryNoteRepository();
  const requirements = new InMemoryRequirementRepository();
  const capture = new AskCaptureService({ notes, clients, facts: new InMemoryFactsRepository(), embedder: new StubEmbedder(8), extraction: { extractNote: async () => undefined } as never, requirements, now: () => 1_000_000, ttlMs: 14 * 86_400_000 });
  const sara = await clients.create('u', 'Sara Khan');
  let i = 0;
  for (const [text, on] of reqs) await requirements.saveForNote('u', `n${++i}`, sara.id, [row(text, on)]);
  await capture.capture('u', sara.id, "Sara's budget is now 2.2M", '2026-10-21');
  return (await capture.listPending('u'))[0]!;
}

describe('[P85-3] capture from Find reads only current requirements', () => {
  it('a replaced count is left out: the one property need takes the later budget (previousValue 2M)', async () => {
    const q = await pending([['At least 3 bedrooms', '2026-03-01'], ['4 bedrooms not 3', '2026-06-01'], ['Budget AED 2M', '2026-08-01']]);
    expect(q).toMatchObject({ field: 'budget', value: '2.2M', previousValue: '2M' });
  });
  it('NEGATIVE: a need that says more than a count is not replaced, so two property needs keep the budget unattached', async () => {
    const q = await pending([['3 bedroom villa in Mirdif', '2026-03-01'], ['4 bedrooms not 3', '2026-06-01'], ['Budget AED 2M', '2026-08-01']]);
    expect(q).not.toHaveProperty('previousValue');
  });
});
