import { test } from '@playwright/test';
import { openGame } from './helpers';

/**
 * Banc d'essai reproductible : `npm run test:e2e -- bench`.
 * Mesure, pendant 4 s de déplacement/zoom automatiques sur le fond schématique : la cadence réelle
 * (intervalle entre images navigateur) et le coût de dessin de la couche de jeu (Canvas 2D).
 * Les valeurs dépendent fortement de la machine : elles sont affichées, pas promises.
 * Attention : dans un conteneur sans GPU, forcer SwiftShader pour le canvas 2D divise la cadence par 4 à 10 ;
 * c'est un artefact de l'environnement de test, pas du jeu.
 */
for (const extra of [0, 6, 14]) {
  test(`mesure du rendu avec ${extra} groupes d'essai`, async ({ page }) => {
    await openGame(page, `autostart=paris&map=schematic&bench=${extra}`);
    await page.evaluate(() => (window as any).__ORDRE__.resetStats());
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          const dbg = (window as any).__ORDRE__;
          const v = dbg.getView();
          const t0 = performance.now();
          const step = () => {
            const t = (performance.now() - t0) / 1000;
            dbg.jumpTo(v.lng + Math.sin(t) * 0.002, v.lat + Math.cos(t * 0.7) * 0.0012, v.zoom + 0.6 * Math.sin(t * 0.8));
            if (t < 4) requestAnimationFrame(step);
            else resolve();
          };
          step();
        }),
    );
    const s = await page.evaluate(() => (window as any).__ORDRE__.stats());
    const c = await page.evaluate(() => (window as any).__ORDRE__.counters());
    console.log(
      `BENCH groupes=${extra + 4} manifestants=${c.headcountCrowd} points_dessinés≈${s.dots} ` +
        `cadence=${s.fps.toFixed(1)}img/s intervalle_p95=${s.frameIntervalP95Ms.toFixed(1)}ms ` +
        `coût_dessin_moyen=${s.avgMs.toFixed(2)}ms p95=${s.p95Ms.toFixed(2)}ms max=${s.maxMs.toFixed(2)}ms`,
    );
  });
}
