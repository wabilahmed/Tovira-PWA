import { describe, it, expect } from 'vitest';
import { ExtractionService } from './extraction-service.js';
import { InMemoryClientRepository } from '../../adapters/clients/in-memory-client-repository.js';
import { InMemoryNoteRepository } from '../../adapters/notes/in-memory-note-repository.js';
import { InMemoryFactsRepository } from '../../adapters/facts/in-memory-facts-repository.js';
import { InMemoryExtractionLogRepository } from '../../adapters/logs/in-memory-extraction-log-repository.js';
import { InMemoryErasureRequestRepository } from '../../adapters/erasure/in-memory-erasure-request-repository.js';
import { RestrictionService } from '../erasure/restriction.js';
import { StubEmbedder } from '../../adapters/embedding/stub.js';
import type { ModelClient } from '../../ports/model.js';

// [TASK 2] A restricted counterparty's messages must never reach a model — the same chokepoint as a
// sensitive-held message. A chat that arrives DURING the window is restricted on its first extraction.

const VALID = JSON.stringify({ summary: 's', promises: [], people: [], personal_facts: [], key_dates: [], concerns: [], next_steps: [], meeting: null });

function capturingModel(): { model: ModelClient; bodies: () => string } {
  const sent: string[] = [];
  return {
    model: { complete: async (req) => { sent.push(req.messages.map((m) => String(m.content)).join('\n')); return { text: VALID }; } },
    bodies: () => sent.join('\n---\n'),
  };
}

describe('[TASK 2] extraction withholds a restricted counterparty from the model body', () => {
  async function setup() {
    const clients = new InMemoryClientRepository();
    const notes = new InMemoryNoteRepository();
    const facts = new InMemoryFactsRepository();
    const requests = new InMemoryErasureRequestRepository();
    const restriction = new RestrictionService({ requests });
    const client = await clients.create('u', 'Marina Estates');
    const { model, bodies } = capturingModel();
    const svc = new ExtractionService(
      model, clients, notes, facts, new StubEmbedder(8), new InMemoryExtractionLogRepository(), 'stub',
      undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, restriction,
    );
    return { notes, requests, client, svc, bodies };
  }

  it('a restricted sender\'s message never appears in the model request; the rep\'s own lines do', async () => {
    const { notes, requests, client, svc, bodies } = await setup();
    const note = await notes.create('u', { clientId: client.id, source: 'whatsapp_export', audioKey: null, status: 'pending_extraction',
      rawText: 'Khalid: my budget is five million, keep it quiet\nRep: understood',
      messages: [
        { sentAt: '2026-01-01T10:00', sender: 'Khalid', body: 'my budget is five million, keep it quiet', media: false, role: 'client' },
        { sentAt: '2026-01-01T10:01', sender: 'Rep', body: 'understood', media: false, role: 'rep' },
      ] });
    const now = Date.now();
    await requests.create('u', { requesterNames: ['Khalid'], requestedAt: now, windowEndsAt: now + 10 * 86_400_000 });

    await svc.extractNote('u', note.id, '2026-02-01');
    const body = bodies();
    expect(body).not.toContain('five million'); // the restricted message is withheld
    expect(body).toContain('understood'); // the rep's own line still goes
  });

  it('a note that is ENTIRELY the restricted counterparty is never sent to the model at all', async () => {
    const { notes, requests, client, svc, bodies } = await setup();
    const note = await notes.create('u', { clientId: client.id, source: 'whatsapp_export', audioKey: null, status: 'pending_extraction',
      rawText: 'Khalid: secret deal terms',
      messages: [{ sentAt: '2026-01-01T10:00', sender: 'Khalid', body: 'secret deal terms', media: false, role: 'client' }] });
    const now = Date.now();
    await requests.create('u', { requesterNames: ['Khalid'], requestedAt: now, windowEndsAt: now + 10 * 86_400_000 });

    const out = await svc.extractNote('u', note.id, '2026-02-01');
    expect(bodies()).toBe(''); // no model call — nothing to send
    expect(out.status).toBe('extracted'); // the note is marked done (empty), not stuck
  });

  it('with the window lifted (request withdrawn), the same note DOES reach the model', async () => {
    const { notes, requests, client, svc, bodies } = await setup();
    const note = await notes.create('u', { clientId: client.id, source: 'whatsapp_export', audioKey: null, status: 'pending_extraction',
      rawText: 'Khalid: my budget is five million',
      messages: [{ sentAt: '2026-01-01T10:00', sender: 'Khalid', body: 'my budget is five million', media: false, role: 'client' }] });
    const now = Date.now();
    const req = await requests.create('u', { requesterNames: ['Khalid'], requestedAt: now, windowEndsAt: now + 10 * 86_400_000 });
    await requests.setStatus('u', req.id, 'withdrawn'); // lifted

    await svc.extractNote('u', note.id, '2026-02-01');
    expect(bodies()).toContain('five million'); // no longer restricted
  });
});
