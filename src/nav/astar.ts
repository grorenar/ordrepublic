import type { Vec2 } from '../geo/mercator';
import { EdgeClass, EdgeFlag, sliceEdge, type StreetGraph } from './graph';
import { EdgeGrid, nearestEdge, type EdgeProjection } from './spatialGrid';
import { MinHeap } from './heap';
import { buildRoute, type NavMode, type Route } from './route';
import type { EdgeState } from './streetState';
import { FOOTWAY_CLASSES, type NavParams } from './params';

/** Contexte de navigation : graphe + index + paramètres + état dynamique (+ tampons réutilisés). */
/** Zone circulaire (m) dans laquelle les piétons peuvent traverser une foule dense (arrivée à destination). */
export interface SoftZone {
  x: number;
  y: number;
  r: number;
}

export class NavContext {
  readonly grid: EdgeGrid;
  private readonly stamp: Uint32Array;
  private readonly gScore: Float64Array;
  private readonly parentEdge: Int32Array;
  private readonly parentNode: Int32Array;
  private gen = 0;
  private readonly heap = new MinHeap();
  readonly vMaxVehicle: number;

  constructor(
    readonly graph: StreetGraph,
    readonly params: NavParams,
    public state: EdgeState | null = null,
  ) {
    this.grid = new EdgeGrid(graph);
    this.stamp = new Uint32Array(graph.nodeCount);
    this.gScore = new Float64Array(graph.nodeCount);
    this.parentEdge = new Int32Array(graph.nodeCount);
    this.parentNode = new Int32Array(graph.nodeCount);
    this.vMaxVehicle = Math.max(1, ...Object.values(params.speedVehicleByClass));
  }

  /** Une arête est-elle empruntable dans ce sens par ce mode (indépendamment de l'état dynamique) ? */
  canTraverse(e: number, forward: boolean, mode: NavMode): boolean {
    const f = this.graph.edgeFlags[e] as number;
    if (mode === 'vehicle' || mode === 'emergency') {
      if (!(f & EdgeFlag.Motor)) {
        // une voie de bus en site propre n'est ouverte qu'aux véhicules avec avertisseurs (mode `emergency`)
        if (this.graph.edgeClass[e] === EdgeClass.Busway && mode !== 'emergency') return false;
        return this.footwayVehicleSpeed(e) > 0;
      }
      // avertisseurs actifs : sens interdits permis (circulation à contresens)
      if (mode === 'vehicle') {
        if (f & EdgeFlag.Oneway && !forward) return false;
        if (f & EdgeFlag.OnewayRev && forward) return false;
      }
      return (this.params.speedVehicleByClass[this.graph.edgeClass[e] as number] ?? 0) > 0;
    }
    return (f & EdgeFlag.Foot) !== 0;
  }

  /** Vitesse nominale (m/s) d'un véhicule sur l'arête : classe de voie, ou voie piétonne assez large ; 0 = impraticable. */
  vehicleSpeedOn(e: number): number {
    const f = this.graph.edgeFlags[e] as number;
    if (f & EdgeFlag.Motor) return this.params.speedVehicleByClass[this.graph.edgeClass[e] as number] ?? 0;
    return this.footwayVehicleSpeed(e);
  }

  private footwayVehicleSpeed(e: number): number {
    const p = this.params;
    const cls = this.graph.edgeClass[e] as number;
    if (!FOOTWAY_CLASSES.has(cls)) return 0;
    const w = this.state ? Math.max(this.state.walkWidth[e] as number, this.graph.edgeWidth[e] as number) : (this.graph.edgeWidth[e] as number);
    if (w < p.vehicleFootwayMinWidthM) return 0;
    return cls === EdgeClass.Busway ? p.speedVehicleByClass[EdgeClass.Busway] ?? p.vehicleFootwaySpeedMps : p.vehicleFootwaySpeedMps;
  }

  /** Milieu d'une arête (pour la zone d'arrivée). */
  /** L'arête est-elle dans la zone d'arrivée (traversée lente d'une foule dense permise) ? */
  inZone(e: number, z: SoftZone): boolean {
    const g = this.graph;
    const mx = ((g.nodeX[g.edgeA[e] as number] as number) + (g.nodeX[g.edgeB[e] as number] as number)) / 2;
    const my = ((g.nodeY[g.edgeA[e] as number] as number) + (g.nodeY[g.edgeB[e] as number] as number)) / 2;
    return Math.hypot(mx - z.x, my - z.y) <= z.r;
  }

  /**
   * Coût (secondes de jeu) pour parcourir `len` mètres de l'arête `e` ; Infinity si impraticable.
   * `soft` : zone d'arrivée — un piéton qui rejoint un rassemblement peut y pénétrer (lentement) même si la
   * foule y est dense ; jamais un véhicule.
   */
  edgeCost(e: number, mode: NavMode, len: number, dynamic: boolean, soft?: SoftZone): number {
    const p = this.params;
    const cls = this.graph.edgeClass[e] as number;
    let speed: number;
    let mult = 1;
    if (mode === 'vehicle' || mode === 'emergency') {
      speed = this.vehicleSpeedOn(e);
      if (speed <= 0) return Infinity;
      if (mode === 'emergency') speed *= p.emergencySpeedFactor;
    } else {
      speed = p.speedFootMps;
      if (mode === 'crowd') {
        if (cls === EdgeClass.Footway || cls === EdgeClass.Path) mult += p.crowdPenaltyFootway;
        else if (cls === EdgeClass.Steps) mult += p.crowdPenaltySteps;
        // un cortège évite les rues étroites (largeur praticable mesurée), sans les interdire
        const ww = this.state ? (this.state.walkWidth[e] as number) : (this.graph.edgeWidth[e] as number);
        if (ww < p.crowdPreferredWidthM) mult += p.crowdNarrowPenalty * (1 - ww / p.crowdPreferredWidthM);
      }
    }
    if (dynamic && this.state) {
      const st = this.state;
      if (st.scenarioBlock[e]) return Infinity;
      if (mode === 'vehicle' || mode === 'emergency') {
        const s = st.vehState[e] as number;
        // rue saturée par une foule : infranchissable, sauf pour un véhicule avec avertisseurs qui s'y fraie un passage au pas
        if (s === 3 && mode !== 'emergency') return Infinity;
        speed *= s === 0 ? 1 : s === 1 ? 0.7 : s === 2 ? 0.35 : this.params.emergencyBlockedSpeedFactor;
      } else {
        if (st.footState[e] === 3) {
          if (!soft || !this.inZone(e, soft)) return Infinity;
          speed *= p.minSpeedFactor * 4; // traversée lente d'une foule dense à destination
        } else speed *= st.speedFactor[e] as number;
      }
    }
    return (len / speed) * mult;
  }

  snap(p: Vec2, mode: NavMode, maxDist = 400): EdgeProjection | null {
    return nearestEdge(this.graph, this.grid, p, maxDist, (e) => this.canTraverse(e, true, mode) || this.canTraverse(e, false, mode));
  }

  /** Itinéraire de `from` à `to`, ou null si aucun itinéraire valide n'existe. Aucun plafond de détour par défaut. */
  findRoute(
    from: Vec2,
    to: Vec2,
    mode: NavMode,
    opts: {
      maxSnap?: number;
      /** Départ imposé sur une arête (replanification à partir de la tête d'un cortège) : `toward` interdit de faire demi-tour. */
      start?: { edge: number; t: number; toward?: number };
      soft?: SoftZone;
    } = {},
  ): Route | null {
    const g = this.graph;
    const S: EdgeProjection | null = opts.start
      ? { edge: opts.start.edge, t: opts.start.t, dist: 0, point: from }
      : this.snap(from, mode, opts.maxSnap);
    const only = opts.start?.toward;
    const T = this.snap(to, mode, opts.maxSnap);
    if (!S || !T) return null;
    const version = this.state?.version ?? 0;
    const baseRate = (e: number) => this.edgeCost(e, mode, 1, false); // coût/m sans état dynamique (sortie d'une rue bloquée)
    const soft = opts.soft;
    const dynRate = (e: number) => this.edgeCost(e, mode, 1, true, soft); // coût/m avec état dynamique (∞ si impraticable)
    const vMax = mode === 'vehicle' ? this.vMaxVehicle : mode === 'emergency' ? this.vMaxVehicle * this.params.emergencySpeedFactor : this.params.speedFootMps;

    // Candidat direct (même arête).
    let best = Infinity;
    let bestKind: 'direct' | 'graph' = 'graph';
    let bestA = -1; // nœud de sortie de l'arête de départ
    let bestB = -1; // nœud d'entrée de l'arête d'arrivée
    if (S.edge === T.edge && only === undefined) {
      const fwd = T.t >= S.t;
      if (this.canTraverse(S.edge, fwd, mode)) {
        const c = Math.abs(T.t - S.t) * dynRate(S.edge);
        if (c < best) {
          best = c;
          bestKind = 'direct';
        }
      }
    }

    this.gen++;
    const gen = this.gen;
    this.heap.clear();
    const hx = to.x;
    const hy = to.y;
    const h = (n: number) => Math.hypot(g.nodeX[n]! - hx, g.nodeY[n]! - hy) / vMax;
    const seed = (n: number, cost: number) => {
      if (!isFinite(cost)) return;
      if (this.stamp[n] === gen && (this.gScore[n] as number) <= cost) return;
      this.stamp[n] = gen;
      this.gScore[n] = cost;
      this.parentEdge[n] = -1;
      this.parentNode[n] = -1;
      this.heap.push(cost + h(n), n);
    };
    const sa = g.edgeA[S.edge] as number;
    const sb = g.edgeB[S.edge] as number;
    // Un point situé exactement sur un nœud EST ce nœud : aucune contrainte de sens pour la distance nulle.
    const EPS = 1e-4;
    const sLen = g.edgeLen[S.edge] as number;
    // Si la rue de départ est impraticable (foule dense, fermeture), on ne peut s'en échapper que par
    // l'extrémité la plus proche (règle de sortie, coût de base) : jamais la traverser de bout en bout.
    const startBlocked = !isFinite(dynRate(S.edge));
    const nearestIsA = S.t <= sLen - S.t;
    const rateS = startBlocked ? baseRate(S.edge) : dynRate(S.edge);
    if (only === undefined || only === sa) {
      if (S.t <= EPS) seed(sa, 0);
      else if (this.canTraverse(S.edge, false, mode) && (!startBlocked || nearestIsA || only !== undefined)) seed(sa, S.t * rateS);
    }
    if (only === undefined || only === sb) {
      if (sLen - S.t <= EPS) seed(sb, 0);
      else if (this.canTraverse(S.edge, true, mode) && (!startBlocked || !nearestIsA || only !== undefined)) seed(sb, (sLen - S.t) * rateS);
    }

    const ta = g.edgeA[T.edge] as number;
    const tb = g.edgeB[T.edge] as number;
    const tLen = g.edgeLen[T.edge] as number;
    // entrer par a puis marcher vers T (ou être déjà en T si T est sur le nœud)
    const tailCostA = T.t <= EPS ? 0 : this.canTraverse(T.edge, true, mode) ? T.t * dynRate(T.edge) : Infinity;
    const tailCostB = tLen - T.t <= EPS ? 0 : this.canTraverse(T.edge, false, mode) ? (tLen - T.t) * dynRate(T.edge) : Infinity;

    while (this.heap.size) {
      if (this.heap.peekKey() >= best) break;
      const n = this.heap.pop();
      const gn = this.gScore[n] as number;
      if (this.heap.lastKey > gn + h(n) + 1e-9) continue; // entrée périmée
      if (n === ta && gn + tailCostA < best) {
        best = gn + tailCostA;
        bestKind = 'graph';
        bestB = n;
        bestA = -2; // sera résolu par la remontée
      }
      if (n === tb && gn + tailCostB < best) {
        best = gn + tailCostB;
        bestKind = 'graph';
        bestB = n;
        bestA = -2;
      }
      for (let k = g.adjStart[n]!; k < g.adjStart[n + 1]!; k++) {
        const e = g.adj[k] as number;
        const forward = g.edgeA[e] === n;
        if (!this.canTraverse(e, forward, mode)) continue;
        const m = forward ? (g.edgeB[e] as number) : (g.edgeA[e] as number);
        const c = this.edgeCost(e, mode, g.edgeLen[e] as number, true, soft);
        if (!isFinite(c)) continue;
        const ng = gn + c;
        if (this.stamp[m] !== gen || ng < (this.gScore[m] as number) - 1e-12) {
          this.stamp[m] = gen;
          this.gScore[m] = ng;
          this.parentEdge[m] = e;
          this.parentNode[m] = n;
          this.heap.push(ng + h(m), m);
        }
      }
    }
    if (!isFinite(best)) return null;
    if (isFinite(this.params.maxDetourRatio)) {
      const direct = Math.hypot(from.x - to.x, from.y - to.y) / vMax;
      if (best > direct * this.params.maxDetourRatio && direct > 0) return null;
    }

    // --- reconstruction ---
    const nodes: number[] = [];
    const edges: number[] = [];
    const lengths: number[] = [];
    const points: Vec2[] = [];
    // Points quasi confondus fusionnés (< 0,3 m) : évite des micro-segments qui fausseraient les tangentes ;
    // le premier point (départ) est conservé, le dernier (arrivée) remplace son voisin trop proche.
    const MIN_SEG = 0.3;
    const push = (pts: Vec2[]) => {
      for (const p of pts) {
        const last = points[points.length - 1];
        if (!last) points.push(p);
        else if (Math.hypot(last.x - p.x, last.y - p.y) >= MIN_SEG) points.push(p);
        else if (points.length > 1) points[points.length - 1] = p;
      }
    };
    if (bestKind === 'direct') {
      const seg = sliceEdge(g, S.edge, S.t, T.t);
      push(seg);
      edges.push(S.edge);
      lengths.push(Math.abs(T.t - S.t));
    } else {
      // remonte depuis le nœud d'entrée de l'arête d'arrivée
      const chain: Array<{ edge: number; from: number; to: number }> = [];
      let cur = bestB;
      while (this.parentEdge[cur] !== -1) {
        const e = this.parentEdge[cur] as number;
        const pn = this.parentNode[cur] as number;
        chain.push({ edge: e, from: pn, to: cur });
        cur = pn;
      }
      chain.reverse();
      const firstNode = cur;
      // arête de départ partielle
      const startToA = firstNode === sa;
      push(sliceEdge(g, S.edge, S.t, startToA ? 0 : (g.edgeLen[S.edge] as number)));
      edges.push(S.edge);
      lengths.push(startToA ? S.t : (g.edgeLen[S.edge] as number) - S.t);
      nodes.push(firstNode);
      for (const c of chain) {
        const fwd = g.edgeA[c.edge] === c.from;
        const len = g.edgeLen[c.edge] as number;
        push(sliceEdge(g, c.edge, fwd ? 0 : len, fwd ? len : 0));
        edges.push(c.edge);
        lengths.push(len);
        nodes.push(c.to);
      }
      // arête d'arrivée partielle
      const enterA = bestB === ta && (bestB !== tb || tailCostA <= tailCostB);
      push(sliceEdge(g, T.edge, enterA ? 0 : (g.edgeLen[T.edge] as number), T.t));
      edges.push(T.edge);
      lengths.push(enterA ? T.t : (g.edgeLen[T.edge] as number) - T.t);
    }
    if (points.length === 1) points.push({ ...(points[0] as Vec2) });
    // Dédoublonnage des nœuds répétés (cas dégénérés : départ et arrivée sur arêtes adjacentes).
    const uniq: number[] = [];
    for (const n of nodes) if (uniq[uniq.length - 1] !== n) uniq.push(n);
    return buildRoute(mode, uniq, edges, lengths, points, best, version);
  }

  /**
   * Premier indice d'arête de la route (à partir de `fromIndex`) devenu impraticable pour ce mode
   * (fermeture de scénario, blocage par la foule), ou -1 si la route est libre.
   */
  firstBlockedEdge(route: Route, fromIndex: number, soft?: SoftZone): number {
    for (let i = Math.max(0, fromIndex); i < route.edges.length; i++) {
      const e = route.edges[i] as number;
      // une arête parcourue sur moins de 0,5 m (point de départ ou d'arrivée posé sur un nœud) ne compte pas comme obstacle
      if ((route.edgeStart[i + 1] as number) - (route.edgeStart[i] as number) < 0.5) continue;
      if (!isFinite(this.edgeCost(e, route.mode, 1, true, soft))) return i;
    }
    return -1;
  }
}
