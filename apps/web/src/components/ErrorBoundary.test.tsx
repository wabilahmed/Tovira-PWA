import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ErrorBoundary } from './ErrorBoundary.js';

function Boom(): JSX.Element { throw new Error('kaboom'); }

afterEach(() => vi.restoreAllMocks());

describe('[AUDIT item 1] <ErrorBoundary>', () => {
  it('renders the reassuring fallback + a Reload button when a child throws (not a blank page)', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {}); // React logs the caught error
    render(<ErrorBoundary><Boom /></ErrorBoundary>);
    expect(screen.getByText('Something went wrong. Your data is safe.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reload/i })).toBeInTheDocument();
    expect(err).toHaveBeenCalled(); // the error was logged through the available sink
  });

  it('renders its children untouched when nothing throws', () => {
    render(<ErrorBoundary><p>all good</p></ErrorBoundary>);
    expect(screen.getByText('all good')).toBeInTheDocument();
    expect(screen.queryByText(/something went wrong/i)).toBeNull();
  });
});
