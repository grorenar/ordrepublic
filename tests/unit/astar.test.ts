import { describe, expect, it } from 'vitest';
import { EdgeFlag } from '../../src/nav/graph';
import { NavContext } from '../../src/nav/astar';
import { DEFAULT_NAV_PARAMS } from '../../src/nav/params';
import { edgeIndexAt, locate, validateRoute, type Located } from '../../src/nav/route';
import { createEdgeState, setScenarioBlock } from '../../src/nav/streetState';
import { nearestEdge, projectOnEdge } from '../../src/nav/spatialGrid';
import { mulberry32 } from '../../src/state/rng';
import { gridGraph, nodePos } from './navHelpers';
import { MinHeap } from '../../src/nav/heap';
import type { StreetGraph } from '../../src/nav/graph';
import type { NavMode } from '../../src/nav/route';

/** Dijkstra de référence sur les nœuds, avec la même fonction de coût. */
function dijkstra(ctx: NavContext, g: StreetGraph, src: number, dst: number, mode: NavMode): number {
  const dist = new Float64Array(g.nodeCount).fill(Infinity);
  const done = new Uint8Array(g.nodeCount);
  dist[src] = 0;
  for (;;) {
    let u = -1;
    for (let i = 0; i < g.nodeCount; i++) if (!done[i] && (u === -1 || (dist[i] as number) < (dist[u] as number))) u = i;
    if (u === -1 || !isFinite(dist[u] as number)) break;
    done[u] = 1;
    for (let k = g.adjStart[u]!; k < g.adjStart[u + 1]!; k++) {
      const e = g.adj[k] as number;
      const fwd = g.edgeA[e] === u;
      if (!ctx.canTraverse(e, fwd, mode)) continue;
      const v = fwd ? (g.edgeB[e] as number) : (g.edgeA[e] as number);
      const c = ctx.edgeCost(e, mode, g.edgeLen[e] as number, true);
      if ((dist[u] as number) + c < (dist[v] as number)) dist[v] = (dist[u] as number) + c;
    }
  }
  return dist[dst] as number;
}

describe('tas binaire', () => {
  it('retourne les éléments dans l’ordre des clés', () => {
    const h = new MinHeap();
    const rng = mulberry32(5);
    const keys = Array.from({ length: 200 }, () => rng());
    keys.forEach((k, i) => h.push(k, i));
    const out: number[] = [];
    while (h.size) {
      h.pop();
      out.push(h.lastKey);
    }
    expect(out).toEqual([...keys].sort((a, b) => a - b));
  });
});

describe('accrochage et index spatial', () => {
  const g = gridGraph({ cols: 6, rows: 5, spacing: 100 });
  const ctx = new NavContext(g, DEFAULT_NAV_PARAMS);
  it('projette un point sur l’arête la plus proche', () => {
    const e = 0;
    const a = nodePos(g, g.edgeA[e] as number);
    const b = nodePos(g, g.edgeB[e] as number);
    const mid = { x: (a.x + b.x) / 2 + 2, y: (a.y + b.y) / 2 + 1 };
    const pr = projectOnEdge(g, e, mid);
    expect(pr.t).toBeGreaterThan(0);
    expect(pr.dist).toBeLessThan(2.3);
    const near = nearestEdge(g, ctx.grid, mid, 400);
    expect(near?.dist).toBeLessThanOrEqual(pr.dist + 1e-6);
  });
  it('retourne null hors de portée', () => {
    expect(nearestEdge(g, ctx.grid, { x: 5000, y: 5000 }, 100)).toBeNull();
  });
});

describe('A* : optimalité et robustesse', () => {
  for (const mode of ['vehicle', 'crowd', 'foot'] as const) {
    it(`coût identique à Dijkstra sur graphes aléatoires (mode ${mode})`, () => {
      for (let seed = 1; seed <= 12; seed++) {
        const g = gridGraph({ cols: 8, rows: 7, holes: 0.18, oneways: mode === 'vehicle' ? 0.3 : 0, seed });
        const ctx = new NavContext(g, DEFAULT_NAV_PARAMS, createEdgeState(g));
        const rng = mulberry32(seed * 31);
        for (let q = 0; q < 12; q++) {
          const a = Math.floor(rng() * g.nodeCount);
          const b = Math.floor(rng() * g.nodeCount);
          const isolated = (n: number) => g.adjStart[n + 1] === g.adjStart[n];
          if (a === b || isolated(a) || isolated(b)) continue; // un nœud sans arête s'accroche à une arête voisine : hors périmètre du test
          const ref = dijkstra(ctx, g, a, b, mode);
          const route = ctx.findRoute(nodePos(g, a), nodePos(g, b), mode);
          if (!isFinite(ref)) {
            expect(route, `seed ${seed} ${a}->${b}`).toBeNull();
          } else {
            expect(route, `seed ${seed} ${a}->${b}`).not.toBeNull();
            // un point sur un nœud s'accroche à une arête incidente : le coût doit égaler Dijkstra
            expect((route as { cost: number }).cost).toBeCloseTo(ref, 5);
            expect(validateRoute(route!).ok).toBe(true);
          }
        }
      }
    });
  }

  it('respecte les sens uniques (véhicules) mais pas pour les piétons', () => {
    // deux nœuds reliés par une seule arête à sens unique a→b
    const g = gridGraph({ cols: 2, rows: 1, spacing: 100 });
    const ctx = new NavContext(g, DEFAULT_NAV_PARAMS, createEdgeState(g));
    const A = nodePos(g, 0);
    const B = nodePos(g, 1);
    expect(ctx.findRoute(A, B, 'vehicle')).not.toBeNull();
    const g2 = { ...g, edgeFlags: Uint8Array.from(g.edgeFlags, (f) => f | EdgeFlag.Oneway) };
    const ctx2 = new NavContext(g2, DEFAULT_NAV_PARAMS, createEdgeState(g2));
    const forward = g2.edgeA[0] === 0 ? [A, B] : [B, A];
    expect(ctx2.findRoute(forward[0]!, forward[1]!, 'vehicle')).not.toBeNull();
    expect(ctx2.findRoute(forward[1]!, forward[0]!, 'vehicle')).toBeNull();
    expect(ctx2.findRoute(forward[1]!, forward[0]!, 'crowd')).not.toBeNull();
  });

  it('une rue fermée provoque un détour (même destination) et les itinéraires restent valides', () => {
    const g = gridGraph({ cols: 5, rows: 3, spacing: 100 });
    const st = createEdgeState(g);
    const ctx = new NavContext(g, DEFAULT_NAV_PARAMS, st);
    const A = nodePos(g, 0 * 3 + 1);
    const B = nodePos(g, 4 * 3 + 1);
    const direct = ctx.findRoute(A, B, 'crowd') as NonNullable<ReturnType<NavContext['findRoute']>>;
    expect(direct.length).toBeCloseTo(400, 3);
    // ferme une arête de la route directe
    const closed = direct.edges[Math.floor(direct.edges.length / 2)] as number;
    expect(setScenarioBlock(st, closed, true)).toBe(true);
    expect(ctx.firstBlockedEdge(direct, 0)).toBeGreaterThanOrEqual(0);
    const detour = ctx.findRoute(A, B, 'crowd');
    expect(detour).not.toBeNull();
    expect(detour!.length).toBeGreaterThan(direct.length);
    expect(Array.from(detour!.edges)).not.toContain(closed);
    expect(validateRoute(detour!).ok).toBe(true);
    // aucun facteur de détour maximal par défaut : détour accepté même s'il est très long
    expect(DEFAULT_NAV_PARAMS.maxDetourRatio).toBe(Infinity);
  });

  it('aucun itinéraire si la destination est coupée du reste → null (le groupe reste sur place)', () => {
    const g = gridGraph({ cols: 4, rows: 1, spacing: 100 });
    const st = createEdgeState(g);
    const ctx = new NavContext(g, DEFAULT_NAV_PARAMS, st);
    setScenarioBlock(st, 1, true); // coupe la ligne en deux
    expect(ctx.findRoute(nodePos(g, 0), nodePos(g, 3), 'crowd')).toBeNull();
    expect(ctx.findRoute(nodePos(g, 0), nodePos(g, 1), 'crowd')).not.toBeNull();
  });

  it('maxDetourRatio optionnel : peut refuser un détour excessif', () => {
    const g = gridGraph({ cols: 5, rows: 3, spacing: 100 });
    const st = createEdgeState(g);
    const ctx = new NavContext(g, { ...DEFAULT_NAV_PARAMS, maxDetourRatio: 1.01 }, st);
    const A = nodePos(g, 1);
    const B = nodePos(g, 4 * 3 + 1);
    const direct = ctx.findRoute(A, B, 'crowd')!;
    setScenarioBlock(st, direct.edges[2] as number, true);
    expect(ctx.findRoute(A, B, 'crowd')).toBeNull();
  });

  it('départ et arrivée sur la même arête, ou points libres hors nœuds', () => {
    const g = gridGraph({ cols: 3, rows: 3, spacing: 100 });
    const ctx = new NavContext(g, DEFAULT_NAV_PARAMS, createEdgeState(g));
    const r = ctx.findRoute({ x: -90, y: -100 }, { x: -30, y: -100 }, 'foot')!;
    expect(r.length).toBeCloseTo(60, 3);
    expect(validateRoute(r).ok).toBe(true);
    const r2 = ctx.findRoute({ x: -73, y: -100 }, { x: 61, y: 100 }, 'vehicle')!;
    expect(r2).not.toBeNull();
    expect(validateRoute(r2).ok).toBe(true);
    // la polyligne commence et finit aux points accrochés
    expect(r2.pts[0]).toBeCloseTo(-73, 3);
    expect(r2.pts[r2.pts.length - 2]).toBeCloseTo(61, 3);
  });

  it('une route est continue, sans boucle ni saut, et locate/edgeIndexAt sont cohérents', () => {
    const g = gridGraph({ cols: 9, rows: 9, holes: 0.1, seed: 7 });
    const ctx = new NavContext(g, DEFAULT_NAV_PARAMS, createEdgeState(g));
    const r = ctx.findRoute({ x: -310, y: -299 }, { x: 305, y: 310 }, 'crowd')!;
    expect(r).not.toBeNull();
    expect(validateRoute(r).ok).toBe(true);
    const out: Located = { x: 0, y: 0, tx: 0, ty: 0, seg: 0 };
    let prev = locate(r, 0, out);
    let px = prev.x;
    let py = prev.y;
    for (let s = 1; s <= r.length; s += 1) {
      const l = locate(r, s, out);
      expect(Math.hypot(l.x - px, l.y - py)).toBeLessThan(1.0001 + 1e-3);
      expect(Math.hypot(l.tx, l.ty)).toBeCloseTo(1, 5);
      px = l.x;
      py = l.y;
    }
    prev = locate(r, -10, out);
    expect(Number.isFinite(prev.x)).toBe(true);
    expect(edgeIndexAt(r, 0)).toBe(0);
    expect(edgeIndexAt(r, r.length)).toBe(r.edges.length - 1);
  });
});
