import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Conversations } from './Conversations.js';
import type { NoteSummary } from '../clientsClient.js';

/**
 * [P36-5] Each conversation's state stays honest (ported from the retired notes timeline): queued vs analysing,
 * the trial-ceiling notice, a missing recording, a failed analysis, a privacy hold, and a billing hold with
 * its reason — never an endless "analysing…".
 */
const note = (over: Partial<NoteSummary> = {}): NoteSummary => ({ id: 'n1', source: 'paste', rawText: 'hello', status: 'extracted', createdAt: Date.parse('2026-08-01T10:00:00Z'), ...over });
const show = (n: NoteSummary, extra: { ceiling?: boolean; onSubscribe?: () => void } = {}) =>
  render(<Conversations notes={[n]} entries={[]} ceilingNoteIds={new Set(extra.ceiling ? [n.id] : [])} onSubscribe={extra.onSubscribe} />);

describe('[P36-5] a conversation entry\'s state', () => {
  it('a plain title — "Pasted message · 1 Aug 2026" — not a source enum', () => {
    show(note({ source: 'whatsapp_export' as NoteSummary['source'] }));
    expect(screen.getByRole('button', { name: /WhatsApp chat · 1 Aug 2026/ })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/whatsapp_export|paste\b/i);
  });

  it('distinguishes queued from analysing', () => {
    show(note({ status: 'pending_extraction', extractionState: 'queued' }));
    expect(screen.getByText(/queued/i)).toBeInTheDocument();
  });

  it('analysing for a note being read', () => {
    show(note({ status: 'pending_extraction', extractionState: 'processing' }));
    expect(screen.getByText(/analysing/i)).toBeInTheDocument();
  });

  it('a ceiling-held note never shows "analysing…"', () => {
    show(note({ status: 'pending_extraction' }), { ceiling: true });
    expect(screen.queryByText(/analysing/i)).toBeNull();
  });

  it('a missing recording is its own honest reason (not "tap to retry")', () => {
    show(note({ source: 'voice', status: 'transcription_failed', rawText: null }));
    expect(screen.getByTestId('transcription-failed')).toBeInTheDocument();
    expect(screen.queryByTestId('extract-failed')).toBeNull();
  });

  it('a failed analysis reads as failed, not stuck', () => {
    show(note({ status: 'needs_review' }));
    expect(screen.getByTestId('extract-failed')).toBeInTheDocument();
    expect(screen.queryByText(/analysing/i)).toBeNull();
  });

  it('a billing hold says why, with Subscribe for a trial hold', () => {
    const onSubscribe = vi.fn();
    show(note({ status: 'pending_extraction', blockedReason: 'subscribe' }), { onSubscribe });
    expect(screen.getByTestId('note-blocked')).toHaveTextContent(/once you subscribe/i);
    expect(screen.getByTestId('note-subscribe')).toBeInTheDocument();
    expect(screen.queryByText(/analysing/i)).toBeNull();
  });

  it('payment and allowance holds give their own reason', () => {
    show(note({ id: 'p', status: 'pending_extraction', blockedReason: 'payment' }));
    expect(screen.getByTestId('note-blocked')).toHaveTextContent(/once your payment is updated/i);
    show(note({ id: 'a', status: 'pending_extraction', blockedReason: 'allowance' }));
    expect(screen.getAllByTestId('note-blocked').at(-1)).toHaveTextContent(/once you top up/i);
  });

  it('a privacy-held note shows the notice when opened, not its content', async () => {
    show(note({ rawText: null, restricted: true, restrictionNotice: 'Restricted while a privacy request is reviewed.' }));
    await userEvent.click(screen.getByRole('button', { name: /Pasted message/ }));
    expect(screen.getByTestId('note-restricted')).toHaveTextContent(/restricted while a privacy request is reviewed/i);
  });

  it('an empty book says how to add one', () => {
    render(<Conversations notes={[]} entries={[]} ceilingNoteIds={new Set()} />);
    expect(screen.getByText(/no conversations yet/i)).toBeInTheDocument();
  });
});
