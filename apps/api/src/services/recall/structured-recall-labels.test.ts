import { describe, it, expect } from 'vitest';
import { StructuredRecall } from './structured-recall.js';
import { InMemoryClientRepository } from '../../adapters/clients/in-memory-client-repository.js';
import { InMemoryFactsRepository } from '../../adapters/facts/in-memory-facts-repository.js';
import { InMemoryMeetingRepository } from '../../adapters/meetings/in-memory-meeting-repository.js';
import { InMemoryNoteRepository } from '../../adapters/notes/in-memory-note-repository.js';

/** [P21-R5] A person (or personal-fact subject) that IS the client read "QA Sara Khan — QA Sara Khan".
 *  The receipt shows the fact once after the client's name; a self-row with no fact is not a row at all. */
async function rows(extracted: unknown, question: string) {
  const clients = new InMemoryClientRepository();
  const notes = new InMemoryNoteRepository();
  const c = await clients.create('u', 'QA Sara Khan');
  const n = await notes.create('u', { clientId: c.id, source: 'whatsapp_export', rawText: 'x', audioKey: null, status: 'extracted' });
  await notes.update('u', n.id, { extracted });
  const out = await new StructuredRecall({ facts: new InMemoryFactsRepository(), meetings: new InMemoryMeetingRepository(), clients, notes }).forUser('u', Date.now(), { question });
  return out.map((r) => r.quote);
}
const person = (name: string, role: string | null, notes: string | null) => ({ name, role, reports_to: null, decision_role: 'unknown', notes, source_message_at: '2026-03-02T10:00:00' });

describe('[P21-R5] no "Name — Name" receipt labels', () => {
  it('the client as a person shows the fact, not the name twice', async () => {
    const q = await rows({ people: [person('QA Sara Khan', 'buyer', 'relocating from London with two kids')] }, 'who is relocating from London?');
    expect(q).toContain('QA Sara Khan — buyer: relocating from London with two kids');
    expect(q.some((x) => /QA Sara Khan — QA Sara Khan/.test(x))).toBe(false);
  });

  it('matches regardless of case/spacing ("qa sara  khan")', async () => {
    const q = await rows({ people: [person('qa sara  khan', null, 'prefers calls after 5pm')] }, 'who prefers calls after 5pm?');
    expect(q).toContain('QA Sara Khan — prefers calls after 5pm');
  });

  it('a personal fact about the client herself reads "Client — fact"', async () => {
    const q = await rows({ personal_facts: [{ subject: 'QA Sara Khan', fact: 'daughter starts school in September', category: 'family', source_message_at: '2026-03-03T08:00:00' }] }, 'whose daughter starts school?');
    expect(q).toContain('QA Sara Khan — daughter starts school in September');
  });

  it('NEGATIVE: a self-row with no fact at all is dropped; a different person keeps their name', async () => {
    const q = await rows({ people: [person('QA Sara Khan', null, null), person('Mona', 'wife', 'handles the finances')] }, 'who handles the finances, sara khan?');
    expect(q.some((x) => x.startsWith('QA Sara Khan — QA Sara Khan') || x === 'QA Sara Khan — ')).toBe(false);
    expect(q).toContain('QA Sara Khan — Mona (wife): handles the finances');
  });
});
