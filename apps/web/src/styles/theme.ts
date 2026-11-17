/**
 * Theme control for the two materials (docs/tovira-brand.md §1, §11). A manual choice is pinned on <html data-theme>
 * and remembered in localStorage; Auto follows the device (handled in CSS).
 * [P71-D · owner] Anyone who has never chosen gets Dark (Vault, now the landing page's palette); a stored Light, Dark
 * or Auto is kept. The browser's theme-color (the address bar, the installed app's status bar) follows the theme in use.
 * [P74 · owner] Every page a signed-out visitor can reach is ALWAYS Dark (the landing palette), whatever is saved: while
 * a public surface is showing, the html pins data-theme="vault" and the saved choice waits in storage. The choice applies
 * only inside the signed-in app. A "signed in on this browser" hint lets the boot script paint the app in the saved
 * choice before the session check (no flash); without it, /app starts Dark (the sign-in).
 */
export type ThemeChoice = 'system' | 'vault' | 'ledger';

const KEY = 'tovira.theme';
const SIGNED_IN = 'tovira.signedIn';

/** The signed-in app's paths ('/' is the app only in dev; in production '/' is the always-dark landing page). */
export function isAppPath(pathname: string): boolean {
  return pathname === '/app' || pathname === '/';
}

let publicSurface = false;

function root(): HTMLElement | null {
  return typeof document !== 'undefined' ? document.documentElement : null;
}

export function getTheme(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'vault' || v === 'ledger' || v === 'system' ? v : 'vault';
  } catch {
    return 'vault'; // [P71-D · owner] first run defaults to Dark, even on a light device
  }
}

export const THEME_COLOR = { dark: '#171412', light: '#f4f1ea' } as const;

/** [P71-D] Point every theme-color meta at the theme in use. Auto: a meta with a media query keeps its own scheme. */
function syncThemeColor(choice: ThemeChoice): void {
  if (typeof document === 'undefined') return;
  const deviceDark = typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
  for (const m of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    const media = m.getAttribute('media') ?? '';
    const dark = choice === 'vault' || (choice === 'system' && (media ? media.includes('dark') : deviceDark));
    m.setAttribute('content', dark ? THEME_COLOR.dark : THEME_COLOR.light);
  }
}

export function applyTheme(requested: ThemeChoice): void {
  const el = root();
  if (!el) return;
  const choice: ThemeChoice = publicSurface ? 'vault' : requested; // [P74] a public page is never light
  if (choice === 'system') el.removeAttribute('data-theme');
  else el.setAttribute('data-theme', choice);
  syncThemeColor(choice);
}

export function setTheme(choice: ThemeChoice): void {
  try {
    // Store every choice (including 'system') so "no key" unambiguously means
    // first-run → Dark (P71-D), not "the user picked System".
    localStorage.setItem(KEY, choice);
  } catch {
    /* private mode — the choice just won't persist */
  }
  applyTheme(choice);
}

/** [P74] A public surface (sign-in, request access, …) is showing: pin Dark; leaving it restores the saved choice. */
export function setPublicSurface(on: boolean): void {
  publicSurface = on;
  applyTheme(getTheme());
}

/** [P74] Remember whether someone is signed in on this browser, so the next boot paints the app in its saved theme. */
export function setSignedInHint(on: boolean): void {
  try {
    if (on) localStorage.setItem(SIGNED_IN, '1');
    else localStorage.removeItem(SIGNED_IN);
  } catch {
    /* private mode */
  }
}

function signedInHint(): boolean {
  try {
    return localStorage.getItem(SIGNED_IN) === '1';
  } catch {
    return false;
  }
}

/** Apply the theme on boot (called before first paint in main.tsx), the same decision as the app.html script. */
export function initTheme(): void {
  const path = typeof location !== 'undefined' ? location.pathname : '/app';
  setPublicSurface(!(isAppPath(path) && signedInHint()));
}
