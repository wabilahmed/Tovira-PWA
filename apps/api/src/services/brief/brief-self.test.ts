import { describe, it, expect } from 'vitest';
import { BriefService } from './brief-service.js';
import { InMemoryClientRepository } from '../../adapters/clients/in-memory-client-repository.js';
import { InMemoryNoteRepository } from '../../adapters/notes/in-memory-note-repository.js';
import { InMemoryFactsRepository } from '../../adapters/facts/in-memory-facts-repository.js';
import type { Embedder } from '../../ports/embedder.js';

/**
 * [P36-5 · owner, 20 Oct] The client is never one of the "People" in their own pre-meeting brief — not by their
 * client name or a learned alias. (Same rule as the stakeholder map.)
 */
const embedder: Embedder = { dimension: 3, embed: async () => [0, 0, 0] };
const person = (name: string, decision_role = 'unknown') => ({ name, role: null, reports_to: null, decision_role, notes: null });

describe('[P36-5] the pre-meeting brief\'s People leave the client out', () => {
  it('drops the client by name; with no client type recorded, an alias person is shown', async () => {
    const clients = new InMemoryClientRepository();
    const notes = new InMemoryNoteRepository();
    const facts = new InMemoryFactsRepository();
    const c = await clients.create('u', 'QA Windowed Buyer 2');
    const n = await notes.create('u', { clientId: c.id, source: 'whatsapp_export', rawText: 'x', audioKey: null, status: 'extracted',
      messages: [{ sender: 'Windowed Buyer', sentAt: '2026-05-01T09:00', body: 'looking for a villa', media: false, role: 'client' }] } as never);
    await notes.update('u', n.id, { extracted: { summary: 's', promises: [], people: [person('QA Windowed Buyer 2'), person('Windowed Buyer'), person('Abu Khalid'), person('Sara Agent', 'influencer')], personal_facts: [], key_dates: [], concerns: [], next_steps: [], meeting: null } });
    const aliases = { listByClient: async (_u: string, id: string) => (id === c.id ? ['Abu Khalid'] : []) };
    const brief = await new BriefService(clients, notes, facts, embedder, undefined, undefined, aliases).buildBrief('u', c.id);
    expect(brief!.keyPeople.map((p) => p.name)).toEqual(['Windowed Buyer', 'Abu Khalid', 'Sara Agent'] /* [owner, 20 Oct] no client type recorded → an alias hides no one; a chat sender is never the client */);
  });
});
