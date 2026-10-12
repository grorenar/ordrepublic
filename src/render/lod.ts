import { groupRadius } from '../demo/demoScenario';
import type { CrowdGroup, EntityRef } from '../state/types';
import type { Vec2 } from '../geo/mercator';

/** Niveaux de détail selon le zoom (valeurs de zoom MapLibre / Web Mercator 512 px). */
export interface Lod {
  /** Foule agrégée en un symbole avec effectif. */
  aggregateCrowd: boolean;
  /** Part des individus tracés (0..1). */
  crowdDetail: number;
  /** Unités en formation de boucliers (sinon pictogramme unique). */
  shieldFormation: boolean;
  labels: boolean;
  vehicleDetail: boolean;
}

export function lodForZoom(zoom: number): Lod {
  return {
    aggregateCrowd: zoom < 14.8,
    crowdDetail: zoom < 14.8 ? 0 : zoom < 15.6 ? 0.3 : zoom < 16.4 ? 0.65 : 1,
    shieldFormation: zoom >= 15.8,
    labels: zoom >= 15.2,
    vehicleDetail: zoom >= 16.4,
  };
}

/** Nombre de points de foule tracés pour un groupe, plafonné pour garder la lisibilité. */
export function crowdDotCount(group: CrowdGroup, lod: Lod, cap = 450): number {
  if (lod.aggregateCrowd) return 0;
  return Math.min(cap, Math.max(0, Math.round(group.size * lod.crowdDetail)));
}

export interface HitTarget {
  ref: EntityRef;
  x: number;
  y: number;
  r: number;
  /** Priorité : plus grand = prioritaire en cas de recouvrement. */
  z: number;
}

export function hitTest(targets: readonly HitTarget[], p: Vec2, slop = 5): EntityRef | null {
  let best: HitTarget | null = null;
  let bestScore = Infinity;
  for (const t of targets) {
    const d = Math.hypot(p.x - t.x, p.y - t.y);
    if (d > t.r + slop) continue;
    const score = d - t.z * 1000; // priorité d'abord, distance ensuite
    if (score < bestScore) {
      bestScore = score;
      best = t;
    }
  }
  return best ? best.ref : null;
}

export { groupRadius };
