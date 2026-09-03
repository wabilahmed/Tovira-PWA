import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TimezoneSetting } from './TimezoneSetting.js';

describe('[NUDGE-TZ] TimezoneSetting', () => {
  it('shows the current zone and persists a change through the API', async () => {
    const updateTimezone = vi.fn(async (tz: string) => tz);
    render(<TimezoneSetting current="Asia/Dubai" api={{ updateTimezone }} />);
    const select = screen.getByLabelText('Timezone') as HTMLSelectElement;
    expect(select.value).toBe('Asia/Dubai');
    fireEvent.change(select, { target: { value: 'Europe/London' } });
    await waitFor(() => expect(updateTimezone).toHaveBeenCalledWith('Europe/London'));
    await screen.findByText(/Saved · Europe\/London/);
  });

  it('reflects the server-normalized value, not the raw selection', async () => {
    // Server rejects a bad value and returns the default; the UI must show what was stored.
    const updateTimezone = vi.fn(async () => 'Asia/Dubai');
    render(<TimezoneSetting current="Europe/London" api={{ updateTimezone }} />);
    fireEvent.change(screen.getByLabelText('Timezone'), { target: { value: 'America/New_York' } });
    await screen.findByText(/Saved · Asia\/Dubai/);
  });

  it('surfaces an error without changing the shown zone when the API fails', async () => {
    const updateTimezone = vi.fn(async () => { throw new Error('nope'); });
    render(<TimezoneSetting current="Asia/Dubai" api={{ updateTimezone }} />);
    fireEvent.change(screen.getByLabelText('Timezone'), { target: { value: 'Europe/Paris' } });
    await screen.findByRole('alert');
    expect((screen.getByLabelText('Timezone') as HTMLSelectElement).value).toBe('Asia/Dubai');
  });
});
