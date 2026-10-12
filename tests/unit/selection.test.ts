import { describe, expect, it } from 'vitest';
import { PointGrid } from '../../src/engine/spatialIndex';
import { SelectionIndex, groupBox } from '../../src/game/selection';
import { mulberry32 } from '../../src/state/rng';
import { anchorAt, makeSim, PLAN } from './engineHelpers';

describe('index spatial des individus', () => {
  it('même résultat qu’un parcours exhaustif sur 50 000 points', () => {
    const n = 50000;
    const rng = mulberry32(3);
    const xs = new Float32Array(n);
    const ys = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      xs[i] = rng() * 600;
      ys[i] = rng() * 400;
    }
    const grid = new PointGrid();
    grid.build(xs, ys, 0, n, 4);
    expect(grid.count).toBe(n);
    for (let q = 0; q < 200; q++) {
      const px = rng() * 600;
      const py = rng() * 400;
      let bi = -1;
      let bd = 3 * 3;
      for (let i = 0; i < n; i++) {
        const d = (xs[i]! - px) ** 2 + (ys[i]! - py) ** 2;
        if (d <= bd) {
          bd = d;
          bi = i;
        }
      }
      const r = grid.nearest(px, py, 3);
      expect(r.index).toBe(bi);
      // sous-linéaire : une requête n'examine qu'une infime part de la foule
      expect(grid.comparisons).toBeLessThan(n * 0.01);
    }
  });

  it('gère l’exclusion de points et un ensemble vide', () => {
    const xs = Float32Array.from([0, 1, 2, 3]);
    const ys = Float32Array.from([0, 0, 0, 0]);
    const g = new PointGrid();
    g.build(xs, ys, 0, 4, 1, (i) => i !== 1);
    expect(g.count).toBe(3);
    expect(g.nearest(1, 0, 0.4).index).toBe(-1);
    g.build(xs, ys, 0, 0);
    expect(g.nearest(0, 0, 10).index).toBe(-1);
  });
});

describe('sélection au clic sur la simulation', () => {
  const setup = () => {
    const sim = makeSim();
    const a = anchorAt({ x: 100, y: 100 }, 'Place');
    const gid = sim.createGroup({ label: 'Grande foule', kind: 'static', size: 30000, origin: a.pos, anchor: a }, PLAN);
    const uid = sim.addUnit({ force: 'crs', callsign: 'CRS-J 07/2', num: '07', headcount: 20, pos: { x: 100, y: 100 } }, PLAN);
    return { sim, gid, uid, sel: new SelectionIndex(sim) };
  };

  it('une unité posée sur la foule est prioritaire sur les individus', () => {
    const { sim, uid, sel } = setup();
    const u = sim.entity(uid)!;
    expect(sel.pick({ x: u.x, y: u.y }, 2, true)).toEqual({ type: 'unit', id: uid });
  });

  it('un clic dans la foule retrouve un individu précis du groupe, avec très peu de comparaisons', () => {
    const { sim, gid, sel } = setup();
    const g = sim.group(gid)!;
    const i = 12345;
    const hit = sel.pick({ x: g.members.x[i] as number, y: g.members.y[i] as number }, 1, true);
    expect(hit?.type).toBe('group');
    expect((hit as { id: string }).id).toBe(gid);
    expect((hit as { member?: number }).member).toBeDefined();
    const m = (hit as { member: number }).member;
    expect(Math.hypot((g.members.x[m] as number) - (g.members.x[i] as number), (g.members.y[m] as number) - (g.members.y[i] as number))).toBeLessThan(1.01);
    expect(sel.lastComparisons).toBeLessThan(30000 * 0.02 + 10);
  });

  it('un clic hors de toute foule ne sélectionne rien ; le survol n’exige pas de construire l’index des individus', () => {
    const { sim, sel } = setup();
    expect(sel.pick({ x: -500, y: -400 }, 2, true)).toBeNull();
    const builds = sel.gridBuilds;
    const g = sim.groups[0]!;
    const box = groupBox(g)!;
    expect(sel.pick({ x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 }, 2, false)).toMatchObject({ type: 'group' });
    expect(sel.gridBuilds).toBe(builds); // survol : enveloppe seulement
  });

  it('l’index d’un groupe est construit une fois par tick, pas à chaque clic', () => {
    const { sim, gid, sel } = setup();
    const g = sim.group(gid)!;
    const p = { x: g.members.x[500] as number, y: g.members.y[500] as number };
    sel.pick(p, 1, true);
    const b = sel.gridBuilds;
    sel.pick(p, 1, true);
    sel.pick(p, 1, true);
    expect(sel.gridBuilds).toBe(b);
    sim.step();
    sel.pick(p, 1, true);
    expect(sel.gridBuilds).toBe(b + 1);
  });
});
