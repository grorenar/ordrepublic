import { describe, expect, it } from 'vitest';
import { Sim } from '../../src/engine/sim';
import type { Obstacle, OpenSpace } from '../../src/nav/graph';
import { anchorAt, PLAN } from './engineHelpers';
import { gridGraph } from './navHelpers';

const rect = (x0: number, x1: number, y0: number, y1: number) => new Float32Array([x0, y0, x1, y0, x1, y1, x0, y1]);

describe('rassemblement : remplissage par distance de marche (pas d’anneau autour d’un immeuble)', () => {
  const plaza: OpenSpace = { id: 'p', kind: 'square', ring: rect(-30, 30, -30, 30), source: 'synthetic' };
  const building: Obstacle = { ring: rect(-6, 6, -6, 6), source: 'synthetic' }; // un immeuble au milieu de la place
  const wall: Obstacle = { ring: rect(-200, 200, 32, 60), source: 'synthetic' };
  const graph = gridGraph({ cols: 6, rows: 1, spacing: 100, width: 6, spaces: [plaza], obstacles: [building, wall] });

  it('compact autour de l’ancre, jamais dans un bâtiment ni hors des surfaces praticables', () => {
    const sim = new Sim({ graph, seed: 1 });
    const g = sim.group(sim.createGroup({ label: 'r', kind: 'static', size: 1200, origin: { x: -18, y: 0 }, anchor: anchorAt({ x: -18, y: 0 }) }, PLAN))!;
    sim.run(200);
    const mask = sim.mask!;
    let blocked = 0;
    let outside = 0;
    let near = 0;
    const R = Math.sqrt(1200 / (Math.PI * 2)) * 1.6; // rayon d'un disque de même aire, avec marge pour contourner l'immeuble
    for (let i = 0; i < g.members.n; i++) {
      const x = g.members.x[i] as number;
      const y = g.members.y[i] as number;
      if (mask.isBlocked(x, y)) blocked++;
      else if (!mask.isWalkable(x, y)) outside++;
      if (Math.hypot(x + 18, y) < R) near++;
    }
    expect(blocked).toBe(0);
    expect(outside).toBe(0);
    expect(near / g.members.n).toBeGreaterThan(0.85); // bloc compact, pas un anneau étalé
  });

  it('l’ancre placée dans un bâtiment est ramenée sur la surface praticable la plus proche', () => {
    const sim = new Sim({ graph, seed: 1 });
    const g = sim.group(sim.createGroup({ label: 'r', kind: 'static', size: 300, origin: { x: 0, y: 0 }, anchor: anchorAt({ x: 0, y: 0 }) }, PLAN))!;
    expect(sim.mask!.isWalkable(g.layout!.anchor.x, g.layout!.anchor.y)).toBe(true);
  });

  it('disposition en préfixe : ajouter du monde ne déplace pas les premiers', () => {
    const a = new Sim({ graph, seed: 1 });
    const ga = a.group(a.createGroup({ label: 'r', kind: 'static', size: 400, origin: { x: -18, y: 0 }, anchor: anchorAt({ x: -18, y: 0 }) }, PLAN))!;
    const b = new Sim({ graph, seed: 1 });
    const gb = b.group(b.createGroup({ label: 'r', kind: 'static', size: 900, origin: { x: -18, y: 0 }, anchor: anchorAt({ x: -18, y: 0 }) }, PLAN))!;
    for (let i = 0; i < 400; i++) {
      expect(gb.layout!.pts[2 * i]).toBeCloseTo(ga.layout!.pts[2 * i] as number, 6);
      expect(gb.layout!.pts[2 * i + 1]).toBeCloseTo(ga.layout!.pts[2 * i + 1] as number, 6);
    }
  });
});
