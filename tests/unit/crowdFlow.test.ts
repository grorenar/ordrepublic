import { describe, expect, it } from 'vitest';
import { EdgeClass, type EdgeClassId, type Obstacle } from '../../src/nav/graph';
import { Sim } from '../../src/engine/sim';
import { NavContext } from '../../src/nav/astar';
import { DEFAULT_NAV_PARAMS } from '../../src/nav/params';
import { createEdgeState } from '../../src/nav/streetState';
import { anchorAt, PLAN } from './engineHelpers';
import { gridGraph } from './navHelpers';

/** Deux rangées d'immeubles de part et d'autre d'une rue horizontale : façades distantes de `facade` m. */
function streetWithFacades(facade: number, roadway: number, cls: EdgeClassId = EdgeClass.Residential) {
  const h = facade / 2;
  const strip = (y0: number, y1: number): Obstacle => ({ ring: new Float32Array([-300, y0, 300, y0, 300, y1, -300, y1]), source: 'synthetic' });
  return gridGraph({ cols: 6, rows: 1, spacing: 100, width: roadway, cls, obstacles: [strip(h, h + 30), strip(-h - 30, -h)] });
}
const march = (size: number, speed?: number) => ({ label: 'c', kind: 'march' as const, size, cohesion: 100, origin: { x: -250, y: 0 }, speedMps: speed, plan: { destination: anchorAt({ x: 250, y: 0 }), waypoints: [], onArrival: 'settle' as const, patienceMs: 0 } });

describe('un cortège occupe l’espace praticable de la rue (façade à façade)', () => {
  it('la largeur praticable est mesurée avec les bâtiments, pas déduite de la seule chaussée', () => {
    const sim = new Sim({ graph: streetWithFacades(14, 6), seed: 1 });
    for (let e = 0; e < sim.graph.edgeCount; e++) {
      expect(sim.state.walkWidth[e]).toBeGreaterThan(13);
      expect(sim.state.walkWidth[e]).toBeLessThan(15);
      expect(sim.graph.edgeWidth[e]).toBe(6); // la chaussée (véhicules) reste inchangée
    }
  });

  it('le front d’un grand cortège remplit la rue (largeur praticable − marges), et ses individus sont répartis sur toute cette largeur', () => {
    const sim = new Sim({ graph: streetWithFacades(14, 6), seed: 1 });
    const g = sim.group(sim.createGroup(march(3000), PLAN))!;
    sim.run(600);
    expect(g.frontWidth).toBeGreaterThan(11.5); // 14 − 2 × 0,8 = 12,4
    const m = g.members;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = m.activeStart; i < m.n; i++) {
      const y = m.y[i] as number;
      if (Math.abs(m.x[i] as number) < 150) {
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
    expect(maxY - minY).toBeGreaterThan(10.5); // la foule couvre l'essentiel de la largeur
    expect(maxY).toBeLessThan(7); // et jamais dans les immeubles
    expect(minY).toBeGreaterThan(-7);
  });

  it('dans une ruelle, la largeur mesurée est celle de la ruelle (le cortège ne déborde pas dans les bâtiments)', () => {
    const sim = new Sim({ graph: streetWithFacades(4, 3), seed: 1 });
    expect(sim.state.walkWidth[0]).toBeLessThan(5);
    const g = sim.group(sim.createGroup(march(500), PLAN))!;
    sim.run(300);
    expect(g.frontWidth).toBeLessThan(3);
  });
});

describe('la vitesse d’un cortège dépend du type de rue', () => {
  const speedOn = (cls: EdgeClassId) => {
    const sim = new Sim({ graph: gridGraph({ cols: 6, rows: 1, spacing: 100, width: 14, cls }), seed: 1, mask: null, params: { sidewalkAllowanceM: 0 } });
    const g = sim.group(sim.createGroup(march(300), PLAN))!;
    sim.run(250);
    return { v: g.speedMps, cause: g.speedCause };
  };
  it('boulevard > rue > voie de service > escaliers ; la cause est affichée', () => {
    const primary = speedOn(EdgeClass.Primary);
    const resid = speedOn(EdgeClass.Residential);
    const service = speedOn(EdgeClass.Service);
    const steps = speedOn(EdgeClass.Steps);
    expect(primary.v).toBeGreaterThan(resid.v);
    expect(resid.v).toBeGreaterThan(service.v);
    expect(service.v).toBeGreaterThan(steps.v);
    expect(steps.v).toBeCloseTo(1.1 * 0.5, 1);
    expect(steps.cause).toContain('escaliers');
    expect(primary.cause).toContain('plus rapide');
  });
  it('la vitesse change progressivement (pas de saut) quand le type de rue change', () => {
    const g0 = gridGraph({ cols: 6, rows: 1, spacing: 100, width: 14, cls: EdgeClass.Primary });
    const sim = new Sim({ graph: g0, seed: 1, mask: null, params: { sidewalkAllowanceM: 0, speedFactorByClass: { 0: 0.5 } } });
    const g = sim.group(sim.createGroup(march(300), PLAN))!;
    let prev = g.speedMps;
    let maxJump = 0;
    for (let i = 0; i < 300; i++) {
      sim.step();
      maxJump = Math.max(maxJump, Math.abs(g.speedMps - prev));
      prev = g.speedMps;
    }
    expect(maxJump).toBeLessThanOrEqual(2 * sim.params.crowdAccelMps2 * 0.1 + 1e-9);
  });
  it('un cortège évite les rues étroites (surcoût d’itinéraire), sans les interdire', () => {
    const g = gridGraph({ cols: 2, rows: 1, spacing: 100, width: 3 });
    const wide = gridGraph({ cols: 2, rows: 1, spacing: 100, width: 14 });
    const nav = (graph: typeof g) => new NavContext(graph, DEFAULT_NAV_PARAMS, createEdgeState(graph));
    const cNarrow = nav(g).edgeCost(0, 'crowd', 100, false);
    const cWide = nav(wide).edgeCost(0, 'crowd', 100, false);
    expect(cNarrow).toBeGreaterThan(cWide * 1.5);
    expect(Number.isFinite(cNarrow)).toBe(true);
  });
});

describe('un cortège bloqué se tasse en bloc contre l’obstacle (comme un piquet), sans se superposer ni trembler', () => {
  it('colonne tassée à la densité d’attente, tête immobile, individus dans la rue, mouvements bornés', () => {
    const graph = streetWithFacades(14, 6);
    const sim = new Sim({ graph, seed: 1 });
    const g = sim.group(sim.createGroup(march(3000), PLAN))!;
    sim.run(900);
    expect(g.phase).toBe('moving');
    const lenMoving = g.columnLength;
    // fermeture de la rue juste devant la tête : aucun itinéraire de remplacement
    const headS = g.sCentre + g.columnLength / 2;
    const route = g.route!;
    const idx = route.edgeStart.findIndex((s, i) => i > 0 && s > headS + 20);
    sim.closeStreet(route.edges[idx] as number, { kind: 'scenario_event', refId: 'x', note: 'fermeture de test' });
    sim.run(100);
    expect(g.phase).toBe('waiting');
    const headAtStop = g.sCentre + g.columnLength / 2;
    sim.run(1800); // 3 minutes
    expect(g.phase).toBe('waiting');
    const headNow = g.sCentre + g.columnLength / 2;
    expect(Math.abs(headNow - headAtStop)).toBeLessThan(1); // la tête reste contre l'obstacle
    const expected = 3000 / (sim.params.waitDensity * g.frontWidth);
    expect(g.columnLength).toBeCloseTo(expected, -1);
    expect(g.columnLength).toBeLessThan(lenMoving * 0.85); // nettement plus compacte qu'en marche
    // individus : dans la rue, mouvement bornés (pas de tremblement)
    const m = g.members;
    let maxStep = 0;
    let outside = 0;
    for (let k = 0; k < 20; k++) {
      sim.step();
      for (let i = m.activeStart; i < m.n; i += 5) {
        maxStep = Math.max(maxStep, Math.hypot((m.x[i] as number) - (m.px[i] as number), (m.y[i] as number) - (m.py[i] as number)));
        if (Math.abs(m.y[i] as number) > 7.05) outside++;
      }
    }
    expect(outside).toBe(0);
    expect(maxStep).toBeLessThan(0.25);
  }, 120_000);
});
