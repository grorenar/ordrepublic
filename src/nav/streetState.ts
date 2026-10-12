import type { Vec2 } from '../geo/mercator';
import type { StreetGraph } from './graph';
import type { EdgeGrid } from './spatialGrid';
import type { NavParams } from './params';
import type { Route } from './route';

/**
 * État DYNAMIQUE des rues, dérivé de la géométrie (largeur, surface) et de la densité de foule —
 * jamais d'un seuil universel de personnes. États : 0 libre · 1 ralenti · 2 partiellement obstrué · 3 bloqué.
 */
export type StreetStateId = 0 | 1 | 2 | 3;

export interface EdgeState {
  scenarioBlock: Uint8Array;
  load: Float32Array;
  density: Float32Array;
  occupiedWidth: Float32Array;
  /** État pour les piétons (cortèges, unités à pied). */
  footState: Uint8Array;
  /** État pour les véhicules. */
  vehState: Uint8Array;
  /** Facteur de vitesse piéton (relation densité-vitesse). */
  speedFactor: Float32Array;
  /** Incrémenté dès qu'un état dérivé change → les routes doivent être revalidées. */
  version: number;
}

export function createEdgeState(g: StreetGraph): EdgeState {
  const n = g.edgeCount;
  return {
    scenarioBlock: new Uint8Array(n),
    load: new Float32Array(n),
    density: new Float32Array(n),
    occupiedWidth: new Float32Array(n),
    footState: new Uint8Array(n),
    vehState: new Uint8Array(n),
    speedFactor: new Float32Array(n).fill(1),
    version: 0,
  };
}

/** Emprise d'une foule pour le calcul de charge. */
export type CrowdFootprint =
  | { kind: 'march'; route: Route; centreS: number; columnLength: number; size: number }
  | { kind: 'static'; center: Vec2; radius: number; size: number };

/** Longueur (m) du segment [a,b] située dans le disque (c, r). */
export function segmentLengthInCircle(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, r: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const fx = ax - cx;
  const fy = ay - cy;
  const A = dx * dx + dy * dy;
  if (A === 0) return 0;
  const B = 2 * (fx * dx + fy * dy);
  const C = fx * fx + fy * fy - r * r;
  const disc = B * B - 4 * A * C;
  if (disc <= 0) return 0;
  const sq = Math.sqrt(disc);
  const t0 = Math.max(0, (-B - sq) / (2 * A));
  const t1 = Math.min(1, (-B + sq) / (2 * A));
  return t1 > t0 ? (t1 - t0) * Math.sqrt(A) : 0;
}

function polygonAreaInDiscApprox(ring: Float32Array, cx: number, cy: number, r: number): number {
  // Estimation grossière : aire du polygone si son centroïde est dans le disque (plafonnée par l'aire du disque).
  let a = 0;
  let sx = 0;
  let sy = 0;
  const n = ring.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const x0 = ring[2 * i]!;
    const y0 = ring[2 * i + 1]!;
    const x1 = ring[2 * j]!;
    const y1 = ring[2 * j + 1]!;
    a += x0 * y1 - x1 * y0;
    sx += x0;
    sy += y0;
  }
  const area = Math.abs(a) / 2;
  const d = Math.hypot(sx / n - cx, sy / n - cy);
  return d <= r ? Math.min(area, Math.PI * r * r) : 0;
}

/** Répartit l'effectif des empreintes sur les arêtes (calcul par GROUPE, pas par individu). */
export function accumulateLoads(
  g: StreetGraph,
  grid: EdgeGrid,
  foot: readonly CrowdFootprint[],
  out: Float32Array,
  /** Reçoit la contribution de chaque empreinte (indice, arête, personnes) : sert à exclure la charge « propre » d'un groupe. */
  onPart?: (footprint: number, edge: number, load: number) => void,
): void {
  out.fill(0);
  for (let fi = 0; fi < foot.length; fi++) {
    const f = foot[fi] as CrowdFootprint;
    if (f.size <= 0) continue;
    if (f.kind === 'march') {
      const L = Math.max(1, f.columnLength);
      const s0 = Math.max(0, f.centreS - L / 2);
      const s1 = Math.min(f.route.length, f.centreS + L / 2);
      if (s1 <= s0) continue;
      const perMeter = f.size / L;
      for (let i = 0; i < f.route.edges.length; i++) {
        const a = f.route.edgeStart[i] as number;
        const b = f.route.edgeStart[i + 1] as number;
        const ov = Math.min(b, s1) - Math.max(a, s0);
        if (ov > 0) {
          out[f.route.edges[i] as number]! += perMeter * ov;
          onPart?.(fi, f.route.edges[i] as number, perMeter * ov);
        }
      }
    } else {
      const edges = grid.edgesInDisc(f.center, f.radius + 5);
      const parts: Array<[number, number]> = [];
      let total = 0;
      for (const e of edges) {
        let inside = 0;
        for (let i = (g.shapeStart[e] as number) + 1; i < (g.shapeStart[e + 1] as number); i++) {
          inside += segmentLengthInCircle(g.shape[2 * (i - 1)]!, g.shape[2 * (i - 1) + 1]!, g.shape[2 * i]!, g.shape[2 * i + 1]!, f.center.x, f.center.y, f.radius);
        }
        if (inside <= 0) continue;
        const area = inside * (g.edgeWidth[e] as number);
        parts.push([e, area]);
        total += area;
      }
      let spaceArea = 0;
      for (const sp of g.spaces) spaceArea += polygonAreaInDiscApprox(sp.ring, f.center.x, f.center.y, f.radius);
      total += spaceArea;
      if (total <= 0) continue;
      for (const [e, area] of parts) {
        out[e]! += (f.size * area) / total;
        onPart?.(fi, e, (f.size * area) / total);
      }
    }
  }
}

/** Dérive densité, largeur occupée, états et facteur de vitesse. Retourne vrai si un état a changé. */
export function deriveStates(g: StreetGraph, st: EdgeState, p: NavParams): boolean {
  let changed = false;
  const needVeh = p.vehicleWidthM + p.vehicleMarginM;
  for (let e = 0; e < g.edgeCount; e++) {
    const len = g.edgeLen[e] as number;
    const W = g.edgeWidth[e] as number;
    const n = st.load[e] as number;
    const rho = n / Math.max(1e-6, len * W);
    const occ = Math.min(W, n / Math.max(1e-6, len * p.referenceDensity));
    const free = W - occ;
    st.density[e] = rho;
    st.occupiedWidth[e] = occ;

    let foot: StreetStateId = 0;
    if (rho >= p.jamDensity) foot = 3; // un piéton traverse une foule dense lentement ; il ne bloque qu'à saturation
    else if (occ / W >= p.partialObstruction) foot = 2;
    else if (rho >= p.slowedDensity) foot = 1;

    let veh: StreetStateId = 0;
    const need = Math.min(needVeh, W);
    if (occ > 0.05 && free < need) veh = 3;
    else if (occ / W >= p.partialObstruction) veh = 2;
    else if (rho >= p.slowedDensity) veh = 1;

    const sf = Math.max(p.minSpeedFactor, Math.min(1, 1 - rho / p.jamDensity));
    if (st.footState[e] !== foot || st.vehState[e] !== veh) changed = true;
    st.footState[e] = foot;
    st.vehState[e] = veh;
    st.speedFactor[e] = sf;
  }
  if (changed) st.version++;
  return changed;
}

export function setScenarioBlock(st: EdgeState, edge: number, blocked: boolean): boolean {
  const v = blocked ? 1 : 0;
  if (st.scenarioBlock[edge] === v) return false;
  st.scenarioBlock[edge] = v;
  st.version++;
  return true;
}

export interface StreetCounts {
  total: number;
  /** Bloquées pour les véhicules ou fermées par le scénario. */
  blocked: number;
  partial: number;
  slowed: number;
  scenarioClosed: number;
}

export function countStreetStates(g: StreetGraph, st: EdgeState, zone?: { halfWidth: number; halfHeight: number }): StreetCounts {
  const out: StreetCounts = { total: 0, blocked: 0, partial: 0, slowed: 0, scenarioClosed: 0 };
  for (let e = 0; e < g.edgeCount; e++) {
    if (zone) {
      const mx = (g.nodeX[g.edgeA[e] as number]! + g.nodeX[g.edgeB[e] as number]!) / 2;
      const my = (g.nodeY[g.edgeA[e] as number]! + g.nodeY[g.edgeB[e] as number]!) / 2;
      if (Math.abs(mx) > zone.halfWidth || Math.abs(my) > zone.halfHeight) continue;
    }
    out.total++;
    const closed = st.scenarioBlock[e] === 1;
    if (closed) out.scenarioClosed++;
    if (closed || st.vehState[e] === 3) out.blocked++;
    else if (st.vehState[e] === 2 || st.footState[e] === 2) out.partial++;
    else if (st.vehState[e] === 1 || st.footState[e] === 1) out.slowed++;
  }
  return out;
}

