import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MondayDigest, type MondayApi } from './MondayDigest.js';
import type { MondayDigest as Digest } from './mondayClient.js';

const api = (d: Digest | null): MondayApi => ({ get: vi.fn().mockResolvedValue(d) });

const full: Digest = {
  weekOf: '2026-08-03',
  promisesDue: [{ id: 'p1', text: 'send quote', dueDate: '2026-08-05', clientId: 'c1' }],
  coolingClients: [{ id: 'c2', name: 'Quiet Co' }],
  unansweredQuestions: [{ clientId: 'c3', question: 'bulk pricing?', date: '2026-07-01' }],
  upcomingDates: [{ clientId: 'c1', description: 'launch', date: '2026-08-06' }],
  isLight: false,
};

describe('<MondayDigest>', () => {
  it('lists the week\'s promises, cooling clients, questions and dates', async () => {
    render(<MondayDigest api={api(full)} />);
    expect(await screen.findByTestId('due')).toHaveTextContent(/send quote/i);
    expect(screen.getByTestId('cooling')).toHaveTextContent(/quiet co/i);
    expect(screen.getByTestId('questions')).toHaveTextContent(/bulk pricing/i);
    expect(screen.getByTestId('dates')).toHaveTextContent(/launch/i);
  });

  // NEVER PADDED: a clear week says so honestly.
  it('shows an honest clear-week message when light', async () => {
    render(<MondayDigest api={api({ ...full, promisesDue: [], coolingClients: [], unansweredQuestions: [], upcomingDates: [], isLight: true })} />);
    expect(await screen.findByTestId('clear-week')).toHaveTextContent(/clear week/i);
  });

  it('only renders sections that have items', async () => {
    render(<MondayDigest api={api({ ...full, coolingClients: [], unansweredQuestions: [], upcomingDates: [] })} />);
    await screen.findByTestId('due');
    expect(screen.queryByTestId('cooling')).toBeNull();
  });

  it('shows an error when it cannot load', async () => {
    render(<MondayDigest api={api(null)} />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  // INV-MATCH: the "surfaced but not acted this week" section — item + the client's quoted words.
  it('lists suggestions surfaced this week but not acted on, with the receipt', async () => {
    const surfaced = [{ clientId: 'c1', itemTitle: 'Marina Heights 402', requirementRaw: 'a 2-bed near the marina', statedOn: '2026-03-14', noteId: 'n1' }];
    render(<MondayDigest api={api({ ...full, surfacedNotActed: surfaced })} />);
    const sec = await screen.findByTestId('surfaced');
    expect(sec).toHaveTextContent(/marina heights 402/i);
    expect(within(sec).getByTestId('receipt')).toHaveTextContent(/a 2-bed near the marina/);
  });

  // A week clear of obligations but holding a suggestion is NOT a bare "clear week".
  it('shows the surfaced section even when the week is otherwise light', async () => {
    const surfaced = [{ clientId: 'c1', itemTitle: 'Marina Heights 402', requirementRaw: 'a 2-bed', statedOn: null, noteId: 'n1' }];
    render(<MondayDigest api={api({ ...full, promisesDue: [], coolingClients: [], unansweredQuestions: [], upcomingDates: [], isLight: true, surfacedNotActed: surfaced })} />);
    expect(await screen.findByTestId('surfaced')).toHaveTextContent(/marina heights 402/i);
    expect(screen.queryByTestId('clear-week')).toBeNull();
  });
});
