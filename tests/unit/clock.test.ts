import { describe, expect, it } from 'vitest';
import { SimClock } from '../../src/engine/clock';
import { makeSim, anchorAt, PLAN } from './engineHelpers';

describe('horloge de simulation à pas fixe', () => {
  it('convertit le temps réel en ticks selon la vitesse', () => {
    for (const [speed, expected] of [[0.5, 5], [1, 10], [3, 30], [6, 60]] as const) {
      const c = new SimClock(100, { maxTicksPerAdvance: 1000, maxRealDeltaMs: 1000 });
      c.setSpeed(speed);
      let ticks = 0;
      for (let i = 0; i < 100; i++) ticks += c.advance(10); // 1 s réelle en 100 images
      expect(ticks).toBe(expected);
    }
  });

  it('indépendante de la fréquence d’affichage : même nombre de ticks à 30, 60 ou 144 images/s', () => {
    const run = (fps: number) => {
      const c = new SimClock(100);
      c.setSpeed(3);
      let ticks = 0;
      for (let i = 0; i < fps * 10; i++) ticks += c.advance(1000 / fps);
      return ticks;
    };
    for (const fps of [30, 60, 144]) expect(Math.abs(run(fps) - 300)).toBeLessThanOrEqual(1);
  });

  it('pause complète : aucun tick ; reprise sans rattrapage du temps passé en pause', () => {
    const c = new SimClock(100);
    c.setSpeed(0);
    expect(c.paused).toBe(true);
    let t = 0;
    for (let i = 0; i < 100; i++) t += c.advance(16);
    expect(t).toBe(0);
    c.setSpeed(1);
    expect(c.advance(16)).toBe(0); // pas de saut au retour
    expect(c.advance(250)).toBeLessThanOrEqual(2);
  });

  it('plafonne le rattrapage (onglet masqué, point d’arrêt) sans spirale', () => {
    const c = new SimClock(100, { maxTicksPerAdvance: 8, maxRealDeltaMs: 250 });
    c.setSpeed(6);
    expect(c.advance(60000)).toBeLessThanOrEqual(8);
    expect(c.droppedMs).toBeGreaterThan(0);
  });

  it('fournit la fraction de tick pour l’interpolation du rendu', () => {
    const c = new SimClock(100);
    c.advance(130); // 1 tick, reste 30 ms
    expect(c.alpha).toBeCloseTo(0.3, 5);
    c.setSpeed(0);
    expect(c.alpha).toBe(1);
  });
});

describe('pause et reprise du moteur sans transition incohérente', () => {
  it('N ticks avec pause intermédiaire = N ticks sans pause (même empreinte)', () => {
    const make = () => {
      const sim = makeSim({ seed: 11 });
      sim.createGroup({ label: 'c', kind: 'march', size: 400, origin: { x: -600, y: -300 }, entry: 'gateway', plan: { destination: anchorAt({ x: 300, y: 200 }), waypoints: [], onArrival: 'settle', patienceMs: 0 } }, PLAN);
      return sim;
    };
    const a = make();
    a.run(500);
    const b = make();
    const clock = new SimClock(100);
    clock.setSpeed(1);
    let done = 0;
    // 200 ticks, pause de 5 s « réelles », puis le reste
    while (done < 200) done += clock.advance(100);
    b.run(200);
    clock.setSpeed(0);
    for (let i = 0; i < 300; i++) expect(clock.advance(16)).toBe(0);
    clock.setSpeed(1);
    b.run(300);
    expect(b.stateHash()).toBe(a.stateHash());
  });
});
