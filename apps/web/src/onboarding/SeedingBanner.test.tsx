import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SeedingBanner } from './SeedingBanner.js';
import type { SeedingStatus } from './onboardingClient.js';

const STATUS: SeedingStatus = {
  hasClient: false,
  hasNote: false,
  briefReachable: false,
  seeded: false,
  bookScanReady: false,
  nextStep: "Export that client's WhatsApp chat and upload it — three taps, no typing.",
  seeding: {
    primary: 'whatsapp_export',
    requiresPasteEntry: false,
    steps: {
      android: ['Open WhatsApp and pick the chat.', 'Export chat → Without media.', 'Share it to Tovira.'],
      ios: ['Open WhatsApp and pick the chat.', 'Export Chat → Save to Files.', 'Upload the .txt in Tovira.'],
    },
  },
  fallbacks: [
    { kind: 'voice_note', label: 'Record a 30-second voice note instead.' },
    { kind: 'sample_book', label: 'Explore a sample book.' },
  ],
};

describe('<SeedingBanner>', () => {
  it('shows the next step and both platform guides (no paste bulk entry)', () => {
    render(<SeedingBanner status={STATUS} onStartImport={vi.fn()} onFallback={vi.fn()} />);
    expect(screen.getByText(/three taps, no typing/i)).toBeInTheDocument();
    expect(screen.getByText(/on android/i)).toBeInTheDocument();
    expect(screen.getByText(/on iphone/i)).toBeInTheDocument();
    expect(screen.getByText(/share it to tovira/i)).toBeInTheDocument();
    expect(screen.getByText(/upload the .txt/i)).toBeInTheDocument();
  });

  it('starts the import when the primary button is clicked', async () => {
    const user = userEvent.setup();
    const onStartImport = vi.fn();
    render(<SeedingBanner status={STATUS} onStartImport={onStartImport} onFallback={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /import a chat/i }));
    expect(onStartImport).toHaveBeenCalledOnce();
  });

  it('offers each fallback and reports which was chosen', async () => {
    const user = userEvent.setup();
    const onFallback = vi.fn();
    render(<SeedingBanner status={STATUS} onStartImport={vi.fn()} onFallback={onFallback} />);
    await user.click(screen.getByRole('button', { name: /voice note/i }));
    expect(onFallback).toHaveBeenCalledWith('voice_note');
    await user.click(screen.getByRole('button', { name: /sample book/i }));
    expect(onFallback).toHaveBeenCalledWith('sample_book');
  });
});
