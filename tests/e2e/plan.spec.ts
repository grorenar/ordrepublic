import { expect, test } from '@playwright/test';
import { mapBox, openGame } from './helpers';

test.describe('planification (bac à sable)', () => {
  test('définir départ, arrivée, heure, effectif, un axe fermé et une unité ; lancer ; le moteur joue le plan', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await openGame(page, 'autostart=metz&map=schematic');
    await page.getByTestId('plan-toggle').click();
    await expect(page.getByTestId('plan-panel')).toBeVisible();
    // monde sans manifestants ni unités, en pause
    expect(await page.evaluate(() => (window as any).__ORDRE__.ctrl.sim.groups.length)).toBe(0);
    await expect(page.getByTestId('plan-route')).toContainText('Itinéraire prévu');

    const box = await mapBox(page);
    const click = async (tool: string, dx: number, dy: number) => {
      await page.getByTestId(`plan-tool-${tool}`).click();
      await page.mouse.click(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy);
    };
    await click('start', -120, 40);
    await click('end', 150, -60);
    await page.getByTestId('plan-tool-closure').click();
    await page.mouse.click(box.x + box.width / 2 + 10, box.y + box.height / 2 - 10);
    await page.getByTestId('plan-tool-unit').click();
    await page.mouse.click(box.x + box.width / 2 + 40, box.y + box.height / 2 + 30);
    await expect(page.getByTestId('plan-summary')).toContainText('Unités : 1');
    await expect(page.getByTestId('plan-summary')).toContainText('Axes fermés : 1');

    await page.getByTestId('plan-time').fill('15:30');
    await page.getByTestId('plan-size').fill('800');
    await page.getByTestId('plan-uncertainty').fill('25');
    await expect(page.getByTestId('plan-range')).toContainText('entre 600 et 1000');
    await page.getByTestId('plan-launch').click();

    await expect(page.getByTestId('plan-panel')).toHaveCount(0);
    await expect(page.getByTestId('sim-clock')).toHaveText('15:20:00'); // 10 min avant l'heure de départ
    const r = await page.evaluate(() => {
      const d = (window as any).__ORDRE__;
      d.ctrl.setSpeed(0);
      d.ctrl.runTicks(100);
      const g = d.ctrl.sim.groupByKey('rassemblement');
      return { size: d.ctrl.sim.size(g), units: d.ctrl.sim.units.length, marched: d.ctrl.sim.journal.byCode('group.march_started').length };
    });
    expect(r.size).toBeGreaterThanOrEqual(600);
    expect(r.size).toBeLessThanOrEqual(1000);
    expect(r.units).toBe(1);
    expect(r.marched).toBe(0);
    const after = await page.evaluate(() => {
      const d = (window as any).__ORDRE__;
      d.ctrl.runTicks(6100); // 10 min : heure de départ atteinte
      return d.ctrl.sim.journal.byCode('group.march_started').length;
    });
    expect(after).toBe(1);
    expect(errors).toEqual([]);
  });

  test('retour à la démonstration', async ({ page }) => {
    await openGame(page, 'autostart=metz&map=schematic');
    await page.getByTestId('plan-toggle').click();
    await page.getByTestId('plan-cancel').click();
    await expect(page.getByTestId('plan-panel')).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).__ORDRE__.ctrl.sim.groups.length)).toBeGreaterThan(0);
  });
});
