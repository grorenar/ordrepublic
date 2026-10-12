import { test } from '@playwright/test';
import { openGame } from './helpers';

/**
 * Banc d'essai du rendu + moteur dans le navigateur : `npm run test:e2e -- bench`.
 * Ajoute de gros rassemblements au scénario (via le moteur, avec une cause explicite), puis mesure pendant 4 s de
 * déplacement/zoom automatiques : cadence réelle, coût de dessin Canvas 2D, coût moyen d'un tick du moteur.
 * Les valeurs dépendent fortement de la machine : elles sont affichées, pas promises. Dans un conteneur sans GPU,
 * le rendu logiciel est bien plus lent qu'un poste réel.
 */
for (const extra of [0, 20_000, 50_000]) {
  test(`mesure du rendu et du moteur avec ${extra} manifestants supplémentaires`, async ({ page }) => {
    await openGame(page, 'autostart=paris&map=schematic');
    await page.evaluate((n) => {
      const d = (window as any).__ORDRE__;
      const sim = d.ctrl.sim;
      if (n > 0) {
        const p = d.ctrl.scenario.places.plaza.pos;
        sim.createGroup(
          { label: 'Foule d’essai', kind: 'static', size: n, origin: p, anchor: { id: 'essai', kind: 'place', pos: p, radius: 30, label: 'Banc d’essai', source: 'synthetic' } },
          { kind: 'rule', refId: 'bench', note: 'banc d’essai de performance' },
        );
      }
      d.ctrl.setSpeed(3);
    }, extra);
    await page.waitForTimeout(500);
    await page.evaluate(() => (window as any).__ORDRE__.resetStats());
    const t0 = await page.evaluate(() => ({ ticks: (window as any).__ORDRE__.ctrl.sim.tick, ms: (window as any).__ORDRE__.ctrl.sim.profile.ticks }));
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          const dbg = (window as any).__ORDRE__;
          const o = dbg.city().center;
          const pl = dbg.ctrl.scenario.places.plaza.pos;
          const R = 6378137;
          const lat0 = o.lat + ((pl.y / R) * 180) / Math.PI;
          const lng0 = o.lng + ((pl.x / (R * Math.cos((o.lat * Math.PI) / 180))) * 180) / Math.PI;
          const t0 = performance.now();
          const step = () => {
            const t = (performance.now() - t0) / 1000;
            // caméra autour de la place, zoom 16,2–17,4 : la foule est dessinée individu par individu (pas agrégée en symbole)
            dbg.jumpTo(lng0 + Math.sin(t) * 0.0004, lat0 + Math.cos(t * 0.7) * 0.0003, 16.8 + 0.6 * Math.sin(t * 0.8));
            if (t < 4) requestAnimationFrame(step);
            else resolve();
          };
          step();
        }),
    );
    const s = await page.evaluate(() => (window as any).__ORDRE__.stats());
    const e = await page.evaluate(() => {
      const sim = (window as any).__ORDRE__.ctrl.sim;
      return { ticks: sim.tick, ms: sim.profile.ticks, people: sim.totalPeople() };
    });
    const dt = e.ticks - t0.ticks;
    console.log(
      `BENCH extra=${extra} manifestants=${e.people} points_dessinés≈${s.dots} ` +
        `cadence=${s.fps.toFixed(1)}img/s intervalle_p95=${s.frameIntervalP95Ms.toFixed(1)}ms ` +
        `dessin_moyen=${s.avgMs.toFixed(2)}ms p95=${s.p95Ms.toFixed(2)}ms max=${s.maxMs.toFixed(2)}ms ` +
        `tick_moteur_moyen=${dt > 0 ? ((e.ms - t0.ms) / dt).toFixed(2) : 'n/a'}ms (${dt} ticks)`,
    );
  });
}
