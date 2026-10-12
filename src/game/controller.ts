import type { Vec2 } from '../geo/mercator';
import { SimClock, type SimSpeed } from '../engine/clock';
import { Sim } from '../engine/sim';
import type { SimParams } from '../engine/params';
import type { DeepPartial } from '../engine/params';
import type { Cause, CrowdGroup, Focus, Id, IncidentStats, LogEvent, MoverEntity, OrderResult } from '../engine/types';
import type { StreetGraph } from '../nav/graph';
import { buildDemoScenario, type DemoScenario } from '../scenarios/demoScenario';
import { SelectionIndex, sameRef, type EntityRef } from './selection';
import { DEFAULT_ZONE_LEVEL, ZONE_LEVELS } from './zones';

export interface ControllerOptions {
  graph: StreetGraph;
  seed?: number;
  zoneLevel?: number;
  params?: DeepPartial<SimParams>;
  /** Scénario fourni (tests) ; sinon le scénario de démonstration. */
  scenario?: DemoScenario;
}

export interface GameStats {
  people: number;
  forces: number;
  units: number;
  vehicles: number;
  streets: { total: number; blocked: number; partial: number; slowed: number; scenarioClosed: number };
  simTimeMs: number;
  /** Incidents (phase 4) : lus depuis l'état du moteur. */
  incidents: IncidentStats;
}

const orderCause = (note: string): Cause => ({ kind: 'player_order', refId: 'joueur', note });

/**
 * Pont entre le moteur et l'interface : horloge de jeu à pas fixe, foyer d'attention déduit de la vue de la carte,
 * sélection, ordres du joueur, flux d'événements du journal. Aucune dépendance à la carte ni au DOM.
 */
export class GameController {
  readonly sim: Sim;
  readonly clock = new SimClock();
  readonly scenario: DemoScenario;
  readonly picker: SelectionIndex;
  selection: EntityRef[] = [];
  /** Heure du jour (secondes depuis minuit) au début de la partie. */
  readonly dayStartSec: number;
  zoneLevel: number;
  /** Derniers ordres refusés ou acceptés (affichés par l'interface). */
  lastOrders: OrderResult[] = [];
  private focus: Focus = { x: 0, y: 0, radius: 400 };
  private seenJournal = 0;

  constructor(o: ControllerOptions) {
    this.zoneLevel = o.zoneLevel ?? DEFAULT_ZONE_LEVEL;
    const zone = ZONE_LEVELS[this.zoneLevel] ?? ZONE_LEVELS[0]!;
    this.scenario = o.scenario ?? buildDemoScenario(o.graph, { zone });
    this.sim = new Sim({ graph: o.graph, seed: o.seed ?? 20240607, params: o.params, timeline: this.scenario.timeline, zone });
    this.dayStartSec = this.scenario.clockStartSec;
    this.scenario.setup(this.sim);
    this.picker = new SelectionIndex(this.sim);
    this.clock.setSpeed(1);
    this.updateFoci();
  }

  // ------------------------------------------------------------------ temps

  get speed(): SimSpeed {
    return this.clock.speed;
  }

  setSpeed(s: SimSpeed): void {
    this.clock.setSpeed(s);
  }

  /** Avance la simulation du temps réel écoulé ; retourne le nombre de ticks exécutés. */
  advance(realDeltaMs: number): number {
    const n = this.clock.advance(realDeltaMs);
    if (n > 0) {
      this.updateFoci();
      for (let i = 0; i < n; i++) this.sim.step();
    }
    return n;
  }

  /** Fraction du tick courant écoulée (interpolation du rendu). */
  get alpha(): number {
    return this.clock.alpha;
  }

  /** Avance de `ticks` pas sans passer par l'horloge (tests, banc d'essai). */
  runTicks(ticks: number): void {
    this.updateFoci();
    this.sim.run(ticks);
  }

  /** Heure du jour (secondes depuis minuit) correspondant au temps de simulation courant. */
  get clockSec(): number {
    return this.dayStartSec + this.sim.timeMs / 1000;
  }

  // ------------------------------------------------------------------ foyer d'attention

  /** Foyer = ce que le joueur voit : centre de la vue et demi-diagonale (m). */
  setView(centerLocal: Vec2, halfDiagonalM: number): void {
    this.focus = { x: centerLocal.x, y: centerLocal.y, radius: Math.max(50, halfDiagonalM) };
    this.updateFoci();
  }

  private updateFoci(): void {
    const pinned: Id[] = [];
    for (const r of this.selection) if (r.type === 'group') pinned.push(r.id);
    this.sim.setFoci([this.focus], pinned);
  }

  // ------------------------------------------------------------------ zone

  setZoneLevel(level: number): void {
    this.zoneLevel = Math.max(0, Math.min(ZONE_LEVELS.length - 1, level));
    this.sim.setZone(ZONE_LEVELS[this.zoneLevel]);
  }

  // ------------------------------------------------------------------ sélection

  pick(p: Vec2, tolM: number, precise: boolean): EntityRef | null {
    return this.picker.pick(p, tolM, precise);
  }

  /** Remplace la sélection (ou l'étend pour les unités et véhicules avec `additive`). */
  select(ref: EntityRef | null, additive = false): void {
    if (!ref) {
      this.selection = [];
    } else if (additive && ref.type !== 'group' && this.selection.every((r) => r.type !== 'group')) {
      this.selection = this.selection.some((r) => sameRef(r, ref)) ? this.selection.filter((r) => !sameRef(r, ref)) : [...this.selection, ref];
    } else this.selection = [ref];
    this.updateFoci();
    for (const r of this.selection) if (r.type === 'group') {
      const g = this.sim.group(r.id);
      if (g) this.sim.ensureEvaluated(g);
    }
  }

  isSelected(ref: EntityRef): boolean {
    return this.selection.some((r) => sameRef(r, ref));
  }

  get primary(): EntityRef | null {
    return this.selection[0] ?? null;
  }

  selectedMovers(): MoverEntity[] {
    const out: MoverEntity[] = [];
    for (const r of this.selection) {
      if (r.type === 'group') continue;
      if (r.type === 'incident' || r.type === 'poi') continue;
      const e = this.sim.entity(r.id);
      if (e) out.push(e);
    }
    return out;
  }

  // ------------------------------------------------------------------ ordres

  /** Ordre de déplacement vers un point pour toute la sélection (unités et véhicules), traité immédiatement. */
  orderMove(target: Vec2): OrderResult[] {
    const ids = this.selectedMovers().map((e) => e.id);
    if (!ids.length) return [];
    this.lastOrders = this.sim.issueOrder({ kind: 'move', ids, target });
    return this.lastOrders;
  }

  /** Véhicules sélectionnés (les unités à pied n'ont pas d'avertisseurs). */
  selectedVehicles(): MoverEntity[] {
    return this.selectedMovers().filter((e) => e.entity === 'vehicle');
  }

  /** Active ou coupe les avertisseurs de tous les véhicules sélectionnés. */
  setLights(on: boolean): OrderResult[] {
    const ids = this.selectedVehicles().map((e) => e.id);
    if (!ids.length) return [];
    this.lastOrders = this.sim.issueOrder({ kind: 'lights', ids, on });
    return this.lastOrders;
  }

  cancelOrders(): OrderResult[] {
    const ids = this.selectedMovers().map((e) => e.id);
    if (!ids.length) return [];
    this.lastOrders = this.sim.issueOrder({ kind: 'cancel', ids });
    return this.lastOrders;
  }

  // ------------------------------------------------------------------ lecture

  /** Événements de journal apparus depuis le dernier appel. */
  newEvents(): LogEvent[] {
    const ev = this.sim.journal.events;
    const out = ev.filter((e) => e.id > this.seenJournal);
    if (out.length) this.seenJournal = out[out.length - 1]!.id;
    return out;
  }

  stats(): GameStats {
    const s = this.sim;
    let forces = 0;
    for (const u of s.units) forces += u.headcount;
    return { people: s.totalPeople(), forces, units: s.units.length, vehicles: s.vehicles.length, streets: s.streetCounts(), simTimeMs: s.timeMs, incidents: s.incidents.stats() };
  }

  group(id: Id): CrowdGroup | undefined {
    return this.sim.group(id);
  }

  /** Position (m) d'un élément sélectionnable, pour recentrer la caméra. */
  positionOf(ref: EntityRef): Vec2 | null {
    if (ref.type === 'group') {
      const g = this.sim.group(ref.id);
      if (!g) return null;
      const m = g.members;
      const lo = Math.max(m.activeStart, g.entryStart);
      const n = Math.min(m.n, g.exitStart) - lo;
      if (n <= 0) return null;
      const i = lo + Math.floor(n / 2);
      return { x: m.x[i] as number, y: m.y[i] as number };
    }
    if (ref.type === 'incident') {
      const i = this.sim.incidents.get(ref.id);
      return i ? { x: i.x, y: i.y } : null;
    }
    if (ref.type === 'poi') {
      const p = this.sim.world.poi(ref.id);
      return p ? { x: p.x, y: p.y } : null;
    }
    const e = this.sim.entity(ref.id);
    return e ? { x: e.x, y: e.y } : null;
  }
}
