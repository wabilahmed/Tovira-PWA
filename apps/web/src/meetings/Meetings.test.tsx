import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Meetings, type MeetingsApi } from './Meetings.js';
import type { Meeting } from './meetingsClient.js';

const clients = [{ id: 'c1', name: 'Acme' }, { id: 'c2', name: 'Meridian' }];
const meeting: Meeting = { id: 'm1', clientId: 'c1', datetime: '2026-08-01T15:00', datetimeRaw: 'Tue 3pm', title: 'Review', confirmed: true, createdAt: 1 };

function makeApi(over: Partial<MeetingsApi> = {}): MeetingsApi {
  return {
    list: vi.fn().mockResolvedValue([]),
    parse: vi.fn().mockResolvedValue({ clientId: 'c1', datetime: '2026-08-01T15:00', datetimeRaw: 'Tue 3pm', title: null }),
    createForClient: vi.fn().mockResolvedValue(meeting),
    remove: vi.fn().mockResolvedValue(true),
    ...over,
  };
}

describe('<Meetings>', () => {
  it('lists existing meetings with the client name', async () => {
    render(<Meetings api={makeApi({ list: vi.fn().mockResolvedValue([meeting]) })} clients={clients} />);
    expect(await screen.findByTestId('meeting')).toHaveTextContent(/review with acme/i);
  });

  it('shows an empty state when there are no meetings', async () => {
    render(<Meetings api={makeApi()} clients={clients} />);
    expect(await screen.findByText(/no meetings scheduled/i)).toBeInTheDocument();
  });

  // P3-1 POSITIVE: NL parse → preview → confirm saves the meeting.
  it('parses natural language, previews, and saves on confirm', async () => {
    const user = userEvent.setup();
    const api = makeApi();
    render(<Meetings api={api} clients={clients} />);
    await user.type(screen.getByLabelText(/describe the meeting/i), 'meeting with Acme Tue 3pm');
    await user.click(screen.getByRole('button', { name: /parse/i }));
    expect(await screen.findByTestId('meeting-preview')).toHaveTextContent(/tue 3pm/i);

    await user.click(screen.getByRole('button', { name: /save meeting/i }));
    await waitFor(() => expect(api.createForClient).toHaveBeenCalledWith('c1', expect.objectContaining({ datetimeRaw: 'Tue 3pm' })));
  });

  // NEGATIVE: an unparseable description shows an error and no preview.
  it('shows an error when parsing fails', async () => {
    const user = userEvent.setup();
    render(<Meetings api={makeApi({ parse: vi.fn().mockResolvedValue(null) })} clients={clients} />);
    await user.type(screen.getByLabelText(/describe the meeting/i), 'gibberish');
    await user.click(screen.getByRole('button', { name: /parse/i }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByTestId('meeting-preview')).toBeNull();
  });

  it('removes a meeting', async () => {
    const user = userEvent.setup();
    const api = makeApi({ list: vi.fn().mockResolvedValue([meeting]) });
    render(<Meetings api={api} clients={clients} />);
    await user.click(await screen.findByRole('button', { name: /remove/i }));
    await waitFor(() => expect(screen.queryByTestId('meeting')).toBeNull());
    expect(api.remove).toHaveBeenCalledWith('m1');
  });
});
