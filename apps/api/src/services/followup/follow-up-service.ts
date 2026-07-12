import type { ModelClient } from '../../ports/model.js';
import type { NoteRepository } from '../../ports/note-repository.js';
import { extractedOf } from '../insights/insights.js';

const SYSTEM = `You draft a short, warm follow-up message a salesperson can send after a conversation, in their own voice. Base it ONLY on what is in the note and the listed commitments. Reference what was discussed and any next step the rep actually promised. Do NOT invent commitments, dates, or details the rep did not state. Output only the message text — no preamble.`;

/**
 * Turn a note into an editable follow-up draft (P4-4). Grounded on the note's
 * real promises/next steps so it never states commitments the rep didn't make.
 * This ONLY drafts — it never sends; sending is an explicit action in the client.
 */
export class FollowUpService {
  constructor(
    private readonly model: ModelClient,
    private readonly notes: NoteRepository,
  ) {}

  async draft(userId: string, noteId: string): Promise<{ draft: string } | null> {
    const note = await this.notes.findByIdForUser(userId, noteId);
    if (!note || !note.rawText || !note.rawText.trim()) return null;

    const facts = extractedOf(note.extracted);
    const commitments = facts.promises.map((p) => `- ${p.owner === 'rep' ? 'I' : 'They'} will ${p.text}${p.due_raw ? ` (${p.due_raw})` : ''}`).join('\n');
    const nextSteps = facts.next_steps.map((s) => `- ${s}`).join('\n');

    const input = [
      `NOTE:\n${note.rawText}`,
      commitments ? `COMMITMENTS (the only promises to reference):\n${commitments}` : 'COMMITMENTS: none',
      nextSteps ? `NEXT STEPS:\n${nextSteps}` : '',
    ].filter(Boolean).join('\n\n');

    const res = await this.model.complete({ system: SYSTEM, messages: [{ role: 'user', content: input }], maxTokens: 512 });
    return { draft: res.text };
  }
}
