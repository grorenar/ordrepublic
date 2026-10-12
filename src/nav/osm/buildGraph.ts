import { LocalFrame, type LngLat, type Vec2 } from '../../geo/mercator';
import {
  buildGraph,
  connectedComponents,
  type Obstacle,
  type OpenSpace,
  type RawEdge,
  type StreetGraph,
} from '../graph';
import { parseOverpass, type OsmData } from './parseOverpass';
import { classifyHighway, classifySpace, isBuilding, type ExclusionReason } from './tagsPolicy';

export interface BuildOptions {
  /** Origine du repère local ; par défaut le centroïde des nœuds utilisés. */
  origin?: LngLat;
  /** Conserver uniquement la plus grande composante connexe (défaut). */
  keep?: 'largest' | 'all';
  osmTimestamp?: string;
  label?: string;
}

export interface BuildReport {
  waysTotal: number;
  highwayWaysUsed: number;
  excluded: Partial<Record<ExclusionReason, number>>;
  edges: number;
  nodes: number;
  lengthKm: number;
  components: number;
  droppedEdges: number;
  widthDefaultedShare: number;
  spaces: number;
  obstacles: number;
  relationsSkipped: number;
  /** Densité de voirie (km de voies par km² d'emprise des nœuds) : indicateur de richesse des données. */
  roadDensityKmPerKm2: number;
  warnings: string[];
}

/** Construit le graphe de navigation à partir de données OSM déjà lues (aucun accès réseau). */
export function buildGraphFromOsm(data: OsmData, opts: BuildOptions = {}): { graph: StreetGraph; report: BuildReport } {
  const excluded: BuildReport['excluded'] = {};
  const bump = (r: ExclusionReason) => (excluded[r] = (excluded[r] ?? 0) + 1);
  const used: Array<{ way: (typeof data.ways)[number]; info: Exclude<ReturnType<typeof classifyHighway>, { excluded: ExclusionReason }> }> = [];
  for (const w of data.ways) {
    if (w.tags.highway) {
      const c = classifyHighway(w.tags);
      if ('excluded' in c) {
        if (c.excluded !== 'area') bump(c.excluded);
        continue;
      }
      const ids = w.nodes.filter((n) => data.nodes.has(n));
      if (ids.length < 2) continue;
      used.push({ way: { ...w, nodes: ids }, info: c });
    }
  }

  // origine
  let origin = opts.origin;
  if (!origin) {
    let sl = 0;
    let sg = 0;
    let n = 0;
    const seen = new Set<number>();
    for (const u of used) for (const id of u.way.nodes) if (!seen.has(id)) {
      seen.add(id);
      const nd = data.nodes.get(id) as { lat: number; lon: number };
      sl += nd.lat;
      sg += nd.lon;
      n++;
    }
    origin = n ? { lat: sl / n, lng: sg / n } : { lat: 0, lng: 0 };
  }
  const frame = new LocalFrame(origin);
  const local = (id: number): Vec2 => {
    const nd = data.nodes.get(id) as { lat: number; lon: number };
    return frame.toMeters({ lat: nd.lat, lng: nd.lon });
  };

  // références de nœuds (intersections)
  const ref = new Map<number, number>();
  for (const u of used) for (const id of u.way.nodes) ref.set(id, (ref.get(id) ?? 0) + 1);

  const nodeIndex = new Map<number, number>();
  const nodes: Vec2[] = [];
  const nodeOf = (id: number): number => {
    let i = nodeIndex.get(id);
    if (i === undefined) {
      i = nodes.length;
      nodeIndex.set(id, i);
      nodes.push(local(id));
    }
    return i;
  };

  const edges: RawEdge[] = [];
  let defaulted = 0;
  for (const { way, info } of used) {
    const ids = way.nodes;
    let startIdx = 0;
    for (let i = 1; i < ids.length; i++) {
      const isSplit = i === ids.length - 1 || (ref.get(ids[i] as number) ?? 0) >= 2;
      if (!isSplit) continue;
      const slice = ids.slice(startIdx, i + 1);
      let shape = slice.map(local);
      let a = nodeOf(slice[0] as number);
      let b = nodeOf(slice[slice.length - 1] as number);
      if (info.reverse) {
        shape = shape.reverse();
        [a, b] = [b, a];
      }
      if (a !== b || shape.length > 2) {
        edges.push({
          a,
          b,
          shape,
          cls: info.cls,
          flags: info.flags,
          width: info.width,
          name: way.tags.name,
          osmId: way.id,
        });
        if (info.widthDefaulted) defaulted++;
      }
      startIdx = i;
    }
  }

  // espaces et obstacles
  const spaces: OpenSpace[] = [];
  const obstacles: Obstacle[] = [];
  for (const w of data.ways) {
    if (w.nodes.length < 4 || w.nodes[0] !== w.nodes[w.nodes.length - 1]) continue;
    const ids = w.nodes.slice(0, -1).filter((n) => data.nodes.has(n));
    if (ids.length < 3) continue;
    const ring = new Float32Array(ids.length * 2);
    ids.forEach((id, i) => {
      const p = local(id);
      ring[2 * i] = p.x;
      ring[2 * i + 1] = p.y;
    });
    const kind = classifySpace(w.tags);
    if (kind) spaces.push({ id: `osm-w${w.id}`, kind, ring, name: w.tags.name, source: 'osm', osmId: w.id });
    else if (isBuilding(w.tags)) obstacles.push({ ring, name: w.tags.name, source: 'osm' });
  }

  let graph = buildGraph({
    origin,
    nodes,
    edges,
    spaces,
    obstacles,
    provenance: { source: 'osm', osmTimestamp: opts.osmTimestamp, label: opts.label },
  });

  // composantes connexes
  const { comp, sizes } = connectedComponents(graph);
  let dropped = 0;
  if ((opts.keep ?? 'largest') === 'largest' && sizes.length > 1) {
    let main = 0;
    sizes.forEach((s, i) => {
      if (s > (sizes[main] as number)) main = i;
    });
    const keepEdges = edges.filter((e) => comp[e.a] === main);
    dropped = edges.length - keepEdges.length;
    // reconstruit avec seulement les nœuds de la composante principale
    const remap = new Map<number, number>();
    const nn: Vec2[] = [];
    const re = keepEdges.map((e) => {
      const m = (i: number) => {
        let v = remap.get(i);
        if (v === undefined) {
          v = nn.length;
          remap.set(i, v);
          nn.push(nodes[i] as Vec2);
        }
        return v;
      };
      return { ...e, a: m(e.a), b: m(e.b) };
    });
    graph = buildGraph({ origin, nodes: nn, edges: re, spaces, obstacles, provenance: graph.provenance });
  }

  let lengthM = 0;
  for (let e = 0; e < graph.edgeCount; e++) lengthM += graph.edgeLen[e] as number;
  const bw = graph.bounds.maxX - graph.bounds.minX;
  const bh = graph.bounds.maxY - graph.bounds.minY;
  const areaKm2 = Math.max(1e-6, (bw * bh) / 1e6);
  const warnings: string[] = [];
  if (graph.edgeCount === 0) warnings.push('Aucune voie exploitable : le jeu doit utiliser le fond schématique.');
  if (sizes.length > 1) warnings.push(`${sizes.length} composantes connexes ; ${dropped} arêtes isolées ignorées.`);
  const density = lengthM / 1000 / areaKm2;
  if (graph.edgeCount > 0 && density < 5) warnings.push(`Réseau peu dense (${density.toFixed(1)} km/km²) : données OSM éventuellement incomplètes.`);
  if (data.skipped.relations) warnings.push(`${data.skipped.relations} relations ignorées (multipolygones non gérés : certains bâtiments/places peuvent manquer).`);
  return {
    graph,
    report: {
      waysTotal: data.ways.length,
      highwayWaysUsed: used.length,
      excluded,
      edges: graph.edgeCount,
      nodes: graph.nodeCount,
      lengthKm: lengthM / 1000,
      components: sizes.length,
      droppedEdges: dropped,
      widthDefaultedShare: edges.length ? defaulted / edges.length : 0,
      spaces: spaces.length,
      obstacles: obstacles.length,
      relationsSkipped: data.skipped.relations,
      roadDensityKmPerKm2: density,
      warnings,
    },
  };
}

export function buildGraphFromOverpassJson(json: unknown, opts: BuildOptions = {}) {
  return buildGraphFromOsm(parseOverpass(json), opts);
}
