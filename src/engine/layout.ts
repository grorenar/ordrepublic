import type { Vec2 } from '../geo/mercator';
import type { WalkMask } from '../nav/walkMask';
import { unit } from './rng';
import type { StaticLayout } from './types';

const GOLDEN_ANGLE = 2.399963229728653;

/** Si l'ancre est dans un bâtiment, la déplace vers la cellule libre la plus proche (≤ 80 m). */
export function snapToWalkable(anchor: Vec2, mask: WalkMask | null): Vec2 {
  if (!mask || !mask.isBlocked(anchor.x, anchor.y)) return { ...anchor };
  for (let r = 1; r <= 80; r += 1) {
    const steps = Math.max(8, Math.ceil(r * 2));
    for (let i = 0; i < steps; i++) {
      const th = (i / steps) * Math.PI * 2;
      const x = anchor.x + r * Math.cos(th);
      const y = anchor.y + r * Math.sin(th);
      if (!mask.isBlocked(x, y)) return { x, y };
    }
  }
  return { ...anchor };
}

export function createLayout(anchor: Vec2, density: number, seed: number): StaticLayout {
  return { anchor: { ...anchor }, k: 0, rot: unit(seed, 7) * Math.PI * 2, density, pts: new Float32Array(0), count: 0, rMax: 0, overflow: 0 };
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
