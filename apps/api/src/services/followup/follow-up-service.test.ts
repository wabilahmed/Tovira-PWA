import { describe, it, expect } from 'vitest';
import { FollowUpService } from './follow-up-service.js';
import { InMemoryNoteRepository } from '../../adapters/notes/in-memory-note-repository.js';
import type { ModelClient, ModelCompletionRequest } from '../../ports/model.js';

describe('FollowUpService', () => {
  it('drafts a follow-up grounded on the note\'s real commitments', async () => {
    let captured: ModelCompletionRequest | null = null;
    const model: ModelClient = {
      complete: async (req) => {
        captured = req;
        return { text: 'Hi Sarah, great chatting — I’ll send the revised quote by Friday. Best!' };
      },
    };
    const notes = new InMemoryNoteRepository();
    const note = await notes.create('u', { clientId: 'c', source: 'voice', rawText: 'met Sarah, agreed to send quote Friday', audioKey: null, status: 'extracted' });
    await notes.update('u', note.id, {
      extracted: { summary: '', promises: [{ text: 'send the revised quote', owner: 'rep', due_date: null, due_raw: 'Friday', confidence: 'high' }], people: [], personal_facts: [], key_dates: [], concerns: [], next_steps: [], meeting: null },
    });

    const result = await new FollowUpService(model, notes).draft('u', note.id);
    expect(result?.draft).toContain('revised quote');
    // The model was grounded on the real commitment (so it can't invent others).
    expect(captured!.messages[0]!.content).toContain('send the revised quote');
  });

  it('returns null for a missing/foreign note (never a fabricated draft)', async () => {
    const notes = new InMemoryNoteRepository();
    const note = await notes.create('u', { clientId: 'c', source: 'voice', rawText: 'x', audioKey: null, status: 'extracted' });
    const svc = new FollowUpService({ complete: async () => ({ text: 'draft' }) }, notes);
    expect(await svc.draft('other-user', note.id)).toBeNull();
    expect(await svc.draft('u', 'nope')).toBeNull();
  });
});
