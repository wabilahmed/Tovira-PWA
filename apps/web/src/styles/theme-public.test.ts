// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { applyTheme, getTheme, initTheme, isAppPath, setPublicSurface, setSignedInHint, setTheme } from './theme.js';

/**
 * [P74 · owner] "Make every public page ALWAYS dark with the landing palette, whatever the saved theme." The public
 * pages (Privacy, Terms, request access, sign-in, reset password, invite, verify email, the admin sign-in, the billing
 * return pages, the 404) pin data-theme="vault": the Dark token block, which IS the landing palette (theme-p71 pins
 * it), never a second copy of the colours. Inside the signed-in app the saved choice is kept, Dark when never chosen.
 * [P89 · owner, Prompt 86] "Public pages are now always light, in the Marker look ... This replaces the earlier rule that
 * public pages are always dark." Every assertion below that pinned a public page to Dark ('vault', #171412) now pins it
 * to Marker ('marker', #FAFAFA). The signed-in app is unchanged (its saved choice, Dark when never chosen).
 */
const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const html = document.documentElement;
const metas = '<meta name="theme-color" content="#f4f1ea" media="(prefers-color-scheme: light)"><meta name="theme-color" content="#171412" media="(prefers-color-scheme: dark)">';

beforeEach(() => {
  localStorage.clear();
  html.removeAttribute('data-theme');
  document.head.innerHTML = metas;
  setPublicSurface(false);
});

describe('[P74→P89] Privacy and Terms are always Marker', () => {
  for (const p of ['../../privacy/index.html', '../../terms/index.html']) {
    it(`${p}: pinned to Marker in the HTML, no saved theme is read, theme-color #FAFAFA`, () => {
      const src = read(p);
      expect(src).toMatch(/<html lang="en" data-theme="marker">/);
      expect(src).not.toMatch(/data-theme="(ledger|vault)"/);
      expect(src).not.toMatch(/tovira\.theme/);
      expect(src).toMatch(/<meta name="theme-color" content="#FAFAFA" \/>/);
      expect(src).not.toMatch(/#f4f1ea|#171412/);
    });
  }
});

describe('[P74→P89] the app boot script (app.html): Marker on every public page, the saved choice only in the signed-in app', () => {
  const script = /<script>([\s\S]*?tovira\.theme[\s\S]*?)<\/script>/.exec(read('../../app.html'))![1]!;
  const run = (path: string): string | null => {
    window.history.replaceState({}, '', path);
    html.removeAttribute('data-theme');
    new Function(script)();
    return html.getAttribute('data-theme');
  };
  it('a saved Light is ignored on every public path, signed in before or not', () => {
    localStorage.setItem('tovira.theme', 'ledger');
    for (const hint of [null, '1']) {
      if (hint) localStorage.setItem('tovira.signedIn', hint); else localStorage.removeItem('tovira.signedIn');
      for (const p of ['/request-access', '/reset-password?token=x', '/invite?token=x', '/verify-email?token=x', '/admin', '/admin/access', '/billing/success', '/billing/cancel', '/no-such-page']) {
        expect(run(p), `${p} hint ${hint}`).toBe('marker');
      }
    }
    expect([...document.querySelectorAll('meta[name="theme-color"]')].map((m) => m.getAttribute('content'))).toEqual(['#FAFAFA', '#FAFAFA']);
  });
  it('sign-in (/app with nobody signed in on this browser) is Marker, whatever is saved', () => {
    for (const s of ['ledger', 'system', 'vault']) { localStorage.setItem('tovira.theme', s); expect(run('/app'), s).toBe('marker'); }
  });
  it('the signed-in app keeps the saved choice before first paint; never chose = Dark', () => {
    localStorage.setItem('tovira.signedIn', '1');
    expect(run('/app')).toBe('vault');
    localStorage.setItem('tovira.theme', 'ledger');
    expect(run('/app')).toBe('ledger');
    expect(run('/app?view=settings')).toBe('ledger');
    localStorage.setItem('tovira.theme', 'system');
    expect(run('/app')).toBeNull();
  });
});

describe('[P74] theme.ts: the public surface', () => {
  it('isAppPath: only the signed-in app paths', () => {
    for (const p of ['/app', '/']) expect(isAppPath(p), p).toBe(true);
    for (const p of ['/request-access', '/reset-password', '/invite', '/verify-email', '/admin', '/admin/access', '/billing/success', '/billing/cancel', '/privacy', '/nope']) expect(isAppPath(p), p).toBe(false);
  });
  it('a public surface is Marker with a saved Light or Dark; leaving it restores the saved choice', () => {
    setTheme('ledger');
    expect(html.getAttribute('data-theme')).toBe('ledger');
    setPublicSurface(true);
    expect(html.getAttribute('data-theme')).toBe('marker');
    expect([...document.querySelectorAll('meta[name="theme-color"]')].map((m) => m.getAttribute('content'))).toEqual(['#FAFAFA', '#FAFAFA']);
    applyTheme('vault');
    expect(html.getAttribute('data-theme'), 'nothing can paint a public page in an app theme').toBe('marker');
    expect(getTheme(), 'Marker is never stored as a choice').toBe('ledger');
    setPublicSurface(false);
    expect(html.getAttribute('data-theme')).toBe('ledger');
    expect(getTheme()).toBe('ledger');
  });
  it('initTheme on a public path is Marker, on the app path with a signed-in hint it is the saved choice', () => {
    localStorage.setItem('tovira.theme', 'ledger');
    window.history.replaceState({}, '', '/request-access');
    initTheme();
    expect(html.getAttribute('data-theme')).toBe('marker');
    window.history.replaceState({}, '', '/app');
    initTheme();
    expect(html.getAttribute('data-theme'), 'nobody signed in on this browser yet').toBe('marker');
    setSignedInHint(true);
    initTheme();
    expect(html.getAttribute('data-theme')).toBe('ledger');
    setSignedInHint(false);
    expect(localStorage.getItem('tovira.signedIn')).toBeNull();
  });
  it('a fresh browser gets Dark in the app', () => {
    window.history.replaceState({}, '', '/app');
    setSignedInHint(true);
    localStorage.removeItem('tovira.theme');
    initTheme();
    expect(getTheme()).toBe('vault');
    expect(html.getAttribute('data-theme')).toBe('vault');
  });
});
