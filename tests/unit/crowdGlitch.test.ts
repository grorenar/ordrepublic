import { describe, expect, it } from 'vitest';
import { loadZoneGraph } from '../../src/nav/osm/live';
import { GameController } from '../../src/game/controller';
import { Sim } from '../../src/engine/sim';
import { memberLive } from '../../src/game/selection';
import type { Obstacle, OpenSpace } from '../../src/nav/graph';
import { overpassMess } from '../fixtures/overpassMess';
import { anchorAt, PLAN } from './engineHelpers';
import { gridGraph } from './navHelpers';

const metz = { lng: 6.1757, lat: 49.1193 };
const strip = (x0: number, x1: number, y0: number, y1: number): Obstacle => ({ ring: new Float32Array([x0, y0, x1, y0, x1, y1, x0, y1]), source: 'synthetic' });

describe('aucun individu figé ou traversant les bâtiments (données OSM difficiles : rues obliques et sinueuses, immeubles irréguliers)', () => {
  it('pendant tout le scénario, moins de 2 % des individus visibles sont dans un bâtiment (en moyenne moins de 0,5 %)', async () => {
    const graph = (await loadZoneGraph(metz, { halfWidth: 600, halfHeight: 450 }, 'T', { cache: null, fetchFn: (async () => new Response(JSON.stringify(overpassMess(metz)))) as typeof fetch })).graph;
    const c = new GameController({ graph, zoneLevel: 1 });
    const mask = c.sim.mask!;
    let worst = 0;
    let sum = 0;
    let n = 0;
    for (let t = 0; t < 11000; t++) {
      c.runTicks(1);
      if (t % 100 !== 0) continue;
      for (const g of c.sim.groups) {
        const m = g.members;
        let vis = 0;
        let bad = 0;
        for (let i = Math.max(m.activeStart, g.entryStart); i < m.n; i += 3) {
          vis++;
          if (mask.isBlocked(m.x[i] as number, m.y[i] as number)) bad++;
        }
        if (vis < 50) continue;
        worst = Math.max(worst, bad / vis);
        sum += bad / vis;
        n++;
      }
    }
    expect(worst).toBeLessThan(0.02);
    expect(sum / n).toBeLessThan(0.005);
  }, 280_000);
});

describe('un individu déjà dans un bâtiment en sort (jamais figé)', () => {
  it('placé dans un bâtiment, il rejoint la rue', () => {
    const graph = gridGraph({ cols: 6, rows: 1, spacing: 100, width: 8, obstacles: [strip(-300, 300, 8, 40)] });
    const sim = new Sim({ graph, seed: 1 });
    sim.createGroup({ label: 'p', kind: 'static', size: 200, origin: { x: 0, y: 0 }, anchor: anchorAt({ x: 0, y: 0 }) }, PLAN);
    sim.run(5);
    const g = sim.groups[0]!;
    const i = 10;
    g.members.x[i] = 5;
    g.members.y[i] = 20; // en plein bâtiment
    expect(sim.mask!.isBlocked(5, 20)).toBe(true);
    sim.run(200);
    expect(sim.mask!.isBlocked(g.members.x[i] as number, g.members.y[i] as number)).toBe(false);
  });
});

describe('une colonne qui arrive par une porte n’est pas posée à travers les immeubles', () => {
  it('les individus hors de la zone sont invisibles, puis entrent un à un', async () => {
    const graph = (await loadZoneGraph(metz, { halfWidth: 600, halfHeight: 450 }, 'T', { cache: null, fetchFn: (async () => new Response(JSON.stringify(overpassMess(metz)))) as typeof fetch })).graph;
    const c = new GameController({ graph, zoneLevel: 1 });
    c.runTicks(2);
    const g = c.sim.group('G-1')!;
    expect(g.entryStart).toBeGreaterThan(1500); // la grande majorité attend encore hors de la zone
    expect(memberLive(g, 0)).toBe(false);
    expect(memberLive(g, g.members.n - 1)).toBe(true); // la tête est entrée
    let prev = g.entryStart;
    for (let k = 0; k < 40; k++) {
      c.runTicks(50);
      expect(g.entryStart).toBeLessThanOrEqual(prev); // ils entrent, jamais l'inverse
      prev = g.entryStart;
    }
    expect(prev).toBeLessThan(1500);
  }, 60_000);
});

describe('les gens occupent l’espace en se séparant, sans ralentir', () => {
  const plaza: OpenSpace = { id: 'p', kind: 'square', ring: new Float32Array([-100, -40, 100, -40, 100, 40, -100, 40]), source: 'synthetic' };
  it('sur une place : densité plus faible que dans la rue, vitesse inchangée', () => {
    const graph = gridGraph({ cols: 6, rows: 1, spacing: 100, width: 6, spaces: [plaza], obstacles: [strip(-320, 320, 200, 230)] });
    const sim = new Sim({ graph, seed: 1 });
    const g = sim.group(sim.createGroup({ label: 'c', kind: 'march', size: 3000, cohesion: 100, origin: { x: -250, y: 0 }, plan: { destination: anchorAt({ x: 250, y: 0 }), waypoints: [], onArrival: 'settle', patienceMs: 0 } }, PLAN))!;
    let speedStreet = 0;
    let densityPlaza = 0;
    let speedPlaza = 0;
    for (let t = 0; t < 6000; t++) {
      sim.step();
      const head = g.sCentre + g.columnLength / 2 - 250;
      if (t === 300) speedStreet = g.speedMps;
      if (head > -20 && head < 20 && g.sCentre - 250 > -40 && densityPlaza === 0) {
        // densité moyenne sur la place (personnes présentes / aire de la place)
        let inside = 0;
        for (let i = 0; i < g.members.n; i++) {
          const x = g.members.x[i] as number;
          const y = g.members.y[i] as number;
          if (Math.abs(x) <= 100 && Math.abs(y) <= 40) inside++;
        }
        if (inside > 800) {
          densityPlaza = inside / (200 * 80);
          speedPlaza = g.speedMps;
        }
      }
    }
    expect(densityPlaza).toBeGreaterThan(0);
    expect(densityPlaza).toBeLessThan(1.5); // inférieure aux 2 pers/m² de la marche en rue
    expect(speedPlaza).toBeGreaterThan(speedStreet * 0.95); // sans ralentir
  }, 120_000);
});

describe('la rue prime sur un bâtiment mal superposé (axe d’une voie dans l’emprise d’un bâtiment)', () => {
  it('un bâtiment cartographié par-dessus l’axe de la rue ne piège ni ne laisse en arrière une partie du cortège', () => {
    // bâtiment de 40 m recouvrant l'axe de la rue, sans étiquette tunnel (cour d'église, passage non cartographié…)
    const graph = gridGraph({ cols: 6, rows: 1, spacing: 100, width: 6, obstacles: [strip(-20, 20, -25, 25)] });
    const sim = new Sim({ graph, seed: 1 });
    const g = sim.group(sim.createGroup({ label: 'c', kind: 'march', size: 800, cohesion: 100, origin: { x: -250, y: 0 }, plan: { destination: anchorAt({ x: 250, y: 0 }), waypoints: [], onArrival: 'settle', patienceMs: 0 } }, PLAN))!;
    for (let t = 0; t < 16000 && g.phase !== 'settled'; t++) sim.step();
    sim.run(900);
    let behind = 0;
    let inside = 0;
    for (let i = 0; i < g.members.n; i++) {
      if ((g.members.x[i] as number) < 120) behind++;
      if (sim.mask!.isBlocked(g.members.x[i] as number, g.members.y[i] as number)) inside++;
    }
    expect(g.phase).toBe('settled');
    expect(behind).toBe(0); // personne n'est resté coincé avant le bâtiment
    expect(inside).toBe(0);
  }, 120_000);

  it('un coin de bâtiment entre un individu et sa cible : il contourne par l’axe de la rue au lieu de rester collé au mur', () => {
    // carrefour en L : le bâtiment occupe l'angle intérieur ; la foule tourne à 90°
    const bl = strip(8, 160, 8, 160);
    const graph = gridGraph({ cols: 3, rows: 3, spacing: 100, width: 8, obstacles: [bl] });
    const sim = new Sim({ graph, seed: 1 });
    const g = sim.group(sim.createGroup({ label: 'c', kind: 'march', size: 600, cohesion: 100, origin: { x: -100, y: -100 }, plan: { destination: anchorAt({ x: 100, y: 100 }), waypoints: [], onArrival: 'settle', patienceMs: 0 } }, PLAN))!;
    let worstStall = 0;
    for (let t = 0; t < 20000 && g.phase !== 'settled'; t++) {
      sim.step();
      if (t % 200 === 0 && g.phase === 'moving') {
        // individus immobiles (< 1 cm depuis le tick précédent) alors que la colonne avance
        let still = 0;
        for (let i = g.members.activeStart; i < g.members.n; i++) if (Math.hypot((g.members.x[i] as number) - (g.members.px[i] as number), (g.members.y[i] as number) - (g.members.py[i] as number)) < 1e-3 && g.speedMps > 0.4) still++;
        worstStall = Math.max(worstStall, still / g.members.n);
      }
    }
    expect(g.phase).toBe('settled');
    expect(worstStall).toBeLessThan(0.05);
  }, 120_000);
});
