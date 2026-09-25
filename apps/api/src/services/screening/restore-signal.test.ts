import { describe, it, expect, vi } from 'vitest';
import { InMemorySensitiveFlagStatsRepository } from '../../adapters/screening/in-memory-sensitive-flag-stats-repository.js';
import { FlagReviewService } from './flag-review-service.js';
import { InMemoryClientRepository } from '../../adapters/clients/in-memory-client-repository.js';
import { InMemoryNoteRepository } from '../../adapters/notes/in-memory-note-repository.js';
import { renderThread } from '../import/dedup.js';
import type { ImportedMessage } from '../../ports/note-repository.js';

/**
 * [SCREEN-REVIEW · RESTORE-SIGNAL] When a rep restores a flagged message that is a labelled false positive
 * from the person best placed to judge it. We capture the SIGNAL, never the content: which category and
 * matched span fired, and that it was restored. The two guards below are load-bearing and mutation-proven.
 */
describe('[RESTORE-SIGNAL] the record holds no content and no identifiers', () => {
  it('a restore record is EXACTLY {category, span, restored} — no message text, name, note or client ref', async () => {
    const s = new InMemorySensitiveFlagStatsRepository();
    await s.recordRestore('political_opinion', 'party');
    const rows = await s.list();
    expect(rows).toEqual([{ category: 'political_opinion', span: 'party', restored: 1 }]);
    // Structural guard: the only keys are category/span/restored. A body/user/note/client field would fail.
    expect(Object.keys(rows[0]!).sort()).toEqual(['category', 'restored', 'span']);
  });
});

describe('[RESTORE-SIGNAL] the signal is aggregate, not attributable to a rep or their book', () => {
  it('restores of the same flag merge into ONE counter — the store takes no userId, so it cannot segregate', async () => {
    const s = new InMemorySensitiveFlagStatsRepository();
    // Two different reps restoring "party" — the store has no way to tell them apart, by design.
    await s.recordRestore('political_opinion', 'party');
    await s.recordRestore('political_opinion', 'party');
    const rows = await s.list();
    expect(rows).toEqual([{ category: 'political_opinion', span: 'party', restored: 2 }]); // one merged row
  });

  it('the service emits the signal with NO identifier — exactly (category, span)', async () => {
    const clients = new InMemoryClientRepository();
    const notes = new InMemoryNoteRepository();
    const c = await clients.create('u', 'Marina');
    const messages: ImportedMessage[] = [
      { sentAt: 't', sender: 'Client', body: 'the party is on Friday', media: false, role: 'client', excluded: true, sensitive: [{ category: 'political_opinion', span: 'party', index: 4 }] },
    ];
    const note = await notes.create('u', { clientId: c.id, source: 'whatsapp_export', audioKey: null, status: 'extracted', rawText: renderThread(messages), messages });
    const record = vi.fn(async (_category: string, _span: string) => {});
    await new FlagReviewService(notes, { record }).restore('u', note.id, { category: 'political_opinion', span: 'party' });
    expect(record).toHaveBeenCalledWith('political_opinion', 'party');
    // No third argument (no userId / noteId / clientId ever reaches the sink).
    expect(record.mock.calls.every((call) => call.length === 2)).toBe(true);
  });
});
