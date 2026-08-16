import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { manifest } from './src/pwa/manifest.js';

// Proxy the API so the PWA calls it same-origin (the session cookie rides along).
// Target is the API container in Docker (http://api:3001) or localhost in bare dev.
const apiTarget = process.env.VITE_API_PROXY ?? 'http://localhost:3001';
const apiRoutes = ['/auth', '/me', '/health'];

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // injectManifest: a custom worker (src/pwa/sw.ts) so we can handle the
      // Android share-target POST the manifest advertises — a generated worker
      // has no hook for it. It still precaches + SPA-falls-back + auto-updates.
      strategies: 'injectManifest',
      srcDir: 'src/pwa',
      // Auto-update: the new SW skips waiting + claims clients; our registration
      // reloads once on controllerchange so returning users get the fresh build.
      registerType: 'autoUpdate',
      injectRegister: null, // we register manually (registerServiceWorker.ts)
      filename: 'sw.ts',
      // Clone to a mutable shape (the source is `as const` for literal types).
      manifest: {
        ...manifest,
        icons: manifest.icons.map((icon) => ({ ...icon })),
        share_target: {
          ...manifest.share_target,
          params: {
            ...manifest.share_target.params,
            files: manifest.share_target.params.files.map((f) => ({ ...f, accept: [...f.accept] })),
          },
        },
      },
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webmanifest}'],
      },
      devOptions: { enabled: false },
    }),
  ],
  server: {
    host: true, // 0.0.0.0 so the dev server is reachable from outside the container
    port: 5173,
    // Bind-mounted source on macOS/Windows doesn't emit inotify events; poll for HMR.
    watch: { usePolling: true },
    proxy: Object.fromEntries(apiRoutes.map((route) => [route, { target: apiTarget, changeOrigin: true }])),
  },
});
