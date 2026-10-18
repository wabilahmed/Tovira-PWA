import { describe, it, expect, beforeEach } from 'vitest';
import { RecallService } from './recall-service.js';
import { StructuredRecall } from './structured-recall.js';
import { InMemoryClientRepository } from '../../adapters/clients/in-memory-client-repository.js';
import { InMemoryFactsRepository } from '../../adapters/facts/in-memory-facts-repository.js';
import { InMemoryMeetingRepository } from '../../adapters/meetings/in-memory-meeting-repository.js';
import { InMemoryNoteRepository } from '../../adapters/notes/in-memory-note-repository.js';
import { InMemoryRequirementRepository } from '../../adapters/requirements/in-memory-requirement-repository.js';
import type { ModelClient, ModelCompletionRequest } from '../../ports/model.js';
import type { SimilarNote } from '../../ports/note-repository.js';

/** [P21-R2] Retest: "Who asked about parking?" retrieved BOTH clients but the answer named only Gate
 *  Client. When question-matched structured rows are retrieved, the answer names every matching client —
 *  the model is told to, and any client it still leaves out is added from that client's receipt. */
const U = 'u-r2';
let structured: StructuredRecall;

beforeEach(async () => {
  const clients = new InMemoryClientRepository();
  const notes = new InMemoryNoteRepository();
  const requirements = new InMemoryRequirementRepository();
  const gate = await clients.create(U, 'QA P14 Gate Client');
  const ahmed = await clients.create(U, 'أحمد الحمادي');
  const g = await notes.create(U, { clientId: gate.id, source: 'whatsapp_export', rawText: 'x', audioKey: null, status: 'extracted' });
  await requirements.saveForNote(U, g.id, gate.id, [{ text: 'parking for two cars', requirementRaw: 'need parking for two cars', statedOn: '2026-04-12', confidence: 'high', embedding: null }]);
  const a = await notes.create(U, { clientId: ahmed.id, source: 'whatsapp_export', rawText: 'x', audioKey: null, status: 'extracted' });
  await notes.update(U, a.id, { extracted: { unanswered_questions: [{ question: 'can you check if parking is included?', sentAt: '2026-03-02T10:15:00', sender: 'أحمد الحمادي' }] } });
  const facts = new InMemoryFactsRepository();
  // An unrelated open promise — a digest-only receipt for the no-match negative.
  await facts.saveExtraction(U, { noteId: g.id, clientId: gate.id, promises: [{ text: 'send three villa options', owner: 'rep', due_date: '2026-10-20', due_raw: null, confidence: 'high' }] });
  structured = new StructuredRecall({ facts, meetings: new InMemoryMeetingRepository(), clients, requirements, notes });
});

function svc(answer: string, seen: ModelCompletionRequest[] = []): RecallService {
  const model: ModelClient = { complete: async (req) => { seen.push(req); return { text: answer }; } };
  const none = { searchSimilarByUser: async (): Promise<SimilarNote[]> => [] } as never;
  return new RecallService({ dimension: 8, embed: async () => [1, 0, 0, 0, 0, 0, 0, 0] }, none, model, undefined, undefined, 'stub', undefined, undefined, undefined, undefined, undefined, undefined, structured);
}

describe('[P21-R2] every matching client is named', () => {
  it('a model answer naming only Gate Client still lists أحمد الحمادي, from his receipt', async () => {
    const out = await svc('QA P14 Gate Client asked about parking for two cars.').ask(U, 'Who asked about parking?');
    expect(out.answer).toContain('QA P14 Gate Client');
    expect(out.answer).toContain('أحمد الحمادي');
    expect(out.answer).toContain('can you check if parking is included?');
  });

  it('the model is told to name every matching client (variable message only, never the cached system prefix)', async () => {
    const seen: ModelCompletionRequest[] = [];
    await svc('QA P14 Gate Client and أحمد الحمادي asked about parking.', seen).ask(U, 'Who asked about parking?');
    const last = seen[0]!.messages.at(-1)!.content;
    expect(last).toMatch(/name every one of these clients: .*QA P14 Gate Client.*أحمد الحمادي|name every one of these clients: .*أحمد الحمادي.*QA P14 Gate Client/);
    expect(seen[0]!.system).not.toMatch(/QA P14 Gate Client|أحمد/);
  });

  it('NEGATIVE: an answer that already names both is unchanged', async () => {
    const a = 'QA P14 Gate Client needs parking for two cars, and أحمد الحمادي asked whether parking is included.';
    expect((await svc(a).ask(U, 'Who asked about parking?')).answer).toBe(a);
  });

  it('NEGATIVE: with no question-matched rows nothing is appended', async () => {
    const a = 'Nothing specific came up.';
    expect((await svc(a).ask(U, 'how is the market?')).answer).toBe(a);
  });

  it('an all-meta / no-answer reply with matched rows lists the matches instead of "I don\'t have that"', async () => {
    const out = await svc('The excerpts provided do not mention parking.').ask(U, 'Who asked about parking?');
    expect(out.answer).not.toMatch(/don't have that on record/);
    expect(out.answer).toContain('QA P14 Gate Client');
    expect(out.answer).toContain('أحمد الحمادي');
  });
});
