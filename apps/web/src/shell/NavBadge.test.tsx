import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NavBadge } from './NavBadge.js';

describe('<NavBadge> (INV-MATCH honesty)', () => {
  it('renders the count with an accessible label', () => {
    render(<NavBadge count={3} />);
    const b = screen.getByTestId('nav-badge');
    expect(b).toHaveTextContent('3');
    expect(b).toHaveAttribute('aria-label', '3 unseen');
  });

  it('renders nothing at zero or undefined (a badge must be honest)', () => {
    const { container, rerender } = render(<NavBadge count={0} />);
    expect(container.querySelector('[data-testid="nav-badge"]')).toBeNull();
    rerender(<NavBadge count={undefined} />);
    expect(container.querySelector('[data-testid="nav-badge"]')).toBeNull();
  });

  it('caps at 9+', () => {
    render(<NavBadge count={42} />);
    expect(screen.getByTestId('nav-badge')).toHaveTextContent('9+');
  });
});
