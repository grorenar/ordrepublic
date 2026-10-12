import type { LocalFrame, Vec2 } from './mercator';
import type { GameZone, StreetSegment } from '../state/types';

/** Forme minimale d'une entité rendue par MapLibre (compatible avec MapGeoJSONFeature). */
export interface RenderedFeatureLike {
  id?: string | number;
  sourceLayer?: string;
  properties?: Record<string, unknown> | null;
  geometry: { type: string; coordinates: unknown };
}

const DRIVABLE = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor', 'service', 'street', 'residential']);
const MAX_SEGMENT_M = 140;

/**
 * Transforme des entités routières rendues (schéma OpenMapTiles : couche « transportation »)
 * en segments de rue du jeu, limités à la zone. Best effort : le résultat dépend de ce que le
 * style affiche à l'écran ; il peut être vide (zone hors écran, style différent).
 */
export function segmentsFromFeatures(features: RenderedFeatureLike[], frame: LocalFrame, zone: GameZone): StreetSegment[] {
  const out: StreetSegment[] = [];
  const seen = new Set<string>();
  const inside = (p: Vec2) => Math.abs(p.x) <= zone.halfWidth && Math.abs(p.y) <= zone.halfHeight;

  for (const f of features) {
    if (f.sourceLayer !== 'transportation') continue;
    const cls = String(f.properties?.class ?? '');
    if (cls && !DRIVABLE.has(cls)) continue;
    const lines: number[][][] =
      f.geometry.type === 'LineString'
        ? [f.geometry.coordinates as number[][]]
        : f.geometry.type === 'MultiLineString'
          ? (f.geometry.coordinates as number[][][])
          : [];
    const name = typeof f.properties?.name === 'string' ? (f.properties.name as string) : undefined;
    for (const line of lines) {
      let chunk: Vec2[] = [];
      let len = 0;
      const flush = () => {
        if (chunk.length >= 2 && chunk.every(inside)) {
          const a = chunk[0] as Vec2;
          const id = `osm:${Math.round(a.x)}:${Math.round(a.y)}:${Math.round(len)}`;
          if (!seen.has(id)) {
            seen.add(id);
            out.push({ id, points: chunk, name });
          }
        }
        chunk = chunk.length ? [chunk[chunk.length - 1] as Vec2] : [];
        len = 0;
      };
      for (const c of line) {
        const [lng, lat] = c as [number, number];
        const p = frame.toMeters({ lng, lat });
        const prev = chunk[chunk.length - 1];
        if (prev) len += Math.hypot(p.x - prev.x, p.y - prev.y);
        chunk.push(p);
        if (len >= MAX_SEGMENT_M) flush();
      }
      flush();
    }
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : 1));
}
