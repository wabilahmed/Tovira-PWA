import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { stubApi } from './fixtures/app-api.js';

/**
 * [P69 · owner] "Helps you close", at 390px, light and dark: the landing hero, the three pillars, one use-case card,
 * and the client page with What they care about first (each detail with its message). None scrolls sideways. With
 * SHOTS_DIR set each screen is saved as a PNG there (for review; not committed).
 */
test.use({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } });

const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
async function shot(page: Page, name: string, el?: ReturnType<Page['locator']>): Promise<void> {
  await page.waitForTimeout(300);
  expect(await overflow(page), name).toBeLessThanOrEqual(0);
  if (!process.env.SHOTS_DIR) return;
  const path = `${process.env.SHOTS_DIR}/${name}.png`;
  if (el) await el.screenshot({ path });
  else await page.screenshot({ path, fullPage: false });
}
const json = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

const OVERVIEW = {
  caresAbout: [
    { kind: 'detail', text: 'Loves the beach, goes every morning before work', subject: null, noteId: 'n1', quote: 'Honestly I love the beach, I go every morning before work', at: '2026-11-10T18:03' },
    { kind: 'date', text: 'Anniversary · in May', subject: null, noteId: 'n1', quote: 'our anniversary is in May', at: '2026-11-10T18:07' },
    { kind: 'ask', text: 'A 2-bed, budget around 3.2M', subject: null, noteId: 'n1', quote: 'Budget around 3.2M, 2 bed ideally', at: '2026-11-10' },
    { kind: 'worry', text: 'Service charges on the last place were too high', subject: null, noteId: 'n1', quote: null, at: null },
  ],
  lastMessageAt: '2026-11-10T18:20', openPromises: 1, overduePromises: 0,
  wants: { summary: '2-bed · budget ~AED 3.2M', listLine: '2-bed · ~AED 3.2M', budgets: ['3.2M'], items: [{ id: 'r1', text: 'A 2-bed, budget around 3.2M', quote: 'Budget around 3.2M, 2 bed ideally', noteId: 'n1', statedOn: '2026-11-10' }] },
  promises: [], nextMeeting: null, meetingsCount: 0,
  conversations: [{ noteId: 'n1', kind: 'whatsapp', messageCount: 4, lastAt: '2026-11-10T18:20', createdAt: Date.parse('2026-11-10T19:00:00Z') }],
  statusSuggestion: null,
};
const BUBBLES = (text: string) => ({ source: { kind: 'chat', noteId: 'n1', repKnown: true, hasMore: false, bubbles: [{ sender: 'Sara Khan', side: 'other', at: '2026-11-10T18:03', text, source: true }] } });

async function stubClient(context: BrowserContext): Promise<void> {
  await stubApi(context);
  await context.route((u) => u.pathname.startsWith('/api/clients/c1/') || u.pathname.startsWith('/api/receipts/'), (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p.endsWith('/overview')) return route.fulfill(json(OVERVIEW));
    if (p.endsWith('/notes')) return route.fulfill(json({ notes: [] }));
    if (p.endsWith('/stakeholders')) return route.fulfill(json({ people: [] }));
    if (p.endsWith('/pointers')) return route.fulfill(json({ pointers: [{ section: 'close', text: 'She agreed to Saturday viewings', receipts: [] }], disclosure: null }));
    if (p.startsWith('/api/receipts/sources')) return route.fulfill(json({ sources: [BUBBLES('Honestly I love the beach, I go every morning before work').source] }));
    if (p.startsWith('/api/receipts/')) return route.fulfill(json({ from: 0, ...BUBBLES('Honestly I love the beach, I go every morning before work') }));
    return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
  });
}

for (const scheme of ['light', 'dark'] as const) {
  test(`390px ${scheme}: the landing hero, the pillars and one card`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    await page.goto('/');
    await expect(page.locator('#hero-h')).toHaveText('Your clients already told you how to win them.');
    await shot(page, `p69-1-landing-hero-${scheme}`);
    const pillars = page.locator('section[aria-labelledby="pillars-h"]');
    await pillars.scrollIntoViewIfNeeded();
    await expect(pillars.locator('.pillar')).toHaveCount(3);
    await shot(page, `p69-2-landing-pillars-${scheme}`, pillars);
    const card = page.locator('section[aria-labelledby="use-h"] .usecase').last();
    await card.scrollIntoViewIfNeeded();
    await expect(card).toContainText('Loves the beach · budget ~3.2M');
    await shot(page, `p69-3-landing-card-${scheme}`, card);
  });

  test(`390px ${scheme}: the client page opens on What they care about`, async ({ page, context }) => {
    await stubClient(context);
    await context.addInitScript((t) => { try { localStorage.setItem('tovira.theme', t); } catch { /* private mode */ } }, scheme === 'dark' ? 'vault' : 'ledger');
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    await page.goto('/app?client=c1');
    const cares = page.getByTestId('cares-about');
    await expect(cares).toContainText('Loves the beach, goes every morning before work');
    await shot(page, `p69-4-client-cares-${scheme}`);
  });
}
