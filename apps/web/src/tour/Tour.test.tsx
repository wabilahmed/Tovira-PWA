import { describe, it, expect, vi } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Tour, TOUR_STEP_COUNT, type TourProps } from './Tour.js';
import { PLANS } from '../billing/plans.js';
import { EXPORT_STEPS } from '../onboarding/exportSteps.js';

/**
 * [P37] The required tour: 9 steps, Back / Next only (no Skip, no Close, Escape does nothing), progress saved at
 * every step (required mode only), the plan step with the rep's REAL trial date and usage and prices from the
 * Subscription config, "Not now" never blocks finishing, and the last step opens "New client from a chat".
 */
const NOW = Date.parse('2026-10-20T09:00:00Z');
const TRIAL_END = Date.parse('2026-11-03T09:00:00Z');
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1';
function props(over: Partial<TourProps> = {}): TourProps {
  return {
    mode: 'required',
    api: { saveStep: vi.fn(async () => {}), complete: vi.fn(async () => {}) },
    billing: { status: vi.fn(async () => ({ entitled: true, status: 'trialing', trialEndsAt: TRIAL_END, renewsAt: null })) },
    usage: { status: vi.fn(async () => ({ percentUsed: 0, rawPercentUsed: 0, exhausted: false, resetAt: '2026-11-03T00:00:00.000Z', canTopUp: false, options: [], subscription: 'trialing', extraPercentLeft: 0 })) },
    notifications: { enable: vi.fn(async () => ({ ok: true })) },
    onNavigate: vi.fn(),
    onFinish: vi.fn(),
    nav: { userAgent: IPHONE },
    now: NOW,
    ...over,
  };
}
const next = () => userEvent.click(screen.getByRole('button', { name: 'Next' }));
async function goTo(step: number): Promise<void> { for (let k = 1; k < step; k += 1) await next(); }

describe('[P37] the tour', () => {
  it('nine steps, announced "Step N of 9"; Next and Back move between them', async () => {
    render(<Tour {...props()} />);
    expect(TOUR_STEP_COUNT).toBe(9);
    expect(screen.getByTestId('tour-count')).toHaveTextContent('Step 1 of 9');
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Welcome to Tovira');
    expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled();
    await next();
    expect(screen.getByTestId('tour-count')).toHaveTextContent('Step 2 of 9');
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByTestId('tour-count')).toHaveTextContent('Step 1 of 9');
    await goTo(9);
    expect(screen.getByTestId('tour-count')).toHaveTextContent('Step 9 of 9');
    expect(screen.queryByRole('button', { name: 'Next' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Import your first chat' })).toBeInTheDocument();
  });

  it('is required: no Skip or Close anywhere, and Escape does nothing', async () => {
    render(<Tour {...props()} />);
    for (let s = 1; s <= 9; s += 1) {
      expect(screen.queryByRole('button', { name: /skip|close|dismiss|later|×/i })?.textContent ?? '').not.toMatch(/skip|close|dismiss|×/i);
      await userEvent.keyboard('{Escape}');
      expect(screen.getByTestId('tour')).toBeInTheDocument();
      if (s < 9) await next();
    }
  });

  it('focus moves into the card, Tab stays inside it, Enter is Next', async () => {
    render(<Tour {...props()} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog.contains(document.activeElement)).toBe(true);
    for (let k = 0; k < 6; k += 1) { await userEvent.tab(); expect(dialog.contains(document.activeElement)).toBe(true); }
    await userEvent.tab({ shift: true });
    expect(dialog.contains(document.activeElement)).toBe(true);
    screen.getByRole('heading', { name: 'Welcome to Tovira' }).focus();
    await userEvent.keyboard('{Enter}');
    expect(screen.getByTestId('tour-count')).toHaveTextContent('Step 2 of 9');
  });

  it('saves each step on the account; a replay saves nothing and never completes', async () => {
    const a = props();
    const { unmount } = render(<Tour {...a} />);
    await next(); await next();
    expect(a.api.saveStep).toHaveBeenCalledWith(0);
    expect(a.api.saveStep).toHaveBeenCalledWith(2);
    unmount();
    const r = props({ mode: 'replay' });
    render(<Tour {...r} />);
    await goTo(9);
    await userEvent.click(screen.getByRole('button', { name: 'Import your first chat' }));
    expect(r.api.saveStep).not.toHaveBeenCalled();
    expect(r.api.complete).not.toHaveBeenCalled();
    expect(r.onFinish).toHaveBeenCalled();
  });

  it('renders above everything: portalled to <body>, outside the app\'s screen (so the tab bar never covers it)', () => {
    const host = document.createElement('main');
    document.body.appendChild(host);
    render(<Tour {...props()} />, { container: host });
    expect(screen.getByTestId('tour').parentElement).toBe(document.body);
    expect(host.contains(screen.getByTestId('tour'))).toBe(false);
  });

  it('resumes at the saved step', () => {
    render(<Tour {...props({ startStep: 4 })} />);
    expect(screen.getByTestId('tour-count')).toHaveTextContent('Step 5 of 9');
  });

  it('step 2 shows the export steps for the rep\'s own phone only', async () => {
    render(<Tour {...props()} />);
    await goTo(2);
    expect(screen.getByText(EXPORT_STEPS.ios[0]!)).toBeInTheDocument();
    expect(screen.queryByText(EXPORT_STEPS.android[0]!)).toBeNull();
  });

  it('examples are labelled "Example" (steps 3, 4, 5)', async () => {
    render(<Tour {...props()} />);
    for (const s of [3, 4, 5]) {
      await goTo(s === 3 ? 3 : 2);
      expect(within(screen.getByRole('dialog')).getByText('Example')).toBeInTheDocument();
    }
  });

  it('the plan step shows the REAL trial end date and usage, and prices from the Subscription config', async () => {
    const p = props({ usage: { status: vi.fn(async () => ({ percentUsed: 37, rawPercentUsed: 37, exhausted: false, resetAt: '2026-11-03T00:00:00.000Z', canTopUp: false, options: [], subscription: 'trialing', extraPercentLeft: 0 })) } });
    render(<Tour {...p} />);
    await goTo(8);
    await waitFor(() => expect(screen.getByTestId('tour-trial')).toHaveTextContent('Your free trial ends on 3 Nov 2026 (14 days).'));
    expect(screen.getByTestId('tour-usage')).toHaveTextContent('37% used.');
    expect(screen.getByTestId('tour-prices')).toHaveTextContent(`Subscribe here any time: ${PLANS.monthly.price} or ${PLANS.annual.price}.`);
    expect(screen.getByText('Once you subscribe, you can buy extra usage here if you run low.')).toBeInTheDocument();
    expect(p.onNavigate).toHaveBeenLastCalledWith('settings');
  });

  it('a subscriber replaying the tour is pointed at Buy more usage instead', async () => {
    render(<Tour {...props({ mode: 'replay', billing: { status: vi.fn(async () => ({ entitled: true, status: 'active', trialEndsAt: 0, renewsAt: Date.parse('2026-11-12T00:00:00Z') })) } })} />);
    await goTo(8);
    expect(await screen.findByText('If you run low, tap Buy more usage here.')).toBeInTheDocument();
    expect(screen.queryByTestId('tour-prices')).toBeNull();
  });

  it('notifications: the real permission prompt, or "Not now" — either way the rep can finish', async () => {
    const p = props();
    render(<Tour {...p} />);
    await goTo(9);
    await userEvent.click(screen.getAllByRole('button', { name: 'Not now' })[1]!); // notifications
    await userEvent.click(screen.getByRole('button', { name: 'Not now' })); // home screen
    expect(p.notifications.enable).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Import your first chat' }));
    await waitFor(() => expect(p.onFinish).toHaveBeenCalled());
    expect(p.api.complete).toHaveBeenCalled();
  });

  it('"Turn on notifications" triggers the real prompt', async () => {
    const p = props();
    render(<Tour {...p} />);
    await goTo(9);
    await userEvent.click(screen.getByRole('button', { name: 'Turn on notifications' }));
    expect(p.notifications.enable).toHaveBeenCalled();
  });

  it('no spotlight target on screen → a centred card (never pointing at nothing)', () => {
    render(<Tour {...props({ startStep: 5 })} />);
    expect(screen.getByRole('dialog')).toHaveAttribute('data-spotlight', 'none');
  });

  it('no ISO date or internal enum label anywhere in the copy', async () => {
    render(<Tour {...props()} />);
    for (let s = 1; s <= 9; s += 1) {
      await waitFor(() => expect(screen.getByTestId('tour-count')).toHaveTextContent(`Step ${s} of 9`));
      const text = screen.getByRole('dialog').textContent ?? '';
      expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}T|\d{4}-\d{2}-\d{2}\b/);
      expect(text).not.toMatch(/whatsapp_export|trialing|payment_failed|lost_inferred|lead_status|topup_\d/);
      if (s < 9) await next();
    }
  });

  // [P46-6 · owner] the limit is 270 words now (the Ledger line joined step 8); still nine steps
  it('about 75 seconds of reading at most (≈ 250 words across the nine steps)', async () => {
    render(<Tour {...props()} />);
    let words = 0;
    for (let s = 1; s <= 9; s += 1) {
      await waitFor(() => expect(screen.getByTestId('tour-count')).toHaveTextContent(`Step ${s} of 9`));
      // The prose a rep reads: the title and body, without the example screens, buttons and step counter.
      const body = screen.getByRole('dialog').cloneNode(true) as HTMLElement;
      body.querySelectorAll('figure, button, [data-testid="tour-count"]').forEach((n) => n.remove());
      words += (body.textContent ?? '').split(/\s+/).filter(Boolean).length;
      if (s < 9) await next();
    }
    expect(words).toBeLessThanOrEqual(270); // ≈ 80 s at ~200 words a minute
  });
});

// [P42-B1] Owner: the examples fit any relationship-sales rep (insurance, wealth, B2B, luxury, recruitment,
// property), so no rep lands in what looks like a real-estate tool.
describe('[P42-B1] the tour examples are neutral', () => {
  const exampleOf = (): string => (screen.getByRole('dialog').querySelector('figure')?.textContent ?? '').replace(/\s+/g, ' ');

  it('step 3 wants a renewal, step 4 promises the revised proposal, step 5 asks about Thursday', async () => {
    render(<Tour {...props()} />);
    await goTo(3);
    expect(exampleOf()).toContain('Renewal in June · wants a lower excess · decides with her partner');
    await next();
    await waitFor(() => expect(exampleOf()).toContain('Can you send the revised proposal?'));
    expect(exampleOf()).toContain('You promised send the revised proposal');
    expect(exampleOf()).toContain("Sure, I'll send it tomorrow.");
    await next();
    expect(exampleOf()).toContain('Sara Khan : send the revised proposal by Thursday?');
  });

  it('NEGATIVE: no property words in any of the nine steps', async () => {
    render(<Tour {...props()} />);
    for (let s = 1; s <= 9; s += 1) {
      await waitFor(() => expect(screen.getByTestId('tour-count')).toHaveTextContent(`Step ${s} of 9`));
      expect(screen.getByRole('dialog').textContent).not.toMatch(/floor plans?|villa|Mirdif|\b\d+\s?BR\b|apartment|viewing|listing|bedroom/i);
      if (s < 9) await next();
    }
  });
});

// [P46-6] Owner: step 8 ("Your plan and settings") adds the Ledger after Subscription, spotlighting More (where The
// Ledger lives), still nine steps, and no step mentions referrals.
describe('[P46-6] the Ledger in step 8', () => {
  async function toStep(n: number): Promise<void> {
    for (let s = 1; s < n; s += 1) {
      await waitFor(() => expect(screen.getByTestId('tour-count')).toHaveTextContent(`Step ${s} of 9`));
      await next();
    }
    await waitFor(() => expect(screen.getByTestId('tour-count')).toHaveTextContent(`Step ${n} of 9`));
  }

  it('step 8 says what The Ledger is, after the subscription lines', async () => {
    render(<Tour {...props()} />);
    await toStep(8);
    const dialog = screen.getByRole('dialog');
    expect(screen.getByRole('heading', { name: 'Your plan and settings' })).toBeInTheDocument();
    const line = within(dialog).getByTestId('tour-ledger');
    // [P47-4 · owner] the line now covers the clients won back too
    expect(line.textContent).toBe('The Ledger shows the deals and clients Tovira helped you win.');
    expect(line.querySelector('strong')?.textContent).toBe('The Ledger');
    const text = dialog.textContent ?? '';
    expect(text.indexOf('Subscribe here any time')).toBeLessThan(text.indexOf('The Ledger shows'));
  });

  it('step 8 spotlights More (where The Ledger is) as well as the subscription', async () => {
    const more = document.createElement('button');
    more.setAttribute('data-tour', 'nav-more');
    more.getBoundingClientRect = () => ({ top: 700, left: 312, width: 78, height: 44, bottom: 744, right: 390, x: 312, y: 700, toJSON: () => ({}) }); // inside jsdom's 768px window
    document.body.appendChild(more);
    try {
      render(<Tour {...props()} />);
      await toStep(8);
      await waitFor(() => expect(document.querySelector('[data-testid="tour-spot-2"]')).not.toBeNull());
      // the card moves to the top, away from More at the bottom (it covered it when centred)
      expect(screen.getByRole('dialog')).toHaveClass('tov-tour__card--top');
    } finally {
      more.remove();
    }
  });

  it('NEGATIVE: still nine steps, and no step mentions referrals or a free month', async () => {
    render(<Tour {...props()} />);
    for (let s = 1; s <= 9; s += 1) {
      await waitFor(() => expect(screen.getByTestId('tour-count')).toHaveTextContent(`Step ${s} of 9`));
      expect(screen.getByRole('dialog').textContent).not.toMatch(/referr|free month|you both get/i);
      if (s < 9) await next();
    }
  });
});
