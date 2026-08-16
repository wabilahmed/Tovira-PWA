import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// Static marketing site — two prerendered pages (/ and /ar), zero app deps and
// no runtime framework. Built and deployed independently of apps/web so a
// marketing change can never risk the product.
export default defineConfig({
  appType: 'mpa',
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        ar: fileURLToPath(new URL('./ar/index.html', import.meta.url)),
        privacy: fileURLToPath(new URL('./privacy/index.html', import.meta.url)),
        terms: fileURLToPath(new URL('./terms/index.html', import.meta.url)),
        arPrivacy: fileURLToPath(new URL('./ar/privacy/index.html', import.meta.url)),
        arTerms: fileURLToPath(new URL('./ar/terms/index.html', import.meta.url)),
      },
    },
  },
  server: { port: 4321 },
});
