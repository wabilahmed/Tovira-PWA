import { useState } from 'react';

/**
 * [P37] How to export a WhatsApp chat, for the rep's own phone only. The ONE source of these instructions —
 * the tour, "New client from a chat", the chat import and the first-run guide all render <ExportSteps>, so
 * they never disagree. The export always happens on the phone, so a laptop (or an unknown device) shows both.
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

const TITLE = { ios: 'On iPhone', android: 'On Android' } as const;

export function ExportSteps({ nav }: { nav?: NavigatorLike }): JSX.Element {
  const detected = detectPlatform(nav);
  const [platform, setPlatform] = useState<Platform>(detected);
  const both = platform === 'unknown';
  const shown: Array<'ios' | 'android'> = both ? ['ios', 'android'] : [platform];
  return (
    <div className="tov-export-steps" data-testid="export-steps">
      {shown.map((p) => (
        <div key={p}>
          {both && <strong>{TITLE[p]}</strong>}
          <ol style={{ margin: '0.25rem 0 0', paddingLeft: '1.2rem' }}>
            {EXPORT_STEPS[p].map((line) => <li key={line}>{line}</li>)}
          </ol>
        </div>
      ))}
      {!both && (
        <button type="button" className="tov-link" style={{ marginTop: '0.35rem' }} onClick={() => setPlatform(platform === 'ios' ? 'android' : 'ios')}>
          {platform === 'ios' ? 'Using an Android?' : 'Using an iPhone?'}
        </button>
      )}
    </div>
  );
}
