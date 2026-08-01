import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { CorpusBadge, type CorpusApi } from './CorpusBadge.js';
import type { CorpusStats } from './corpusClient.js';

const api = (stats: CorpusStats | null): CorpusApi => ({ get: vi.fn().mockResolvedValue(stats) });

describe('<CorpusBadge>', () => {
  it('shows the months and moments once there is data', async () => {
    render(<CorpusBadge api={api({ months: 14, moments: 2300 })} />);
    expect(await screen.findByTestId('corpus-badge')).toHaveTextContent(/14 months · 2,300 moments/);
  });

  it('uses singular units for one', async () => {
    render(<CorpusBadge api={api({ months: 1, moments: 1 })} />);
    expect(await screen.findByTestId('corpus-badge')).toHaveTextContent(/1 month · 1 moment$/);
  });

  it('renders nothing for an empty corpus (no zero taunt)', async () => {
    const { container } = render(<CorpusBadge api={api({ months: 0, moments: 0 })} />);
    await waitFor(() => expect(container.querySelector('[data-testid="corpus-badge"]')).toBeNull());
  });

  it('renders nothing when the stat cannot be loaded', async () => {
    const { container } = render(<CorpusBadge api={api(null)} />);
    await waitFor(() => expect(container.querySelector('[data-testid="corpus-badge"]')).toBeNull());
  });
});
