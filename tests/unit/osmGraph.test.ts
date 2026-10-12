import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EdgeClass, EdgeFlag, connectedComponents } from '../../src/nav/graph';
import { buildGraphFromOverpassJson } from '../../src/nav/osm/buildGraph';
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
