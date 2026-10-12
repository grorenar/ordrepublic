import { hash32, unit } from './rng';
import type { MemberSet } from './types';

/** Crée `n` individus (tableaux typés). Positions à initialiser par l'appelant. */
export function createMembers(n: number, seed: number, subgroupSize: number): MemberSet {
  const m: MemberSet = {
    n,
    subgroupSize,
    x: new Float32Array(n),
    y: new Float32Array(n),
    px: new Float32Array(n),
    py: new Float32Array(n),
    tx: new Float32Array(n),
    ty: new Float32Array(n),
    lat: new Float32Array(n),
    seed: new Uint32Array(n),
    role: new Uint8Array(n),
    slotOf: new Uint32Array(n),
    activeStart: 0,
  };
  const off = unit(seed, 31);
  for (let i = 0; i < n; i++) {
    m.seed[i] = hash32(seed, i + 1);
    // suite à faible discrépance + petit bruit : répartition latérale régulière et stable
    const g = (i * 0.6180339887498949 + off) % 1;
    m.lat[i] = Math.max(-1, Math.min(1, (g * 2 - 1) * 0.92 + (unit(seed, i + 5) - 0.5) * 0.1));
    m.slotOf[i] = i;
  }
  return m;
}

/** Octets utilisés par les tableaux d'un MemberSet (hors objet JS). */
export function memberBytes(m: MemberSet): number {
  return m.x.byteLength * 6 + m.lat.byteLength + m.seed.byteLength + m.role.byteLength + m.slotOf.byteLength;
}

/** Copie les individus [from, to) dans un nouveau MemberSet (positions et graines conservées). */
export function sliceMembers(m: MemberSet, from: number, to: number): MemberSet {
  const n = Math.max(0, to - from);
  const out: MemberSet = {
    n,
    subgroupSize: m.subgroupSize,
    x: m.x.slice(from, to),
    y: m.y.slice(from, to),
    px: m.px.slice(from, to),
    py: m.py.slice(from, to),
    tx: new Float32Array(n),
    ty: new Float32Array(n),
    lat: m.lat.slice(from, to),
    seed: m.seed.slice(from, to),
    role: m.role.slice(from, to),
    slotOf: new Uint32Array(n),
    activeStart: 0,
  };
  for (let i = 0; i < n; i++) out.slotOf[i] = i;
  return out;
}

/** Concatène deux ensembles d'individus (a puis b). Les créneaux sont réinitialisés à l'identité. */
export function concatMembers(a: MemberSet, b: MemberSet): MemberSet {
  const n = a.n + b.n;
  const cat = <T extends Float32Array | Uint32Array | Uint8Array>(x: T, y: T): T => {
    const out = new (x.constructor as new (len: number) => T)(n);
    out.set(x, 0);
    out.set(y, a.n);
    return out;
  };
  const out: MemberSet = {
    n,
    subgroupSize: a.subgroupSize,
    x: cat(a.x, b.x),
    y: cat(a.y, b.y),
    px: cat(a.px, b.px),
    py: cat(a.py, b.py),
    tx: new Float32Array(n),
    ty: new Float32Array(n),
    lat: cat(a.lat, b.lat),
    seed: cat(a.seed, b.seed),
    role: cat(a.role, b.role),
    slotOf: new Uint32Array(n),
    activeStart: 0,
  };
  for (let i = 0; i < n; i++) out.slotOf[i] = i;
  return out;
}
