import type { StreetGraph } from '../nav/graph';
import { RouteCursor, locate, type CursorOut, type Located, type Route } from '../nav/route';
import type { EdgeState } from '../nav/streetState';
import type { WalkMask } from '../nav/walkMask';
import { profileFor, profileOfRoute } from './column';
import { lineClear, snapToWalkable } from './layout';
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
  /** État des rues (largeur praticable, corridor gauche/droite). */
  state: EdgeState;
  tick: number;
  tMs: number;
}

const loc: Located = { x: 0, y: 0, tx: 0, ty: 0, seg: 0 };
const cur: CursorOut = { x: 0, y: 0, nx: 0, ny: 1, edge: 0, dStart: 0, dEnd: 0 };

export function columnOffset(i: number, n: number, L: number): number {
  return ((i + 0.5) / n - 0.5) * L;
}

export interface RouteFrame {
  x: number;
  y: number;
  nx: number;
  ny: number;
  /** Décalage du centre du corridor (m, côté gauche) et demi-largeur du front à cet endroit. */
  c: number;
  hw: number;
}

/**
 * Repère au début (`atEnd=false`) ou à la fin (`atEnd=true`) d'une route : point, normale et demi-largeur de front.
 * Chaque individu quitte/rejoint la route avec SON décalage latéral : le raccord avec le créneau est continu.
 */
export function routeFrame(g: CrowdGroup, c: MotionCtx, route: Route, atEnd: boolean): RouteFrame {
  const cursor = new RouteCursor(route);
  const sAt = atEnd ? route.length : 0;
  cursor.at(sAt, cur);
  const prof = route === g.route ? profileFor(g, c.graph, c.state, c.params) : profileOfRoute(route, c.graph, c.state, c.params);
  const f = prof.frame(sAt);
  return { x: cur.x, y: cur.y, nx: cur.nx, ny: cur.ny, c: f.c, hw: f.hw };
}

/** Point d'entrée de l'individu `i` sur le tracé (début ou fin de route), avec son décalage latéral. */
export function frameEntry(f: RouteFrame, lat: number): { x: number; y: number } {
  return { x: f.x + f.nx * (f.c + lat * f.hw), y: f.y + f.ny * (f.c + lat * f.hw) };
}

function marchTargets(g: CrowdGroup, c: MotionCtx, from: number, to: number): void {
  const m = g.members;
  const route = g.route as NonNullable<CrowdGroup['route']>;
  const n = m.n;
  const len = route.length;
  const lay = g.layout;
  const end = lay ? routeFrame(g, c, route, true) : null;
  const cursor = new RouteCursor(route);
  const prof = profileFor(g, c.graph, c.state, c.params);
  // l'aire de la colonne entre la tête et l'individu i vaut (n − i − ½) / densité : chaque individu est placé là où l'espace
  // praticable LOCAL le permet (la queue garde sa largeur tant qu'elle n'est pas entrée dans la rue étroite)
  const aHead = prof.area(g.sCentre + g.columnLength / 2);
  const rho = g.density;
  for (let i = Math.max(from, m.activeStart); i < to; i++) {
    const s = prof.inverse(aHead - (n - i - 0.5) / rho);
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
    const off = prof.lateral(Math.max(0, Math.min(len, s)), m.lat[i] as number);
    const px = cur.x + cur.nx * off;
    const py = cur.y + cur.ny * off;
    if (!c.mask || !c.mask.isBlocked(px, py)) {
      m.tx[i] = px;
      m.ty[i] = py;
    } else {
      // la position visée tombe dans un bâtiment (coin de rue, donnée imparfaite) : on la ramène dans l'espace praticable
      const f = freePoint(c.mask, cur.x, cur.y, px, py);
      m.tx[i] = f.x;
      m.ty[i] = f.y;
    }
  }
}

/**
 * Point praticable le plus proche de la cible `(tx,ty)` en reculant vers le point de l'axe `(ax,ay)` : on s'arrête juste avant le
 * premier bâtiment rencontré. Si l'axe lui-même est dans un bâtiment (données incohérentes), recherche en spirale.
 */
function freePoint(mask: WalkMask, ax: number, ay: number, tx: number, ty: number): { x: number; y: number } {
  if (mask.isBlocked(ax, ay)) return snapToWalkable({ x: tx, y: ty }, mask);
  const d = Math.hypot(tx - ax, ty - ay);
  const steps = Math.max(1, Math.ceil(d / 0.5));
  let lx = ax;
  let ly = ay;
  for (let k = 1; k <= steps; k++) {
    const f = k / steps;
    const x = ax + (tx - ax) * f;
    const y = ay + (ty - ay) * f;
    if (mask.isBlocked(x, y)) break;
    lx = x;
    ly = y;
  }
  return { x: lx, y: ly };
}

/** Abscisse (sur la route du groupe) de l'individu `i` d'une colonne en marche : sert au choix des niveaux par bloc. */
export function columnS(g: CrowdGroup, c: MotionCtx, i: number): number {
  const prof = profileFor(g, c.graph, c.state, c.params);
  return prof.inverse(prof.area(g.sCentre + g.columnLength / 2) - (g.members.n - i - 0.5) / g.density);
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
  const dprof = profileOfRoute(d.route, c.graph, c.state, c.params);
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
      const off = dprof.lateral(s, m.lat[i] as number);
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

/** Point de l'AXE de la rue de l'individu `i` (toujours praticable) : étape de contournement quand un mur ou un coin bloque le chemin direct. */
function axisPoint(g: CrowdGroup, c: MotionCtx, i: number, out: { x: number; y: number }): boolean {
  if (!g.route || g.kind === 'static' || (g.phase !== 'moving' && g.phase !== 'waiting' && g.phase !== 'forming')) return false;
  const route = g.route;
  const prof = profileFor(g, c.graph, c.state, c.params);
  const s = prof.inverse(prof.area(g.sCentre + g.columnLength / 2) - (g.members.n - i - 0.5) / g.density);
  if (s >= route.length) return false;
  const cur2: CursorOut = { x: 0, y: 0, nx: 0, ny: 1, edge: 0, dStart: 0, dEnd: 0 };
  new RouteCursor(route).at(Math.max(0, s), cur2);
  out.x = cur2.x;
  out.y = cur2.y;
  return true;
}
const axisTmp = { x: 0, y: 0 };

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
    // un bâtiment se dresse entre l'individu et sa cible : il rejoint l'axe de la rue (praticable) avant de reprendre sa cible
    if (mask && d > 1.2 && !mask.isBlocked(cx, cy) && !lineClear(mask, cx, cy, (tx[i] as number) + ox, (ty[i] as number) + oy, 1.2) && axisPoint(g, c, i, axisTmp)) {
      const ax = axisTmp.x - cx;
      const ay = axisTmp.y - cy;
      const da = Math.hypot(ax, ay);
      if (da > 0.3) {
        const sa = Math.min(da, Math.min(k * da, vmax) * dt);
        const mx = cx + (ax / da) * sa;
        const my = cy + (ay / da) * sa;
        if (!mask.isBlocked(mx, my)) {
          x[i] = mx;
          y[i] = my;
          continue;
        }
      }
    }
    if (mask && mask.isBlocked(nx, ny)) {
      // un individu déjà DANS un bâtiment (placé là par une donnée imparfaite) en sort par l'axe de la rue (praticable), sinon vers sa cible
      if (mask.isBlocked(cx, cy)) {
        if (axisPoint(g, c, i, axisTmp)) {
          const ax = axisTmp.x - cx;
          const ay = axisTmp.y - cy;
          const da = Math.hypot(ax, ay) || 1;
          const sa = Math.min(da, vmax * dt);
          x[i] = cx + (ax / da) * sa;
          y[i] = cy + (ay / da) * sa;
        } else {
          x[i] = nx;
          y[i] = ny;
        }
        continue;
      }
      // chemin direct bloqué par un coin de bâtiment : on rejoint d'abord l'axe de la rue, puis la cible (contournement, pas de coin coupé)
      if (axisPoint(g, c, i, axisTmp)) {
        const ax = axisTmp.x - cx;
        const ay = axisTmp.y - cy;
        const da = Math.hypot(ax, ay);
        if (da > 0.3) {
          const sa = Math.min(da, vmax * dt);
          const mx = cx + (ax / da) * sa;
          const my = cy + (ay / da) * sa;
          if (!mask.isBlocked(mx, my)) {
            x[i] = mx;
            y[i] = my;
            continue;
          }
        }
      }
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
