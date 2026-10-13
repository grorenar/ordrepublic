import type { Vec2 } from '../geo/mercator';
import { NavContext } from '../nav/astar';
import type { StreetGraph } from '../nav/graph';
import { DEFAULT_NAV_PARAMS } from '../nav/params';
import { createEdgeState, setScenarioBlock } from '../nav/streetState';
import type { Anchor, Cause, ForceKind } from '../engine/types';
import { hash32, unit } from '../engine/rng';
import type { ScenarioEvent, Sim } from '../engine/sim';
import type { DemoScenario } from './demoScenario';

/**
 * Plan d'opération du mode bac à sable : une manifestation « déclarée » (départ, arrivée, heure, effectif attendu avec
 * incertitude, points de passage imposés) et un dispositif (axes fermés, unités placées). C'est une DONNÉE pure,
 * sérialisable (JSON versionné) ; `compilePlan` la transforme en scénario du moteur (chronologie d'événements causés).
 */
export interface OperationPlan {
  version: 1;
  name: string;
  start: Vec2;
  end: Vec2;
  /** Heure du jour du départ du cortège (secondes depuis minuit). */
  departClockSec: number;
  /** Effectif déclaré en préfecture. */
  declaredSize: number;
  /** Incertitude (±%) : l'effectif réel est tiré autour de l'effectif déclaré (plus ou moins nombreux). */
  uncertaintyPct: number;
  /** Points de passage imposés dans l'ordre : itinéraire forcé. */
  waypoints: Vec2[];
  /** Axes fermés (un point sur chacun ; l'axe est retrouvé dans le graphe à la compilation). */
  closures: Vec2[];
  /** Unités placées à des points stratégiques. */
  units: Array<{ force: ForceKind; pos: Vec2; headcount: number }>;
  /** Durée du maintien sur place à l'arrivée avant la dispersion (minutes). */
  dwellMin: number;
  seed: number;
}

export class PlanError extends Error {}

export const PLAN_LEAD_S = 600;

export function emptyPlan(): OperationPlan {
  return { version: 1, name: 'Opération sans titre', start: { x: 0, y: 0 }, end: { x: 0, y: 0 }, departClockSec: 14 * 3600, declaredSize: 1500, uncertaintyPct: 30, waypoints: [], closures: [], units: [], dwellMin: 20, seed: 1 };
}

/** Effectif réel tiré autour de l'effectif déclaré (loi triangulaire bornée à ± incertitude), reproductible avec la graine du plan. */
export function actualSize(plan: Pick<OperationPlan, 'declaredSize' | 'uncertaintyPct' | 'seed'>): number {
  const u = unit(hash32(plan.seed, 0x51ed), 1) + unit(hash32(plan.seed, 0x7a11), 2) - 1; // [-1, 1], triangulaire
  return Math.max(1, Math.round(plan.declaredSize * (1 + (plan.uncertaintyPct / 100) * u)));
}

const isVec = (v: unknown): v is Vec2 => !!v && typeof (v as Vec2).x === 'number' && typeof (v as Vec2).y === 'number' && Number.isFinite((v as Vec2).x) && Number.isFinite((v as Vec2).y);

/** Lit un plan JSON (fichier importé) ; lève `PlanError` avec un message clair. */
export function parsePlan(json: unknown): OperationPlan {
  const p = json as Partial<OperationPlan> | null;
  if (!p || typeof p !== 'object' || p.version !== 1) throw new PlanError('Ce fichier n’est pas un plan d’opération Ordre Public (version 1).');
  if (!isVec(p.start) || !isVec(p.end)) throw new PlanError('Plan invalide : départ ou arrivée manquant.');
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  const base = emptyPlan();
  return {
    version: 1,
    name: typeof p.name === 'string' ? p.name.slice(0, 80) : base.name,
    start: p.start,
    end: p.end,
    departClockSec: Math.max(0, Math.min(86399, num(p.departClockSec, base.departClockSec))),
    declaredSize: Math.max(1, Math.min(200000, Math.round(num(p.declaredSize, base.declaredSize)))),
    uncertaintyPct: Math.max(0, Math.min(90, num(p.uncertaintyPct, base.uncertaintyPct))),
    waypoints: Array.isArray(p.waypoints) ? p.waypoints.filter(isVec) : [],
    closures: Array.isArray(p.closures) ? p.closures.filter(isVec) : [],
    units: Array.isArray(p.units) ? p.units.filter((u) => u && isVec(u.pos) && typeof u.force === 'string').map((u) => ({ force: u.force, pos: u.pos, headcount: Math.max(1, Math.round(num(u.headcount, 30))) })) : [],
    dwellMin: Math.max(0, Math.min(240, num(p.dwellMin, base.dwellMin))),
    seed: Math.round(num(p.seed, 1)),
  };
}

/** Sens de départ d'un cortège : direction (vecteur unitaire) des ~30 premiers mètres de l'itinéraire de `from` vers `to`, ou `undefined`. */
export function departureDirection(nav: NavContext, from: Vec2, to: Vec2): Vec2 | undefined {
  const r = nav.findRoute(from, to, 'crowd');
  if (!r || r.pts.length < 4) return undefined;
  const x0 = r.pts[0] as number;
  const y0 = r.pts[1] as number;
  for (let k = 2; k < r.pts.length; k += 2) {
    const dx = (r.pts[k] as number) - x0;
    const dy = (r.pts[k + 1] as number) - y0;
    const d = Math.hypot(dx, dy);
    if (d >= 30 || k >= r.pts.length - 2) return d > 1 ? { x: dx / d, y: dy / d } : undefined;
  }
  return undefined;
}

const placeAnchor = (id: string, label: string, pos: Vec2): Anchor => ({ id, kind: 'place', pos, radius: 20, label, source: 'synthetic' });

export interface CompiledPlan extends DemoScenario {
  /** Effectif réel tiré (inconnu du joueur avant le départ). */
  actualSize: number;
  /** Axes fermés retrouvés dans le graphe (indices d'arêtes). */
  closedEdges: number[];
  /** Longueur de l'itinéraire prévu (m). */
  routeLengthM: number;
}

const CALLSIGN: Record<ForceKind, string> = { crs: 'CRS', police_nationale: 'POL', gendarmerie_mobile: 'GM', unite_speciale: 'US' };

/**
 * Compile le plan en scénario : rassemblement au départ, mise en marche à l'heure dite avec l'itinéraire forcé, axes
 * fermés dès le début (barrières posées), unités en place, dispersion après le maintien sur place. Vérifie qu'un
 * itinéraire existe malgré les fermetures (sinon `PlanError` explicite : le joueur doit rouvrir un axe).
 */
export function compilePlan(graph: StreetGraph, plan: OperationPlan): CompiledPlan {
  const nav = new NavContext(graph, DEFAULT_NAV_PARAMS);
  const closedEdges: number[] = [];
  for (const c of plan.closures) {
    const pr = nav.snap(c, 'foot', 60);
    if (pr && !closedEdges.includes(pr.edge)) closedEdges.push(pr.edge);
  }
  const startA = placeAnchor('plan-depart', 'Point de départ', plan.start);
  const endA = placeAnchor('plan-arrivee', 'Point d’arrivée', plan.end);
  const wps = plan.waypoints.map((w, i) => placeAnchor(`plan-passage-${i + 1}`, `Point de passage ${i + 1}`, w));

  // vérification de faisabilité avec les axes fermés (itinéraire forcé compris)
  const state = createEdgeState(graph);
  for (const e of closedEdges) setScenarioBlock(state, e, true);
  const live = new NavContext(graph, DEFAULT_NAV_PARAMS, state);
  const blockedGraphCheck = (from: Vec2, to: Vec2): number | null => live.findRoute(from, to, 'crowd')?.length ?? null;
  const chain: Vec2[] = [plan.start, ...plan.waypoints, plan.end];
  let routeLengthM = 0;
  for (let i = 1; i < chain.length; i++) {
    const l = blockedGraphCheck(chain[i - 1] as Vec2, chain[i] as Vec2);
    if (l === null) throw new PlanError(i === chain.length - 1 && plan.waypoints.length === 0 ? 'Aucun itinéraire entre le départ et l’arrivée.' : `Aucun itinéraire pour le tronçon ${i} de l’itinéraire (départ, points de passage, arrivée).`);
    routeLengthM += l;
  }

  const size = actualSize(plan);
  const departS = PLAN_LEAD_S;
  const etaS = Math.round(routeLengthM / 1.0 + 60);
  const arrivalS = departS + etaS;
  const dispersalS = arrivalS + Math.round(plan.dwellMin * 60);
  const endS = dispersalS + 900;
  const ms = (s: number) => Math.round(s * 1000);
  const dayStart = plan.departClockSec - PLAN_LEAD_S;

  const timeline: ScenarioEvent[] = [
    { id: 'ev-0-rassemblement', atMs: 0, kind: 'spawn_group', reason: `rassemblement au point de départ : ${size} personnes (effectif déclaré ${plan.declaredSize}, ± ${plan.uncertaintyPct} %)`, spec: { key: 'rassemblement', label: `Manifestation — ${plan.name}`, kind: 'static', size, origin: plan.start, anchor: startA, tension: 15, fillBias: departureDirection(live, plan.start, (plan.waypoints[0] ?? plan.end) as Vec2) } },
  ];
  closedEdges.forEach((e, i) => timeline.push({ id: `ev-0-ferme-${i + 1}`, atMs: 0, kind: 'close_street', edgeId: e, reason: 'axe fermé par le dispositif prévu au plan' }));
  timeline.push({ id: 'ev-depart', atMs: ms(departS), kind: 'begin_march', groupKey: 'rassemblement', destination: endA, waypoints: wps, onArrival: 'settle', label: `Cortège — ${plan.name}`, reason: `heure de départ du plan atteinte : le cortège part du point de départ vers l’arrivée${wps.length ? ` en passant par ${wps.length} point(s) imposé(s)` : ''}` });
  timeline.push({ id: 'ev-dispersion', atMs: ms(dispersalS), kind: 'begin_dispersal', groupKey: 'rassemblement', exit: startA, durationMs: 600000, whenSettled: true, reason: `fin du maintien sur place prévu au plan (${plan.dwellMin} min) : dispersion` });

  const plan0: Cause = { kind: 'scenario_plan', refId: 'plan', note: 'dispositif prévu au plan d’opération' };
  const setup = (sim: Sim): void => {
    plan.units.forEach((u, i) => sim.addUnit({ force: u.force, callsign: `${CALLSIGN[u.force]}-PLAN ${String(i + 1).padStart(2, '0')}`, num: String(i + 1).padStart(2, '0'), headcount: u.headcount, pos: u.pos, loadout: { shield: u.force === 'crs' || u.force === 'gendarmerie_mobile', helmet: true } }, plan0));
  };
  return {
    id: 'plan-bac-a-sable',
    timeline,
    setup,
    places: { plaza: startA, admin: endA, entries: [], exits: [] },
    clockStartSec: dayStart,
    milestones: { rallyEndS: 0, departS, arrivalS, endS },
    etaS: arrivalS,
    suggestedSpeed: 6,
    actualSize: size,
    closedEdges,
    routeLengthM: Math.round(routeLengthM),
  };
}

/** Scénario vide du mode planification : le monde (rues, décor) sans manifestants ni unités. */
export function blankScenario(): DemoScenario {
  const a = placeAnchor('vide', 'Aucun', { x: 0, y: 0 });
  return { id: 'bac-a-sable-vide', timeline: [], setup: () => undefined, places: { plaza: a, admin: a, entries: [], exits: [] }, clockStartSec: 14 * 3600, milestones: { rallyEndS: 0, departS: 0, arrivalS: 0, endS: 0 }, etaS: 0, suggestedSpeed: 3 };
}

/** Itinéraire prévu (polyligne en mètres) avec les axes fermés pris en compte, ou message d'erreur : aperçu en temps réel pendant l'édition. */
export function previewRoute(graph: StreetGraph, plan: OperationPlan): { points: Vec2[]; lengthM: number } | { error: string } {
  const nav = new NavContext(graph, DEFAULT_NAV_PARAMS);
  const state = createEdgeState(graph);
  for (const c of plan.closures) {
    const pr = nav.snap(c, 'foot', 60);
    if (pr) setScenarioBlock(state, pr.edge, true);
  }
  const live = new NavContext(graph, DEFAULT_NAV_PARAMS, state);
  const chain: Vec2[] = [plan.start, ...plan.waypoints, plan.end];
  const points: Vec2[] = [];
  let lengthM = 0;
  for (let i = 1; i < chain.length; i++) {
    const r = live.findRoute(chain[i - 1] as Vec2, chain[i] as Vec2, 'crowd');
    if (!r) return { error: i === chain.length - 1 && plan.waypoints.length === 0 ? 'Aucun itinéraire entre le départ et l’arrivée (axes fermés ?).' : `Aucun itinéraire pour le tronçon ${i} (axes fermés ?).` };
    for (let k = 0; k < r.pts.length; k += 2) points.push({ x: r.pts[k] as number, y: r.pts[k + 1] as number });
    lengthM += r.length;
  }
  return { points, lengthM: Math.round(lengthM) };
}
