import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CeilingNotice } from './CeilingNotice.js';

// [P5-1-CEILING-UI] The ceiling message must reassure, never alarm: data is safe,
// and upgrading lifts the limit. It never says the import failed or was lost.
describe('<CeilingNotice>', () => {
  it('reassures that the data is safe and that upgrading lifts the ceiling', () => {
    render(<CeilingNotice />);
    const el = screen.getByTestId('ceiling-notice');
    expect(el).toHaveTextContent(/saved|safe|nothing.*lost/i);
    expect(el).toHaveTextContent(/upgrad/i);
  });

  it('never uses scary failure language', () => {
    render(<CeilingNotice />);
    const text = screen.getByTestId('ceiling-notice').textContent ?? '';
    expect(text).not.toMatch(/failed|error|couldn't|lost your|deleted/i);
  });

  it('surfaces the processed portion when a count is given', () => {
    render(<CeilingNotice imported={12} />);
    expect(screen.getByTestId('ceiling-notice')).toHaveTextContent(/12/);
  });
});
