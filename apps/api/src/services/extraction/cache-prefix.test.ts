import { describe, it, expect } from 'vitest';
import { ExtractionService } from './extraction-service.js';
import { EXTRACTION_SYSTEM_PROMPT } from './prompt.js';
import { InMemoryClientRepository } from '../../adapters/clients/in-memory-client-repository.js';
import { InMemoryNoteRepository } from '../../adapters/notes/in-memory-note-repository.js';
import { InMemoryFactsRepository } from '../../adapters/facts/in-memory-facts-repository.js';
import { InMemoryExtractionLogRepository } from '../../adapters/logs/in-memory-extraction-log-repository.js';
import { InMemoryCorrectionRepository } from '../../adapters/corrections/in-memory-correction-repository.js';
import { StubEmbedder } from '../../adapters/embedding/stub.js';
import type { ModelClient, ModelCompletionRequest } from '../../ports/model.js';

const VALID = JSON.stringify({
  summary: 's',
  promises: [],
  people: [],
  personal_facts: [],
  key_dates: [],
  concerns: [],
  next_steps: [],
  meeting: null,
});

/** Capture the exact request the model was asked to complete. */
function capturing(): { model: ModelClient; last: () => ModelCompletionRequest } {
  let seen: ModelCompletionRequest | null = null;
  return { model: { complete: async (req) => { seen = req; return { text: VALID }; } }, last: () => seen! };
}

/** Run one extraction with a specific client, date, and glossary term; return the request. */
async function runExtraction(opts: { user: string; client: string; today: string; glossaryFrom: string; glossaryTo: string }): Promise<ModelCompletionRequest> {
  const clients = new InMemoryClientRepository();
  const notes = new InMemoryNoteRepository();
  const facts = new InMemoryFactsRepository();
  const logs = new InMemoryExtractionLogRepository();
  const corrections = new InMemoryCorrectionRepository();
  await corrections.record(opts.user, { noteId: 'n', entityType: 'promise', entityId: 'p', field: 'text', before: opts.glossaryFrom, after: opts.glossaryTo, promptVersion: 'v' });
  const client = await clients.create(opts.user, opts.client);
  const note = await notes.create(opts.user, { clientId: client.id, source: 'paste', rawText: 'note text here', audioKey: null, status: 'pending_extraction' });
  const cap = capturing();
  const svc = new ExtractionService(cap.model, clients, notes, facts, new StubEmbedder(8), logs, 'stub', corrections);
  await svc.extractNote(opts.user, note.id, opts.today);
  return cap.last();
}

// CACHE-3: the cached breakpoint is the system prefix. It MUST stay byte-identical no
// matter the client, the date, or the per-rep glossary — otherwise every varying call
// starts a cold cache (the 9%-looking failure). This is the permanent guard that a
// future edit interpolating anything variable into the prefix trips loudly.
describe('[CACHE-3] the cached extraction prefix is byte-identical across varying inputs', () => {
  it('same system prefix for different client, date, and glossary — with caching on', async () => {
    const a = await runExtraction({ user: 'user-A', client: 'Meridian Corp', today: '2026-07-09', glossaryFrom: 'Meridiun', glossaryTo: 'Meridian' });
    const b = await runExtraction({ user: 'user-B', client: 'Globex FZE', today: '2026-11-15', glossaryFrom: 'Globeks', glossaryTo: 'Globex' });

    // The breakpoint is requested, and the prefix is the constant — byte-identical.
    expect(a.cacheSystemPrompt).toBe(true);
    expect(b.cacheSystemPrompt).toBe(true);
    expect(a.system).toBe(EXTRACTION_SYSTEM_PROMPT);
    expect(b.system).toBe(a.system); // byte-identical across all varying inputs

    // And the variable data lives in the MESSAGE, never the cached prefix.
    const prefix = a.system ?? '';
    for (const variable of ['2026-07-09', '2026-11-15', 'Meridian Corp', 'Globex FZE', 'Meridiun', 'Globeks']) {
      expect(prefix.includes(variable), `"${variable}" must not leak into the cached prefix`).toBe(false);
    }
    const msg = String(a.messages[a.messages.length - 1]?.content ?? '');
    expect(msg).toContain('2026-07-09'); // today IS in the variable message
    expect(msg).toContain('Meridian Corp'); // client name IS in the variable message
  });
});
