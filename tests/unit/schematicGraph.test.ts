import { describe, expect, it } from 'vitest';
import { NavContext } from '../../src/nav/astar';
import { DEFAULT_NAV_PARAMS } from '../../src/nav/params';
import { connectedComponents } from '../../src/nav/graph';
import { buildSchematicGraph } from '../../src/nav/schematicGraph';
import { createEdgeState } from '../../src/nav/streetState';
import { WalkMask } from '../../src/nav/walkMask';
import { validateRoute } from '../../src/nav/route';

const metz = { lng: 6.1757, lat: 49.1193 };

describe('graphe de la ville schématique', () => {
  const g = buildSchematicGraph(metz, 600, 450);

  it('est synthétique, déterministe et connexe', () => {
    expect(g.provenance.source).toBe('synthetic');
    const again = buildSchematicGraph(metz, 600, 450);
    expect(again.edgeCount).toBe(g.edgeCount);
    expect(Array.from(again.edgeLen.slice(0, 20))).toEqual(Array.from(g.edgeLen.slice(0, 20)));
    expect(connectedComponents(g).sizes).toHaveLength(1);
  });

  it('couvre la zone demandée avec des rues larges (avenues) et étroites', () => {
    expect(g.bounds.maxX).toBeGreaterThanOrEqual(600);
    expect(g.bounds.minY).toBeLessThanOrEqual(-450);
    const widths = new Set(Array.from(g.edgeWidth));
    expect(widths.has(16)).toBe(true);
    expect(widths.has(9)).toBe(true);
  });

  it('contient places, parcs et bâtiments ; les bâtiments ne recouvrent jamais le milieu d’une rue', () => {
    expect(g.spaces.some((s) => s.kind === 'square')).toBe(true);
    expect(g.obstacles.length).toBeGreaterThan(100);
    const mask = WalkMask.fromGraph(g, 1);
    expect(mask.blockedCells()).toBeGreaterThan(10000);
    for (let e = 0; e < g.edgeCount; e += 3) {
      const mx = (g.nodeX[g.edgeA[e] as number]! + g.nodeX[g.edgeB[e] as number]!) / 2;
      const my = (g.nodeY[g.edgeA[e] as number]! + g.nodeY[g.edgeB[e] as number]!) / 2;
      expect(mask.isBlocked(mx, my), `arête ${e}`).toBe(false);
    }
  });

  it('permet des itinéraires valides entre points quelconques, sans traverser de bâtiment', () => {
    const ctx = new NavContext(g, DEFAULT_NAV_PARAMS, createEdgeState(g));
    const mask = WalkMask.fromGraph(g, 1);
    const pairs: Array<[number, number, number, number]> = [
      [-550, -400, 560, 410],
      [0, 0, -500, 380],
      [300, -300, -300, 300],
    ];
    for (const [x0, y0, x1, y1] of pairs) {
      const r = ctx.findRoute({ x: x0, y: y0 }, { x: x1, y: y1 }, 'crowd');
      expect(r).not.toBeNull();
      expect(validateRoute(r!).ok).toBe(true);
      for (let s = 0; s <= r!.length; s += 2) {
        const i = Math.min(r!.cum.length - 2, Math.max(0, Array.from(r!.cum).findIndex((c) => c > s) - 1));
        const x = r!.pts[2 * i]!;
        const y = r!.pts[2 * i + 1]!;
        expect(mask.isBlocked(x, y)).toBe(false);
      }
    }
  });
});

describe('masque de marche', () => {
  it('rasterise un polygone (pair/impair) et répond en O(1)', () => {
    const m = new WalkMask(-50, -50, 50, 50, 1);
    m.rasterize({ ring: Float32Array.from([-10, -10, 10, -10, 10, 10, -10, 10]), source: 'synthetic' });
    expect(m.isBlocked(0, 0)).toBe(true);
    expect(m.isBlocked(9.5, 9.5)).toBe(true);
    expect(m.isBlocked(11, 0)).toBe(false);
    expect(m.isBlocked(500, 500)).toBe(false);
    expect(m.blockedCells()).toBe(400);
  });
  it('gère un polygone concave (L)', () => {
    const m = new WalkMask(0, 0, 40, 40, 1);
    m.rasterize({ ring: Float32Array.from([0, 0, 30, 0, 30, 10, 10, 10, 10, 30, 0, 30]), source: 'synthetic' });
    expect(m.isBlocked(5, 25)).toBe(true);
    expect(m.isBlocked(25, 5)).toBe(true);
    expect(m.isBlocked(25, 25)).toBe(false);
  });
});
