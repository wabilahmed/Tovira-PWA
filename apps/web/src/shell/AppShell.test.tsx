import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AppShell } from './AppShell.js';

function mockMatchMedia(matches: boolean): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    onchange: null,
    dispatchEvent: vi.fn(),
  }));
}

afterEach(() => vi.unstubAllGlobals());

describe('<AppShell> (responsive)', () => {
  it('renders the mobile bottom tab bar by default (no matchMedia)', () => {
    render(<AppShell view="clients" onNavigate={vi.fn()} needsSeeding={false}>screen</AppShell>);
    expect(screen.getByRole('button', { name: /^more$/i })).toBeInTheDocument(); // tab bar
    expect(screen.queryByRole('complementary')).toBeNull(); // no sidebar
  });

  it('renders the desktop sidebar (Tovira wordmark + full nav) at ≥1180px', () => {
    mockMatchMedia(true);
    render(<AppShell view="today" onNavigate={vi.fn()} needsSeeding={false}>screen</AppShell>);
    const sidebar = screen.getByRole('complementary', { name: /sections/i });
    expect(sidebar).toHaveTextContent('Tovira');
    expect(screen.getByRole('button', { name: /the ledger/i })).toBeInTheDocument();
    // The mobile More affordance is absent on desktop.
    expect(screen.queryByRole('button', { name: /^more$/i })).toBeNull();
  });

  it('shows the Get started nudge on mobile only while unseeded', () => {
    const { rerender } = render(<AppShell view="clients" onNavigate={vi.fn()} needsSeeding>screen</AppShell>);
    expect(screen.getByRole('button', { name: /get started/i })).toBeInTheDocument();
    rerender(<AppShell view="clients" onNavigate={vi.fn()} needsSeeding={false}>screen</AppShell>);
    expect(screen.queryByRole('button', { name: /get started/i })).toBeNull();
  });
});
