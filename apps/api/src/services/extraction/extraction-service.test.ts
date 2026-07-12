import { describe, it, expect } from 'vitest';
import { ExtractionService } from './extraction-service.js';
import { InMemoryClientRepository } from '../../adapters/clients/in-memory-client-repository.js';
import { InMemoryNoteRepository } from '../../adapters/notes/in-memory-note-repository.js';
import { InMemoryFactsRepository } from '../../adapters/facts/in-memory-facts-repository.js';
import { StubEmbedder } from '../../adapters/embedding/stub.js';
import type { ModelClient } from '../../ports/model.js';

const VALID = JSON.stringify({
  summary: 'Rep committed to sending the revised quote.',
  promises: [{ text: 'Send the revised quote', owner: 'rep', due_date: '2026-07-10', due_raw: 'Friday', confidence: 'high' }],
  people: [],
  personal_facts: [],
  key_dates: [],
  concerns: [],
  next_steps: [],
  meeting: null,
});

function model(...responses: string[]): ModelClient {
  let i = 0;
  return { complete: async () => ({ text: responses[Math.min(i++, responses.length - 1)]! }) };
}

async function setup(m: ModelClient) {
  const clients = new InMemoryClientRepository();
  const notes = new InMemoryNoteRepository();
  const facts = new InMemoryFactsRepository();
  const client = await clients.create('user-A', 'Meridian Corp');
  const note = await notes.create('user-A', {
    clientId: client.id,
    source: 'paste',
    rawText: "I'll send the revised quote by Friday",
    audioKey: null,
    status: 'pending_extraction',
  });
  const service = new ExtractionService(m, clients, notes, facts, new StubEmbedder(8));
  return { service, notes, facts, note };
}

describe('ExtractionService', () => {
  it('stores facts to JSONB, promises to the spine, and marks the note extracted', async () => {
    const { service, notes, facts, note } = await setup(model(VALID));
    const out = await service.extractNote('user-A', note.id, '2026-07-09');
    expect(out.status).toBe('extracted');
    const stored = await notes.findByIdForUser('user-A', note.id);
    expect(stored?.status).toBe('extracted');
    expect((stored?.extracted as { summary: string }).summary).toContain('revised quote');
    const promises = await facts.listPromisesByNote('user-A', note.id);
    expect(promises).toHaveLength(1);
    expect(promises[0]!.owner).toBe('rep');
  });

  // NEGATIVE: malformed output is retried once; a valid retry succeeds.
  it('retries once and succeeds when the first response is malformed', async () => {
    const { service, note } = await setup(model('not json', VALID));
    const out = await service.extractNote('user-A', note.id, '2026-07-09');
    expect(out.status).toBe('extracted');
  });

  // NEGATIVE: two malformed responses → flag the note, write NOTHING structured.
  it('flags the note and writes no structured data after a failed retry', async () => {
    const { service, notes, facts, note } = await setup(model('garbage', 'still garbage'));
    const out = await service.extractNote('user-A', note.id, '2026-07-09');
    expect(out.flagged).toBe(true);
    expect(out.status).toBe('needs_review');
    const stored = await notes.findByIdForUser('user-A', note.id);
    expect(stored?.status).toBe('needs_review');
    expect(stored?.extracted).toBeNull(); // no partial JSONB write
    expect(await facts.listPromisesByNote('user-A', note.id)).toEqual([]); // no spine rows
  });

  // NEGATIVE: valid JSON that violates the schema is treated as a failure.
  it('flags the note when the JSON is valid but the schema is wrong', async () => {
    const schemaWrong = JSON.stringify({ summary: 'x', promises: 'not-an-array' });
    const { service, notes, note } = await setup(model(schemaWrong, schemaWrong));
    const out = await service.extractNote('user-A', note.id, '2026-07-09');
    expect(out.status).toBe('needs_review');
    expect((await notes.findByIdForUser('user-A', note.id))?.extracted).toBeNull();
  });

  it('re-extraction is idempotent on the spine (no duplicate promises)', async () => {
    const { service, facts, note } = await setup(model(VALID));
    await service.extractNote('user-A', note.id, '2026-07-09');
    await service.extractNote('user-A', note.id, '2026-07-09');
    expect(await facts.listPromisesByNote('user-A', note.id)).toHaveLength(1);
  });
});
