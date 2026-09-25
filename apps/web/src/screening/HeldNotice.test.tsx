import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HeldNotice } from './HeldNotice.js';

describe('<HeldNotice>', () => {
  it("'full' carries BOTH sentences — including the not-exhaustive warning", () => {
    render(<HeldNotice variant="full" />);
    const t = screen.getByTestId('held-notice').textContent ?? '';
    expect(t).toMatch(/decide before they're analysed/i);
    expect(t).toMatch(/indirect phrasing poorly/i); // the honest not-exhaustive line
    expect(t).toMatch(/read the conversation, not just the flags/i);
  });

  it("'short' keeps ONLY the first sentence — the odd line is dropped inside the review list", () => {
    render(<HeldNotice variant="short" />);
    const t = screen.getByTestId('held-notice').textContent ?? '';
    expect(t).toMatch(/decide before they're analysed/i);
    expect(t).not.toMatch(/read the conversation, not just the flags/i);
    expect(t).not.toMatch(/indirect phrasing poorly/i);
  });

  it("'indicator' shows the held count and that it is not yet analysed", () => {
    render(<HeldNotice variant="indicator" held={3} />);
    const t = screen.getByTestId('held-notice').textContent ?? '';
    expect(t).toMatch(/3 messages held/i);
    expect(t).toMatch(/not yet analysed/i);
  });

  it("'indicator' singularises one message", () => {
    render(<HeldNotice variant="indicator" held={1} />);
    expect(screen.getByTestId('held-notice')).toHaveTextContent(/1 message held/i);
  });
});
