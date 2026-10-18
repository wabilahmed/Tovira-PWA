import { describe, it, expect } from 'vitest';
import { correctPromiseOwners } from './owner-check.js';
import { extractForEval } from '../../eval/gate.js';
import { EVAL_NOTES } from '../../eval/eval-set.js';
import type { Extraction, ExtractedPromise } from './types.js';
import type { ImportedMessage } from '../../ports/note-repository.js';
import type { ModelClient } from '../../ports/model.js';

/**
 * [P25-1] Write-time OWNER check: the most common "fabricated" promise is an owner flip — the rep's
 * "I'll confirm the PO Friday" saved as the client's. After extraction, a promise whose receipt points
 * UNIQUELY at a first-person commitment takes the owner of whoever sent that message (the rep's own
 * voice/paste notes → rep). It only corrects owner — never creates, deletes or rewrites a promise.
 */
const ex = (promises: ExtractedPromise[]): Extraction => ({ summary: '', promises, people: [], personal_facts: [], key_dates: [], concerns: [], next_steps: [], requirements: [], meeting: null });
const p = (text: string, owner: 'rep' | 'client', span: string | null, at: string | null = null): ExtractedPromise => ({ text, owner, due_date: null, due_raw: null, confidence: 'high', source_span: span, source_message_at: at });
const m = (role: ImportedMessage['role'], sentAt: string, body: string, sender = role === 'rep' ? 'Wabil' : 'Omar'): ImportedMessage => ({ sender, sentAt, body, media: false, role });

describe('[P25-1] owner check', () => {
  it('redact-fp-guard: the rep\'s pasted "…I\'ll confirm the PO Friday" saved as client → rep', () => {
    const note = "Ordered 100000 units at AED 45000, ref [REDACTED], call me on [REDACTED]. I'll confirm the PO Friday.";
    const x = ex([p('Confirm the PO', 'client', "I'll confirm the PO Friday")]);
    const fixes = correctPromiseOwners(x, { source: 'paste', text: note });
    expect(x.promises[0]!.owner).toBe('rep');
    expect(fixes).toEqual([{ index: 0, from: 'client', to: 'rep', rule: 'first_person_rep_note' }]);
  });

  it('a chat: the rep\'s message → rep; the client\'s "I\'ll send the cheque tomorrow" stays client', () => {
    const messages = [m('rep', '2026-03-02T10:20', "I'll confirm the PO Friday"), m('client', '2026-03-02T10:25', "I'll send the cheque tomorrow")];
    const x = ex([p('Confirm the PO', 'client', "I'll confirm the PO Friday", '2026-03-02T10:20'), p('Send the cheque', 'client', "I'll send the cheque tomorrow", '2026-03-02T10:25')]);
    const fixes = correctPromiseOwners(x, { source: 'whatsapp_export', messages });
    expect(x.promises.map((q) => q.owner)).toEqual(['rep', 'client']);
    expect(fixes).toEqual([{ index: 0, from: 'client', to: 'rep', rule: 'first_person_sender_rep' }]);
  });

  it('a client\'s first-person promise wrongly saved as the rep\'s → client', () => {
    const x = ex([p('Send the cheque', 'rep', "I'll send the cheque tomorrow", '2026-03-02T10:25')]);
    correctPromiseOwners(x, { source: 'whatsapp_export', messages: [m('rep', '2026-03-02T10:20', 'ok'), m('client', '2026-03-02T10:25', "I'll send the cheque tomorrow")] });
    expect(x.promises[0]!.owner).toBe('client');
  });

  it('NEGATIVE: a third party ("Fatima will approve", "my brother will call") is left alone', () => {
    const x = ex([p('Fatima approves', 'client', 'Fatima will approve it next week'), p('Brother calls', 'rep', 'my brother will call you')]);
    expect(correctPromiseOwners(x, { source: 'paste', text: 'Fatima will approve it next week. my brother will call you' })).toEqual([]);
    expect(x.promises.map((q) => q.owner)).toEqual(['client', 'rep']);
  });

  it('Arabic first-person promises (سأ…, سوف, راح, بأ…, خليني) take the sender', () => {
    const messages = [
      m('rep', '2026-04-01T09:00', 'سأرسل لك العرض غداً'),
      m('rep', '2026-04-01T09:05', 'سوف أتصل بالمطور'),
      m('rep', '2026-04-01T09:10', 'راح أرسل الخيارات'),
      m('rep', '2026-04-01T09:15', 'بأرسل لك الصور'),
      m('rep', '2026-04-01T09:20', 'خليني أتأكد من السعر'),
    ];
    const x = ex(messages.map((mm) => p('promise', 'client', mm.body, mm.sentAt)));
    const fixes = correctPromiseOwners(x, { source: 'whatsapp_export', messages });
    expect(x.promises.every((q) => q.owner === 'rep')).toBe(true);
    expect(fixes).toHaveLength(5);
  });

  it('NEGATIVE: a receipt that matches no message, or more than one, changes nothing', () => {
    const messages = [m('rep', '2026-03-02T10:20', "I'll send it"), m('client', '2026-03-03T11:00', "I'll send it")];
    const none = ex([p('Send it', 'client', "I'll send the contract", null)]);
    const twice = ex([p('Send it', 'client', "I'll send it", null)]); // two messages carry this span, no time to tell them apart
    expect(correctPromiseOwners(none, { source: 'whatsapp_export', messages })).toEqual([]);
    expect(correctPromiseOwners(twice, { source: 'whatsapp_export', messages })).toEqual([]);
    expect(twice.promises[0]!.owner).toBe('client');
    // …but the message time disambiguates when it is there
    const timed = ex([p('Send it', 'client', "I'll send it", '2026-03-02T10:20')]);
    correctPromiseOwners(timed, { source: 'whatsapp_export', messages });
    expect(timed.promises[0]!.owner).toBe('rep');
    // a paste whose span appears twice is not unique either
    const pasted = ex([p('Send it', 'client', "I'll send it")]);
    expect(correctPromiseOwners(pasted, { source: 'paste', text: "I'll send it. Later: I'll send it" })).toEqual([]);
  });

  it('NEGATIVE: a group chat with no identified rep changes nothing', () => {
    const messages = [m('unknown', '2026-03-02T10:20', "I'll confirm the PO Friday", 'Khalid'), m('unknown', '2026-03-02T10:21', 'ok', 'Sara')];
    const x = ex([p('Confirm the PO', 'client', "I'll confirm the PO Friday", '2026-03-02T10:20')]);
    expect(correctPromiseOwners(x, { source: 'whatsapp_export', messages })).toEqual([]);
    expect(x.promises[0]!.owner).toBe('client');
  });

  it('NEGATIVE: a promise with no receipt span is never touched; nothing is created, deleted or rewritten', () => {
    const x = ex([p('Confirm the PO', 'client', null), p('Send the deck', 'client', "I'll send the deck")]);
    const before = x.promises.map((q) => ({ ...q, owner: undefined }));
    correctPromiseOwners(x, { source: 'paste', text: "I'll send the deck" });
    expect(x.promises.map((q) => ({ ...q, owner: undefined }))).toEqual(before);
    expect(x.promises.map((q) => q.owner)).toEqual(['client', 'rep']);
  });
});

describe('[P25-1] the gate scores what ships', () => {
  it('extractForEval applies the owner check: a model that flips redact-fp-guard to client is scored as rep', async () => {
    const note = EVAL_NOTES.find((n) => n.id === 'redact-fp-guard')!;
    const model: ModelClient = { complete: async () => ({ text: JSON.stringify({ summary: 's', promises: [{ text: 'Confirm the PO', owner: 'client', due_date: '2026-09-04', due_raw: 'Friday', confidence: 'high', source_span: "I'll confirm the PO Friday", source_message_at: null }], people: [], personal_facts: [], key_dates: [], concerns: [], next_steps: [], requirements: [], meeting: null }) }) };
    const out = await extractForEval(model, note);
    expect(out!.promises[0]!.owner).toBe('rep');
  });
});

describe('[P25-1] in the shipped extraction (extractNote)', () => {
  it('the saved promise carries the corrected owner, and the log line names the rule — never the message text', async () => {
    const { ExtractionService } = await import('./extraction-service.js');
    const { InMemoryClientRepository } = await import('../../adapters/clients/in-memory-client-repository.js');
    const { InMemoryNoteRepository } = await import('../../adapters/notes/in-memory-note-repository.js');
    const { InMemoryFactsRepository } = await import('../../adapters/facts/in-memory-facts-repository.js');
    const { InMemoryExtractionLogRepository } = await import('../../adapters/logs/in-memory-extraction-log-repository.js');
    const { StubEmbedder } = await import('../../adapters/embedding/stub.js');
    const model: ModelClient = { complete: async () => ({ text: JSON.stringify({ summary: 's', promises: [{ text: 'Confirm the PO', owner: 'client', due_date: null, due_raw: 'Friday', confidence: 'high', source_span: "I'll confirm the PO Friday", source_message_at: null }], people: [], personal_facts: [], key_dates: [], concerns: [], next_steps: [], requirements: [], meeting: null }) }) };
    const clients = new InMemoryClientRepository(); const notes = new InMemoryNoteRepository(); const facts = new InMemoryFactsRepository();
    const svc = new ExtractionService(model, clients, notes, facts, new StubEmbedder(8), new InMemoryExtractionLogRepository(), 'stub');
    const c = await clients.create('u', 'Vertex Logistics');
    const n = await notes.create('u', { clientId: c.id, source: 'paste', rawText: "Ordered 100000 units. I'll confirm the PO Friday.", audioKey: null, status: 'pending_extraction' });
    const lines: string[] = [];
    const orig = console.info; console.info = (l: unknown) => { lines.push(String(l)); };
    try { await svc.extractNote('u', n.id, '2026-09-01'); } finally { console.info = orig; }
    expect((await facts.listPromisesByUser('u'))[0]!.owner).toBe('rep');
    const line = lines.find((l) => l.startsWith('[owner-check]'))!;
    expect(line).toMatch(new RegExp(`^\\[owner-check\\] note=${n.id} promise#0 client→rep rule=first_person_rep_note total=\\d+$`));
    expect(line).not.toMatch(/confirm|PO|Friday/i);
  });
});
