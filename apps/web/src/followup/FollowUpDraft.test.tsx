import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FollowUpDraft, type FollowUpApi } from './FollowUpDraft.js';
import { LOCKED } from '../billing/gated.js';

const makeApi = (draft: string | null): FollowUpApi => ({ draftFollowUp: vi.fn().mockResolvedValue(draft) });

afterEach(() => vi.unstubAllGlobals());

describe('<FollowUpDraft>', () => {
  // [LOCKED-EMBEDDED] a 402 (trial lapsed) shows the shared Locked state, not an
  // error, and Subscribe reaches Billing. Entitled reps are unaffected (above).
  it('renders <Locked> on a 402 and Subscribe reaches Billing', async () => {
    const user = userEvent.setup();
    const onSubscribe = vi.fn();
    render(<FollowUpDraft noteId="n1" api={{ draftFollowUp: vi.fn().mockResolvedValue(LOCKED) }} onSubscribe={onSubscribe} />);
    await user.click(screen.getByRole('button', { name: /draft follow-up/i }));
    expect(await screen.findByText(/your trial has ended/i)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument(); // not an error
    await user.click(screen.getByRole('button', { name: /subscribe/i }));
    expect(onSubscribe).toHaveBeenCalled();
  });

  it('drafts a follow-up and shows it in an editable box', async () => {
    const user = userEvent.setup();
    render(<FollowUpDraft noteId="n1" api={makeApi('Hi Sara, I\'ll send the quote Friday.')} />);
    await user.click(screen.getByRole('button', { name: /draft follow-up/i }));
    const box = await screen.findByLabelText(/follow-up draft/i);
    expect(box).toHaveValue("Hi Sara, I'll send the quote Friday.");
  });

  it('lets the rep edit the draft before copying', async () => {
    const user = userEvent.setup();
    render(<FollowUpDraft noteId="n1" api={makeApi('draft')} />);
    await user.click(screen.getByRole('button', { name: /draft follow-up/i }));
    const box = await screen.findByLabelText(/follow-up draft/i);
    await user.clear(box);
    await user.type(box, 'my edit');
    expect(box).toHaveValue('my edit');
  });

  it('copies the draft to the clipboard', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    render(<FollowUpDraft noteId="n1" api={makeApi('copy me')} />);
    await user.click(screen.getByRole('button', { name: /draft follow-up/i }));
    await screen.findByLabelText(/follow-up draft/i);
    await user.click(screen.getByRole('button', { name: /^copy$/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('copy me'));
    expect(await screen.findByRole('button', { name: /copied/i })).toBeInTheDocument();
  });

  // NEGATIVE: a failed draft shows an error and no editor.
  it('shows an error when drafting fails', async () => {
    const user = userEvent.setup();
    render(<FollowUpDraft noteId="n1" api={makeApi(null)} />);
    await user.click(screen.getByRole('button', { name: /draft follow-up/i }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByLabelText(/follow-up draft/i)).toBeNull();
  });

  // P4-7 POSITIVE: opens WhatsApp pre-filled with the EDITED draft, targeting the phone.
  it('opens WhatsApp with the edited draft pre-filled', async () => {
    const user = userEvent.setup();
    const openLink = vi.fn();
    render(<FollowUpDraft noteId="n1" api={makeApi('original draft')} phone="+971 50 123 4567" openLink={openLink} />);
    await user.click(screen.getByRole('button', { name: /draft follow-up/i }));
    const box = await screen.findByLabelText(/follow-up draft/i);
    await user.clear(box);
    await user.type(box, 'edited message');
    await user.click(screen.getByRole('button', { name: /send via whatsapp/i }));
    expect(openLink).toHaveBeenCalledWith('https://wa.me/971501234567?text=edited%20message');
  });

  // P4-7 NEGATIVE (by design): Tovira has no send path — the API is never called
  // to send; the button only opens a link the rep must confirm in WhatsApp.
  it('never sends — only opens a link (no send API exists)', async () => {
    const user = userEvent.setup();
    const openLink = vi.fn();
    const api = makeApi('hello');
    render(<FollowUpDraft noteId="n1" api={api} openLink={openLink} />);
    await user.click(screen.getByRole('button', { name: /draft follow-up/i }));
    await screen.findByLabelText(/follow-up draft/i);
    await user.click(screen.getByRole('button', { name: /send via whatsapp/i }));
    // The only API the component has is draftFollowUp — called once, for drafting.
    expect(api.draftFollowUp).toHaveBeenCalledTimes(1);
    expect(openLink).toHaveBeenCalledTimes(1); // opening a link ≠ sending
  });
});
