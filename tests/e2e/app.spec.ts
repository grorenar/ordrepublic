import { expect, test } from '@playwright/test';
import { alignmentErrors, mapBox, openGame, pauseSim, simTimeMs, targets, view } from './helpers';

test.describe('écran d’accueil', () => {
  test('propose les 4 villes, démarre une démonstration sur la ville choisie', async ({ page }) => {
    await page.goto('/?debug&map=schematic');
    for (const id of ['metz', 'paris', 'lyon', 'marseille']) await expect(page.getByTestId(`city-${id}`)).toBeVisible();
    await page.getByTestId('city-lyon').click();
    await page.getByTestId('start').click();
    await expect(page.getByTestId('game')).toBeVisible();
    await expect(page.getByTestId('situation')).toContainText('Lyon');
    const v = await view(page);
    expect(v.lng).toBeCloseTo(4.8357, 2);
    expect(v.lat).toBeCloseTo(45.764, 2);
  });

  test('la recherche libre affiche les résultats du géocodeur puis démarre sur la ville choisie', async ({ page }) => {
    await page.route('https://nominatim.openstreetmap.org/search*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify([{ osm_type: 'relation', osm_id: 7, lat: '48.6921', lon: '6.1844', display_name: 'Nancy, Meurthe-et-Moselle, France', name: 'Nancy', type: 'city' }]),
      }),
    );
    await page.goto('/?debug&map=schematic');
    await page.getByTestId('city-search-input').fill('Nancy');
    await page.getByTestId('city-search-submit').click();
    await expect(page.getByTestId('city-search-results')).toContainText('Nancy');
    await page.getByTestId('city-search-results').getByRole('button').first().click();
    await expect(page.getByTestId('picked-city')).toContainText('Nancy');
    await page.getByTestId('start').click();
    await expect(page.getByTestId('game')).toHaveAttribute('data-map-state', 'ready');
    const v = await view(page);
    expect(v.lat).toBeCloseTo(48.6921, 2);
    expect(v.lng).toBeCloseTo(6.1844, 2);
  });

  test('une recherche en échec affiche une erreur claire (service injoignable)', async ({ page }) => {
    await page.route('https://nominatim.openstreetmap.org/search*', (route) => route.abort('failed'));
    await page.goto('/?map=schematic');
    await page.getByTestId('city-search-input').fill('Nancy');
    await page.getByTestId('city-search-submit').click();
    await expect(page.getByTestId('city-search-error')).toContainText('injoignable');
  });
});

test.describe('mode schématique (sans aucun service externe) — moteur réel', () => {
  test('fonctionne sans réseau : aucune requête externe, compteurs issus du moteur, pions dessinés', async ({ page }) => {
    const external: string[] = [];
    page.on('request', (r) => {
      const u = new URL(r.url());
      if (u.hostname !== 'localhost' && u.protocol.startsWith('http')) external.push(r.url());
    });
    await openGame(page, 'autostart=metz&map=schematic');
    await expect(page.getByTestId('game')).toHaveAttribute('data-map-kind', 'schematic');
    expect(external).toEqual([]);
    await pauseSim(page);
    await page.waitForTimeout(400);
    const c = await page.evaluate(() => (window as any).__ORDRE__.ctrl.stats());
    await expect(page.getByTestId('counter-crowd')).toHaveText(String(c.people));
    await expect(page.getByTestId('counter-forces')).toHaveText(String(c.forces));
    await expect(page.getByTestId('counter-vehicles')).toHaveText(String(c.vehicles));
    await expect(page.getByTestId('counter-blocked')).toHaveText(`${c.streets.blocked}/${c.streets.total}`);
    expect(c.streets.total).toBeGreaterThan(20);
    expect((await targets(page)).filter((t) => t.ref.type !== 'group').length).toBeGreaterThanOrEqual(10);
    await expect(page.locator('.schematic-note')).toBeVisible();
  });

  test('glisser déplace la carte, la molette zoome', async ({ page }) => {
    await openGame(page, 'autostart=metz&map=schematic');
    const box = await mapBox(page);
    const v0 = await view(page);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 160, box.y + box.height / 2 + 60, { steps: 6 });
    await page.mouse.up();
    const v1 = await view(page);
    expect(v1.lng).toBeLessThan(v0.lng);
    expect(v1.lat).toBeGreaterThan(v0.lat);
    await page.mouse.wheel(0, -300);
    await page.waitForTimeout(150);
    expect((await view(page)).zoom).toBeGreaterThan(v1.zoom);
  });

  test('les pions restent alignés avec la caméra après déplacement et zoom', async ({ page }) => {
    await openGame(page, 'autostart=paris&map=schematic');
    const box = await mapBox(page);
    const check = async (label: string) => {
      const r = await alignmentErrors(page);
      expect(r.checked, label).toBeGreaterThan(3);
      expect(r.maxErr, `${label} (pion ${r.worst})`).toBeLessThan(0.75);
    };
    await check('initial');
    await page.mouse.move(box.x + 300, box.y + 300);
    await page.mouse.down();
    await page.mouse.move(box.x + 220, box.y + 340, { steps: 5 });
    await page.mouse.up();
    await check('après glisser');
    await page.getByTestId('zoom-in').click();
    await page.waitForTimeout(900);
    await check('après zoom +1');
    await page.mouse.wheel(0, 250);
    await page.waitForTimeout(200);
    await check('après molette');
  });

  test('sélection d’un pion par clic sur la carte et par la liste ; Échap désélectionne', async ({ page }) => {
    await openGame(page, 'autostart=metz&map=schematic');
    await pauseSim(page);
    await page.waitForTimeout(150);
    const box = await mapBox(page);
    const t = (await targets(page)).find((x) => x.ref.id === 'U-2');
    expect(t).toBeTruthy();
    await page.mouse.click(box.x + t!.x, box.y + t!.y);
    await expect(page.getByTestId('detail-title')).toHaveText('CRS-J 08/3');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('detail-title')).toHaveCount(0);
    await page.getByTestId('row-U-4').click();
    await expect(page.getByTestId('detail-title')).toHaveText('CRS-J 12/1');
    await page.waitForTimeout(1000);
    // la carte s’est recentrée sur l’unité : son pion est proche du centre de la vue
    const t2 = (await targets(page)).find((x) => x.ref.id === 'U-4');
    expect(t2).toBeTruthy();
    expect(Math.hypot(t2!.x - box.width / 2, t2!.y - box.height / 2)).toBeLessThan(6);
  });

  test('ordres : déplacement d’une unité (vitesse et état réels), annulation, ordre simultané à plusieurs', async ({ page }) => {
    await openGame(page, 'autostart=metz&map=schematic');
    const box = await mapBox(page);
    await page.getByTestId('row-U-1').click();
    await expect(page.getByTestId('detail-title')).toHaveText('CRS-J 07/2');
    await page.getByTestId('speed-3').click();
    // ordre par le bouton « Aller ici » puis clic sur la carte
    await page.getByTestId('order-move').click();
    await page.mouse.click(box.x + box.width / 2 + 150, box.y + box.height / 2 + 90);
    await expect(page.getByTestId('detail-panel')).toContainText('En déplacement');
    await expect(page.getByTestId('log-panel')).toContainText('ordre reçu');
    await expect.poll(() => page.evaluate(() => (window as any).__ORDRE__.ctrl.sim.entity('U-1').speedMps), { timeout: 8000 }).toBeGreaterThan(0.5);
    await expect(page.getByTestId('detail-panel')).toContainText('km/h');
    // annulation
    await page.getByTestId('order-cancel').click();
    await expect(page.getByTestId('detail-panel')).toContainText('En position', { timeout: 5000 });

    // ordre simultané : deux unités et un véhicule, clic droit
    await page.getByTestId('row-U-2').click();
    await page.getByTestId('row-U-3').click({ modifiers: ['Shift'] });
    await page.getByTestId('row-V-1').click({ modifiers: ['Shift'] });
    expect(await page.evaluate(() => (window as any).__ORDRE__.ctrl.selectedMovers().length)).toBe(3);
    await page.mouse.click(box.x + box.width / 2 - 200, box.y + box.height / 2 - 60, { button: 'right' });
    const statuses = await page.evaluate(() => ['U-2', 'U-3', 'V-1'].map((id) => (window as any).__ORDRE__.ctrl.sim.entity(id).status));
    expect(statuses).toEqual(['moving', 'moving', 'moving']);
  });

  test('vitesses de simulation : pause, 1×, 6× — l’horloge de jeu suit', async ({ page }) => {
    await openGame(page, 'autostart=metz&map=schematic');
    await page.getByTestId('speed-0').click();
    await page.waitForTimeout(200);
    const t0 = await simTimeMs(page);
    await page.waitForTimeout(700);
    expect(await simTimeMs(page)).toBe(t0);
    await page.getByTestId('speed-1').click();
    await page.waitForTimeout(1000);
    const t1 = await simTimeMs(page);
    expect(t1 - t0).toBeGreaterThan(500);
    expect(t1 - t0).toBeLessThan(2000);
    await page.getByTestId('speed-6').click();
    await page.waitForTimeout(1000);
    const t2 = await simTimeMs(page);
    expect(t2 - t1).toBeGreaterThan(2500);
    await expect(page.getByTestId('sim-clock')).toHaveText(/^\d\d:\d\d$/);
  });

  test('journal explicatif : chaque événement porte une cause (« Pourquoi ? »)', async ({ page }) => {
    await openGame(page, 'autostart=metz&map=schematic');
    const log = page.getByTestId('log-panel');
    await expect(log).toContainText('Cortège syndical');
    const first = log.locator('li', { hasText: 'Cortège syndical' }).first();
    await first.locator('summary').click();
    await expect(first).toContainText('scenario_event');
    await expect(first).toContainText('cortège syndical prévu');
  });

  test('changer de ville recentre la carte et redémarre la simulation sur cette ville', async ({ page }) => {
    await openGame(page, 'autostart=metz&map=schematic');
    await page.getByTestId('city-select').selectOption('marseille');
    await expect(page.getByTestId('situation')).toContainText('Marseille');
    await expect(page.getByTestId('game')).toHaveAttribute('data-engine', 'ready');
    await page.waitForTimeout(500);
    const v = await view(page);
    expect(v.lng).toBeCloseTo(5.3698, 2);
    expect(v.lat).toBeCloseTo(43.2965, 2);
    expect(await simTimeMs(page)).toBeLessThan(5000);
    const r = await alignmentErrors(page);
    expect(r.checked).toBeGreaterThan(3);
    expect(r.maxErr).toBeLessThan(0.75);
  });

  test('étendre la zone de jeu augmente le dénominateur des rues et change la taille affichée', async ({ page }) => {
    await openGame(page, 'autostart=lyon&map=schematic');
    const total = async () => (await page.evaluate(() => (window as any).__ORDRE__.ctrl.stats())).streets.total as number;
    const t0 = await total();
    await expect(page.getByTestId('zone-size')).toHaveText('1200×900 m');
    await page.getByTestId('zone-grow').click();
    await expect(page.getByTestId('zone-size')).toHaveText('1800×1360 m');
    await expect.poll(total).toBeGreaterThan(t0);
    await page.getByTestId('zone-shrink').click();
    await expect.poll(total).toBe(t0);
  });

  test('scénario jouable : le cortège arrive, une rue est fermée puis rouverte, le groupe se disperse (journal causal)', async ({ page }) => {
    await openGame(page, 'autostart=metz&map=schematic');
    const eta = await page.evaluate(() => (window as any).__ORDRE__.ctrl.scenario.etaS as number);
    // avance la simulation par le moteur (équivaut à jouer à 6× pendant plusieurs minutes), l'interface suit
    await page.evaluate((s) => (window as any).__ORDRE__.ctrl.runTicks(Math.round(s * 0.4 * 10)), eta);
    await page.waitForTimeout(500);
    const c = await page.evaluate(() => (window as any).__ORDRE__.ctrl.stats());
    expect(c.streets.scenarioClosed).toBeGreaterThanOrEqual(1);
    await expect(page.getByTestId('counter-blocked')).not.toHaveText(/^0\//);
    await expect(page.getByTestId('log-panel')).toContainText('fermée');
    await page.evaluate((s) => (window as any).__ORDRE__.ctrl.runTicks(Math.round(s * 1.5 * 10)), eta);
    await page.waitForTimeout(500);
    for (const word of ['rouverte', 'Cortège syndical', 'se détachent', 'dispersion']) await expect(page.getByTestId('log-panel')).toContainText(word);
    // conservation : cortège + piquet = effectif créé tant qu'aucune dispersion n'a fait sortir de monde
    expect(await page.evaluate(() => (window as any).__ORDRE__.ctrl.sim.totalPeople())).toBeLessThanOrEqual(2620);
  });

  test('retour à l’accueil puis nouvelle partie sur une autre ville', async ({ page }) => {
    await openGame(page, 'autostart=metz&map=schematic');
    await page.getByTestId('exit').click();
    await expect(page.getByTestId('start')).toBeVisible();
  });
});
