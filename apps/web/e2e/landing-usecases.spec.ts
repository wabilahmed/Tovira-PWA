import { test, expect, type Page } from '@playwright/test';

// [P41-2] Six use-case cards fit the existing grid: 1 column on a phone, 2 on a tablet, 3 on desktop.
// At 390px nothing overflows: no horizontal page scroll, every card inside the viewport.
const columns = (page: Page) =>
  page.locator('.usecases').evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').filter(Boolean).length);

for (const scheme of ['light', 'dark'] as const) {
  test(`390px ${scheme}: six use-case cards, one column, no overflow`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    const cards = page.locator('.usecases > .usecase');
    await expect(cards).toHaveCount(6);
    expect(await columns(page)).toBe(1);
    const { scrollW, clientW } = await page.evaluate(() => ({ scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth }));
    expect(scrollW).toBeLessThanOrEqual(clientW);
    for (const box of await cards.evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { left: r.left, right: r.right }; }))) {
      expect(box.left).toBeGreaterThanOrEqual(0);
      expect(box.right).toBeLessThanOrEqual(390);
    }
  });
}

test('tablet (800px) shows two columns, desktop (1280px) three', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 1000 });
  await page.goto('/');
  expect(await columns(page)).toBe(2);
  await page.setViewportSize({ width: 1280, height: 1000 });
  expect(await columns(page)).toBe(3);
});
