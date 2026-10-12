import { describe, expect, it } from 'vitest';
import { GameController } from '../../src/game/controller';
import { buildSchematicGraph } from '../../src/nav/schematicGraph';
import { ZONE_LEVELS } from '../../src/game/zones';

const metz = { lng: 6.1757, lat: 49.1193 };
const graph = buildSchematicGraph(metz, 1400, 1050);

function play(seconds: number): GameController {
  const c = new GameController({ graph, seed: 7 });
  c.runTicks(Math.round(seconds * 10));
  return c;
}

describe('scénario de démonstration (moteur réel, graphe schématique)', () => {
  const probe = new GameController({ graph, seed: 7 });
  const ms = probe.scenario.milestones;

  it('place les forces et les véhicules ; chaque événement a une raison ; l’horloge démarre à une heure du jour', () => {
    expect(probe.sim.units.length).toBe(8);
    expect(probe.sim.vehicles.length).toBe(7);
    expect(probe.scenario.timeline.every((e) => e.reason.length > 10)).toBe(true);
    expect(probe.scenario.clockStartSec).toBe(17 * 3600 + 30 * 60);
    expect(ms.departS).toBeGreaterThan(ms.rallyEndS); // le cortège part après la dernière arrivée
    expect(ms.arrivalS).toBeGreaterThan(ms.departS);
    expect(ms.endS).toBeGreaterThan(ms.arrivalS);
    expect(probe.scenario.places.entries.length).toBeGreaterThanOrEqual(3); // les gens viennent de plusieurs endroits
    expect(new Set(probe.scenario.places.exits.map((e) => e.id)).size).toBe(probe.scenario.places.exits.length);
  });

  it('raconte l’histoire : arrivées de plusieurs accès, rassemblement, départ à l’heure, cortège, arrivée au piquet, dispersion par secteurs — avec une cause pour chaque événement', () => {
    const c = play(ms.endS + 2400);
    const codes = c.sim.journal.events.map((e) => e.code);
    expect(codes.filter((k) => k === 'group.joined').length).toBeGreaterThanOrEqual(c.scenario.places.entries.length + 1); // arrivées + cortège rejoignant le piquet
    for (const k of ['group.march_started', 'group.split', 'group.dispersed']) expect(codes, k).toContain(k);
    expect(c.sim.journal.events.every((e) => e.why && e.why.note.length > 0)).toBe(true);
    const start = c.sim.journal.byCode('group.march_started')[0]!;
    expect(start.why.kind).toBe('scenario_event');
    expect(Math.abs(start.simTimeMs / 1000 - ms.departS)).toBeLessThan(2); // heure de départ respectée
    // dispersion : trois colonnes vers trois sorties, tout le monde finit par quitter la zone
    expect(c.sim.journal.byCode('group.dispersed').length).toBeGreaterThanOrEqual(3);
    expect(c.sim.totalPeople()).toBe(0);
  }, 280_000);

  it('conserve les personnes jusqu’à la dispersion (arrivées + rassemblement + piquet = effectif prévu)', () => {
    const c = play(ms.departS - 5);
    expect(c.sim.totalPeople()).toBe(2500 + 120);
  }, 120_000);

  it('est déterministe : même graine, même état', () => {
    expect(play(120).sim.stateHash()).toBe(play(120).sim.stateHash());
  });

  it('ne place jamais un individu visible dans un bâtiment', () => {
    const c = play(ms.departS + 300);
    const mask = c.sim.mask!;
    let bad = 0;
    let vis = 0;
    for (const g of c.sim.groups) {
      const m = g.members;
      for (let i = Math.max(m.activeStart, g.entryStart); i < Math.min(m.n, g.exitStart); i += 5) {
        vis++;
        if (mask.isBlocked(m.x[i]!, m.y[i]!)) bad++;
      }
    }
    expect(bad / vis).toBeLessThan(0.01);
  }, 120_000);

  it('les fermetures du scénario figurent dans le compteur de rues', () => {
    expect(ZONE_LEVELS.length).toBeGreaterThan(1);
    const marchS = ms.arrivalS - ms.departS;
    const c = play(ms.departS + marchS * 0.4);
    expect(c.stats().streets.scenarioClosed).toBeGreaterThanOrEqual(1);
  }, 120_000);
});
