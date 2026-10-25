import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { MeetingsSection } from './Sections.js';
import type { ClientOverview } from './clientPageClient.js';

// [P42-B2] Owner: meetings are meetings for every rep; "viewings" is property language.
describe('[P42-B2] the meetings section speaks to every rep', () => {
  const overview = (o: Partial<ClientOverview>) => ({ nextMeeting: null, meetingsCount: 0, ...o }) as unknown as ClientOverview;
  it('a client with no meetings reads "No meetings yet."', () => {
    const { container } = render(<MeetingsSection overview={overview({})} />);
    expect(container.textContent).toBe('No meetings yet.');
  });
  it('NEGATIVE: never says "viewings"', () => {
    for (const o of [overview({}), overview({ meetingsCount: 2 })]) {
      const { container } = render(<MeetingsSection overview={o} />);
      expect(container.textContent).not.toMatch(/viewing/i);
    }
  });
});
