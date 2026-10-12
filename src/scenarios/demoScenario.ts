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
  /** Lieux utilisés (affichés dans l'interface) : point de rassemblement, administration, portes d'entrée et de sortie de la zone. */
  places: { plaza: Anchor; admin: Anchor; entries: Anchor[]; exits: Anchor[] };
  /** Heure du jour (secondes depuis minuit) au début de la partie. */
  clockStartSec: number;
  /** Repères du scénario (secondes de jeu depuis le début) : fin des arrivées, départ du cortège, arrivée estimée, dispersion. */
  milestones: { rallyEndS: number; departS: number; arrivalS: number; endS: number };
  /** Durée estimée (s) avant l'arrivée du cortège à l'administration, à vitesse de jeu 1×. */
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

export function buildDemoScenario(graph: StreetGraph, opts: { cortegeSize?: number; piquetSize?: number; zone?: { halfWidth: number; halfHeight: number } } = {}): DemoScenario {
  const nav = new NavContext(graph, DEFAULT_NAV_PARAMS, createEdgeState(graph));
  const snapPoint = (p: Vec2): Vec2 => nav.snap(p, 'crowd', 2000)?.point ?? p;

  // --- lieux : la plus grande place, et un bâtiment voisin
  const zoneBox = opts.zone;
  const inZoneCore = (p: Vec2) => !zoneBox || (Math.abs(p.x) <= zoneBox.halfWidth * 0.6 && Math.abs(p.y) <= zoneBox.halfHeight * 0.6);
  const allSquares = graph.spaces.filter((s) => s.kind === 'square' || s.kind === 'pedestrian_area');
  // la place du scénario est choisie dans le cœur de la zone de jeu (sinon la plus proche de l'origine)
  const core = allSquares.filter((s) => inZoneCore(centroid(s.ring)));
  const squares = (core.length ? core : [...allSquares].sort((a, b) => Math.hypot(centroid(a.ring).x, centroid(a.ring).y) - Math.hypot(centroid(b.ring).x, centroid(b.ring).y)).slice(0, 1)).sort((a, b) => areaOf(b.ring) - areaOf(a.ring));
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
  // --- le piquet est placé devant une VRAIE administration (mairie, préfecture, tribunal, bâtiment gouvernemental : étiquettes OSM).
  // Jamais devant un bâtiment quelconque (un marché couvert n'est pas une administration). Sans administration dans le secteur :
  // piquet générique, étiqueté comme tel. Sur la ville schématique (fictive) : le bâtiment voisin est une « administration fictive ».
  const distToPlaza = (c: Vec2) => Math.hypot(c.x - plazaPt.x, c.y - plazaPt.y);
  const reach = zoneBox ? Math.max(zoneBox.halfWidth, zoneBox.halfHeight) * 0.9 : 600;
  // la manifestation a un vrai trajet : l'administration est choisie à 250–450 m du point de rassemblement (selon la taille de la zone)
  const targetD = Math.min(450, Math.max(250, reach * 0.55));
  const candidates = graph.obstacles
    .map((o) => ({ o, c: centroid(o.ring) }))
    .map((e) => ({ ...e, d: distToPlaza(e.c) }))
    .filter((e) => e.d >= 120 && e.d <= reach && (!zoneBox || (Math.abs(e.c.x) <= zoneBox.halfWidth * 0.95 && Math.abs(e.c.y) <= zoneBox.halfHeight * 0.95)));
  let adminPos = snapPoint({ x: plazaPt.x + 90, y: plazaPt.y + 40 });
  let adminLabel = 'Point de rassemblement (lieu fictif)';
  let adminSource: Anchor['source'] = 'synthetic';
  let adminReal = false;
  if (graph.provenance.source === 'osm') {
    const admins = candidates.filter((e) => e.o.kind === 'administration').sort((a, b) => Math.abs(a.d - targetD) - Math.abs(b.d - targetD));
    const pick = admins[0];
    if (pick) {
      adminPos = snapPoint(pick.c);
      adminLabel = pick.o.name ?? 'Administration';
      adminSource = 'osm';
      adminReal = true;
    }
  } else {
    const near = candidates.sort((a, b) => Math.abs(a.d - targetD) - Math.abs(b.d - targetD))[0];
    if (near) {
      adminPos = snapPoint(near.c);
      adminLabel = 'Administration (fictive)';
      adminReal = true;
    }
  }
  const admin: Anchor = { id: 'administration', kind: 'place', pos: adminPos, radius: 18, label: adminLabel, source: adminSource };

  // --- portes d'entrée/sortie : nœuds du graphe répartis en couronne autour de la zone (reliés à la place par un itinéraire)
  const nodes = Array.from({ length: graph.nodeCount }, (_, i) => ({ i, x: graph.nodeX[i] as number, y: graph.nodeY[i] as number }));
  const z = opts.zone;
  const inZone = (n: { x: number; y: number }) => !z || (Math.abs(n.x) <= z.halfWidth * 0.95 && Math.abs(n.y) <= z.halfHeight * 0.95);
  const usable = nodes.filter(inZone);
  const pool = usable.length ? usable : nodes;
  const gates: Anchor[] = [];
  for (let k = 0; k < 8 && gates.length < 6; k++) {
    const th = (k / 8) * Math.PI * 2 + 0.35;
    const dx = Math.cos(th);
    const dy = Math.sin(th);
    const best = pool
      .filter((n) => Math.hypot(n.x - plazaPt.x, n.y - plazaPt.y) > 200 && gates.every((g) => Math.hypot(g.pos.x - n.x, g.pos.y - n.y) > 150))
      .sort((p1, p2) => (p2.x - plazaPt.x) * dx + (p2.y - plazaPt.y) * dy - ((p1.x - plazaPt.x) * dx + (p1.y - plazaPt.y) * dy))[0];
    if (!best) continue;
    if (!nav.findRoute({ x: best.x, y: best.y }, plazaPt, 'crowd')) continue;
    gates.push({ id: `porte-${gates.length + 1}`, kind: 'node', pos: { x: best.x, y: best.y }, radius: 15, label: `Accès ${gates.length + 1} du secteur`, source: 'synthetic' });
  }
  if (!gates.length) {
    const fallback = pool[0] ?? nodes[0];
    gates.push({ id: 'porte-1', kind: 'node', pos: { x: fallback!.x, y: fallback!.y }, radius: 15, label: 'Accès 1 du secteur', source: 'synthetic' });
  }
  const entries = gates.slice(0, Math.min(5, gates.length));
  // sorties de dispersion : trois accès différents, de préférence autres que les premières entrées
  const exits = [...gates.slice(entries.length), ...gates].filter((g, i, arr) => arr.indexOf(g) === i).slice(0, Math.min(3, gates.length)).map((g, i) => ({ ...g, id: `sortie-${i + 1}`, label: `Sortie ${i + 1} du secteur` }));

  // --- chronologie : tout est exprimé en secondes de jeu depuis le début (heure du jour = clockStartSec + t)
  const V = 0.8; // vitesse effective moyenne d'un cortège (relation densité-vitesse, rues étroites, replanification)
  const total = opts.cortegeSize ?? 2500;
  const early = Math.min(120, Math.round(total * 0.05));
  const shares = [0.18, 0.26, 0.2, 0.24, 0.12].slice(0, entries.length);
  const shareSum = shares.reduce((a, b) => a + b, 0);
  const arrivals = entries.map((g, k) => {
    const route = nav.findRoute(g.pos, plazaPt, 'crowd');
    const spawnS = k * 120;
    return { g, size: Math.max(20, Math.round(((total - early) * (shares[k] as number)) / shareSum)), spawnS, arriveS: spawnS + (route?.length ?? 500) / V + 120 };
  });
  const rallyEndS = Math.max(...arrivals.map((a) => a.arriveS));
  const departS = Math.max(1800, Math.ceil((rallyEndS + 240) / 300) * 300); // départ à heure ronde, après la dernière arrivée
  const marchRoute = nav.findRoute(plazaPt, admin.pos, 'crowd');
  const marchLen = marchRoute?.length ?? 500;
  const marchS = marchLen / V + 90 + 60;
  const arrivalS = Math.round(departS + marchS);
  const endS = arrivalS + 1200;
  // arête à fermer : sur la route du cortège, bien devant la tête au moment de la fermeture, avec un itinéraire de remplacement
  let closeEdge: number | null = null;
  if (marchRoute) {
    for (const f of [0.55, 0.5, 0.6, 0.45, 0.65, 0.4]) {
      const idx = marchRoute.edges.findIndex((_, i) => (marchRoute.edgeStart[i] as number) >= marchRoute.length * f);
      const e = marchRoute.edges[Math.max(1, idx)] as number;
      const st = createEdgeState(graph);
      st.scenarioBlock[e] = 1;
      const probe = new NavContext(graph, DEFAULT_NAV_PARAMS, st);
      if (probe.findRoute(plazaPt, admin.pos, 'crowd')) {
        closeEdge = e;
        break;
      }
    }
  }

  const ms = (x: number) => Math.round(x * 1000);
  const timeline: ScenarioEvent[] = [
    { id: 'ev-0-piquet', atMs: 0, kind: 'spawn_group', reason: adminReal ? `piquet de rassemblement devant ${admin.label} prévu au scénario` : 'piquet de rassemblement prévu au scénario (aucune administration repérée dans le secteur : lieu fictif)', spec: { key: 'piquet', label: adminReal ? `Piquet devant ${admin.label}` : 'Piquet de rassemblement', kind: 'static', size: opts.piquetSize ?? 120, origin: admin.pos, anchor: admin, tension: 15 } },
    { id: 'ev-0-rassemblement', atMs: 0, kind: 'spawn_group', reason: `point de rassemblement prévu au scénario : ${plaza.label}, départ du cortège à l’heure indiquée`, spec: { key: 'rassemblement', label: `Rassemblement — ${plaza.label}`, kind: 'static', size: early, origin: plazaPt, anchor: plaza, tension: 10 } },
  ];
  for (const a of arrivals) {
    timeline.push({
      id: `ev-arrivee-${a.g.id}`,
      atMs: ms(a.spawnS),
      kind: 'spawn_group',
      reason: `un groupe de manifestants arrive par ${a.g.label} pour rejoindre le point de rassemblement (plan du scénario)`,
      spec: { key: `groupe-${a.g.id}`, label: `Groupe arrivant par ${a.g.label}`, kind: 'secondary', size: a.size, origin: a.g.pos, entry: 'gateway', plan: { destination: plaza, waypoints: [], onArrival: 'join_target', joinTargetKey: 'rassemblement', patienceMs: 120000 }, tension: 15 },
    });
  }
  timeline.push({
    id: 'ev-depart',
    atMs: ms(departS),
    kind: 'begin_march',
    groupKey: 'rassemblement',
    destination: admin,
    onArrival: 'join_target',
    joinTargetKey: 'piquet',
    label: 'Cortège',
    reason: `heure de départ du cortège atteinte : il part de ${plaza.label} vers ${admin.label}`,
  });
  // ambiance du cortège : le scénario règle la tension ; les incidents en découlent par les règles du moteur
  timeline.push({ id: 'ev-tension-depart', atMs: ms(departS), kind: 'set_tension', groupKey: 'rassemblement', tension: 28, reason: 'le cortège s’ébranle : tension modérée' });
  timeline.push({ id: 'ev-tension-hausse', atMs: ms(departS + marchS * 0.3), kind: 'set_tension', groupKey: 'rassemblement', tension: 68, reason: 'montée de tension au sein du cortège (scénario fictif)' });
  timeline.push({ id: 'ev-tension-baisse', atMs: ms(departS + marchS * 0.75), kind: 'set_tension', groupKey: 'rassemblement', tension: 25, reason: 'apaisement à l’approche de la destination (scénario fictif)' });
  timeline.push({ id: 'ev-feu-piquet', atMs: ms(arrivalS + 120), kind: 'spawn_incident', incident: 'bin_fire', x: admin.pos.x, y: admin.pos.y, reason: `départ de feu de poubelle prévu au scénario près de ${admin.label} (fictif)` });
  if (closeEdge !== null) {
    timeline.push({ id: 'ev-travaux', atMs: ms(departS + marchS * 0.3), kind: 'close_street', edgeId: closeEdge, reason: 'travaux de voirie fictifs : rue fermée par le scénario' });
    timeline.push({ id: 'ev-fin-travaux', atMs: ms(departS + marchS * 0.75), kind: 'open_street', edgeId: closeEdge, reason: 'fin des travaux fictifs : rue rouverte' });
  }
  timeline.push({
    id: 'ev-fin',
    atMs: ms(endS),
    kind: 'disperse_sectors',
    groupKey: 'piquet',
    exits: exits.map((anchor, i) => ({ anchor, share: [0.4, 0.35, 0.25][i] ?? 0.25 })),
    whenSettled: true,
    reason: 'fin de la manifestation prévue : dispersion en plusieurs colonnes vers différents secteurs',
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

  return {
    id: 'demo-moteur',
    timeline,
    setup,
    places: { plaza, admin, entries, exits },
    clockStartSec: 17 * 3600 + 30 * 60,
    milestones: { rallyEndS, departS, arrivalS, endS },
    etaS: arrivalS,
    suggestedSpeed: 6,
  };
}
