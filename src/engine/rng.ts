/**
 * Aléa reproductible. Deux outils :
 *  - `Rng` : flux séquentiel à état sérialisable (décisions du scénario, partitions…).
 *  - `hash32` / `noise` : bruit STATELESS fonction de (graine, tick, canal) — indépendant de l'ordre
 *    d'appel, donc stable quel que soit le niveau de simulation ou l'ordre d'évaluation.
 * Le moteur n'utilise ni générateur aléatoire global ni horloge murale.
 */
export class Rng {
  constructor(public state: number) {
    this.state = state >>> 0;
  }
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  int(n: number): number {
    return Math.floor(this.next() * n);
  }
}

export function hash32(a: number, b: number): number {
  let h = (Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca77)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return (h ^ (h >>> 15)) >>> 0;
}

/** Bruit uniforme dans [-1, 1) pour (graine, pas de temps, canal). */
export function noise(seed: number, tick: number, channel = 0): number {
  return (hash32(hash32(seed, tick), channel) / 2147483648) - 1;
}

/** Flottant uniforme dans [0, 1) stable pour (graine, indice). */
export function unit(seed: number, i: number): number {
  return hash32(seed, i) / 4294967296;
}
