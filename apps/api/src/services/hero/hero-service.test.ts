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

  it('attaches a dated fact sub-line to each action (P4b-3 register)', async () => {
    const ctx = make(5, 20);
    const c = await ctx.clients.create('u', 'C');
    await ctx.facts.saveExtraction('u', { noteId: 'n', clientId: c.id, promises: [
      { text: 'overdue thing', owner: 'rep', due_date: '2026-07-01', due_raw: '', confidence: 'high' },
    ] });
    await coldClientNoDM(ctx, 'u', 'Quiet Co');
    const actions = await ctx.hero.today('u', NOW);
    expect(actions.find((a) => a.kind === 'promise')!.subline).toBe('overdue since 1 Jul 2026');
    expect(actions.find((a) => a.kind === 'cold')!.subline).toMatch(/^silent \d+ days$/);
  });

  it('is always on regardless of the volume gate', async () => {
    const ctx = make(999, 999); // gate very locked
    const c = await ctx.clients.create('u', 'C');
    await ctx.facts.saveExtraction('u', { noteId: 'n', clientId: c.id, promises: [{ text: 'do it', owner: 'rep', due_date: '2026-07-01', due_raw: '', confidence: 'high' }] });
    expect((await ctx.hero.today('u', NOW)).length).toBeGreaterThan(0);
  });
});

describe('[INV-MATCH] strong matches enter Today\'s register below every fact', () => {
  it('adds a match action at the lowest priority with the receipt inline', async () => {
    const clients = new InMemoryClientRepository();
    const facts = new InMemoryFactsRepository();
    const meetings = new InMemoryMeetingRepository();
    const notes = new InMemoryNoteRepository();
    const { InMemoryInventoryRepository } = await import('../../adapters/inventory/in-memory-inventory-repository.js');
    const { InMemoryInventoryMatchRepository } = await import('../../adapters/inventory/in-memory-inventory-match-repository.js');
    const { InMemoryRequirementRepository } = await import('../../adapters/requirements/in-memory-requirement-repository.js');
    const { MatchingService } = await import('../inventory/matching-service.js');
    const inv = new InMemoryInventoryRepository();
    const reqs = new InMemoryRequirementRepository();
    const matchRepo = new InMemoryInventoryMatchRepository();
    const matching = new MatchingService(matchRepo, reqs, inv);
    const hero = new HeroService({ clients, facts, meetings, notes }, { minClients: 5, minNotes: 20 }, 30, matching);

    const client = await clients.create('u', 'Ahmed');
    // An OVERDUE promise (priority 4) — a fact that must rank ABOVE the match.
    await facts.saveExtraction('u', { noteId: 'np', clientId: client.id, promises: [{ text: 'send the deck', owner: 'rep', due_date: '2026-07-01', due_raw: '', confidence: 'high' }] });
    // A strong match.
    const item = await inv.create('u', { title: 'Marina Heights 402', description: '2-bed near the marina', quantity: 1, embedding: [1, 0, 0] });
    const [req] = await reqs.saveForNote('u', 'nr', client.id, [{ text: 'A 2-bed', requirementRaw: 'looking for a 2-bed near the marina', statedOn: '2026-03-14', confidence: 'high', embedding: [1, 0, 0] }]);
    await matching.matchRequirement('u', req!, [1, 0, 0]);
    void item;

    const actions = await hero.today('u', NOW);
    const match = actions.find((a) => a.kind === 'match');
    expect(match).toBeDefined();
    expect(match!.priority).toBe(0); // below every fact
    expect(match!.text).toContain('Marina Heights 402');
    expect(match!.subline).toContain('looking for a 2-bed near the marina'); // the receipt, inline
    expect(match!.subline).toContain('14 Mar 2026'); // …with the date
    // Ordering: the overdue promise (a fact) comes before the match (a guess).
    expect(actions.findIndex((a) => a.kind === 'promise')).toBeLessThan(actions.findIndex((a) => a.kind === 'match'));
  });
});
