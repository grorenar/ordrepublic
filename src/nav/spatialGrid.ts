import type { Vec2 } from '../geo/mercator';
import type { StreetGraph } from './graph';

/** Grille uniforme d'arêtes (cellules de `cell` mètres) pour accrochage et requêtes de proximité en O(k). */
export class EdgeGrid {
  private readonly cells = new Map<number, number[]>();
  constructor(
    private readonly g: StreetGraph,
    readonly cell = 50,
  ) {
    for (let e = 0; e < g.edgeCount; e++) {
      const s0 = g.shapeStart[e] as number;
      const s1 = g.shapeStart[e + 1] as number;
      for (let i = s0 + 1; i < s1; i++) this.insertSegment(e, g.shape[2 * (i - 1)]!, g.shape[2 * (i - 1) + 1]!, g.shape[2 * i]!, g.shape[2 * i + 1]!);
    }
  }

  private key(cx: number, cy: number): number {
    return (cx + 32768) * 65536 + (cy + 32768);
  }

  private insertSegment(e: number, x0: number, y0: number, x1: number, y1: number): void {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.max(1, Math.ceil(len / (this.cell * 0.5)));
    let last = -1;
    for (let i = 0; i <= steps; i++) {
      const f = i / steps;
      const k = this.key(Math.floor((x0 + (x1 - x0) * f) / this.cell), Math.floor((y0 + (y1 - y0) * f) / this.cell));
      if (k === last) continue;
      last = k;
      let arr = this.cells.get(k);
      if (!arr) this.cells.set(k, (arr = []));
      if (arr[arr.length - 1] !== e) arr.push(e);
    }
  }

  /** Arêtes candidates dans un rectangle (peut contenir des doublons évités par `Set`). */
  edgesInBox(minX: number, minY: number, maxX: number, maxY: number): number[] {
    const out = new Set<number>();
    const c = this.cell;
    for (let cx = Math.floor(minX / c); cx <= Math.floor(maxX / c); cx++) {
      for (let cy = Math.floor(minY / c); cy <= Math.floor(maxY / c); cy++) {
        const arr = this.cells.get(this.key(cx, cy));
        if (arr) for (const e of arr) out.add(e);
      }
    }
    return [...out];
  }

  edgesInDisc(center: Vec2, r: number): number[] {
    return this.edgesInBox(center.x - r, center.y - r, center.x + r, center.y + r);
  }
}

export interface EdgeProjection {
  edge: number;
  /** Abscisse curviligne depuis le nœud `a` (m). */
  t: number;
  dist: number;
  point: Vec2;
}

/** Projection d'un point sur la polyligne d'une arête. */
export function projectOnEdge(g: StreetGraph, e: number, p: Vec2): EdgeProjection {
  let best = Infinity;
  let bestT = 0;
  let bestPt: Vec2 = { x: 0, y: 0 };
  let acc = 0;
  const s0 = g.shapeStart[e] as number;
  const s1 = g.shapeStart[e + 1] as number;
  for (let i = s0 + 1; i < s1; i++) {
    const ax = g.shape[2 * (i - 1)]!;
    const ay = g.shape[2 * (i - 1) + 1]!;
    const bx = g.shape[2 * i]!;
    const by = g.shape[2 * i + 1]!;
    const dx = bx - ax;
    const dy = by - ay;
    const l2 = dx * dx + dy * dy;
    const f = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - ax) * dx + (p.y - ay) * dy) / l2));
    const qx = ax + dx * f;
    const qy = ay + dy * f;
    const d = Math.hypot(p.x - qx, p.y - qy);
    const seg = Math.sqrt(l2);
    if (d < best) {
      best = d;
      bestT = acc + seg * f;
      bestPt = { x: qx, y: qy };
    }
    acc += seg;
  }
  return { edge: e, t: bestT, dist: best, point: bestPt };
}

/**
 * Arête la plus proche d'un point (anneaux de cellules croissants). `accept` permet de filtrer
 * (ex. arêtes praticables par un véhicule). Retourne null si le graphe est vide ou hors de portée.
 */
export function nearestEdge(
  g: StreetGraph,
  grid: EdgeGrid,
  p: Vec2,
  maxDist = 400,
  accept?: (e: number) => boolean,
): EdgeProjection | null {
  let best = null as EdgeProjection | null;
  for (let r = grid.cell; r <= maxDist + grid.cell; r += grid.cell) {
    for (const e of grid.edgesInDisc(p, r)) {
      if (accept && !accept(e)) continue;
      const pr = projectOnEdge(g, e, p);
      if (!best || pr.dist < best.dist) best = pr;
    }
    if (best && best.dist <= r) return best.dist <= maxDist ? best : null;
  }
  return best && best.dist <= maxDist ? best : null;
}
