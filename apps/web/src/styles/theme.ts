/**
 * Theme control for the two materials (docs/tovira-brand.md §1, §11). A manual choice is pinned on <html data-theme>
 * and remembered in localStorage; Auto follows the device (handled in CSS).
 * [P71-D · owner] Anyone who has never chosen gets Dark (Vault, now the landing page's palette); a stored Light, Dark
 * or Auto is kept. The browser's theme-color (the address bar, the installed app's status bar) follows the theme in use.
 */
export type ThemeChoice = 'system' | 'vault' | 'ledger';

const KEY = 'tovira.theme';

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

export function applyTheme(choice: ThemeChoice): void {
  const el = root();
  if (!el) return;
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

/** Apply the saved choice on boot (called before first paint in main.tsx). */
export function initTheme(): void {
  applyTheme(getTheme());
}
