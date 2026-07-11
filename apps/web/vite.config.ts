import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Proxy the API so the PWA calls it same-origin (the session cookie rides along).
// Target is the API container in Docker (http://api:3001) or localhost in bare dev.
const apiTarget = process.env.VITE_API_PROXY ?? 'http://localhost:3001';
const apiRoutes = ['/auth', '/me', '/health'];

export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // 0.0.0.0 so the dev server is reachable from outside the container
    port: 5173,
    // Bind-mounted source on macOS/Windows doesn't emit inotify events; poll for HMR.
    watch: { usePolling: true },
    proxy: Object.fromEntries(apiRoutes.map((route) => [route, { target: apiTarget, changeOrigin: true }])),
  },
});
