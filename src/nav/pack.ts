import { buildGraph, type EdgeClassId, type Obstacle, type OpenSpace, type Provenance, type RawEdge, type StreetGraph } from './graph';
import type { Vec2 } from '../geo/mercator';

/**
 * Paquet de ville : graphe de rues (+ places et bâtiments) sérialisé en JSON, les tableaux numériques étant
 * encodés en base64 (compact, sans perte). Produit hors ligne par `npm run data:pack`, lu par le jeu au lancement.
 * Les paquets issus d'OpenStreetMap sont une base de données DÉRIVÉE (ODbL) : voir docs/DONNEES_OSM.md.
 */
export const PACK_FORMAT = 'ordrepublic-osm-pack';
export const PACK_VERSION = 1;

export interface PackMeta {
  city: string;
  name: string;
  generatedAt: string;
  source: Provenance;
  /** Date des données OSM si connue (en-tête de la réponse Overpass). */
  osmTimestamp?: string;
  bbox?: { south: number; west: number; north: number; east: number };
  attribution: string;
  license: string;
  report?: Record<string, unknown>;
}

export interface Pack {
  format: typeof PACK_FORMAT;
  version: number;
  meta: PackMeta;
  graph: {
    origin: { lng: number; lat: number };
    nodeCount: number;
    edgeCount: number;
    nodeX: string;
    nodeY: string;
    edgeA: string;
    edgeB: string;
    edgeClass: string;
    edgeWidth: string;
    edgeFlags: string;
    shapeStart: string;
    shape: string;
    edgeName: (string | null)[];
    edgeOsmId: string;
    provenance: StreetGraph['provenance'];
  };
  spaces: Array<{ id: string; kind: OpenSpace['kind']; ring: string; name?: string; source: Provenance; osmId?: number }>;
  obstacles: Array<{ ring: string; name?: string; source: Provenance; kind?: 'administration' }>;
}

export class PackError extends Error {}

export function b64encode(bytes: Uint8Array): string {
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode(...bytes.subarray(i, i + CH));
  return btoa(s);
}

export function b64decode(text: string): Uint8Array {
  const s = atob(text);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

const enc = (a: Float32Array | Uint32Array | Uint8Array | Float64Array): string => b64encode(new Uint8Array(a.buffer, a.byteOffset, a.byteLength));
function dec<T extends Float32Array | Uint32Array | Uint8Array | Float64Array>(text: string, Ctor: new (b: ArrayBuffer) => T, expected: number, what: string): T {
  const bytes = b64decode(text);
  const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  let arr: T;
  try {
    arr = new Ctor(copy);
  } catch {
    throw new PackError(`Paquet corrompu : « ${what} » est tronqué.`);
  }
  if (arr.length !== expected) throw new PackError(`Paquet corrompu : « ${what} » contient ${arr.length} valeurs au lieu de ${expected}.`);
  return arr;
}

export function packGraph(g: StreetGraph, meta: PackMeta): Pack {
  return {
    format: PACK_FORMAT,
    version: PACK_VERSION,
    meta,
    graph: {
      origin: g.origin,
      nodeCount: g.nodeCount,
      edgeCount: g.edgeCount,
      nodeX: enc(g.nodeX),
      nodeY: enc(g.nodeY),
      edgeA: enc(g.edgeA),
      edgeB: enc(g.edgeB),
      edgeClass: enc(g.edgeClass),
      edgeWidth: enc(g.edgeWidth),
      edgeFlags: enc(g.edgeFlags),
      shapeStart: enc(g.shapeStart),
      shape: enc(g.shape),
      edgeName: g.edgeName.map((n) => n ?? null),
      edgeOsmId: enc(g.edgeOsmId),
      provenance: g.provenance,
    },
    spaces: g.spaces.map((s) => ({ id: s.id, kind: s.kind, ring: enc(s.ring), name: s.name, source: s.source, osmId: s.osmId })),
    obstacles: g.obstacles.map((o) => ({ ring: enc(o.ring), name: o.name, source: o.source, ...(o.kind ? { kind: o.kind } : {}) })),
  };
}

/** Lit un paquet ; lève `PackError` (message clair) si le format, la version ou le contenu sont invalides. */
export function unpackGraph(input: unknown): { graph: StreetGraph; meta: PackMeta } {
  const p = input as Partial<Pack> | null;
  if (!p || p.format !== PACK_FORMAT) throw new PackError('Fichier inconnu : ce n’est pas un paquet de ville Ordre Public.');
  if (p.version !== PACK_VERSION) throw new PackError(`Version de paquet non prise en charge (${String(p.version)} ; attendue ${PACK_VERSION}). Régénérez le paquet.`);
  if (!p.graph || !p.meta) throw new PackError('Paquet incomplet.');
  const g = p.graph;
  const nE = g.edgeCount;
  const nN = g.nodeCount;
  const shapeStart = dec(g.shapeStart, Uint32Array, nE + 1, 'shapeStart');
  const pts = shapeStart[nE] as number;
  const edges = {
    a: dec(g.edgeA, Uint32Array, nE, 'edgeA'),
    b: dec(g.edgeB, Uint32Array, nE, 'edgeB'),
    cls: dec(g.edgeClass, Uint8Array, nE, 'edgeClass'),
    width: dec(g.edgeWidth, Float32Array, nE, 'edgeWidth'),
    flags: dec(g.edgeFlags, Uint8Array, nE, 'edgeFlags'),
    osm: dec(g.edgeOsmId, Float64Array, nE, 'edgeOsmId'),
    shape: dec(g.shape, Float32Array, pts * 2, 'shape'),
  };
  const nodeX = dec(g.nodeX, Float32Array, nN, 'nodeX');
  const nodeY = dec(g.nodeY, Float32Array, nN, 'nodeY');
  if (g.edgeName.length !== nE) throw new PackError('Paquet corrompu : noms de rues incohérents.');
  const nodes: Vec2[] = Array.from({ length: nN }, (_, i) => ({ x: nodeX[i] as number, y: nodeY[i] as number }));
  const raw: RawEdge[] = [];
  for (let e = 0; e < nE; e++) {
    if ((edges.a[e] as number) >= nN || (edges.b[e] as number) >= nN) throw new PackError('Paquet corrompu : arête vers un nœud inexistant.');
    const shape: Vec2[] = [];
    for (let i = shapeStart[e] as number; i < (shapeStart[e + 1] as number); i++) shape.push({ x: edges.shape[2 * i] as number, y: edges.shape[2 * i + 1] as number });
    raw.push({ a: edges.a[e] as number, b: edges.b[e] as number, shape, cls: edges.cls[e] as EdgeClassId, flags: edges.flags[e] as number, width: edges.width[e] as number, name: g.edgeName[e] ?? undefined, osmId: (edges.osm[e] as number) || undefined });
  }
  const spaces: OpenSpace[] = (p.spaces ?? []).map((s) => ({ id: s.id, kind: s.kind, ring: dec(s.ring, Float32Array, b64decode(s.ring).length / 4, 'espace'), name: s.name, source: s.source, osmId: s.osmId }));
  const obstacles: Obstacle[] = (p.obstacles ?? []).map((o) => ({ ring: dec(o.ring, Float32Array, b64decode(o.ring).length / 4, 'bâtiment'), name: o.name, source: o.source, ...(o.kind === 'administration' ? { kind: 'administration' as const } : {}) }));
  const graph = buildGraph({ origin: g.origin, nodes, edges: raw, spaces, obstacles, provenance: g.provenance });
  return { graph, meta: p.meta };
}
