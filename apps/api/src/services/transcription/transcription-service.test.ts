import { describe, it, expect, beforeEach } from 'vitest';
import { TranscriptionService, TRANSCRIPTION_FAILED_STATUS, TRANSCRIBE_MAX_MISSING_ATTEMPTS } from './transcription-service.js';
import { InMemoryNoteRepository } from '../../adapters/notes/in-memory-note-repository.js';
import { InMemoryStorage } from '../../adapters/storage/in-memory.js';
import type { Storage } from '../../ports/storage.js';
import type { Transcriber } from '../../ports/transcriber.js';

const OK: Transcriber = { transcribe: async () => ({ text: 'hello', quality: 'ok' }) };

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

  // [AUDIO-RETENTION] The retention clock starts on SUCCESSFUL transcription, never on upload. A
  // transcribed note carries transcribed_at; a failed/pending one must not (its recording is kept).
  it('stamps transcribedAt on successful transcription (the retention clock)', async () => {
    const CLOCK = 1_700_000_000_000;
    const t: Transcriber = { transcribe: async () => ({ text: 'revised quote by Friday', quality: 'ok' }) };
    await new TranscriptionService(t, ctx.notes, ctx.storage, () => CLOCK).transcribeNote('user-A', ctx.note.id);
    expect((await ctx.notes.findByIdForUser('user-A', ctx.note.id))?.transcribedAt).toBe(CLOCK);
  });

  // A low-quality transcript that STILL HAS CONTENT is a usable (if imperfect) note — the clock starts.
  // ("needs_review" from low quality is text-intact; only the EMPTY kind produced nothing usable.)
  it('stamps transcribedAt for a low-quality transcript that has real content', async () => {
    const CLOCK = 1_700_000_000_001;
    const t: Transcriber = { transcribe: async () => ({ text: 'mumbled something about the revised quote', quality: 'low' }) };
    await new TranscriptionService(t, ctx.notes, ctx.storage, () => CLOCK).transcribeNote('user-A', ctx.note.id);
    expect((await ctx.notes.findByIdForUser('user-A', ctx.note.id))?.transcribedAt).toBe(CLOCK);
  });

  // NEGATIVE (the product's trust rule): an EMPTY transcript produced nothing usable — the recording is
  // the only copy of the capture, so it is KEPT like transcription_failed. The note is still flagged for
  // review, but NO retention clock starts.
  it('does NOT stamp transcribedAt for an empty transcript (recording kept, like transcription_failed)', async () => {
    const t: Transcriber = { transcribe: async () => ({ text: '   ' }) };
    await new TranscriptionService(t, ctx.notes, ctx.storage, () => 999).transcribeNote('user-A', ctx.note.id);
    const updated = await ctx.notes.findByIdForUser('user-A', ctx.note.id);
    expect(updated?.status).toBe('needs_review'); // still surfaced for the rep
    expect(updated?.transcribedAt == null).toBe(true); // but NO clock — the recording stays
  });

  // NEGATIVE: a NEAR-EMPTY transcript (a stray token out of silence/noise) is also nothing usable → kept.
  it('does NOT stamp transcribedAt for a near-empty transcript', async () => {
    const t: Transcriber = { transcribe: async () => ({ text: 'uh' }) };
    await new TranscriptionService(t, ctx.notes, ctx.storage, () => 888).transcribeNote('user-A', ctx.note.id);
    expect((await ctx.notes.findByIdForUser('user-A', ctx.note.id))?.transcribedAt == null).toBe(true);
  });

  // NEGATIVE: a transcription API error leaves the note pending — NO clock (the recording is kept).
  it('does NOT stamp transcribedAt when transcription errors (clock stays null)', async () => {
    const t: Transcriber = { transcribe: async () => { throw new Error('timeout'); } };
    await new TranscriptionService(t, ctx.notes, ctx.storage, () => 123).transcribeNote('user-A', ctx.note.id);
    const updated = await ctx.notes.findByIdForUser('user-A', ctx.note.id);
    expect(updated?.transcribedAt == null).toBe(true);
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

  // [TRANSCRIBE-MISSING] A recording that cannot be found must FAIL TERMINALLY after a bounded number
  // of confirmed-absent attempts, with a distinct status — not retry until the generic needs_review.
  describe('a permanently missing recording', () => {
    const missingNote = async () => {
      const notes = new InMemoryNoteRepository();
      const storage = new InMemoryStorage(); // 'gone' is never put → get throws, exists()===false
      const note = await notes.create('user-A', { clientId: 'c1', source: 'voice', rawText: null, audioKey: 'gone', status: 'pending_transcription' });
      return { notes, storage, note };
    };

    it('keeps retrying while attempts are below the limit (confirmed absent, but give it a bounded chance)', async () => {
      const { notes, storage, note } = await missingNote();
      await notes.update('user-A', note.id, { sweepAttempts: TRANSCRIBE_MAX_MISSING_ATTEMPTS - 1 });
      const out = await new TranscriptionService(OK, notes, storage).transcribeNote('user-A', note.id);
      expect(out).toEqual({ status: 'pending_transcription', retry: true });
      expect((await notes.findByIdForUser('user-A', note.id))?.status).toBe('pending_transcription'); // not terminal yet
    });

    it('fails terminally with a distinct status once the confirmed-absent attempt limit is reached', async () => {
      const { notes, storage, note } = await missingNote();
      await notes.update('user-A', note.id, { sweepAttempts: TRANSCRIBE_MAX_MISSING_ATTEMPTS });
      const out = await new TranscriptionService(OK, notes, storage).transcribeNote('user-A', note.id);
      expect(out.status).toBe(TRANSCRIPTION_FAILED_STATUS);
      expect((await notes.findByIdForUser('user-A', note.id))?.status).toBe(TRANSCRIPTION_FAILED_STATUS); // terminal
    });

    it('does NOT fail terminally on a transient fetch error it cannot confirm (exists() throws) — only confirmed absence is terminal', async () => {
      const { notes, note } = await missingNote();
      await notes.update('user-A', note.id, { sweepAttempts: TRANSCRIBE_MAX_MISSING_ATTEMPTS + 10 });
      const flaky: Storage = { put: async () => {}, get: async () => { throw new Error('network'); }, exists: async () => { throw new Error('network'); }, delete: async () => {}, list: async () => [] };
      const out = await new TranscriptionService(OK, notes, flaky).transcribeNote('user-A', note.id);
      expect(out).toEqual({ status: 'pending_transcription', retry: true }); // transient → retry, never terminal
    });
  });
});
