import type { StreetGraph } from '../nav/graph';
import { RouteCursor, locate, type CursorOut, type Located, type Route } from '../nav/route';
import type { WalkMask } from '../nav/walkMask';
import type { SimParams } from './params';
import { noise } from './rng';
import type { CrowdGroup } from './types';

/**
 * Fonctions de MOUVEMENT des individus. Principe : la position visée de chaque individu est une
 * FONCTION ANALYTIQUE de (groupe, indice, temps) — elle ne dépend pas du niveau de simulation. Les niveaux
 * ne font que choisir la finesse de mise à jour :
 *   N0 : rien n'est mis à jour (positions évaluées à la demande) ;
 *   N1 : positions = cibles (évaluation par sous-groupes, repère partagé) ;
 *   N2 : dynamique individuelle (rappel amorti + bruit + rejet des bâtiments).
 */
export interface MotionCtx {
  graph: StreetGraph;
  params: SimParams;
  mask: WalkMask | null;
  /** Largeur praticable à pied par arête (m). */
  walk: Float32Array;
  tick: number;
  tMs: number;
}

const loc: Located = { x: 0, y: 0, tx: 0, ty: 0, seg: 0 };
const cur: CursorOut = { x: 0, y: 0, nx: 0, ny: 1, edge: 0, dStart: 0, dEnd: 0 };
const WIDTH_BLEND_M = 8;

export function columnOffset(i: number, n: number, L: number): number {
  return ((i + 0.5) / n - 0.5) * L;
}

/** Demi-largeur de front disponible à l'abscisse courante du curseur (largeur de rue lissée aux jonctions). */
function halfWidth(g: CrowdGroup, c: MotionCtx, route: Route): number {
  const edges = route.edges;
  const W = (e: number) => c.walk[edges[e] as number] as number;
  let w = W(cur.edge);
  if (cur.dStart < WIDTH_BLEND_M && cur.edge > 0) w = W(cur.edge - 1) + (w - W(cur.edge - 1)) * (0.5 + (0.5 * cur.dStart) / WIDTH_BLEND_M);
  else if (cur.dEnd < WIDTH_BLEND_M && cur.edge < edges.length - 1) w = W(cur.edge + 1) + (w - W(cur.edge + 1)) * (0.5 + (0.5 * cur.dEnd) / WIDTH_BLEND_M);
  return Math.max(0.4, Math.min(g.frontWidth, w - 2 * c.params.streetMarginM) / 2);
}

export interface RouteFrame {
  x: number;
  y: number;
  nx: number;
  ny: number;
  hw: number;
}

/**
 * Repère au début (`atEnd=false`) ou à la fin (`atEnd=true`) d'une route : point, normale et demi-largeur de front.
 * Chaque individu quitte/rejoint la route avec SON décalage latéral : le raccord avec le créneau est continu.
 */
export function routeFrame(g: CrowdGroup, c: MotionCtx, route: Route, atEnd: boolean): RouteFrame {
  const cursor = new RouteCursor(route);
  cursor.at(atEnd ? route.length : 0, cur);
  return { x: cur.x, y: cur.y, nx: cur.nx, ny: cur.ny, hw: halfWidth(g, c, route) };
}

/** Point d'entrée de l'individu `i` sur le tracé (début ou fin de route), avec son décalage latéral. */
export function frameEntry(f: RouteFrame, lat: number): { x: number; y: number } {
  return { x: f.x + f.nx * lat * f.hw, y: f.y + f.ny * lat * f.hw };
}

function marchTargets(g: CrowdGroup, c: MotionCtx, from: number, to: number): void {
  const m = g.members;
  const route = g.route as NonNullable<CrowdGroup['route']>;
  const n = m.n;
  const L = g.columnLength;
  const len = route.length;
  const sc = g.sCentre;
  const lay = g.layout;
  const end = lay ? routeFrame(g, c, route, true) : null;
  const cursor = new RouteCursor(route);
  for (let i = Math.max(from, m.activeStart); i < to; i++) {
    const s = sc + columnOffset(i, n, L);
    if (lay && end && s >= len) {
      // prolongement rectiligne depuis le point de sortie de l'individu (SON décalage latéral) jusqu'à son créneau
      const slot = m.slotOf[i] as number;
      const sx = lay.pts[2 * slot] as number;
      const sy = lay.pts[2 * slot + 1] as number;
      const e = frameEntry(end, m.lat[i] as number);
      const dist = Math.hypot(sx - e.x, sy - e.y);
      const f = dist > 1e-6 ? Math.min(1, (s - len) / dist) : 1;
      m.tx[i] = e.x + (sx - e.x) * f;
      m.ty[i] = e.y + (sy - e.y) * f;
      continue;
    }
    cursor.at(s, cur);
    const off = (m.lat[i] as number) * halfWidth(g, c, route);
    m.tx[i] = cur.x + cur.nx * off;
    m.ty[i] = cur.y + cur.ny * off;
  }
}

function staticTargets(g: CrowdGroup): void {
  const m = g.members;
  const lay = g.layout as NonNullable<CrowdGroup['layout']>;
  for (let i = m.activeStart; i < m.n; i++) {
    const slot = m.slotOf[i] as number;
    m.tx[i] = lay.pts[2 * slot] as number;
    m.ty[i] = lay.pts[2 * slot + 1] as number;
  }
}

/** Nombre d'individus déjà sortis de la zone en dispersion à l'instant `tMs` (analytique, monotone). */
export function goneCount(g: CrowdGroup, tMs: number): number {
  const d = g.dispersal;
  if (!d) return 0;
  const n = g.members.n;
  const v = d.speedMps;
  const x = ((tMs - d.startMs) / 1000 - d.route.length / v - d.maxDist / v) / (d.durationMs / 1000);
  if (x < 0) return 0;
  return Math.min(n, Math.floor(n * x) + 1);
}

function dispersalTargets(g: CrowdGroup, c: MotionCtx): void {
  const m = g.members;
  const d = g.dispersal as NonNullable<CrowdGroup['dispersal']>;
  const lay = g.layout as NonNullable<CrowdGroup['layout']>;
  const n = m.n;
  const v = d.speedMps;
  const T = d.durationMs / 1000;
  const tStart = d.startMs / 1000;
  const t = c.tMs / 1000;
  const ax = lay.anchor.x;
  const ay = lay.anchor.y;
  const len = d.route.length;
  const cursor = new RouteCursor(d.route);
  const start = routeFrame(g, c, d.route, false);
  void ax;
  void ay;
  for (let i = m.activeStart; i < n; i++) {
    const slot = m.slotOf[i] as number;
    const sx = lay.pts[2 * slot] as number;
    const sy = lay.pts[2 * slot + 1] as number;
    const dist = d.dist[i] as number;
    const leaveAt = tStart + (d.maxDist - dist) / v + (i / n) * T;
    const walked = v * (t - leaveAt);
    if (walked <= 0) {
      m.tx[i] = sx;
      m.ty[i] = sy;
    } else if (walked < dist) {
      const e = frameEntry(start, m.lat[i] as number);
      const f = walked / dist;
      m.tx[i] = sx + (e.x - sx) * f;
      m.ty[i] = sy + (e.y - sy) * f;
    } else {
      const s = Math.min(walked - dist, len);
      cursor.at(s, cur);
      const off = (m.lat[i] as number) * halfWidth(g, c, d.route);
      m.tx[i] = cur.x + cur.nx * off;
      m.ty[i] = cur.y + cur.ny * off;
    }
  }
}

/**
 * Calcule les cibles des individus présents (g.members.tx/ty). `from/to` limitent le calcul à un intervalle de
 * rangs (niveaux par bloc) : seulement possible pour une colonne en marche, sinon tout le groupe est calculé.
 */
export function computeTargets(g: CrowdGroup, c: MotionCtx, from = 0, to = g.members.n): void {
  let ranged = false;
  switch (g.phase) {
    case 'forming':
    case 'moving':
    case 'waiting':
      if (g.kind !== 'static' && g.route) {
        marchTargets(g, c, from, to);
        ranged = true;
      } else if (g.layout) staticTargets(g);
      break;
    case 'settled':
      if (g.layout) staticTargets(g);
      break;
    case 'dispersing':
      if (g.dispersal && g.layout) dispersalTargets(g, c);
      break;
    case 'dispersed':
      return;
  }
  const b = g.blend;
  if (b) {
    const tau = Math.max(0, Math.min(1, (c.tMs - b.t0Ms) / b.durMs));
    if (tau >= 1) g.blend = null;
    const e = tau * tau * (3 - 2 * tau);
    const m = g.members;
    const lo = ranged ? Math.max(from, m.activeStart) : m.activeStart;
    const hi = ranged ? to : m.n;
    for (let i = lo; i < hi; i++) {
      m.tx[i] = (b.fromX[i] as number) + ((m.tx[i] as number) - (b.fromX[i] as number)) * e;
      m.ty[i] = (b.fromY[i] as number) + ((m.ty[i] as number) - (b.fromY[i] as number)) * e;
    }
  }
}

/** N1 : rapprochement borné vers la cible (aucune téléportation, même en sortant de N2 avec un retard de rappel). */
function followTargets(g: CrowdGroup, c: MotionCtx, i0: number, i1: number): void {
  const m = g.members;
  const maxStep = c.params.blendMaxSpeedMps * (c.params.tickMs / 1000);
  const { x, y, tx, ty } = m;
  for (let i = i0; i < i1; i++) {
    const dx = (tx[i] as number) - (x[i] as number);
    const dy = (ty[i] as number) - (y[i] as number);
    const d2 = dx * dx + dy * dy;
    if (d2 <= maxStep * maxStep) {
      x[i] = tx[i] as number;
      y[i] = ty[i] as number;
    } else {
      const k = maxStep / Math.sqrt(d2);
      x[i] = (x[i] as number) + dx * k;
      y[i] = (y[i] as number) + dy * k;
    }
  }
}

/** N2 : dynamique individuelle (rappel amorti + bruit stateless + rejet des bâtiments). */
function dynamics(g: CrowdGroup, c: MotionCtx, i0: number, i1: number): void {
  const m = g.members;
  const p = c.params;
  const dt = p.tickMs / 1000;
  const k = p.memberSpring;
  const base = g.kind === 'static' || g.phase === 'settled' ? p.speedByKind.march : Math.max(g.speedMps, 0.3);
  const vmax = Math.max(0.8, base) * p.memberMaxSpeedFactor;
  const amp = p.noiseAmplitudeM;
  const bucket = c.tick >> 3;
  const frac = (c.tick & 7) / 8;
  const mask = c.mask;
  const { x, y, tx, ty, seed } = m;
  for (let i = i0; i < i1; i++) {
    const sd = seed[i] as number;
    const nx0 = noise(sd, bucket, 0);
    const ny0 = noise(sd, bucket, 1);
    const ox = amp * (nx0 + (noise(sd, bucket + 1, 0) - nx0) * frac);
    const oy = amp * (ny0 + (noise(sd, bucket + 1, 1) - ny0) * frac);
    const cx = x[i] as number;
    const cy = y[i] as number;
    const dx = (tx[i] as number) + ox - cx;
    const dy = (ty[i] as number) + oy - cy;
    const d2 = dx * dx + dy * dy;
    if (d2 < 1e-6) continue;
    const d = Math.sqrt(d2);
    const step = Math.min(d, Math.min(k * d, vmax) * dt);
    const nx = cx + (dx / d) * step;
    const ny = cy + (dy / d) * step;
    if (mask && mask.isBlocked(nx, ny)) {
      // glissement le long du bâtiment, sinon immobile : aucun individu n'entre dans un bâtiment
      if (!mask.isBlocked(nx, cy)) x[i] = nx;
      else if (!mask.isBlocked(cx, ny)) y[i] = ny;
      continue;
    }
    x[i] = nx;
    y[i] = ny;
  }
}

/** Met à jour les positions des individus selon le niveau de simulation (du groupe, ou bloc par bloc). */
export function updateMembers(g: CrowdGroup, c: MotionCtx): void {
  if (g.phase === 'dispersed') return;
  const m = g.members;
  const bl = g.blocks;
  if (bl) {
    // niveaux par bloc : on traite chaque suite de blocs consécutifs de même niveau
    const nb = bl.level.length;
    let b = 0;
    while (b < nb) {
      const lvl = bl.level[b] as number;
      let e = b;
      while (e + 1 < nb && bl.level[e + 1] === lvl) e++;
      const i0 = Math.max(b * bl.size, m.activeStart);
      const i1 = Math.min((e + 1) * bl.size, m.n);
      if (lvl === 0) {
        for (let k = b; k <= e; k++) bl.stale[k] = 1;
      } else if (i1 > i0) {
        computeTargets(g, c, i0, i1);
        // les blocs sortant de N0 sont réalignés sur leurs cibles (ils étaient hors de portée du foyer)
        for (let k = b; k <= e; k++) {
          if (bl.stale[k]) {
            const a = Math.max(k * bl.size, m.activeStart);
            const z = Math.min((k + 1) * bl.size, m.n);
            for (let i = a; i < z; i++) {
              m.x[i] = m.tx[i] as number;
              m.y[i] = m.ty[i] as number;
              m.px[i] = m.tx[i] as number;
              m.py[i] = m.ty[i] as number;
            }
            bl.stale[k] = 0;
          }
        }
        m.px.set(m.x.subarray(i0, i1), i0);
        m.py.set(m.y.subarray(i0, i1), i0);
        if (lvl === 1) followTargets(g, c, i0, i1);
        else dynamics(g, c, i0, i1);
      }
      b = e + 1;
    }
    return;
  }
  if (g.level === 0) return;
  computeTargets(g, c);
  if (g.needsSnap) {
    m.x.set(m.tx);
    m.y.set(m.ty);
    m.px.set(m.tx);
    m.py.set(m.ty);
    g.needsSnap = false;
    return;
  }
  m.px.set(m.x);
  m.py.set(m.y);
  if (g.level === 1) followTargets(g, c, m.activeStart, m.n);
  else dynamics(g, c, m.activeStart, m.n);
}

/** Évalue les positions (sans dynamique) pour l'affichage d'un groupe simulé à un niveau inférieur. */
export function evaluateNow(g: CrowdGroup, c: MotionCtx): void {
  if (g.phase === 'dispersed') return;
  computeTargets(g, c);
  const m = g.members;
  m.px.set(m.tx);
  m.py.set(m.ty);
  m.x.set(m.tx);
  m.y.set(m.ty);
}
