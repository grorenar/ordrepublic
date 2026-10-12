import { describe, expect, it } from 'vitest';
import { Sim } from '../../src/engine/sim';
import { GameController } from '../../src/game/controller';
import { actualSize, blankScenario, compilePlan, emptyPlan, parsePlan, PlanError, PLAN_LEAD_S, type OperationPlan } from '../../src/scenarios/plan';
import { gridGraph } from './navHelpers';

const graph = () => gridGraph({ cols: 8, rows: 5, spacing: 100, width: 12 });
const base = (o: Partial<OperationPlan> = {}): OperationPlan => ({ ...emptyPlan(), name: 'Test', start: { x: -300, y: -200 }, end: { x: 300, y: 200 }, declaredSize: 400, uncertaintyPct: 30, departClockSec: 14 * 3600, ...o });
const run = (plan: OperationPlan, seconds: number, g = graph()) => {
  const sc = compilePlan(g, plan);
  const sim = new Sim({ graph: g, seed: 1, timeline: sc.timeline });
  sc.setup(sim);
  sim.run(seconds * 10);
  return { sc, sim };
};

describe('effectif réel autour de l’effectif déclaré', () => {
  it('reproductible, borné par l’incertitude, plus ou moins nombreux selon la graine', () => {
    const p = base({ declaredSize: 1000, uncertaintyPct: 30 });
    expect(actualSize({ ...p, seed: 5 })).toBe(actualSize({ ...p, seed: 5 }));
    const sizes = Array.from({ length: 400 }, (_, s) => actualSize({ ...p, seed: s }));
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(700);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(1300);
    expect(sizes.some((s) => s < 1000)).toBe(true);
    expect(sizes.some((s) => s > 1000)).toBe(true);
    const mean = sizes.reduce((a, b) => a + b, 0) / sizes.length;
    expect(Math.abs(mean - 1000)).toBeLessThan(40);
    expect(actualSize({ ...p, uncertaintyPct: 0, seed: 9 })).toBe(1000);
  });
});

describe('lecture d’un plan enregistré', () => {
  it('aller-retour JSON ; rejet des fichiers étrangers ; valeurs bornées', () => {
    const p = base({ waypoints: [{ x: 0, y: 0 }], closures: [{ x: 100, y: 0 }], units: [{ force: 'crs', pos: { x: 10, y: 10 }, headcount: 30 }] });
    expect(parsePlan(JSON.parse(JSON.stringify(p)))).toEqual(p);
    expect(() => parsePlan({ version: 2 })).toThrow(PlanError);
    expect(() => parsePlan(null)).toThrow(PlanError);
    expect(() => parsePlan({ version: 1, start: { x: 1, y: 2 } })).toThrow(/arrivée/);
    const q = parsePlan({ version: 1, start: { x: 0, y: 0 }, end: { x: 1, y: 1 }, declaredSize: 1e9, uncertaintyPct: 500, departClockSec: -5 });
    expect(q.declaredSize).toBe(200000);
    expect(q.uncertaintyPct).toBe(90);
    expect(q.departClockSec).toBe(0);
  });
});

describe('compilation du plan en scénario du moteur', () => {
  it('rassemblement à l’effectif réel, départ à l’heure dite, arrivée à destination, maintien puis dispersion', () => {
    const p = base();
    const sc = compilePlan(graph(), p);
    expect(sc.actualSize).toBe(actualSize(p));
    expect(sc.clockStartSec).toBe(p.departClockSec - PLAN_LEAD_S);
    const sim = new Sim({ graph: graph(), seed: 1, timeline: sc.timeline });
    sc.setup(sim);
    sim.run(50);
    const g = sim.groupByKey('rassemblement')!;
    expect(sim.size(g)).toBe(sc.actualSize);
    expect(sim.journal.byCode('group.march_started')).toHaveLength(0); // pas avant l'heure
    sim.run((PLAN_LEAD_S + 30) * 10);
    expect(sim.journal.byCode('group.march_started')).toHaveLength(1);
    sim.run((sc.milestones.arrivalS - PLAN_LEAD_S + 120) * 10);
    expect(g.phase).toBe('settled');
    sim.run((p.dwellMin * 60 + 1200) * 10);
    expect(sim.journal.byCode('group.dispersing').length + sim.journal.byCode('group.dispersed').length).toBeGreaterThan(0);
    for (const e of sc.timeline) if (e.kind !== 'spawn_group') expect(e.reason.length).toBeGreaterThan(10); // causes explicites
  }, 120_000);

  it('un axe fermé reçoit des barrières, le cortège le contourne ; fermer tous les axes utiles = erreur explicite', () => {
    const g = graph();
    const open = compilePlan(g, base());
    const closed = compilePlan(g, base({ closures: [{ x: 0, y: -200 }] }));
    expect(closed.closedEdges.length).toBe(1);
    expect(closed.routeLengthM).toBeGreaterThanOrEqual(open.routeLengthM);
    const { sim } = run(base({ closures: [{ x: 0, y: -200 }] }), 20);
    expect(sim.world.decor.filter((d) => d.kind === 'barrier').length).toBeGreaterThanOrEqual(2);
    expect(sim.journal.byCode('edge.closed')).toHaveLength(1);
    // couper entièrement la zone en deux : plus d'itinéraire
    const wall = Array.from({ length: 5 }, (_, r) => ({ x: 50, y: -200 + r * 100 }));
    expect(() => compilePlan(g, base({ closures: wall }))).toThrow(PlanError);
  });

  it('itinéraire forcé : le cortège passe par le point de passage imposé', () => {
    const wp = { x: -300, y: 200 }; // détour par le coin opposé
    const direct = compilePlan(graph(), base());
    const forced = compilePlan(graph(), base({ waypoints: [wp] }));
    expect(forced.routeLengthM).toBeGreaterThan(direct.routeLengthM);
    const g = graph();
    const sim = new Sim({ graph: g, seed: 1, timeline: forced.timeline });
    forced.setup(sim);
    sim.run(PLAN_LEAD_S * 10 + 5);
    const grp = sim.groupByKey('rassemblement')!;
    let best = Infinity;
    for (let t = 0; t < 12000 && grp.phase !== 'settled'; t++) {
      sim.step();
      const m = grp.members;
      const i = Math.min(m.n - 1, m.activeStart + Math.floor((m.n - m.activeStart) / 2));
      best = Math.min(best, Math.hypot((m.x[i] as number) - wp.x, (m.y[i] as number) - wp.y));
    }
    expect(best).toBeLessThan(60);
  }, 120_000);

  it('les unités du dispositif sont placées avec leur indicatif ; scénario vide : monde sans manifestants', () => {
    const { sim } = run(base({ units: [{ force: 'crs', pos: { x: 0, y: 0 }, headcount: 30 }, { force: 'police_nationale', pos: { x: 100, y: 0 }, headcount: 10 }] }), 5);
    expect(sim.units.map((u) => u.callsign)).toEqual(['CRS-PLAN 01', 'POL-PLAN 02']);
    const c = new GameController({ graph: graph(), scenario: blankScenario() });
    c.runTicks(100);
    expect(c.sim.groups.length).toBe(0);
    expect(c.sim.units.length).toBe(0);
    expect(c.sim.world.decor.length).toBeGreaterThan(0);
  });
});
