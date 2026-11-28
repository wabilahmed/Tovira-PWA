import { describe, it, expect } from 'vitest';
import { BriefService } from './brief-service.js';
import { InMemoryClientRepository } from '../../adapters/clients/in-memory-client-repository.js';
import { InMemoryNoteRepository } from '../../adapters/notes/in-memory-note-repository.js';
import { InMemoryFactsRepository } from '../../adapters/facts/in-memory-facts-repository.js';
import { fixtures } from '../../seed/fixtures.js';

/**
 * [P90-4 · owner, Prompt 88] The brief crashed in the browser on a note whose concerns are stored in the old shape,
 * `[{ text }]` (the repo demo seed still writes it; the stored-output check only requires a list). The brief answers
 * with plain text whatever the stored shape: a `{ text }` concern becomes its text; anything else that is not text is
 * left out, never invented.
 */
const embedder = { dimension: 3, embed: async () => [0, 0, 0] };
async function briefFor(concerns: unknown[]) {
  const clients = new InMemoryClientRepository(); const notes = new InMemoryNoteRepository(); const facts = new InMemoryFactsRepository();
  const client = await clients.create('user-A', 'Meridian Corp');
  const note = await notes.create('user-A', { clientId: client.id, source: 'voice', rawText: 'note', audioKey: null, status: 'extracted' });
  await notes.update('user-A', note.id, { extracted: { summary: 's', promises: [], people: [], personal_facts: [], key_dates: [], concerns, next_steps: [], meeting: null } as never });
  return (await new BriefService(clients, notes, facts, embedder).buildBrief('user-A', client.id))!;
}

describe('[P90-4] the brief and old-format concerns', () => {
  it('an old-format concern ({ text }) is shown as its text, next to a plain one', async () => {
    const b = await briefFor(['Timeline is tight', { text: 'Q3 rollout timeline feels too tight' }]);
    expect(b.concerns).toEqual(['Timeline is tight', 'Q3 rollout timeline feels too tight']);
  });
  it('the demo seed\'s own notes produce only text', async () => {
    const seedConcerns = fixtures.notes.flatMap((n) => n.extracted.concerns as unknown[]);
    expect(seedConcerns.some((c) => typeof c !== 'string')).toBe(true); // the seed is in the old shape
    const b = await briefFor(seedConcerns);
    expect(b.concerns.length).toBe(seedConcerns.length);
    for (const c of b.concerns) expect(typeof c).toBe('string');
  });
  it('NEGATIVE: anything else that is not text is left out (never "[object Object]", never invented)', async () => {
    const b = await briefFor([null, 7, {}, { text: 9 }, { text: '   ' }, ['x'], '  ', 'Budget freeze until March']);
    expect(b.concerns).toEqual(['Budget freeze until March']);
  });
});
