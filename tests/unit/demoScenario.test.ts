import { describe, expect, it } from 'vitest';
import { GameController } from '../../src/game/controller';
import { buildSchematicGraph } from '../../src/nav/schematicGraph';
import { ZONE_LEVELS } from '../../src/game/zones';

const metz = { lng: 6.1757, lat: 49.1193 };
const graph = buildSchematicGraph(metz, 1400, 1050);

function play(seconds: number): GameController {
  const c = new GameController({ graph, seed: 7 });
  c.runTicks(seconds * 10);
  return c;
}

describe('scénario de démonstration (moteur réel, graphe schématique)', () => {
  const probe = new GameController({ graph, seed: 7 });
  const eta = probe.scenario.etaS;

  it('place les forces et les véhicules du dispositif, sans cause manquante', () => {
    expect(probe.sim.units.length).toBe(8);
    expect(probe.sim.vehicles.length).toBe(7);
    expect(probe.scenario.timeline.every((e) => e.reason.length > 10)).toBe(true);
  });

  it('raconte l’histoire attendue dans le journal, dans l’ordre, avec une cause pour chaque événement', () => {
    const c = play(eta + 700);
    const codes = c.sim.journal.events.map((e) => e.code);
    for (const k of ['group.created', 'group.arriving', 'group.settled', 'group.dispersing', 'group.joined']) expect(codes, k).toContain(k);
    expect(c.sim.journal.events.every((e) => e.why && e.why.note.length > 0)).toBe(true);
    const created = c.sim.journal.events.find((e) => e.code === 'group.created' && e.text.includes('Cortège'));
    expect(created?.why.kind).toBe('scenario_event');
    // le cortège s'installe, se scinde (détachement) et se disperse
    expect(codes.some((k) => k.startsWith('group.split'))).toBe(true);
  }, 120_000);

  it('conserve les personnes (cortège + piquet = effectif créé, dispersions comprises)', () => {
    const c = play(eta * 0.5);
    expect(c.sim.totalPeople()).toBe(2500 + 120);
  }, 60_000);

  it('est déterministe : même graine, même état', () => {
    expect(play(120).sim.stateHash()).toBe(play(120).sim.stateHash());
  });

  it('ne place jamais un individu dans un bâtiment', () => {
    const c = play(eta);
    const mask = c.sim.mask!;
    let bad = 0;
    for (const g of c.sim.groups) {
      const m = g.members;
      for (let i = m.activeStart; i < m.n; i += 7) if (mask.isBlocked(m.x[i]!, m.y[i]!)) bad++;
    }
    expect(bad).toBe(0);
  }, 60_000);

  it('les fermetures du scénario figurent dans le compteur de rues', () => {
    expect(ZONE_LEVELS.length).toBeGreaterThan(1);
    const c = play(Math.round(eta * 0.4));
    expect(c.stats().streets.scenarioClosed).toBeGreaterThanOrEqual(1);
  }, 60_000);
});
