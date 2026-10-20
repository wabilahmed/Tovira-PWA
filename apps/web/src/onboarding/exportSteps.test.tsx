import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { detectPlatform, ExportSteps, EXPORT_STEPS } from './exportSteps.js';

/**
 * [P37] How to export a WhatsApp chat — for the rep's own phone only. One shared helper for every place the
 * instructions appear (the tour, "New client from a chat", the chat import, the first-run guide), so they never
 * disagree. iPhone → iPhone steps; Android → Android steps; a laptop or unknown device → both, labelled; a
 * "Using an Android?" / "Using an iPhone?" link switches when detection is wrong.
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

  it('an iPhone sees only the iPhone steps', () => {
    render(<ExportSteps nav={{ userAgent: IPHONE }} />);
    for (const line of EXPORT_STEPS.ios) expect(screen.getByText(line)).toBeInTheDocument();
    for (const line of EXPORT_STEPS.android) expect(screen.queryByText(line)).toBeNull();
    expect(screen.queryByText('On Android')).toBeNull();
  });

  it('an Android phone sees only the Android steps', () => {
    render(<ExportSteps nav={{ userAgent: ANDROID }} />);
    for (const line of EXPORT_STEPS.android) expect(screen.getByText(line)).toBeInTheDocument();
    for (const line of EXPORT_STEPS.ios) expect(screen.queryByText(line)).toBeNull();
  });

  it('a laptop (or unknown device) sees both, labelled "On iPhone" / "On Android"', () => {
    render(<ExportSteps nav={{ userAgent: DESKTOP }} />);
    expect(screen.getByText('On iPhone')).toBeInTheDocument();
    expect(screen.getByText('On Android')).toBeInTheDocument();
    for (const line of [...EXPORT_STEPS.ios, ...EXPORT_STEPS.android]) expect(screen.getByText(line)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Using an/ })).toBeNull();
  });

  it('"Using an Android?" switches an iPhone guess to the Android steps, and back', async () => {
    render(<ExportSteps nav={{ userAgent: IPHONE }} />);
    await userEvent.click(screen.getByRole('button', { name: 'Using an Android?' }));
    expect(screen.getByText(EXPORT_STEPS.android[0]!)).toBeInTheDocument();
    expect(screen.queryByText(EXPORT_STEPS.ios[0]!)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Using an iPhone?' }));
    expect(screen.getByText(EXPORT_STEPS.ios[0]!)).toBeInTheDocument();
  });
});
