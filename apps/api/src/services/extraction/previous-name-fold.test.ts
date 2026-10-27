import { describe, it, expect } from 'vitest';
import { normaliseCounterpart, ExtractionService } from './extraction-service.js';
import { extractionAliasesFor } from '../clients/extraction-aliases.js';
import { InMemoryClientRepository } from '../../adapters/clients/in-memory-client-repository.js';
import { InMemoryNoteRepository } from '../../adapters/notes/in-memory-note-repository.js';
import { InMemoryFactsRepository } from '../../adapters/facts/in-memory-facts-repository.js';
import { InMemoryExtractionLogRepository } from '../../adapters/logs/in-memory-extraction-log-repository.js';
import { InMemoryContactAliasRepository } from '../../adapters/import/in-memory-contact-alias-repository.js';
import { StubEmbedder } from '../../adapters/embedding/stub.js';
import type { ModelClient } from '../../ports/model.js';

// [P49-3 · owner] A previous name (the name a rename replaced) folds an extracted person into the client only on the
// EXACT full name. A learned alias folds on a shared word (unchanged here; that risk is reported separately), but a
// rename must never widen it: renaming "Khalid Dubai Marina" must not fold a different "Marina" or "Khalid" into him.
const person = (name: string) => ({ name, role: null, reports_to: null, decision_role: 'unknown', notes: null });

describe('[P49-3] a previous name folds on the exact full name only', () => {
  it('the old full name folds into the client under the new name; a person sharing one of its words does not', () => {
    const ex = { people: [person('Khalid Dubai Marina'), person('Marina'), person('Khalid')], personal_facts: [{ subject: 'khalid  dubai marina' }, { subject: 'Marina' }] };
    normaliseCounterpart(ex, 'Abdullah Al Mansoori', [], ['Khalid Dubai Marina']);
    expect(ex.people.map((p) => p.name)).toEqual(['Abdullah Al Mansoori', 'Marina', 'Khalid']);
    expect(ex.personal_facts.map((f) => f.subject)).toEqual(['Abdullah Al Mansoori', 'Marina']);
  });

  it('NEGATIVE: with no previous names, the fold is exactly as before (learned aliases untouched)', () => {
    const a = { people: [person('Bubu DXB'), person('Sara')], personal_facts: [] };
    const b = { people: [person('Bubu DXB'), person('Sara')], personal_facts: [] };
    normaliseCounterpart(a, 'Imtinan', ['Bubu DXB']);
    normaliseCounterpart(b, 'Imtinan', ['Bubu DXB'], []);
    expect(a).toEqual(b);
    expect(a.people.map((p) => p.name)).toEqual(['Imtinan', 'Sara']);
  });

  it('the alias store hands extraction its learned aliases as before and each previous name marked exact', async () => {
    const aliases = new InMemoryContactAliasRepository();
    await aliases.add('u', 'c', 'Bubu DXB');
    await aliases.add('u', 'c', 'Khalid Dubai Marina', 'previous_name');
    expect(await extractionAliasesFor(aliases)('u', 'c')).toEqual(['Bubu DXB', { previousName: 'Khalid Dubai Marina' }]);
  });

  it('through the service: a renamed client\'s next chat keeps a "Marina" who is not him, and folds his old full name', async () => {
    const clients = new InMemoryClientRepository();
    const notes = new InMemoryNoteRepository();
    const aliases = new InMemoryContactAliasRepository();
    const client = await clients.create('u', 'Khalid Dubai Marina');
    await clients.rename('u', client.id, 'Abdullah Al Mansoori', Date.now());
    await aliases.add('u', client.id, 'Khalid Dubai Marina', 'previous_name');
    const note = await notes.create('u', { clientId: client.id, source: 'whatsapp_export', rawText: '[2026-07-13] Khalid Dubai Marina: Marina from legal will call', audioKey: null, status: 'pending_extraction' });
    const out = JSON.stringify({ summary: 'x', promises: [], key_dates: [], personal_facts: [], concerns: [], next_steps: [], meeting: null, people: [person('Khalid Dubai Marina'), person('Marina')] });
    const model: ModelClient = { complete: async () => ({ text: out }) };
    const svc = new ExtractionService(model, clients, notes, new InMemoryFactsRepository(), new StubEmbedder(8), new InMemoryExtractionLogRepository(), 'stub', undefined, undefined, undefined, '1h', undefined, undefined, undefined, undefined, undefined, undefined, extractionAliasesFor(aliases));
    await svc.extractNote('u', note.id, '2026-07-13');
    const stored = (await notes.findByIdForUser('u', note.id))!.extracted as { people: Array<{ name: string }> };
    expect(stored.people.map((p) => p.name)).toEqual(['Abdullah Al Mansoori', 'Marina']);
    expect((await notes.findByIdForUser('u', note.id))!.rawText).toContain('Khalid Dubai Marina'); // evidence stays verbatim
  });
});
