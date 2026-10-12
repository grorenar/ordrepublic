import type { Vec2 } from '../geo/mercator';
import { PointGrid } from '../engine/spatialIndex';
import type { Sim } from '../engine/sim';
import type { CrowdGroup, Id } from '../engine/types';

/** Élément sélectionnable : unité, véhicule, groupe de manifestants (et éventuellement un individu précis). */
export type EntityRef =
  | { type: 'unit'; id: Id }
  | { type: 'vehicle'; id: Id }
  | { type: 'group'; id: Id; member?: number };

export const sameRef = (a: EntityRef | null, b: EntityRef | null): boolean => !!a && !!b && a.type === b.type && a.id === b.id;

export interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Enveloppe d'un groupe (échantillon de ses individus présents + marge), sans parcourir toute la foule. */
export function groupBox(g: CrowdGroup, margin = 10): Box | null {
  const m = g.members;
  const lo = Math.max(m.activeStart, g.entryStart);
  const hi = Math.min(m.n, g.exitStart);
  const n = hi - lo;
  if (n <= 0) return null;
  const step = Math.max(1, Math.floor(n / 96));
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = lo; i < hi; i += step) {
    const x = m.x[i] as number;
    const y = m.y[i] as number;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX: minX - margin, minY: minY - margin, maxX: maxX + margin, maxY: maxY + margin };
}

const inBox = (b: Box, p: Vec2) => p.x >= b.minX && p.x <= b.maxX && p.y >= b.minY && p.y <= b.maxY;

/** Un individu dont le bloc est en N0 (position périmée, hors du foyer) n'est jamais affiché ni sélectionnable. */
export function memberLive(g: CrowdGroup, i: number): boolean {
  if (i < g.entryStart || i >= g.exitStart) return false; // pas encore entré dans la zone, ou déjà sorti
  const bl = g.blocks;
  if (bl) return (bl.level[Math.floor(i / bl.size)] as number) > 0;
  return g.level > 0;
}

/**
 * Sélection au clic : unités et véhicules d'abord (liste courte), puis individus d'un groupe — l'index à grille d'un
 * groupe n'est construit que pour le groupe touché et réutilisé tant que le tick ne change pas.
 */
export class SelectionIndex {
  private grids = new Map<Id, { tick: number; grid: PointGrid }>();
  /** Dernier nombre de comparaisons d'individus (tests de complexité). */
  lastComparisons = 0;
  gridBuilds = 0;

  constructor(private readonly sim: Sim) {}

  private gridFor(g: CrowdGroup): PointGrid {
    const hit = this.grids.get(g.id);
    if (hit && hit.tick === this.sim.tick) return hit.grid;
    const grid = hit?.grid ?? new PointGrid();
    grid.build(g.members.x, g.members.y, g.members.activeStart, g.members.n, 4, (i) => memberLive(g, i));
    this.gridBuilds++;
    this.grids.set(g.id, { tick: this.sim.tick, grid });
    return grid;
  }

  /**
   * `tolM` = tolérance en mètres (rayon de clic converti depuis les pixels). `precise` = vrai pour un clic (cherche
   * l'individu), faux pour un survol (se contente de l'enveloppe du groupe).
   */
  pick(p: Vec2, tolM: number, precise: boolean): EntityRef | null {
    this.lastComparisons = 0;
    const sim = this.sim;
    let best: EntityRef | null = null;
    let bestD = Infinity;
    for (const u of sim.units) {
      this.lastComparisons++;
      const d = Math.hypot(u.x - p.x, u.y - p.y);
      if (d <= Math.max(tolM, 3) && d < bestD) {
        bestD = d;
        best = { type: 'unit', id: u.id };
      }
    }
    for (const v of sim.vehicles) {
      this.lastComparisons++;
      const d = Math.hypot(v.x - p.x, v.y - p.y);
      if (d <= Math.max(tolM, 5) && d < bestD) {
        bestD = d;
        best = { type: 'vehicle', id: v.id };
      }
    }
    if (best) return best;
    for (const g of sim.groups) {
      if (g.phase === 'dispersed') continue;
      const box = groupBox(g, Math.max(tolM, 6));
      if (!box || !inBox(box, p)) continue;
      if (!precise) return { type: 'group', id: g.id };
      const grid = this.gridFor(g);
      const hit = grid.nearest(p.x, p.y, Math.max(tolM, 2));
      this.lastComparisons += grid.comparisons;
      if (hit.index >= 0) return { type: 'group', id: g.id, member: hit.index };
      // pas d'individu à portée mais le clic est dans l'enveloppe dense du groupe : on sélectionne le groupe
      const near = grid.nearest(p.x, p.y, Math.max(tolM * 6, 25));
      this.lastComparisons += grid.comparisons;
      if (near.index >= 0) return { type: 'group', id: g.id };
    }
    return null;
  }

  invalidate(): void {
    this.grids.clear();
  }
}
