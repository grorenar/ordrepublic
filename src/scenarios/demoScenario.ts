import type { Vec2 } from '../geo/mercator';
import { NavContext } from '../nav/astar';
import type { StreetGraph } from '../nav/graph';
import { DEFAULT_NAV_PARAMS } from '../nav/params';
import { createEdgeState } from '../nav/streetState';
import type { ScenarioEvent, Sim } from '../engine/sim';
import type { Anchor, Cause } from '../engine/types';

/**
 * Scénario de démonstration du moteur (phase 3c). Tous les groupes et événements sont décrits ici avec leur
 * raison : rien n'apparaît ni ne bouge sans cause. Il s'adapte à n'importe quel graphe (ville schématique ou
 * paquet OSM) : lieux choisis dans le graphe (place, bâtiment voisin, portes d'entrée/sortie aux bords).
 */
export interface DemoScenario {
  id: string;
  timeline: ScenarioEvent[];
  /** Place les forces de l'ordre et leurs véhicules (dispositif initial). */
  setup(sim: Sim): void;
  /** Lieux utilisés (affichés dans l'interface). */
  places: { plaza: Anchor; admin: Anchor; gatewayWest: Anchor; gatewaySouth: Anchor };
  /** Durée estimée (s) avant l'arrivée du cortège sur la place, à vitesse de jeu 1×. */
  etaS: number;
  /** Vitesse de jeu suggérée pour regarder le scénario en quelques minutes. */
  suggestedSpeed: 3 | 6;
}

const centroid = (ring: Float32Array): Vec2 => {
  let x = 0;
  let y = 0;
  const n = ring.length / 2;
  for (let i = 0; i < n; i++) {
    x += ring[2 * i] as number;
    y += ring[2 * i + 1] as number;
  }
  return { x: x / n, y: y / n };
};

const areaOf = (ring: Float32Array): number => {
  let a = 0;
  const n = ring.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a += (ring[2 * i] as number) * (ring[2 * j + 1] as number) - (ring[2 * j] as number) * (ring[2 * i + 1] as number);
  }
  return Math.abs(a) / 2;
};

export function buildDemoScenario(graph: StreetGraph, opts: { cortegeSize?: number; piquetSize?: number } = {}): DemoScenario {
  const nav = new NavContext(graph, DEFAULT_NAV_PARAMS, createEdgeState(graph));
  const snapPoint = (p: Vec2): Vec2 => nav.snap(p, 'crowd', 2000)?.point ?? p;

  // --- lieux : la plus grande place, et un bâtiment voisin
  const squares = graph.spaces.filter((s) => s.kind === 'square' || s.kind === 'pedestrian_area').sort((a, b) => areaOf(b.ring) - areaOf(a.ring));
  const plazaCenter = squares[0] ? centroid(squares[0].ring) : { x: 0, y: 0 };
  const plazaPt = snapPoint(plazaCenter);
  const plaza: Anchor = {
    id: 'place-centrale',
    kind: 'space',
    pos: plazaPt,
    radius: 25,
    label: squares[0]?.name ?? (graph.provenance.source === 'osm' ? 'Place principale' : 'Place centrale (fictive)'),
    source: squares[0]?.source ?? 'synthetic',
  };
  let adminPos = snapPoint({ x: plazaPt.x + 90, y: plazaPt.y + 40 });
  let adminLabel = 'Administration (fictive)';
  let adminSource: Anchor['source'] = 'synthetic';
  const near = graph.obstacles
    .map((o) => ({ o, c: centroid(o.ring) }))
    .map((e) => ({ ...e, d: Math.hypot(e.c.x - plazaPt.x, e.c.y - plazaPt.y) }))
    .filter((e) => e.d >= 50 && e.d <= 250)
    .sort((a, b) => a.d - b.d);
  const pick = near.find((e) => e.o.name) ?? near[0];
  if (pick) {
    adminPos = snapPoint(pick.c);
    adminLabel = pick.o.source === 'osm' && pick.o.name ? pick.o.name : 'Administration (fictive)';
    adminSource = pick.o.source;
  }
  const admin: Anchor = { id: 'administration', kind: 'place', pos: adminPos, radius: 18, label: adminLabel, source: adminSource };

  // --- portes d'entrée/sortie : nœuds du graphe aux bords ouest et sud
  const nodes = Array.from({ length: graph.nodeCount }, (_, i) => ({ i, x: graph.nodeX[i] as number, y: graph.nodeY[i] as number }));
  const west = nodes.filter((n) => Math.abs(n.y - plazaPt.y) < 250).sort((a, b) => a.x - b.x)[0] ?? nodes[0];
  const south = nodes.filter((n) => Math.abs(n.x - plazaPt.x) < 250).sort((a, b) => a.y - b.y)[0] ?? nodes[0];
  const gatewayWest: Anchor = { id: 'porte-ouest', kind: 'node', pos: { x: west!.x, y: west!.y }, radius: 15, label: 'Porte ouest de la zone', source: 'synthetic' };
  const gatewaySouth: Anchor = { id: 'porte-sud', kind: 'node', pos: { x: south!.x, y: south!.y }, radius: 15, label: 'Porte sud de la zone', source: 'synthetic' };

  // --- chronologie : repères d'après l'itinéraire réel du cortège
  const size = opts.cortegeSize ?? 2500;
  const route = nav.findRoute(gatewayWest.pos, plaza.pos, 'crowd');
  const routeLen = route?.length ?? 600;
  const etaS = Math.round(routeLen / 1.0 + size / (2 * 14) / 1.1);
  // arête à fermer : sur la route, bien devant la tête au moment de la fermeture, et avec un itinéraire de remplacement
  let closeEdge: number | null = null;
  if (route) {
    for (const f of [0.55, 0.5, 0.6, 0.45, 0.65, 0.4]) {
      const idx = route.edges.findIndex((_, i) => (route.edgeStart[i] as number) >= route.length * f);
      const e = route.edges[Math.max(1, idx)] as number;
      const st = createEdgeState(graph);
      st.scenarioBlock[e] = 1;
      const probe = new NavContext(graph, DEFAULT_NAV_PARAMS, st);
      if (probe.findRoute(gatewayWest.pos, plaza.pos, 'crowd')) {
        closeEdge = e;
        break;
      }
    }
  }

  const ms = (s: number) => Math.round(s * 1000);
  const timeline: ScenarioEvent[] = [
    { id: 'ev-piquet', atMs: 0, kind: 'spawn_group', reason: `piquet de rassemblement devant ${admin.label} prévu au scénario`, spec: { key: 'piquet', label: 'Piquet devant l’administration', kind: 'static', size: opts.piquetSize ?? 120, origin: admin.pos, anchor: admin, tension: 15 } },
    {
      id: 'ev-cortege',
      atMs: 0,
      kind: 'spawn_group',
      reason: `cortège syndical prévu : départ de ${gatewayWest.label} vers ${plaza.label}`,
      spec: { key: 'cortege', label: 'Cortège syndical', kind: 'march', size, origin: gatewayWest.pos, entry: 'gateway', plan: { destination: plaza, waypoints: [], onArrival: 'settle', patienceMs: 120000 }, tension: 25 },
    },
  ];
  if (closeEdge !== null) {
    timeline.push({ id: 'ev-travaux', atMs: ms(etaS * 0.3), kind: 'close_street', edgeId: closeEdge, reason: 'travaux de voirie fictifs : rue fermée par le scénario' });
    timeline.push({ id: 'ev-fin-travaux', atMs: ms(etaS * 0.75), kind: 'open_street', edgeId: closeEdge, reason: 'fin des travaux fictifs : rue rouverte' });
  }
  timeline.push({
    id: 'ev-detachement',
    atMs: ms(etaS + 90),
    kind: 'split_group',
    groupKey: 'cortege',
    count: Math.max(20, Math.round(size * 0.06)),
    child: { label: 'Détachement vers le piquet', destination: admin, onArrival: 'join_target', joinTargetKey: 'piquet', key: 'detachement' },
    reason: `un groupe se détache du cortège pour rejoindre le piquet devant ${admin.label} (plan du scénario)`,
  });
  timeline.push({
    id: 'ev-fin',
    atMs: ms(etaS + 420),
    kind: 'begin_dispersal',
    groupKey: 'cortege',
    exit: gatewaySouth,
    durationMs: ms(240),
    whenSettled: true,
    reason: `fin de la manifestation prévue : dispersion progressive vers ${gatewaySouth.label}`,
  });

  const plan: Cause = { kind: 'scenario_plan', refId: 'dispositif', note: 'dispositif initial prévu au scénario' };
  const setup = (sim: Sim): void => {
    const around = (k: number, r: number): Vec2 => {
      const a = (k / 8) * Math.PI * 2 + 0.4;
      return { x: plaza.pos.x + Math.cos(a) * r, y: plaza.pos.y + Math.sin(a) * r };
    };
    const units: Array<[Parameters<Sim['addUnit']>[0]['force'], string, string, number, number]> = [
      ['crs', 'CRS-J 07/2', '07', 28, 70],
      ['crs', 'CRS-J 08/3', '08', 26, 85],
      ['crs', 'CRS-J 09/1', '09', 30, 100],
      ['crs', 'CRS-J 12/1', '12', 24, 115],
      ['police_nationale', 'POL-J 21', '21', 8, 130],
      ['police_nationale', 'POL-J 22', '22', 8, 95],
      ['gendarmerie_mobile', 'GM-J 03', '03', 22, 120],
      ['unite_speciale', 'US-J 01', '01', 6, 140],
    ];
    units.forEach(([force, callsign, num, headcount, r], k) => sim.addUnit({ force, callsign, num, headcount, pos: around(k, r) }, plan));
    const vehicles: Array<[Parameters<Sim['addVehicle']>[0]['vehicle'], string, number, number]> = [
      ['fourgon_crs', 'Transport CRS-J 07', 9, 160],
      ['fourgon_crs', 'Transport CRS-J 09', 9, 175],
      ['voiture_police', 'Véhicule POL 21', 3, 150],
      ['camion_a_eau', 'Lanceur d’eau LE-1', 3, 190],
      ['ambulance', 'Secours AMB-1', 2, 210],
      ['camion_pompiers', 'Pompiers SP-1', 4, 225],
      ['moto_police', 'Moto POL 05', 1, 140],
    ];
    vehicles.forEach(([vehicle, callsign, crew, r], k) => sim.addVehicle({ vehicle, callsign, crew, pos: around(k + 3, r) }, plan));
  };

  return { id: 'demo-moteur', timeline, setup, places: { plaza, admin, gatewayWest, gatewaySouth }, etaS, suggestedSpeed: etaS > 700 ? 6 : 3 };
}
