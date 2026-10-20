import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HeroInsights, type HeroApi } from './HeroInsights.js';
import type { GateState } from './heroClient.js';

/**
 * [P34-6] Phone review, 20 Oct: "No patterns or risks surfaced yet." looked broken. Below the volume gate the
 * section says why, quoting the REAL thresholds from the server config (never a number baked into the copy);
 * above the gate with nothing to show it says so plainly.
 */
const api = (status: GateState): HeroApi => ({
  status: vi.fn().mockResolvedValue(status),
  patterns: vi.fn().mockResolvedValue([]),
  risk: vi.fn().mockResolvedValue([]),
  today: vi.fn().mockResolvedValue({ actions: [], refreshesRemaining: 2 }),
  refreshToday: vi.fn().mockResolvedValue(null),
});
const gate = (counts: { clients: number; notes: number }, thresholds: { clients: number; notes: number }): GateState => ({
  unlocked: counts.clients >= thresholds.clients && counts.notes >= thresholds.notes,
  counts,
  needed: { clients: Math.max(0, thresholds.clients - counts.clients), notes: Math.max(0, thresholds.notes - counts.notes) },
  thresholds,
  message: '',
});

describe('[P34-6] an empty Patterns & risk section explains itself', () => {
  it('below the gate on both → names both thresholds from the config and what you have', async () => {
    render(<HeroInsights api={api(gate({ clients: 4, notes: 12 }, { clients: 7, notes: 33 }))} />);
    expect(await screen.findByText('Patterns appear once you have 7 clients and 33 notes. You have 4 clients and 12 notes.')).toBeInTheDocument();
  });

  it('below the gate on one → names only the one still short', async () => {
    render(<HeroInsights api={api(gate({ clients: 9, notes: 12 }, { clients: 5, notes: 20 }))} />);
    expect(await screen.findByText('Patterns appear once you have 20 notes. You have 12.')).toBeInTheDocument();
  });

  it('above the gate and empty → "Nothing stands out right now."', async () => {
    const { container } = render(<HeroInsights api={api(gate({ clients: 9, notes: 40 }, { clients: 5, notes: 20 }))} />);
    expect(await screen.findByText('Nothing stands out right now.')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/no patterns or risks surfaced yet/i);
  });
});
