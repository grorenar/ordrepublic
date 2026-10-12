import { buildSchematicGraph } from '../../src/nav/schematicGraph';
import { Sim, type SimOptions } from '../../src/engine/sim';
import type { Anchor, Cause } from '../../src/engine/types';
import type { Vec2 } from '../../src/geo/mercator';

export const METZ = { lng: 6.1757, lat: 49.1193 };
let cachedGraph: ReturnType<typeof buildSchematicGraph> | null = null;
export function cityGraph() {
  return (cachedGraph ??= buildSchematicGraph(METZ, 700, 520));
}

export const PLAN: Cause = { kind: 'scenario_plan', refId: 'test', note: 'mise en place du scénario de test' };

export function anchorAt(pos: Vec2, label = 'Lieu de test', radius = 20): Anchor {
  return { id: `A-${label}`, kind: 'place', pos, radius, label, source: 'synthetic' };
}

export function makeSim(o: Partial<SimOptions> = {}): Sim {
  return new Sim({ graph: cityGraph(), seed: 1, ...o });
}

/** Avance jusqu'à ce que `cond` soit vraie (ou `maxTicks`), retourne le nombre de ticks. */
export function runUntil(sim: Sim, cond: () => boolean, maxTicks: number): number {
  let n = 0;
  while (n < maxTicks && !cond()) {
    sim.step();
    n++;
  }
  return n;
}
