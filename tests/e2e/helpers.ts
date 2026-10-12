import { expect, type Page } from '@playwright/test';

export interface Target {
  ref: { type: string; id: string };
  x: number;
  y: number;
  r: number;
}

export async function openGame(page: Page, query: string): Promise<void> {
  await page.goto(`/?debug&${query}`);
  await expect(page.getByTestId('game')).toBeVisible();
  await expect(page.getByTestId('game')).toHaveAttribute('data-map-state', 'ready', { timeout: 20_000 });
  // laisse deux images se dessiner
  await page.waitForTimeout(300);
}

export const mapBox = async (page: Page) => {
  const box = await page.getByTestId('map-host').boundingBox();
  if (!box) throw new Error('carte introuvable');
  return box;
};

/** Écart (en px) entre la position dessinée de chaque pion visible et la projection native du fond. */
export async function alignmentErrors(page: Page): Promise<{ checked: number; maxErr: number; worst: string }> {
  return page.evaluate(() => {
    const dbg = (window as unknown as { __ORDRE__: any }).__ORDRE__;
    const ents = dbg.entities();
    const pos = new Map<string, { x: number; y: number }>();
    for (const k of ['units', 'vehicles', 'groups', 'incidents']) for (const e of ents[k]) pos.set(e.id, e.pos);
    let maxErr = 0;
    let worst = '';
    let checked = 0;
    for (const t of dbg.targets()) {
      const m = pos.get(t.ref.id);
      if (!m) continue;
      const n = dbg.nativeProject(m);
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
