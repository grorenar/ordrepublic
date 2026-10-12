import { describe, expect, it } from 'vitest';
import { Sim } from '../../src/engine/sim';
import { EdgeClass } from '../../src/nav/graph';
import { anchorAt, PLAN } from './engineHelpers';
import { gridGraph } from './navHelpers';

const make = (o: { oneways?: number } = {}) => new Sim({ graph: gridGraph({ cols: 8, rows: 1, spacing: 100, width: 9, cls: EdgeClass.Secondary, oneways: o.oneways }), seed: 3, mask: null });
const arrive = (sim: Sim, id: string, max = 6000) => {
  const e = sim.entity(id)!;
  let t = 0;
  while (t < max && e.order) {
    sim.step();
    t++;
  }
  return t;
};

describe('avertisseurs lumineux des véhicules', () => {
  it('éteints par défaut ; le journal explique l’activation avec sa cause', () => {
    const sim = make();
    const id = sim.addVehicle({ vehicle: 'fourgon_police', callsign: 'V', crew: 3, pos: { x: -300, y: 0 } }, PLAN);
    expect(sim.entity(id)).toMatchObject({ emergency: false });
    sim.issueOrder({ kind: 'lights', ids: [id], on: true });
    expect(sim.entity(id)).toMatchObject({ emergency: true });
    const ev = sim.journal.byCode('vehicle.lights_on')[0]!;
    expect(ev.why.kind).toBe('player_order');
    sim.issueOrder({ kind: 'lights', ids: [id], on: false });
    expect(sim.journal.byCode('vehicle.lights_off')).toHaveLength(1);
  });

  it('avertisseurs actifs : plus rapide (limites de vitesse non respectées)', () => {
    const run = (on: boolean) => {
      const sim = make();
      const id = sim.addVehicle({ vehicle: 'fourgon_police', callsign: 'V', crew: 3, pos: { x: -300, y: 0 } }, PLAN);
      if (on) sim.issueOrder({ kind: 'lights', ids: [id], on: true });
      sim.issueOrder({ kind: 'move', ids: [id], target: { x: 300, y: 0 } });
      return arrive(sim, id);
    };
    const normal = run(false);
    const lights = run(true);
    expect(lights).toBeLessThan(normal * 0.8);
  });

  it('sens interdit : refusé sans avertisseurs, permis avec (circulation à contresens)', () => {
    const sim = make({ oneways: 1 }); // toutes les rues en sens unique a→b (vers l'est)
    const id = sim.addVehicle({ vehicle: 'voiture_police', callsign: 'V', crew: 2, pos: { x: 300, y: 0 } }, PLAN);
    const refused = sim.issueOrder({ kind: 'move', ids: [id], target: { x: -300, y: 0 } });
    expect(refused[0]!.ok).toBe(false);
    sim.issueOrder({ kind: 'lights', ids: [id], on: true });
    const ok = sim.issueOrder({ kind: 'move', ids: [id], target: { x: -300, y: 0 } });
    expect(ok[0]!.ok).toBe(true);
    arrive(sim, id);
    expect(Math.abs(sim.entity(id)!.x + 300)).toBeLessThan(5);
  });

  it('couper les avertisseurs en route recalcule l’itinéraire ; les unités à pied n’en ont pas', () => {
    const sim = make();
    const v = sim.addVehicle({ vehicle: 'voiture_police', callsign: 'V', crew: 2, pos: { x: -300, y: 0 } }, PLAN);
    const u = sim.addUnit({ force: 'police_nationale', callsign: 'U', num: '1', headcount: 8, pos: { x: -300, y: 0 } }, PLAN);
    sim.issueOrder({ kind: 'lights', ids: [v], on: true });
    sim.issueOrder({ kind: 'move', ids: [v], target: { x: 300, y: 0 } });
    sim.run(30);
    const r = sim.issueOrder({ kind: 'lights', ids: [v, u], on: false });
    expect(r.find((x) => x.id === u)!.ok).toBe(false);
    expect(sim.entity(v)!.order).not.toBeNull();
    expect(sim.entity(v)).toMatchObject({ emergency: false });
  });

  it('avertisseurs actifs : ralentit à l’approche d’une foule, pleine vitesse sinon', () => {
    const sim = make();
    sim.createGroup({ label: 'Foule', kind: 'static', size: 60, origin: { x: 100, y: 0 }, anchor: anchorAt({ x: 100, y: 0 }, 'foule', 12) }, PLAN); // petit groupe : la rue reste franchissable
    const id = sim.addVehicle({ vehicle: 'fourgon_police', callsign: 'V', crew: 3, pos: { x: -350, y: 0 } }, PLAN);
    sim.issueOrder({ kind: 'lights', ids: [id], on: true });
    sim.issueOrder({ kind: 'move', ids: [id], target: { x: 350, y: 0 } });
    const e = sim.entity(id)!;
    let vFree = 0;
    let vNear = Infinity;
    for (let t = 0; t < 4000 && e.order; t++) {
      sim.step();
      if (e.x < -100) vFree = Math.max(vFree, e.speedMps);
      if (e.x > 55 && e.x < 85) vNear = Math.min(vNear, e.speedMps);
    }
    expect(vFree).toBeGreaterThan(8);
    expect(vNear).toBeLessThan(vFree * 0.6);
  }, 60_000);
});
