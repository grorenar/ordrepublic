import type { LngLat, Vec2 } from '../geo/mercator';
import { EdgeClass, EdgeFlag, buildGraph, type Obstacle, type OpenSpace, type RawEdge, type StreetGraph } from './graph';
import {
  blockKind,
  blockRect,
  buildingQuads,
  fromGrid,
  makeSchematicCity,
  streetWidth,
  toGrid,
  type SchematicCity,
} from '../geo/schematicCity';

/**
 * Graphe de la ville schématique (mode démonstration / repli) : mêmes rues, places et bâtiments
 * que le dessin du fond schématique. Données entièrement SYNTHÉTIQUES (provenance « synthetic »).
 * `halfWidth/halfHeight` : emprise (m, repère local) à couvrir, marge comprise.
 */
export function buildSchematicGraph(origin: LngLat, halfWidth: number, halfHeight: number, margin = 120): StreetGraph {
  const city: SchematicCity = makeSchematicCity(origin);
  const hw = halfWidth + margin;
  const hh = halfHeight + margin;
  // emprise en coordonnées de trame
  const corners = [
    { x: -hw, y: -hh },
    { x: hw, y: -hh },
    { x: -hw, y: hh },
    { x: hw, y: hh },
  ].map((c) => toGrid(city, c));
  const kMin = Math.floor(Math.min(...corners.map((c) => c.x)) / city.bx) - 1;
  const kMax = Math.ceil(Math.max(...corners.map((c) => c.x)) / city.bx) + 1;
  const lMin = Math.floor(Math.min(...corners.map((c) => c.y)) / city.by) - 1;
  const lMax = Math.ceil(Math.max(...corners.map((c) => c.y)) / city.by) + 1;
  const inside = (p: Vec2) => Math.abs(p.x) <= hw && Math.abs(p.y) <= hh;

  const nodes: Vec2[] = [];
  const index = new Map<number, number>();
  const key = (k: number, l: number) => (k - kMin) * 100000 + (l - lMin);
  for (let k = kMin; k <= kMax; k++) {
    for (let l = lMin; l <= lMax; l++) {
      const p = fromGrid(city, { x: k * city.bx, y: l * city.by });
      if (!inside(p)) continue;
      index.set(key(k, l), nodes.length);
      nodes.push(p);
    }
  }
  const edges: RawEdge[] = [];
  const cls = (i: number) => (i % city.majorEvery === 0 ? EdgeClass.Secondary : EdgeClass.Residential);
  for (let k = kMin; k <= kMax; k++) {
    for (let l = lMin; l <= lMax; l++) {
      const a = index.get(key(k, l));
      if (a === undefined) continue;
      const bV = index.get(key(k, l + 1));
      const bH = index.get(key(k + 1, l));
      if (bV !== undefined) {
        edges.push({
          a,
          b: bV,
          shape: [nodes[a] as Vec2, nodes[bV] as Vec2],
          cls: cls(k),
          flags: EdgeFlag.Foot | EdgeFlag.Motor,
          width: streetWidth(city, k),
          name: k % city.majorEvery === 0 ? `Avenue ${k} (fictive)` : `Rue ${k} (fictive)`,
        });
      }
      if (bH !== undefined) {
        edges.push({
          a,
          b: bH,
          shape: [nodes[a] as Vec2, nodes[bH] as Vec2],
          cls: cls(l),
          flags: EdgeFlag.Foot | EdgeFlag.Motor,
          width: streetWidth(city, l),
          name: l % city.majorEvery === 0 ? `Boulevard ${l} (fictif)` : `Rue ${l} (fictive)`,
        });
      }
    }
  }

  const spaces: OpenSpace[] = [];
  const obstacles: Obstacle[] = [];
  const ring = (u0: number, v0: number, u1: number, v1: number): Float32Array => {
    const pts = [
      fromGrid(city, { x: u0, y: v0 }),
      fromGrid(city, { x: u1, y: v0 }),
      fromGrid(city, { x: u1, y: v1 }),
      fromGrid(city, { x: u0, y: v1 }),
    ];
    const out = new Float32Array(8);
    pts.forEach((p, i) => {
      out[2 * i] = p.x;
      out[2 * i + 1] = p.y;
    });
    return out;
  };
  for (let k = kMin; k < kMax; k++) {
    for (let l = lMin; l < lMax; l++) {
      const c = fromGrid(city, { x: (k + 0.5) * city.bx, y: (l + 0.5) * city.by });
      if (!inside(c)) continue;
      const kind = blockKind(city, k, l);
      const r = blockRect(city, k, l);
      if (kind === 'plaza') spaces.push({ id: `sp-${k}:${l}`, kind: 'square', ring: ring(r.u0, r.v0, r.u1, r.v1), name: 'Place (fictive)', source: 'synthetic' });
      else if (kind === 'park') spaces.push({ id: `sp-${k}:${l}`, kind: 'park', ring: ring(r.u0, r.v0, r.u1, r.v1), name: 'Parc (fictif)', source: 'synthetic' });
      else for (const q of buildingQuads(city, k, l)) obstacles.push({ ring: ring(q.u0, q.v0, q.u1, q.v1), name: 'Bâtiment (fictif)', source: 'synthetic' });
    }
  }

  return buildGraph({
    origin,
    nodes,
    edges,
    spaces,
    obstacles,
    provenance: { source: 'synthetic', label: 'ville schématique générée localement' },
  });
}
