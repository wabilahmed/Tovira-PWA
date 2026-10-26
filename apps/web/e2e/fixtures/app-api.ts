import type { BrowserContext } from '@playwright/test';

/**
 * [P46-6b] A stub API for layout checks of the real app in a browser, with REALISTIC lengths: long promise text, long
 * client names. (The P39 screenshot check passed the Promises screen because its stub returned no promises at all, so
 * the overflow real data caused was never on screen.) No server, no network: every /api call is answered here.
 */
const DAY = 86_400_000;
export const LONG_NAME = 'Mohammed Abdullah Al Kaabi Real Estate Holdings LLC';
const iso = (offsetDays: number): string => new Date(Date.now() + offsetDays * DAY).toISOString().slice(0, 10);

const promise = (id: string, clientId: string, clientName: string, text: string, owner: 'rep' | 'client', dueDate: string | null, dueRaw: string | null, extra: Record<string, unknown> = {}) => ({
  id, clientId, clientName, text, owner, dueDate, dueRaw, confidence: 'high', done: false, confirmed: true, createdAt: Date.now() - 3 * DAY,
  noteId: 'n1', sourceSpan: text, sourceMessageAt: '2026-10-10T10:05', receipt: { quote: text, source: 'message', at: '2026-10-10T10:05', label: '' },
  stale: false, dateStatus: null, ...extra,
});

export const PROMISES = [
  promise('p1', 'c2', LONG_NAME, 'Pay the deposit, contingent on mortgage approval from the bank, and send the signed reservation form', 'client', iso(-6), 'Sunday morning'),
  promise('p2', 'c1', 'Sara Khan', 'Send the revised proposal with the three payment options and the updated delivery schedule for the second phase', 'rep', iso(3), 'by Thursday'),
  promise('p3', 'c4', 'Omar Ali', 'Introduce him to the finance team', 'rep', null, 'after the holidays', { dateStatus: 'to_confirm' }),
  promise('p4', 'c3', 'Layla Hassan', 'Share the brochure', 'rep', null, null),
  promise('p5', 'c1', 'Sara Khan', 'Call back about the renewal', 'rep', iso(-120), null, { stale: true }),
];

const CLIENTS = [
  { id: 'c1', name: 'Sara Khan', phone: '+971503863103' },
  { id: 'c2', name: LONG_NAME, phone: null },
  { id: 'c3', name: 'Layla Hassan', phone: null },
  { id: 'c4', name: 'Omar Ali', phone: null },
].map((c) => ({ ...c, createdAt: Date.now() - 30 * DAY, leadStatus: null, outcome: 'open', outcomeSource: null, outcomeChangedAt: null }));

const ROUTES: Array<[RegExp, unknown]> = [
  [/^\/api\/me\/tour$/, { required: false, step: 0, steps: 9, version: 1 }],
  [/^\/api\/me\/ui-prefs$/, { clientSections: {} }],
  [/^\/api\/me$/, { user: { id: 'u1', email: 'test.rep@tovira.io', referralCode: 'r1', emailVerified: true, timezone: 'Asia/Dubai' } }],
  [/^\/api\/version$/, { signupEnabled: false, referralsEnabled: false }],
  [/^\/api\/onboarding/, { hasClient: true, hasNote: true, briefReachable: true, seeded: true, bookScanReady: true, nextStep: '', seeding: { primary: 'whatsapp_export', requiresPasteEntry: false, steps: { android: [], ios: [] } }, fallbacks: [] }],
  [/^\/api\/billing\/status$/, { entitled: true, status: 'trialing', trialEndsAt: Date.now() + 9 * DAY, renewsAt: null }],
  [/^\/api\/allowance\/status$/, { percentUsed: 37, rawPercentUsed: 37, exhausted: false, resetAt: new Date(Date.now() + 9 * DAY).toISOString(), canTopUp: false, options: [], subscription: 'trialing', extraPercentLeft: 0 }],
  [/^\/api\/clients\/row-summaries$/, { rows: {} }],
  [/^\/api\/clients$/, { clients: CLIENTS }],
  [/^\/api\/promises$/, { promises: PROMISES, done: [], staleThresholdDays: 90 }],
  [/^\/api\/confirmations$/, { promises: [promise('q1', 'c2', LONG_NAME, 'Send the ID photos of both buyers and the passport copies', 'client', null, 'next week', { confirmed: false })], meetings: [], moveSuggestions: [] }],
  [/^\/api\/inventory\/matches/, { suggestions: [], badge: 0 }],
  [/^\/api\/push\/config$/, { vapidPublicKey: '' }],
];

/** Answer every /api call from the stub (404 for anything unlisted). Service workers must be blocked by the caller. */
export async function stubApi(context: BrowserContext): Promise<void> {
  await context.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const hit = ROUTES.find(([re]) => re.test(path));
    await route.fulfill(hit ? { status: 200, contentType: 'application/json', body: JSON.stringify(hit[1]) } : { status: 404, contentType: 'application/json', body: '{}' });
  });
}
