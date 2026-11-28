import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { VisitsSection } from './FunnelPanel.js';
import type { VisitReport } from './adminClient.js';

/**
 * [P90 · owner, Prompt 88] "Add funnel events for step 1, 2 and 3 reached and add them to the admin funnel card": the
 * site-visits card in Admin, Funnel shows how many times each step of the request form was reached and how many
 * requests were submitted, with the share that went on from the step before.
 */
const base: VisitReport = { days: [], byPage: { landing: 0, request_access: 0, sign_in: 0, privacy: 0 }, devices: { phone: 0, desktop: 0 }, topReferrers: [], utm: [], landingVisitors: 0, reachedRequest: 0, submitted: 0, reachedRequestShare: null, submittedShare: null };

describe('[P90] the request form steps on the funnel card', () => {
  it('the three steps and the submitted count, each with the share that went on', () => {
    render(<VisitsSection visits={{ ...base, requestSteps: { step1: 40, step2: 20, step3: 10, submitted: 5 } }} />);
    const card = screen.getByTestId('funnel-request-steps');
    expect(within(card).getByText('Request form')).toBeInTheDocument();
    expect(card).toHaveTextContent('Step 1 reached: 40');
    expect(card).toHaveTextContent('Step 2 reached: 20 (50% of step 1)');
    expect(card).toHaveTextContent('Step 3 reached: 10 (50% of step 2)');
    expect(card).toHaveTextContent('Submitted: 5 (50% of step 3)');
  });
  it('NEGATIVE: nothing reached yet: zeros, no percentages, no "NaN"', () => {
    render(<VisitsSection visits={{ ...base, requestSteps: { step1: 0, step2: 0, step3: 0, submitted: 0 } }} />);
    const card = screen.getByTestId('funnel-request-steps');
    expect(card).toHaveTextContent('Step 1 reached: 0');
    expect(card.textContent).not.toMatch(/NaN|%/);
  });
  it('NEGATIVE: a report from before the steps existed shows no steps block (and does not crash)', () => {
    render(<VisitsSection visits={base} />);
    expect(screen.queryByTestId('funnel-request-steps')).toBeNull();
  });
});
