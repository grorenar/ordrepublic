import type { UnitStatus } from '../../engine/types';
import type { MarkerStyle } from './types';

/**
 * Marqueurs d'interface : primitives vectorielles, distinctes des sprites (lisibles à toute échelle, jamais remplacées
 * par une image). Table de correspondance états du moteur ↔ anneaux de la planche de référence (§18bis.2 n° 6 et 8).
 */
export const STATUS_MARKERS: Record<UnitStatus, MarkerStyle> = {
  idle: { color: '#f8fafc', width: 2, dash: null },
  moving: { color: '#4ade80', width: 2, dash: [6, 4] },
  waiting: { color: '#fbbf24', width: 2, dash: [3, 4] },
  engaged: { color: '#f87171', width: 2, dash: [6, 4] },
  in_difficulty: { color: '#f97316', width: 2, dash: [2, 3] },
  unavailable: { color: '#94a3b8', width: 2, dash: [2, 5] },
};

export const MARKERS = {
  selection: { color: '#22d3ee', width: 2.2, dash: [7, 5] },
  hover: { color: 'rgba(255,255,255,0.6)', width: 2.2, dash: [7, 5] },
  destination: { color: '#22d3ee', width: 2, dash: null },
  incident: { color: '#ff5a4d', width: 2.4, dash: [5, 3] },
  poi: { color: '#a78bfa', width: 1.8, dash: null },
  alert: { color: '#fbbf24', width: 2.4, dash: [4, 3] },
  influence: { color: 'rgba(250,204,21,0.55)', width: 1.6, dash: [10, 6] },
  zone: { color: '#38bdf8', width: 2.4, dash: [14, 8] },
  blockedStreet: { color: '#ff3b30', width: 3, dash: null },
  route: { color: '#60a5fa', width: 2.4, dash: [8, 6] },
} satisfies Record<string, MarkerStyle>;

export type MarkerName = keyof typeof MARKERS;

/** Anneau pointillé animé autour d'un point écran. */
export function ringMarker(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, style: MarkerStyle, t: number, motion: number): void {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.setLineDash(style.dash ?? []);
  ctx.lineDashOffset = -t * 18 * motion;
  ctx.lineWidth = style.width;
  ctx.strokeStyle = style.color;
  ctx.stroke();
  ctx.restore();
}

/** Anneau d'état d'une unité ; un triangle indique le cap quand elle se déplace (`heading` en rad, sens trigonométrique). */
export function statusMarker(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, style: MarkerStyle, t: number, motion: number, heading: number | null): void {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.setLineDash(style.dash ?? []);
  ctx.lineDashOffset = -t * 10 * motion;
  ctx.strokeStyle = style.color;
  ctx.lineWidth = style.width;
  ctx.stroke();
  if (heading !== null) {
    ctx.translate(x, y);
    ctx.rotate(-heading);
    ctx.setLineDash([]);
    ctx.fillStyle = style.color;
    ctx.beginPath();
    ctx.moveTo(r + 7, 0);
    ctx.lineTo(r - 1, -5);
    ctx.lineTo(r - 1, 5);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}
