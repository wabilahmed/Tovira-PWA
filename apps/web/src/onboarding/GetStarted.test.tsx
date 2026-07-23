import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GetStarted } from './GetStarted.js';
import type { SeedingStatus } from './onboardingClient.js';

const seeding: SeedingStatus = {
  hasClient: false,
  hasNote: false,
  briefReachable: false,
  seeded: false,
  bookScanReady: false,
  nextStep: 'Export a chat.',
  seeding: {
    primary: 'whatsapp_export',
    requiresPasteEntry: false,
    steps: { android: ['share to tovira'], ios: ['upload the .txt'] },
  },
  fallbacks: [{ kind: 'voice_note', label: 'Record a note' }],
};

const okImport = { importWhatsApp: vi.fn().mockResolvedValue({ ok: true, imported: 3 }) };

describe('<GetStarted>', () => {
  it('shows the guide first, then the import step when the rep starts', async () => {
    const user = userEvent.setup();
    render(
      <GetStarted
        seeding={seeding}
        clients={[{ id: 'c1', name: 'Acme', createdAt: 1 }]}
        onCreateClient={vi.fn()}
        importApi={okImport}
        onSeeded={vi.fn()}
        onFallback={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /import a chat/i })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /import a chat/i }));
    expect(await screen.findByLabelText(/pasted chat export/i)).toBeInTheDocument();
    expect(screen.getByText(/import acme's chat/i)).toBeInTheDocument();
  });

  // When the rep has no client yet, the flow first asks who the chat is with,
  // creating the client — never a dead end, never bulk paste entry.
  it('asks for a client name first when none exists, then imports', async () => {
    const user = userEvent.setup();
    const onCreateClient = vi.fn().mockResolvedValue({ id: 'c9', name: 'Sara Lee', createdAt: 2 });
    render(
      <GetStarted
        seeding={seeding}
        clients={[]}
        onCreateClient={onCreateClient}
        importApi={okImport}
        onSeeded={vi.fn()}
        onFallback={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('button', { name: /import a chat/i }));
    await user.type(screen.getByLabelText(/client name/i), 'Sara Lee');
    await user.click(screen.getByRole('button', { name: /continue/i }));
    expect(onCreateClient).toHaveBeenCalledWith('Sara Lee');
    expect(await screen.findByText(/import sara lee's chat/i)).toBeInTheDocument();
  });

  it('calls onSeeded after a successful import', async () => {
    const user = userEvent.setup();
    const onSeeded = vi.fn();
    render(
      <GetStarted
        seeding={seeding}
        clients={[{ id: 'c1', name: 'Acme', createdAt: 1 }]}
        onCreateClient={vi.fn()}
        importApi={okImport}
        onSeeded={onSeeded}
        onFallback={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('button', { name: /import a chat/i }));
    await user.type(await screen.findByLabelText(/pasted chat export/i), 'Sara: hi');
    await user.click(screen.getByLabelText(/consent to import/i));
    await user.click(screen.getByRole('button', { name: /import chat/i }));
    await waitFor(() => expect(onSeeded).toHaveBeenCalled());
  });

  // NEGATIVE: a fallback choice is reported and does not start an import.
  it('reports a fallback choice from the guide', async () => {
    const user = userEvent.setup();
    const onFallback = vi.fn();
    render(
      <GetStarted
        seeding={seeding}
        clients={[]}
        onCreateClient={vi.fn()}
        importApi={okImport}
        onSeeded={vi.fn()}
        onFallback={onFallback}
      />,
    );
    await user.click(screen.getByRole('button', { name: /record a note/i }));
    expect(onFallback).toHaveBeenCalledWith('voice_note');
  });
});
