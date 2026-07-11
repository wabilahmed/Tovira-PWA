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
      // Auto-update: the new SW skips waiting + claims clients; our registration
      // reloads once on controllerchange so returning users get the fresh build.
      registerType: 'autoUpdate',
      injectRegister: null, // we register manually (registerServiceWorker.ts)
      filename: 'sw.js',
      // Clone to a mutable shape (the source is `as const` for literal types).
      manifest: { ...manifest, icons: manifest.icons.map((icon) => ({ ...icon })) },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webmanifest}'],
        navigateFallback: '/index.html',
        cleanupOutdatedCaches: true,
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
