/**
 * Cycle jour/nuit du jeu. Les heures de lever et de coucher du soleil sont des valeurs de gameplay (automne en France, ordre de
 * grandeur) : elles ne dépendent pas de la ville ni de la date réelle.
 */
export interface Daylight {
  sunriseSec: number;
  sunsetSec: number;
  /** Durée du crépuscule (aube/dusk) en secondes. */
  twilightSec: number;
}

export const AUTUMN_DAYLIGHT: Daylight = { sunriseSec: 7 * 3600 + 50 * 60, sunsetSec: 18 * 3600 + 30 * 60, twilightSec: 45 * 60 };

const smooth = (x: number) => {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
};

/** Obscurité 0 (plein jour) → 1 (nuit noire), progressive pendant le crépuscule. */
export function darkness(clockSec: number, d: Daylight = AUTUMN_DAYLIGHT): number {
  const t = ((clockSec % 86400) + 86400) % 86400;
  const dusk = smooth((t - d.sunsetSec) / d.twilightSec); // 0 au coucher → 1 après le crépuscule
  const dawn = 1 - smooth((t - (d.sunriseSec - d.twilightSec)) / d.twilightSec); // 1 avant l'aube → 0 au lever
  if (t >= d.sunsetSec) return dusk;
  if (t <= d.sunriseSec) return Math.max(dawn, 0);
  return 0;
}

export function dayPart(clockSec: number, d: Daylight = AUTUMN_DAYLIGHT): 'jour' | 'crépuscule' | 'nuit' {
  const k = darkness(clockSec, d);
  return k < 0.05 ? 'jour' : k > 0.9 ? 'nuit' : 'crépuscule';
}

/** « HH:MM:SS » (heure du jour, 24 h). */
export function clockText(clockSec: number): string {
  const t = Math.floor(((clockSec % 86400) + 86400) % 86400);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(Math.floor(t / 3600))}:${p(Math.floor((t % 3600) / 60))}:${p(t % 60)}`;
}
