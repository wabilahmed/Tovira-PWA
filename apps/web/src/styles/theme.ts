/**
 * Theme control for the two materials (docs/tovira-brand.md §1, §11). brand v1.2:
 * **Ledger (light) is the default**; Vault (dark) is the equal low-light option.
 * With no explicit choice we follow the system preference (handled in CSS —
 * light by default, dark when the device prefers dark); a manual choice is pinned
 * on <html data-theme> and remembered in localStorage.
 */
export type ThemeChoice = 'system' | 'vault' | 'ledger';

const KEY = 'tovira.theme';

function root(): HTMLElement | null {
  return typeof document !== 'undefined' ? document.documentElement : null;
}

export function getTheme(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'vault' || v === 'ledger' || v === 'system' ? v : 'ledger';
  } catch {
    return 'ledger'; // first run defaults to Ledger (light), even on a dark device
  }
}

export function applyTheme(choice: ThemeChoice): void {
  const el = root();
  if (!el) return;
  if (choice === 'system') el.removeAttribute('data-theme');
  else el.setAttribute('data-theme', choice);
}

export function setTheme(choice: ThemeChoice): void {
  try {
    // Store every choice (including 'system') so "no key" unambiguously means
    // first-run → Ledger (light), not "the user picked System".
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
