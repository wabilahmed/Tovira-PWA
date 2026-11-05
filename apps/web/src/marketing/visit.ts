/**
 * [P63-7 · owner] The cookieless page-view beacon: which page, the referrer (the server keeps only its domain), and UTM
 * source and campaign from the address. Nothing is stored in the browser (no cookie, no local storage) and nothing
 * identifies the person; the server counts unique visitors per day by a hash it throws away at the end of the day.
 * Best-effort: never throws, never delays the page.
 */
export type VisitPage = 'landing' | 'request_access' | 'sign_in' | 'privacy';

export function sendVisit(page: VisitPage): void {
  try {
    const q = new URLSearchParams(location.search);
    const body = JSON.stringify({ page, referrer: document.referrer || null, utmSource: q.get('utm_source'), utmCampaign: q.get('utm_campaign') });
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      navigator.sendBeacon('/api/visit', new Blob([body], { type: 'text/plain' }));
    } else {
      void fetch('/api/visit', { method: 'POST', body, keepalive: true, credentials: 'omit', headers: { 'content-type': 'text/plain' } }).catch(() => undefined);
    }
  } catch {
    /* never in the way */
  }
}
