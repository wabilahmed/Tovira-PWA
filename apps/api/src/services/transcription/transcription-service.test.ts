import { describe, it, expect, beforeEach } from 'vitest';
import { TranscriptionService } from './transcription-service.js';
import { InMemoryNoteRepository } from '../../adapters/notes/in-memory-note-repository.js';
import { InMemoryStorage } from '../../adapters/storage/in-memory.js';
import type { Transcriber } from '../../ports/transcriber.js';

async function seedVoiceNote() {
  const notes = new InMemoryNoteRepository();
  const storage = new InMemoryStorage();
  await storage.put('k1', new Uint8Array([1, 2, 3]));
  const note = await notes.create('user-A', {
    clientId: 'c1',
    source: 'voice',
    rawText: null,
    audioKey: 'k1',
    status: 'pending_transcription',
  });
  return { notes, storage, note };
}

describe('TranscriptionService', () => {
  let ctx: Awaited<ReturnType<typeof seedVoiceNote>>;
  beforeEach(async () => {
    ctx = await seedVoiceNote();
  });

  it('stores the transcript and queues the note for extraction on success', async () => {
    const t: Transcriber = { transcribe: async () => ({ text: 'revised quote by Friday', quality: 'ok' }) };
    const out = await new TranscriptionService(t, ctx.notes, ctx.storage).transcribeNote('user-A', ctx.note.id);
    expect(out.status).toBe('pending_extraction');
    const updated = await ctx.notes.findByIdForUser('user-A', ctx.note.id);
    expect(updated?.rawText).toBe('revised quote by Friday');
  });

  // NEGATIVE: API error/timeout → note kept pending + retryable, never dropped.
  it('leaves the note pending for retry when the transcription API errors', async () => {
    const t: Transcriber = { transcribe: async () => { throw new Error('timeout'); } };
    const out = await new TranscriptionService(t, ctx.notes, ctx.storage).transcribeNote('user-A', ctx.note.id);
    expect(out.status).toBe('pending_transcription');
    expect(out.retry).toBe(true);
    const updated = await ctx.notes.findByIdForUser('user-A', ctx.note.id);
    expect(updated).not.toBeNull(); // not lost
    expect(updated?.rawText).toBeNull(); // no partial transcript written
  });

  // NEGATIVE: silent/empty audio → empty transcript handled, note flagged.
  it('flags the note for review on an empty transcript (no crash)', async () => {
    const t: Transcriber = { transcribe: async () => ({ text: '   ' }) };
    const out = await new TranscriptionService(t, ctx.notes, ctx.storage).transcribeNote('user-A', ctx.note.id);
    expect(out.status).toBe('needs_review');
    const updated = await ctx.notes.findByIdForUser('user-A', ctx.note.id);
    expect(updated).not.toBeNull();
  });

  // NEGATIVE: very noisy → low-quality transcript still stored AND flagged.
  it('stores a low-quality transcript but flags it (not silently discarded)', async () => {
    const t: Transcriber = { transcribe: async () => ({ text: 'mumbled something', quality: 'low' }) };
    const out = await new TranscriptionService(t, ctx.notes, ctx.storage).transcribeNote('user-A', ctx.note.id);
    expect(out.status).toBe('needs_review');
    const updated = await ctx.notes.findByIdForUser('user-A', ctx.note.id);
    expect(updated?.rawText).toBe('mumbled something'); // stored, not discarded
  });
});
