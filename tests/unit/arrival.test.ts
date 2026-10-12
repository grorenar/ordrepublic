import { describe, expect, it } from 'vitest';
import { Sim } from '../../src/engine/sim';
import { GameController } from '../../src/game/controller';
import { buildSchematicGraph } from '../../src/nav/schematicGraph';
import { anchorAt, PLAN } from './engineHelpers';
import { gridGraph } from './navHelpers';

describe('accès saturés : le cortège emprunte un autre accès', () => {
  it('avec un accès direct saturé par une foule, l’itinéraire passe par un autre accès libre et le cortège arrive', () => {
    const graph = gridGraph({ cols: 5, rows: 3, spacing: 100, width: 10 });
    const sim = new Sim({ graph, seed: 1, mask: null });
    // grand rassemblement qui sature l'accès direct (la rue y = 0 entre x = 0 et x = 200)
    sim.createGroup({ label: 'Foule', kind: 'static', size: 9000, origin: { x: 100, y: 0 }, anchor: anchorAt({ x: 100, y: 0 }, 'foule', 15) }, PLAN);
    sim.run(30);
    const saturated: number[] = [];
    for (let e = 0; e < graph.edgeCount; e++) if (sim.state.footState[e] === 3) saturated.push(e);
    expect(saturated.length).toBeGreaterThan(0);
    const g = sim.group(sim.createGroup({ label: 'Cortège', kind: 'march', size: 300, cohesion: 100, origin: { x: -200, y: 0 }, plan: { destination: anchorAt({ x: 200, y: 0 }, 'dest', 12), waypoints: [], onArrival: 'settle', patienceMs: 0 } }, PLAN))!;
    // il évite les accès saturés (hors le point d'arrivée lui-même, à longueur nulle sur l'arête d'accès)
    const r = g.route!;
    let onSaturated = 0;
    r.edges.forEach((e, i) => {
      if (saturated.includes(e)) onSaturated += (r.edgeStart[i + 1] as number) - (r.edgeStart[i] as number);
    });
    expect(onSaturated).toBeLessThan(2);
    for (let t = 0; t < 30000 && g.phase !== 'settled'; t++) sim.step();
    expect(g.phase).toBe('settled');
  }, 60_000);

  it('si tous les accès sont saturés, il se fraie un passage lentement au lieu d’attendre indéfiniment', () => {
    const graph = gridGraph({ cols: 5, rows: 1, spacing: 100, width: 10 });
    const sim = new Sim({ graph, seed: 1, mask: null });
    sim.createGroup({ label: 'Foule', kind: 'static', size: 9000, origin: { x: 150, y: 0 }, anchor: anchorAt({ x: 150, y: 0 }, 'foule', 15) }, PLAN);
    sim.run(30);
    const g = sim.group(sim.createGroup({ label: 'Cortège', kind: 'march', size: 200, cohesion: 100, origin: { x: -200, y: 0 }, plan: { destination: anchorAt({ x: 200, y: 0 }, 'dest', 12), waypoints: [], onArrival: 'settle', patienceMs: 0 } }, PLAN))!;
    expect(g.route).not.toBeNull(); // un itinéraire existe malgré la saturation (zone d'arrivée)
  });
});

describe('la dispersion ne commence que lorsque TOUS sont arrivés', () => {
  it('au moment de la dispersion par secteurs, personne ne saute d’un tick à l’autre (aucune téléportation)', () => {
    const graph = buildSchematicGraph({ lng: 6.1757, lat: 49.1193 }, 1400, 1050);
    const c = new GameController({ graph, seed: 7 });
    const prev = new Map<string, [number, number]>();
    let watching = 0;
    let worst = 0;
    for (let t = 0; t < 60000 && watching < 80; t++) {
      c.runTicks(1);
      const split = c.sim.groups.some((g) => g.label.includes('— sortie'));
      if (split && watching++ === 0) prev.clear(); // la scission réaffecte les indices : on repart de zéro
      for (const g of c.sim.groups) {
        const m = g.members;
        for (let i = Math.max(m.activeStart, g.entryStart); i < Math.min(m.n, g.exitStart); i += 7) {
          const k = `${g.id}:${i}`;
          const p = prev.get(k);
          if (split && p) worst = Math.max(worst, Math.hypot((m.x[i] as number) - p[0], (m.y[i] as number) - p[1]));
          prev.set(k, [m.x[i] as number, m.y[i] as number]);
        }
      }
    }
    expect(watching).toBeGreaterThan(0);
    expect(worst).toBeLessThan(3);
  }, 200_000);
});
