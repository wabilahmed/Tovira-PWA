import { createHash, randomBytes } from 'node:crypto';

/**
 * [P63-7 · owner] Site visits, cookieless and first-party. Page views on the landing page, request access, sign-in and
 * the privacy page; unique visitors per day by a hash of IP + user agent + a salt for that day. The salt is random, kept
 * only for its day and then thrown away, and the hash is cleared at the end of the day (only the day's counts remain).
 * The raw IP is never stored. No cookies, no local storage, nothing per person. Also kept per view: the referrer's
 * domain only, UTM source and campaign, and phone or desktop. Bots don't count; neither do signed-in admins (an admin
 * request marks that day's hash, and its views are dropped). Owner plane; shown only in Admin → Funnel.
 */
export const VISIT_PAGES = ['landing', 'request_access', 'sign_in', 'privacy'] as const;
export type VisitPage = (typeof VISIT_PAGES)[number];
/** Recorded by the server when a request form is submitted (never sent by a page). */
export type VisitEvent = VisitPage | 'submitted';
export type Device = 'phone' | 'desktop';

export interface PageView { day: string; page: VisitEvent; referrerDomain: string | null; utmSource: string | null; utmCampaign: string | null; device: Device; visitorHash: string | null }
export interface DayRollup { day: string; views: number; uniques: number; landingUniques: number; reachedRequest: number; submitted: number }

export interface VisitStore {
  /** The day's salt: created once for that day (random), the same for every call that day. */
  saltFor(day: string, fresh: () => string): Promise<string>;
  isExcluded(day: string, hash: string): Promise<boolean>;
  /** Mark an admin's hash for the day and drop that day's views with it. */
  exclude(day: string, hash: string): Promise<void>;
  add(view: PageView): Promise<void>;
  /** Days before `today` whose hashes are still held: write their counts, clear the hashes, delete their salts and
   *  exclusions. */
  rollupBefore(today: string): Promise<number>;
  views(sinceDay: string | null): Promise<PageView[]>;
  rollups(sinceDay: string | null): Promise<DayRollup[]>;
}

const BOT = /bot|health|crawl|spider|slurp|facebookexternalhit|embedly|preview|monitor|uptime|pingdom|headless|lighthouse|curl|wget|python-requests|go-http-client|axios|node-fetch|okhttp|httpclient|java\//i;
export const isBot = (ua: string): boolean => !ua.trim() || BOT.test(ua);
export const deviceOf = (ua: string): Device => (/Mobi|Android|iPhone|iPod/i.test(ua) ? 'phone' : 'desktop');
export const utcDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** The referrer's domain only (no path, no query), lower-case, without "www."; our own domain is not a referrer. */
export function referrerDomain(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    const host = new URL(raw.includes('://') ? raw : `https://${raw}`).hostname.toLowerCase().replace(/^www\./, '');
    if (!host || host === 'tovira.io' || host.endsWith('.tovira.io') || host === 'localhost') return null;
    return host.slice(0, 120);
  } catch { return null; }
}
const tag = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim().toLowerCase().slice(0, 80) : null);

export class VisitService {
  constructor(private readonly store: VisitStore, private readonly now: () => number = () => Date.now()) {}

  private async hash(day: string, ip: string, ua: string): Promise<string> {
    const salt = await this.store.saltFor(day, () => randomBytes(32).toString('hex'));
    return createHash('sha256').update(`${salt}|${ip}|${ua}`).digest('hex');
  }

  /** A page view from a page's beacon. Returns whether it was counted. */
  async hit(i: { page: unknown; referrer?: unknown; utmSource?: unknown; utmCampaign?: unknown; ip: string; ua: string }): Promise<boolean> {
    if (!VISIT_PAGES.includes(i.page as VisitPage)) return false;
    return this.record(i.page as VisitPage, i);
  }

  /** A request form was submitted (recorded by the server, so the share who submit can be counted). */
  async submitted(i: { ip: string; ua: string }): Promise<boolean> { return this.record('submitted', i); }

  private async record(page: VisitEvent, i: { referrer?: unknown; utmSource?: unknown; utmCampaign?: unknown; ip: string; ua: string }): Promise<boolean> {
    if (isBot(i.ua)) return false;
    const day = utcDay(this.now());
    await this.store.rollupBefore(day);
    const h = await this.hash(day, i.ip, i.ua);
    if (await this.store.isExcluded(day, h)) return false;
    await this.store.add({ day, page, referrerDomain: referrerDomain(i.referrer), utmSource: tag(i.utmSource), utmCampaign: tag(i.utmCampaign), device: deviceOf(i.ua), visitorHash: h });
    return true;
  }

  /** Close every finished day: write its counts, clear its hashes, throw away its salt (the daily job). */
  async closeDays(): Promise<number> { return this.store.rollupBefore(utcDay(this.now())); }

  /** A signed-in admin's request: this browser's visits today don't count. */
  async markAdmin(i: { ip: string; ua: string }): Promise<void> {
    const day = utcDay(this.now());
    await this.store.exclude(day, await this.hash(day, i.ip, i.ua));
  }

  async report(sinceMs: number | null): Promise<VisitReport> {
    const today = utcDay(this.now());
    await this.store.rollupBefore(today);
    const since = sinceMs === null ? null : utcDay(sinceMs);
    const views = await this.store.views(since);
    const days = new Map<string, DayRollup>();
    for (const r of await this.store.rollups(since)) days.set(r.day, r);
    const live = views.filter((v) => v.day === today);
    if (live.length > 0 || !days.has(today)) days.set(today, rollupOf(today, live));
    const pageViews = views.filter((v) => v.page !== 'submitted');
    const referrers = new Map<string, number>();
    for (const v of pageViews) if (v.referrerDomain) referrers.set(v.referrerDomain, (referrers.get(v.referrerDomain) ?? 0) + 1);
    const perDay = [...days.values()].sort((a, b) => a.day.localeCompare(b.day));
    const landing = perDay.reduce((s, d) => s + d.landingUniques, 0);
    const reached = perDay.reduce((s, d) => s + d.reachedRequest, 0);
    const submitted = perDay.reduce((s, d) => s + d.submitted, 0);
    const byPage = Object.fromEntries(VISIT_PAGES.map((p) => [p, pageViews.filter((v) => v.page === p).length])) as Record<VisitPage, number>;
    return {
      days: perDay.map((d) => ({ day: d.day, views: d.views, uniques: d.uniques })),
      byPage,
      devices: { phone: pageViews.filter((v) => v.device === 'phone').length, desktop: pageViews.filter((v) => v.device === 'desktop').length },
      topReferrers: [...referrers.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 10).map(([domain, views]) => ({ domain, views })),
      utm: topUtm(pageViews),
      landingVisitors: landing,
      reachedRequest: reached,
      submitted,
      reachedRequestShare: landing > 0 ? reached / landing : null,
      submittedShare: landing > 0 ? submitted / landing : null,
    };
  }
}

export interface VisitReport {
  days: Array<{ day: string; views: number; uniques: number }>;
  byPage: Record<VisitPage, number>;
  devices: { phone: number; desktop: number };
  topReferrers: Array<{ domain: string; views: number }>;
  utm: Array<{ source: string; campaign: string | null; views: number }>;
  /** Unique landing-page visitors (per day, summed), how many of them reached request access, and how many submitted. */
  landingVisitors: number;
  reachedRequest: number;
  submitted: number;
  reachedRequestShare: number | null;
  submittedShare: number | null;
}

function topUtm(views: PageView[]): VisitReport['utm'] {
  const m = new Map<string, { source: string; campaign: string | null; views: number }>();
  for (const v of views) {
    if (!v.utmSource && !v.utmCampaign) continue;
    const k = `${v.utmSource ?? ''}|${v.utmCampaign ?? ''}`;
    const e = m.get(k) ?? { source: v.utmSource ?? '(none)', campaign: v.utmCampaign, views: 0 };
    e.views++; m.set(k, e);
  }
  return [...m.values()].sort((a, b) => b.views - a.views).slice(0, 10);
}

/** One day's counts from its views (while the day's hashes are still held). */
export function rollupOf(day: string, views: PageView[]): DayRollup {
  const pv = views.filter((v) => v.page !== 'submitted');
  const set = (f: (v: PageView) => boolean) => new Set(views.filter(f).map((v) => v.visitorHash).filter((h): h is string => !!h));
  const landing = set((v) => v.page === 'landing');
  const request = set((v) => v.page === 'request_access');
  const submitted = set((v) => v.page === 'submitted');
  return {
    day,
    views: pv.length,
    uniques: new Set(pv.map((v) => v.visitorHash).filter(Boolean)).size,
    landingUniques: landing.size,
    reachedRequest: [...landing].filter((h) => request.has(h)).length,
    submitted: [...landing].filter((h) => submitted.has(h)).length,
  };
}
