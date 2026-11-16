/**
 * Web app manifest — the installability contract. Consumed by vite-plugin-pwa at
 * build time and asserted by manifest.test.ts.
 */
export const manifest = {
  name: 'Tovira',
  short_name: 'Tovira',
  description: 'Tovira analyses your client conversations and picks out what each client cares about, so you can close.',
  start_url: '/app',
  scope: '/',
  display: 'standalone',
  orientation: 'portrait',
  // [P71-D · owner] Dark is the default theme, so the install splash and OS chrome start on the dark page colour.
  // Once the app is open, the <meta> theme-color follows the theme in use (theme.ts), so Light users get #f4f1ea.
  background_color: '#171412',
  theme_color: '#171412',
  icons: [
    { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
  // Android: let WhatsApp "Export chat" share the export straight into Tovira (P5-3 / IMPORT-ZIP).
  // Accept the .zip WhatsApp actually produces as well as a .txt — and application/octet-stream,
  // because Android often hands a shared file that generic MIME. iOS PWAs can't be share targets;
  // that path is Files→upload instead.
  share_target: {
    action: '/share-target',
    method: 'POST',
    enctype: 'multipart/form-data',
    params: {
      title: 'title',
      text: 'text',
      files: [{ name: 'file', accept: ['text/plain', '.txt', 'application/zip', 'application/x-zip-compressed', 'application/octet-stream', '.zip'] }],
    },
  },
} as const;
