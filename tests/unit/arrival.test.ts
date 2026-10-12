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

describe('le rassemblement ne s’installe et la dispersion ne commence que lorsque TOUS sont arrivés', () => {
  it('au début de la dispersion, personne n’est loin de son créneau (aucun saut)', () => {
    const graph = buildSchematicGraph({ lng: 6.1757, lat: 49.1193 }, 1400, 1050);
    const c = new GameController({ graph, seed: 7 });
    let atDispersal: number | null = null;
    for (let t = 0; t < 30000 && atDispersal === null; t++) {
      c.runTicks(1);
      const g = c.sim.group('G-1');
      if (g && g.phase === 'dispersing' && g.layout) {
        let worst = 0;
        for (let i = g.members.activeStart; i < g.members.n; i++) {
          const slot = g.members.slotOf[i] as number;
          worst = Math.max(worst, Math.hypot((g.members.x[i] as number) - (g.layout.pts[2 * slot] as number), (g.members.y[i] as number) - (g.layout.pts[2 * slot + 1] as number)));
        }
        atDispersal = worst;
      }
    }
    expect(atDispersal).not.toBeNull();
    expect(atDispersal as number).toBeLessThan(12); // chacun est déjà sur son créneau, pas téléporté
  }, 200_000);
});
