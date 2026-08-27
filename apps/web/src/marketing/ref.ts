/**
 * Referral + campaign pass-through (SITE-3, growth loop P5-6). The CTAs are
 * plain links to the app and work with no JS at all. This progressive
 * enhancement carries the landing page's incoming query — `?ref=…`, `utm_*`,
 * anything — through to the app URL unchanged, so an attributed visit stays
 * attributed after the click.
 */

/** Append a search string's params to a link, unchanged. A RELATIVE href (the
 *  same-origin `/app` CTA, now that the site lives in the PWA) stays relative;
 *  an ABSOLUTE href (an env-overridden app URL) keeps its own origin. */
export function withParams(href: string, search: string, origin: string): string {
  const incoming = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const url = new URL(href, origin);
  for (const [key, value] of incoming) url.searchParams.set(key, value);
  const isAbsolute = /^[a-z][a-z0-9+.-]*:\/\//i.test(href);
  return isAbsolute ? url.toString() : url.pathname + url.search + url.hash;
}

/** Swap a link's origin for the configured app URL (env override), path intact. */
export function withAppUrl(href: string, origin: string, appUrl?: string): string {
  if (!appUrl) return href;
  try {
    const u = new URL(href, origin);
    const app = new URL(appUrl);
    u.protocol = app.protocol;
    u.host = app.host;
    return u.toString();
  } catch {
    return href;
  }
}

/** Enhance every CTA (→ app) in `root` with the incoming query so a referral code
 *  rides through to signup. Idempotent-safe: setting an unchanged href is harmless. */
export function enhanceLinks(root: Document | Element, search: string, origin: string, appUrl?: string): void {
  root.querySelectorAll<HTMLAnchorElement>('[data-cta]').forEach((a) => {
    const base = withAppUrl(a.getAttribute('href') ?? '', origin, appUrl);
    a.setAttribute('href', withParams(base, search, origin));
  });
}

// Browser auto-run: enhance once the DOM is ready. Module scripts are deferred,
// so on a real page the DOM is usually parsed by the time this runs.
if (typeof document !== 'undefined' && typeof location !== 'undefined') {
  const appUrl = import.meta.env?.VITE_APP_URL as string | undefined;
  const run = (): void => enhanceLinks(document, location.search, location.origin, appUrl);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
  else run();
}
