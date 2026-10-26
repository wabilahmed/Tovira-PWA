import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TimezoneSetting, zoneLabel } from './TimezoneSetting.js';

describe('[NUDGE-TZ] TimezoneSetting', () => {
  // [P46-2 · owner] the select's label is "Time zone" (one label), and a saved zone reads "Saved: London (GMT…)"
  it('shows the current zone and persists a change through the API', async () => {
    const updateTimezone = vi.fn(async (tz: string) => tz);
    render(<TimezoneSetting current="Asia/Dubai" api={{ updateTimezone }} />);
    const select = screen.getByLabelText('Time zone') as HTMLSelectElement;
    expect(select.value).toBe('Asia/Dubai');
    fireEvent.change(select, { target: { value: 'Europe/London' } });
    await waitFor(() => expect(updateTimezone).toHaveBeenCalledWith('Europe/London'));
    await screen.findByText(/Saved: London \(GMT/);
  });

  // [P46-2 · owner] same check, the stored zone now reads "Dubai (GMT+4)"
  it('reflects the server-normalized value, not the raw selection', async () => {
    // Server rejects a bad value and returns the default; the UI must show what was stored.
    const updateTimezone = vi.fn(async () => 'Asia/Dubai');
    render(<TimezoneSetting current="Europe/London" api={{ updateTimezone }} />);
    fireEvent.change(screen.getByLabelText('Time zone'), { target: { value: 'America/New_York' } });
    await screen.findByText(/Saved: Dubai \(GMT\+4\)/);
  });

  // [P46-2 · owner] the label is "Time zone"
  it('surfaces an error without changing the shown zone when the API fails', async () => {
    const updateTimezone = vi.fn(async () => { throw new Error('nope'); });
    render(<TimezoneSetting current="Asia/Dubai" api={{ updateTimezone }} />);
    fireEvent.change(screen.getByLabelText('Time zone'), { target: { value: 'Europe/Paris' } });
    await screen.findByRole('alert');
    expect((screen.getByLabelText('Time zone') as HTMLSelectElement).value).toBe('Asia/Dubai');
  });
});

// [P46-2] Owner: one label (the section's "Time zone", no second "Timezone"), and zones read "Dubai (GMT+4)", not
// "Asia/Dubai". The stored value is unchanged.
describe('[P46-2] time zone copy', () => {
  it('shows "Dubai (GMT+4)" while the value stays "Asia/Dubai"', () => {
    render(<TimezoneSetting current="Asia/Dubai" api={{ updateTimezone: vi.fn() }} />);
    const select = screen.getByLabelText('Time zone') as HTMLSelectElement;
    expect(select.value).toBe('Asia/Dubai');
    expect(select.selectedOptions[0]!.textContent).toBe('Dubai (GMT+4)');
  });

  it('NEGATIVE: no visible "Timezone" label and no raw "Asia/…" text', () => {
    const { container } = render(<TimezoneSetting current="Asia/Dubai" api={{ updateTimezone: vi.fn() }} />);
    expect(container.textContent).not.toMatch(/Timezone/);
    expect([...container.querySelectorAll('option')].map((o) => o.textContent).join(' ')).not.toMatch(/[A-Za-z]+\/[A-Za-z]/);
  });

  it('zoneLabel: a city with spaces and its offset', () => {
    expect(zoneLabel('America/New_York', new Date('2026-01-15T12:00:00Z'))).toBe('New York (GMT-5)');
    expect(zoneLabel('Asia/Kolkata', new Date('2026-01-15T12:00:00Z'))).toBe('Kolkata (GMT+5:30)');
    expect(zoneLabel('UTC', new Date('2026-01-15T12:00:00Z'))).toBe('UTC (GMT)');
  });
});
