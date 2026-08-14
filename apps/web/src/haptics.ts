/**
 * One short haptic tick to confirm a moment that matters — a promise kept, a
 * note saved. Nothing else buzzes: haptics are a quiet "got it", not a
 * notification channel. Feature-detected, so browsers without the Vibration API
 * — notably iOS PWAs, which never expose it — silently get nothing. Never
 * throws; a blocked or failing vibrate is swallowed.
 */
interface Vibrator {
  vibrate?: (pattern: number | number[]) => boolean;
}

const TICK_MS = 15;

export function hapticTick(nav: Vibrator | undefined = typeof navigator !== 'undefined' ? navigator : undefined): void {
  if (typeof nav?.vibrate !== 'function') return; // no Vibration API (e.g. iOS PWA)
  try {
    nav.vibrate(TICK_MS);
  } catch {
    /* best-effort — a blocked/failed vibrate must never surface to the user */
  }
}
