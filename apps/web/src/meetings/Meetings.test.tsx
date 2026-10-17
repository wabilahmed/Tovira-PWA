import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
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
    edit: vi.fn().mockResolvedValue({ ...meeting, datetime: "2026-09-09T09:00" }),
    ...over,
  };
}

describe('<Meetings>', () => {
  it('lists existing meetings with the client name', async () => {
    render(<Meetings api={makeApi({ list: vi.fn().mockResolvedValue([meeting]) })} clients={clients} />);
    expect(await screen.findByTestId('meeting')).toHaveTextContent(/review with acme/i);
  });

  it('[MEETING-CREATE] the direct form needs a client, then saves with the chosen date/time', async () => {
    const createForClient = vi.fn().mockResolvedValue(meeting);
    render(<Meetings api={makeApi({ createForClient })} clients={clients} />);
    // no client chosen → refuses and does not call the API
    await userEvent.click(await screen.findByRole('button', { name: 'Add meeting' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/choose a client/i);
    expect(createForClient).not.toHaveBeenCalled();
    // choose client + date + time → saves
    await userEvent.selectOptions(screen.getByLabelText('Client'), 'c2');
    fireEvent.change(screen.getByLabelText('Meeting date'), { target: { value: '2026-08-01' } });
    fireEvent.change(screen.getByLabelText('Meeting time'), { target: { value: '15:00' } });
    await userEvent.click(screen.getByRole('button', { name: 'Add meeting' }));
    await waitFor(() => expect(createForClient).toHaveBeenCalledWith('c2', { datetime: '2026-08-01T15:00', datetimeRaw: '2026-08-01 15:00', title: null }));
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

  // [P18-4] A meeting time is a UTC instant over the wire (the server resolves the wall-clock on the
  // rep's zone and returns .toISOString()). The list must render it in the rep's timezone through the
  // one shared formatter — NEVER the raw ISO string.
  it('[P18-4] shows the meeting time in the rep timezone, never a raw ISO instant', async () => {
    const m: Meeting = { id: 'm9', clientId: 'c1', datetime: '2026-10-14T18:23:00.000Z', datetimeRaw: 'Wed evening', title: 'Review', confirmed: true, createdAt: 1 };
    render(<Meetings api={makeApi({ list: vi.fn().mockResolvedValue([m]) })} clients={clients} timeZone="Asia/Dubai" />);
    const row = await screen.findByTestId('meeting');
    expect(row).toHaveTextContent('14 Oct 2026, 22:23'); // 18:23Z → 22:23 in Dubai (+4)
    expect(row).not.toHaveTextContent('2026-10-14T18:23'); // the raw instant must never reach the rep
  });

  // [P18-4] The confirm preview also formats the resolved instant (keeps the raw phrase as provenance).
  it('[P18-4] the proposal preview formats the resolved instant, keeping the raw phrase', async () => {
    const user = userEvent.setup();
    const api = makeApi({ parse: vi.fn().mockResolvedValue({ kind: 'proposal', clientId: 'c1', clientName: 'Acme', datetime: '2026-10-14T18:23:00.000Z', datetimeRaw: 'Wed evening' }) });
    render(<Meetings api={api} clients={clients} timeZone="Asia/Dubai" />);
    await user.type(screen.getByLabelText(/describe the meeting/i), 'meeting with Acme Wed evening');
    await user.click(screen.getByRole('button', { name: /parse/i }));
    const preview = await screen.findByTestId('meeting-preview');
    expect(preview).toHaveTextContent(/wed evening/i);          // the raw phrase stays
    expect(preview).toHaveTextContent('14 Oct 2026, 22:23');    // resolved instant, formatted in rep tz
    expect(preview).not.toHaveTextContent('2026-10-14T18:23');  // never the raw instant
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

describe('[AUDIT item 2] inline meeting reschedule', () => {
  it('editing the time input PATCHes the meeting (keeps the receipt)', async () => {
    const edit = vi.fn().mockResolvedValue({ ...meeting, datetime: '2026-09-09T09:00' });
    render(<Meetings api={makeApi({ list: vi.fn().mockResolvedValue([meeting]), edit })} clients={clients} />);
    const input = await screen.findByLabelText(/Reschedule Review/i);
    fireEvent.change(input, { target: { value: '2026-09-09T09:00' } });
    await waitFor(() => expect(edit).toHaveBeenCalled());
    expect((edit.mock.calls[0]![1] as { datetime?: string }).datetime).toMatch(/2026-09-09T09:00/);
  });

  // [UI-01] The client picker must be width-constrained so a long client name can't push "Add meeting"
  // off-screen at 390px. jsdom can't measure layout, so assert the constraining class is applied.
  it('constrains the client select so a 90-char name does not overflow', () => {
    const longName = 'A'.repeat(90);
    render(<Meetings api={makeApi()} clients={[{ id: 'c1', name: longName }]} />);
    const select = screen.getByLabelText('Client');
    expect(select).toHaveClass('tov-client-select');
  });

  // [UI-01] The stylesheet actually caps the width (max-width:100% + min-width:0 so it shrinks in a track).
  it('.tov-client-select caps width in the stylesheet', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const css = readFileSync(resolve(process.cwd(), 'apps/web/src/styles/theme.css'), 'utf8');
    const block = /\.tov-client-select\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(block).toMatch(/max-width:\s*100%/);
    expect(block).toMatch(/min-width:\s*0/);
  });
});
