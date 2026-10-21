import { useState } from 'react';
import { Card } from '../ui/Card.js';
import { Tabs } from '../ui/Tabs.js';

/**
 * [P37] How to export a WhatsApp chat, for the rep's own phone only. The ONE source of these instructions —
 * the tour, "New client from a chat", the chat import and the first-run guide all render <ExportSteps>, so
 * they never disagree.
 */
export type Platform = 'ios' | 'android' | 'unknown';

/** Three lines each. iPhone exports a .zip and can't share into a web app, so it saves to Files first. */
export const EXPORT_STEPS: Readonly<Record<'ios' | 'android', readonly string[]>> = {
  ios: [
    "In WhatsApp, open the chat and tap the contact's name at the top.",
    'Tap Export Chat, then Without Media.',
    'Tap Save to Files, then choose the file in Tovira.',
  ],
  android: [
    'In WhatsApp, open the chat and tap ⋮ at the top right.',
    'Tap More, then Export chat, then Without media.',
    'Choose Tovira from the share list.',
  ],
};

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
export function ExportSteps({ nav }: { nav?: NavigatorLike }): JSX.Element {
  const detected = detectPlatform(nav);
  const [platform, setPlatform] = useState<'ios' | 'android'>(detected === 'android' ? 'android' : 'ios');
  return (
    <Card data-testid="export-steps">
      <Tabs label="Your phone" tabs={(['ios', 'android'] as const).map((p) => ({ value: p, label: TAB_LABEL[p] }))} value={platform} onChange={setPlatform}>
        <ol className="ui-numbered">
          {EXPORT_STEPS[platform].map((line) => <li key={line}>{line}</li>)}
        </ol>
      </Tabs>
    </Card>
  );
}
