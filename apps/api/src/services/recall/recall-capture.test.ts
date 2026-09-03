import { describe, it, expect } from 'vitest';
import { RecallService } from './recall-service.js';
import { AskCaptureService } from './ask-capture-service.js';
import { ModelStatementDetector } from './statement-detector.js';
import { ExtractionService } from '../extraction/extraction-service.js';
import { InMemoryClientRepository } from '../../adapters/clients/in-memory-client-repository.js';
import { InMemoryNoteRepository } from '../../adapters/notes/in-memory-note-repository.js';
import { InMemoryFactsRepository } from '../../adapters/facts/in-memory-facts-repository.js';
import { InMemoryExtractionLogRepository } from '../../adapters/logs/in-memory-extraction-log-repository.js';
import { StubEmbedder } from '../../adapters/embedding/stub.js';
import type { Embedder } from '../../ports/embedder.js';
import type { ModelClient } from '../../ports/model.js';
import type { NoteRepository, SimilarNote } from '../../ports/note-repository.js';

const CERTIFIED = 'claude-sonnet-5';
const RECALL_MODEL = 'claude-haiku-4-5-20251001';
const EXTRACTION = JSON.stringify({ summary: 's', promises: [], people: [], personal_facts: [], key_dates: [], concerns: [], next_steps: [], meeting: null });
const model = (text: string): ModelClient => ({ complete: async () => ({ text }) });
const embedder: Embedder = { dimension: 8, embed: async () => [1, 0, 0, 0, 0, 0, 0, 0] };
const noSearch = { searchSimilarByUser: async (): Promise<SimilarNote[]> => [] } as unknown as NoteRepository;

/** Build a recall service whose DETECTOR returns a scripted classification and whose CAPTURE uses a
 *  real (certified) extraction engine over in-memory stores. The recall answer model is separate. */
async function harness(detectJson: string) {
  const clients = new InMemoryClientRepository();
  const notes = new InMemoryNoteRepository();
  const facts = new InMemoryFactsRepository();
  const logs = new InMemoryExtractionLogRepository();
  const embed = new StubEmbedder(8);
  const certifiedExtraction = new ExtractionService(model(EXTRACTION), clients, notes, facts, embed, logs, CERTIFIED);
  const capture = new AskCaptureService({ notes, clients, facts, embedder: embed, extraction: certifiedExtraction });
  const detector = new ModelStatementDetector(model(detectJson)); // scripted detection (Haiku in prod)
  const svc = new RecallService(
    embedder, notes, model('answer'), { topK: 5, minSimilarity: 0.2, maxRetrievalTokens: 100000 },
    undefined, RECALL_MODEL, undefined, detector, capture,
    async () => (await clients.listByUser('u')).map((c) => ({ id: c.id, name: c.name })),
  );
  await clients.create('u', 'Sarah');
  return { svc, notes, facts, logs, clients };
}

describe('[ASK-CAPTURE] detection routes statements to the certified path; questions never become facts', () => {
  it('a QUESTION produces zero capture — the most important negative', async () => {
    const h = await harness('{"isStatement":false,"clientRef":null}');
    const r = await h.svc.ask('u', 'did Sarah say she wanted a 2-bed?');
    expect(r.capture).toBeUndefined(); // nothing flagged
    expect(await h.notes.listByStatusForUser('u', 'pending_confirmation')).toHaveLength(0); // nothing captured
  });

  it('a clear STATEMENT about a named client is captured (pending), via the certified engine', async () => {
    const h = await harness('{"isStatement":true,"clientRef":"Sarah"}');
    const r = await h.svc.ask('u', 'actually Sarah moved to Meridian Capital');
    expect(r.capture?.status).toBe('captured');
    expect(r.capture?.clientName).toBe('Sarah');
    expect(r.capture?.statement).toBe('actually Sarah moved to Meridian Capital'); // the verbatim receipt
    const pending = await h.notes.listByStatusForUser('u', 'pending_confirmation');
    expect(pending).toHaveLength(1);
    // certified path: a training-log row exists with the CERTIFIED model, not the recall model
    const log = await h.logs.listByUser('u');
    expect(log).toHaveLength(1);
    expect(log[0]!.model).toBe(CERTIFIED);
    expect(log[0]!.model).not.toBe(RECALL_MODEL);
    // nothing entered the vault
    expect(await h.notes.searchSimilarByUser('u', [1, 0, 0, 0, 0, 0, 0, 0], 5)).toHaveLength(0);
    expect(await h.facts.listPromisesByUser('u')).toHaveLength(0);
  });

  it('a statement with NO clear client asks which and stores nothing (explicit attribution)', async () => {
    const h = await harness('{"isStatement":true,"clientRef":null}');
    const r = await h.svc.ask('u', 'they moved offices last week');
    expect(r.capture?.status).toBe('needs_client');
    expect(await h.notes.listByStatusForUser('u', 'pending_confirmation')).toHaveLength(0); // stored nothing
  });

  it('capture is skipped entirely when the recall service has no detector wired', async () => {
    const svc = new RecallService(embedder, noSearch, model('a'), { topK: 5, minSimilarity: 0.2, maxRetrievalTokens: 100000 });
    const r = await svc.ask('u', 'Sarah moved to Meridian Capital');
    expect(r.capture).toBeUndefined();
  });
});
