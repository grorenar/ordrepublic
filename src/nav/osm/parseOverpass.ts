import { classifyPoi, type Tags } from './tagsPolicy';

export interface OsmNode {
  lat: number;
  lon: number;
}
export interface OsmWay {
  id: number;
  nodes: number[];
  tags: Tags;
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
    } else if (e.type === 'relation') relations++;
  }
  return { nodes, poiNodes, ways, skipped: { relations } };
}
