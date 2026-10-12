import type { Vec2 } from '../../src/geo/mercator';
import { EdgeClass, EdgeFlag, buildGraph, type EdgeClassId, type Obstacle, type RawEdge, type StreetGraph } from '../../src/nav/graph';
import { mulberry32 } from '../../src/state/rng';

export interface GridOpts {
  cols: number;
  rows: number;
  spacing?: number;
  width?: number;
  cls?: EdgeClassId;
  /** Probabilité de supprimer une arête (graphe troué, graine). */
  holes?: number;
  oneways?: number;
  seed?: number;
  obstacles?: Obstacle[];
  origin?: { lng: number; lat: number };
}

/** Grille régulière centrée sur l'origine ; nœud (c,r) = c*rows + r. */
export function gridGraph(o: GridOpts): StreetGraph {
  const sp = o.spacing ?? 100;
  const rng = mulberry32(o.seed ?? 1);
  const nodes: Vec2[] = [];
  for (let c = 0; c < o.cols; c++) for (let r = 0; r < o.rows; r++) nodes.push({ x: (c - (o.cols - 1) / 2) * sp, y: (r - (o.rows - 1) / 2) * sp });
  const idx = (c: number, r: number) => c * o.rows + r;
  const edges: RawEdge[] = [];
  const add = (a: number, b: number) => {
    if (rng() < (o.holes ?? 0)) return;
    let flags = EdgeFlag.Foot | EdgeFlag.Motor;
    if (rng() < (o.oneways ?? 0)) flags |= EdgeFlag.Oneway;
    edges.push({ a, b, shape: [nodes[a] as Vec2, nodes[b] as Vec2], cls: o.cls ?? EdgeClass.Residential, flags, width: o.width ?? 8 });
  };
  for (let c = 0; c < o.cols; c++) for (let r = 0; r < o.rows; r++) {
    if (r + 1 < o.rows) add(idx(c, r), idx(c, r + 1));
    if (c + 1 < o.cols) add(idx(c, r), idx(c + 1, r));
  }
  return buildGraph({ origin: o.origin ?? { lng: 6.1757, lat: 49.1193 }, nodes, edges, obstacles: o.obstacles, provenance: { source: 'synthetic' } });
}

export const nodePos = (g: StreetGraph, n: number): Vec2 => ({ x: g.nodeX[n] as number, y: g.nodeY[n] as number });
