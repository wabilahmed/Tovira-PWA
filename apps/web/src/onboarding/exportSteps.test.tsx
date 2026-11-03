import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { detectPlatform, ExportSteps, EXPORT_STEPS, stepsFor } from './exportSteps.js';

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

  // [P64 · owner] was three lines each; now four: save the export, then choose it here
  it('four lines per platform', () => {
    expect(EXPORT_STEPS.ios).toHaveLength(4);
    expect(EXPORT_STEPS.android).toHaveLength(4);
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

// [P64 · owner] Steps that match the rep's situation. Sharing into Tovira only works from the installed app on Android,
// and it isn't proven to work end to end yet, so until it is NO ONE is told to share into Tovira: everyone saves the
// export and chooses it here. iPhone never can (iOS doesn't share into web apps). On Android in the browser, a small tip
// offers to add Tovira to the home screen; never on iPhone.
describe('[P64] the steps for each situation', () => {
  const SHARE = /choose tovira from the share list/i;
  const install = (state: 'available' | 'unavailable' | 'installed' = 'available') => ({ getState: () => state, promptInstall: vi.fn(async () => "accepted" as const), subscribe: () => () => undefined });
  it('Android in the browser: save to device, then choose it here; the install tip with its button', async () => {
    const inst = install();
    render(<ExportSteps nav={{ userAgent: ANDROID }} standalone={false} install={inst} />);
    expect(screen.getByRole('tab', { name: 'Android' })).toHaveAttribute('aria-selected', 'true');
    expect(EXPORT_STEPS.android).toEqual([
      'In WhatsApp, open the chat and tap ⋮ at the top right.',
      'Tap More, then Export chat, then Without media.',
      'Choose Save to device (or Files). It saves as a .zip.',
      'Come back here and tap Choose the chat export below.',
    ]);
    for (const line of EXPORT_STEPS.android) expect(screen.getByText(line)).toBeInTheDocument();
    expect(screen.queryByText(SHARE)).toBeNull();
    expect(screen.getByTestId('install-tip')).toHaveTextContent('Tip: add Tovira to your home screen, and you can share chats straight from WhatsApp.');
    await userEvent.click(screen.getByRole('button', { name: 'Add to home screen' }));
    expect(inst.promptInstall).toHaveBeenCalled();
  });
  it('Android in the browser without the install prompt: the tip, no button', () => {
    render(<ExportSteps nav={{ userAgent: ANDROID }} standalone={false} install={install('unavailable')} />);
    expect(screen.getByTestId('install-tip')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add to home screen' })).toBeNull();
  });
  it('Android, installed: the same save-and-choose steps while sharing is unproven; no install tip', () => {
    render(<ExportSteps nav={{ userAgent: ANDROID }} standalone install={install('installed')} />);
    for (const line of EXPORT_STEPS.android) expect(screen.getByText(line)).toBeInTheDocument();
    expect(screen.queryByText(SHARE)).toBeNull();
    expect(screen.queryByTestId('install-tip')).toBeNull();
  });
  it('iPhone in the browser and iPhone installed: save to Files, then choose it here; never the share list, never the tip', () => {
    expect(EXPORT_STEPS.ios).toEqual([
      "In WhatsApp, open the chat and tap the contact's name at the top.",
      'Scroll down and tap Export Chat, then Without Media.',
      'Choose Save to Files, and save it anywhere (for example, On My iPhone).',
      'Come back here, tap Choose the chat export below, and pick the file.',
    ]);
    for (const standalone of [false, true]) {
      const { unmount } = render(<ExportSteps nav={{ userAgent: IPHONE }} standalone={standalone} install={install()} />);
      expect(screen.getByRole('tab', { name: 'iPhone' })).toHaveAttribute('aria-selected', 'true');
      for (const line of EXPORT_STEPS.ios) expect(screen.getByText(line)).toBeInTheDocument();
      expect(screen.queryByText(SHARE)).toBeNull();
      expect(screen.queryByTestId('install-tip')).toBeNull();
      unmount();
    }
  });
  it('NEGATIVE: on an iPhone, even the Android tab never shows the install tip', async () => {
    render(<ExportSteps nav={{ userAgent: IPHONE }} standalone={false} install={install()} />);
    await userEvent.click(screen.getByRole('tab', { name: 'Android' }));
    expect(screen.queryByTestId('install-tip')).toBeNull();
  });
  it('NEGATIVE: "Choose Tovira from the share list" is in no step list while sharing is unproven', () => {
    expect([...EXPORT_STEPS.ios, ...EXPORT_STEPS.android].some((l) => SHARE.test(l))).toBe(false);
    expect(stepsFor('android', true)).toEqual(EXPORT_STEPS.android);
    expect(stepsFor('android', true, { shareProven: true })).toContain('Choose Tovira from the share list.');
    expect(stepsFor('ios', true, { shareProven: true })).toEqual(EXPORT_STEPS.ios); // iPhone never, proven or not
  });
});

describe('[P64] "Choose the chat export below" names a real button', () => {
  it('the client page\'s chat import labels its file field that way', async () => {
    const { ImportChat } = await import('../import/ImportChat.js');
    render(<ImportChat clientId="c1" api={{ importWhatsApp: vi.fn() } as never} onImported={vi.fn()} />);
    expect(screen.getByText(/^Choose the chat export \(\.zip or \.txt\)/)).toBeInTheDocument();
  });
});
