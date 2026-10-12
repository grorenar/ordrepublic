import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EdgeClass, EdgeFlag, connectedComponents } from '../../src/nav/graph';
import { buildGraphFromOverpassJson } from '../../src/nav/osm/buildGraph';
import { overpassQuery } from '../../src/nav/osm/packBuild';
import { packGraph, unpackGraph } from '../../src/nav/pack';
import { Sim } from '../../src/engine/sim';
import { overpassGrid } from '../fixtures/overpassGrid';
import { OsmParseError, parseOverpass } from '../../src/nav/osm/parseOverpass';
import { classifyHighway, parseWidth } from '../../src/nav/osm/tagsPolicy';

const fixture = JSON.parse(readFileSync(new URL('../fixtures/overpass-mini.json', import.meta.url), 'utf8'));

describe('politique de filtrage des voies OSM', () => {
  it('classe les voies et applique les accès', () => {
    const res = classifyHighway({ highway: 'residential' });
    expect('cls' in res && res.cls).toBe(EdgeClass.Residential);
    expect(classifyHighway({ highway: 'motorway' })).toEqual({ excluded: 'excluded_class' });
    expect(classifyHighway({ highway: 'footway', footway: 'sidewalk' })).toEqual({ excluded: 'excluded_footway' });
    expect(classifyHighway({ highway: 'service', service: 'parking_aisle' })).toEqual({ excluded: 'excluded_service' });
    expect(classifyHighway({ highway: 'residential', access: 'private' })).toEqual({ excluded: 'no_access' });
    expect(classifyHighway({ shop: 'bakery' })).toEqual({ excluded: 'not_highway' });
    const ped = classifyHighway({ highway: 'pedestrian' });
    expect('flags' in ped && (ped.flags & EdgeFlag.Motor)).toBe(0);
    const priv = classifyHighway({ highway: 'service', access: 'private', foot: 'yes' });
    expect('flags' in priv && (priv.flags & EdgeFlag.Foot) !== 0 && (priv.flags & EdgeFlag.Motor) === 0).toBe(true);
  });

  it('sens uniques, rond-points, oneway=-1 inversé, ponts', () => {
    const a = classifyHighway({ highway: 'residential', oneway: 'yes' });
    expect('flags' in a && (a.flags & EdgeFlag.Oneway) !== 0 && !a.reverse).toBe(true);
    const b = classifyHighway({ highway: 'residential', oneway: '-1' });
    expect('flags' in b && b.reverse).toBe(true);
    const c = classifyHighway({ highway: 'tertiary', junction: 'roundabout', bridge: 'yes' });
    expect('flags' in c && (c.flags & EdgeFlag.Oneway) !== 0 && (c.flags & EdgeFlag.Bridge) !== 0).toBe(true);
  });

  it('largeur : valeur plausible conservée, sinon défaut signalé', () => {
    expect(parseWidth('12')).toBe(12);
    expect(parseWidth('7,5 m')).toBe(7.5);
    expect(parseWidth('abc')).toBeNull();
    expect(parseWidth('900')).toBeNull();
    const w = classifyHighway({ highway: 'primary', width: '14' });
    expect('widthDefaulted' in w && !w.widthDefaulted && w.width === 14).toBe(true);
    const d = classifyHighway({ highway: 'primary' });
    expect('widthDefaulted' in d && d.widthDefaulted && (d.flags & EdgeFlag.WidthDefault) !== 0).toBe(true);
  });
});

describe('construction du graphe depuis une réponse Overpass (fixture simulée)', () => {
  const { graph, report } = buildGraphFromOverpassJson(fixture, { origin: { lat: 49.1193, lng: 6.1757 } });

  it('refuse une réponse invalide', () => {
    expect(() => parseOverpass({})).toThrow(OsmParseError);
    expect(() => parseOverpass(null)).toThrow(OsmParseError);
  });

  it('exclut autoroutes, trottoirs, accès privés, constructions et ignore les relations', () => {
    expect(report.excluded.excluded_class).toBe(2); // motorway + construction
    expect(report.excluded.excluded_footway).toBe(1);
    expect(report.excluded.no_access).toBe(1);
    expect(report.relationsSkipped).toBe(1);
    expect(report.warnings.join(' ')).toContain('relations ignorées');
  });

  it('découpe aux intersections et conserve la géométrie intermédiaire', () => {
    // 3 lignes × 3 tronçons + 4 colonnes × 2 tronçons + marches (steps) = 9 + 8 + 1 ; la ligne 0 contient un point de forme
    expect(graph.edgeCount).toBe(18);
    const withShape = Array.from({ length: graph.edgeCount }, (_, e) => (graph.shapeStart[e + 1] as number) - (graph.shapeStart[e] as number)).filter((n) => n === 3);
    expect(withShape).toHaveLength(1);
  });

  it('ne garde que la composante principale (îlot isolé écarté)', () => {
    expect(report.components).toBeGreaterThan(1);
    expect(report.droppedEdges).toBe(1);
    expect(connectedComponents(graph).sizes).toHaveLength(1);
  });

  it('largeurs, sens unique, classes et noms', () => {
    const named = (n: string) => Array.from({ length: graph.edgeCount }, (_, e) => e).filter((e) => graph.edgeName[e]?.includes(n));
    const ave = named('Avenue Principale');
    expect(ave.length).toBe(3);
    expect(graph.edgeWidth[ave[0] as number]).toBe(14);
    expect(graph.edgeClass[ave[0] as number]).toBe(EdgeClass.Primary);
    const ow = named('Sens Unique');
    expect(ow.every((e) => (graph.edgeFlags[e] as number) & EdgeFlag.Oneway)).toBe(true);
    const ped = named('Piétonne');
    expect(ped.every((e) => ((graph.edgeFlags[e] as number) & EdgeFlag.Motor) === 0)).toBe(true);
    expect(report.widthDefaultedShare).toBeGreaterThan(0.5);
  });

  it('extrait places, parcs et bâtiments (noms OSM conservés tels quels)', () => {
    expect(graph.spaces.map((s) => s.kind).sort()).toEqual(['park', 'square']);
    expect(graph.spaces.find((s) => s.kind === 'square')?.name).toBe('Place du Test (fictive)');
    expect(graph.spaces.every((s) => s.source === 'osm')).toBe(true);
    expect(graph.obstacles).toHaveLength(2);
    expect(graph.obstacles.some((o) => o.name === 'Commerce Test (fictif)')).toBe(true);
    expect(graph.provenance.source).toBe('osm');
  });

  it('géométrie locale cohérente (≈ 100 m entre colonnes)', () => {
    const e = Array.from({ length: graph.edgeCount }, (_, i) => i).find((i) => graph.edgeName[i]?.includes('Horizontale 2'));
    expect(graph.edgeLen[e as number]).toBeGreaterThan(98);
    expect(graph.edgeLen[e as number]).toBeLessThan(102);
  });

  it('un réseau vide produit un avertissement explicite, sans exception', () => {
    const { graph: g, report: r } = buildGraphFromOverpassJson({ elements: [] });
    expect(g.edgeCount).toBe(0);
    expect(r.warnings.join(' ')).toContain('fond schématique');
  });
});

describe('lieux d’intérêt OSM (phase 4)', () => {
  const center = { lng: 6.1757, lat: 49.1193 };
  const build = () => buildGraphFromOverpassJson(overpassGrid(center, { pois: true, townhall: true, market: true }), { origin: center }).graph;

  it('commerces, écoles, entreprises et administrations deviennent des lieux d’intérêt avec leur nom ; le mobilier est classé à part', () => {
    const g = build();
    const names = g.pois.map((p) => p.name);
    expect(names).toContain('Boulangerie du Test (fictive)');
    expect(g.pois.find((p) => p.name === 'Boulangerie du Test (fictive)')).toMatchObject({ kind: 'commerce', category: 'bakery', source: 'osm' });
    expect(g.pois.find((p) => p.name === 'Café du Test (fictif)')?.kind).toBe('commerce');
    expect(g.pois.find((p) => p.name === 'École du Test (fictive)')?.kind).toBe('school');
    expect(g.pois.find((p) => p.name === 'Assurance du Test (fictive)')?.kind).toBe('company');
    expect(g.pois.find((p) => p.name === 'Hôtel de Ville (fictif)')?.kind).toBe('public');
    expect(g.pois.find((p) => p.category === 'waste_basket')?.kind).toBe('furniture');
  });

  it('les installations de police ne sont JAMAIS retenues (aucune cible, aucune catégorisation)', () => {
    const g = build();
    expect(g.pois.some((p) => /Commissariat/.test(p.name ?? '') || p.category === 'police')).toBe(false);
  });

  it('les lieux survivent à l’écriture et à la lecture d’un paquet', () => {
    const g = build();
    const { graph } = unpackGraph(JSON.parse(JSON.stringify(packGraph(g, { name: 'T', generatedAt: 'x', license: 'ODbL' } as never))));
    expect(graph.pois.length).toBe(g.pois.length);
    expect(graph.pois[0]).toEqual(g.pois[0]);
  });

  it('un monde construit sur ces données : lieux OSM non fictifs et mobilier OSM en décor, jamais ciblés', () => {
    const g = build();
    const sim = new Sim({ graph: g, seed: 1 });
    const osm = sim.world.pois.filter((p) => p.source === 'osm');
    expect(osm.length).toBeGreaterThan(4);
    expect(osm.every((p) => !p.fictional)).toBe(true);
    expect(sim.world.decor.some((d) => d.source === 'osm' && d.kind === 'bin')).toBe(true);
  });

  it('la requête Overpass demande les commerces et établissements, sans police', () => {
    const q = overpassQuery({ south: 49, west: 6, north: 49.01, east: 6.01 });
    expect(q).toContain('["shop"]');
    expect(q).toContain('school');
    expect(q).not.toContain('police');
  });
});

describe('voies de bus en site propre (BHNS, ex. Mettis)', () => {
  const cases: Array<[string, Record<string, string>]> = [
    ['highway=busway', { highway: 'busway' }],
    ['service=busway', { highway: 'service', service: 'busway' }],
    ['service=bus', { highway: 'service', service: 'bus', access: 'no' }],
    ['accès réservé aux bus', { highway: 'service', access: 'no', bus: 'designated' }],
    ['psv=designated sur une rue résidentielle fermée', { highway: 'residential', access: 'no', psv: 'designated' }],
    ['busway avec foot=no (interdiction légale seulement)', { highway: 'busway', foot: 'no', access: 'no' }],
  ];
  for (const [name, tags] of cases) {
    it(`${name} : retenue, praticable à pied par un cortège, fermée à la circulation générale`, () => {
      const r = classifyHighway(tags);
      expect('excluded' in r, JSON.stringify(r)).toBe(false);
      if ('excluded' in r) return;
      expect(r.cls).toBe(EdgeClass.Busway);
      expect(r.flags & EdgeFlag.Foot).toBeTruthy();
      expect(r.flags & EdgeFlag.Motor).toBeFalsy();
    });
  }

  it('une rue ordinaire fermée aux véhicules (access=no, sans bus) reste exclue', () => {
    expect(classifyHighway({ highway: 'service', access: 'no' })).toEqual({ excluded: 'no_access' });
    expect(classifyHighway({ highway: 'residential', access: 'private' })).toEqual({ excluded: 'no_access' });
  });

  it('le cortège emprunte la voie de bus quand elle est le seul passage ; les véhicules en urgence aussi', async () => {
    const { NavContext } = await import('../../src/nav/astar');
    const { DEFAULT_NAV_PARAMS } = await import('../../src/nav/params');
    const mk = (tags: Record<string, string>) => {
      const frameLat = 49.1193;
      const els = [
        { type: 'node', id: 1, lat: frameLat, lon: 6.1757 },
        { type: 'node', id: 2, lat: frameLat, lon: 6.1767 },
        { type: 'node', id: 3, lat: frameLat, lon: 6.1777 },
        { type: 'way', id: 10, nodes: [1, 2], tags: { highway: 'residential' } },
        { type: 'way', id: 11, nodes: [2, 3], tags },
      ];
      const g = buildGraphFromOverpassJson({ elements: els }, { origin: { lng: 6.1757, lat: frameLat } }).graph;
      return { g, nav: new NavContext(g, DEFAULT_NAV_PARAMS) };
    };
    const { g, nav } = mk({ highway: 'busway' });
    const to = { x: g.nodeX[g.nodeCount - 1] as number, y: g.nodeY[g.nodeCount - 1] as number };
    const route = nav.findRoute({ x: g.nodeX[0] as number, y: g.nodeY[0] as number }, to, 'crowd');
    expect(route).not.toBeNull();
    // sans la règle, la voie aurait été absente du graphe
    expect(g.edgeCount).toBe(2);
    expect(nav.findRoute({ x: 0, y: 0 }, to, 'emergency')).not.toBeNull();
    const { g: g2 } = mk({ highway: 'service', access: 'no' });
    expect(g2.edgeCount).toBe(1);
  });
});

describe('multipolygones (grandes places, parcs, bâtiments à cour)', () => {
  const O = { lng: 6.1757, lat: 49.1193 };
  const d = 0.0006;
  const pt = (x: number, y: number) => ({ lat: O.lat + y * d, lon: O.lng + x * d });
  const street = (id: number, a: [number, number], b: [number, number]) => [
    { type: 'node', id: id * 10, ...pt(...a) },
    { type: 'node', id: id * 10 + 1, ...pt(...b) },
    { type: 'way', id, nodes: [id * 10, id * 10 + 1], tags: { highway: 'residential' } },
  ];
  const base = [...street(1, [-1, 0], [1, 0]), ...street(2, [1, 0], [1, 1]), ...street(3, [-1, 1], [1, 1]), ...street(4, [-1, 0], [-1, 1]), ...street(5, [1, 1], [2, 1])];
  const square = (tags: Record<string, string>, split = true) => ({
    type: 'relation',
    id: 900,
    tags: { type: 'multipolygon', ...tags },
    members: split
      ? [
          { type: 'way', ref: 1, role: 'outer', geometry: [pt(-0.8, 0.1), pt(0.8, 0.1), pt(0.8, 0.9)] },
          { type: 'way', ref: 2, role: 'outer', geometry: [pt(-0.8, 0.9), pt(0.8, 0.9)].reverse().concat([pt(-0.8, 0.1)]).reverse() },
        ]
      : [{ type: 'way', ref: 1, role: 'outer', geometry: [pt(-0.8, 0.1), pt(0.8, 0.1), pt(0.8, 0.9)] }],
  });

  it('une place cartographiée en multipolygone (anneau en deux chemins, sens quelconque) devient un espace ouvert', () => {
    const json = { elements: [...base, square({ place: 'square', name: 'Place de la République' })] };
    const g = buildGraphFromOverpassJson(json, { origin: O }).graph;
    expect(g.spaces.length).toBe(1);
    expect(g.spaces[0]).toMatchObject({ kind: 'square', name: 'Place de la République', source: 'osm' });
    expect(g.spaces[0]!.ring.length / 2).toBeGreaterThanOrEqual(4);
  });

  it('un bâtiment multipolygone devient un obstacle ; un anneau non fermé est ignoré (comptée comme relation ignorée)', () => {
    const b = buildGraphFromOverpassJson({ elements: [...base, square({ building: 'yes' })] }, { origin: O });
    expect(b.graph.obstacles.length).toBe(1);
    const open = buildGraphFromOverpassJson({ elements: [...base, square({ place: 'square' }, false)] }, { origin: O });
    expect(open.graph.spaces.length).toBe(0);
    expect(open.report.relationsSkipped).toBe(1);
  });

  it('la requête Overpass demande les multipolygones avec leur géométrie', () => {
    const q = overpassQuery({ south: 49, west: 6, north: 49.01, east: 6.01 });
    expect(q).toContain('relation["type"="multipolygon"]["place"="square"]');
    expect(q).toContain('out geom;');
  });

  it('un cortège dont l’arrivée est sur cette place s’y rassemble (la place est praticable)', async () => {
    const { Sim } = await import('../../src/engine/sim');
    const json = { elements: [...base, square({ place: 'square', name: 'Place de la République' })] };
    const g = buildGraphFromOverpassJson(json, { origin: O }).graph;
    const sim = new Sim({ graph: g, seed: 1 });
    const sp = g.spaces[0]!;
    let cx = 0;
    let cy = 0;
    for (let i = 0; i < sp.ring.length; i += 2) {
      cx += sp.ring[i] as number;
      cy += sp.ring[i + 1] as number;
    }
    cx /= sp.ring.length / 2;
    cy /= sp.ring.length / 2;
    expect(sim.mask!.isOpen(cx, cy)).toBe(true);
    expect(sim.mask!.isBlocked(cx, cy)).toBe(false);
  });
});
