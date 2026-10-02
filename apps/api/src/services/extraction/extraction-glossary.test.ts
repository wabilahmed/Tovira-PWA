import { describe, it, expect } from 'vitest';
import { ExtractionService } from './extraction-service.js';
import { InMemoryClientRepository } from '../../adapters/clients/in-memory-client-repository.js';
import { InMemoryNoteRepository } from '../../adapters/notes/in-memory-note-repository.js';
import { InMemoryFactsRepository } from '../../adapters/facts/in-memory-facts-repository.js';
import { InMemoryExtractionLogRepository } from '../../adapters/logs/in-memory-extraction-log-repository.js';
import { InMemoryRepGlossaryRepository } from '../../adapters/glossary/in-memory-rep-glossary-repository.js';
import { StubEmbedder } from '../../adapters/embedding/stub.js';
import type { ModelClient } from '../../ports/model.js';

const VALID = JSON.stringify({
  summary: 's', promises: [], people: [], personal_facts: [], key_dates: [], concerns: [], next_steps: [], meeting: null,
});

function capturingModel(): { model: ModelClient; last: () => string } {
  let last = '';
  return {
    model: { complete: async (req) => { last = String(req.messages[0]?.content ?? ''); return { text: VALID }; } },
    last: () => last,
  };
}

// [NO-TRAINING-RETENTION] the glossary is now the operational rep_glossary table, seeded by the verdict
// edit path; the extractor reads it.
async function run(userId: string, seedGlossary: (g: InMemoryRepGlossaryRepository) => Promise<void>) {
  const clients = new InMemoryClientRepository();
  const notes = new InMemoryNoteRepository();
  const facts = new InMemoryFactsRepository();
  const glossary = new InMemoryRepGlossaryRepository();
  await seedGlossary(glossary);
  const client = await clients.create(userId, 'Meridian Corp');
  const note = await notes.create(userId, { clientId: client.id, source: 'paste', rawText: 'call Meridiun tomorrow', audioKey: null, status: 'pending_extraction' });
  const { model, last } = capturingModel();
  const service = new ExtractionService(model, clients, notes, facts, new StubEmbedder(8), new InMemoryExtractionLogRepository(), 'stub', glossary);
  await service.extractNote(userId, note.id, '2026-08-01');
  return last();
}

// Corrected twice for user-A (meets the "carried" threshold).
const twice = async (g: InMemoryRepGlossaryRepository) => {
  await g.upsert('user-A', 'Meridiun', 'Meridian', 1);
  await g.upsert('user-A', 'Meridiun', 'Meridian', 2);
};

describe('ExtractionService glossary (P4-9)', () => {
  it('injects the rep\'s glossary into the extraction message', async () => {
    const message = await run('user-A', twice);
    expect(message).toMatch(/GLOSSARY/);
    expect(message).toMatch(/Meridiun/);
    expect(message).toMatch(/Meridian/);
  });

  // ISOLATION: another rep with no glossary gets no glossary block.
  it('does not leak one rep\'s glossary to another (isolation)', async () => {
    const message = await run('user-B', twice); // glossary seeded for user-A only
    expect(message).not.toMatch(/GLOSSARY/);
  });

  it('adds no glossary block when the rep has no qualifying terms', async () => {
    const message = await run('user-A', async () => {});
    expect(message).not.toMatch(/GLOSSARY/);
  });
});
