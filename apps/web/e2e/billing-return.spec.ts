import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// [BILL-13] After paying, a rep must never land on a 404. In prod a CloudFront viewer-request function
// rewrites app client-side routes (e.g. /billing/success) to /app.html (infra/terraform/marketing.tf);
// the preview server has no such fallback, so we simulate it here and assert the app renders a real page.
const appHtml = (): string => readFileSync(resolve('apps/web/dist/app.html'), 'utf8');

test.beforeEach(async ({ page }) => {
  await page.route('**/billing/**', (route) =>
    route.request().resourceType() === 'document'
      ? route.fulfill({ status: 200, contentType: 'text/html', body: appHtml() })
      : route.continue(),
  );
  // No backend in the preview: /api/* answers so the app shows its logged-out / confirming states.
  await page.route('**/api/**', (route) => route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }));
});

test('billing/cancel renders a real page, never the 404', async ({ page }) => {
  await page.goto('/billing/cancel');
  await expect(page.getByText(/haven't been charged/i)).toBeVisible();
  await expect(page.getByText(/page not found/i)).toHaveCount(0);
});

test('billing/success renders a real page, never the 404', async ({ page }) => {
  await page.goto('/billing/success');
  await expect(page.getByRole('status')).toHaveText(/confirming your payment|payment received|you're subscribed/i);
  await expect(page.getByText(/page not found/i)).toHaveCount(0);
});
