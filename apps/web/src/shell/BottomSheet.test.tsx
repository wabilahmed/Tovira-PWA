import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BottomSheet } from './BottomSheet.js';

describe('<BottomSheet>', () => {
  it('renders nothing while closed', () => {
    render(
      <BottomSheet open={false} onClose={vi.fn()} label="More">
        <button type="button">Promises</button>
      </BottomSheet>,
    );
    expect(screen.queryByRole('button', { name: /promises/i })).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('exposes a labelled dialog with its children when open', () => {
    render(
      <BottomSheet open onClose={vi.fn()} label="More sections">
        <button type="button">Promises</button>
      </BottomSheet>,
    );
    const dialog = screen.getByRole('dialog', { name: /more sections/i });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /promises/i })).toBeInTheDocument();
  });

  it('closes on a scrim tap', () => {
    const onClose = vi.fn();
    const { container } = render(
      <BottomSheet open onClose={onClose} label="More">
        <button type="button">Promises</button>
      </BottomSheet>,
    );
    fireEvent.click(container.querySelector('.tov-scrim')!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(
      <BottomSheet open onClose={onClose} label="More">
        <button type="button">Promises</button>
      </BottomSheet>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('unmounts its content once reopened shut', () => {
    const { rerender } = render(
      <BottomSheet open onClose={vi.fn()} label="More">
        <button type="button">Promises</button>
      </BottomSheet>,
    );
    expect(screen.getByRole('button', { name: /promises/i })).toBeInTheDocument();
    rerender(
      <BottomSheet open={false} onClose={vi.fn()} label="More">
        <button type="button">Promises</button>
      </BottomSheet>,
    );
    expect(screen.queryByRole('button', { name: /promises/i })).toBeNull();
  });
});
