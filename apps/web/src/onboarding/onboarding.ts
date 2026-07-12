/**
 * Onboarding guidance for notifications (P3-6). On iOS, Web Push only works once
 * the PWA is installed to the home screen — so if the rep skips install we must
 * say so clearly and point them at the in-app fallback, never a silent dead
 * feature.
 */

export interface OnboardingState {
  standalone: boolean; // running as an installed PWA
  notificationPermission: 'default' | 'granted' | 'denied';
  pushSupported: boolean;
}

export interface OnboardingStep {
  stage: 'install' | 'enable' | 'blocked' | 'ready';
  message: string;
}

export function detectStandalone(win: { matchMedia?: (q: string) => { matches: boolean }; navigator?: { standalone?: boolean } }): boolean {
  if (win.navigator?.standalone === true) return true; // iOS Safari
  return win.matchMedia?.('(display-mode: standalone)').matches ?? false;
}

export function onboardingStep(state: OnboardingState): OnboardingStep {
  if (!state.pushSupported || !state.standalone) {
    return {
      stage: 'install',
      message:
        'Add Tovira to your home screen to turn on notifications. Until you do, nudges and alerts won’t arrive — but you can still open the app any time to see who’s going cold.',
    };
  }
  if (state.notificationPermission === 'denied') {
    return {
      stage: 'blocked',
      message: 'Notifications are blocked. Enable them in your browser settings, or rely on the in-app cold list.',
    };
  }
  if (state.notificationPermission !== 'granted') {
    return { stage: 'enable', message: 'Enable notifications to get a nudge before each meeting.' };
  }
  return { stage: 'ready', message: 'You’re all set — notifications are on.' };
}
