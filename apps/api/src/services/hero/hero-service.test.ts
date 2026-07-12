import { describe, it, expect } from 'vitest';
import { HeroService } from './hero-service.js';
import { InMemoryClientRepository } from '../../adapters/clients/in-memory-client-repository.js';
import { InMemoryFactsRepository } from '../../adapters/facts/in-memory-facts-repository.js';
import { InMemoryMeetingRepository } from '../../adapters/meetings/in-memory-meeting-repository.js';
import { InMemoryNoteRepository } from '../../adapters/notes/in-memory-note-repository.js';

const NOW = Date.parse('2026-07-09T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

function make(minClients: number, minNotes: number) {
  const clients = new InMemoryClientRepository();
  const facts = new InMemoryFactsRepository();
  const meetings = new InMemoryMeetingRepository();
  const notes = new InMemoryNoteRepository();
  const hero = new HeroService({ clients, facts, meetings, notes }, { minClients, minNotes }, 30);
  return { clients, facts, meetings, notes, hero };
}

async function coldClientNoDM(ctx: ReturnType<typeof make>, user: string, name: string) {
  const c = await ctx.clients.create(user, name);
  (c as { lastTouchedAt: number }).lastTouchedAt = NOW - 45 * DAY; // gone quiet
  const note = await ctx.notes.create(user, { clientId: c.id, source: 'voice', rawText: 'x', audioKey: null, status: 'extracted' });
  await ctx.notes.update(user, note.id, { extracted: { summary: '', promises: [], people: [{ name: 'Contact', role: null, reports_to: null, decision_role: 'unknown', notes: null }], personal_facts: [], key_dates: [], concerns: [], next_steps: [], meeting: null } });
  return c;
}

describe('[P4b-4] gating enforced server-side', () => {
  it('returns no patterns or risk below the threshold', async () => {
    const ctx = make(5, 20);
    await coldClientNoDM(ctx, 'u', 'A');
    await coldClientNoDM(ctx, 'u', 'B');
    expect(await ctx.hero.patterns('u', NOW)).toEqual([]);
    expect(await ctx.hero.risk('u', NOW)).toEqual([]);
    expect((await ctx.hero.status('u')).unlocked).toBe(false);
  });
});

describe('[P4b-1] cross-client patterns', () => {
  it('surfaces a pattern with its supporting deals once unlocked', async () => {
    const ctx = make(2, 0);
    await coldClientNoDM(ctx, 'u', 'Meridian');
    await coldClientNoDM(ctx, 'u', 'Northwind');
    const patterns = await ctx.hero.patterns('u', NOW);
    const quiet = patterns.find((p) => p.id === 'quiet-no-decision-maker')!;
    expect(quiet.evidence.map((e) => e.name).sort()).toEqual(['Meridian', 'Northwind']);
    expect(quiet.evidence.length).toBeGreaterThanOrEqual(2);
  });

  // NEGATIVE: a single-deal "pattern" is not surfaced (thin-sample guard).
  it('does not surface a pattern supported by a single deal', async () => {
    const ctx = make(1, 0);
    await coldClientNoDM(ctx, 'u', 'Solo');
    expect((await ctx.hero.patterns('u', NOW)).find((p) => p.id === 'quiet-no-decision-maker')).toBeUndefined();
  });

  it('every displayed pattern has non-empty evidence and no causation copy', async () => {
    const ctx = make(2, 0);
    await coldClientNoDM(ctx, 'u', 'A');
    await coldClientNoDM(ctx, 'u', 'B');
    for (const p of await ctx.hero.patterns('u', NOW)) {
      expect(p.evidence.length).toBeGreaterThan(0);
      expect(p.description.toLowerCase()).not.toMatch(/because|causes|caused by/);
    }
  });

  it('never draws on another rep\'s data', async () => {
    const ctx = make(2, 0);
    await coldClientNoDM(ctx, 'u', 'A');
    await coldClientNoDM(ctx, 'u', 'B');
    expect(await ctx.hero.patterns('other', NOW)).toEqual([]);
  });
});

describe('[P4b-2] deal-risk radar', () => {
  it('flags a deal on multiple signals, with reasons', async () => {
    const ctx = make(1, 0);
    await coldClientNoDM(ctx, 'u', 'Slipping'); // silent + no decision-maker = 2 signals
    const risk = await ctx.hero.risk('u', NOW);
    expect(risk).toHaveLength(1);
    expect(risk[0]!.reasons.length).toBeGreaterThanOrEqual(2);
  });

  it('does not flag a healthy, recently-advanced deal', async () => {
    const ctx = make(1, 0);
    const c = await ctx.clients.create('u', 'Healthy'); // just touched
    const note = await ctx.notes.create('u', { clientId: c.id, source: 'voice', rawText: 'x', audioKey: null, status: 'extracted' });
    await ctx.notes.update('u', note.id, { extracted: { summary: '', promises: [], people: [{ name: 'Boss', role: null, reports_to: null, decision_role: 'decision_maker', notes: null }], personal_facts: [], key_dates: [], concerns: [], next_steps: [], meeting: null } });
    expect(await ctx.hero.risk('u', NOW)).toEqual([]);
  });
});

describe('[P4b-3] what should I do today', () => {
  it('returns an honest empty list with zero data', async () => {
    const ctx = make(5, 20);
    expect(await ctx.hero.today('u', NOW)).toEqual([]);
  });

  it('ranks overdue promises above cold outreach and excludes done items', async () => {
    const ctx = make(5, 20);
    const c = await ctx.clients.create('u', 'C');
    await ctx.facts.saveExtraction('u', { noteId: 'n', clientId: c.id, promises: [
      { text: 'overdue thing', owner: 'rep', due_date: '2026-07-01', due_raw: '', confidence: 'high' },
      { text: 'done thing', owner: 'rep', due_date: '2026-07-02', due_raw: '', confidence: 'high' },
    ] });
    const [p1, p2] = await ctx.facts.listPromisesByUser('u');
    void p1;
    await ctx.facts.markPromiseDone('u', p2!.id);
    const actions = await ctx.hero.today('u', NOW);
    expect(actions[0]!.kind).toBe('promise');
    expect(actions.some((a) => a.text.includes('done thing'))).toBe(false); // completed excluded
  });

  it('is always on regardless of the volume gate', async () => {
    const ctx = make(999, 999); // gate very locked
    const c = await ctx.clients.create('u', 'C');
    await ctx.facts.saveExtraction('u', { noteId: 'n', clientId: c.id, promises: [{ text: 'do it', owner: 'rep', due_date: '2026-07-01', due_raw: '', confidence: 'high' }] });
    expect((await ctx.hero.today('u', NOW)).length).toBeGreaterThan(0);
  });
});
