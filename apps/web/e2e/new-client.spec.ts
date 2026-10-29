import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { stubApi } from './fixtures/app-api.js';

/**
 * [P57 · owner] + New client and + Add note at 390px, light and dark: the sheet, the Type it form, the voice confirm step,
 * the duplicate question, and + Add note on a client page. None scrolls sideways. With SHOTS_DIR set, each screen is
 * saved as a PNG there (for review; the images are not committed).
 */
test.use({
  serviceWorkers: 'block',
  viewport: { width: 390, height: 844 },
  permissions: ['microphone'],
  launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] },
});

const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
async function screen(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(300); // the sheet's slide-in
  expect(await overflow(page), name).toBeLessThanOrEqual(0);
  if (process.env.SHOTS_DIR) await page.screenshot({ path: `${process.env.SHOTS_DIR}/${name}.png` });
}
async function stubNewClient(context: BrowserContext): Promise<void> {
  await stubApi(context);
  // registered after stubApi, so these answer first
  await context.route('**/api/clients', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    const body = route.request().postDataJSON() as { name: string; confirmDuplicate?: boolean };
    if (body.name.trim().toLowerCase() === 'sara khan' && !body.confirmDuplicate) {
      return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'duplicate_client', message: 'You already have Sara Khan. Add this to Sara Khan instead?', client: { id: 'c1', name: 'Sara Khan' }, match: 'name' }) });
    }
    return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ id: 'c9', name: body.name, phone: null, createdAt: Date.now() }) });
  });
  await context.route('**/api/voice/draft', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
    transcript: "Just met Sara Khan from Emaar, she wants a 3-bed in Arabian Ranches, budget around 3 million, I said I'd send options by Thursday.",
    suggestion: { name: 'Sara Khan', company: 'Emaar', phone: null },
  }) }));
}

for (const scheme of ['light', 'dark'] as const) {
  test(`390px ${scheme}: + New client, Type it, the voice confirm step, the duplicate question, + Add note`, async ({ page, context }) => {
    await stubNewClient(context);
    // the app's own theme setting (Ledger is light, Vault is dark), read before first paint
    await context.addInitScript((t) => { try { localStorage.setItem('tovira.theme', t); } catch { /* private mode */ } }, scheme === 'dark' ? 'vault' : 'ledger');
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    await page.goto('/app');
    await page.getByTestId('clients-page').getByTestId('page-header').getByRole('button', { name: '+ New client' }).click();
    await expect(page.getByRole('button', { name: /^Type it/ })).toBeVisible();
    await screen(page, `p57-1-new-client-sheet-${scheme}`);

    await page.getByRole('button', { name: /^Type it/ }).click();
    await page.getByLabel('Name', { exact: true }).fill('Sara Khan');
    await page.getByLabel('Company').fill('Emaar');
    await page.getByLabel('Notes').fill("Wants a 3-bed in Arabian Ranches, budget around 3 million. I said I'd send options by Thursday.");
    await screen(page, `p57-2-type-form-${scheme}`);

    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('You already have Sara Khan. Add this to Sara Khan instead?')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add to Sara Khan' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create new' })).toBeVisible();
    await screen(page, `p57-4-duplicate-${scheme}`);
    await page.keyboard.press('Escape');

    await page.getByTestId('clients-page').getByTestId('page-header').getByRole('button', { name: '+ New client' }).click();
    await page.getByRole('button', { name: /^Record a voice note/ }).click();
    await page.getByRole('button', { name: '■ Stop' }).click();
    await expect(page.getByRole('heading', { name: 'Check the client' })).toBeVisible();
    await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Sara Khan');
    await screen(page, `p57-3-voice-confirm-${scheme}`);
    await page.keyboard.press('Escape');

    await page.goto('/app?client=c1');
    await page.getByRole('button', { name: '+ Add note' }).click();
    await expect(page.getByRole('button', { name: /^Type/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Record/ })).toBeVisible();
    await screen(page, `p57-5-add-note-${scheme}`);
  });
}
