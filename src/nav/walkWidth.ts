import { EdgeClass, EdgeFlag, type StreetGraph } from './graph';
import type { WalkMask } from './walkMask';

export interface WalkWidthOptions {
  /** Demi-largeur maximale (m) explorée de chaque côté de l'axe de la rue (espaces ouverts compris). */
  maxHalfM: number;
  /** Distance maximale (m) à laquelle une façade est considérée comme bordant la rue ; au-delà, c'est un espace ouvert. */
  streetHalfM: number;
  /** Intervalle entre deux échantillons le long de l'arête (m). */
  sampleEveryM: number;
  /** Largeur de trottoir supposée de chaque côté (m) quand aucun bâtiment ne permet de mesurer. */
  sidewalkAllowanceM: number;
}

/** Espace praticable autour de l'axe de chaque arête, orienté a→b : `left` = côté gauche (normale directe). */
export interface WalkCorridors {
  left: Float32Array;
  right: Float32Array;
  /** left + right. */
  width: Float32Array;
}

const MIN_HALF = 0.75;
const JUNCTION_SKIP_M = 4;
const STEP_M = 0.5;

/** Les rues ouvertes aux véhicules ont des trottoirs ; les voies piétonnes ont déjà leur largeur complète. */
const hasSidewalks = (cls: number) => cls <= EdgeClass.Service;

/**
 * Espace PRATICABLE à pied de chaque côté de chaque rue (corridor asymétrique) : on lance des rayons perpendiculaires depuis des
 * points échantillonnés.
 *  - Côté bordé par une façade à moins de `streetHalfM` : le corridor s'arrête à la façade (chaussée + trottoirs).
 *  - Côté sans façade proche : la chaussée + un trottoir, et seulement si le terrain est un ESPACE OUVERT cartographié (place, zone
 *    piétonne, parc) le corridor s'étend jusqu'au prochain bâtiment (jusqu'à `maxHalfM`) : une foule s'étale sur une place
 *    mais ne marche pas dans un fleuve, un parking ou une pelouse non cartographiée.
 *  - Voies en tunnel, passage couvert ou pont : les bâtiments cartographiés au-dessus ne comptent pas, largeur = celle de la voie.
 * On retient le 1er quartile des échantillons de chaque côté (une trouée entre deux immeubles n'élargit pas toute la rue).
 * Sans bâtiments exploitables : chaussée + trottoirs supposés. Les véhicules restent limités à `edgeWidth` (chaussée).
 */
export function computeWalkCorridors(g: StreetGraph, mask: WalkMask | null, o: WalkWidthOptions): WalkCorridors {
  const left = new Float32Array(g.edgeCount);
  const right = new Float32Array(g.edgeCount);
  const sl: number[] = [];
  const sr: number[] = [];
  const quart = (a: number[]) => {
    a.sort((x, y) => x - y);
    return a[Math.floor(0.25 * (a.length - 1))] as number;
  };
  for (let e = 0; e < g.edgeCount; e++) {
    const cls = g.edgeClass[e] as number;
    const roadHalf = (g.edgeWidth[e] as number) / 2;
    const side = Math.min(o.maxHalfM, roadHalf + (hasSidewalks(cls) ? o.sidewalkAllowanceM : 0));
    left[e] = right[e] = Math.max(MIN_HALF, side);
    const covered = ((g.edgeFlags[e] as number) & (EdgeFlag.Tunnel | EdgeFlag.Bridge)) !== 0;
    if (covered) {
      left[e] = right[e] = Math.max(MIN_HALF, Math.min(o.maxHalfM, roadHalf + 0.5));
      continue;
    }
    if (!mask || (g.obstacles.length === 0 && g.spaces.length === 0)) continue;
    sl.length = 0;
    sr.length = 0;
    const a = g.shapeStart[e] as number;
    const b = g.shapeStart[e + 1] as number;
    const total = g.edgeLen[e] as number;
    const skip = Math.min(JUNCTION_SKIP_M, total / 2);
    let acc = 0;
    let next = skip;
    for (let i = a + 1; i < b; i++) {
      const x0 = g.shape[2 * (i - 1)] as number;
      const y0 = g.shape[2 * (i - 1) + 1] as number;
      const x1 = g.shape[2 * i] as number;
      const y1 = g.shape[2 * i + 1] as number;
      const len = Math.hypot(x1 - x0, y1 - y0);
      if (len < 1e-6) continue;
      const tx = (x1 - x0) / len;
      const ty = (y1 - y0) / len;
      while (next <= acc + len && next <= total - skip + 1e-6) {
        const d = next - acc;
        const px = x0 + tx * d;
        const py = y0 + ty * d;
        next += o.sampleEveryM;
        if (mask.isBlocked(px, py)) continue; // axe dans un bâtiment : donnée incohérente, on ignore l'échantillon
        sl.push(extent(mask, px, py, -ty, tx, roadHalf, side, o));
        sr.push(extent(mask, px, py, ty, -tx, roadHalf, side, o));
      }
      acc += len;
    }
    if (sl.length === 0) continue;
    left[e] = Math.max(MIN_HALF, quart(sl));
    right[e] = Math.max(MIN_HALF, quart(sr));
  }
  const width = new Float32Array(g.edgeCount);
  for (let e = 0; e < g.edgeCount; e++) width[e] = (left[e] as number) + (right[e] as number);
  return { left, right, width };
}

/** Distance praticable depuis l'axe, dans la direction (dx,dy) : façade proche, sinon chaussée + trottoir, sinon espace ouvert. */
function extent(mask: WalkMask, px: number, py: number, dx: number, dy: number, roadHalf: number, defaultSide: number, o: WalkWidthOptions): number {
  let facade = -1;
  let openExt = 0;
  let openContinuous = true;
  for (let s = STEP_M; s <= o.maxHalfM; s += STEP_M) {
    const x = px + dx * s;
    const y = py + dy * s;
    if (mask.isBlocked(x, y)) {
      if (s <= o.streetHalfM) facade = s - STEP_M / 2;
      else if (openContinuous) openExt = s - STEP_M / 2; // bâtiment qui borde un espace ouvert
      break;
    }
    if (openContinuous) {
      if (mask.isOpen(x, y)) openExt = s;
      else if (s > roadHalf) openContinuous = false;
    }
    if (s > o.streetHalfM && !openContinuous) break;
  }
  if (facade >= 0) return Math.min(facade, o.maxHalfM);
  return Math.min(o.maxHalfM, Math.max(defaultSide, openExt));
}

/** Compatibilité : largeur totale seule. */
export function computeWalkWidths(g: StreetGraph, mask: WalkMask | null, o: WalkWidthOptions): Float32Array {
  return computeWalkCorridors(g, mask, o).width;
}
