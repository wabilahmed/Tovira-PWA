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
  // Android: let WhatsApp "Export chat" share the .txt straight into Tovira
  // (P5-3). iOS PWAs can't be share targets — that path is Files→upload instead.
  share_target: {
    action: '/share-target',
    method: 'POST',
    enctype: 'multipart/form-data',
    params: {
      title: 'title',
      text: 'text',
      files: [{ name: 'file', accept: ['text/plain', '.txt'] }],
    },
  },
} as const;
