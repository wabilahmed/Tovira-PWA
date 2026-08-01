import { describe, it, expect, vi } from 'vitest';
import { ExtractionService } from './extraction-service.js';
import { InMemoryClientRepository } from '../../adapters/clients/in-memory-client-repository.js';
import { InMemoryNoteRepository } from '../../adapters/notes/in-memory-note-repository.js';
import { InMemoryFactsRepository } from '../../adapters/facts/in-memory-facts-repository.js';
import { InMemoryExtractionLogRepository } from '../../adapters/logs/in-memory-extraction-log-repository.js';
import { StubEmbedder } from '../../adapters/embedding/stub.js';
import type { ModelClient } from '../../ports/model.js';
import type { ModelRouter, ModelRoute } from './model-router.js';

const VALID = JSON.stringify({ summary: 's', promises: [], people: [], personal_facts: [], key_dates: [], concerns: [], next_steps: [], meeting: null });

function fixedModel(...responses: string[]): ModelClient {
  let i = 0;
  return { complete: async () => ({ text: responses[Math.min(i++, responses.length - 1)]! }) };
}

async function extractWith(router: ModelRouter) {
  const clients = new InMemoryClientRepository();
  const notes = new InMemoryNoteRepository();
  const facts = new InMemoryFactsRepository();
  const logs = new InMemoryExtractionLogRepository();
  const client = await clients.create('u1', 'Acme');
  const note = await notes.create('u1', { clientId: client.id, source: 'paste', rawText: 'hi', audioKey: null, status: 'pending_extraction' });
  // The service's own fixed model is a poison value — routing must override it.
  const service = new ExtractionService(fixedModel('POISON'), clients, notes, facts, new StubEmbedder(8), logs, 'POISON-ID', undefined, router);
  // Attach the routed model's responses by making the router's model return them.
  await service.extractNote('u1', note.id, '2026-08-01');
  return (await logs.listByUser('u1'))[0]!;
}

describe('ExtractionService model routing (P5-7)', () => {
  it('logs the trial (Sonnet) model id for a trial account', async () => {
    const route: ModelRoute = { model: fixedModel(VALID), modelId: 'claude-sonnet-5' };
    const router: ModelRouter = { resolve: async () => route };
    const log = await extractWith(router);
    expect(log.model).toBe('claude-sonnet-5');
  });

  it('logs the production model id for a paid account', async () => {
    const route: ModelRoute = { model: fixedModel(VALID), modelId: 'claude-haiku-4-5-20251001' };
    const router: ModelRouter = { resolve: async () => route };
    const log = await extractWith(router);
    expect(log.model).toBe('claude-haiku-4-5-20251001');
  });

  // No model mixing within a note's retry sequence: resolve is called exactly once
  // even when the first attempt fails and a retry happens.
  it('resolves the model once per note (retry never switches models)', async () => {
    const route: ModelRoute = { model: fixedModel('not json', VALID), modelId: 'claude-sonnet-5' }; // fail then succeed
    const resolve = vi.fn().mockResolvedValue(route);
    const router: ModelRouter = { resolve };
    await extractWith(router);
    expect(resolve).toHaveBeenCalledTimes(1);
  });
});
