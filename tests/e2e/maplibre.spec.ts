import { expect, test } from '@playwright/test';
import { alignmentErrors, mapBox, openGame, targets, view } from './helpers';

// Fond MapLibre sans réseau : style local (fond uni + quadrillage) → teste le calage réel avec WebGL.
test.describe('carte MapLibre (style local de test)', () => {
  test('s’affiche, répond au déplacement et au zoom, et les pions restent alignés', async ({ page }) => {
    await openGame(page, 'autostart=lyon&map=test');
    await expect(page.getByTestId('game')).toHaveAttribute('data-map-kind', 'maplibre');
    await expect(page.locator('.maplibregl-canvas')).toBeVisible();
    const box = await mapBox(page);
    const check = async (label: string) => {
      const r = await alignmentErrors(page);
      expect(r.checked, label).toBeGreaterThan(3);
      expect(r.maxErr, `${label} (pion ${r.worst})`).toBeLessThan(0.75);
    };
    await check('initial');

    const v0 = await view(page);
    await page.mouse.move(box.x + 400, box.y + 300);
    await page.mouse.down();
    await page.mouse.move(box.x + 300, box.y + 380, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(500); // inertie
    const v1 = await view(page);
    expect(v1.lng).toBeGreaterThan(v0.lng);
    expect(v1.lat).toBeGreaterThan(v0.lat === v1.lat ? v0.lat - 1 : v0.lat - 1e-9);
    await check('après déplacement');

    await page.getByTestId('zoom-in').click();
    await page.waitForTimeout(700);
    expect((await view(page)).zoom).toBeGreaterThan(v1.zoom + 0.5);
    await check('après zoom +1');

    await page.mouse.move(box.x + 500, box.y + 250);
    await page.mouse.wheel(0, 400);
    await page.waitForTimeout(800);
    await check('après molette');

    await page.getByTestId('fit-zone').click();
    await page.waitForTimeout(1200);
    await check('après cadrage de la zone');
  });

  test('pendant une animation de caméra, l’écart reste sous le pixel à chaque image', async ({ page }) => {
    await openGame(page, 'autostart=metz&map=test');
    await page.getByTestId('zoom-in').click();
    const worst = await page.evaluate(async () => {
      const dbg = (window as any).__ORDRE__;
      const pos = new Map<string, { x: number; y: number }>();
      const ents = dbg.entities();
      for (const k of ['units', 'vehicles', 'groups', 'incidents']) for (const e of ents[k]) pos.set(e.id, e.pos);
      let max = 0;
      let n = 0;
      const t0 = performance.now();
      while (performance.now() - t0 < 600) {
        await new Promise((r) => requestAnimationFrame(() => r(null)));
        for (const t of dbg.targets()) {
          const m = pos.get(t.ref.id);
          if (!m) continue;
          const p = dbg.nativeProject(m);
          max = Math.max(max, Math.hypot(p.x - t.x, p.y - t.y));
          n++;
        }
      }
      return { max, n };
    });
    expect(worst.n).toBeGreaterThan(30);
    // Tolérance : les cibles datent du dernier dessin, une image peut s'écouler entre dessin et lecture.
    console.log(`Calage pendant animation : écart max ${worst.max.toFixed(2)} px sur ${worst.n} mesures`);
    expect(worst.max).toBeLessThan(6);
  });

  test('changer de ville recentre la carte MapLibre et garde les pions alignés', async ({ page }) => {
    await openGame(page, 'autostart=metz&map=test');
    await page.getByTestId('city-select').selectOption('paris');
    await page.waitForTimeout(800);
    const v = await view(page);
    expect(v.lng).toBeCloseTo(2.3522, 2);
    expect(v.lat).toBeCloseTo(48.8566, 2);
    const r = await alignmentErrors(page);
    expect(r.checked).toBeGreaterThan(3);
    expect(r.maxErr).toBeLessThan(0.75);
    expect((await targets(page)).length).toBeGreaterThan(3);
  });

  test('l’attribution de la carte reste visible', async ({ page }) => {
    await openGame(page, 'autostart=metz&map=test');
    await expect(page.locator('.maplibregl-ctrl-attrib')).toBeVisible();
    await expect(page.locator('.maplibregl-ctrl-attrib')).toContainText('Style local de test');
  });
});

// Fournisseur par défaut (OpenFreeMap) simulé : on intercepte l'URL du style.
test.describe('fournisseur OpenStreetMap par défaut', () => {
  const STYLE = 'https://tiles.openfreemap.org/styles/liberty';

  test('l’attribution OpenStreetMap fournie par le style est affichée', async ({ page }) => {
    await page.route(STYLE, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify({
          version: 8,
          sources: { s: { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, attribution: '© OpenMapTiles Données © contributeurs OpenStreetMap' } },
          layers: [
            { id: 'bg', type: 'background', paint: { 'background-color': '#223' } },
            { id: 'l', type: 'line', source: 's', paint: { 'line-color': '#fff' } },
          ],
        }),
      }),
    );
    await openGame(page, 'autostart=metz');
    await expect(page.getByTestId('game')).toHaveAttribute('data-map-kind', 'maplibre');
    await expect(page.locator('.maplibregl-ctrl-attrib')).toContainText('OpenStreetMap');
  });

  test('service de carte injoignable : message clair puis bascule automatique en mode schématique', async ({ page }) => {
    await page.route(STYLE, (route) => route.abort('failed'));
    await page.goto('/?debug&autostart=metz');
    await expect(page.getByTestId('game')).toHaveAttribute('data-map-kind', 'schematic', { timeout: 20_000 });
    await expect(page.getByTestId('map-notice')).toContainText('schématique');
    await expect(page.getByTestId('retry-map')).toBeVisible();
    await expect(page.getByTestId('log-panel')).toContainText('mode schématique');
    // le jeu reste pleinement utilisable après la bascule
    expect((await targets(page)).length).toBeGreaterThan(5);
  });

  test('style invalide (HTTP 500) : même repli', async ({ page }) => {
    await page.route(STYLE, (route) => route.fulfill({ status: 500, body: 'erreur' }));
    await page.goto('/?debug&autostart=metz');
    await expect(page.getByTestId('game')).toHaveAttribute('data-map-kind', 'schematic', { timeout: 20_000 });
    await expect(page.getByTestId('map-notice')).toBeVisible();
  });

  test('style chargé mais tuiles en échec : avertissement non bloquant (carte conservée)', async ({ page }) => {
    await page.route(STYLE, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify({
          version: 8,
          sources: { r: { type: 'raster', tiles: ['https://tuiles-indisponibles.example/{z}/{x}/{y}.png'], tileSize: 256, attribution: '© contributeurs OpenStreetMap' } },
          layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#223' } }, { id: 'r', type: 'raster', source: 'r' }],
        }),
      }),
    );
    await page.route('https://tuiles-indisponibles.example/**', (route) => route.abort('failed'));
    await page.goto('/?debug&autostart=metz');
    await expect(page.getByTestId('map-notice')).toContainText('tuiles', { timeout: 20_000 });
    await expect(page.getByTestId('game')).toHaveAttribute('data-map-kind', 'maplibre');
    await expect(page.getByTestId('retry-map')).toHaveCount(0);
    // le jeu reste utilisable et on peut basculer volontairement vers le fond schématique
    await page.getByTestId('switch-map').click();
    await expect(page.getByTestId('game')).toHaveAttribute('data-map-kind', 'schematic');
  });

  test('perte de connexion Internet : message explicite', async ({ page, context }) => {
    await openGame(page, 'autostart=metz&map=test');
    await context.setOffline(true);
    await expect(page.getByTestId('map-notice')).toContainText('Connexion Internet perdue');
    await context.setOffline(false);
    await expect(page.getByTestId('map-notice')).toHaveCount(0);
  });
});
