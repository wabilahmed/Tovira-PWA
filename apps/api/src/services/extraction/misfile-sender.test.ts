import { describe, it, expect } from 'vitest';
import { ExtractionService } from './extraction-service.js';
import { detectMisfilePostExtraction } from '../import/misfile.js';
import { InMemoryClientRepository } from '../../adapters/clients/in-memory-client-repository.js';
import { InMemoryNoteRepository } from '../../adapters/notes/in-memory-note-repository.js';
import { InMemoryFactsRepository } from '../../adapters/facts/in-memory-facts-repository.js';
import { InMemoryExtractionLogRepository } from '../../adapters/logs/in-memory-extraction-log-repository.js';
import { StubEmbedder } from '../../adapters/embedding/stub.js';
import type { ModelClient } from '../../ports/model.js';

/**
 * [P21-D / BOOK-08] A chat filed under "QA P14 Gate Client" whose ONLY non-rep sender is another existing
 * client, "QA Enter Key Client", must be suggested for a move. Two defects let it through: the sender was
 * never a signal (only extracted people were, and the counterpart is not a "person"), and the names share
 * the words "QA" / "Client" — generic across this rep's book — which counted as overlap with Gate Client.
 */
const EXTRACTION = JSON.stringify({ summary: 'Asked about the key handover.', promises: [], people: [], personal_facts: [], key_dates: [], concerns: [], next_steps: [], meeting: null });
const model = (text: string): ModelClient => ({ complete: async () => ({ text }) });

async function setup() {
  const clients = new InMemoryClientRepository();
  const notes = new InMemoryNoteRepository();
  const gate = await clients.create('u', 'QA P14 Gate Client');
  const enter = await clients.create('u', 'QA Enter Key Client');
  await clients.create('u', 'QA Sara Khan');
  const svc = new ExtractionService(model(EXTRACTION), clients, notes, new InMemoryFactsRepository(), new StubEmbedder(8), new InMemoryExtractionLogRepository(), 'stub');
  return { clients, notes, gate, enter, svc };
}

describe('[P21-D / BOOK-08] misfile by sender', () => {
  it('a Gate Client chat whose only non-rep sender is QA Enter Key Client → suggest moving to Enter Key Client', async () => {
    const { notes, gate, enter, svc } = await setup();
    const n = await notes.create('u', {
      clientId: gate.id, source: 'whatsapp_export', rawText: 'thread', audioKey: null, status: 'pending_extraction',
      messages: [
        { sender: 'Wabil', sentAt: '2026-04-02T10:00:00', body: 'Hi, when can you collect the keys?', media: false, role: 'rep' },
        { sender: 'QA Enter Key Client', sentAt: '2026-04-02T10:05:00', body: 'Tomorrow morning works', media: false, role: 'client' },
      ],
    });
    await svc.extractNote('u', n.id, '2026-10-18');
    const stored = await notes.findByIdForUser('u', n.id);
    expect(stored?.moveSuggestion?.toClientId).toBe(enter.id);
    expect(stored?.moveSuggestion?.toClientName).toBe('QA Enter Key Client');
  });

  it('NEGATIVE: a chat whose non-rep sender IS the filed client gets no suggestion', async () => {
    const { notes, gate, svc } = await setup();
    const n = await notes.create('u', {
      clientId: gate.id, source: 'whatsapp_export', rawText: 'thread', audioKey: null, status: 'pending_extraction',
      messages: [
        { sender: 'Wabil', sentAt: '2026-04-02T10:00:00', body: 'Hi', media: false, role: 'rep' },
        { sender: 'QA P14 Gate Client', sentAt: '2026-04-02T10:05:00', body: 'Hello', media: false, role: 'client' },
      ],
    });
    await svc.extractNote('u', n.id, '2026-10-18');
    expect((await notes.findByIdForUser('u', n.id))?.moveSuggestion ?? null).toBeNull();
  });

  it('NEGATIVE: the rep\'s own messages are never a misfile signal', async () => {
    const { notes, gate, svc, clients } = await setup();
    await clients.create('u', 'Wabil Trading'); // a client that happens to share the rep's name
    const n = await notes.create('u', {
      clientId: gate.id, source: 'whatsapp_export', rawText: 'thread', audioKey: null, status: 'pending_extraction',
      messages: [
        { sender: 'Wabil', sentAt: '2026-04-02T10:00:00', body: 'Hi', media: false, role: 'rep' },
        { sender: 'QA P14 Gate Client', sentAt: '2026-04-02T10:05:00', body: 'Hello', media: false, role: 'client' },
      ],
    });
    await svc.extractNote('u', n.id, '2026-10-18');
    expect((await notes.findByIdForUser('u', n.id))?.moveSuggestion ?? null).toBeNull();
  });

  it('words shared across the book ("QA", "Client") are not overlap; a distinctive shared word still is', () => {
    const others = [{ id: 'enter', name: 'QA Enter Key Client', people: [] }, { id: 'sara', name: 'QA Sara Khan', people: [] }];
    const r = detectMisfilePostExtraction({ notePeople: ['QA Enter Key Client'], filedClient: { id: 'gate', name: 'QA P14 Gate Client' }, filedClientOtherPeople: [], others });
    expect(r.status).toBe('suggest_move');
    // NEGATIVE: "Gate" is distinctive — a mention of "Gate" is overlap with the filed client.
    expect(detectMisfilePostExtraction({ notePeople: ['Gate', 'Sara'], filedClient: { id: 'gate', name: 'QA P14 Gate Client' }, filedClientOtherPeople: [], others }).status).toBe('ok');
  });
});

describe('[P21-D / BOOK-08] import-time check (no file-name title)', () => {
  const msgs = (sender: string) => [
    { sender: 'Wabil', sentAt: '2026-04-02T10:00:00', body: 'Hi', media: false, role: 'unknown' as const },
    { sender, sentAt: '2026-04-02T10:05:00', body: 'Hello', media: false, role: 'unknown' as const },
  ];
  const others = [{ id: 'enter', name: 'QA Enter Key Client', phone: null, knownPeople: [] as string[] }, { id: 'sara', name: 'QA Sara Khan', phone: null, knownPeople: [] as string[] }];

  it('a chat with QA Enter Key Client selected as QA P14 Gate Client is a mismatch, suggesting Enter Key Client', async () => {
    const { detectMisfileAtImport } = await import('../import/misfile.js');
    const r = detectMisfileAtImport({ messages: msgs('QA Enter Key Client'), selected: { id: 'gate', name: 'QA P14 Gate Client', phone: null }, knownPeople: [], others, repName: 'Wabil' });
    expect(r.status).toBe('mismatch');
    expect(r.status === 'mismatch' && r.suggestion?.id).toBe('enter');
  });

  it('NEGATIVE: the right client is still ok (and a distinctive word still matches)', async () => {
    const { detectMisfileAtImport } = await import('../import/misfile.js');
    expect(detectMisfileAtImport({ messages: msgs('QA P14 Gate Client'), selected: { id: 'gate', name: 'QA P14 Gate Client', phone: null }, knownPeople: [], others, repName: 'Wabil' }).status).toBe('ok');
    expect(detectMisfileAtImport({ messages: msgs('Gate'), selected: { id: 'gate', name: 'QA P14 Gate Client', phone: null }, knownPeople: [], others, repName: 'Wabil' }).status).toBe('ok');
  });
});
