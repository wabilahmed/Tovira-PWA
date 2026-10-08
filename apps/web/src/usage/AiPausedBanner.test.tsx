import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AiPausedBanner } from './AiPausedBanner.js';

describe('[AUDIT item 4] <AiPausedBanner>', () => {
  it('shows a reassuring "processing delayed" notice when AI is paused by ops', () => {
    render(<AiPausedBanner paused={true} />);
    const b = screen.getByTestId('ai-paused-banner');
    expect(b).toHaveTextContent(/processing is delayed/i);
    expect(b).toHaveTextContent(/notes are saved/i);
  });

  it('renders nothing when AI is running', () => {
    render(<AiPausedBanner paused={false} />);
    expect(screen.queryByTestId('ai-paused-banner')).toBeNull();
  });
});
