import type { Vec2 } from '../geo/mercator';
import { NavContext, type SoftZone } from '../nav/astar';
import type { StreetGraph } from '../nav/graph';
import { edgeIndexAt, joinRoutes, locate, truncateRoute, type Located, type Route } from '../nav/route';
import { projectOnEdge } from '../nav/spatialGrid';
import {
  accumulateLoads,
  countStreetStates,
  createEdgeState,
  deriveStates,
  setScenarioBlock,
  type CrowdFootprint,
  type EdgeState,
  type StreetCounts,
} from '../nav/streetState';
import { WalkMask } from '../nav/walkMask';
import { createLayout, extendLayout, snapToWalkable } from './layout';
import { levelFor, distanceToFoci, selectBlockLevels, usesBlocks } from './lod';
import { Journal, pushHistory } from './journal';
import { MoverSystem } from './movers';
import { concatMembers, createMembers, sliceMembers } from './members';
import { computeTargets, evaluateNow, frameEntry, goneCount, routeFrame, updateMembers, type MotionCtx } from './motion';
import { withParams, type DeepPartial, type SimParams } from './params';
import { validateSimParams } from './paramDocs';
import { Rng, hash32 } from './rng';
import type {
  Anchor,
  Cause,
  CrowdGroup,
  Focus,
  GroupPlan,
  GroupSpec,
  Id,
  LogEvent,
  MemberSet,
  MoverEntity,
  OrderRequest,
  OrderResult,
  SimLevel,
  UnitEntity,
  UnitSpec,
  VehicleEntity,
  VehicleSpec,
} from './types';

export class CausalityError extends Error {}
export class ParamError extends Error {}

/** Événement de scénario daté ; `reason` est repris tel quel dans le journal. */
export type ScenarioEvent =
  | { id: Id; atMs: number; kind: 'spawn_group'; spec: GroupSpec & { key?: string }; reason: string }
  | { id: Id; atMs: number; kind: 'close_street'; edgeId: number; reason: string }
  | { id: Id; atMs: number; kind: 'open_street'; edgeId: number; reason: string }
  | { id: Id; atMs: number; kind: 'begin_dispersal'; groupKey: string; exit: Anchor; durationMs: number; reason: string; /** Attend que le groupe soit installé (sinon l'événement est réessayé à chaque tick). */ whenSettled?: boolean }
  | { id: Id; atMs: number; kind: 'split_group'; groupKey: string; count: number; child: SplitChild; reason: string };

export interface SplitChild {
  label: string;
  destination: Anchor;
  onArrival?: 'settle' | 'join_target';
  /** Clé du groupe à rejoindre à l'arrivée (onArrival = join_target). */
  joinTargetKey?: string;
  key?: string;
  speedMps?: number;
}

export interface SimOptions {
  graph: StreetGraph;
  seed: number;
  params?: DeepPartial<SimParams>;
  /** Masque de marche (bâtiments). Par défaut construit depuis le graphe ; `null` = pas de collision. */
  mask?: WalkMask | null;
  timeline?: ScenarioEvent[];
  /** Zone de jeu (demi-côtés, m) pour le compteur de rues bloquées ; sinon tout le graphe. */
  zone?: { halfWidth: number; halfHeight: number };
}

const loc: Located = { x: 0, y: 0, tx: 0, ty: 0, seg: 0 };

/**
 * Moteur de simulation (phase 3, noyau). Aucune dépendance au DOM, à la carte ni à l'horloge murale :
 * l'hôte appelle `step()` à pas fixe. Toute création de groupe exige une cause identifiable.
 */
export class Sim {
  readonly graph: StreetGraph;
  readonly params: SimParams;
  readonly nav: NavContext;
  readonly state: EdgeState;
  readonly mask: WalkMask | null;
  /** Avertissements de cohérence des paramètres (non bloquants), à afficher dans les réglages/diagnostics. */
  readonly paramWarnings: string[];
  readonly journal = new Journal();
  readonly groups: CrowdGroup[] = [];
  readonly units: UnitEntity[] = [];
  readonly vehicles: VehicleEntity[] = [];
  /** Résultats des ordres traités au dernier tick (lus par l'interface). */
  lastOrderResults: OrderResult[] = [];
  private readonly movers: MoverSystem;
  private readonly moverById = new Map<Id, MoverEntity>();
  private pending: OrderRequest[] = [];
  private orderCounter = 0;
  private unitCounter = 0;
  private vehicleCounter = 0;
  readonly seed: number;
  readonly rng: Rng;
  tick = 0;
  private counter = 0;
  private timeline: ScenarioEvent[];
  private deferred: ScenarioEvent[] = [];
  private nextEvent = 0;
  private keyToId = new Map<string, Id>();
  private closedBy = new Map<number, Cause>();
  private foci: Focus[] | null = null;
  private pinned = new Set<Id>();
  private zone?: { halfWidth: number; halfHeight: number };
  /** Diagnostic : temps cumulé passé par sous-système (ms), pour les benchmarks. */
  readonly profile = { members: 0, groups: 0, streetState: 0, ticks: 0 };

  constructor(o: SimOptions) {
    this.graph = o.graph;
    this.seed = o.seed >>> 0;
    this.params = withParams(o.params);
    const issues = validateSimParams(this.params);
    if (issues.errors.length) throw new ParamError(`Paramètres de simulation incohérents :\n- ${issues.errors.join('\n- ')}`);
    this.state = createEdgeState(o.graph);
    this.nav = new NavContext(o.graph, this.params.nav, this.state);
    this.mask = o.mask === undefined ? WalkMask.fromGraph(o.graph, this.params.walkMaskResolutionM) : o.mask;
    this.rng = new Rng(hash32(this.seed, 0xabcdef));
    this.timeline = [...(o.timeline ?? [])].sort((a, b) => a.atMs - b.atMs || (a.id < b.id ? -1 : 1));
    this.zone = o.zone;
    this.paramWarnings = issues.warnings;
    this.movers = new MoverSystem({
      graph: this.graph,
      nav: this.nav,
      state: this.state,
      params: this.params,
      timeMs: () => this.timeMs,
      tick: () => this.tick,
      log: (level, code, text, why, subject, data) => this.log(level, code, text, why, subject, data),
      closeCause: (e) => this.closedBy.get(e),
      nextOrderId: () => `O-${++this.orderCounter}`,
    });
  }

  // ------------------------------------------------------------------ unités et véhicules

  private requireCause(cause: Cause): void {
    if (!cause || !cause.kind || !cause.refId || !cause.note) throw new CausalityError('Création sans cause identifiable.');
  }

  private baseMover(mode: 'foot' | 'vehicle', pos: Vec2, heading: number) {
    const placed = this.movers.placeOnGraph(pos, mode);
    if (!placed) throw new RangeError('Position hors du réseau de rues : impossible de placer l’entité.');
    return {
      mode,
      x: placed.x,
      y: placed.y,
      px: placed.x,
      py: placed.y,
      heading,
      prevHeading: heading,
      speedMps: 0,
      route: null,
      routeS: 0,
      status: 'idle' as const,
      order: null,
      waitingSinceMs: null,
      lastRouteStateVersion: this.state.version,
      lastRetryTick: this.tick,
    };
  }

  /** Ajoute une unité de forces de l'ordre (identifiant fictif stable fourni par le scénario). */
  addUnit(spec: UnitSpec, cause: Cause): Id {
    this.requireCause(cause);
    const id = `U-${++this.unitCounter}`;
    const force = spec.force;
    const e: UnitEntity = {
      ...this.baseMover('foot', spec.pos, spec.heading ?? 0),
      id,
      entity: 'unit',
      force,
      loadout: { shield: force === 'crs' || force === 'gendarmerie_mobile', helmet: true, ...spec.loadout },
      callsign: spec.callsign,
      num: spec.num,
      headcount: spec.headcount,
    };
    this.units.push(e);
    this.moverById.set(id, e);
    this.log('info', 'unit.created', `${e.callsign} : ${e.headcount} agents en position.`, cause, { type: 'unit', id });
    return id;
  }

  addVehicle(spec: VehicleSpec, cause: Cause): Id {
    this.requireCause(cause);
    const id = `V-${++this.vehicleCounter}`;
    const e: VehicleEntity = { ...this.baseMover('vehicle', spec.pos, spec.heading ?? 0), id, entity: 'vehicle', vehicle: spec.vehicle, callsign: spec.callsign, crew: spec.crew };
    this.vehicles.push(e);
    this.moverById.set(id, e);
    this.log('info', 'unit.created', `${e.callsign} : véhicule en position.`, cause, { type: 'vehicle', id });
    return id;
  }

  entity(id: Id): MoverEntity | undefined {
    return this.moverById.get(id);
  }

  /** Met un ordre en file : il sera exécuté au prochain tick (utilisable en pause). */
  enqueue(req: OrderRequest): void {
    this.pending.push(req);
  }

  /** Exécute immédiatement un ordre (ordres simultanés sur plusieurs entités). */
  issueOrder(req: OrderRequest): OrderResult[] {
    return this.movers.apply(req, this.moverById);
  }

  /** Itinéraire d'aperçu d'un ordre, sans modifier l'état. */
  previewOrder(id: Id, target: Vec2) {
    const e = this.moverById.get(id);
    return e ? this.movers.preview(e, target) : null;
  }

  get timeMs(): number {
    return this.tick * this.params.tickMs;
  }

  // ------------------------------------------------------------------ journal

  private log(
    level: LogEvent['level'],
    code: string,
    text: string,
    why: Cause,
    subject?: LogEvent['subject'],
    data?: LogEvent['data'],
  ): void {
    this.journal.add({ tick: this.tick, simTimeMs: this.timeMs, level, code, text, why, subject, data });
    if (subject?.type === 'group') {
      const g = this.group(subject.id);
      if (g) pushHistory(g.history, { tick: this.tick, simTimeMs: this.timeMs, code, text, why });
    }
  }

  /** Chaîne causale d'un groupe : création puis transitions, avec leur cause. */
  explain(groupId: Id): Array<{ simTimeMs: number; code: string; text: string; why: Cause }> {
    const g = this.group(groupId);
    return g ? g.history.map((h) => ({ simTimeMs: h.simTimeMs, code: h.code, text: h.text, why: h.why })) : [];
  }

  // ------------------------------------------------------------------ accès

  group(id: Id): CrowdGroup | undefined {
    return this.groups.find((g) => g.id === id);
  }

  groupByKey(key: string): CrowdGroup | undefined {
    const id = this.keyToId.get(key);
    return id ? this.group(id) : undefined;
  }

  /** Effectif logique (personnes encore présentes dans la zone). */
  size(g: CrowdGroup): number {
    return g.members.n - g.members.activeStart;
  }

  totalPeople(): number {
    let n = 0;
    for (const g of this.groups) if (g.phase !== 'dispersed') n += this.size(g);
    return n;
  }

  streetCounts(): StreetCounts {
    return countStreetStates(this.graph, this.state, this.zone);
  }

  /** Zone de jeu (demi-côtés en mètres) utilisée pour le compteur de rues bloquées. */
  setZone(zone: { halfWidth: number; halfHeight: number } | undefined): void {
    this.zone = zone;
  }

  setFoci(foci: Focus[] | null, pinned: Iterable<Id> = []): void {
    this.foci = foci;
    this.pinned = new Set(pinned);
  }

  private motionCtx(): MotionCtx {
    return { graph: this.graph, params: this.params, mask: this.mask, tick: this.tick, tMs: this.timeMs };
  }

  /** Réévalue les positions d'un groupe quel que soit son niveau (sélection, affichage d'un groupe en N0). */
  ensureEvaluated(g: CrowdGroup): void {
    if (g.level === 0) {
      evaluateNow(g, this.motionCtx());
      g.needsSnap = true;
    }
  }

  // ------------------------------------------------------------------ création

  /** Crée un groupe. La cause est OBLIGATOIRE : aucune foule n'apparaît sans raison (cahier §14). */
  createGroup(spec: GroupSpec & { key?: string }, cause: Cause): Id {
    if (!cause || !cause.kind || !cause.refId || !cause.note) throw new CausalityError('Création de groupe sans cause identifiable.');
    if (!Number.isInteger(spec.size) || spec.size < 1) throw new RangeError('Effectif de groupe invalide.');
    const counter = this.counter + 1;
    const seed = spec.seed ?? hash32(this.seed, counter);
    return this.finishCreate(spec, cause, createMembers(spec.size, seed), seed, false);
  }

  /** Construit le groupe autour d'un ensemble d'individus (neuf ou issu d'une scission). */
  private finishCreate(spec: GroupSpec & { key?: string }, cause: Cause, members: MemberSet, seed: number, keepPositions: boolean): Id {
    const p = this.params;
    const id = `G-${++this.counter}`;
    const plan: GroupPlan = { waypoints: [], onArrival: 'settle', patienceMs: 0, ...spec.plan };
    const g: CrowdGroup = {
      id,
      label: spec.label,
      kind: spec.kind,
      phase: spec.kind === 'static' ? 'settled' : 'forming',
      members,
      cohesion: spec.cohesion ?? 80,
      tension: spec.tension ?? 20,
      morale: 70,
      plan,
      anchor: null,
      origin: cause,
      parentId: spec.parentId,
      history: [],
      seed,
      startAtMs: spec.startAtMs ?? 0,
      route: null,
      sCentre: 0,
      columnLength: 0,
      frontWidth: p.marchFrontWidthMaxM,
      speedMps: 0,
      speedCause: 'à l’arrêt',
      speedOverride: spec.speedMps,
      otherCrowdFactor: 1,
      waitingSinceMs: null,
      patienceReported: false,
      lastRouteStateVersion: this.state.version,
      lastRetryTick: this.tick,
      entry: spec.entry ?? 'inside',
      layout: null,
      settleAtS: Infinity,
      dispersal: null,
      level: p.lod.defaultLevel,
      blocks: null,
      needsSnap: true,
      blend: null,
    };
    const n = members.n;
    this.groups.push(g);
    if (spec.key) this.keyToId.set(spec.key, id);
    const from = keepPositions ? { x: Float32Array.from(members.x), y: Float32Array.from(members.y) } : null;

    if (spec.kind === 'static') {
      const anchor: Anchor = spec.anchor ?? { id: `A-${id}`, kind: 'place', pos: spec.origin, radius: 20, label: spec.label, source: 'synthetic' };
      g.anchor = anchor;
      g.layout = createLayout(snapToWalkable(anchor.pos, this.mask), p.staticDensity, seed);
      extendLayout(g.layout, n, this.mask, p.staticMaxRadiusM, seed);
      this.log('info', 'group.created', `${spec.label} : rassemblement statique de ${n} personnes (${anchor.label}).`, cause, { type: 'group', id }, { size: n, overflow: g.layout.overflow });
      if (g.layout.overflow > 0) this.log('warn', 'group.layout_overflow', `${spec.label} : zone praticable insuffisante autour de ${anchor.label}, densité accrue pour ${g.layout.overflow} personnes.`, cause, { type: 'group', id });
    } else {
      this.planMarch(g, spec.origin, cause);
    }
    if (from) this.applyBlend(g, from.x, from.y);
    else this.initPositions(g);
    return id;
  }

  private initPositions(g: CrowdGroup): void {
    evaluateNow(g, this.motionCtx());
    g.needsSnap = false;
  }

  /**
   * Recomposition progressive : les individus partent de `fromX/fromY` (positions avant changement) vers les
   * nouvelles cibles analytiques, à vitesse bornée (aucun déplacement instantané).
   */
  private applyBlend(g: CrowdGroup, fromX: Float32Array, fromY: Float32Array): void {
    const m = g.members;
    g.blend = null;
    computeTargets(g, this.motionCtx());
    let maxD = 0;
    for (let i = m.activeStart; i < m.n; i++) maxD = Math.max(maxD, Math.hypot((m.tx[i] as number) - (fromX[i] as number), (m.ty[i] as number) - (fromY[i] as number)));
    m.x.set(fromX);
    m.y.set(fromY);
    m.px.set(fromX);
    m.py.set(fromY);
    g.needsSnap = false;
    if (maxD > 0.5) g.blend = { t0Ms: this.timeMs, durMs: Math.max(1000, (maxD / this.params.blendMaxSpeedMps) * 1000), fromX: Float32Array.from(fromX), fromY: Float32Array.from(fromY) };
  }

  // ------------------------------------------------------------------ planification

  /** Zone d'arrivée d'un groupe : on peut y traverser une foule dense pour rejoindre le lieu de destination. */
  private softZone(plan: GroupPlan): SoftZone | undefined {
    const d = plan.destination;
    return d ? { x: d.pos.x, y: d.pos.y, r: d.radius + this.params.arrivalZoneM } : undefined;
  }

  private planRoute(from: Vec2, plan: GroupPlan): { route: Route; waypointS: number[] } | null {
    const targets: Vec2[] = [...plan.waypoints.map((w) => w.pos)];
    if (plan.destination) targets.push(plan.destination.pos);
    if (!targets.length) return null;
    const parts: Route[] = [];
    const waypointS: number[] = [];
    let cur = from;
    let acc = 0;
    for (const t of targets) {
      const r = this.nav.findRoute(cur, t, 'crowd', { soft: this.softZone(plan) });
      if (!r) return null;
      parts.push(r);
      acc += r.length;
      waypointS.push(acc);
      cur = t;
    }
    return { route: parts.length === 1 ? (parts[0] as Route) : joinRoutes(parts), waypointS };
  }

  private columnGeometry(g: CrowdGroup, n: number): { width: number; length: number } {
    const p = this.params;
    const route = g.route as Route;
    const L0 = g.columnLength || 1;
    const s0 = Math.max(0, g.sCentre - L0 / 2);
    const s1 = Math.min(route.length, g.sCentre + L0 / 2);
    // un petit groupe forme un bloc compact : largeur de front ≈ √(effectif / densité), bornée
    let w = Math.max(p.marchFrontWidthMinM, Math.min(p.marchFrontWidthMaxM, Math.sqrt(n / p.marchDensity)));
    const i0 = edgeIndexAt(route, s0);
    const i1 = edgeIndexAt(route, s1);
    for (let i = i0; i <= i1; i++) w = Math.min(w, (this.graph.edgeWidth[route.edges[i] as number] as number) - 2 * p.streetMarginM);
    w = Math.max(1, w);
    return { width: w, length: Math.max(1, n / (p.marchDensity * w)) };
  }

  private planMarch(g: CrowdGroup, origin: Vec2, cause: Cause): void {
    const p = this.params;
    const n = g.members.n;
    const plan = this.planRoute(origin, g.plan);
    if (!plan) {
      // aucun itinéraire : le groupe reste sur place, positionné autour de son origine
      g.phase = 'waiting';
      g.waitingSinceMs = this.timeMs;
      g.layout = createLayout(snapToWalkable(origin, this.mask), p.staticDensity, g.seed);
      extendLayout(g.layout, n, this.mask, p.staticMaxRadiusM, g.seed);
      this.log('warn', 'group.created', `${g.label} : ${n} personnes, aucun itinéraire vers ${g.plan.destination?.label ?? 'la destination'} — le groupe reste sur place.`, cause, { type: 'group', id: g.id }, { size: n });
      return;
    }
    g.route = plan.route;
    g.sCentre = 0;
    const geo = this.columnGeometry(g, n);
    g.frontWidth = geo.width;
    g.columnLength = geo.length;
    if (g.entry === 'gateway') g.sCentre = -geo.length / 2;
    const dest = g.plan.destination;
    if (dest) {
      locate(g.route, g.route.length, loc);
      g.layout = createLayout({ x: loc.x, y: loc.y }, p.staticDensity, g.seed);
      extendLayout(g.layout, n, this.mask, p.staticMaxRadiusM, g.seed);
      for (let i = 0; i < n; i++) g.members.slotOf[i] = n - 1 - i; // le premier arrivé prend le créneau le plus proche
    }
    this.log('info', 'group.created', `${g.label} : ${g.kind === 'secondary' ? 'groupe secondaire' : 'cortège'} de ${n} personnes, itinéraire de ${Math.round(g.route.length)} m vers ${dest?.label ?? 'la destination'}.`, cause, { type: 'group', id: g.id }, { size: n, routeLengthM: Math.round(g.route.length) });
    g.phase = g.startAtMs <= this.timeMs ? 'moving' : 'forming';
  }

  // ------------------------------------------------------------------ commandes

  closeStreet(edgeId: number, cause: Cause): void {
    if (setScenarioBlock(this.state, edgeId, true)) {
      this.closedBy.set(edgeId, cause);
      const name = this.graph.edgeName[edgeId] ?? `tronçon ${edgeId}`;
      this.log('warn', 'edge.closed', `${name} fermée.`, cause, { type: 'edge', id: String(edgeId) });
    }
  }

  openStreet(edgeId: number, cause: Cause): void {
    if (setScenarioBlock(this.state, edgeId, false)) {
      this.closedBy.delete(edgeId);
      const name = this.graph.edgeName[edgeId] ?? `tronçon ${edgeId}`;
      this.log('info', 'edge.opened', `${name} rouverte.`, cause, { type: 'edge', id: String(edgeId) });
    }
  }

  /** Dispersion progressive d'un rassemblement statique vers une sortie (transition T8). */
  beginDispersal(groupId: Id, exit: Anchor, durationMs: number, cause: Cause): boolean {
    const g = this.group(groupId);
    if (!g || g.phase !== 'settled' || !g.layout || !g.anchor) return false;
    const route = this.nav.findRoute(g.anchor.pos, exit.pos, 'crowd');
    if (!route) {
      this.log('warn', 'group.dispersal_failed', `${g.label} : aucun itinéraire vers ${exit.label}, le rassemblement reste en place.`, cause, { type: 'group', id: g.id });
      return false;
    }
    const n = g.members.n;
    const dist = new Float32Array(n);
    let maxDist = 0;
    const start = routeFrame(g, this.motionCtx(), route, false);
    for (let i = 0; i < n; i++) {
      const slot = g.members.slotOf[i] as number;
      const e = frameEntry(start, g.members.lat[i] as number);
      const d = Math.hypot((g.layout.pts[2 * slot] as number) - e.x, (g.layout.pts[2 * slot + 1] as number) - e.y);
      dist[i] = d;
      if (d > maxDist) maxDist = d;
    }
    g.dispersal = { route, startMs: this.timeMs, durationMs: Math.max(1000, durationMs), speedMps: g.speedOverride ?? this.params.speedByKind.dispersing, maxDist, dist };
    g.phase = 'dispersing';
    g.plan = { ...g.plan, dispersalExit: exit };
    this.log('info', 'group.dispersing', `${g.label} : dispersion progressive vers ${exit.label} (${Math.round(route.length)} m).`, cause, { type: 'group', id: g.id }, { routeLengthM: Math.round(route.length) });
    return true;
  }

  /**
   * Scission (T6) : `count` personnes quittent le groupe pour former un groupe secondaire qui se dirige vers
   * `child.destination`. Les individus conservent leur position actuelle et rejoignent leur nouvelle formation
   * progressivement. Cause obligatoire (reprise dans le journal du parent et de l'enfant).
   */
  splitGroup(parentId: Id, count: number, child: SplitChild, cause: Cause): Id | null {
    const parent = this.group(parentId);
    if (!parent || parent.phase === 'dispersed' || parent.phase === 'dispersing') return null;
    const n = parent.members.n - parent.members.activeStart;
    if (!Number.isInteger(count) || count < 1 || count >= n) return null;
    this.ensureEvaluated(parent);
    const pm = parent.members;
    const isStatic = parent.phase === 'settled';
    // statique : les personnes les plus excentrées partent ; cortège : la queue de la colonne
    const [t0, t1] = isStatic ? [pm.n - count, pm.n] : [pm.activeStart, pm.activeStart + count];
    const taken = sliceMembers(pm, t0, t1);
    const kept = isStatic ? sliceMembers(pm, 0, pm.n - count) : sliceMembers(pm, t1, pm.n);
    let cx = 0;
    let cy = 0;
    for (let i = 0; i < taken.n; i++) {
      cx += taken.x[i] as number;
      cy += taken.y[i] as number;
    }
    const origin = { x: cx / taken.n, y: cy / taken.n };

    // le parent se recompose autour de ses individus restants
    const fromX = Float32Array.from(kept.x);
    const fromY = Float32Array.from(kept.y);
    if (isStatic) {
      for (let i = 0; i < kept.n; i++) kept.slotOf[i] = pm.slotOf[i] as number; // les créneaux restent attribués
    } else {
      for (let i = 0; i < kept.n; i++) kept.slotOf[i] = kept.n - 1 - i;
    }
    parent.members = kept;
    if (!isStatic && parent.route) {
      const geo = this.columnGeometry(parent, kept.n);
      parent.frontWidth = geo.width;
      parent.columnLength = geo.length;
      parent.settleAtS = Infinity; // recalculé à l'arrivée
    }
    this.applyBlend(parent, fromX, fromY);
    const joinId = child.joinTargetKey ? this.keyToId.get(child.joinTargetKey) : undefined;
    const plan: Partial<GroupPlan> = { destination: child.destination, waypoints: [], onArrival: child.onArrival ?? 'settle', joinTargetId: joinId, patienceMs: 0 };
    this.log('info', 'group.split', `${parent.label} : ${count} personnes se détachent pour rejoindre ${child.destination.label}.`, cause, { type: 'group', id: parent.id }, { count });
    const childCause: Cause = { kind: 'transition', refId: parent.id, note: `scission de ${parent.label} : ${cause.note}` };
    const childSpec: GroupSpec & { key?: string } = { label: child.label, kind: 'secondary', size: count, origin, plan, speedMps: child.speedMps, parentId: parent.id, key: child.key };
    return this.finishCreate(childSpec, childCause, taken, hash32(this.seed, this.counter + 1), true);
  }

  /** Jonction (T7) : le groupe `child` s'ajoute au rassemblement statique `parent`. */
  private mergeInto(parent: CrowdGroup, child: CrowdGroup): void {
    this.ensureEvaluated(parent);
    this.ensureEvaluated(child);
    const nC = child.members.n - child.members.activeStart;
    const childPart = sliceMembers(child.members, child.members.activeStart, child.members.n);
    const nP = parent.members.n;
    const oldSlots = Uint32Array.from(parent.members.slotOf);
    const combined = concatMembers(parent.members, childPart);
    // les créneaux existants sont conservés ; les arrivants prennent les créneaux suivants (propriété de préfixe)
    for (let i = 0; i < nP; i++) combined.slotOf[i] = oldSlots[i] as number;
    for (let k = 0; k < childPart.n; k++) combined.slotOf[nP + k] = nP + k;
    const fromX = Float32Array.from(combined.x);
    const fromY = Float32Array.from(combined.y);
    if (parent.layout) extendLayout(parent.layout, combined.n, this.mask, this.params.staticMaxRadiusM, parent.seed);
    parent.members = combined;
    child.members.activeStart = child.members.n;
    child.phase = 'dispersed';
    this.applyBlend(parent, fromX, fromY);
    const why: Cause = { kind: 'transition', refId: child.id, note: `${child.label} est arrivé à ${parent.anchor?.label ?? 'destination'} et rejoint le rassemblement` };
    this.log('info', 'group.joined', `${child.label} rejoint ${parent.label} (+${nC} personnes, total ${this.size(parent)}).`, why, { type: 'group', id: parent.id }, { added: nC, total: this.size(parent) });
    this.log('info', 'group.merged', `${child.label} : fusionné dans ${parent.label}.`, why, { type: 'group', id: child.id });
  }

  // ------------------------------------------------------------------ boucle

  /** Avance la simulation d'un tick (pas fixe). */
  step(): void {
    const t0 = performance.now();
    this.tick++;
    if (this.pending.length) {
      this.lastOrderResults = [];
      for (const req of this.pending) this.lastOrderResults.push(...this.movers.apply(req, this.moverById));
      this.pending = [];
    }
    this.runTimeline();
    const tG = performance.now();
    for (const g of this.groups) this.updateGroup(g);
    if (this.tick % this.params.streetStateEveryTicks === 0) this.updateStreetStates();
    for (const u of this.units) this.movers.step(u);
    for (const v of this.vehicles) this.movers.step(v);
    const tS = performance.now();
    this.chooseLevels();
    const ctx = this.motionCtx();
    for (const g of this.groups) updateMembers(g, ctx);
    const t1 = performance.now();
    // retire les groupes dissous (après journalisation)
    for (let i = this.groups.length - 1; i >= 0; i--) if (this.groups[i]!.phase === 'dispersed' && this.groups[i]!.members.n === this.groups[i]!.members.activeStart) this.groups.splice(i, 1);
    this.profile.groups += tS - tG;
    this.profile.streetState += 0;
    this.profile.members += t1 - tS;
    this.profile.ticks += t1 - t0;
  }

  run(ticks: number): void {
    for (let i = 0; i < ticks; i++) this.step();
  }

  private runTimeline(): void {
    const t = this.timeMs;
    if (this.deferred.length) {
      const still: ScenarioEvent[] = [];
      for (const ev of this.deferred) {
        if (ev.kind !== 'begin_dispersal') continue;
        const g = this.groupByKey(ev.groupKey);
        if (g && g.phase === 'settled') this.beginDispersal(g.id, ev.exit, ev.durationMs, { kind: 'scenario_event', refId: ev.id, note: ev.reason });
        else if (g && g.phase !== 'dispersed' && g.phase !== 'dispersing') still.push(ev);
      }
      this.deferred = still;
    }
    while (this.nextEvent < this.timeline.length && (this.timeline[this.nextEvent] as ScenarioEvent).atMs <= t) {
      const ev = this.timeline[this.nextEvent++] as ScenarioEvent;
      const cause: Cause = { kind: 'scenario_event', refId: ev.id, note: ev.reason };
      switch (ev.kind) {
        case 'spawn_group':
          this.createGroup(ev.spec, cause);
          break;
        case 'close_street':
          this.closeStreet(ev.edgeId, cause);
          break;
        case 'open_street':
          this.openStreet(ev.edgeId, cause);
          break;
        case 'begin_dispersal': {
          const g = this.groupByKey(ev.groupKey);
          if (g && (!ev.whenSettled || g.phase === 'settled')) this.beginDispersal(g.id, ev.exit, ev.durationMs, cause);
          else if (ev.whenSettled) this.deferred.push(ev);
          break;
        }
        case 'split_group': {
          const g = this.groupByKey(ev.groupKey);
          if (g) this.splitGroup(g.id, ev.count, ev.child, cause);
          break;
        }
      }
    }
  }

  // ------------------------------------------------------------------ groupes

  private updateGroup(g: CrowdGroup): void {
    const p = this.params;
    const dt = p.tickMs / 1000;
    if (g.phase === 'dispersing') {
      g.members.activeStart = goneCount(g, this.timeMs);
      if (g.members.activeStart >= g.members.n) {
        g.phase = 'dispersed';
        this.log('info', 'group.dispersed', `${g.label} : le rassemblement s’est dispersé.`, { kind: 'transition', refId: g.id, note: 'tous les participants ont quitté la zone' }, { type: 'group', id: g.id });
      }
      return;
    }
    if (g.phase === 'settled' || g.phase === 'dispersed') return;
    if (g.phase === 'forming') {
      if (this.timeMs < g.startAtMs) return;
      g.phase = 'moving';
      this.log('info', 'group.departed', `${g.label} : départ du cortège.`, { kind: 'scenario_plan', refId: g.origin.refId, note: `départ prévu au plan du scénario (T+${Math.round(g.startAtMs / 1000)} s)` }, { type: 'group', id: g.id });
    }
    if (!g.route) {
      // pas d'itinéraire à la création : nouvelle tentative périodique
      if (this.tick - g.lastRetryTick >= p.waitRetryTicks) {
        g.lastRetryTick = this.tick;
        const from = g.layout?.anchor ?? { x: 0, y: 0 };
        const plan = this.planRoute(from, g.plan);
        if (plan) this.adoptRoute(g, plan.route, from);
      }
      return;
    }
    const route = g.route;
    const len = route.length;
    const arriving = g.sCentre + g.columnLength / 2 >= len;

    // validité de la suite de l'itinéraire (tête de colonne → destination)
    if (!arriving && (this.state.version !== g.lastRouteStateVersion || (g.phase === 'waiting' && this.tick - g.lastRetryTick >= p.waitRetryTicks))) {
      g.lastRetryTick = this.tick;
      this.checkRoute(g);
    }

    // vitesse
    if (g.phase === 'waiting') {
      g.speedMps = 0;
      g.speedCause = 'attente : aucun itinéraire';
      if (g.plan.patienceMs > 0 && g.waitingSinceMs !== null && this.timeMs - g.waitingSinceMs > g.plan.patienceMs && !g.patienceReported) {
        g.patienceReported = true;
        this.log('alert', 'group.patience_exceeded', `${g.label} : attente prolongée (${Math.round((this.timeMs - g.waitingSinceMs) / 1000)} s) sans itinéraire.`, { kind: 'rule', refId: g.id, note: 'patience du groupe dépassée' }, { type: 'group', id: g.id });
      }
    } else {
      this.computeSpeed(g);
      g.sCentre += g.speedMps * dt;
    }

    // géométrie de la colonne (variation bornée : pas de saut de position)
    const n = g.members.n;
    if (g.phase === 'moving' && !arriving) {
      const geo = this.columnGeometry(g, n);
      g.frontWidth += Math.max(-5 * dt, Math.min(5 * dt, geo.width - g.frontWidth));
      g.columnLength += Math.max(-p.columnLengthRateMps * dt, Math.min(p.columnLengthRateMps * dt, geo.length - g.columnLength));
    }

    // arrivée : la tête atteint la fin de la route ; les individus s'absorbent un à un
    if (arriving && g.settleAtS === Infinity && g.plan.destination) {
      this.beginArrival(g);
    }
    if (g.settleAtS !== Infinity && g.sCentre >= g.settleAtS) this.settle(g);
  }

  private computeSpeed(g: CrowdGroup): void {
    const p = this.params;
    const v0 = g.speedOverride ?? (g.kind === 'secondary' ? p.speedByKind.secondary : p.speedByKind.march);
    const widthF = Math.max(p.narrowStreetMinFactor, Math.min(1, g.frontWidth / p.referenceStreetWidthM));
    const cohF = 0.6 + 0.4 * (g.cohesion / 100);
    const otherF = g.otherCrowdFactor;
    const f = Math.min(widthF, cohF, otherF);
    g.speedMps = v0 * f;
    g.speedCause = f >= 0.999 ? 'libre' : f === otherF ? 'autre foule dense sur le trajet' : f === widthF ? 'rue étroite' : 'cohésion faible';
  }

  private beginArrival(g: CrowdGroup): void {
    const route = g.route as Route;
    const n = g.members.n;
    const lay = g.layout;
    g.columnLength = Math.max(g.columnLength, 1);
    let need = g.sCentre;
    if (lay) {
      const end = routeFrame(g, this.motionCtx(), route, true);
      const L = g.columnLength;
      for (let i = g.members.activeStart; i < n; i++) {
        const slot = g.members.slotOf[i] as number;
        const e = frameEntry(end, g.members.lat[i] as number);
        const dist = Math.hypot((lay.pts[2 * slot] as number) - e.x, (lay.pts[2 * slot + 1] as number) - e.y);
        const a = ((i + 0.5) / n - 0.5) * L;
        need = Math.max(need, route.length + dist - a);
      }
    }
    g.settleAtS = need;
    this.log('info', 'group.arriving', `${g.label} : la tête du cortège atteint ${g.plan.destination?.label ?? 'la destination'}.`, { kind: 'transition', refId: g.id, note: 'la tête de colonne a atteint la fin de l’itinéraire' }, { type: 'group', id: g.id });
  }

  private settle(g: CrowdGroup): void {
    const dest = g.plan.destination as Anchor;
    if (g.plan.onArrival === 'join_target' && g.plan.joinTargetId) {
      const target = this.group(g.plan.joinTargetId);
      if (target && target.phase === 'settled') {
        this.mergeInto(target, g);
        return;
      }
      this.log('warn', 'group.join_failed', `${g.label} : le rassemblement à rejoindre n’est plus disponible, le groupe s’installe sur place.`, { kind: 'rule', refId: g.id, note: 'cible de jonction indisponible' }, { type: 'group', id: g.id });
    }
    g.kind = 'static';
    g.phase = 'settled';
    g.anchor = dest;
    g.speedMps = 0;
    g.speedCause = 'à l’arrêt';
    this.log('info', 'group.settled', `${g.label} : arrivé à ${dest.label}, devient un rassemblement statique de ${this.size(g)} personnes.`, { kind: 'transition', refId: g.id, note: `arrivée à destination (${dest.label}) : le cortège s’installe` }, { type: 'group', id: g.id }, { size: this.size(g) });
  }

  private adoptRoute(g: CrowdGroup, route: Route, _from: Vec2): void {
    this.ensureEvaluated(g);
    const m = g.members;
    const fromX = Float32Array.from(m.x);
    const fromY = Float32Array.from(m.y);
    const n = m.n;
    g.route = route;
    g.sCentre = 0;
    const geo = this.columnGeometry(g, n);
    g.frontWidth = geo.width;
    g.columnLength = geo.length;
    if (g.entry === 'gateway') g.sCentre = -geo.length / 2;
    const dest = g.plan.destination;
    if (dest) {
      locate(route, route.length, loc);
      g.layout = createLayout({ x: loc.x, y: loc.y }, this.params.staticDensity, g.seed);
      extendLayout(g.layout, n, this.mask, this.params.staticMaxRadiusM, g.seed);
      for (let i = 0; i < n; i++) m.slotOf[i] = n - 1 - i;
    }
    g.phase = 'moving';
    g.waitingSinceMs = null;
    this.applyBlend(g, fromX, fromY);
    this.log('info', 'group.route_found', `${g.label} : un itinéraire est maintenant disponible (${Math.round(route.length)} m).`, { kind: 'transition', refId: g.id, note: 'itinéraire devenu disponible' }, { type: 'group', id: g.id });
  }

  /** Vérifie la suite de l'itinéraire devant la tête de colonne ; replanifie ou attend (T3, T3b, T4). */
  private checkRoute(g: CrowdGroup): void {
    const route = g.route as Route;
    g.lastRouteStateVersion = this.state.version;
    const headS = Math.min(route.length, g.sCentre + g.columnLength / 2);
    const ei = edgeIndexAt(route, headS);
    const blockedIdx = this.nav.firstBlockedEdge(route, ei + 1, this.softZone(g.plan));
    if (blockedIdx < 0) {
      if (g.phase === 'waiting') {
        g.phase = 'moving';
        g.waitingSinceMs = null;
        g.patienceReported = false;
        this.log('info', 'group.resumed', `${g.label} : la route est de nouveau libre, le cortège repart.`, { kind: 'transition', refId: g.id, note: 'plus d’obstacle sur l’itinéraire' }, { type: 'group', id: g.id });
      }
      return;
    }
    const blockedEdge = route.edges[blockedIdx] as number;
    const name = this.graph.edgeName[blockedEdge] ?? `tronçon ${blockedEdge}`;
    const closeCause = this.closedBy.get(blockedEdge);
    const why: Cause = closeCause ?? { kind: 'rule', refId: String(blockedEdge), note: `${name} saturée par une foule dense` };
    if (ei >= route.edges.length - 1) return; // la tête est déjà sur la dernière arête
    // replanification depuis la tête, sans demi-tour, vers les points de passage restants puis la destination
    const headEdge = route.edges[ei] as number;
    locate(route, headS, loc);
    const headPt = { x: loc.x, y: loc.y };
    const proj = projectOnEdge(this.graph, headEdge, headPt);
    const toward = route.nodes[ei];
    const dest = g.plan.destination;
    if (!dest || toward === undefined) return;
    const remaining = g.plan.waypoints.filter((w) => Math.hypot(w.pos.x - headPt.x, w.pos.y - headPt.y) > 1).map((w) => w.pos);
    const legs: Vec2[] = [...remaining, dest.pos];
    const parts: Route[] = [];
    let cur = headPt;
    let ok = true;
    for (let k = 0; k < legs.length; k++) {
      const r = this.nav.findRoute(cur, legs[k] as Vec2, 'crowd', k === 0 ? { start: { edge: headEdge, t: proj.t, toward }, soft: this.softZone(g.plan) } : { soft: this.softZone(g.plan) });
      if (!r) {
        ok = false;
        break;
      }
      parts.push(r);
      cur = legs[k] as Vec2;
    }
    if (ok) {
      const oldRemaining = route.length - headS;
      const joined = joinRoutes([truncateRoute(route, headS), ...parts]);
      const added = joined.length - headS - oldRemaining;
      g.route = joined;
      // la disposition d'arrivée suit la nouvelle fin de route (identique si la destination est inchangée)
      if (g.phase === 'waiting') {
        g.phase = 'moving';
        g.waitingSinceMs = null;
        g.patienceReported = false;
      }
      this.log('info', 'group.rerouted', `${g.label} : ${name} bloquée, itinéraire modifié (${added >= 0 ? '+' : ''}${Math.round(added)} m).`, why, { type: 'group', id: g.id }, { deltaM: Math.round(added) });
    } else if (g.phase !== 'waiting') {
      g.phase = 'waiting';
      g.waitingSinceMs = this.timeMs;
      g.patienceReported = false;
      this.log('warn', 'group.waiting', `${g.label} : ${name} bloquée et aucun itinéraire alternatif — le groupe reste sur place.`, why, { type: 'group', id: g.id });
    }
  }

  // ------------------------------------------------------------------ états de rue

  private groupCentre(g: CrowdGroup): Vec2 | null {
    if (g.kind !== 'static' && g.route && (g.phase === 'moving' || g.phase === 'waiting' || g.phase === 'forming')) {
      locate(g.route, Math.max(0, Math.min(g.route.length, g.sCentre)), loc);
      return { x: loc.x, y: loc.y };
    }
    if (g.anchor) return g.anchor.pos;
    return g.layout?.anchor ?? null;
  }

  private updateStreetStates(): void {
    const feet: CrowdFootprint[] = [];
    const owners: CrowdGroup[] = [];
    for (const g of this.groups) {
      const size = this.size(g);
      if (size <= 0) continue;
      if (g.kind !== 'static' && g.route && g.phase !== 'dispersed') {
        feet.push({ kind: 'march', route: g.route, centreS: g.sCentre, columnLength: Math.max(1, g.columnLength), size, frontWidth: g.frontWidth });
        owners.push(g);
      } else if (g.layout) {
        const radius = Math.max(8, g.layout.rMax + 3);
        feet.push({ kind: 'static', center: g.layout.anchor, radius, size, density: g.layout.density });
        owners.push(g);
      }
    }
    const own: Array<Map<number, number>> = feet.map(() => new Map());
    accumulateLoads(this.graph, this.nav.grid, feet, this.state, this.params.nav, (fi, e, l) => {
      const m = own[fi] as Map<number, number>;
      m.set(e, (m.get(e) ?? 0) + l);
    });
    deriveStates(this.graph, this.state, this.params.nav);
    // facteur de vitesse dû aux AUTRES foules sur les rues de la colonne
    const p = this.params.nav;
    for (let k = 0; k < feet.length; k++) {
      const f = feet[k] as CrowdFootprint;
      const g = owners[k] as CrowdGroup;
      if (f.kind !== 'march') {
        g.otherCrowdFactor = 1;
        continue;
      }
      const route = f.route;
      const s0 = Math.max(0, f.centreS - f.columnLength / 2);
      const s1 = Math.min(route.length, f.centreS + f.columnLength / 2 + this.params.lookAheadM);
      let factor = 1;
      const i0 = edgeIndexAt(route, s0);
      const i1 = edgeIndexAt(route, s1);
      const mine = own[k] as Map<number, number>;
      for (let i = i0; i <= i1; i++) {
        const e = route.edges[i] as number;
        const other = (this.state.load[e] as number) - (mine.get(e) ?? 0);
        if (other <= 0) continue;
        const pres = (this.state.presence[e] as number) > 0 ? Math.max(1, this.state.presence[e] as number) : (this.graph.edgeLen[e] as number);
        const rho = other / Math.max(1e-6, pres * (this.graph.edgeWidth[e] as number));
        factor = Math.min(factor, Math.max(p.minSpeedFactor, Math.min(1, 1 - rho / p.jamDensity)));
      }
      g.otherCrowdFactor = factor;
    }
  }

  // ------------------------------------------------------------------ niveaux de simulation

  private chooseLevels(): void {
    const lod = this.params.lod;
    for (const g of this.groups) {
      const pinned = this.pinned.has(g.id);
      if (this.foci && !pinned && usesBlocks(g, lod)) {
        g.blocks = selectBlockLevels(g, this.foci, lod);
        let top: SimLevel = 0;
        for (const l of g.blocks.level) if (l > top) top = l as SimLevel;
        g.level = top;
        continue;
      }
      if (g.blocks) {
        // retour à un niveau unique : les blocs restés en N0 doivent être réalignés sur leurs cibles
        if (g.blocks.stale.some((v) => v === 1)) g.needsSnap = true;
        g.blocks = null;
      }
      let level: SimLevel = lod.defaultLevel;
      if (pinned) level = 2;
      else if (this.foci) {
        const c = this.groupCentre(g);
        if (c) {
          const radius = g.kind !== 'static' && g.route ? g.columnLength / 2 + 10 : (g.layout?.rMax ?? 10) + 5;
          level = levelFor(distanceToFoci(c.x, c.y, this.foci) - radius, lod, g.level);
        }
      }
      if (level !== g.level) {
        if (g.level === 0) g.needsSnap = true;
        g.level = level;
      }
    }
  }

  // ------------------------------------------------------------------ hash

  /** Empreinte de l'état : même graine + mêmes commandes ⇒ même empreinte (tests de reproductibilité). */
  stateHash(): string {
    let h = 0x811c9dc5;
    const mix = (v: number) => {
      h ^= v | 0;
      h = Math.imul(h, 0x01000193) >>> 0;
    };
    mix(this.tick);
    for (const g of this.groups) {
      for (let i = 0; i < g.id.length; i++) mix(g.id.charCodeAt(i));
      mix(g.members.n);
      mix(g.members.activeStart);
      mix(g.phase.length * 131 + g.phase.charCodeAt(0));
      mix(Math.round(g.sCentre * 100));
      mix(Math.round(g.columnLength * 100));
      const m = g.members;
      for (let i = m.activeStart; i < m.n; i += Math.max(1, (m.n / 512) | 0)) {
        mix(Math.round((m.x[i] as number) * 100));
        mix(Math.round((m.y[i] as number) * 100));
      }
    }
    for (const e of [...this.units, ...this.vehicles]) {
      mix(Math.round(e.x * 100));
      mix(Math.round(e.y * 100));
      mix(Math.round(e.heading * 1000));
    }
    mix(this.journal.count);
    mix(this.state.version);
    return (h >>> 0).toString(16).padStart(8, '0');
  }
}
