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

describe('rassemblement à côté d’une place', () => {
  it('une foule dont l’ancre est dans la rue déborde sur la place voisine (espace ouvert) au lieu de s’entasser dans la rue', async () => {
    const { gridGraph } = await import('./navHelpers');
    const { Sim } = await import('../../src/engine/sim');
    const { anchorAt, PLAN } = await import('./engineHelpers');
    const place = { id: 'p', kind: 'square' as const, ring: new Float32Array([-60, 3, 60, 3, 60, 80, -60, 80]), source: 'osm' as const };
    const g = gridGraph({ cols: 5, rows: 1, spacing: 100, width: 8, spaces: [place] });
    const sim = new Sim({ graph: g, seed: 1 });
    const grp = sim.group(sim.createGroup({ label: 'Rassemblement', kind: 'static', size: 1500, origin: { x: 0, y: 0 }, anchor: anchorAt({ x: 0, y: 0 }, 'rue', 15) }, PLAN))!;
    sim.run(600);
    const m = grp.members;
    let onPlace = 0;
    for (let i = m.activeStart; i < m.n; i++) if ((m.y[i] as number) > 6 && Math.abs(m.x[i] as number) < 60 && (m.y[i] as number) < 80) onPlace++;
    expect(onPlace / (m.n - m.activeStart)).toBeGreaterThan(0.3);
  }, 60_000);

  it('même chose quand un trottoir de quelques mètres sépare la place de la chaussée (écart comblé), mais pas à 15 m', async () => {
    const { gridGraph } = await import('./navHelpers');
    const { Sim } = await import('../../src/engine/sim');
    const { anchorAt, PLAN } = await import('./engineHelpers');
    const share = async (gapY: number) => {
      const place = { id: 'p', kind: 'square' as const, ring: new Float32Array([-60, gapY, 60, gapY, 60, gapY + 80, -60, gapY + 80]), source: 'osm' as const };
      const g = gridGraph({ cols: 5, rows: 1, spacing: 100, width: 8, spaces: [place] });
      const sim = new Sim({ graph: g, seed: 1 });
      const grp = sim.group(sim.createGroup({ label: 'Rassemblement', kind: 'static', size: 1500, origin: { x: 0, y: 0 }, anchor: anchorAt({ x: 0, y: 0 }, 'rue', 15) }, PLAN))!;
      sim.run(600);
      const m = grp.members;
      let on = 0;
      for (let i = m.activeStart; i < m.n; i++) if ((m.y[i] as number) >= gapY && Math.abs(m.x[i] as number) < 60) on++;
      return on / (m.n - m.activeStart);
    };
    expect(await share(8)).toBeGreaterThan(0.25); // 4 m de trottoir entre la chaussée (±4) et la place
    expect(await share(30)).toBeLessThan(0.02); // place trop éloignée : non reliée
  }, 90_000);
});

describe('forme du rassemblement : places d’abord, étiré dans le sens du départ', () => {
  const build = async () => {
    const { gridGraph } = await import('./navHelpers');
    const { Sim } = await import('../../src/engine/sim');
    const { anchorAt, PLAN } = await import('./engineHelpers');
    return { gridGraph, Sim, anchorAt, PLAN };
  };

  it('la foule occupe la place voisine avant de déborder dans la rue (préférence réglable)', async () => {
    const { gridGraph, Sim, anchorAt, PLAN } = await build();
    const place = { id: 'p', kind: 'square' as const, ring: new Float32Array([-50, 3, 50, 3, 50, 40, -50, 40]), source: 'osm' as const };
    const g = gridGraph({ cols: 7, rows: 1, spacing: 100, width: 8, spaces: [place] });
    const share = (openCost: number) => {
      const sim = new Sim({ graph: g, seed: 1, params: { fill: { openCost } } });
      const grp = sim.group(sim.createGroup({ label: 'R', kind: 'static', size: 2500, origin: { x: 0, y: 0 }, anchor: anchorAt({ x: 0, y: 0 }, 'rue', 15) }, PLAN))!;
      sim.run(300);
      const m = grp.members;
      let on = 0;
      for (let i = m.activeStart; i < m.n; i++) if ((m.y[i] as number) > 4 && Math.abs(m.x[i] as number) < 50 && (m.y[i] as number) < 40) on++;
      return on / (m.n - m.activeStart);
    };
    expect(share(0.45)).toBeGreaterThan(share(1) + 0.05);
    expect(share(0.45)).toBeGreaterThan(0.45);
  }, 120_000);

  it('avec un sens de départ, le rassemblement s’étire devant lui plutôt que derrière (moins de convergence depuis l’arrière)', async () => {
    const { gridGraph, Sim, anchorAt, PLAN } = await build();
    const g = gridGraph({ cols: 9, rows: 1, spacing: 100, width: 8 });
    const ahead = (bias: { x: number; y: number } | undefined) => {
      const sim = new Sim({ graph: g, seed: 1 });
      const grp = sim.group(sim.createGroup({ label: 'R', kind: 'static', size: 3000, origin: { x: 0, y: 0 }, anchor: anchorAt({ x: 0, y: 0 }, 'rue', 15), fillBias: bias }, PLAN))!;
      sim.run(100);
      const m = grp.members;
      let a = 0;
      for (let i = m.activeStart; i < m.n; i++) if ((m.x[i] as number) > 0) a++;
      return a / (m.n - m.activeStart);
    };
    expect(Math.abs(ahead(undefined) - 0.5)).toBeLessThan(0.1);
    expect(ahead({ x: 1, y: 0 })).toBeGreaterThan(0.62);
  }, 120_000);
});

describe('trou dans un espace ouvert (bassin d’un parc)', () => {
  it('personne ne se tient dans le trou, mais la foule occupe le reste du parc', async () => {
    const { gridGraph } = await import('./navHelpers');
    const { Sim } = await import('../../src/engine/sim');
    const { anchorAt, PLAN } = await import('./engineHelpers');
    const park = { id: 'p', kind: 'park' as const, ring: new Float32Array([-60, 3, 60, 3, 60, 80, -60, 80]), holes: [new Float32Array([-15, 30, 15, 30, 15, 60, -15, 60])], source: 'osm' as const };
    const g = gridGraph({ cols: 5, rows: 1, spacing: 100, width: 8, spaces: [park] });
    const sim = new Sim({ graph: g, seed: 1 });
    expect(sim.mask!.isOpen(0, 45)).toBe(false);
    expect(sim.mask!.isWalkable(0, 45)).toBe(false);
    expect(sim.mask!.isWalkable(40, 45)).toBe(true);
    const grp = sim.group(sim.createGroup({ label: 'R', kind: 'static', size: 2500, origin: { x: 0, y: 0 }, anchor: anchorAt({ x: 0, y: 0 }, 'rue', 15) }, PLAN))!;
    sim.run(300);
    let inHole = 0;
    for (let i = 0; i < grp.members.n; i++) if (Math.abs(grp.members.x[i] as number) < 15 && (grp.members.y[i] as number) > 30 && (grp.members.y[i] as number) < 60) inHole++;
    expect(inHole).toBe(0);
  }, 60_000);
});
