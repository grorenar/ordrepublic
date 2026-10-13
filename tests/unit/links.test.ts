import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../../src/geo/mercator';
import { buildGraph, EdgeClass, EdgeFlag, type Obstacle, type RawEdge } from '../../src/nav/graph';
import { NavContext } from '../../src/nav/astar';
import { addOpenSpaceLinks, addPedestrianLinks } from '../../src/nav/links';
import { DEFAULT_NAV_PARAMS } from '../../src/nav/params';

const origin = { lng: 6.17, lat: 49.11 };
const edge = (a: number, b: number, pts: Vec2[], o: Partial<RawEdge> = {}): RawEdge => ({ a, b, shape: pts, cls: EdgeClass.Tertiary, flags: EdgeFlag.Foot | EdgeFlag.Motor, width: 8, name: 'Avenue', ...o });

/** Deux voies parallèles de 400 m, distantes de `gap` m, reliées seulement à leurs extrémités (et éventuellement par des traverses). */
function twin(gap: number, o: { obstacles?: Obstacle[]; crossEvery?: number; flags?: number } = {}) {
  const nodes: Vec2[] = [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 0, y: gap }, { x: 400, y: gap }];
  const edges: RawEdge[] = [edge(0, 1, [nodes[0] as Vec2, nodes[1] as Vec2], { flags: o.flags ?? EdgeFlag.Foot | EdgeFlag.Motor }), edge(2, 3, [nodes[2] as Vec2, nodes[3] as Vec2], { flags: o.flags ?? EdgeFlag.Foot | EdgeFlag.Motor, name: 'Avenue bis' })];
  edges.push(edge(0, 2, [nodes[0] as Vec2, nodes[2] as Vec2], { name: 'Traverse' }), edge(1, 3, [nodes[1] as Vec2, nodes[3] as Vec2], { name: 'Traverse' }));
  if (o.crossEvery) {
    for (let x = o.crossEvery; x < 400; x += o.crossEvery) {
      const a = nodes.length;
      nodes.push({ x, y: 0 }, { x, y: gap });
      // les voies principales doivent passer par ces nœuds : on les recoupe
      edges.push(edge(a, a + 1, [{ x, y: 0 }, { x, y: gap }], { name: 'Traverse' }));
    }
    // reconstruit les deux voies en tronçons passant par les carrefours
    const xs = [0, ...Array.from({ length: Math.floor(399 / o.crossEvery) }, (_, k) => (k + 1) * o.crossEvery!), 400];
    edges.splice(0, 2);
    const nodeAt = (x: number, row: 0 | 1): number => (x === 0 ? (row ? 2 : 0) : x === 400 ? (row ? 3 : 1) : 4 + (x / o.crossEvery! - 1) * 2 + row);
    for (let i = 1; i < xs.length; i++) for (const row of [0, 1] as const) {
      const y = row ? gap : 0;
      edges.push(edge(nodeAt(xs[i - 1] as number, row), nodeAt(xs[i] as number, row), [{ x: xs[i - 1] as number, y }, { x: xs[i] as number, y }], { name: row ? 'Avenue bis' : 'Avenue' }));
    }
  }
  return buildGraph({ origin, nodes, edges, obstacles: o.obstacles, provenance: { source: 'osm' } });
}
const wall: Obstacle = { ring: new Float32Array([-10, 4, 410, 4, 410, 11, -10, 11]), source: 'osm' };

describe('liaisons piétonnes entre voies adjacentes', () => {
  it('deux voies voisines sans bâtiment entre elles : le piéton passe de l’une à l’autre (trajet de ~15 m au lieu de ~400 m)', () => {
    const g = twin(15);
    const before = new NavContext(g, DEFAULT_NAV_PARAMS).findRoute({ x: 200, y: 0 }, { x: 200, y: 15 }, 'crowd')!;
    expect(before.length).toBeGreaterThan(350);
    const r = addPedestrianLinks(g);
    expect(r.added).toBeGreaterThan(2);
    const after = new NavContext(r.graph, DEFAULT_NAV_PARAMS).findRoute({ x: 200, y: 0 }, { x: 200, y: 15 }, 'crowd')!;
    expect(after.length).toBeLessThan(60);
  });

  it('un bâtiment entre les deux voies : aucune liaison', () => {
    expect(addPedestrianLinks(twin(15, { obstacles: [wall] })).added).toBe(0);
  });

  it('voies trop éloignées, ou déjà reliées par des traverses rapprochées : aucune liaison', () => {
    expect(addPedestrianLinks(twin(60)).added).toBe(0);
    expect(addPedestrianLinks(twin(15, { crossEvery: 40 })).added).toBe(0);
  });

  it('tunnels et ponts ne sont jamais liés', () => {
    expect(addPedestrianLinks(twin(15, { flags: EdgeFlag.Foot | EdgeFlag.Motor | EdgeFlag.Tunnel })).added).toBe(0);
  });

  it('les voies coupées gardent leur longueur, leur classe et leur nom ; les liaisons sont piétonnes seulement (3 m)', () => {
    const g = twin(15);
    const { graph } = addPedestrianLinks(g);
    let orig = 0;
    let links = 0;
    for (let e = 0; e < graph.edgeCount; e++) {
      const link = graph.edgeClass[e] === EdgeClass.Footway && graph.edgeName[e] === undefined;
      if (link) {
        links++;
        expect((graph.edgeFlags[e] as number) & EdgeFlag.Motor).toBe(0);
        expect((graph.edgeFlags[e] as number) & EdgeFlag.Foot).toBeTruthy();
        expect(graph.edgeWidth[e]).toBe(3);
        expect(graph.edgeLen[e]).toBeGreaterThan(2.9);
        expect(graph.edgeLen[e]).toBeLessThan(25);
      } else orig += graph.edgeLen[e] as number;
    }
    let before = 0;
    for (let e = 0; e < g.edgeCount; e++) before += g.edgeLen[e] as number;
    expect(links).toBeGreaterThan(2);
    expect(orig).toBeCloseTo(before, 1);
    const names = new Set<string>();
    for (let e = 0; e < graph.edgeCount; e++) if (graph.edgeName[e]) names.add(graph.edgeName[e] as string);
    expect([...names].sort()).toEqual(['Avenue', 'Avenue bis', 'Traverse']);
  });

  it('les véhicules ne passent pas par les liaisons ; déterministe ; sans effet si rien à relier', () => {
    const g = twin(15);
    const a = addPedestrianLinks(g);
    const b = addPedestrianLinks(g);
    expect(a.added).toBe(b.added);
    expect(Array.from(a.graph.edgeLen)).toEqual(Array.from(b.graph.edgeLen));
    const nav = new NavContext(a.graph, DEFAULT_NAV_PARAMS);
    const r = nav.findRoute({ x: 200, y: 0 }, { x: 200, y: 15 }, 'vehicle')!;
    expect(r.length).toBeGreaterThan(300); // un fourgon fait le tour : la liaison de 3 m est trop étroite et piétonne
    const g2 = twin(60);
    expect(addPedestrianLinks(g2).graph).toBe(g2); // rien à relier : même graphe
  });
});

describe('coût sur un grand réseau', () => {
  it('quelques milliers d’arêtes en moins de 2 s', async () => {
    const { gridGraph } = await import('./navHelpers');
    const g = gridGraph({ cols: 40, rows: 30, spacing: 22, width: 8 });
    const t0 = performance.now();
    addPedestrianLinks(g);
    expect(performance.now() - t0).toBeLessThan(2000);
    expect(g.edgeCount).toBeGreaterThan(2000);
  });
});

describe('traversée d’une place ou d’une zone piétonne cartographiée en surface', () => {
  const plaza = { id: 'sj', kind: 'pedestrian_area' as const, name: 'Place Saint-Jacques', ring: new Float32Array([-88, -15, 88, -15, 88, 15, -88, 15]), source: 'osm' as const };
  const ringRoad = (o: { obstacles?: Obstacle[]; through?: boolean } = {}) => {
    const nodes: Vec2[] = [{ x: -95, y: 0 }, { x: 95, y: 0 }, { x: -95, y: 200 }, { x: 95, y: 200 }];
    const edges: RawEdge[] = [
      edge(0, 2, [nodes[0] as Vec2, nodes[2] as Vec2], { name: 'Rue A' }),
      edge(2, 3, [nodes[2] as Vec2, nodes[3] as Vec2], { name: 'Rue B' }),
      edge(3, 1, [nodes[3] as Vec2, nodes[1] as Vec2], { name: 'Rue C' }),
    ];
    if (o.through) edges.push(edge(0, 1, [nodes[0] as Vec2, nodes[1] as Vec2], { name: 'Passage' }));
    return buildGraph({ origin, nodes, edges, spaces: [plaza], obstacles: o.obstacles, provenance: { source: 'osm' } });
  };

  it('une place sans aucune arête à l’intérieur devient traversable : le cortège la coupe au lieu de la contourner', () => {
    const g = ringRoad();
    const before = new NavContext(g, DEFAULT_NAV_PARAMS).findRoute({ x: -95, y: 0 }, { x: 95, y: 0 }, 'crowd')!;
    expect(before.length).toBeGreaterThan(550);
    const r = addOpenSpaceLinks(g);
    expect(r.added).toBeGreaterThanOrEqual(1);
    const after = new NavContext(r.graph, DEFAULT_NAV_PARAMS).findRoute({ x: -95, y: 0 }, { x: 95, y: 0 }, 'crowd')!;
    expect(after.length).toBeLessThan(200);
    // classe piétonne : comme sur toute voie piétonne large, un véhicule peut la traverser, mais au pas (3 m/s)
    const veh = new NavContext(r.graph, DEFAULT_NAV_PARAMS).findRoute({ x: -95, y: 0 }, { x: 95, y: 0 }, 'vehicle')!;
    expect(veh.length).toBeLessThan(200);
  });

  it('pas de traversée si une voie la traverse déjà, ou si un bâtiment la barre', () => {
    expect(addOpenSpaceLinks(ringRoad({ through: true })).added).toBe(0);
    const wall: Obstacle = { ring: new Float32Array([-5, -14, 5, -14, 5, 14, -5, 14]), source: 'osm' };
    expect(addOpenSpaceLinks(ringRoad({ obstacles: [wall] })).added).toBe(0);
  });

  it('un graphe sans espace ouvert est inchangé', () => {
    const g = twin(60);
    expect(addOpenSpaceLinks(g).graph).toBe(g);
  });
});
