import { expect, test } from '@playwright/test';
import { mapBox, openGame, pauseSim, targets } from './helpers';

/** Centre la vue sur un point du moteur (mètres locaux) au zoom donné. */
async function focus(page: import('@playwright/test').Page, x: number, y: number, zoom: number) {
  const where = await page.evaluate(() => (window as any).__ORDRE__.city().center);
  const lat = where.lat + y / 111320;
  const lng = where.lng + x / (111320 * Math.cos((where.lat * Math.PI) / 180));
  await page.evaluate(([a, b, z]) => (window as any).__ORDRE__.jumpTo(a, b, z), [lng, lat, zoom] as const);
  await page.waitForTimeout(500);
}

test.describe('phase 4 : incidents et lieux d’intérêt', () => {
  test('un incident déclenché dans le moteur apparaît partout, avec ses causes, et les compteurs reflètent l’état réel', async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await openGame(page, 'autostart=metz&map=schematic');
    const bin = await page.evaluate(() => {
      const d = (window as any).__ORDRE__;
      const sim = d.ctrl.sim;
      const it = sim.world.decor.find((x: any) => x.kind === 'bin' && x.source === 'synthetic');
      sim.incidents.spawnNear('bin_fire', it.x, it.y, { kind: 'scenario_event', refId: 'test-e2e', note: 'incident déclenché par le test navigateur' });
      d.ctrl.runTicks(150);
      return { x: it.x, y: it.y };
    });
    await expect(page.getByTestId('counter-incidents')).toHaveText('1');
    const stats = await page.evaluate(() => (window as any).__ORDRE__.ctrl.stats().incidents);
    expect(stats.active).toBe(1);
    expect(stats.fires).toBe(1);
    await expect(page.getByTestId('incident-list')).toContainText('Feu de poubelle');
    await expect(page.getByTestId('counter-damage')).toContainText('€ fictifs');
    // l'incident est visible et sélectionnable sur la carte
    await focus(page, bin.x, bin.y, 18.4);
    await pauseSim(page);
    await page.waitForTimeout(400);
    const t = (await targets(page)).find((x) => x.ref.type === 'incident');
    expect(t).toBeTruthy();
    const box = await mapBox(page);
    await page.mouse.click(box.x + t!.x, box.y + t!.y);
    await expect(page.getByTestId('detail-title')).toContainText('Feu de poubelle');
    await expect(page.getByTestId('detail-title')).toContainText('scénario fictif');
    await expect(page.getByTestId('detail-origin')).toContainText('incident déclenché par le test navigateur');
    await page.getByTestId('map-host').screenshot({ path: testInfo.outputPath('incident.png') });
    expect(errors).toEqual([]);
  });

  test('un commerce fictif est sélectionnable : source « objet de scénario fictif », état lu dans le moteur', async ({ page }) => {
    await openGame(page, 'autostart=metz&map=schematic');
    const shop = await page.evaluate(() => {
      const sim = (window as any).__ORDRE__.ctrl.sim;
      const it = sim.world.decor.find((x: any) => x.kind === 'shopfront');
      return { x: it.x, y: it.y, poi: it.poiId };
    });
    await focus(page, shop.x, shop.y, 18);
    await pauseSim(page);
    await page.waitForTimeout(400);
    const t = (await targets(page)).find((x) => x.ref.type === 'poi' && x.ref.id === shop.poi);
    expect(t).toBeTruthy();
    const box = await mapBox(page);
    await page.mouse.click(box.x + t!.x, box.y + t!.y);
    await expect(page.getByTestId('detail-panel')).toContainText('objet de scénario fictif');
    await expect(page.getByTestId('detail-panel')).toContainText('intact');
    await expect(page.getByTestId('detail-panel')).toContainText('0 / 100');
  });

  test('une vitrine fictive brisée garde ses dégâts : le lieu les affiche', async ({ page }) => {
    await openGame(page, 'autostart=metz&map=schematic');
    const poi = await page.evaluate(() => {
      const d = (window as any).__ORDRE__;
      const it = d.ctrl.sim.world.decor.find((x: any) => x.kind === 'shopfront');
      d.ctrl.sim.incidents.spawnNear('window_break', it.x, it.y, { kind: 'scenario_event', refId: 'test-e2e', note: 'vitrine brisée par le test navigateur' });
      d.ctrl.runTicks(100 + 20 * 10 + 90 * 10 + 50); // acte puis persistance : l'incident est terminé, les dégâts restent
      return it.poiId;
    });
    await page.evaluate((id) => (window as any).__ORDRE__.ctrl.select({ type: 'poi', id }), poi);
    await page.waitForTimeout(300);
    await expect(page.getByTestId('detail-panel')).toContainText('endommagé');
    await expect(page.getByTestId('detail-panel')).toContainText('25 / 100');
    await expect(page.getByTestId('counter-damage')).toContainText('2');
  });

  test('le scénario de démonstration produit des incidents par les règles du moteur, jamais sur un établissement réel', async ({ page }) => {
    await openGame(page, 'autostart=metz&map=schematic');
    const r = await page.evaluate(() => {
      const d = (window as any).__ORDRE__;
      d.ctrl.runTicks(Math.round(d.ctrl.scenario.milestones.arrivalS * 10 + 3000));
      const s = d.ctrl.sim;
      return { total: s.incidents.incidents.length, rules: s.incidents.incidents.filter((i: any) => i.cause.kind === 'rule').length, targetsOsm: s.incidents.incidents.filter((i: any) => s.world.item(i.targetDecorId)?.source !== 'synthetic').length, logged: s.journal.byCode('incident.created').length };
    });
    expect(r.total).toBeGreaterThanOrEqual(1);
    expect(r.rules).toBeGreaterThanOrEqual(1);
    expect(r.targetsOsm).toBe(0);
    expect(r.logged).toBe(r.total);
    await expect(page.getByTestId('log-panel')).toContainText('fictif');
  });
});
