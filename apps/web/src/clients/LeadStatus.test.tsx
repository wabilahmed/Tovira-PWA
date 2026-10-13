import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  LeadStatusFilterBar,
  LeadStatusPill,
  LeadStatusSheet,
  leadStatusCounts,
  matchesLeadFilter,
  leadFilterKey,
  leadStatusLabel,
} from './LeadStatus.js';
import type { ClientSummary } from './clientsClient.js';

const mk = (id: string, leadStatus: ClientSummary['leadStatus']): ClientSummary =>
  ({ id, name: `Client ${id}`, phone: null, createdAt: 0, leadStatus });

describe('[LEAD-STATUS] bucketing helpers', () => {
  it('buckets null/undefined as Unsorted and labels each status', () => {
    expect(leadFilterKey(null)).toBe('unsorted');
    expect(leadFilterKey(undefined)).toBe('unsorted');
    expect(leadFilterKey('warm')).toBe('warm');
    expect(leadStatusLabel(null)).toBe('Unsorted');
    expect(leadStatusLabel('done')).toBe('Done');
  });

  it('counts each bucket, with All = the full total', () => {
    const clients = [mk('1', 'warm'), mk('2', 'warm'), mk('3', 'cold'), mk('4', 'done'), mk('5', null), mk('6', undefined)];
    expect(leadStatusCounts(clients)).toEqual({ all: 6, warm: 2, cold: 1, done: 1, unsorted: 2 });
  });

  it('matchesLeadFilter: All matches everything; a bucket matches only its own', () => {
    const warm = mk('1', 'warm');
    const unsorted = mk('2', null);
    expect(matchesLeadFilter(warm, 'all')).toBe(true);
    expect(matchesLeadFilter(warm, 'warm')).toBe(true);
    expect(matchesLeadFilter(warm, 'cold')).toBe(false);
    expect(matchesLeadFilter(unsorted, 'unsorted')).toBe(true);
    expect(matchesLeadFilter(unsorted, 'warm')).toBe(false);
  });
});

describe('<LeadStatusFilterBar>', () => {
  const counts = { all: 6, warm: 2, cold: 1, done: 1, unsorted: 2 };

  it('renders All · Warm · Cold · Done · Unsorted, each with its count', () => {
    render(<LeadStatusFilterBar filter="all" counts={counts} onChange={() => {}} />);
    for (const [key, label, n] of [['all', 'All', 6], ['warm', 'Warm', 2], ['cold', 'Cold', 1], ['done', 'Done', 1], ['unsorted', 'Unsorted', 2]] as const) {
      const chip = screen.getByTestId(`lead-filter-${key}`);
      expect(chip).toHaveTextContent(label);
      expect(chip).toHaveTextContent(String(n));
    }
  });

  it('marks the active chip with aria-pressed and reports a change on tap', async () => {
    const onChange = vi.fn();
    render(<LeadStatusFilterBar filter="warm" counts={counts} onChange={onChange} />);
    expect(screen.getByTestId('lead-filter-warm')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('lead-filter-all')).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(screen.getByTestId('lead-filter-cold'));
    expect(onChange).toHaveBeenCalledWith('cold');
  });
});

describe('<LeadStatusPill>', () => {
  it('shows the status label and fires onClick (opening the sheet) without bubbling to the row', async () => {
    const onClick = vi.fn();
    const rowClick = vi.fn();
    render(
      // The pill sits beside the row's open-book control; tapping it must not trigger the row.
      <div onClick={rowClick}>
        <LeadStatusPill status="cold" onClick={onClick} />
      </div>,
    );
    expect(screen.getByText('Cold')).toBeInTheDocument();
    await userEvent.click(screen.getByText('Cold'));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(rowClick).not.toHaveBeenCalled(); // stopPropagation: tapping the pill never opens the book
  });

  it('shows Unsorted for a null status', () => {
    render(<LeadStatusPill status={null} onClick={() => {}} />);
    expect(screen.getByText('Unsorted')).toBeInTheDocument();
  });
});

describe('<LeadStatusSheet>', () => {
  it('offers all four options and marks the current one', () => {
    render(<LeadStatusSheet client={mk('1', 'cold')} onPick={() => {}} onClose={() => {}} />);
    for (const key of ['warm', 'cold', 'done', 'unsorted']) {
      expect(screen.getByTestId(`lead-option-${key}`)).toBeInTheDocument();
    }
    expect(screen.getByTestId('lead-option-cold')).toHaveAttribute('aria-current', 'true');
    expect(screen.getByTestId('lead-option-warm')).not.toHaveAttribute('aria-current');
  });

  it('calls onPick with the chosen value — a real status, or null for Unsorted', async () => {
    const onPick = vi.fn();
    render(<LeadStatusSheet client={mk('1', 'warm')} onPick={onPick} onClose={() => {}} />);
    await userEvent.click(screen.getByTestId('lead-option-done'));
    expect(onPick).toHaveBeenCalledWith('done');
    await userEvent.click(screen.getByTestId('lead-option-unsorted'));
    expect(onPick).toHaveBeenCalledWith(null);
  });

  it('renders nothing when no client is selected', () => {
    const { container } = render(<LeadStatusSheet client={null} onPick={() => {}} onClose={() => {}} />);
    expect(container.querySelector('[data-testid="lead-sheet"]')).toBeNull();
  });
});
