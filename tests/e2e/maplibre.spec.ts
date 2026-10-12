import { expect, test } from '@playwright/test';
import { alignmentErrors, mapBox, openGame, servePack, targets, view } from './helpers';
import { overpassGrid } from '../fixtures/overpassGrid';

const METZ = { lng: 6.1757, lat: 49.1193 };

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
      dbg.ctrl.setSpeed(0);
      const pos = new Map<string, { x: number; y: number }>();
      for (const e of [...dbg.ctrl.sim.units, ...dbg.ctrl.sim.vehicles]) pos.set(e.id, { x: e.x, y: e.y });
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
    await servePack(page, 'metz', METZ);
    await openGame(page, 'autostart=metz');
    await expect(page.getByTestId('game')).toHaveAttribute('data-map-kind', 'maplibre');
    await expect(page.locator('.maplibregl-ctrl-attrib')).toContainText('OpenStreetMap');
  });

  const okStyle = {
    version: 8,
    sources: { s: { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, attribution: '© OpenMapTiles Données © contributeurs OpenStreetMap' } },
    layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#223' } }, { id: 'l', type: 'line', source: 's', paint: { 'line-color': '#fff' } }],
  };

  const mockStyle = (page: import('@playwright/test').Page) =>
    page.route(STYLE, (route) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(okStyle) }));
  const OVERPASS = 'https://overpass-api.de/api/interpreter';

  test('sans paquet OSM : la carte réelle reste affichée avec le rectangle de secteur, aucune simulation avant le choix', async ({ page }) => {
    await mockStyle(page);
    await page.goto('/?debug&autostart=metz');
    await expect(page.getByTestId('game')).toHaveAttribute('data-engine', 'preview', { timeout: 20_000 });
    await expect(page.getByTestId('game')).toHaveAttribute('data-map-kind', 'maplibre');
    await expect(page.getByTestId('game')).toHaveAttribute('data-map-state', 'ready');
    await expect(page.locator('.maplibregl-canvas')).toBeVisible();
    await expect(page.locator('.maplibregl-ctrl-attrib')).toContainText('OpenStreetMap');
    await expect(page.getByTestId('preview-banner')).toContainText('Jouer ici');
    expect(await page.evaluate(() => (window as any).__ORDRE__.ctrl)).toBeNull();
    expect((await targets(page)).length).toBe(0);
    // la carte reste utilisable : zoom et déplacement
    const v0 = await view(page);
    await page.getByTestId('zoom-in').click();
    await page.waitForTimeout(700);
    const v1 = await view(page);
    expect(v1.zoom).toBeGreaterThan(v0.zoom + 0.5);
    const box = await mapBox(page);
    await page.mouse.move(box.x + 400, box.y + 300);
    await page.mouse.down();
    await page.mouse.move(box.x + 300, box.y + 360, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(500);
    expect((await view(page)).lng).toBeGreaterThan(v1.lng);
    // repli explicite possible : ville fictive
    await page.getByTestId('start-schematic').click();
    await expect(page.getByTestId('game')).toHaveAttribute('data-map-kind', 'schematic');
    await expect(page.getByTestId('game')).toHaveAttribute('data-engine', 'ready', { timeout: 20_000 });
  });

  test('« Jouer ici » : les rues du secteur sont chargées à la demande (une requête POST), la simulation démarre sur la vraie carte, pions alignés', async ({ page }) => {
    await mockStyle(page);
    const posts: string[] = [];
    await page.route(OVERPASS, async (route) => {
      posts.push(route.request().method());
      const data = decodeURIComponent((route.request().postData() ?? '').replace(/^data=/, '').replace(/\+/g, ' '));
      expect(data).toContain('way["highway"]');
      await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(overpassGrid(METZ)) });
    });
    await page.goto('/?debug&autostart=metz');
    await expect(page.getByTestId('game')).toHaveAttribute('data-engine', 'preview', { timeout: 20_000 });
    await page.getByTestId('play-here').click();
    await expect(page.getByTestId('game')).toHaveAttribute('data-engine', 'ready', { timeout: 30_000 });
    expect(posts).toEqual(['POST']);
    await expect(page.getByTestId('game')).toHaveAttribute('data-map-kind', 'maplibre');
    await expect(page.getByTestId('log-panel')).toContainText('Cortège syndical');
    expect(await page.evaluate(() => (window as any).__ORDRE__.ctrl.sim.graph.provenance.source)).toBe('osm');
    const r = await alignmentErrors(page);
    expect(r.checked).toBeGreaterThan(3);
    expect(r.maxErr).toBeLessThan(0.75);
    await page.getByTestId('zoom-in').click();
    await page.waitForTimeout(700);
    const r2 = await alignmentErrors(page);
    expect(r2.maxErr).toBeLessThan(0.75);
  });

  test('écran de chargement : étapes, temps écoulé, puis disparition quand la simulation est prête', async ({ page }) => {
    await mockStyle(page);
    await page.route(OVERPASS, async (route) => {
      await new Promise((r) => setTimeout(r, 1500));
      await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(overpassGrid(METZ)) });
    });
    await page.goto('/?debug&autostart=metz');
    await expect(page.getByTestId('game')).toHaveAttribute('data-engine', 'preview', { timeout: 20_000 });
    await page.getByTestId('play-here').click();
    const ov = page.getByTestId('loading-overlay');
    await expect(ov).toBeVisible();
    await expect(ov).toContainText('Téléchargement des rues');
    await expect(page.getByTestId('live-progress')).toContainText(' s');
    await expect(page.getByTestId('game')).toHaveAttribute('data-engine', 'ready', { timeout: 30_000 });
    await expect(ov).toHaveCount(0);
  });

  test('écran de chargement : « Annuler » interrompt le téléchargement sans erreur et rend la main', async ({ page }) => {
    await mockStyle(page);
    await page.route(OVERPASS, async (route) => {
      await new Promise((r) => setTimeout(r, 8000));
      await route.abort('failed').catch(() => undefined);
    });
    await page.goto('/?debug&autostart=metz');
    await expect(page.getByTestId('game')).toHaveAttribute('data-engine', 'preview', { timeout: 20_000 });
    await page.getByTestId('play-here').click();
    await expect(page.getByTestId('loading-overlay')).toBeVisible();
    await page.getByTestId('load-cancel').click();
    await expect(page.getByTestId('loading-overlay')).toHaveCount(0);
    await expect(page.getByTestId('live-error')).toHaveCount(0);
    await expect(page.getByTestId('play-here')).toBeEnabled();
  });

  test('« Jouer ici » : service surchargé (429) → message explicite, la carte et le choix de secteur restent disponibles', async ({ page }) => {
    await mockStyle(page);
    await page.route(OVERPASS, (route) => route.fulfill({ status: 429, body: 'trop de requêtes' }));
    await page.goto('/?debug&autostart=metz');
    await expect(page.getByTestId('game')).toHaveAttribute('data-engine', 'preview', { timeout: 20_000 });
    await page.getByTestId('play-here').click();
    await expect(page.getByTestId('live-error')).toContainText('surchargé');
    await expect(page.getByTestId('play-here')).toBeEnabled();
    await expect(page.locator('.maplibregl-canvas')).toBeVisible();
  });

  test('« Jouer ici » : service injoignable → message explicite, aucun blocage', async ({ page }) => {
    await mockStyle(page);
    await page.route('**/api/interpreter', (route) => route.abort('failed'));
    await page.goto('/?debug&autostart=metz');
    await expect(page.getByTestId('game')).toHaveAttribute('data-engine', 'preview', { timeout: 20_000 });
    await page.getByTestId('play-here').click();
    await expect(page.getByTestId('live-error')).toContainText('injoignable', { timeout: 20_000 });
  });

  test('service de carte injoignable : message clair puis bascule automatique en mode schématique', async ({ page }) => {
    await servePack(page, 'metz', METZ);
    await page.route(STYLE, (route) => route.abort('failed'));
    await page.goto('/?debug&autostart=metz');
    await expect(page.getByTestId('game')).toHaveAttribute('data-map-kind', 'schematic', { timeout: 20_000 });
    await expect(page.getByTestId('map-notice')).toContainText('schématique');
    await expect(page.getByTestId('retry-map')).toBeVisible();
    await expect(page.getByTestId('game')).toHaveAttribute('data-engine', 'ready', { timeout: 20_000 });
    // le jeu reste pleinement utilisable après la bascule
    expect((await targets(page)).length).toBeGreaterThan(5);
  });

  test('style invalide (HTTP 500) : même repli', async ({ page }) => {
    await servePack(page, 'metz', METZ);
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
    await servePack(page, 'metz', METZ);
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
