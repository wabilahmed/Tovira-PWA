import { describe, it, expect } from 'vitest';
import { groupPriorities } from './group-priorities.js';
import { HeroService, type TodayAction, type PriorityReason, type Pattern, type RiskItem } from './hero-service.js';
import { InMemoryClientRepository } from '../../adapters/clients/in-memory-client-repository.js';
import { InMemoryFactsRepository } from '../../adapters/facts/in-memory-facts-repository.js';
import { InMemoryMeetingRepository } from '../../adapters/meetings/in-memory-meeting-repository.js';
import { InMemoryNoteRepository } from '../../adapters/notes/in-memory-note-repository.js';

const NOW = Date.parse('2026-08-14T09:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const a = (reason: PriorityReason): TodayAction => ({ kind: 'promise', reason, priority: 1, text: reason, clientId: 'c' });

describe('[NOTIF-REWORK Task 5] groupPriorities — group by why', () => {
  it('groups render with correct counts and titles', () => {
    const actions = [a('cooling'), a('cooling'), a('cooling'), a('promise_overdue'), a('promise_overdue'), a('match')];
    const groups = groupPriorities(actions, [], []);
    const byReason = Object.fromEntries(groups.map((g) => [g.reason, g]));
    expect(byReason['cooling']!.count).toBe(3);
    expect(byReason['cooling']!.title).toBe('3 clients cooling');
    expect(byReason['promise_overdue']!.count).toBe(2);
    expect(byReason['promise_overdue']!.title).toBe('2 promises past due');
    expect(byReason['match']!.count).toBe(1);
    expect(byReason['match']!.title).toBe('1 inventory match to review'); // singular
  });

  it('an empty group is ABSENT, not shown as zero', () => {
    const groups = groupPriorities([a('cooling')], [], []);
    expect(groups.map((g) => g.reason)).toEqual(['cooling']); // only the non-empty group
    expect(groups.some((g) => g.reason === 'promise_overdue')).toBe(false);
    expect(groups.every((g) => g.count > 0)).toBe(true);
  });

  it('nothing at all → no groups (not a row of zeros)', () => {
    expect(groupPriorities([], [], [])).toEqual([]);
  });

  it('volume-gated groups appear only when the gate passed them through', () => {
    const pattern: Pattern = { id: 'p', title: 'x', description: 'y', confidence: 'observed', evidence: [{ clientId: 'c', name: 'n' }, { clientId: 'd', name: 'm' }] };
    const risk: RiskItem = { clientId: 'c', name: 'n', reasons: ['a', 'b'] };
    expect(groupPriorities([], [], []).some((g) => g.reason === 'patterns')).toBe(false); // gated out → absent
    const withGated = groupPriorities([], [pattern], [risk]);
    expect(withGated.find((g) => g.reason === 'patterns')!.count).toBe(1);
    expect(withGated.find((g) => g.reason === 'risk')!.count).toBe(1);
  });
});

describe('[NOTIF-REWORK Task 5] a volume-gated finding below threshold does not appear (via HeroService)', () => {
  it('a thin sample (below MIN_PATTERN_SAMPLE) yields no patterns group', async () => {
    const clients = new InMemoryClientRepository();
    const facts = new InMemoryFactsRepository();
    const meetings = new InMemoryMeetingRepository();
    const notes = new InMemoryNoteRepository();
    // One cooling client with no decision-maker — a single supporting deal, BELOW the >=2 pattern sample.
    const c = await clients.create('u', 'Solo Co');
    (c as { lastTouchedAt: number }).lastTouchedAt = NOW - 60 * DAY;

    // Gate wide open on volume so `patterns()` isn't locked by the unlock gate — the SAMPLE gate is
    // what must still suppress a 1-deal pattern.
    const hero = new HeroService({ clients, facts, meetings, notes }, { minClients: 0, minNotes: 0 }, 30, 90);
    const patterns = await hero.patterns('u', NOW);
    expect(patterns).toEqual([]); // 1 supporting deal < 2 → gated
    const groups = groupPriorities(await hero.today('u', NOW), patterns, await hero.risk('u', NOW));
    expect(groups.some((g) => g.reason === 'patterns')).toBe(false); // thin-sample pattern never gets a slot
  });
});
