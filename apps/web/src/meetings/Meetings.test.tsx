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
    parse: vi.fn().mockResolvedValue({ kind: 'proposal', clientId: 'c1', clientName: 'Acme', datetime: '2026-08-01T15:00', datetimeRaw: 'Tue 3pm' }),
    createForClient: vi.fn().mockResolvedValue(meeting),
    remove: vi.fn().mockResolvedValue(true),
    confirm: vi.fn().mockResolvedValue({ ...meeting, confirmed: true }),
    ...over,
  };
}

describe('<Meetings>', () => {
  it('lists existing meetings with the client name', async () => {
    render(<Meetings api={makeApi({ list: vi.fn().mockResolvedValue([meeting]) })} clients={clients} />);
    expect(await screen.findByTestId('meeting')).toHaveTextContent(/review with acme/i);
  });

  it('[NUDGE-UNCONFIRMED] shows an unconfirmed meeting as pending and confirms it on tap', async () => {
    const unconfirmed: Meeting = { ...meeting, id: 'm2', confirmed: false };
    const confirm = vi.fn().mockResolvedValue({ ...unconfirmed, confirmed: true });
    render(<Meetings api={makeApi({ list: vi.fn().mockResolvedValue([unconfirmed]), confirm })} clients={clients} />);
    expect(await screen.findByTestId('meeting')).toHaveTextContent(/unconfirmed — is this right\?/i);
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(confirm).toHaveBeenCalledWith('m2'));
    // the pending label clears once confirmed
    await waitFor(() => expect(screen.queryByText(/unconfirmed — is this right\?/i)).toBeNull());
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

  // [FLOWS-3] the parser's ambiguity kinds must ASK, not fail silently.
  it('asks which client when the name is ambiguous, then saves the chosen one', async () => {
    const user = userEvent.setup();
    const api = makeApi({
      parse: vi.fn().mockResolvedValue({ kind: 'ambiguous_client', candidates: [{ id: 'c1', name: 'Acme' }, { id: 'c2', name: 'Meridian' }], datetime: '2026-08-01T15:00', datetimeRaw: 'Tue 3pm' }),
    });
    render(<Meetings api={api} clients={clients} />);
    await user.type(screen.getByLabelText(/describe the meeting/i), 'meeting Tue 3pm');
    await user.click(screen.getByRole('button', { name: /parse/i }));
    // It asks — showing the candidates — instead of silently picking one.
    expect(await screen.findByText(/which client/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^Meridian$/i }));
    await user.click(await screen.findByRole('button', { name: /save meeting/i }));
    await waitFor(() => expect(api.createForClient).toHaveBeenCalledWith('c2', expect.objectContaining({ datetimeRaw: 'Tue 3pm' })));
  });

  it('offers to create an unknown client (no silent pick), and creates on confirm', async () => {
    const user = userEvent.setup();
    const onCreateClient = vi.fn().mockResolvedValue({ id: 'c9', name: 'Zeta Corp' });
    render(<Meetings api={makeApi({ parse: vi.fn().mockResolvedValue({ kind: 'no_client', name: 'Zeta Corp' }) })} clients={clients} onCreateClient={onCreateClient} />);
    await user.type(screen.getByLabelText(/describe the meeting/i), 'meeting with Zeta Corp Tue 3pm');
    await user.click(screen.getByRole('button', { name: /parse/i }));
    expect(await screen.findByText(/no client matches/i)).toBeInTheDocument();
    expect(screen.queryByTestId('meeting-preview')).toBeNull(); // nothing saved silently
    await user.click(screen.getByRole('button', { name: /create .*zeta corp/i }));
    await waitFor(() => expect(onCreateClient).toHaveBeenCalledWith('Zeta Corp'));
  });

  // [FLOWS-8] a vague time is SAVEABLE — the raw phrase is kept, time unconfirmed.
  it('keeps a vague time saveable with "(time unconfirmed)", never inventing one', async () => {
    const user = userEvent.setup();
    const api = makeApi({ parse: vi.fn().mockResolvedValue({ kind: 'ambiguous_time', datetimeRaw: 'sometime soon' }) });
    render(<Meetings api={api} clients={clients} />);
    await user.type(screen.getByLabelText(/describe the meeting/i), 'meeting with Acme sometime soon');
    await user.click(screen.getByRole('button', { name: /parse/i }));
    const preview = await screen.findByTestId('meeting-preview');
    expect(preview).toHaveTextContent(/sometime soon/);
    expect(preview).toHaveTextContent(/time unconfirmed/i);
    await user.click(screen.getByRole('button', { name: /save meeting/i }));
    await waitFor(() => expect(api.createForClient).toHaveBeenCalledWith('c1', expect.objectContaining({ datetime: null, datetimeRaw: 'sometime soon' })));
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
