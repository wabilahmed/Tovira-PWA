import { defineConfig, devices } from '@playwright/test';

// [P0-5] Browser-level PWA checks. Runs against the BUILT app served by
// `vite preview` (the service worker only exists in a production build).
export default defineConfig({
  testDir: './apps/web/e2e',
  timeout: 60_000,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run build -w apps/web && npm run preview -w apps/web -- --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
