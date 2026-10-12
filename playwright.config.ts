import { defineConfig } from '@playwright/test';

// Chromium pré-installé dans l'environnement de développement : on peut le surcharger
// avec PW_CHROMIUM=/chemin/vers/chrome ; sinon Playwright utilise son navigateur par défaut.
const executablePath = process.env.PW_CHROMIUM;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173',
    launchOptions: {
      executablePath,
      // WebGL est fourni par SwiftShader en environnement sans GPU ; ne pas forcer --use-angle=swiftshader
      // pour le canvas 2D (la rastérisation « GPU » logicielle fausse fortement les mesures de fps).
      args: ['--no-sandbox'],
    },
    viewport: { width: 1360, height: 820 },
  },
  webServer: {
    command: 'npm run build && npm run preview',
    url: 'http://localhost:4173',
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
