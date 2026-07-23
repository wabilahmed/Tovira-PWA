import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FollowUpDraft, type FollowUpApi } from './FollowUpDraft.js';

const makeApi = (draft: string | null): FollowUpApi => ({ draftFollowUp: vi.fn().mockResolvedValue(draft) });

afterEach(() => vi.unstubAllGlobals());

describe('<FollowUpDraft>', () => {
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
});
