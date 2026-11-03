import { useEffect, useState } from 'react';
import { Button } from '../ui/Button.js';
import { detectStandalone } from './onboarding.js';
import { controller as installController } from '../pwa/InstallBanner.js';
import { Card } from '../ui/Card.js';
import { Tabs } from '../ui/Tabs.js';

/**
 * [P37] How to export a WhatsApp chat, for the rep's own phone only. The ONE source of these instructions —
 * the tour, "New client from a chat", the chat import and the first-run guide all render <ExportSteps>, so
 * they never disagree.
 */
export type Platform = 'ios' | 'android' | 'unknown';

/**
 * [P64 · owner] Four lines each: save the export, then choose it here. Sharing into Tovira only works from the installed
 * app on Android (iOS never shares into web apps), and it isn't proven end to end yet, so until SHARE_INTO_TOVIRA_PROVEN
 * no one is told to share into Tovira.
 */
export const SHARE_INTO_TOVIRA_PROVEN = false;
export const EXPORT_STEPS: Readonly<Record<'ios' | 'android', readonly string[]>> = {
  ios: [
    "In WhatsApp, open the chat and tap the contact's name at the top.",
    'Scroll down and tap Export Chat, then Without Media.',
    'Choose Save to Files, and save it anywhere (for example, On My iPhone).',
    'Come back here, tap Choose the chat export below, and pick the file.',
  ],
  android: [
    'In WhatsApp, open the chat and tap ⋮ at the top right.',
    'Tap More, then Export chat, then Without media.',
    'Choose Save to device (or Files). It saves as a .zip.',
    'Come back here and tap Choose the chat export below.',
  ],
};
/** Android, installed, once sharing is proven: share straight from WhatsApp. */
const ANDROID_SHARE_STEPS: readonly string[] = [
  'In WhatsApp, open the chat and tap ⋮ at the top right.',
  'Tap More, then Export chat, then Without media.',
  'Choose Tovira from the share list.',
];

/** The steps for a tab: the share list only on Android, installed, and only once sharing is proven. */
export function stepsFor(platform: 'ios' | 'android', installed: boolean, opts: { shareProven?: boolean } = {}): readonly string[] {
  return platform === 'android' && installed && (opts.shareProven ?? SHARE_INTO_TOVIRA_PROVEN) ? ANDROID_SHARE_STEPS : EXPORT_STEPS[platform];
}

export interface NavigatorLike {
  userAgent?: string;
  userAgentData?: { platform?: string; mobile?: boolean } | null;
}

/** userAgentData where the browser has it (Chromium), otherwise the user agent string. */
export function detectPlatform(nav: NavigatorLike | undefined = typeof navigator !== 'undefined' ? (navigator as NavigatorLike) : undefined): Platform {
  const p = nav?.userAgentData?.platform?.toLowerCase() ?? '';
  if (p === 'android') return 'android';
  if (p === 'ios') return 'ios';
  const ua = nav?.userAgent ?? '';
  if (/android/i.test(ua)) return 'android';
  if (/iphone|ipad|ipod/i.test(ua)) return 'ios';
  return 'unknown';
}

const TAB_LABEL = { ios: 'iPhone', android: 'Android' } as const;

/** [P39 · owner] iPhone | Android tabs with the detected phone pre-selected (a laptop or unknown device starts on
 *  iPhone), the three steps as a numbered list in a card. No loose "Using an Android?" link: the tab is the switch. */
/** [P64] What ExportSteps needs from the install prompt (pwa/InstallBanner's controller). */
export interface InstallPromptLike {
  getState(): 'unavailable' | 'available' | 'installed';
  promptInstall(): Promise<unknown>;
  subscribe(listener: (state: 'unavailable' | 'available' | 'installed') => void): () => void;
}

/** [P64] Installed: display-mode standalone, or navigator.standalone on iOS. */
function isInstalled(): boolean {
  return typeof window !== 'undefined' ? detectStandalone(window as unknown as Parameters<typeof detectStandalone>[0]) : false;
}

export function ExportSteps({ nav, standalone, install }: { nav?: NavigatorLike; /** [P64] defaults to the real display mode */ standalone?: boolean; /** [P64] defaults to the app's install prompt */ install?: InstallPromptLike | null }): JSX.Element {
  const detected = detectPlatform(nav);
  const installed = standalone ?? isInstalled();
  const prompt = install === undefined ? installController : install;
  const [platform, setPlatform] = useState<'ios' | 'android'>(detected === 'android' ? 'android' : 'ios');
  const [installState, setInstallState] = useState(() => prompt?.getState() ?? 'unavailable');
  useEffect(() => prompt?.subscribe(setInstallState), [prompt]);
  // [P64 · owner] the home-screen tip: Android, in the browser, on the Android tab; never on an iPhone
  const showTip = detected === 'android' && !installed && platform === 'android';
  return (
    <Card data-testid="export-steps">
      <Tabs label="Your phone" tabs={(['ios', 'android'] as const).map((p) => ({ value: p, label: TAB_LABEL[p] }))} value={platform} onChange={setPlatform}>
        <ol className="ui-numbered">
          {stepsFor(platform, installed).map((line) => <li key={line}>{line}</li>)}
        </ol>
        {showTip && (
          <div className="ui-cluster ui-gap-2" data-testid="install-tip" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
            <p className="ui-caption" style={{ margin: 0 }}>Tip: add Tovira to your home screen, and you can share chats straight from WhatsApp.</p>
            {installState === 'available' && prompt && <Button size="sm" onClick={() => void prompt.promptInstall()}>Add to home screen</Button>}
          </div>
        )}
      </Tabs>
    </Card>
  );
}
