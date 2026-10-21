import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { detectPlatform, ExportSteps, EXPORT_STEPS } from './exportSteps.js';

/**
 * [P37] How to export a WhatsApp chat — for the rep's own phone only. One shared helper for every place the
 * instructions appear (the tour, "New client from a chat", the chat import, the first-run guide), so they never
 * disagree. [P39] iPhone | Android tabs, the detected phone pre-selected.
 */
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36';
const DESKTOP = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

describe('[P37] export instructions for the rep\'s own phone', () => {
  it('detects the platform from userAgentData when present, else the user agent', () => {
    expect(detectPlatform({ userAgent: IPHONE })).toBe('ios');
    expect(detectPlatform({ userAgent: ANDROID })).toBe('android');
    expect(detectPlatform({ userAgent: DESKTOP })).toBe('unknown');
    expect(detectPlatform({ userAgent: DESKTOP, userAgentData: { platform: 'Android', mobile: true } })).toBe('android');
    expect(detectPlatform({ userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X)' })).toBe('ios');
  });

  it('three lines per platform', () => {
    expect(EXPORT_STEPS.ios).toHaveLength(3);
    expect(EXPORT_STEPS.android).toHaveLength(3);
  });

  // [P39 · owner] The steps are iPhone | Android tabs (detected phone pre-selected); the loose "Using an
  // Android?" link is gone; a laptop or unknown device starts on the iPhone tab instead of showing both.
  it('an iPhone starts on the iPhone tab and sees only the iPhone steps', () => {
    render(<ExportSteps nav={{ userAgent: IPHONE }} />);
    expect(screen.getByRole('tab', { name: 'iPhone' })).toHaveAttribute('aria-selected', 'true');
    for (const line of EXPORT_STEPS.ios) expect(screen.getByText(line)).toBeInTheDocument();
    for (const line of EXPORT_STEPS.android) expect(screen.queryByText(line)).toBeNull();
  });

  it('an Android phone starts on the Android tab and sees only the Android steps', () => {
    render(<ExportSteps nav={{ userAgent: ANDROID }} />);
    expect(screen.getByRole('tab', { name: 'Android' })).toHaveAttribute('aria-selected', 'true');
    for (const line of EXPORT_STEPS.android) expect(screen.getByText(line)).toBeInTheDocument();
    for (const line of EXPORT_STEPS.ios) expect(screen.queryByText(line)).toBeNull();
  });

  it('a laptop (or unknown device) starts on iPhone; no "Using an …?" link anywhere', () => {
    render(<ExportSteps nav={{ userAgent: DESKTOP }} />);
    expect(screen.getByRole('tab', { name: 'iPhone' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByRole('button', { name: /Using an/ })).toBeNull();
  });

  it('the tabs switch between the steps, and back; the steps are a numbered list', async () => {
    render(<ExportSteps nav={{ userAgent: IPHONE }} />);
    await userEvent.click(screen.getByRole('tab', { name: 'Android' }));
    expect(screen.getByText(EXPORT_STEPS.android[0]!)).toBeInTheDocument();
    expect(screen.queryByText(EXPORT_STEPS.ios[0]!)).toBeNull();
    await userEvent.click(screen.getByRole('tab', { name: 'iPhone' }));
    expect(screen.getByText(EXPORT_STEPS.ios[0]!)).toBeInTheDocument();
    expect(screen.getByTestId('export-steps').querySelector('ol')).not.toBeNull();
  });
});
