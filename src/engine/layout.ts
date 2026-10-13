import type { Vec2 } from '../geo/mercator';
import type { WalkMask } from '../nav/walkMask';
import { unit } from './rng';
import { MinHeap } from '../nav/heap';
import type { StaticLayout } from './types';

const GOLDEN_ANGLE = 2.399963229728653;

/** Si l'ancre est dans un bâtiment, la déplace vers la cellule libre la plus proche (≤ 80 m). */
export function snapToWalkable(anchor: Vec2, mask: WalkMask | null): Vec2 {
  if (!mask || mask.isWalkable(anchor.x, anchor.y)) return { ...anchor };
  for (let r = 1; r <= 80; r += 1) {
    const steps = Math.max(8, Math.ceil(r * 2));
    for (let i = 0; i < steps; i++) {
      const th = (i / steps) * Math.PI * 2;
      const x = anchor.x + r * Math.cos(th);
      const y = anchor.y + r * Math.sin(th);
      if (mask.isWalkable(x, y)) return { x, y };
    }
  }
  return { ...anchor };
}

export function createLayout(anchor: Vec2, density: number, seed: number, fill?: StaticLayout['fill']): StaticLayout {
  return { anchor: { ...anchor }, k: 0, rot: unit(seed, 7) * Math.PI * 2, density, pts: new Float32Array(0), count: 0, rMax: 0, overflow: 0, ...(fill ? { fill } : {}) };
}

/** Vrai si le segment [a,b] ne traverse aucun bâtiment (échantillonnage tous les `step` mètres). */
export function lineClear(mask: WalkMask, ax: number, ay: number, bx: number, by: number, step = 1.5): boolean {
  const len = Math.hypot(bx - ax, by - ay);
  const n = Math.max(1, Math.ceil(len / step));
  for (let i = 1; i <= n; i++) {
    const f = i / n;
    if (mask.isBlocked(ax + (bx - ax) * f, ay + (by - ay) * f)) return false;
  }
  return true;
}

/**
 * Étend la disposition statique jusqu'à `count` créneaux. Spirale de Vogel autour de l'ancre, rayon
 * `r_k = sqrt((k+½)/(π·ρ))` (surface par personne constante) : la disposition de n personnes est un
 * PRÉFIXE de celle de n+k, donc ajouter des personnes ne déplace pas les autres. Un candidat est
 * accepté s'il n'est pas dans un bâtiment ET visible en ligne droite depuis l'ancre (un individu qui part
 * de l'ancre peut donc rejoindre son créneau sans traverser de bâtiment).
 * Au-delà du rayon maximal, la densité effective augmente (compteur `overflow`).
 */
export function extendLayout(layout: StaticLayout, count: number, mask: WalkMask | null, maxRadius: number, seed: number): void {
  if (layout.count >= count) return;
  if (mask && mask.hasWalkable) {
    extendGeodesic(layout, count, mask, maxRadius, seed);
    return;
  }
  const cap = Math.max(count, layout.count);
  const pts = new Float32Array(cap * 2);
  pts.set(layout.pts.subarray(0, layout.count * 2));
  let n = layout.count;
  const { anchor, density } = layout;
  // garde-fou : une ancre enfermée ne doit pas faire explorer indéfiniment la spirale
  const budget = 60 * (count - layout.count) + 20000;
  let attempts = 0;
  while (n < count) {
    const k = layout.k++;
    const r = Math.sqrt((k + 0.5) / (Math.PI * density));
    if (r > maxRadius || attempts > budget) {
      // débordement : on réutilise des créneaux existants avec un léger décalage (densité accrue)
      const base = n > 0 ? n % Math.max(1, layout.count || n) : 0;
      const bx = n > 0 ? (pts[2 * base] as number) : anchor.x;
      const by = n > 0 ? (pts[2 * base + 1] as number) : anchor.y;
      pts[2 * n] = bx + (unit(seed, k) - 0.5) * 0.8;
      pts[2 * n + 1] = by + (unit(seed, k + 99991) - 0.5) * 0.8;
      layout.overflow++;
      n++;
      continue;
    }
    const th = k * GOLDEN_ANGLE + layout.rot;
    let x = anchor.x + r * Math.cos(th);
    let y = anchor.y + r * Math.sin(th);
    if (mask) {
      if (mask.isBlocked(x, y) || !lineClear(mask, anchor.x, anchor.y, x, y)) {
        attempts++;
        continue;
      }
      const jx = x + (unit(seed, k) - 0.5) * 0.5;
      const jy = y + (unit(seed, k + 7777) - 0.5) * 0.5;
      if (!mask.isBlocked(jx, jy)) {
        x = jx;
        y = jy;
      }
    }
    pts[2 * n] = x;
    pts[2 * n + 1] = y;
    layout.rMax = Math.max(layout.rMax, r);
    n++;
  }
  layout.pts = pts;
  layout.count = n;
}

/**
 * Remplissage par distance de MARCHE depuis l'ancre (Dijkstra sur les cellules praticables du masque) : la foule se tasse d'abord autour de
 * l'ancre, puis occupe les rues et places voisines en contournant les bâtiments — jamais en anneau autour d'un immeuble ni à travers lui.
 * Les cellules sont consommées dans un ordre stable : la disposition de n personnes est un PRÉFIXE de celle de n+k (ajouter du monde ne
 * déplace personne). Chaque cellule reçoit `densité × aire` personnes, positionnées avec un léger décalage reproductible.
 */
function extendGeodesic(layout: StaticLayout, count: number, mask: WalkMask, maxRadius: number, seed: number): void {
  const res = mask.res;
  const cap = Math.max(count, layout.count);
  const pts = new Float32Array(cap * 2);
  pts.set(layout.pts.subarray(0, layout.count * 2));
  let n = layout.count;
  const { anchor, density, fill } = layout;
  const cols = mask.cols;
  const cellOf = (x: number, y: number) => Math.floor((y - mask.minY) / res) * cols + Math.floor((x - mask.minX) / res);
  if (!layout.geo) {
    const heap = new MinHeap();
    const seen = new Set<number>();
    const id0 = cellOf(anchor.x, anchor.y);
    heap.push(0, id0);
    seen.add(id0);
    layout.geo = { heap, seen, carry: 0.5, cells: 0 };
  }
  const geo = layout.geo;
  const perCell = density * res * res;
  const NB: Array<[number, number, number]> = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.4142], [1, -1, 1.4142], [-1, 1, 1.4142], [-1, -1, 1.4142]];
  while (n < count && geo.heap.size > 0) {
    const id = geo.heap.pop();
    const d = geo.heap.lastKey;
    if (d > maxRadius) {
      geo.heap.clear();
      break;
    }
    const r = Math.floor(id / cols);
    const c = id - r * cols;
    const cx = mask.minX + (c + 0.5) * res;
    const cy = mask.minY + (r + 0.5) * res;
    geo.cells++;
    geo.carry += perCell;
    while (geo.carry >= 1 && n < count) {
      geo.carry -= 1;
      const k = n;
      pts[2 * n] = cx + (unit(seed, id * 7 + k) - 0.5) * res * 0.9;
      pts[2 * n + 1] = cy + (unit(seed, id * 13 + k + 5) - 0.5) * res * 0.9;
      layout.rMax = Math.max(layout.rMax, Math.hypot(cx - anchor.x, cy - anchor.y));
      n++;
    }
    for (const [dc, dr, w] of NB) {
      const nc = c + dc;
      const nr = r + dr;
      if (nc < 0 || nr < 0 || nc >= cols || nr >= mask.rows) continue;
      const nid = nr * cols + nc;
      if (geo.seen.has(nid)) continue;
      if (!mask.isWalkable(mask.minX + (nc + 0.5) * res, mask.minY + (nr + 0.5) * res)) continue;
      // les diagonales ne coupent pas un coin de bâtiment
      if (dc !== 0 && dr !== 0 && (!mask.isWalkable(cx + dc * res, cy) || !mask.isWalkable(cx, cy + dr * res))) continue;
      geo.seen.add(nid);
      // un espace ouvert (place, parc) « coûte » moins cher : le rassemblement l'occupe avant de déborder dans les rues voisines ;
      // les cellules à l'opposé du sens de départ coûtent plus cher : la foule s'étire dans le sens de la marche
      let k = 1;
      const nx = mask.minX + (nc + 0.5) * res;
      const ny = mask.minY + (nr + 0.5) * res;
      if (fill && mask.isOpen(nx, ny)) k = fill.openCost;
      if (fill?.dir && fill.behindPenalty > 0) {
        const vx = nx - anchor.x;
        const vy = ny - anchor.y;
        const vl = Math.hypot(vx, vy);
        if (vl > 1) k *= 1 + fill.behindPenalty * Math.max(0, -(vx * fill.dir.x + vy * fill.dir.y) / vl);
      }
      geo.heap.push(d + w * res * k, nid);
    }
  }
  // espace praticable épuisé (ancre enfermée, rayon maximal) : débordement — créneaux réutilisés avec un léger décalage (densité accrue)
  while (n < count) {
    const base = n > 0 ? n % Math.max(1, layout.count || n) : 0;
    const bx = n > 0 ? (pts[2 * base] as number) : anchor.x;
    const by = n > 0 ? (pts[2 * base + 1] as number) : anchor.y;
    pts[2 * n] = bx + (unit(seed, n) - 0.5) * 0.8;
    pts[2 * n + 1] = by + (unit(seed, n + 99991) - 0.5) * 0.8;
    layout.overflow++;
    n++;
  }
  layout.pts = pts;
  layout.count = n;
}
