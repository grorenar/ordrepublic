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
