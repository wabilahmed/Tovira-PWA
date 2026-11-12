import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HeroInsights, type HeroApi } from './HeroInsights.js';

/** [P69 · owner] Each morning, the clients to call and what they care about: one "Cares about" line under the action. */
const api = (actions: unknown[]): HeroApi => ({
  status: vi.fn().mockResolvedValue({ unlocked: true, counts: { clients: 5, notes: 20 }, needed: { clients: 0, notes: 0 }, message: '' }),
  patterns: vi.fn().mockResolvedValue([]),
  risk: vi.fn().mockResolvedValue([]),
  today: vi.fn().mockResolvedValue({ actions, refreshesRemaining: 2 }),
  refreshToday: vi.fn().mockResolvedValue(null),
});

describe('[P69] Today shows what each client cares about', () => {
  it('"Cares about: Loves the beach…" under the action; nothing when none is on file', async () => {
    render(<HeroInsights api={api([
      { kind: 'cold', reason: 'cold', priority: 1, text: 'Layla Haddad has gone quiet', title: 'Has gone quiet', subline: 'silent 45 days', clientId: 'c1', clientName: 'Layla Haddad', cares: 'Loves the beach, goes every morning before work' },
      { kind: 'promise', reason: 'owed', priority: 2, text: 'Send Omar the quote', title: 'Send the quote', clientId: 'c2', clientName: 'Omar' },
    ])} />);
    const lines = await screen.findAllByTestId('today-cares');
    expect(lines.map((l) => l.textContent)).toEqual(['Cares about: Loves the beach, goes every morning before work']);
  });
});
