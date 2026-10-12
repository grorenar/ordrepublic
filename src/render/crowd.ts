import { mulberry32 } from '../state/rng';

/** Disposition fixe des individus d'un groupe (spirale de Vogel + bruit) : calculée une fois. */
export interface CrowdLayout {
  count: number;
  /** x, y relatifs au centre, en unités de rayon (0..1). */
  rx: Float32Array;
  ry: Float32Array;
  phase: Float32Array;
  speed: Float32Array;
  /** Tirage uniforme par individu : sert à choisir la teinte selon la tension. */
  tone: Float32Array;
}

const GOLDEN = 2.399963229728653;

export function buildCrowdLayout(count: number, seed: number): CrowdLayout {
  const rng = mulberry32(seed * 7919 + count);
  const rx = new Float32Array(count);
  const ry = new Float32Array(count);
  const phase = new Float32Array(count);
  const speed = new Float32Array(count);
  const tone = new Float32Array(count);
  const rot = rng() * Math.PI * 2;
  for (let i = 0; i < count; i++) {
    const r = Math.sqrt((i + 0.5) / count);
    const a = i * GOLDEN + rot;
    rx[i] = r * Math.cos(a) + (rng() - 0.5) * 0.09;
    ry[i] = r * Math.sin(a) * 0.82 + (rng() - 0.5) * 0.09; // légèrement aplati : foule en cortège
    phase[i] = rng() * Math.PI * 2;
    speed[i] = 0.6 + rng() * 1.1;
    tone[i] = rng();
  }
  return { count, rx, ry, phase, speed, tone };
}

/** Répartition des teintes (blanc / ambre / rouge) selon la tension 0..100 d'un groupe. */
export function toneThresholds(tension: number): { red: number; amber: number } {
  const red = Math.max(0, Math.min(1, (tension - 45) / 70));
  const amber = Math.max(0, Math.min(1, (tension - 15) / 60));
  return { red, amber: Math.min(1 - red, amber) };
}
