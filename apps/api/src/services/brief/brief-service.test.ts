import { describe, it, expect } from 'vitest';
import { BriefService } from './brief-service.js';
import { InMemoryClientRepository } from '../../adapters/clients/in-memory-client-repository.js';
import { InMemoryNoteRepository } from '../../adapters/notes/in-memory-note-repository.js';
import { InMemoryFactsRepository } from '../../adapters/facts/in-memory-facts-repository.js';
import type { Embedder } from '../../ports/embedder.js';
import type { Extraction } from '../extraction/types.js';

// A fake embedder returning a fixed vector per exact text (so we control similarity).
function fakeEmbedder(map: Record<string, number[]>): Embedder {
  return { dimension: 3, embed: async (t: string) => map[t] ?? [0, 0, 0] };
}

const extraction = (over: Partial<Extraction>): Extraction => ({
  summary: 'note summary',
  promises: [],
  people: [],
  personal_facts: [],
  key_dates: [],
  concerns: [],
  next_steps: [],
  meeting: null,
  ...over,
});

async function seed() {
  const clients = new InMemoryClientRepository();
  const notes = new InMemoryNoteRepository();
  const facts = new InMemoryFactsRepository();
  const client = await clients.create('user-A', 'Meridian Corp');
  return { clients, notes, facts, client };
}

describe('BriefService', () => {
  it('assembles promises, key people, concerns and personal notes', async () => {
    const { clients, notes, facts, client } = await seed();
    const note = await notes.create('user-A', { clientId: client.id, source: 'voice', rawText: 'note', audioKey: null, status: 'extracted' });
    await notes.update('user-A', note.id, {
      extracted: extraction({
        people: [{ name: 'Jordan', role: 'VP', reports_to: null, decision_role: 'decision_maker', notes: null }],
        concerns: ['Timeline is tight'],
        personal_facts: [{ subject: 'Jordan', fact: 'Runs marathons', category: 'hobby' }],
      }),
    });
    await facts.saveExtraction('user-A', {
      noteId: note.id,
      clientId: client.id,
      promises: [{ text: 'send the quote', owner: 'rep', due_date: '2026-07-10', due_raw: 'Friday', confidence: 'high' }],
    });

    const brief = (await new BriefService(clients, notes, facts, fakeEmbedder({})).buildBrief('user-A', client.id))!;
    expect(brief.empty).toBe(false);
    expect(brief.openPromises).toHaveLength(1);
    expect(brief.keyPeople.map((p) => p.name)).toContain('Jordan');
    expect(brief.concerns).toContain('Timeline is tight');
    expect(brief.personalNotes[0]!.subject).toBe('Jordan');
  });

  // NEGATIVE: a client with no data → honest empty, not a fabricated summary.
  it('returns an honest empty brief for a client with no data', async () => {
    const { clients, notes, facts, client } = await seed();
    const brief = (await new BriefService(clients, notes, facts, fakeEmbedder({})).buildBrief('user-A', client.id))!;
    expect(brief.empty).toBe(true);
    expect(brief.openPromises).toEqual([]);
    expect(brief.recentContext).toEqual([]);
  });

  // NEGATIVE: an unconfirmed low-confidence promise is NOT presented as a settled fact.
  it('keeps uncertain promises out of open promises (in the confirm queue instead)', async () => {
    const { clients, notes, facts, client } = await seed();
    const note = await notes.create('user-A', { clientId: client.id, source: 'paste', rawText: 'x', audioKey: null, status: 'extracted' });
    await facts.saveExtraction('user-A', {
      noteId: note.id,
      clientId: client.id,
      promises: [{ text: 'maybe follow up', owner: 'rep', due_date: null, due_raw: 'soon', confidence: 'low' }],
    });
    const brief = (await new BriefService(clients, notes, facts, fakeEmbedder({})).buildBrief('user-A', client.id))!;
    expect(brief.openPromises).toEqual([]);
    expect(brief.needsConfirmation).toHaveLength(1);
  });

  it('surfaces a semantically related past note and omits unrelated ones', async () => {
    const { clients, notes, facts, client } = await seed();
    // focus note (most-relevant), a similar past note, and an unrelated one.
    const focus = await notes.create('user-A', { clientId: client.id, source: 'voice', rawText: 'pricing concerns', audioKey: null, status: 'extracted' });
    const similar = await notes.create('user-A', { clientId: client.id, source: 'paste', rawText: 'budget worries', audioKey: null, status: 'extracted' });
    const unrelated = await notes.create('user-A', { clientId: client.id, source: 'paste', rawText: 'golf trip', audioKey: null, status: 'extracted' });
    // listByClient is newest-first, so `unrelated` is newest — but `related()` uses
    // the first note that HAS text as focus, which is `unrelated`. Set embeddings so
    // that only `similar`/`focus` are close to the focus's query vector.
    await notes.update('user-A', focus.id, { embedding: [1, 0, 0] });
    await notes.update('user-A', similar.id, { embedding: [0.9, 0.1, 0] });
    await notes.update('user-A', unrelated.id, { embedding: [0, 0, 1] });
    // Query vector for the focus text 'golf trip' (newest) → make it point at [0,0,1]
    // so only `unrelated` (itself, excluded) matches; nothing else is related.
    const embedder = fakeEmbedder({ 'golf trip': [0, 0, 1], 'pricing concerns': [1, 0, 0] });

    const brief = (await new BriefService(clients, notes, facts, embedder).buildBrief('user-A', client.id))!;
    // Focus is 'golf trip' [0,0,1]; nothing else is close → related omitted.
    expect(brief.relatedNotes).toEqual([]);

    // Now make the focus text query point at the pricing cluster.
    const embedder2 = fakeEmbedder({ 'golf trip': [1, 0, 0], 'pricing concerns': [1, 0, 0] });
    const brief2 = (await new BriefService(clients, notes, facts, embedder2).buildBrief('user-A', client.id))!;
    const ids = brief2.relatedNotes.map((r) => r.noteId);
    expect(ids).toContain(focus.id);
    expect(ids).toContain(similar.id);
    expect(ids).not.toContain(unrelated.id); // the focus note is excluded from its own related list
  });
});
