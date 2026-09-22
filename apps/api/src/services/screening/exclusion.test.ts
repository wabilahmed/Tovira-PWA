import { describe, it, expect } from 'vitest';
import { ExtractionService } from '../extraction/extraction-service.js';
import { modelSafeText } from '../import/dedup.js';
import { InMemoryClientRepository } from '../../adapters/clients/in-memory-client-repository.js';
import { InMemoryNoteRepository } from '../../adapters/notes/in-memory-note-repository.js';
import { InMemoryFactsRepository } from '../../adapters/facts/in-memory-facts-repository.js';
import { InMemoryExtractionLogRepository } from '../../adapters/logs/in-memory-extraction-log-repository.js';
import { renderThread } from '../import/dedup.js';
import type { ModelClient } from '../../ports/model.js';
import type { Embedder } from '../../ports/embedder.js';
import type { ImportedMessage } from '../../ports/note-repository.js';

/**
 * [SCREEN] Task 3 — exclusion by default. A flagged message is HELD from every model send but stays
 * STORED. These tests assert on the ACTUAL payload sent to the model (and to the embedder), never on
 * intent: the flagged body must not appear in either.
 */
const HEALTH = 'he is in hospital after surgery';
const CLEAN_A = 'can you send the floor plan for unit 12';
const CLEAN_B = 'the price is 2.4m, ready to proceed';

function msgs(): ImportedMessage[] {
  return [
    { sentAt: '2026-01-01T10:00:00', sender: 'Client', body: CLEAN_A, media: false, role: 'client' },
    { sentAt: '2026-01-01T10:01:00', sender: 'Client', body: HEALTH, media: false, role: 'client', excluded: true, sensitive: [{ category: 'health', span: 'hospital', index: 9 }] },
    { sentAt: '2026-01-01T10:02:00', sender: 'Me', body: CLEAN_B, media: false, role: 'rep' },
  ];
}

const VALID = JSON.stringify({ summary: 's', promises: [], people: [], personal_facts: [], key_dates: [], concerns: [], next_steps: [], meeting: null });

/** A model that records the exact user message it was asked to complete. */
function capturingModel(): { client: ModelClient; seenText: () => string } {
  let seen = '';
  return { client: { complete: async (req) => { seen = String(req.messages[req.messages.length - 1]!.content); return { text: VALID }; } }, seenText: () => seen };
}

/** An embedder that records the exact text it was asked to embed. */
function capturingEmbedder(): { embedder: Embedder; seen: () => string[] } {
  const seen: string[] = [];
  return { embedder: { dimension: 8, embed: async (t: string) => { seen.push(t); return new Array(8).fill(0); } }, seen: () => seen };
}

async function seedNote(notes: InMemoryNoteRepository, clients: InMemoryClientRepository, messages: ImportedMessage[]) {
  const c = await clients.create('u', 'Marina');
  return notes.create('u', { clientId: c.id, source: 'whatsapp_export', audioKey: null, status: 'pending_extraction', rawText: renderThread(messages), messages });
}

function makeService(model: ModelClient, embedder: Embedder, clients: InMemoryClientRepository, notes: InMemoryNoteRepository) {
  return new ExtractionService(model, clients, notes, new InMemoryFactsRepository(), embedder, new InMemoryExtractionLogRepository(), 'stub');
}

describe('[SCREEN] modelSafeText — the render-from-unexcluded function every send uses', () => {
  it('drops excluded messages, keeps the rest', () => {
    const t = modelSafeText({ messages: msgs(), rawText: renderThread(msgs()) });
    expect(t).toContain(CLEAN_A);
    expect(t).toContain(CLEAN_B);
    expect(t).not.toContain(HEALTH); // the flagged message is gone from the model-safe text
  });
  it('falls back to rawText when there is no message array (paste / voice / Ask — the rep\'s own words)', () => {
    expect(modelSafeText({ messages: null, rawText: 'my own pasted note' })).toBe('my own pasted note');
    expect(modelSafeText({ messages: [], rawText: 'voice transcript' })).toBe('voice transcript');
  });
});

describe('[SCREEN] extraction payload + embedding never receive a flagged message', () => {
  it('the flagged message is NOT in the extraction payload; the unflagged ones are', async () => {
    const clients = new InMemoryClientRepository(); const notes = new InMemoryNoteRepository();
    const cap = capturingModel(); const emb = capturingEmbedder();
    const note = await seedNote(notes, clients, msgs());
    await makeService(cap.client, emb.embedder, clients, notes).extractNote('u', note.id, '2026-01-02');
    expect(cap.seenText()).toContain(CLEAN_A);
    expect(cap.seenText()).toContain(CLEAN_B);
    expect(cap.seenText()).not.toContain(HEALTH); // proven on the real payload, not intent
  });

  it('the flagged message is NOT in the text sent to the embedder (Titan)', async () => {
    const clients = new InMemoryClientRepository(); const notes = new InMemoryNoteRepository();
    const cap = capturingModel(); const emb = capturingEmbedder();
    const note = await seedNote(notes, clients, msgs());
    await makeService(cap.client, emb.embedder, clients, notes).extractNote('u', note.id, '2026-01-02');
    const embedded = emb.seen().join('\n');
    expect(embedded).toContain(CLEAN_A);
    expect(embedded).not.toContain(HEALTH);
  });

  it('the flagged message stays STORED on the note (the rep\'s record + receipt source)', async () => {
    const clients = new InMemoryClientRepository(); const notes = new InMemoryNoteRepository();
    const cap = capturingModel(); const emb = capturingEmbedder();
    const note = await seedNote(notes, clients, msgs());
    await makeService(cap.client, emb.embedder, clients, notes).extractNote('u', note.id, '2026-01-02');
    const stored = await notes.findByIdForUser('u', note.id);
    expect(stored!.messages!.some((m) => m.body === HEALTH)).toBe(true); // still there
    expect(stored!.rawText).toContain(HEALTH); // still in the stored record
  });
});

describe('[SCREEN] a fully-clean note extracts normally; a restored message returns on the next pass', () => {
  it('a note with no flags sends the whole thread', async () => {
    const clients = new InMemoryClientRepository(); const notes = new InMemoryNoteRepository();
    const cap = capturingModel(); const emb = capturingEmbedder();
    const clean = msgs().map((m) => ({ ...m, excluded: false, sensitive: undefined }));
    const note = await seedNote(notes, clients, clean);
    await makeService(cap.client, emb.embedder, clients, notes).extractNote('u', note.id, '2026-01-02');
    expect(cap.seenText()).toContain(HEALTH); // nothing held → everything sent
  });

  it('restoring the flagged message (excluded=false) sends it on the next extraction', async () => {
    const clients = new InMemoryClientRepository(); const notes = new InMemoryNoteRepository();
    const cap = capturingModel(); const emb = capturingEmbedder();
    const note = await seedNote(notes, clients, msgs());
    const svc = makeService(cap.client, emb.embedder, clients, notes);
    await svc.extractNote('u', note.id, '2026-01-02');
    expect(cap.seenText()).not.toContain(HEALTH); // held first pass
    // rep restores it
    const restored = (await notes.findByIdForUser('u', note.id))!.messages!.map((m) => (m.body === HEALTH ? { ...m, excluded: false } : m));
    await notes.update('u', note.id, { messages: restored, status: 'pending_extraction' });
    await svc.extractNote('u', note.id, '2026-01-02');
    expect(cap.seenText()).toContain(HEALTH); // now sent
  });
});
