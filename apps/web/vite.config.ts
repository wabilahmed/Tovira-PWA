import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // 0.0.0.0 so the dev server is reachable from outside the container
    port: 5173,
    // Bind-mounted source on macOS/Windows doesn't emit inotify events; poll for HMR.
    watch: { usePolling: true },
  },
});
