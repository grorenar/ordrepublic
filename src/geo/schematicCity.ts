import { LocalFrame, type LngLat, type Vec2 } from './mercator';

/**
 * Ville schématique procédurale et déterministe (mode démonstration sans service externe).
 * Géométrie en repère local (mètres) : la même source sert au dessin ET aux segments de rues
 * du jeu, donc les « rues bloquées » sont exactement posées sur les rues affichées.
 * Ce n'est PAS une carte réelle : elle ne représente aucune ville existante.
 */
export interface SchematicCity {
  seed: number;
  angle: number; // rotation de la trame (rad)
  bx: number; // pas des rues « verticales » (m)
  by: number;
  majorEvery: number;
  riverOffset: number;
  riverAmp: number;
  riverPhase: number;
}

export function hash2(seed: number, i: number, j: number): number {
  let h = (seed ^ Math.imul(i, 0x27d4eb2d) ^ Math.imul(j, 0x165667b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function seedFromCenter(c: LngLat): number {
  return (Math.round(c.lat * 1e4) * 73856093) ^ (Math.round(c.lng * 1e4) * 19349663);
}

export function makeSchematicCity(center: LngLat): SchematicCity {
  const seed = seedFromCenter(center) >>> 0;
  const r = (n: number) => hash2(seed, n, 99);
  return {
    seed,
    angle: ((r(1) - 0.5) * 24 * Math.PI) / 180,
    bx: 78 + r(2) * 30,
    by: 62 + r(3) * 26,
    majorEvery: 4,
    riverOffset: -(260 + r(4) * 380),
    riverAmp: 120 + r(5) * 140,
    riverPhase: r(6) * Math.PI * 2,
  };
}

export const MAJOR_WIDTH = 16;
export const MINOR_WIDTH = 9;
export const RIVER_WIDTH = 55;

export function streetWidth(city: SchematicCity, index: number): number {
  return index % city.majorEvery === 0 ? MAJOR_WIDTH : MINOR_WIDTH;
}

/** Conversions repère local ↔ trame de la ville (u, v). */
export function toGrid(city: SchematicCity, p: Vec2): Vec2 {
  const c = Math.cos(city.angle);
  const s = Math.sin(city.angle);
  return { x: p.x * c + p.y * s, y: -p.x * s + p.y * c };
}
export function fromGrid(city: SchematicCity, g: Vec2): Vec2 {
  const c = Math.cos(city.angle);
  const s = Math.sin(city.angle);
  return { x: g.x * c - g.y * s, y: g.x * s + g.y * c };
}

export function riverCenterY(city: SchematicCity, x: number): number {
  return city.riverOffset + city.riverAmp * Math.sin(x / 650 + city.riverPhase);
}

export type BlockKind = 'park' | 'plaza' | 'built';
export function blockKind(city: SchematicCity, k: number, l: number): BlockKind {
  const r = hash2(city.seed, k, l);
  if (r < 0.09) return 'park';
  if (r < 0.15) return 'plaza';
  return 'built';
}

/** Repère local associé à une origine (utilitaire commun au dessin et aux tests). */
export function frameFor(origin: LngLat): LocalFrame {
  return new LocalFrame(origin);
}

/** Emprise d'une rue pour la trame (rayon d'un demi-pas exclu) : bornes d'un bloc en coordonnées de trame. */
export interface BlockRect {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}
export function blockRect(city: SchematicCity, k: number, l: number): BlockRect {
  return {
    u0: k * city.bx + streetWidth(city, k) / 2,
    u1: (k + 1) * city.bx - streetWidth(city, k + 1) / 2,
    v0: l * city.by + streetWidth(city, l) / 2,
    v1: (l + 1) * city.by - streetWidth(city, l + 1) / 2,
  };
}

export interface BuildingQuad extends BlockRect {
  /** Hauteur/teinte pseudo-aléatoire stable (0..1). */
  h: number;
  index: number;
}

/** Quatre bâtiments par bloc « construit » (certains absents) — source unique pour le dessin et le graphe. */
export function buildingQuads(city: SchematicCity, k: number, l: number): BuildingQuad[] {
  if (blockKind(city, k, l) !== 'built') return [];
  const r = blockRect(city, k, l);
  const mu = (r.u0 + r.u1) / 2;
  const mv = (r.v0 + r.v1) / 2;
  const quads: Array<[number, number, number, number, number]> = [
    [r.u0 + 3, r.v0 + 3, mu - 2, mv - 2, 0],
    [mu + 2, r.v0 + 3, r.u1 - 3, mv - 2, 1],
    [r.u0 + 3, mv + 2, mu - 2, r.v1 - 3, 2],
    [mu + 2, mv + 2, r.u1 - 3, r.v1 - 3, 3],
  ];
  const out: BuildingQuad[] = [];
  for (const [u0, v0, u1, v1, n] of quads) {
    const h = hash2(city.seed, k * 4 + n, l * 4 + n + 7);
    if (h < 0.08) continue;
    out.push({ u0, v0, u1, v1, h, index: n });
  }
  return out;
}
