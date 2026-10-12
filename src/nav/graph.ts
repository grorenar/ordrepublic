import type { LngLat, Vec2 } from '../geo/mercator';

/**
 * Graphe de navigation STATIQUE et immuable, indépendant de toute bibliothèque cartographique.
 * Coordonnées en mètres locaux (x = est, y = nord) autour de `origin`. Structure en tableaux typés
 * (CSR pour l'adjacence et les géométries) : compacte, sérialisable, rapide.
 */
export const EdgeClass = {
  Primary: 0,
  Secondary: 1,
  Tertiary: 2,
  Unclassified: 3,
  Residential: 4,
  LivingStreet: 5,
  Service: 6,
  Pedestrian: 7,
  Footway: 8,
  Path: 9,
  Steps: 10,
  Track: 11,
  /** Voie réservée aux bus (BHNS, couloirs) : praticable à pied par un cortège (matériellement), pas ouverte à la circulation générale. */
  Busway: 12,
} as const;
export type EdgeClassId = (typeof EdgeClass)[keyof typeof EdgeClass];

export const EdgeFlag = {
  Oneway: 1, // sens a→b uniquement (véhicules)
  OnewayRev: 2, // sens b→a uniquement (véhicules)
  Foot: 4, // accessible aux piétons
  Motor: 8, // accessible aux véhicules
  Bridge: 16,
  Tunnel: 32,
  WidthDefault: 64, // largeur estimée par défaut (non issue des données)
} as const;

export type Provenance = 'osm' | 'synthetic';

export interface OpenSpace {
  id: string;
  kind: 'square' | 'park' | 'pedestrian_area';
  /** Contour fermé (x0,y0,x1,y1,…), sans répéter le premier point. */
  ring: Float32Array;
  name?: string;
  source: Provenance;
  osmId?: number;
}

export interface Obstacle {
  ring: Float32Array;
  /** Nature du bâtiment quand elle est connue (étiquettes OSM) : sert à placer un piquet devant une VRAIE administration. */
  kind?: 'administration';
  /** Nom OSM éventuel (affiché tel quel, décision v0.4) ; absent pour les objets synthétiques. */
  name?: string;
  source: Provenance;
}

/** Nature d'un lieu d'intérêt (cahier §16.3) ; les installations de police/gendarmerie n'en font jamais partie. */
export type PoiKind = 'commerce' | 'public' | 'school' | 'company' | 'furniture';

/** Lieu d'intérêt issu des données (OSM) : information géographique, jamais une cible d'incident. */
export interface GraphPoi {
  id: string;
  kind: PoiKind;
  /** Catégorie fine (valeur d'étiquette OSM : `bakery`, `school`, `waste_basket`…). */
  category: string;
  /** Nom OSM éventuel (affiché tel quel, décision v0.4). */
  name?: string;
  x: number;
  y: number;
  source: Provenance;
  osmId?: number;
}

export interface StreetGraph {
  version: 1;
  origin: LngLat;
  nodeCount: number;
  edgeCount: number;
  nodeX: Float32Array;
  nodeY: Float32Array;
  edgeA: Uint32Array;
  edgeB: Uint32Array;
  edgeLen: Float32Array;
  edgeClass: Uint8Array;
  edgeWidth: Float32Array;
  edgeFlags: Uint8Array;
  /** Polyligne de chaque arête (de a vers b), en CSR : points (x,y) à `shape[2*shapeStart[e] …]`. */
  shapeStart: Uint32Array; // taille edgeCount+1, en nombre de POINTS
  shape: Float32Array;
  edgeName: (string | undefined)[];
  edgeOsmId: Float64Array; // 0 si synthétique
  adjStart: Uint32Array; // taille nodeCount+1
  adj: Uint32Array; // arêtes incidentes
  spaces: OpenSpace[];
  obstacles: Obstacle[];
  /** Lieux d'intérêt (commerces, établissements publics, écoles, entreprises, mobilier) : affichage et contexte de rue. */
  pois: GraphPoi[];
  provenance: { source: Provenance; osmTimestamp?: string; label?: string };
  /** Emprise des nœuds (m). */
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

export interface RawEdge {
  a: number;
  b: number;
  /** Points intermédiaires + extrémités, de a vers b (au moins 2). */
  shape: Vec2[];
  cls: EdgeClassId;
  flags: number;
  width: number;
  name?: string;
  osmId?: number;
}

export interface RawGraph {
  origin: LngLat;
  nodes: Vec2[];
  edges: RawEdge[];
  spaces?: OpenSpace[];
  obstacles?: Obstacle[];
  pois?: GraphPoi[];
  provenance: StreetGraph['provenance'];
}

export function polylineLength(pts: Vec2[]): number {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y);
  return l;
}

/** Construit un graphe compact à partir d'arêtes brutes. Les arêtes de longueur nulle sont ignorées. */
export function buildGraph(raw: RawGraph): StreetGraph {
  const edges = raw.edges.filter((e) => e.shape.length >= 2 && polylineLength(e.shape) > 1e-3);
  const nodeCount = raw.nodes.length;
  const edgeCount = edges.length;
  const nodeX = new Float32Array(nodeCount);
  const nodeY = new Float32Array(nodeCount);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  raw.nodes.forEach((n, i) => {
    nodeX[i] = n.x;
    nodeY[i] = n.y;
    minX = Math.min(minX, n.x);
    maxX = Math.max(maxX, n.x);
    minY = Math.min(minY, n.y);
    maxY = Math.max(maxY, n.y);
  });
  const edgeA = new Uint32Array(edgeCount);
  const edgeB = new Uint32Array(edgeCount);
  const edgeLen = new Float32Array(edgeCount);
  const edgeClass = new Uint8Array(edgeCount);
  const edgeWidth = new Float32Array(edgeCount);
  const edgeFlags = new Uint8Array(edgeCount);
  const edgeOsmId = new Float64Array(edgeCount);
  const edgeName: (string | undefined)[] = new Array(edgeCount);
  const shapeStart = new Uint32Array(edgeCount + 1);
  let totalPts = 0;
  edges.forEach((e) => (totalPts += e.shape.length));
  const shape = new Float32Array(totalPts * 2);
  let p = 0;
  const deg = new Uint32Array(nodeCount + 1);
  edges.forEach((e, i) => {
    edgeA[i] = e.a;
    edgeB[i] = e.b;
    edgeLen[i] = polylineLength(e.shape);
    edgeClass[i] = e.cls;
    edgeWidth[i] = e.width;
    edgeFlags[i] = e.flags;
    edgeOsmId[i] = e.osmId ?? 0;
    edgeName[i] = e.name;
    shapeStart[i] = p;
    for (const pt of e.shape) {
      shape[2 * p] = pt.x;
      shape[2 * p + 1] = pt.y;
      p++;
    }
    deg[e.a]!++;
    if (e.b !== e.a) deg[e.b]!++;
  });
  shapeStart[edgeCount] = p;
  const adjStart = new Uint32Array(nodeCount + 1);
  for (let n = 0; n < nodeCount; n++) adjStart[n + 1] = adjStart[n]! + deg[n]!;
  const fill = new Uint32Array(nodeCount);
  const adj = new Uint32Array(adjStart[nodeCount]!);
  edges.forEach((e, i) => {
    adj[adjStart[e.a]! + fill[e.a]!++] = i;
    if (e.b !== e.a) adj[adjStart[e.b]! + fill[e.b]!++] = i;
  });
  return {
    version: 1,
    origin: raw.origin,
    nodeCount,
    edgeCount,
    nodeX,
    nodeY,
    edgeA,
    edgeB,
    edgeLen,
    edgeClass,
    edgeWidth,
    edgeFlags,
    shapeStart,
    shape,
    edgeName,
    edgeOsmId,
    adjStart,
    adj,
    spaces: raw.spaces ?? [],
    obstacles: raw.obstacles ?? [],
    pois: raw.pois ?? [],
    provenance: raw.provenance,
    bounds: nodeCount ? { minX, minY, maxX, maxY } : { minX: 0, minY: 0, maxX: 0, maxY: 0 },
  };
}

export function otherNode(g: StreetGraph, e: number, n: number): number {
  return g.edgeA[e] === n ? (g.edgeB[e] as number) : (g.edgeA[e] as number);
}

export function edgePoints(g: StreetGraph, e: number): Vec2[] {
  const out: Vec2[] = [];
  for (let i = g.shapeStart[e]!; i < g.shapeStart[e + 1]!; i++) out.push({ x: g.shape[2 * i]!, y: g.shape[2 * i + 1]! });
  return out;
}

/** Points d'une arête entre deux abscisses curvilignes (t0 → t1, peut être décroissant). */
export function sliceEdge(g: StreetGraph, e: number, t0: number, t1: number): Vec2[] {
  const pts = edgePoints(g, e);
  const len = g.edgeLen[e] as number;
  const lo = Math.max(0, Math.min(t0, t1));
  const hi = Math.min(len, Math.max(t0, t1));
  const out: Vec2[] = [];
  let acc = 0;
  const lerp = (a: Vec2, b: Vec2, f: number): Vec2 => ({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f });
  out.push(pointOnPolyline(pts, lo));
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1] as Vec2;
    const b = pts[i] as Vec2;
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    const s0 = acc;
    const s1 = acc + seg;
    if (s1 > lo + 1e-6 && s0 < hi - 1e-6) {
      if (s0 > lo) out.push(a);
      if (s1 >= hi && s0 < hi) {
        out.push(lerp(a, b, seg === 0 ? 0 : (hi - s0) / seg));
      }
    }
    acc = s1;
  }
  if (out.length === 1) out.push(pointOnPolyline(pts, hi));
  // dédoublonne les points confondus
  const clean = out.filter((p, i) => i === 0 || Math.hypot(p.x - out[i - 1]!.x, p.y - out[i - 1]!.y) > 1e-6);
  if (clean.length === 1) clean.push({ ...clean[0]! });
  return t1 < t0 ? clean.reverse() : clean;
}

export function pointOnPolyline(pts: Vec2[], s: number): Vec2 {
  if (s <= 0) return { ...(pts[0] as Vec2) };
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1] as Vec2;
    const b = pts[i] as Vec2;
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    if (acc + seg >= s) {
      const f = seg === 0 ? 0 : (s - acc) / seg;
      return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
    }
    acc += seg;
  }
  return { ...(pts[pts.length - 1] as Vec2) };
}

/** Composantes connexes (sur l'union des arêtes) : retourne l'identifiant de composante de chaque nœud. */
export function connectedComponents(g: StreetGraph): { comp: Int32Array; sizes: number[] } {
  const comp = new Int32Array(g.nodeCount).fill(-1);
  const sizes: number[] = [];
  const stack: number[] = [];
  for (let s = 0; s < g.nodeCount; s++) {
    if (comp[s] !== -1) continue;
    const id = sizes.length;
    let count = 0;
    stack.push(s);
    comp[s] = id;
    while (stack.length) {
      const n = stack.pop() as number;
      count++;
      for (let k = g.adjStart[n]!; k < g.adjStart[n + 1]!; k++) {
        const m = otherNode(g, g.adj[k] as number, n);
        if (comp[m] === -1) {
          comp[m] = id;
          stack.push(m);
        }
      }
    }
    sizes.push(count);
  }
  return { comp, sizes };
}
