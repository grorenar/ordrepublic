import type { Vec2 } from '../geo/mercator';
import { EdgeClass, EdgeFlag, edgePoints, type StreetGraph } from '../nav/graph';
import type { EdgeState } from '../nav/streetState';
import type { WalkMask } from '../nav/walkMask';
import { hash32, unit } from './rng';
import type { SimParams } from './params';
import type { Cause, DecorItem, DecorKind, DecorState, Id, Poi } from './types';

const worldCause = (note: string): Cause => ({ kind: 'rule', refId: 'monde', note });

/** Point et tangente à l'abscisse curvilignes `s` d'une polyligne. */
function pointAlong(pts: Vec2[], s: number): { x: number; y: number; tx: number; ty: number } {
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1] as Vec2;
    const b = pts[i] as Vec2;
    const l = Math.hypot(b.x - a.x, b.y - a.y);
    if (acc + l >= s || i === pts.length - 1) {
      const k = l > 0 ? Math.max(0, Math.min(1, (s - acc) / l)) : 0;
      return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, tx: l > 0 ? (b.x - a.x) / l : 1, ty: l > 0 ? (b.y - a.y) / l : 0 };
    }
    acc += l;
  }
  const p = pts[0] as Vec2;
  return { x: p.x, y: p.y, tx: 1, ty: 0 };
}

function inRing(ring: Float32Array, x: number, y: number): boolean {
  let inside = false;
  const n = ring.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = ring[2 * i] as number;
    const yi = ring[2 * i + 1] as number;
    const xj = ring[2 * j] as number;
    const yj = ring[2 * j + 1] as number;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const CELL = 20;
const key = (cx: number, cy: number) => cx * 73856093 ^ cy * 19349663;

/** Décor et lieux d'intérêt du monde : générés une fois, de façon déterministe, puis modifiés seulement par les incidents et le scénario. */
export class World {
  readonly pois: Poi[] = [];
  readonly decor: DecorItem[] = [];
  private readonly poiById = new Map<Id, Poi>();
  private readonly decorById = new Map<Id, DecorItem>();
  private grid = new Map<number, DecorItem[]>();
  private gridDirty = true;
  private decorCounter = 0;
  private poiCounter = 0;
  /** Objets posés par une fermeture de rue : arête → identifiants. */
  private readonly barriers = new Map<number, Id[]>();

  poi(id: Id): Poi | undefined {
    return this.poiById.get(id);
  }

  item(id: Id): DecorItem | undefined {
    return this.decorById.get(id);
  }

  addPoi(p: Omit<Poi, 'id' | 'damage' | 'state' | 'decorIds' | 'incidentIds'>): Poi {
    const poi: Poi = { ...p, id: `P-${String(++this.poiCounter).padStart(4, '0')}`, damage: 0, state: 'intact', decorIds: [], incidentIds: [] };
    this.pois.push(poi);
    this.poiById.set(poi.id, poi);
    return poi;
  }

  addDecor(d: Omit<DecorItem, 'id' | 'state'> & { state?: DecorState }): DecorItem {
    const item: DecorItem = { state: 'intact', ...d, id: `D-${String(++this.decorCounter).padStart(4, '0')}` };
    this.decor.push(item);
    this.decorById.set(item.id, item);
    if (item.poiId) this.poiById.get(item.poiId)?.decorIds.push(item.id);
    this.gridDirty = true;
    return item;
  }

  removeDecor(id: Id): void {
    const i = this.decor.findIndex((d) => d.id === id);
    if (i >= 0) this.decor.splice(i, 1);
    this.decorById.delete(id);
    this.gridDirty = true;
  }

  private reindex(): void {
    this.grid = new Map();
    for (const d of this.decor) {
      const k = key(Math.floor(d.x / CELL), Math.floor(d.y / CELL));
      const arr = this.grid.get(k);
      if (arr) arr.push(d);
      else this.grid.set(k, [d]);
    }
    this.gridDirty = false;
  }

  /** Objets de décor à moins de `r` mètres de (x, y). */
  near(x: number, y: number, r: number, cb: (d: DecorItem) => void): void {
    if (this.gridDirty) this.reindex();
    const c0x = Math.floor((x - r) / CELL);
    const c1x = Math.floor((x + r) / CELL);
    const c0y = Math.floor((y - r) / CELL);
    const c1y = Math.floor((y + r) / CELL);
    for (let cx = c0x; cx <= c1x; cx++)
      for (let cy = c0y; cy <= c1y; cy++) {
        const arr = this.grid.get(key(cx, cy));
        if (!arr) continue;
        for (const d of arr) if (Math.hypot(d.x - x, d.y - y) <= r) cb(d);
      }
  }

  /** Barrières et cônes en travers d'une rue fermée par le scénario (aux deux extrémités de l'arête). */
  placeBarriers(g: StreetGraph, e: number, widthM: number, cause: Cause): number {
    if (this.barriers.has(e)) return 0;
    const pts = edgePoints(g, e);
    const len = g.edgeLen[e] as number;
    const ids: Id[] = [];
    for (const s of [Math.min(3, len / 3), Math.max(len - 3, (len * 2) / 3)]) {
      const p = pointAlong(pts, s);
      const heading = Math.atan2(p.tx, -p.ty); // barrière perpendiculaire à la rue
      const n = Math.max(1, Math.min(4, Math.round(widthM / 2.4)));
      for (let k = 0; k < n; k++) {
        const lat = (k - (n - 1) / 2) * 2.4;
        const b = this.addDecor({ kind: 'barrier', x: p.x - p.ty * lat, y: p.y + p.tx * lat, heading, source: 'synthetic', cause });
        ids.push(b.id);
      }
      const cone = this.addDecor({ kind: 'cone', x: p.x + p.tx * 2.5 * (s < len / 2 ? 1 : -1), y: p.y + p.ty * 2.5 * (s < len / 2 ? 1 : -1), heading: 0, source: 'synthetic', cause });
      ids.push(cone.id);
    }
    this.barriers.set(e, ids);
    return ids.length;
  }

  removeBarriers(e: number): number {
    const ids = this.barriers.get(e);
    if (!ids) return 0;
    for (const id of ids) this.removeDecor(id);
    this.barriers.delete(e);
    return ids.length;
  }
}

const SLOT_CLASSES = new Set<number>([EdgeClass.Primary, EdgeClass.Secondary, EdgeClass.Tertiary, EdgeClass.Unclassified, EdgeClass.Residential, EdgeClass.LivingStreet, EdgeClass.Pedestrian, EdgeClass.Service]);

/**
 * Génère le monde : lieux d'intérêt OSM (affichage), décor synthétique déterministe le long des rues, mobilier OSM,
 * commerces FICTIFS (seules cibles de vitrines brisées). Aucune donnée OSM ne sert à désigner une cible (cahier §16.4).
 */
export function buildWorld(g: StreetGraph, state: EdgeState, mask: WalkMask | null, params: SimParams, seed: number): World {
  const w = new World();
  const wp = params.world;
  const gen = worldCause('décor généré de façon déterministe le long des rues (monde synthétique)');
  const osmCause = worldCause('objet cartographié dans OpenStreetMap');

  // --- lieux d'intérêt OSM (jamais ciblés) et mobilier OSM
  const commerce: Vec2[] = [];
  for (const p of g.pois) {
    if (p.kind === 'furniture') {
      w.addDecor({ kind: p.category === 'bench' ? 'bench' : 'bin', x: p.x, y: p.y, heading: 0, source: 'osm', cause: osmCause });
      continue;
    }
    w.addPoi({ kind: p.kind, category: p.category, name: p.name, x: p.x, y: p.y, radius: 12, source: p.source, osmId: p.osmId, fictional: false });
    if (p.kind === 'commerce') commerce.push({ x: p.x, y: p.y });
  }
  // espaces de rassemblement (places, parcs)
  for (const sp of g.spaces) {
    let cx = 0;
    let cy = 0;
    let area = 0;
    const n = sp.ring.length / 2;
    for (let i = 0; i < n; i++) {
      const x0 = sp.ring[2 * i] as number;
      const y0 = sp.ring[2 * i + 1] as number;
      const x1 = sp.ring[2 * ((i + 1) % n)] as number;
      const y1 = sp.ring[2 * ((i + 1) % n) + 1] as number;
      area += x0 * y1 - x1 * y0;
      cx += x0;
      cy += y0;
    }
    area = Math.abs(area) / 2;
    w.addPoi({ kind: 'gathering', category: sp.kind, name: sp.name, x: cx / n, y: cy / n, radius: Math.sqrt(area / Math.PI), source: sp.source, osmId: sp.osmId, fictional: false });
  }

  // --- rue commerçante : seule information tirée d'OSM sur les commerces
  const cgrid = new Map<number, number>();
  for (const c of commerce) {
    const k = key(Math.floor(c.x / wp.commercialRadiusM), Math.floor(c.y / wp.commercialRadiusM));
    cgrid.set(k, (cgrid.get(k) ?? 0) + 1);
  }
  const commercialAt = (x: number, y: number): boolean => {
    if (commerce.length === 0) return false;
    const cx = Math.floor(x / wp.commercialRadiusM);
    const cy = Math.floor(y / wp.commercialRadiusM);
    let n = 0;
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) n += cgrid.get(key(cx + a, cy + b)) ?? 0;
    return n >= wp.commercialShopCount;
  };

  // --- décor synthétique le long des rues
  let shopNo = 0;
  const free = (x: number, y: number) => !mask || !mask.isBlocked(x, y);
  const place = (e: number, kindIdx: number, spacing: number, kind: DecorKind, sidePolicy: 'any' | 'facade', classes: ReadonlySet<number>, minWidth: number) => {
    if (w.decor.length >= wp.maxDecor) return;
    const cls = g.edgeClass[e] as number;
    const f = g.edgeFlags[e] as number;
    if (!classes.has(cls) || f & (EdgeFlag.Tunnel | EdgeFlag.Bridge)) return;
    const len = g.edgeLen[e] as number;
    if (len < 18) return;
    const pts = edgePoints(g, e);
    const s0 = unit(hash32(seed, e * 7 + kindIdx), 1) * spacing;
    for (let s = s0 + 6, k = 0; s < len - 6; s += spacing * (0.8 + 0.4 * unit(hash32(seed, e * 131 + k), kindIdx)), k++) {
      if (w.decor.length >= wp.maxDecor) return;
      const p = pointAlong(pts, s);
      const side = unit(hash32(seed, e * 977 + k * 13 + kindIdx), 3) < 0.5 ? 1 : -1; // +1 : côté gauche
      const half = side > 0 ? (state.walkLeft[e] as number) : (state.walkRight[e] as number);
      if (half < wp.minOffsetM + 0.8 || half + (side > 0 ? (state.walkRight[e] as number) : (state.walkLeft[e] as number)) < minWidth) continue;
      let off: number;
      if (sidePolicy === 'facade') off = Math.min(half - 0.35, 12);
      else off = Math.max(wp.minOffsetM, Math.min(half - 0.7, kind === 'bus_shelter' ? (g.edgeWidth[e] as number) / 2 + 1.2 : 5));
      if (off < wp.minOffsetM) continue;
      const x = p.x - p.ty * off * side;
      const y = p.y + p.tx * off * side;
      if (sidePolicy !== 'facade' && !free(x, y)) continue;
      if (sidePolicy === 'facade' && mask && !mask.isBlocked(x - p.ty * 1.4 * side, y + p.tx * 1.4 * side)) continue; // pas de façade : pas de vitrine
      const heading = Math.atan2(p.ty, p.tx);
      if (kind === 'shopfront') {
        const commercial = commercialAt(x, y);
        // dans une rue ordinaire, on n'en garde qu'une partie (l'espacement de base est plus grand)
        const poi = w.addPoi({
          kind: 'commerce',
          category: 'boutique',
          name: `Commerce fictif n° ${++shopNo}`,
          x,
          y,
          radius: 8,
          source: 'synthetic',
          fictional: true,
          streetCategory: commercial ? 'rue commerçante (d’après la densité de commerces OSM)' : 'rue ordinaire',
        });
        w.addDecor({ kind, x, y, heading, source: 'synthetic', poiId: poi.id, cause: gen });
      } else w.addDecor({ kind, x, y, heading, source: 'synthetic', cause: gen });
    }
  };
  const ordinary = new Set<number>([EdgeClass.Secondary, EdgeClass.Tertiary, EdgeClass.Unclassified, EdgeClass.Residential, EdgeClass.LivingStreet, EdgeClass.Pedestrian]);
  const wide = new Set<number>([EdgeClass.Primary, EdgeClass.Secondary, EdgeClass.Tertiary]);
  const small = new Set<number>([EdgeClass.Residential, EdgeClass.Service, EdgeClass.Unclassified, EdgeClass.LivingStreet]);
  for (let e = 0; e < g.edgeCount; e++) {
    const mid = pointAlong(edgePoints(g, e), (g.edgeLen[e] as number) / 2);
    const spacingShop = commercialAt(mid.x, mid.y) ? wp.shopSpacingCommercialM : wp.shopSpacingM;
    place(e, 1, wp.binSpacingM, 'bin', 'any', SLOT_CLASSES, 3);
    place(e, 2, wp.benchSpacingM, 'bench', 'any', ordinary, 6);
    place(e, 3, wp.shelterSpacingM, 'bus_shelter', 'any', wide, 7);
    place(e, 4, wp.containerSpacingM, 'container', 'facade', small, 4);
    place(e, 5, spacingShop, 'shopfront', 'facade', ordinary, 4);
  }
  // mobilier dans les places et parcs
  for (const [si, sp] of g.spaces.entries()) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < sp.ring.length; i += 2) {
      minX = Math.min(minX, sp.ring[i] as number);
      maxX = Math.max(maxX, sp.ring[i] as number);
      minY = Math.min(minY, sp.ring[i + 1] as number);
      maxY = Math.max(maxY, sp.ring[i + 1] as number);
    }
    const area = (maxX - minX) * (maxY - minY);
    const n = Math.max(1, Math.min(10, Math.round(area / 900)));
    for (let k = 0, tries = 0; k < n && tries < n * 40; tries++) {
      const x = minX + unit(hash32(seed, si * 997 + tries), 11) * (maxX - minX);
      const y = minY + unit(hash32(seed, si * 997 + tries), 12) * (maxY - minY);
      if (!inRing(sp.ring, x, y) || !free(x, y) || w.decor.length >= wp.maxDecor) continue;
      w.addDecor({ kind: k % 3 === 2 ? 'bin' : 'bench', x, y, heading: unit(hash32(seed, si * 31 + tries), 13) * Math.PI * 2, source: 'synthetic', cause: gen });
      k++;
    }
  }
  return w;
}
