import { defineConfig, type Plugin } from 'vite';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { manifest } from './src/pwa/manifest.js';

// Proxy the API so the PWA calls it same-origin (the session cookie rides along).
// Target is the API container in Docker (http://api:3001) or localhost in bare dev.
const apiTarget = process.env.VITE_API_PROXY ?? 'http://localhost:3001';
// The PWA calls the whole API under /api/* (matching the single CloudFront
// behavior in prod); the API server strips the prefix. One rule covers every
// route — no per-endpoint list to keep in sync.
const apiRoutes = ['/api'];

const html = (p: string): string => fileURLToPath(new URL(p, import.meta.url));

// The prerendered marketing pages (static HTML, no app code) live at these paths;
// everything else is the SPA (app.html). Kept in one place so the dev fallback and
// the service-worker routing agree.
const MARKETING_PATHS = ['/', '/privacy', '/terms', '/ar', '/ar/privacy', '/ar/terms'];
const isMarketing = (pathname: string): boolean => {
  const p = pathname.replace(/\/index\.html$/, '').replace(/\/$/, '') || '/';
  return MARKETING_PATHS.includes(p);
};

// Dev only: Vite serves each MPA entry by path, but has no SPA fallback for the
// app's client-side routes (/clients, /reset-password, …). Rewrite any non-file
// HTML navigation that isn't a marketing route to /app.html so the SPA loads,
// mirroring what the service worker + CloudFront do in production.
function appFallback(): Plugin {
  return {
    name: 'tovira-app-fallback',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const url = (req.url ?? '/').split('?')[0]!;
        const accepts = req.headers.accept ?? '';
        const isHtmlNav = req.method === 'GET' && accepts.includes('text/html');
        const looksLikeFile = /\.[a-z0-9]+$/i.test(url) && !url.endsWith('.html');
        if (isHtmlNav && !looksLikeFile && !isMarketing(url) && url !== '/app.html') {
          req.url = '/app.html';
        }
        next();
      });
    },
  };
}

export default defineConfig({
  appType: 'mpa', // multiple HTML entries; the plugin above handles the SPA fallback
  build: {
    rollupOptions: {
      input: {
        app: html('./app.html'),
        landing: html('./index.html'),
        privacy: html('./privacy/index.html'),
        terms: html('./terms/index.html'),
        ar: html('./ar/index.html'),
        arPrivacy: html('./ar/privacy/index.html'),
        arTerms: html('./ar/terms/index.html'),
      },
    },
  },
  plugins: [
    appFallback(),
    react(),
    VitePWA({
      // injectManifest: a custom worker (src/pwa/sw.ts) so we can handle the
      // Android share-target POST + route marketing vs app. It still precaches +
      // SPA-falls-back (now to app.html) + auto-updates.
      strategies: 'injectManifest',
      srcDir: 'src/pwa',
      registerType: 'autoUpdate',
      injectRegister: null, // we register manually (registerServiceWorker.ts)
      filename: 'sw.ts',
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
    host: true,
    port: 5173,
    watch: { usePolling: true },
    proxy: Object.fromEntries(apiRoutes.map((route) => [route, { target: apiTarget, changeOrigin: true }])),
  },
});
