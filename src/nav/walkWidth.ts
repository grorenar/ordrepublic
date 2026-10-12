import { EdgeClass, type StreetGraph } from './graph';
import type { WalkMask } from './walkMask';

export interface WalkWidthOptions {
  /** Largeur maximale retenue (m). */
  maxM: number;
  /** Intervalle entre deux échantillons le long de l'arête (m). */
  sampleEveryM: number;
  /** Largeur de trottoir supposée de chaque côté (m) quand aucun bâtiment ne permet de mesurer. */
  sidewalkAllowanceM: number;
}

const MIN_WIDTH = 1.5;
const JUNCTION_SKIP_M = 4;
const STEP_M = 0.5;

/** Les rues ouvertes aux véhicules ont des trottoirs ; les voies piétonnes ont déjà leur largeur complète. */
const hasSidewalks = (cls: number) => cls <= EdgeClass.Service;

/**
 * Largeur PRATICABLE à pied de chaque arête : espace libre entre façades (chaussée + trottoirs), mesuré en lançant des rayons
 * perpendiculaires à la rue depuis des points échantillonnés jusqu'au premier bâtiment de chaque côté. On retient le 1er
 * quartile des échantillons (une trouée entre deux immeubles n'élargit pas toute la rue). Sans bâtiments exploitables :
 * largeur de chaussée + trottoirs supposés. Les véhicules, eux, restent limités à `edgeWidth` (chaussée).
 */
export function computeWalkWidths(g: StreetGraph, mask: WalkMask | null, o: WalkWidthOptions): Float32Array {
  const out = new Float32Array(g.edgeCount);
  const half = o.maxM / 2;
  const samples: number[] = [];
  for (let e = 0; e < g.edgeCount; e++) {
    const cls = g.edgeClass[e] as number;
    const fallback = Math.min(o.maxM, (g.edgeWidth[e] as number) + (hasSidewalks(cls) ? 2 * o.sidewalkAllowanceM : 0));
    out[e] = fallback;
    if (!mask || g.obstacles.length === 0) continue;
    samples.length = 0;
    const a = g.shapeStart[e] as number;
    const b = g.shapeStart[e + 1] as number;
    // abscisse cumulée le long de la forme
    let acc = 0;
    let next = Math.min(JUNCTION_SKIP_M, (g.edgeLen[e] as number) / 2);
    const total = g.edgeLen[e] as number;
    for (let i = a + 1; i < b; i++) {
      const x0 = g.shape[2 * (i - 1)] as number;
      const y0 = g.shape[2 * (i - 1) + 1] as number;
      const x1 = g.shape[2 * i] as number;
      const y1 = g.shape[2 * i + 1] as number;
      const len = Math.hypot(x1 - x0, y1 - y0);
      if (len < 1e-6) continue;
      const tx = (x1 - x0) / len;
      const ty = (y1 - y0) / len;
      while (next <= acc + len && next <= total - Math.min(JUNCTION_SKIP_M, total / 2) + 1e-6) {
        const d = next - acc;
        const px = x0 + tx * d;
        const py = y0 + ty * d;
        next += o.sampleEveryM;
        if (mask.isBlocked(px, py)) continue; // axe dans un bâtiment : donnée incohérente, on ignore l'échantillon
        let left = 0;
        let right = 0;
        let hitL = false;
        let hitR = false;
        for (let s = STEP_M; s <= half; s += STEP_M) {
          if (!hitL && mask.isBlocked(px - ty * s, py + tx * s)) {
            left = s - STEP_M / 2;
            hitL = true;
          }
          if (!hitR && mask.isBlocked(px + ty * s, py - tx * s)) {
            right = s - STEP_M / 2;
            hitR = true;
          }
          if (hitL && hitR) break;
        }
        if (!hitL) left = half;
        if (!hitR) right = half;
        samples.push(left + right);
      }
      acc += len;
    }
    if (samples.length === 0) continue;
    samples.sort((x, y) => x - y);
    const q1 = samples[Math.floor(0.25 * (samples.length - 1))] as number;
    out[e] = Math.max(MIN_WIDTH, Math.min(o.maxM, q1));
  }
  return out;
}
