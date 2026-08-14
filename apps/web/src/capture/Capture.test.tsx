import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Capture } from './Capture.js';
import type { ClientSummary } from '../clients/clientsClient.js';
import type { Outbox } from './outbox.js';

const client = (id: string, name: string): ClientSummary => ({ id, name, phone: null, createdAt: 1 });
const importApi = { importWhatsApp: vi.fn().mockResolvedValue({ ok: true, imported: 0 }) };
const outbox = { pending: vi.fn().mockResolvedValue([]), enqueue: vi.fn(), flush: vi.fn() } as unknown as Outbox;

describe('<Capture>', () => {
  it('offers a client picker and a record control', async () => {
    render(<Capture clients={[client('c1', 'Falcon Group')]} importApi={importApi} outbox={outbox} />);
    expect(await screen.findByLabelText(/capture client/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /record for falcon group/i })).toBeInTheDocument();
    expect(screen.getByText(/kept on your device/i)).toBeInTheDocument();
  });

  it('switches to the chat-import mode', async () => {
    const user = userEvent.setup();
    render(<Capture clients={[client('c1', 'Falcon Group')]} importApi={importApi} outbox={outbox} />);
    await user.click(screen.getByRole('tab', { name: /import chat/i }));
    expect(await screen.findByLabelText(/consent to import/i)).toBeInTheDocument();
  });

  it('tells the rep to add a client first when there are none', () => {
    render(<Capture clients={[]} importApi={importApi} outbox={outbox} />);
    expect(screen.getByText(/add a client first/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /record/i })).toBeNull();
  });
});
