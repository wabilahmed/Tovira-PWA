import { describe, it, expect } from 'vitest';
import { captureField, captureSummary } from './explicit-statement.js';
import { AskCaptureService } from './ask-capture-service.js';
import { InMemoryClientRepository } from '../../adapters/clients/in-memory-client-repository.js';
import { InMemoryNoteRepository } from '../../adapters/notes/in-memory-note-repository.js';
import { InMemoryFactsRepository } from '../../adapters/facts/in-memory-facts-repository.js';
import { StubEmbedder } from '../../adapters/embedding/stub.js';

/**
 * [P39-6] To Confirm asks "Did Sara Khan's budget change to AED 2.2M?" — so the held capture carries the field
 * and the value it sets, read from the rep's own words (deterministic, no model). No known field → null (the card
 * then asks about the note as a whole). The summary is unchanged.
 */
describe('[P39-6] captureField', () => {
  it.each([
    ["Remember that Sara's budget is now 2.2M", { field: 'budget', value: '2.2M' }],
    ['Update: budget to AED 3.4M', { field: 'budget', value: 'AED 3.4M' }],
    ["Note that Omar's email is omar@example.com", { field: 'email', value: 'omar@example.com' }],
  ])('%s → %j', (statement, want) => {
    expect(captureField(statement)).toEqual(want);
  });

  it('negative: no known field, or no value → null', () => {
    expect(captureField('Remember that Sara loves the sea view')).toBeNull();
    expect(captureField('Remember the budget')).toBeNull();
  });

  it('the summary is unchanged', () => {
    expect(captureSummary("Remember that Sara's budget is now 2.2M", 'QA Sara Khan')).toBe("Sara's budget → 2.2M");
  });
});

describe('[P39-6] the pending queue carries field + value', () => {
  it('a budget statement → field "budget", value "2.2M"; a plain note → neither', async () => {
    const clients = new InMemoryClientRepository();
    const notes = new InMemoryNoteRepository();
    const extraction = { extractNote: async () => undefined } as never; // the hold path only — no model
    const capture = new AskCaptureService({ notes, clients, facts: new InMemoryFactsRepository(), embedder: new StubEmbedder(8), extraction, now: () => 1_000_000, ttlMs: 14 * 86_400_000 });
    const c = await clients.create('u', 'QA Sara Khan');
    await capture.capture('u', c.id, "Remember that Sara's budget is now 2.2M", '2026-10-21');
    await capture.capture('u', c.id, 'Remember that Sara loves the sea view', '2026-10-21');
    const queue = await capture.listPending('u');
    const byStatement = new Map(queue.map((q) => [q.statement, q]));
    expect(byStatement.get("Remember that Sara's budget is now 2.2M")).toMatchObject({ field: 'budget', value: '2.2M' });
    expect(byStatement.get('Remember that Sara loves the sea view')).not.toHaveProperty('field');
  });
});
