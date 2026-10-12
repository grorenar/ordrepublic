import { expect, test } from '@playwright/test';
import { alignmentErrors, mapBox, openGame, targets, view } from './helpers';

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

test.describe('mode schématique (sans aucun service externe)', () => {
  test('fonctionne sans réseau : aucune requête externe, compteurs réels, pions dessinés', async ({ page }) => {
    const external: string[] = [];
    page.on('request', (r) => {
      const u = new URL(r.url());
      if (u.hostname !== 'localhost' && u.protocol.startsWith('http')) external.push(r.url());
    });
    await openGame(page, 'autostart=metz&map=schematic');
    await expect(page.getByTestId('game')).toHaveAttribute('data-map-kind', 'schematic');
    expect(external).toEqual([]);
    const c = await page.evaluate(() => (window as any).__ORDRE__.counters());
    await expect(page.getByTestId('counter-crowd')).toHaveText(String(c.headcountCrowd));
    await expect(page.getByTestId('counter-blocked')).toHaveText(`${c.blocked}/${c.totalSegments}`);
    expect(c.totalSegments).toBeGreaterThan(20);
    expect((await targets(page)).length).toBeGreaterThan(10);
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
    const box = await mapBox(page);
    const t = (await targets(page)).find((x) => x.ref.id === 'U-8');
    expect(t).toBeTruthy();
    await page.mouse.click(box.x + t!.x, box.y + t!.y);
    await expect(page.getByTestId('detail-title')).toHaveText('CRS-J 08/3');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('detail-title')).toHaveCount(0);
    await page.getByTestId('row-U-12').click();
    await expect(page.getByTestId('detail-title')).toHaveText('CRS-J 12/1');
    await page.waitForTimeout(1000);
    // la carte s’est recentrée sur l’unité : son pion est proche du centre de la vue
    const t2 = (await targets(page)).find((x) => x.ref.id === 'U-12');
    expect(t2).toBeTruthy();
    expect(Math.hypot(t2!.x - box.width / 2, t2!.y - box.height / 2)).toBeLessThan(6);
  });

  test('changer de ville recentre la carte et régénère tous les pions', async ({ page }) => {
    await openGame(page, 'autostart=metz&map=schematic');
    const before = await page.evaluate(() => (window as any).__ORDRE__.entities());
    await page.getByTestId('city-select').selectOption('marseille');
    await expect(page.getByTestId('situation')).toContainText('Marseille');
    await page.waitForTimeout(300);
    const v = await view(page);
    expect(v.lng).toBeCloseTo(5.3698, 2);
    expect(v.lat).toBeCloseTo(43.2965, 2);
    const after = await page.evaluate(() => (window as any).__ORDRE__.entities());
    expect(after.units.length).toBe(before.units.length);
    expect(await page.getByTestId('log-panel').innerText()).toContain('Marseille');
    expect(await page.getByTestId('log-panel').innerText()).not.toContain('Metz');
    const r = await alignmentErrors(page);
    expect(r.checked).toBeGreaterThan(3);
    expect(r.maxErr).toBeLessThan(0.75);
    // tous les pions visibles sont autour du nouveau centre, pas de reliquat de l’ancienne ville
    for (const t of await targets(page)) {
      const box = await mapBox(page);
      expect(t.x).toBeGreaterThan(-200);
      expect(t.x).toBeLessThan(box.width + 200);
    }
  });

  test('étendre la zone de jeu augmente le dénominateur des rues et change la taille affichée', async ({ page }) => {
    await openGame(page, 'autostart=lyon&map=schematic');
    const total = async () => (await page.evaluate(() => (window as any).__ORDRE__.counters())).totalSegments as number;
    const t0 = await total();
    await expect(page.getByTestId('zone-size')).toHaveText('760×580 m');
    await page.getByTestId('zone-grow').click();
    await expect(page.getByTestId('zone-size')).toHaveText('1200×900 m');
    await expect.poll(total).toBeGreaterThan(t0);
    await page.getByTestId('zone-shrink').click();
    await expect.poll(total).toBe(t0);
  });

  test('un événement de démonstration crée un bandeau, une ligne de journal et incrémente le compteur', async ({ page }) => {
    await openGame(page, 'autostart=metz&map=schematic');
    const before = Number(await page.getByTestId('counter-incidents').innerText());
    await page.getByTestId('demo-event').click();
    await expect(page.getByTestId('banner')).toBeVisible();
    await expect(page.getByTestId('counter-incidents')).toHaveText(String(before + 1));
    await expect(page.getByTestId('log-panel')).toContainText('Départ de feu');
  });

  test('retour à l’accueil puis nouvelle partie sur une autre ville', async ({ page }) => {
    await openGame(page, 'autostart=metz&map=schematic');
    await page.getByTestId('exit').click();
    await expect(page.getByTestId('start')).toBeVisible();
  });
});
