import type { Vec2 } from '../geo/mercator';
import { buildGraph, EdgeClass, EdgeFlag, edgePoints, otherNode, type EdgeClassId, type RawEdge, type StreetGraph } from './graph';
import { EdgeGrid, nearestEdge } from './spatialGrid';
import { WalkMask } from './walkMask';

/**
 * Liaisons piétonnes entre voies adjacentes : deux rues voisines (chaussées séparées d'un terre-plein, voie de bus
 * longeant une avenue…) ne sont reliées dans le graphe qu'à leurs intersections. Or à pied, on traverse d'une voie à
 * l'autre dès qu'AUCUN bâtiment ne les sépare et qu'elles sont proches. On ajoute donc des arêtes piétonnes courtes
 * entre points proches de deux voies, seulement si le trajet existant est bien plus long.
 */
export interface LinkOptions {
  /** Distance maximale entre les deux voies (m). */
  maxGapM: number;
  /** Distance minimale (m) : en dessous, les deux voies ne sont qu'une seule rue. */
  minGapM: number;
  /** Écart entre points d'essai le long d'une voie (m). */
  sampleEveryM: number;
  /** Distance minimale entre deux liaisons sur une même voie (m). */
  minSpacingM: number;
  /** Une liaison n'est ajoutée que si le trajet existant est au moins `detourFactor` × l'écart + `detourExtraM`. */
  detourFactor: number;
  detourExtraM: number;
  /** Largeur praticable de la liaison (m). */
  widthM: number;
  /** Plafond du nombre de liaisons. */
  maxLinks: number;
}

export const DEFAULT_LINK_OPTIONS: LinkOptions = {
  maxGapM: 24,
  minGapM: 3,
  sampleEveryM: 15,
  minSpacingM: 45,
  detourFactor: 3,
  detourExtraM: 60,
  widthM: 3,
  maxLinks: 4000,
};

interface Cut {
  edge: number;
  s: number;
  pt: Vec2;
  /** Nœud existant si la coupe tombe sur une extrémité, sinon -1 (nouveau nœud). */
  node: number;
}

export interface LinkResult {
  graph: StreetGraph;
  added: number;
}

/** Distance (m) sur le réseau entre deux nœuds, bornée : `Infinity` au-delà de `limit`. Mémorise les explorations. */
class NearDistances {
  private readonly cache = new Map<number, Map<number, number>>();
  constructor(
    private readonly g: StreetGraph,
    private readonly limit: number,
  ) {}
  from(n: number): Map<number, number> {
    let m = this.cache.get(n);
    if (m) return m;
    m = new Map([[n, 0]]);
    const open: Array<[number, number]> = [[0, n]];
    while (open.length) {
      let bi = 0;
      for (let i = 1; i < open.length; i++) if ((open[i] as [number, number])[0] < (open[bi] as [number, number])[0]) bi = i;
      const [d, u] = open.splice(bi, 1)[0] as [number, number];
      if (d > (m.get(u) as number)) continue;
      for (let k = this.g.adjStart[u] as number; k < (this.g.adjStart[u + 1] as number); k++) {
        const e = this.g.adj[k] as number;
        if (!((this.g.edgeFlags[e] as number) & EdgeFlag.Foot)) continue;
        const v = otherNode(this.g, e, u);
        const nd = d + (this.g.edgeLen[e] as number);
        if (nd > this.limit || nd >= (m.get(v) ?? Infinity)) continue;
        m.set(v, nd);
        open.push([nd, v]);
      }
    }
    this.cache.set(n, m);
    return m;
  }
}

const linkable = (g: StreetGraph, e: number): boolean => {
  const f = g.edgeFlags[e] as number;
  const c = g.edgeClass[e] as number;
  return !!(f & EdgeFlag.Foot) && !(f & (EdgeFlag.Tunnel | EdgeFlag.Bridge)) && c !== EdgeClass.Steps;
};

/**
 * Ajoute les liaisons piétonnes au graphe (reconstruit un graphe complet). Les voies de départ sont coupées aux points
 * de liaison ; rien n'est modifié si aucune liaison n'est utile. Déterministe.
 */
export function addPedestrianLinks(g: StreetGraph, opts: Partial<LinkOptions> = {}): LinkResult {
  const o = { ...DEFAULT_LINK_OPTIONS, ...opts };
  if (g.edgeCount < 2) return { graph: g, added: 0 };
  const grid = new EdgeGrid(g);
  const mask = WalkMask.fromGraph(g);
  const dist = new NearDistances(g, o.maxGapM * o.detourFactor + o.detourExtraM + 40);
  const cuts: Cut[] = [];
  const links: Array<[Cut, Cut]> = [];
  const nodesOf = (e: number): [number, number] => [g.edgeA[e] as number, g.edgeB[e] as number];
  const tooClose = (e: number, s: number) => cuts.some((c) => c.edge === e && Math.abs(c.s - s) < o.minSpacingM);
  const clear = (a: Vec2, b: Vec2): boolean => {
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const n = Math.max(2, Math.ceil(len / 0.8));
    for (let k = 1; k < n; k++) {
      const t = k / n;
      if (mask.isBlocked(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)) return false;
    }
    return true;
  };

  for (let e = 0; e < g.edgeCount && links.length < o.maxLinks; e++) {
    if (!linkable(g, e)) continue;
    const len = g.edgeLen[e] as number;
    if (len < 12) continue;
    const pts = edgePoints(g, e);
    const [ea, eb] = nodesOf(e);
    let acc = 0;
    let nextSample = o.sampleEveryM / 2;
    for (let i = 1; i < pts.length && links.length < o.maxLinks; i++) {
      const a = pts[i - 1] as Vec2;
      const b = pts[i] as Vec2;
      const l = Math.hypot(b.x - a.x, b.y - a.y);
      while (nextSample <= acc + l && nextSample < len - 5) {
        const k = l > 0 ? (nextSample - acc) / l : 0;
        const p = { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
        const s = nextSample;
        nextSample += o.sampleEveryM;
        if (s < 5 || tooClose(e, s)) continue;
        const hit = nearestEdge(g, grid, p, o.maxGapM, (f) => {
          if (f === e || !linkable(g, f)) return false;
          const [fa, fb] = nodesOf(f);
          return fa !== ea && fa !== eb && fb !== ea && fb !== eb; // voies non adjacentes
        });
        if (!hit || hit.dist < o.minGapM || hit.dist > o.maxGapM) continue;
        const f = hit.edge;
        if (tooClose(f, hit.t)) continue;
        const flen = g.edgeLen[f] as number;
        if (hit.t < 5 || hit.t > flen - 5) continue; // trop près d'un carrefour : déjà relié
        if (!clear(p, hit.point)) continue;
        // le trajet existant doit être nettement plus long que la liaison
        const [fa, fb] = nodesOf(f);
        const da = dist.from(ea);
        const db = dist.from(eb);
        let net = Infinity;
        for (const [en, de] of [[ea, s], [eb, len - s]] as Array<[number, number]>) {
          const m = en === ea ? da : db;
          for (const [fn, df] of [[fa, hit.t], [fb, flen - hit.t]] as Array<[number, number]>) {
            const x = m.get(fn);
            if (x !== undefined) net = Math.min(net, de + x + df);
          }
        }
        if (net < o.detourFactor * hit.dist + o.detourExtraM) continue;
        const ce: Cut = { edge: e, s, pt: p, node: -1 };
        const cf: Cut = { edge: f, s: hit.t, pt: hit.point, node: -1 };
        cuts.push(ce, cf);
        links.push([ce, cf]);
      }
      acc += l;
    }
  }
  if (!links.length) return { graph: g, added: 0 };

  // reconstruction : voies coupées aux points de liaison + arêtes de liaison
  const nodes: Vec2[] = Array.from({ length: g.nodeCount }, (_, i) => ({ x: g.nodeX[i] as number, y: g.nodeY[i] as number }));
  const byEdge = new Map<number, Cut[]>();
  for (const c of cuts) {
    const arr = byEdge.get(c.edge);
    if (arr) arr.push(c);
    else byEdge.set(c.edge, [c]);
  }
  const edges: RawEdge[] = [];
  for (let e = 0; e < g.edgeCount; e++) {
    const base = { cls: g.edgeClass[e] as EdgeClassId, flags: g.edgeFlags[e] as number, width: g.edgeWidth[e] as number, name: g.edgeName[e], osmId: (g.edgeOsmId[e] as number) || undefined };
    const cs = (byEdge.get(e) ?? []).sort((x, y) => x.s - y.s);
    if (!cs.length) {
      edges.push({ a: g.edgeA[e] as number, b: g.edgeB[e] as number, shape: edgePoints(g, e), ...base });
      continue;
    }
    // coupe de la polyligne en tronçons successifs
    const pts = edgePoints(g, e);
    let from = g.edgeA[e] as number;
    let piece: Vec2[] = [pts[0] as Vec2];
    let pi = 1;
    let acc = 0;
    const advanceTo = (target: number) => {
      while (pi < pts.length) {
        const a = pts[pi - 1] as Vec2;
        const b = pts[pi] as Vec2;
        const l = Math.hypot(b.x - a.x, b.y - a.y);
        if (acc + l >= target) return;
        piece.push(b);
        acc += l;
        pi++;
      }
    };
    for (const c of cs) {
      advanceTo(c.s);
      const node = nodes.length;
      nodes.push(c.pt);
      c.node = node;
      piece.push(c.pt);
      edges.push({ a: from, b: node, shape: piece, ...base });
      from = node;
      piece = [c.pt];
    }
    while (pi < pts.length) {
      piece.push(pts[pi] as Vec2);
      pi++;
    }
    edges.push({ a: from, b: g.edgeB[e] as number, shape: piece, ...base });
  }
  for (const [ce, cf] of links) {
    edges.push({ a: ce.node, b: cf.node, shape: [ce.pt, cf.pt], cls: EdgeClass.Footway, flags: EdgeFlag.Foot, width: o.widthM, name: undefined });
  }
  const graph = buildGraph({ origin: g.origin, nodes, edges, spaces: g.spaces, obstacles: g.obstacles, pois: g.pois, provenance: g.provenance });
  return { graph, added: links.length };
}

// ---------------------------------------------------------------------------------------------------------------------
// Liaisons à travers les espaces ouverts (places, zones piétonnes, parcs)
// ---------------------------------------------------------------------------------------------------------------------

function inRing(ring: Float32Array, x: number, y: number): boolean {
  let inside = false;
  const n = ring.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = ring[2 * i] as number;
    const yi = ring[2 * i + 1] as number;
    const xj = ring[2 * j] as number;
    const yj = ring[2 * j + 1] as number;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Distance (m) d'un point au contour d'un polygone. */
function distToRing(ring: Float32Array, x: number, y: number): number {
  let best = Infinity;
  const n = ring.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ax = ring[2 * i] as number;
    const ay = ring[2 * i + 1] as number;
    const bx = ring[2 * j] as number;
    const by = ring[2 * j + 1] as number;
    const dx = bx - ax;
    const dy = by - ay;
    const l2 = dx * dx + dy * dy;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
    best = Math.min(best, Math.hypot(x - (ax + t * dx), y - (ay + t * dy)));
  }
  return best;
}

export interface SpaceLinkOptions {
  /** Un nœud est rattaché à l'espace s'il est dedans ou à moins de cette distance de son contour (m). */
  attachM: number;
  /** Portée maximale d'une traversée (m). */
  maxSpanM: number;
  /** Distance minimale entre les deux nœuds reliés (m). */
  minSpanM: number;
  /** Nombre maximal de traversées par nœud. */
  perNode: number;
  /** La traversée n'est ajoutée que si le trajet existant est plus long que ce multiple de la traversée (+ marge). */
  detourFactor: number;
  detourExtraM: number;
  maxLinks: number;
}

export const DEFAULT_SPACE_LINK_OPTIONS: SpaceLinkOptions = { attachM: 12, maxSpanM: 350, minSpanM: 12, perNode: 5, detourFactor: 1.4, detourExtraM: 25, maxLinks: 3000 };

/**
 * Une place ou une zone piétonne cartographiée en surface (`place=square`, `highway=pedestrian` + `area=yes`, parc) n'a le plus souvent
 * AUCUNE arête à l'intérieur : le graphe ne sait donc pas qu'on peut la traverser, et un cortège la contourne ou refuse d'y passer.
 * On relie par des arêtes piétonnes droites les nœuds du réseau situés dans l'espace ou en bordure, quand le segment reste dans
 * l'espace (hors bâtiment) et que le trajet existant est nettement plus long.
 */
export function addOpenSpaceLinks(g: StreetGraph, opts: Partial<SpaceLinkOptions> = {}): LinkResult {
  const o = { ...DEFAULT_SPACE_LINK_OPTIONS, ...opts };
  if (!g.spaces.length || g.nodeCount < 2) return { graph: g, added: 0 };
  const mask = WalkMask.fromGraph(g);
  const dist = new NearDistances(g, o.maxSpanM * o.detourFactor + o.detourExtraM + 20);
  const extra: RawEdge[] = [];
  const have = new Set<string>();
  for (const sp of g.spaces) {
    const cand: number[] = [];
    for (let nd = 0; nd < g.nodeCount; nd++) {
      const x = g.nodeX[nd] as number;
      const y = g.nodeY[nd] as number;
      if (inRing(sp.ring, x, y) || distToRing(sp.ring, x, y) <= o.attachM) cand.push(nd);
    }
    if (cand.length < 2 || cand.length > 120) continue;
    const pairs: Array<[number, number, number]> = [];
    for (let i = 0; i < cand.length; i++)
      for (let j = i + 1; j < cand.length; j++) {
        const a = cand[i] as number;
        const b = cand[j] as number;
        const d = Math.hypot((g.nodeX[a] as number) - (g.nodeX[b] as number), (g.nodeY[a] as number) - (g.nodeY[b] as number));
        if (d >= o.minSpanM && d <= o.maxSpanM) pairs.push([d, a, b]);
      }
    pairs.sort((p, q) => p[0] - q[0] || p[1] - q[1] || p[2] - q[2]);
    const used = new Map<number, number>();
    for (const [d, a, b] of pairs) {
      if (extra.length >= o.maxLinks) break;
      if ((used.get(a) ?? 0) >= o.perNode || (used.get(b) ?? 0) >= o.perNode) continue;
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      if (have.has(key)) continue;
      const net = dist.from(a).get(b);
      if (net !== undefined && net <= o.detourFactor * d + o.detourExtraM) continue; // déjà relié de façon raisonnable
      const ax = g.nodeX[a] as number;
      const ay = g.nodeY[a] as number;
      const bx = g.nodeX[b] as number;
      const by = g.nodeY[b] as number;
      // le segment doit rester dans l'espace (les 12 premiers et derniers mètres peuvent en sortir : le nœud est en bordure), sans bâtiment
      const steps = Math.max(2, Math.ceil(d / 1.5));
      let ok = true;
      for (let k = 1; k < steps && ok; k++) {
        const t = k / steps;
        const x = ax + (bx - ax) * t;
        const y = ay + (by - ay) * t;
        const along = Math.min(t * d, (1 - t) * d);
        if (mask.isBlocked(x, y)) ok = false;
        else if (along > o.attachM && !inRing(sp.ring, x, y)) ok = false;
      }
      if (!ok) continue;
      have.add(key);
      used.set(a, (used.get(a) ?? 0) + 1);
      used.set(b, (used.get(b) ?? 0) + 1);
      extra.push({ a, b, shape: [{ x: ax, y: ay }, { x: bx, y: by }], cls: EdgeClass.Pedestrian, flags: EdgeFlag.Foot, width: 8, name: sp.name });
    }
  }
  if (!extra.length) return { graph: g, added: 0 };
  const nodes: Vec2[] = Array.from({ length: g.nodeCount }, (_, i) => ({ x: g.nodeX[i] as number, y: g.nodeY[i] as number }));
  const edges: RawEdge[] = [];
  for (let e = 0; e < g.edgeCount; e++) edges.push({ a: g.edgeA[e] as number, b: g.edgeB[e] as number, shape: edgePoints(g, e), cls: g.edgeClass[e] as EdgeClassId, flags: g.edgeFlags[e] as number, width: g.edgeWidth[e] as number, name: g.edgeName[e], osmId: (g.edgeOsmId[e] as number) || undefined });
  edges.push(...extra);
  return { graph: buildGraph({ origin: g.origin, nodes, edges, spaces: g.spaces, obstacles: g.obstacles, pois: g.pois, provenance: g.provenance }), added: extra.length };
}
