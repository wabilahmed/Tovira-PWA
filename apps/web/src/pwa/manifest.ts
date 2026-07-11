/**
 * Web app manifest — the installability contract. Consumed by vite-plugin-pwa at
 * build time and asserted by manifest.test.ts.
 */
export const manifest = {
  name: 'Tovira',
  short_name: 'Tovira',
  description: 'A memory bank for field salespeople.',
  start_url: '/',
  scope: '/',
  display: 'standalone',
  orientation: 'portrait',
  background_color: '#ffffff',
  theme_color: '#2563eb',
  icons: [
    { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
} as const;
