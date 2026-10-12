import { RouteCursor, type CursorOut } from '../nav/route';
import { columnOffset } from './motion';
import type { SimParams } from './params';
import type { BlockLevels, CrowdGroup, Focus, SimLevel } from './types';

/**
 * Niveaux de simulation.
 *
 * Distance de référence : toujours mesurée du point considéré au BORD du foyer d'attention
 * (`distance au centre − rayon du foyer`). Un point dans le foyer a donc une distance ≤ 0. Seuils :
 *   N2 (individuel)  si distance ≤ n2RadiusM ;
 *   N1 (suit ses cibles) si distance ≤ n1RadiusM ;
 *   N0 (aucune mise à jour) au-delà.
 *
 * Niveau par groupe : le point considéré est le groupe entier (distance de son enveloppe) ; niveau par
 * bloc : pour un très gros groupe en marche (≥ `blockMinGroupSize`), chaque bloc de `blockSize`
 * individus consécutifs (donc contigus le long de la colonne) est évalué à partir de son propre point.
 */
export function levelFor(distance: number, lod: SimParams['lod'], previous: SimLevel | null): SimLevel {
  const h = 1 + lod.hysteresis;
  let level: SimLevel = distance <= lod.n2RadiusM ? 2 : distance <= lod.n1RadiusM ? 1 : 0;
  // hystérésis : on ne rétrograde qu'une fois le seuil franchi de plus de `hysteresis`
  if (previous !== null && level < previous) {
    if (previous === 2 && distance <= lod.n2RadiusM * h) level = 2;
    else if (previous >= 1 && level === 0 && distance <= lod.n1RadiusM * h) level = 1;
  }
  return level;
}

export function distanceToFoci(x: number, y: number, foci: readonly Focus[]): number {
  let best = Infinity;
  for (const f of foci) best = Math.min(best, Math.hypot(x - f.x, y - f.y) - f.radius);
  return best;
}

/** Le groupe est-il découpé en blocs ? (très gros groupe, colonne en marche : structure 1-D le long de la route) */
export function usesBlocks(g: CrowdGroup, lod: SimParams['lod']): boolean {
  return g.kind !== 'static' && !!g.route && (g.phase === 'moving' || g.phase === 'waiting' || g.phase === 'forming') && g.members.n - g.members.activeStart >= lod.blockMinGroupSize;
}

const cur: CursorOut = { x: 0, y: 0, nx: 0, ny: 1, edge: 0, dStart: 0, dEnd: 0 };

/** Calcule (ou met à jour) les niveaux de chaque bloc de la colonne. */
export function selectBlockLevels(g: CrowdGroup, foci: readonly Focus[], lod: SimParams['lod']): BlockLevels {
  const m = g.members;
  const n = m.n;
  const size = Math.max(16, lod.blockSize);
  const nb = Math.ceil(n / size);
  let bl = g.blocks;
  if (!bl || bl.level.length !== nb || bl.size !== size) {
    bl = { size, level: new Uint8Array(nb).fill(2), stale: new Uint8Array(nb) };
  }
  const route = g.route as NonNullable<CrowdGroup['route']>;
  const cursor = new RouteCursor(route);
  for (let b = 0; b < nb; b++) {
    const mid = Math.min(n - 1, Math.floor((b + 0.5) * size));
    // pas de borne basse : derrière le point d'entrée, la colonne se prolonge en ligne droite (comme les positions réelles)
    const s = Math.min(route.length, g.sCentre + columnOffset(mid, n, g.columnLength));
    cursor.at(s, cur);
    bl.level[b] = levelFor(distanceToFoci(cur.x, cur.y, foci), lod, bl.level[b] as SimLevel);
  }
  return bl;
}
