import { test, expect, type Page } from '@playwright/test';

/**
 * [P76 · owner] Landing page feedback, in a real browser:
 *  - desktop: the top of the headline's first line lines up with the top of "Would you have caught it?" (the INK tops,
 *    found in a screenshot of each, so line-height and the font's ascent are accounted for), within 2px, at 1280, 1440
 *    and 1920; the hero's Play the game is hidden at 1440 and shown at 390;
 *  - mobile: Next chat, Play again and Try another industry bring the card's top just below the sticky header when it
 *    isn't fully on screen (smooth; instant with reduced motion); desktop doesn't scroll;
 *  - the header links scroll smoothly and land just below the header (instant with reduced motion).
 * With SHOTS_DIR set, the review screenshots are saved there (not committed).
 * [P89 · owner, Prompt 86] The P76 hero (the headline beside the game) is replaced by the owner's Marker landing and the
 * game moved to its own pages. The hero alignment checks go with the page they measured; the rest moves: the game's
 * card-into-view behaviour is checked on /game/property (the page opens on chat 1), "Try another industry" is a link to
 * /game, and the header links are the Marker landing's (Privacy, Pricing; The game is a page of its own).
 */
async function shot(page: Page, name: string, el?: ReturnType<Page['locator']>): Promise<void> {
  if (!process.env.SHOTS_DIR) return;
  const path = `${process.env.SHOTS_DIR}/${name}.png`;
  if (el) await el.screenshot({ path });
  else await page.screenshot({ path });
}

test.beforeEach(async ({ page }) => {
  await page.route('**/api/visit', (r) => r.fulfill({ status: 204, body: '' }));
  await page.route('**/api/game-event', (r) => r.fulfill({ status: 204, body: '' }));
});

const headerBottom = (page: Page) => page.evaluate(() => document.querySelector('body > header')!.getBoundingClientRect().bottom);
const cardTop = (page: Page) => page.evaluate(() => document.querySelector('[data-game]')!.getBoundingClientRect().top);
const PROPERTY = '/game/property/'; // the preview serves the static pages with the slash; production maps /game/property

test('390px and 1440px: the Marker hero is whole on first paint, with no eyebrow; the old hero is gone', async ({ page }) => {
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.goto('/');
    await expect(page.locator('h1')).toBeInViewport({ ratio: 1 });
    await expect(page.getByText('FOR RELATIONSHIP SALES')).toHaveCount(0);
    await expect(page.locator('#b1').getByRole('link', { name: 'Play the game' })).toHaveCount(0); // the game's banner is further down
    await expect(page.locator('body > header a.navlink[href="/game"]')).toHaveText('The game'); // hidden on phones, as the reference draws it; the banner links it there
  }
});

/** Scroll so the card's top is 120px above the top of the screen, instantly (`sel` is clicked from script). */
const hideCardTop = async (page: Page, _sel: string) => {
  await page.evaluate(() => scrollTo({ top: scrollY + document.querySelector('[data-game]')!.getBoundingClientRect().top + 120, behavior: 'instant' }));
  expect(await cardTop(page)).toBeLessThan(await headerBottom(page));
};
/** Count the page's own scrollTo calls (the browser's scroll anchoring may still nudge the page as the card changes). */
const spyScroll = (page: Page) => page.evaluate(() => { const w = window as unknown as { __scrolls: number }; w.__scrolls = 0; const o = window.scrollTo.bind(window); window.scrollTo = ((...a: Parameters<typeof window.scrollTo>) => { w.__scrolls++; return (o as (...x: unknown[]) => void)(...a); }) as typeof window.scrollTo; });
const scrolls = (page: Page) => page.evaluate(() => (window as unknown as { __scrolls: number }).__scrolls);
/** Click through to the end screen from the start of a Property game (a trap ends chats 2 to 5). */
const toEnd = async (page: Page) => {
  const card = page.locator('[data-game]');
  await card.locator('button.tv-msg').nth(1).click();
  for (let r = 1; r < 5; r++) { await card.locator('[data-act="next"]').click(); await card.locator('button.tv-msg').nth(1).click(); }
  await card.locator('[data-act="next"]').click();
  await expect(card).toContainText('YOUR SCORE · PROPERTY');
};

test('390px: Next chat and Play again bring the card\'s top just below the header (smooth); Try another industry opens /game', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(PROPERTY);
  const card = page.locator('[data-game]');
  const check = async (sel: string, then: string) => {
    await hideCardTop(page, sel);
    const startY = await page.evaluate(() => scrollY);
    const right = await page.evaluate((s) => { (document.querySelector(s) as HTMLElement).click(); return scrollY; }, sel);
    expect(Math.abs(right - startY), `${sel}: smooth, not a jump`).toBeLessThanOrEqual(2); // the browser may nudge 1px as the card changes
    await expect(card).toContainText(then);
    const hb = await headerBottom(page);
    await expect.poll(() => cardTop(page), { message: sel }).toBeGreaterThanOrEqual(hb + 10);
    await expect.poll(() => cardTop(page), { message: sel }).toBeLessThanOrEqual(hb + 14);
  };
  await card.locator('button.tv-msg').nth(1).click();
  await check('[data-act="next"]', 'chat 2 of 5');
  await shot(page, 'p76-next-chat-390');
  await card.locator('button.tv-msg').nth(1).click();
  for (let r = 2; r < 5; r++) { await card.locator('[data-act="next"]').click(); await card.locator('button.tv-msg').nth(1).click(); }
  await card.locator('[data-act="next"]').click();
  await expect(card).toContainText('YOUR SCORE · PROPERTY');
  await check('[data-act="replay"]', 'chat 1 of 5');
  await toEnd(page);
  await card.locator('a[data-act="switch"]').click();
  await expect(page).toHaveURL(/\/game\/?$/);
  await expect(page.locator('[data-game]')).toContainText('Pick your industry to start.');
});

test('390px, reduced motion: Next chat jumps to the card at once', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(PROPERTY);
  const card = page.locator('[data-game]');
  await card.locator('button.tv-msg').nth(1).click();
  await hideCardTop(page, '[data-act="next"]');
  const top = await page.evaluate(() => { (document.querySelector('[data-act="next"]') as HTMLElement).click(); return document.querySelector('[data-game]')!.getBoundingClientRect().top; });
  const hb = await headerBottom(page);
  expect(top).toBeGreaterThanOrEqual(hb + 10);
  expect(top).toBeLessThanOrEqual(hb + 14);
});

test('NEGATIVE 390px: the card already on screen: Next chat does not scroll', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(PROPERTY);
  const card = page.locator('[data-game]');
  await card.locator('button.tv-msg').nth(1).click();
  await page.evaluate(() => { const c = document.querySelector('[data-game]')!; scrollTo({ top: scrollY + c.getBoundingClientRect().top - 200, behavior: 'instant' }); });
  await spyScroll(page);
  await page.evaluate(() => (document.querySelector('[data-act="next"]') as HTMLElement).click());
  await expect(card).toContainText('chat 2 of 5');
  await page.waitForTimeout(400);
  expect(await scrolls(page)).toBe(0);
});

test('NEGATIVE 1440px: desktop does not scroll after Next chat', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 600 });
  await page.goto(PROPERTY);
  const card = page.locator('[data-game]');
  await card.locator('button.tv-msg').nth(1).click();
  await page.locator('[data-act="next"]').evaluate((el) => el.scrollIntoView({ block: 'end', behavior: 'instant' }));
  expect(await cardTop(page)).toBeLessThan(await headerBottom(page)); // the card's top is off screen, and still nothing scrolls
  await spyScroll(page);
  await page.evaluate(() => (document.querySelector('[data-act="next"]') as HTMLElement).click());
  await expect(card).toContainText('chat 2 of 5');
  await page.waitForTimeout(600);
  expect(await scrolls(page)).toBe(0);
  expect(await cardTop(page)).toBeLessThan(await headerBottom(page));
});

for (const reduced of [false, true]) {
  test(`1440px header links: ${reduced ? 'instant with reduced motion' : 'smooth'}, landing just below the header`, async ({ page }) => {
    if (reduced) await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    const nav = page.locator('body > header nav');
    for (const [name, id] of [['Privacy', 'privacy'], ['Pricing', 'pricing']] as const) {
      await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
      await nav.getByRole('link', { name }).evaluate((a) => (a as HTMLElement).click());
      const first = await page.evaluate(() => scrollY);
      const target = await page.evaluate((i) => scrollY + document.getElementById(i)!.getBoundingClientRect().top - parseFloat(getComputedStyle(document.getElementById(i)!).scrollMarginTop), id);
      // [P78] the browser scrolls in whole pixels: the jump lands on the pixel nearest the target (P78's shorter pick
      // screen put #pricing at a half pixel, 3191.5, and the page lands on 3192)
      if (reduced) expect(first, name).toBe(Math.round(target));
      else expect(first, `${name}: smooth, not a jump`).toBeLessThan(target - 50);
      const hb = await headerBottom(page);
      const top = () => page.evaluate((i) => document.getElementById(i)!.getBoundingClientRect().top, id);
      await expect.poll(top, { message: name }).toBeGreaterThanOrEqual(hb - 1);
      await expect.poll(top, { message: name }).toBeLessThanOrEqual(hb + 12);
    }
  });
}

test('screenshots: the features section and the FAQ open, at 390 and 1440', async ({ page }) => {
  test.skip(!process.env.SHOTS_DIR, 'review screenshots only');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.goto('/');
    await page.addStyleTag({ content: 'body > header{position:static !important}' }); // keep the fixed header out of the element shots
    await shot(page, `p89-privacy-${width}`, page.locator('section[aria-labelledby="trust-h"]'));
    for (const s of await page.locator('details > summary').all()) await s.click();
    await shot(page, `p89-faq-open-${width}`, page.locator('section[aria-labelledby="faq-h"]'));
  }
});
