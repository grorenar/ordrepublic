import { expect, test } from '@playwright/test';
import { openGame, pauseSim } from './helpers';

test.describe('sprites provisoires', () => {
  test('planche de contrôle : tous les sprites se dessinent', async ({ page }, testInfo) => {
    await page.goto('/?gallery');
    await expect(page.getByTestId('sprite-gallery')).toBeVisible();
    await expect(page.getByTestId('gallery-count')).toContainText(/\d+ sprites dessinés/);
    const n = Number(((await page.getByTestId('gallery-count').textContent()) ?? '').match(/\d+/)?.[0]);
    expect(n).toBeGreaterThan(100);
    await page.getByTestId('gallery-canvas').screenshot({ path: testInfo.outputPath('gallery.png') });
  });
});

test.describe('sprites dans le jeu', () => {
  for (const zoom of [17.4, 18.3, 19, 20.5]) {
    test(`zoom ${zoom} : silhouettes ou points dessinés, jeu fluide, aucune erreur`, async ({ page }, testInfo) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await openGame(page, 'autostart=metz&map=schematic');
      await page.evaluate(() => (window as any).__ORDRE__.ctrl.runTicks(1500));
      const where = await page.evaluate(() => {
        const d = (window as any).__ORDRE__;
        const g = d.ctrl.sim.groupByKey('rassemblement');
        const p = d.ctrl.positionOf({ type: 'group', id: g.id });
        const c = d.city();
        return { x: p.x, y: p.y, lng: c.center.lng, lat: c.center.lat };
      });
      const lat = where.lat + where.y / 111320;
      const lng = where.lng + where.x / (111320 * Math.cos((where.lat * Math.PI) / 180));
      await page.evaluate(([a, b, z]) => (window as any).__ORDRE__.jumpTo(a, b, z), [lng, lat, zoom] as const);
      await page.waitForTimeout(600);
      await pauseSim(page);
      await page.evaluate(() => (window as any).__ORDRE__.resetStats());
      await page.waitForTimeout(1500);
      const s = await page.evaluate(() => (window as any).__ORDRE__.stats());
      await page.getByTestId('map-host').screenshot({ path: testInfo.outputPath(`game-z${zoom}.png`) });
      expect(s.dots).toBeGreaterThan(20);
      expect(s.p95Ms).toBeLessThan(40);
      expect(errors).toEqual([]);
    });
  }
});
