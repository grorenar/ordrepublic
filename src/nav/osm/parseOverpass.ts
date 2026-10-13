import { classifyPoi, type Tags } from './tagsPolicy';

export interface OsmNode {
  lat: number;
  lon: number;
}
export interface OsmWay {
  id: number;
  nodes: number[];
  tags: Tags;
  /** Anneaux intérieurs (multipolygone) : listes d'identifiants de nœuds fermées. */
  holes?: number[][];
}
export interface OsmTaggedNode {
  id: number;
  lat: number;
  lon: number;
  tags: Tags;
}
export interface OsmData {
  nodes: Map<number, OsmNode>;
  /** Points d'intérêt (étiquettes de commerce, établissement, mobilier…) : seuls les nœuds utiles sont conservés. */
  poiNodes: OsmTaggedNode[];
  ways: OsmWay[];
  /** Éléments ignorés (relations, etc.) : les multipolygones ne sont pas gérés en phase 3. */
  skipped: { relations: number };
}

export class OsmParseError extends Error {}

/**
 * Lit une réponse Overpass JSON (`[out:json]` avec `out body; >; out skel qt;` ou `out geom`).
 * Format uniquement ; aucune requête réseau ici.
 */
export function parseOverpass(json: unknown): OsmData {
  if (!json || typeof json !== 'object' || !Array.isArray((json as { elements?: unknown }).elements)) {
    throw new OsmParseError('Réponse Overpass invalide : tableau « elements » manquant.');
  }
  const nodes = new Map<number, OsmNode>();
  const ways: OsmWay[] = [];
  const poiNodes: OsmTaggedNode[] = [];
  let relations = 0;
  const synth = { nextNode: -1, nextWay: -1, byCoord: new Map<string, number>() };
  for (const el of (json as { elements: unknown[] }).elements) {
    if (!el || typeof el !== 'object') continue;
    const e = el as Record<string, unknown>;
    if (e.type === 'node' && typeof e.id === 'number' && typeof e.lat === 'number' && typeof e.lon === 'number') {
      nodes.set(e.id, { lat: e.lat, lon: e.lon });
      if (e.tags && typeof e.tags === 'object') {
        const tg: Tags = {};
        for (const [k, v] of Object.entries(e.tags as Record<string, unknown>)) if (typeof v === 'string') tg[k] = v;
        if (classifyPoi(tg)) poiNodes.push({ id: e.id, lat: e.lat, lon: e.lon, tags: tg });
      }
    } else if (e.type === 'way' && typeof e.id === 'number' && Array.isArray(e.nodes)) {
      const ids = (e.nodes as unknown[]).filter((n): n is number => typeof n === 'number');
      if (Array.isArray(e.geometry) && e.geometry.length === ids.length) {
        (e.geometry as Array<{ lat?: number; lon?: number } | null>).forEach((g, i) => {
          if (g && typeof g.lat === 'number' && typeof g.lon === 'number' && !nodes.has(ids[i] as number)) nodes.set(ids[i] as number, { lat: g.lat, lon: g.lon });
        });
      }
      const tags: Tags = {};
      if (e.tags && typeof e.tags === 'object') {
        for (const [k, v] of Object.entries(e.tags as Record<string, unknown>)) if (typeof v === 'string') tags[k] = v;
      }
      ways.push({ id: e.id, nodes: ids, tags });
    } else if (e.type === 'relation') {
      // multipolygones (grandes places, parcs, bâtiments à cour) : anneaux extérieurs assemblés depuis `out geom`
      const made = relationToWays(e, nodes, synth);
      if (made.length) ways.push(...made);
      else relations++;
    }
  }
  return { nodes, poiNodes, ways, skipped: { relations } };
}


interface SynthState {
  nextNode: number;
  nextWay: number;
  byCoord: Map<string, number>;
}

type Pt = { lat: number; lon: number };

/**
 * Convertit une relation `type=multipolygon` (réponse `out geom`) en chemins fermés synthétiques : chaque anneau extérieur
 * devient un chemin portant les étiquettes de la relation (les trous ne sont pas gérés). Retourne [] si la relation n'est
 * pas exploitable (sans géométrie, anneau non fermé…).
 */
function relationToWays(e: Record<string, unknown>, nodes: Map<number, OsmNode>, st: SynthState): OsmWay[] {
  if (!e.tags || typeof e.tags !== 'object' || !Array.isArray(e.members)) return [];
  const tags: Tags = {};
  for (const [k, v] of Object.entries(e.tags as Record<string, unknown>)) if (typeof v === 'string') tags[k] = v;
  if (tags.type !== 'multipolygon' && tags.type !== 'boundary') return [];
  const collect = (roles: string[]): Pt[][] => {
    const segs: Pt[][] = [];
    for (const m of e.members as Array<Record<string, unknown>>) {
      if (m.type !== 'way' || !roles.includes(String(m.role)) || !Array.isArray(m.geometry)) continue;
      const g = (m.geometry as Array<Pt | null>).filter((p): p is Pt => !!p && typeof p.lat === 'number' && typeof p.lon === 'number');
      if (g.length >= 2) segs.push(g);
    }
    return segs;
  };
  const key = (p: Pt) => `${p.lat},${p.lon}`;
  const assemble = (segs: Pt[][]): Pt[][] => {
    const rings: Pt[][] = [];
    const pool = segs.slice();
    while (pool.length) {
      let ring = (pool.shift() as Pt[]).slice();
      let guard = pool.length + 1;
      while (key(ring[0] as Pt) !== key(ring[ring.length - 1] as Pt) && guard-- > 0) {
        const end = key(ring[ring.length - 1] as Pt);
        const i = pool.findIndex((x) => key(x[0] as Pt) === end || key(x[x.length - 1] as Pt) === end);
        if (i < 0) break;
        const nxt = pool.splice(i, 1)[0] as Pt[];
        ring = ring.concat(key(nxt[0] as Pt) === end ? nxt.slice(1) : nxt.slice().reverse().slice(1));
      }
      if (ring.length >= 4 && key(ring[0] as Pt) === key(ring[ring.length - 1] as Pt)) rings.push(ring);
    }
    return rings;
  };
  const rings = assemble(collect(['outer', '']));
  const holeRings = assemble(collect(['inner']));
  const idsOf = (ring: Pt[]): number[] =>
    ring.map((p) => {
      const k = key(p);
      let id = st.byCoord.get(k);
      if (id === undefined) {
        id = st.nextNode--;
        st.byCoord.set(k, id);
        nodes.set(id, { lat: p.lat, lon: p.lon });
      }
      return id;
    });
  const inside = (poly: Pt[], p: Pt): boolean => {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i] as Pt;
      const b = poly[j] as Pt;
      if (a.lat > p.lat !== b.lat > p.lat && p.lon < ((b.lon - a.lon) * (p.lat - a.lat)) / (b.lat - a.lat) + a.lon) c = !c;
    }
    return c;
  };
  const out: OsmWay[] = [];
  for (const ring of rings) {
    const mine = holeRings.filter((h) => inside(ring, h[0] as Pt)).map(idsOf);
    out.push({ id: st.nextWay--, nodes: idsOf(ring), tags, ...(mine.length ? { holes: mine } : {}) });
  }
  return out;
}
