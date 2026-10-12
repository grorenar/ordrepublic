import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';

export default defineConfig({
  // Chemins relatifs : l'application fonctionne à la racine (dev, preview) comme dans un sous-répertoire
  // (GitHub Pages d'un dépôt projet : https://<compte>.github.io/<dépôt>/).
  base: './',
  plugins: [preact()],
  server: { port: 5173, host: true },
  build: { target: 'es2022', chunkSizeWarningLimit: 1200 },
  test: { include: ['tests/unit/**/*.test.ts'], environment: 'node', testTimeout: 60000 },
});
