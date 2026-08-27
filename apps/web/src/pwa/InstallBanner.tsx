import { useSyncExternalStore } from 'react';
import { InstallPromptController } from './installPrompt.js';
import { detectStandalone } from '../onboarding/onboarding.js';
import { hapticTick } from '../haptics.js';

/**
 * A slim, self-hiding "Install Tovira" banner (P0-5). Chrome won't pop an install
 * banner on its own, so we capture `beforeinstallprompt` and offer a real button.
 * Renders ONLY when the browser has deemed the app installable and it isn't already
 * installed; silent on iOS (no such event — the onboarding copy points there to
 * Share → Add to Home Screen) and once installed.
 */

// One controller per document, wired to the real window. Guarded so the module is
// import-safe under SSR / jsdom (where `window` may be absent).
const controller =
  typeof window !== 'undefined'
    ? new InstallPromptController(window, detectStandalone(window as unknown as Parameters<typeof detectStandalone>[0]))
    : null;

function useInstallState(): 'unavailable' | 'available' | 'installed' {
  return useSyncExternalStore(
    (cb) => controller?.subscribe(cb) ?? (() => {}),
    () => controller?.getState() ?? 'unavailable',
    () => 'unavailable',
  );
}

export function InstallBanner(): JSX.Element | null {
  const state = useInstallState();
  if (state !== 'available') return null;
  return (
    <div className="tov-install" role="region" aria-label="Install Tovira">
      <p className="tov-install__copy">
        Add Tovira to your home screen — one tap to open, and notifications before each meeting.
      </p>
      <button
        type="button"
        className="tov-primary tov-install__btn"
        onClick={() => {
          hapticTick();
          void controller?.promptInstall();
        }}
      >
        Install
      </button>
    </div>
  );
}
