import type { StreetGraph } from '../nav/graph';
import { edgeIndexAt, locate, type Located, type Route } from '../nav/route';
import type { EdgeState } from '../nav/streetState';
import type { SimParams } from './params';

const STEP_M = 2;
const BLEND_M = 8;
const loc: Located = { x: 0, y: 0, tx: 0, ty: 0, seg: 0 };

/**
 * Profil d'une colonne le long de sa route : pour chaque abscisse, l'espace praticable (centre et demi-largeur du corridor, côté
 * gauche/droite de la marche) et la largeur de front qu'un cortège y occupe. Chaque individu est placé selon l'espace LOCAL de sa
 * propre position — la queue garde sa largeur tant qu'elle n'est pas entrée dans la rue étroite que la tête traverse.
 *
 * Conservation des personnes : l'AIRE de la colonne entre deux individus vaut (nombre de personnes entre eux) / densité. Où la rue se
 * rétrécit, la colonne s'allonge (peu de monde par mètre) ; où elle s'élargit, elle se raccourcit et s'étale.
 */
export class ColumnProfile {
  private readonly nodes: number;
  /** Centre du corridor (m) du côté gauche de la marche, et demi-largeur, à chaque nœud (déjà lissés aux jonctions). */
  private readonly centre: Float32Array;
  private readonly half: Float32Array;
  private readonly limit: Float32Array;
  private readonly front: Float64Array;
  /** Poids (largeur × densité relative) : une foule qui s'étale en largeur se relâche (moins de monde par m²) sans changer de longueur. */
  private readonly wgt: Float64Array;
  private readonly cum: Float64Array;
  private cap = -1;

  constructor(
    readonly route: Route,
    graph: StreetGraph,
    state: Pick<EdgeState, 'walkLeft' | 'walkRight'>,
    private readonly p: Pick<SimParams, 'marchFrontWidthMaxM' | 'openSpaceWidthM' | 'openSpaceFrontMaxM' | 'streetMarginM' | 'marchDensity' | 'marchDensityMin'>,
  ) {
    this.nodes = Math.max(2, Math.ceil(route.length / STEP_M) + 1);
    const K = this.nodes;
    this.centre = new Float32Array(K);
    this.half = new Float32Array(K);
    this.limit = new Float32Array(K);
    this.front = new Float64Array(K);
    this.wgt = new Float64Array(K);
    this.cum = new Float64Array(K);
    // corridor de chaque arête de la route, dans l'orientation de la marche
    const ne = route.edges.length;
    const ec = new Float32Array(ne);
    const eh = new Float32Array(ne);
    for (let i = 0; i < ne; i++) {
      const e = route.edges[i] as number;
      const a = (route.edgeStart[i] as number) + 0.25 * ((route.edgeStart[i + 1] as number) - (route.edgeStart[i] as number));
      locate(route, a, loc);
      const dx = (graph.nodeX[graph.edgeB[e] as number] as number) - (graph.nodeX[graph.edgeA[e] as number] as number);
      const dy = (graph.nodeY[graph.edgeB[e] as number] as number) - (graph.nodeY[graph.edgeA[e] as number] as number);
      const forward = loc.tx * dx + loc.ty * dy >= 0;
      const l = (forward ? state.walkLeft[e] : state.walkRight[e]) as number;
      const r = (forward ? state.walkRight[e] : state.walkLeft[e]) as number;
      ec[i] = (l - r) / 2;
      eh[i] = (l + r) / 2;
    }
    for (let k = 0; k < K; k++) {
      const s = Math.min(route.length, k * STEP_M);
      const i = Math.min(ne - 1, edgeIndexAt(route, s));
      const dS = s - (route.edgeStart[i] as number);
      const dE = (route.edgeStart[i + 1] as number) - s;
      let c = ec[i] as number;
      let h = eh[i] as number;
      if (dS < BLEND_M && i > 0) {
        const w = 0.5 + (0.5 * dS) / BLEND_M;
        c = (ec[i - 1] as number) + (c - (ec[i - 1] as number)) * w;
        h = (eh[i - 1] as number) + (h - (eh[i - 1] as number)) * w;
      } else if (dE < BLEND_M && i < ne - 1) {
        const w = 0.5 + (0.5 * dE) / BLEND_M;
        c = (ec[i + 1] as number) + (c - (ec[i + 1] as number)) * w;
        h = (eh[i + 1] as number) + (h - (eh[i + 1] as number)) * w;
      }
      this.centre[k] = c;
      this.half[k] = h;
      // largeur de front permise par l'espace : celle des rues, puis progressivement celle des espaces ouverts
      const total = 2 * h;
      const t = Math.max(0, Math.min(1, (total - p.openSpaceWidthM) / 10));
      const cap = p.marchFrontWidthMaxM + t * (p.openSpaceFrontMaxM - p.marchFrontWidthMaxM);
      this.limit[k] = Math.max(0.8, Math.min(cap, total - 2 * p.streetMarginM));
    }
    this.setCap(p.openSpaceFrontMaxM);
  }

  /** Largeur de front voulue par le groupe (petit groupe : bloc compact). Recalcule l'aire cumulée si elle change. */
  setCap(cap: number): void {
    if (Math.abs(cap - this.cap) < 0.01) return;
    this.cap = cap;
    let acc = 0;
    for (let k = 0; k < this.nodes; k++) {
      const f = Math.min(cap, this.limit[k] as number);
      this.front[k] = f;
      // au-delà de la largeur de front des rues, la densité diminue en proportion (le nombre de personnes par mètre de route reste voisin)
      const rel = Math.max(this.p.marchDensityMin / this.p.marchDensity, Math.min(1, this.p.marchFrontWidthMaxM / f));
      this.wgt[k] = f * rel;
      if (k > 0) acc += (((this.wgt[k - 1] as number) + (this.wgt[k] as number)) / 2) * STEP_M;
      this.cum[k] = acc;
    }
  }

  private idx(s: number): { k: number; t: number } {
    const f = Math.max(0, Math.min(this.nodes - 1 - 1e-9, s / STEP_M));
    const k = Math.floor(f);
    return { k, t: (f - k) * STEP_M };
  }

  /** Largeur de front (m) à l'abscisse s (valeurs aux extrémités prolongées). */
  frontAt(s: number): number {
    const { k, t } = this.idx(s);
    const a = this.front[k] as number;
    const b = this.front[k + 1] as number;
    return a + ((b - a) * t) / STEP_M;
  }

  /** Aire cumulée de la colonne depuis le début de la route (négative avant le début, prolongée linéairement après la fin). */
  area(s: number): number {
    if (s <= 0) return (this.wgt[0] as number) * s;
    const D = (this.nodes - 1) * STEP_M;
    if (s >= D) return (this.cum[this.nodes - 1] as number) + (this.wgt[this.nodes - 1] as number) * (s - D);
    const { k, t } = this.idx(s);
    const f0 = this.wgt[k] as number;
    const d = (this.wgt[k + 1] as number) - f0;
    return (this.cum[k] as number) + f0 * t + (d * t * t) / (2 * STEP_M);
  }

  /** Abscisse dont l'aire cumulée vaut `a` (réciproque de `area`). */
  inverse(a: number): number {
    if (a <= 0) return a / (this.wgt[0] as number);
    const K = this.nodes - 1;
    const D = K * STEP_M;
    if (a >= (this.cum[K] as number)) return D + (a - (this.cum[K] as number)) / (this.wgt[K] as number);
    let lo = 0;
    let hi = K;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if ((this.cum[mid] as number) <= a) lo = mid;
      else hi = mid;
    }
    const f0 = this.wgt[lo] as number;
    const d = (this.wgt[lo + 1] as number) - f0;
    const r = a - (this.cum[lo] as number);
    const t = (2 * r) / (f0 + Math.sqrt(f0 * f0 + (2 * d * r) / STEP_M));
    return lo * STEP_M + t;
  }

  /** Décalage latéral (m, positif = côté gauche de la marche) de l'individu de coordonnée latérale `lat` ∈ [-1, 1] à l'abscisse s. */
  lateral(s: number, lat: number): number {
    const { k, t } = this.idx(s);
    const w = t / STEP_M;
    const c = (this.centre[k] as number) + (((this.centre[k + 1] as number) - (this.centre[k] as number)) * w);
    const h = (this.half[k] as number) + (((this.half[k + 1] as number) - (this.half[k] as number)) * w);
    const f = this.frontAt(s);
    return c + lat * Math.max(0.4, Math.min(f / 2, h - this.p.streetMarginM));
  }

  /** Demi-largeur du front et décalage du centre à l'abscisse s (pour raccorder les entrées/sorties de route). */
  frame(s: number): { c: number; hw: number } {
    return { c: this.lateral(s, 0), hw: Math.max(0.4, this.lateral(s, 1) - this.lateral(s, 0)) };
  }

  /** Position (abscisse) de la tête pour que la colonne de `n` personnes à la densité `rho` ait son centre en `centre`. */
  solveFromCentre(centre: number, n: number, rho: number): { head: number; tail: number } {
    const need = n / rho;
    // aire(centre + L/2) − aire(centre − L/2) = need : fonction croissante de L, recherche dichotomique
    let lo = 0;
    let hi = need / 0.3 + 10;
    for (let it = 0; it < 48; it++) {
      const mid = (lo + hi) / 2;
      if (this.area(centre + mid / 2) - this.area(centre - mid / 2) < need) lo = mid;
      else hi = mid;
    }
    const L = (lo + hi) / 2;
    return { head: centre + L / 2, tail: centre - L / 2 };
  }

  /** Queue de la colonne dont la tête est en `head`. */
  tailFromHead(head: number, n: number, rho: number): number {
    return this.inverse(this.area(head) - n / rho);
  }
}

/** Largeur de front voulue par un groupe : bloc compact pour un petit effectif, plafonné par l'espace ouvert. */
export function groupFrontCap(n: number, p: Pick<SimParams, 'marchDensity' | 'marchFrontWidthMinM' | 'openSpaceFrontMaxM'>): number {
  return Math.max(p.marchFrontWidthMinM, Math.min(p.openSpaceFrontMaxM, Math.sqrt(n / p.marchDensity)));
}

/** Profil du groupe pour sa route courante (reconstruit si la route a changé), avec sa largeur de front à jour. */
export function profileFor(
  g: { route: Route | null; profile: ColumnProfile | null; members: { n: number; activeStart: number } },
  graph: StreetGraph,
  state: Pick<EdgeState, 'walkLeft' | 'walkRight'>,
  p: SimParams,
): ColumnProfile {
  const route = g.route as Route;
  if (!g.profile || g.profile.route !== route) g.profile = new ColumnProfile(route, graph, state, p);
  g.profile.setCap(groupFrontCap(g.members.n - g.members.activeStart, p));
  return g.profile;
}

const routeProfiles = new WeakMap<Route, ColumnProfile>();
/** Profil d'une route secondaire (dispersion) : largeur de front maximale. */
export function profileOfRoute(route: Route, graph: StreetGraph, state: Pick<EdgeState, 'walkLeft' | 'walkRight'>, p: SimParams): ColumnProfile {
  let pr = routeProfiles.get(route);
  if (!pr) {
    pr = new ColumnProfile(route, graph, state, p);
    routeProfiles.set(route, pr);
  }
  return pr;
}
