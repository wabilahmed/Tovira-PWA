import { describe, it, expect, vi } from 'vitest';
import { ExtractionService } from './extraction-service.js';
import { EXTRACTION_SYSTEM_PROMPT } from './prompt.js';
import { InMemoryClientRepository } from '../../adapters/clients/in-memory-client-repository.js';
import { InMemoryNoteRepository } from '../../adapters/notes/in-memory-note-repository.js';
import { InMemoryFactsRepository } from '../../adapters/facts/in-memory-facts-repository.js';
import { InMemoryExtractionLogRepository } from '../../adapters/logs/in-memory-extraction-log-repository.js';
import { StubEmbedder } from '../../adapters/embedding/stub.js';
import { renderThread } from '../import/dedup.js';
import type { ModelClient, ModelCompletionRequest } from '../../ports/model.js';
import type { ImportedMessage } from '../../ports/note-repository.js';

/**
 * [P81-1 · owner, 21 Nov] The chatter pre-filter runs in production, with the certified v0.9.7 prompt unchanged:
 * before an imported chat is split into pieces, media with no caption, deleted messages, stickers, system lines and
 * a lone ok / thanks / lol / emoji are left out of what the model reads. The chat is stored whole; the log line counts
 * what was left out. Measured on a real chat: 187 of 1,000 and 102 of 998 messages left out (10 pieces to 8 and 9).
 */
const U = 'u-pf';
const WIN = { enabled: true, threshold: 150, size: 120, overlap: 20, concurrency: 1 };
const at = (i: number) => `2026-03-${String(1 + Math.floor(i / 40)).padStart(2, '0')}T${String(8 + (i % 10)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}`;
function chat(n: number, chatter = true): ImportedMessage[] {
  return Array.from({ length: n }, (_, i) => {
    const body = chatter && i % 5 === 4 ? 'ok' : chatter && i % 7 === 6 ? '<Media omitted>' : `general chat ${i}`;
    return { sender: i % 2 ? 'Wabil' : 'Khalid', role: i % 2 ? 'rep' : 'client', media: body === '<Media omitted>', sentAt: at(i), body } as ImportedMessage;
  });
}
const EMPTY = JSON.stringify({ summary: 's', promises: [], people: [], personal_facts: [], key_dates: [], concerns: [], next_steps: [], requirements: [], meeting: null });

async function run(messages: ImportedMessage[] | null, source: 'whatsapp_export' | 'paste' = 'whatsapp_export', rawText = 'x') {
  const clients = new InMemoryClientRepository(); const notes = new InMemoryNoteRepository();
  const seen: ModelCompletionRequest[] = [];
  const model: ModelClient = { complete: async (req) => { seen.push(req); return { text: EMPTY, usage: { inputTokens: 10, outputTokens: 5 } }; } };
  const svc = new ExtractionService(model, clients, notes, new InMemoryFactsRepository(), new StubEmbedder(8), new InMemoryExtractionLogRepository(), 'stub',
    undefined, undefined, undefined, '1h', undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, WIN);
  const client = await clients.create(U, 'Khalid');
  const note = await notes.create(U, { clientId: client.id, source, rawText, audioKey: null, status: 'pending_extraction', messages });
  const info = vi.spyOn(console, 'info').mockImplementation(() => {});
  await svc.extractNote(U, note.id, '2026-04-01');
  const lines = info.mock.calls.map((c) => String(c[0]));
  info.mockRestore();
  return { seen, lines, stored: (await notes.findByIdForUser(U, note.id))! };
}

describe('[P81-1] the pre-filter, in production with v0.9.7', () => {
  it('leaves chatter out of every piece, keeps the certified prompt, stores the chat whole, and logs the count', async () => {
    const msgs = chat(300);
    const chatter = msgs.filter((m) => m.body === 'ok' || m.body === '<Media omitted>').length;
    const r = await run(msgs);
    const sent = r.seen.map((q) => q.messages[0]!.content).join('\n');
    expect(r.seen.every((q) => q.system === EXTRACTION_SYSTEM_PROMPT)).toBe(true);
    expect(sent).not.toMatch(/: ok$/m);
    expect(sent).not.toContain('<Media omitted>');
    expect(r.lines.find((l) => l.startsWith('[prefilter]'))).toMatch(new RegExp(`removed ${chatter} of 300 message\\(s\\) \\(media \\d+, deleted 0, sticker 0, system 0, short reply \\d+\\)`));
    expect(r.stored.messages).toHaveLength(300);
  });
  it('the pieces are planned on what is left: 300 messages, 3 pieces; with the chatter out, 2', async () => {
    expect((await run(chat(300, false))).seen).toHaveLength(3);
    expect((await run(chat(300))).seen).toHaveLength(2);
  });
  it('a chat that drops to 150 or fewer messages is read in one pass, with the chatter out', async () => {
    const r = await run(chat(180));
    expect(r.seen).toHaveLength(1);
    expect(r.seen[0]!.messages[0]!.content).not.toMatch(/: ok$/m);
  });
  it('NEGATIVE: a chat with no chatter sends exactly what it sent before (the same rendered thread)', async () => {
    const msgs = chat(40, false);
    const r = await run(msgs);
    expect(r.seen).toHaveLength(1);
    expect(r.seen[0]!.messages[0]!.content).toContain(renderThread(msgs));
  });
  it('NEGATIVE: a pasted note (no message list) is untouched, and no count is logged', async () => {
    const r = await run(null, 'paste', 'ok\nthanks\nI will send the quote Friday');
    expect(r.seen[0]!.messages[0]!.content).toContain('ok\nthanks\nI will send the quote Friday');
    expect(r.lines.some((l) => l.startsWith('[prefilter]'))).toBe(false);
  });
  it('NEGATIVE: an "ok" with more words stays in ("ok, send it Friday")', async () => {
    const msgs = chat(40, false).map((m, i) => (i === 3 ? { ...m, body: 'ok, send it Friday' } : m));
    const r = await run(msgs);
    expect(r.seen[0]!.messages[0]!.content).toContain('ok, send it Friday');
  });
});
