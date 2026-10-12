import { describe, expect, it } from 'vitest';
import { Sim } from '../../src/engine/sim';
import { anchorAt, PLAN } from './engineHelpers';
import { gridGraph } from './navHelpers';

const graph = () => gridGraph({ cols: 9, rows: 5, spacing: 100, width: 12 });
const rally = (sim: Sim, size = 600) => sim.createGroup({ key: 'rassemblement', label: 'Rassemblement', kind: 'static', size, origin: { x: -300, y: 0 }, anchor: anchorAt({ x: -300, y: 0 }, 'Point de rassemblement', 20) }, PLAN);

describe('départ depuis un point de rassemblement', () => {
  it('chacun part de sa place, la tête en premier, sans saut ; les personnes sont conservées ; arrivée et installation', () => {
    const sim = new Sim({ graph: graph(), seed: 5, mask: null });
    const id = rally(sim, 3000);
    sim.run(100);
    const g = sim.group(id)!;
    const before = sim.totalPeople();
    const ok = sim.beginMarch(id, { destination: anchorAt({ x: 300, y: 0 }, 'Destination', 15) }, { kind: 'scenario_event', refId: 'depart', note: 'heure de départ du cortège atteinte' });
    expect(ok).toBe(true);
    expect(g.kind).toBe('march');
    expect(g.phase).toBe('moving');
    let maxStep = 0;
    let headMovedFirst = false;
    const m = g.members;
    const xs0 = Float32Array.from(m.x);
    for (let t = 0; t < 600; t++) {
      sim.step();
      for (let i = 0; i < m.n; i += 3) maxStep = Math.max(maxStep, Math.hypot((m.x[i] as number) - (m.px[i] as number), (m.y[i] as number) - (m.py[i] as number)));
      if (t === 200) {
        // après 20 s, la tête (plus grand indice) a bougé, la queue (indice 0) pas encore
        const dHead = Math.hypot((m.x[m.n - 1] as number) - (xs0[m.n - 1] as number), 0);
        const dTail = Math.abs((m.x[0] as number) - (xs0[0] as number));
        headMovedFirst = dHead > 3 && dTail < 1.5;
      }
    }
    expect(maxStep).toBeLessThan(0.75); // jamais de saut
    expect(headMovedFirst).toBe(true);
    expect(sim.totalPeople()).toBe(before);
    expect(sim.journal.byCode('group.march_started')[0]!.why.refId).toBe('depart');
    for (let t = 0; t < 40000 && g.phase !== 'settled'; t++) sim.step();
    expect(g.phase).toBe('settled');
    expect(Math.hypot(g.layout!.anchor.x - 300, g.layout!.anchor.y)).toBeLessThan(40);
  }, 120_000);

  it('refus journalisé si aucun itinéraire ; seul un rassemblement installé peut partir', () => {
    const sim = new Sim({ graph: graph(), seed: 5, mask: null });
    const id = rally(sim, 100);
    sim.run(10);
    expect(sim.beginMarch(id, { destination: anchorAt({ x: 9e5, y: 9e5 }, 'Nulle part', 10) }, PLAN)).toBe(false);
    expect(sim.journal.byCode('group.march_failed')).toHaveLength(1);
    const march = sim.createGroup({ label: 'M', kind: 'march', size: 50, origin: { x: -300, y: 0 }, plan: { destination: anchorAt({ x: 300, y: 0 }), waypoints: [], onArrival: 'settle', patienceMs: 0 } }, PLAN);
    expect(sim.beginMarch(march, { destination: anchorAt({ x: 0, y: 0 }) }, PLAN)).toBe(false);
  });
});

describe('dispersion par secteurs : plusieurs colonnes vers des sorties différentes', () => {
  it('chaque colonne quitte la zone un individu après l’autre ; tout le monde sort ; aucun saut ; effectifs conservés jusqu’à la sortie', () => {
    const sim = new Sim({ graph: graph(), seed: 5, mask: null });
    const id = rally(sim, 900);
    sim.run(50);
    const exits = [
      { anchor: anchorAt({ x: -400, y: -200 }, 'Sortie ouest', 10), share: 0.4 },
      { anchor: anchorAt({ x: 400, y: -200 }, 'Sortie est', 10), share: 0.35 },
      { anchor: anchorAt({ x: 0, y: 200 }, 'Sortie nord', 10), share: 0.25 },
    ];
    expect(sim.disperseSectors(id, exits, { kind: 'scenario_event', refId: 'fin', note: 'fin de la manifestation' })).toBe(true);
    const groups = sim.groups.filter((g) => g.plan.onArrival === 'leave');
    expect(groups).toHaveLength(3);
    expect(new Set(groups.map((g) => g.plan.destination!.label)).size).toBe(3);
    expect(sim.totalPeople()).toBe(900);
    let maxStep = 0;
    let sawPartial = false;
    for (let t = 0; t < 40000 && sim.totalPeople() > 0; t++) {
      sim.step();
      for (const g of groups) {
        for (let i = Math.max(g.members.activeStart, g.entryStart); i < Math.min(g.members.n, g.exitStart); i += 4) maxStep = Math.max(maxStep, Math.hypot((g.members.x[i] as number) - (g.members.px[i] as number), (g.members.y[i] as number) - (g.members.py[i] as number)));
        if (sim.size(g) > 0 && sim.size(g) < g.members.n) sawPartial = true;
      }
    }
    expect(sim.totalPeople()).toBe(0);
    expect(sawPartial).toBe(true); // ils sortent progressivement, pas tous d'un coup
    expect(maxStep).toBeLessThan(0.75);
    expect(sim.journal.byCode('group.dispersed').length).toBeGreaterThanOrEqual(3);
  }, 200_000);
});
