import { expect, type Page } from '@playwright/test';

export interface Target {
  ref: { type: string; id: string };
  x: number;
  y: number;
}

export async function openGame(page: Page, query: string): Promise<void> {
  await page.goto(`/?debug&${query}`);
  await expect(page.getByTestId('game')).toBeVisible();
  await expect(page.getByTestId('game')).toHaveAttribute('data-map-state', 'ready', { timeout: 20_000 });
  await expect(page.getByTestId('game')).toHaveAttribute('data-engine', 'ready', { timeout: 20_000 });
  // laisse deux images se dessiner
  await page.waitForTimeout(300);
}

export const mapBox = async (page: Page) => {
  const box = await page.getByTestId('map-host').boundingBox();
  if (!box) throw new Error('carte introuvable');
  return box;
};

/** Met la simulation en pause (positions affichées = positions du moteur, sans interpolation). */
export const pauseSim = (page: Page) => page.evaluate(() => (window as any).__ORDRE__.ctrl.setSpeed(0));

/**
 * Écart (en px) entre la position dessinée de chaque unité/véhicule visible et la projection native du fond.
 * À appeler en pause. Les groupes sont dessinés par individu : leur centre n'est pas un point du moteur.
 */
export async function alignmentErrors(page: Page): Promise<{ checked: number; maxErr: number; worst: string }> {
  await pauseSim(page);
  await page.waitForTimeout(120);
  return page.evaluate(() => {
    const dbg = (window as any).__ORDRE__;
    const sim = dbg.ctrl.sim;
    let maxErr = 0;
    let worst = '';
    let checked = 0;
    for (const t of dbg.targets()) {
      if (t.ref.type === 'group') continue;
      const e = sim.entity(t.ref.id);
      if (!e) continue;
      const n = dbg.nativeProject({ x: e.x, y: e.y });
      const err = Math.hypot(n.x - t.x, n.y - t.y);
      checked++;
      if (err > maxErr) {
        maxErr = err;
        worst = t.ref.id;
      }
    }
    return { checked, maxErr, worst };
  });
}

export const targets = (page: Page): Promise<Target[]> => page.evaluate(() => (window as any).__ORDRE__.targets());
export const view = (page: Page) => page.evaluate(() => (window as any).__ORDRE__.getView() as { lng: number; lat: number; zoom: number; width: number; height: number });
export const simTimeMs = (page: Page) => page.evaluate(() => (window as any).__ORDRE__.ctrl.sim.timeMs as number);

/**
 * Sert un paquet de graphe de test pour une ville (double de test : graphe schématique emballé comme un paquet OSM).
 * Sans cela, le fond OSM retombe sur le fond schématique faute de graphe cohérent avec la carte.
 */
export async function servePack(page: Page, cityId: string, center: { lng: number; lat: number }): Promise<void> {
  const { buildSchematicGraph } = await import('../../src/nav/schematicGraph');
  const { packGraph } = await import('../../src/nav/pack');
  const pack = packGraph(buildSchematicGraph(center, 1400, 1050), {
    city: cityId,
    name: cityId,
    generatedAt: '2000-01-01T00:00:00Z',
    source: 'synthetic',
    attribution: 'double de test',
    license: 'test',
  });
  await page.route(`**/data/osm/${cityId}.graph.json`, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(pack) }));
}
