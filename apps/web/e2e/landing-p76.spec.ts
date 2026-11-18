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

/** The page y of the first row of light ink (the text colour #F2EDE4) in the element's first line. */
async function inkTop(page: Page, selector: string): Promise<number> {
  const box = (await page.locator(selector).boundingBox())!;
  const top = Math.max(0, Math.floor(box.y) - 8);
  const buf = await page.screenshot({ clip: { x: box.x, y: top, width: Math.min(box.width, 520), height: 90 }, scale: 'css' });
  const row = await page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const px = ctx.getImageData(0, 0, c.width, c.height).data;
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
      const k = (y * c.width + x) * 4;
      if (px[k]! > 170 && px[k + 1]! > 160 && px[k + 2]! > 150) return y;
    }
    return -1;
  }, buf.toString('base64'));
  expect(row, `no ink found for ${selector}`).toBeGreaterThan(0);
  return top + row;
}

const headerBottom = (page: Page) => page.evaluate(() => document.querySelector('body > header')!.getBoundingClientRect().bottom);
const cardTop = (page: Page) => page.evaluate(() => document.querySelector('[data-game]')!.getBoundingClientRect().top);

for (const width of [1280, 1440, 1920]) {
  test(`${width}px: the headline's first line and "Would you have caught it?" share a text top (within 2px)`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await page.addStyleTag({ content: '.tv-star,.tv-orb{display:none !important}' }); // nothing light behind the text
    await page.evaluate(() => document.fonts.ready);
    const h1 = await inkTop(page, 'h1 > span:first-child');
    const h2 = await inkTop(page, '#game-h');
    expect(Math.abs(h1 - h2), `h1 ink ${h1}, h2 ink ${h2}`).toBeLessThanOrEqual(2);
    expect(await page.locator('h1').evaluate((el) => getComputedStyle(el).fontSize)).toBe(width === 1280 ? '56.32px' : '58px');
    if (width === 1440) { await page.addStyleTag({ content: '.tv-star,.tv-orb{display:revert !important}' }); await shot(page, 'p76-hero-1440'); }
  });
}

test('390px: the headline is 34px at its smallest, the hero\'s Play the game is shown and the eyebrow is gone', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  expect(await page.locator('h1').evaluate((el) => getComputedStyle(el).fontSize)).toBe('34px');
  await expect(page.locator('#top').getByRole('link', { name: 'Play the game' })).toBeVisible();
  await expect(page.getByText('FOR RELATIONSHIP SALES')).toHaveCount(0);
  await shot(page, 'p76-hero-390');
});

test('1440px: the hero\'s Play the game is hidden (the game is beside it); the header\'s Test your eye stays', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.locator('#top').getByRole('link', { name: 'Play the game' })).toBeHidden();
  await expect(page.locator('body > header').getByRole('link', { name: 'Test your eye' })).toBeVisible();
  await expect(page.locator('#top').getByRole('link', { name: 'Try free for 14 days' })).toBeVisible();
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

test('390px: Next chat, Play again and Try another industry bring the card\'s top just below the header (smooth)', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const card = page.locator('[data-game]');
  const check = async (sel: string, then: string) => {
    await hideCardTop(page, sel);
    const startY = await page.evaluate(() => scrollY);
    const right = await page.evaluate((s) => { (document.querySelector(s) as HTMLElement).click(); return scrollY; }, sel);
    expect(right, `${sel}: smooth, not a jump`).toBe(startY);
    await expect(card).toContainText(then);
    const hb = await headerBottom(page);
    await expect.poll(() => cardTop(page), { message: sel }).toBeGreaterThanOrEqual(hb + 10);
    await expect.poll(() => cardTop(page), { message: sel }).toBeLessThanOrEqual(hb + 14);
  };
  await card.getByRole('button', { name: 'Property' }).click();
  await card.locator('button.tv-msg').nth(1).click();
  await check('[data-act="next"]', 'chat 2 of 5');
  await shot(page, 'p76-next-chat-390');
  await card.locator('button.tv-msg').nth(1).click();
  for (let r = 2; r < 5; r++) { await card.locator('[data-act="next"]').click(); await card.locator('button.tv-msg').nth(1).click(); }
  await card.locator('[data-act="next"]').click();
  await expect(card).toContainText('YOUR SCORE · PROPERTY');
  await check('[data-act="replay"]', 'chat 1 of 5');
  await toEnd(page);
  await check('[data-act="switch"]', 'CHOOSE YOUR INDUSTRY');
});

test('390px, reduced motion: Next chat jumps to the card at once', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const card = page.locator('[data-game]');
  await card.getByRole('button', { name: 'Property' }).click();
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
  await page.goto('/');
  const card = page.locator('[data-game]');
  await card.getByRole('button', { name: 'Property' }).click();
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
  await page.goto('/');
  const card = page.locator('[data-game]');
  await card.getByRole('button', { name: 'Property' }).click();
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
    for (const [name, id] of [['How it works', 'how'], ['Pricing', 'pricing'], ['Test your eye', 'game']] as const) {
      await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
      await nav.getByRole('link', { name }).evaluate((a) => (a as HTMLElement).click());
      const first = await page.evaluate(() => scrollY);
      const target = await page.evaluate((i) => scrollY + document.getElementById(i)!.getBoundingClientRect().top - parseFloat(getComputedStyle(document.getElementById(i)!).scrollMarginTop), id);
      if (reduced) expect(first, name).toBeCloseTo(target, 0);
      else expect(first, `${name}: smooth, not a jump`).toBeLessThan(target - 50);
      const hb = await headerBottom(page);
      const top = () => page.evaluate((i) => document.getElementById(i)!.getBoundingClientRect().top, id);
      await expect.poll(top, { message: name }).toBeGreaterThanOrEqual(hb - 1);
      await expect.poll(top, { message: name }).toBeLessThanOrEqual(hb + (id === 'game' ? 24 : 12));
    }
  });
}

test('screenshots: the features section and the FAQ open, at 390 and 1440', async ({ page }) => {
  test.skip(!process.env.SHOTS_DIR, 'review screenshots only');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.goto('/');
    await page.addStyleTag({ content: 'body > header{position:static !important}' }); // keep the sticky header out of the element shots
    await shot(page, `p76-features-${width}`, page.locator('section[aria-labelledby="trust-h"]'));
    for (const s of await page.locator('details > summary').all()) await s.click();
    await shot(page, `p76-faq-open-${width}`, page.locator('section[aria-labelledby="faq-h"]'));
  }
});
