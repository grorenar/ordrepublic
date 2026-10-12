import { describe, expect, it } from 'vitest';
import { EdgeClass, EdgeFlag, buildGraph, type Obstacle, type OpenSpace } from '../../src/nav/graph';
import { Sim } from '../../src/engine/sim';
import { anchorAt, PLAN } from './engineHelpers';
import { gridGraph } from './navHelpers';
import { loadZoneGraph } from '../../src/nav/osm/live';
import { GameController } from '../../src/game/controller';
import { overpassGrid } from '../fixtures/overpassGrid';

const strip = (x0: number, x1: number, y0: number, y1: number): Obstacle => ({ ring: new Float32Array([x0, y0, x1, y0, x1, y1, x0, y1]), source: 'synthetic' });
const march = (size: number) => ({ label: 'c', kind: 'march' as const, size, cohesion: 100, origin: { x: -250, y: 0 }, plan: { destination: anchorAt({ x: 250, y: 0 }), waypoints: [], onArrival: 'settle' as const, patienceMs: 0 } });
const yRange = (sim: Sim, g: ReturnType<Sim['group']>, x0: number, x1: number) => {
  const m = g!.members;
  let lo = Infinity;
  let hi = -Infinity;
  let k = 0;
  for (let i = m.activeStart; i < m.n; i++) {
    const x = m.x[i] as number;
    if (x < x0 || x > x1) continue;
    lo = Math.min(lo, m.y[i] as number);
    hi = Math.max(hi, m.y[i] as number);
    k++;
  }
  return { range: hi - lo, count: k };
};

describe('chaque partie du cortège occupe l’espace de SA position (pas une largeur unique pour toute la colonne)', () => {
  it('la queue garde sa largeur dans la rue large pendant que la tête traverse la rue étroite, et la colonne s’y allonge', () => {
    // x < 0 : façades à ±11 m (22 m) ; x > 0 : façades à ±3,5 m (7 m)
    const graph = gridGraph({ cols: 6, rows: 1, spacing: 100, width: 6, obstacles: [strip(-320, 0, 11, 45), strip(-320, 0, -45, -11), strip(0, 320, 3.5, 30), strip(0, 320, -30, -3.5)] });
    const sim = new Sim({ graph, seed: 1 });
    const g = sim.group(sim.createGroup(march(4000), PLAN))!;
    // on avance jusqu'à ce que la tête soit nettement dans la rue étroite et que la queue soit encore dans la rue large
    let ok = false;
    for (let t = 0; t < 4000 && !ok; t++) {
      sim.step();
      const head = g.sCentre + g.columnLength / 2 - 250; // abscisse x approximative de la tête (route le long de x)
      const tail = g.sCentre - g.columnLength / 2 - 250;
      ok = head > 40 && tail < -60;
    }
    expect(ok).toBe(true);
    sim.run(30);
    const wide = yRange(sim, g, -250, -60);
    const narrow = yRange(sim, g, 25, 250);
    expect(wide.count).toBeGreaterThan(100);
    expect(narrow.count).toBeGreaterThan(50);
    expect(wide.range).toBeGreaterThan(12); // la queue occupe la rue large (front jusqu'à 14 m)
    expect(narrow.range).toBeLessThan(6.6); // la tête tient dans la rue étroite (façades à 7 m, bruit individuel compris)
    // jamais dans un bâtiment
    expect(yRange(sim, g, 0, 250).range).toBeLessThan(7);
  }, 60_000);
});

describe('un cortège occupe les espaces ouverts (places) quand il n’y a pas de bâtiments', () => {
  const plaza: OpenSpace = { id: 'p', kind: 'square', ring: new Float32Array([-100, -40, 100, -40, 100, 40, -100, 40]), source: 'synthetic' };
  it('en place ouverte il s’étale bien au-delà du front des rues ; hors de la place il retombe à la largeur de la rue', () => {
    const graph = gridGraph({ cols: 6, rows: 1, spacing: 100, width: 6, spaces: [plaza], obstacles: [strip(-320, 320, 200, 230)] });
    const sim = new Sim({ graph, seed: 1 });
    const g = sim.group(sim.createGroup(march(3000), PLAN))!;
    let inPlaza = false;
    for (let t = 0; t < 4000 && !inPlaza; t++) {
      sim.step();
      inPlaza = g.sCentre - 250 > -30 && g.sCentre - 250 < 30;
    }
    expect(inPlaza).toBe(true);
    sim.run(20);
    const onPlaza = yRange(sim, g, -40, 40);
    expect(onPlaza.range).toBeGreaterThan(20); // dépasse largement les 14 m de front d'une rue
    expect(onPlaza.range).toBeLessThan(41); // et reste dans la place (80 m) et dans openSpaceFrontMaxM (40 m)
    // en dehors de la place, rue sans façade : chaussée + trottoirs seulement (pas de débordement dans le vide)
    const outside = yRange(sim, g, 130, 260);
    if (outside.count > 20) expect(outside.range).toBeLessThan(12);
  }, 60_000);
});

describe('tunnels et passages couverts : les bâtiments au-dessus ne bloquent pas le cortège', () => {
  it('le passage couvert sous un bâtiment est franchi (sans tunnel : individus repoussés)', () => {
    const building = strip(-45, 45, -40, 40); // un grand bâtiment au-dessus de la rue (le tunnel le dépasse de part et d'autre)
    const make = (tunnel: boolean) =>
      gridGraph({
        cols: 6,
        rows: 1,
        spacing: 100,
        width: 5,
        cls: EdgeClass.Footway,
        obstacles: [building],
        extraFlags: tunnel ? (a, b) => (Math.min(a.x, b.x) >= -60 && Math.max(a.x, b.x) <= 60 + 40 ? EdgeFlag.Tunnel : 0) : undefined,
      });
    const run = (tunnel: boolean) => {
      const sim = new Sim({ graph: make(tunnel), seed: 1 });
      const g = sim.group(sim.createGroup(march(400), PLAN))!;
      for (let t = 0; t < 16000 && g.phase !== 'settled'; t++) sim.step();
      sim.run(900); // le temps de rejoindre les créneaux
      let stuck = 0; // individus restés en arrière du bâtiment (destination en x = 250)
      for (let i = 0; i < g.members.n; i++) if ((g.members.x[i] as number) < 100) stuck++;
      return { phase: g.phase, stuck, sim };
    };
    const ok = run(true);
    expect(ok.phase).toBe('settled');
    expect(ok.stuck).toBe(0); // tout le cortège est passé sous le bâtiment
    expect(ok.sim.mask!.isBlocked(0, 0)).toBe(false);
    // la rue prime sur un bâtiment mal superposé : même sans l'étiquette tunnel, l'axe de la voie reste praticable (aucun individu coincé)
    expect(run(false).stuck).toBe(0);
  }, 120_000);
});

describe('piquet devant une VRAIE administration', () => {
  const metz = { lng: 6.1757, lat: 49.1193 };
  const load = async (o: { townhall?: boolean; market?: boolean }) => (await loadZoneGraph(metz, { halfWidth: 600, halfHeight: 450 }, 'T', { cache: null, fetchFn: (async () => new Response(JSON.stringify(overpassGrid(metz, o)))) as typeof fetch })).graph;
  it('l’hôtel de ville est choisi, pas le marché couvert plus proche', async () => {
    const c = new GameController({ graph: await load({ townhall: true, market: true }), zoneLevel: 1 });
    const admin = c.scenario.places.admin;
    expect(admin.label).toBe('Hôtel de Ville (fictif)');
    expect(c.scenario.timeline.find((e) => e.id === 'ev-0-piquet')).toMatchObject({ reason: expect.stringContaining('Hôtel de Ville') });
    expect(c.sim.graph.obstacles.some((o) => o.kind === 'administration')).toBe(true);
  });
  it('sans administration dans le secteur : piquet générique, jamais présenté comme une administration', async () => {
    const c = new GameController({ graph: await load({ market: true }), zoneLevel: 1 });
    expect(c.scenario.places.admin.label).not.toContain('Marché');
    expect(c.scenario.places.admin.label).not.toMatch(/administration/i);
    const ev = c.scenario.timeline.find((e) => e.id === 'ev-0-piquet')!;
    expect((ev as { spec: { label: string } }).spec.label).toBe('Piquet de rassemblement');
  });
});
