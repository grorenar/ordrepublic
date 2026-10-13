import { describe, expect, it } from 'vitest';
import { Sim } from '../../src/engine/sim';
import type { CrowdGroup } from '../../src/engine/types';
import { anchorAt, PLAN } from './engineHelpers';
import { gridGraph } from './navHelpers';

const place = { id: 'p', kind: 'square' as const, ring: new Float32Array([-60, -60, 60, -60, 60, 60, -60, 60]), source: 'osm' as const };

function start(unroll: number) {
  const g = gridGraph({ cols: 9, rows: 3, spacing: 100, width: 10, spaces: [place] });
  const sim = new Sim({ graph: g, seed: 1, params: { departureUnroll: unroll } });
  const grp = sim.group(sim.createGroup({ label: 'Rassemblement', kind: 'static', size: 4000, origin: { x: 0, y: 0 }, anchor: anchorAt({ x: 0, y: 0 }, 'place', 15) }, PLAN))!;
  sim.run(50);
  const ok = sim.beginMarch(grp.id, { destination: anchorAt({ x: 350, y: 0 }, 'arrivée', 15), onArrival: 'settle' }, { kind: 'scenario_event', refId: 't', note: 'départ du cortège (test)' });
  expect(ok).toBe(true);
  return { sim, grp };
}

const snapshot = (g: CrowdGroup) => ({ x: Float32Array.from(g.members.x), y: Float32Array.from(g.members.y) });

describe('démarrage d’un cortège depuis un rassemblement', () => {
  it('tout le monde se met en route en même temps ; les plus éloignés de la tête avancent plus lentement (le cortège s’étire)', () => {
    const { sim, grp } = start(1);
    sim.step();
    const a = snapshot(grp);
    sim.run(300); // 30 s
    const n = grp.members.n;
    let moved = 0;
    const speedByDecile = new Array(10).fill(0) as number[];
    for (let i = 0; i < n; i++) {
      const d = Math.hypot((grp.members.x[i] as number) - (a.x[i] as number), (grp.members.y[i] as number) - (a.y[i] as number));
      if (d > 0.5) moved++;
      speedByDecile[Math.min(9, Math.floor((i / n) * 10))]! += d / 300;
    }
    expect(moved / n).toBeGreaterThan(0.85);
    // indice 0 = queue (le plus loin de la tête) : avance moins vite que la tête (indices élevés)
    const rear = (speedByDecile[0]! + speedByDecile[1]!) / 2;
    const front = (speedByDecile[8]! + speedByDecile[9]!) / 2;
    expect(front).toBeGreaterThan(rear);
  }, 120_000);

  it('avec departureUnroll = 0 (ancien comportement) l’arrière attend : bien moins de monde en mouvement après 30 s', () => {
    const share = (u: number) => {
      const { sim, grp } = start(u);
      sim.step();
      const a = snapshot(grp);
      sim.run(300);
      let moved = 0;
      for (let i = 0; i < grp.members.n; i++) if (Math.hypot((grp.members.x[i] as number) - (a.x[i] as number), (grp.members.y[i] as number) - (a.y[i] as number)) > 0.5) moved++;
      return moved / grp.members.n;
    };
    expect(share(1)).toBeGreaterThan(share(0) + 0.2);
  }, 120_000);

  it('personne ne saute ni ne reste en arrière : tout le monde est dans la colonne puis arrive à destination', () => {
    const { sim, grp } = start(1);
    let prevX = Float32Array.from(grp.members.x);
    let prevY = Float32Array.from(grp.members.y);
    let maxStep = 0;
    for (let t = 0; t < 12000 && grp.phase !== 'settled'; t++) {
      sim.step();
      for (let i = 0; i < grp.members.n; i += 5) maxStep = Math.max(maxStep, Math.hypot((grp.members.x[i] as number) - (prevX[i] as number), (grp.members.y[i] as number) - (prevY[i] as number)));
      prevX = Float32Array.from(grp.members.x);
      prevY = Float32Array.from(grp.members.y);
    }
    expect(grp.phase).toBe('settled');
    expect(maxStep).toBeLessThan(1.5);
  }, 200_000);
});
