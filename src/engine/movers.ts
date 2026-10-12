import type { Vec2 } from '../geo/mercator';
import type { NavContext, SoftZone } from '../nav/astar';
import type { StreetGraph } from '../nav/graph';
import { edgeIndexAt, joinRoutes, locate, truncateRoute, type Located, type Route } from '../nav/route';
import { projectOnEdge } from '../nav/spatialGrid';
import type { EdgeState } from '../nav/streetState';
import type { SimParams } from './params';
import type { Cause, Id, LogEvent, Mover, MoverEntity, OrderRequest, OrderResult } from './types';

export interface MoverDeps {
  graph: StreetGraph;
  nav: NavContext;
  state: EdgeState;
  params: SimParams;
  timeMs: () => number;
  tick: () => number;
  log: (level: LogEvent['level'], code: string, text: string, why: Cause, subject: LogEvent['subject'], data?: LogEvent['data']) => void;
  /** Cause d'une fermeture de rue par le scénario, si connue. */
  closeCause: (edge: number) => Cause | undefined;
  nextOrderId: () => Id;
}

const loc: Located = { x: 0, y: 0, tx: 0, ty: 0, seg: 0 };
export const deltaText = (d: number): string => {
  const r = Math.round(d);
  return r === 0 ? 'longueur inchangée' : `${r > 0 ? '+' : ''}${r} m`;
};
const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * Déplacement des unités et véhicules sur le graphe de rues : accélération/décélération bornées, cap lissé
 * (rotation limitée pour un véhicule), replanification sur rue bloquée, attente sans itinéraire.
 * Les ordres sont toujours traités à l'intérieur d'un tick (ordres simultanés, déterministes).
 */
export class MoverSystem {
  constructor(private readonly d: MoverDeps) {}

  private subjectType(e: MoverEntity): 'unit' | 'vehicle' {
    return e.entity === 'unit' ? 'unit' : 'vehicle';
  }

  /** Place une entité sur le réseau (accrochage à l'arête la plus proche) ; null si le réseau est hors de portée. */
  /** Mode de navigation d'une entité : un véhicule à avertisseurs circule à contresens et plus vite. */
  private navMode(e: MoverEntity): 'foot' | 'vehicle' | 'emergency' {
    return e.mode === 'foot' ? 'foot' : e.entity === 'vehicle' && e.emergency ? 'emergency' : 'vehicle';
  }

  placeOnGraph(pos: Vec2, mode: 'foot' | 'vehicle'): Vec2 | null {
    const pr = this.d.nav.snap(pos, mode, 600);
    return pr ? pr.point : null;
  }

  private softZone(target: Vec2, mode: Mover['mode']): SoftZone | undefined {
    return mode === 'foot' ? { x: target.x, y: target.y, r: this.d.params.arrivalZoneM } : undefined;
  }

  /** Itinéraire d'aperçu (sans modifier l'état) pour l'interface : ligne fantôme avant validation d'un ordre. */
  preview(e: MoverEntity, target: Vec2): Route | null {
    return this.d.nav.findRoute({ x: e.x, y: e.y }, target, this.navMode(e), { soft: this.softZone(target, e.mode) });
  }

  /** Traite une demande d'ordre pour un ensemble d'entités (ordres simultanés, ordre déterministe par identifiant). */
  apply(req: OrderRequest, entities: ReadonlyMap<Id, MoverEntity>): OrderResult[] {
    const ids = [...new Set(req.ids)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const results: OrderResult[] = [];
    if (req.kind === 'lights') {
      for (const id of ids) {
        const e = entities.get(id);
        if (!e || e.entity !== 'vehicle') {
          results.push({ id, ok: false, reason: e ? 'seuls les véhicules ont des avertisseurs' : 'entité inconnue' });
          continue;
        }
        if (e.emergency === req.on) {
          results.push({ id, ok: true });
          continue;
        }
        e.emergency = req.on;
        const why: Cause = { kind: 'player_order', refId: id, note: `avertisseurs ${req.on ? 'activés' : 'coupés'} par le joueur` };
        this.d.log('info', req.on ? 'vehicle.lights_on' : 'vehicle.lights_off', `${e.callsign} : avertisseurs ${req.on ? 'activés — circulation rapide, sens interdits permis, prudence près de la foule' : 'coupés — circulation normale'}.`, why, { type: 'vehicle', id });
        // l'itinéraire en cours est recalculé avec les nouvelles règles (sens interdits, vitesse)
        if (e.order && e.route) {
          const fresh = this.d.nav.findRoute({ x: e.x, y: e.y }, e.order.target, this.navMode(e));
          if (fresh) {
            e.route = fresh;
            e.routeS = 0;
            e.lastRouteStateVersion = this.d.state.version;
          }
        }
        results.push({ id, ok: true });
      }
      return results;
    }
    if (req.kind === 'cancel') {
      for (const id of ids) {
        const e = entities.get(id);
        if (!e) {
          results.push({ id, ok: false, reason: 'entité inconnue' });
          continue;
        }
        if (!e.order) {
          results.push({ id, ok: false, reason: 'aucun ordre en cours' });
          continue;
        }
        const why: Cause = { kind: 'player_order', refId: e.order.id, note: `ordre de ${e.callsign} annulé par le joueur` };
        e.order = null;
        e.route = null;
        e.status = 'idle';
        e.waitingSinceMs = null;
        this.d.log('info', 'unit.cancelled', `${e.callsign} : ordre annulé, l’unité s’arrête.`, why, { type: this.subjectType(e), id });
        results.push({ id, ok: true });
      }
      return results;
    }
    // déplacement : les cibles sont légèrement décalées pour que les unités ne se superposent pas
    const spacing = this.d.params.units.formationSpacingM;
    ids.forEach((id, k) => {
      const e = entities.get(id);
      if (!e) {
        results.push({ id, ok: false, reason: 'entité inconnue' });
        return;
      }
      const ring = Math.sqrt(k) * spacing;
      const ang = k * 2.399963;
      const target = { x: req.target.x + ring * Math.cos(ang), y: req.target.y + ring * Math.sin(ang) };
      const route = this.d.nav.findRoute({ x: e.x, y: e.y }, target, this.navMode(e), { soft: this.softZone(target, e.mode) });
      if (!route) {
        const why: Cause = { kind: 'player_order', refId: 'refus', note: 'ordre du joueur impossible à exécuter' };
        this.d.log('warn', 'unit.order_refused', `${e.callsign} : ordre refusé — aucun itinéraire ${e.mode === 'vehicle' ? 'praticable par un véhicule' : 'praticable'} vers la destination.`, why, { type: this.subjectType(e), id });
        results.push({ id, ok: false, reason: 'aucun itinéraire vers la destination' });
        return;
      }
      const orderId = this.d.nextOrderId();
      const why: Cause = { kind: 'player_order', refId: orderId, note: `ordre du joueur : ${e.callsign} se rend à (${Math.round(target.x)} ; ${Math.round(target.y)})` };
      e.order = { id: orderId, kind: 'move', target, cause: why, issuedAtMs: this.d.timeMs() };
      e.route = route;
      e.routeS = 0;
      e.status = 'moving';
      e.waitingSinceMs = null;
      e.lastRouteStateVersion = this.d.state.version;
      this.d.log('info', 'unit.order', `${e.callsign} : ordre reçu, itinéraire de ${Math.round(route.length)} m.`, why, { type: this.subjectType(e), id }, { routeLengthM: Math.round(route.length) });
      results.push({ id, ok: true, routeLengthM: route.length });
    });
    return results;
  }

  /** Avance une entité d'un tick. */
  step(e: MoverEntity): void {
    const p = this.d.params.units;
    const dt = this.d.params.tickMs / 1000;
    e.px = e.x;
    e.py = e.y;
    e.prevHeading = e.heading;
    const vehicle = e.mode === 'vehicle';
    const emergency = e.entity === 'vehicle' && e.emergency;
    let vmax = vehicle ? p.vehicleSpeedMps : p.footSpeedMps;
    const accel = vehicle ? p.vehicleAccelMps2 : p.footAccelMps2;
    const decel = vehicle ? p.vehicleDecelMps2 : p.footDecelMps2;
    const turn = vehicle ? p.vehicleTurnRateRadPerS : p.footTurnRateRadPerS;

    const route = e.route;
    if (!route || !e.order) {
      // à l'arrêt : le véhicule freine, la position ne change pas
      e.speedMps = Math.max(0, e.speedMps - decel * dt);
      return;
    }

    if (e.status === 'waiting' || this.d.state.version !== e.lastRouteStateVersion) {
      if (e.status !== 'waiting' || this.d.tick() - e.lastRetryTick >= this.d.params.waitRetryTicks || this.d.state.version !== e.lastRouteStateVersion) {
        e.lastRetryTick = this.d.tick();
        this.checkRoute(e);
      }
    }
    if (e.status === 'waiting') {
      e.speedMps = Math.max(0, e.speedMps - decel * dt);
      return;
    }

    const r = e.route as Route;
    const remaining = r.length - e.routeS;
    // vitesse admissible : limitée par la vitesse max, l'état de la rue et le freinage avant l'arrivée
    const ei = edgeIndexAt(r, e.routeS);
    const edge = r.edges[ei] as number;
    const st = this.d.state;
    // limite de vitesse de la classe de voie (les avertisseurs permettent de la dépasser, jusqu'à un plafond)
    if (vehicle) {
      const lim = this.d.nav.vehicleSpeedOn(edge) || 4;
      vmax = emergency ? Math.min(p.vehicleEmergencySpeedMps, lim * this.d.params.nav.emergencySpeedFactor) : Math.min(p.vehicleSpeedMps, lim);
    }
    let factor = 1;
    let floorSpeed = 0;
    if (vehicle) {
      const s = st.vehState[edge] as number;
      factor = s === 0 ? 1 : s === 1 ? 0.7 : 0.35;
      // plancher : avertisseurs allumés, on n'est jamais plus lent que sans avertisseurs sur la même rue
      floorSpeed = emergency ? Math.min(p.vehicleSpeedMps, this.d.nav.vehicleSpeedOn(edge) || 4) * factor : 0;
      // avertisseurs actifs : on ralentit à l'approche d'une foule, sinon on roule à pleine vitesse
      if (emergency) {
        for (let k = ei; k < r.edges.length; k++) {
          const d = Math.max(0, (r.edgeStart[k] as number) - e.routeS);
          if (d >= p.emergencyCrowdSlowM) break;
          if ((st.load[r.edges[k] as number] as number) >= 10) {
            factor *= p.emergencyCrowdFactor + (1 - p.emergencyCrowdFactor) * (d / p.emergencyCrowdSlowM);
            break;
          }
        }
      }
    } else factor = st.speedFactor[edge] as number;
    const brake = Math.sqrt(Math.max(0, 2 * decel * Math.max(0, remaining - p.arrivalToleranceM * 0.5)));
    const target = Math.min(Math.max(vmax * factor, floorSpeed), brake);
    if (e.speedMps < target) e.speedMps = Math.min(target, e.speedMps + accel * dt);
    else e.speedMps = Math.max(target, e.speedMps - decel * dt);
    e.routeS = Math.min(r.length, e.routeS + e.speedMps * dt);

    locate(r, e.routeS, loc);
    e.x = loc.x;
    e.y = loc.y;
    const desired = Math.atan2(loc.ty, loc.tx);
    if (e.speedMps > 0.05) {
      const delta = wrapAngle(desired - e.heading);
      e.heading = wrapAngle(e.heading + Math.max(-turn * dt, Math.min(turn * dt, delta)));
    }

    if (remaining <= p.arrivalToleranceM && e.speedMps < 0.3) this.arrive(e);
    else if (e.routeS >= r.length - 1e-6) this.arrive(e);
  }

  private arrive(e: MoverEntity): void {
    const order = e.order;
    e.route = null;
    e.order = null;
    e.status = 'idle';
    e.speedMps = 0;
    e.waitingSinceMs = null;
    if (order) {
      this.d.log('info', 'unit.arrived', `${e.callsign} : arrivé à destination.`, { kind: 'transition', refId: order.id, note: `ordre ${order.id} accompli` }, { type: this.subjectType(e), id: e.id });
    }
  }

  /** Vérifie la suite de l'itinéraire ; replanifie sans demi-tour, attend sans itinéraire, reprend dès que possible. */
  private checkRoute(e: MoverEntity): void {
    const route = e.route as Route;
    const order = e.order as NonNullable<Mover['order']>;
    e.lastRouteStateVersion = this.d.state.version;
    const soft = this.softZone(order.target, e.mode);
    const ei = edgeIndexAt(route, e.routeS);
    const blockedIdx = this.d.nav.firstBlockedEdge(route, ei + 1, soft);
    if (blockedIdx < 0) {
      if (e.status === 'waiting') {
        e.status = 'moving';
        e.waitingSinceMs = null;
        this.d.log('info', 'unit.resumed', `${e.callsign} : la route est libre, l’unité repart.`, { kind: 'transition', refId: order.id, note: 'plus d’obstacle sur l’itinéraire' }, { type: this.subjectType(e), id: e.id });
      }
      return;
    }
    const blockedEdge = route.edges[blockedIdx] as number;
    const name = this.d.graph.edgeName[blockedEdge] ?? `tronçon ${blockedEdge}`;
    const why: Cause = this.d.closeCause(blockedEdge) ?? { kind: 'rule', refId: String(blockedEdge), note: `${name} saturée par une foule` };
    const toward = route.nodes[ei];
    if (ei < route.edges.length - 1 && toward !== undefined) {
      const headEdge = route.edges[ei] as number;
      const proj = projectOnEdge(this.d.graph, headEdge, { x: e.x, y: e.y });
      const fresh = this.d.nav.findRoute({ x: e.x, y: e.y }, order.target, this.navMode(e), { start: { edge: headEdge, t: proj.t, toward }, soft });
      if (fresh) {
        const added = e.routeS + fresh.length - route.length;
        e.route = joinRoutes([truncateRoute(route, e.routeS), fresh]);
        if (e.status === 'waiting') {
          e.status = 'moving';
          e.waitingSinceMs = null;
        }
        this.d.log('info', 'unit.rerouted', `${e.callsign} : ${name} bloquée, itinéraire modifié (${deltaText(added)}).`, why, { type: this.subjectType(e), id: e.id }, { deltaM: Math.round(added) });
        return;
      }
    }
    if (e.status !== 'waiting') {
      e.status = 'waiting';
      e.waitingSinceMs = this.d.timeMs();
      this.d.log('warn', 'unit.waiting', `${e.callsign} : ${name} bloquée et aucun itinéraire alternatif — l’unité attend.`, why, { type: this.subjectType(e), id: e.id });
    }
  }
}
