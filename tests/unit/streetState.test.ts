import { describe, expect, it } from 'vitest';
import { NavContext } from '../../src/nav/astar';
import { DEFAULT_NAV_PARAMS } from '../../src/nav/params';
import { accumulateLoads, countStreetStates, createEdgeState, deriveStates, segmentLengthInCircle, setScenarioBlock, type CrowdFootprint } from '../../src/nav/streetState';
import { gridGraph } from './navHelpers';
import type { StreetGraph } from '../../src/nav/graph';

const P = DEFAULT_NAV_PARAMS;

function singleStreet(width: number): StreetGraph {
  return gridGraph({ cols: 2, rows: 1, spacing: 100, width });
}

function stateWithLoad(g: StreetGraph, persons: number) {
  const st = createEdgeState(g);
  st.load[0] = persons;
  deriveStates(g, st, P);
  return st;
}

describe('états de rue géométriques (pas de seuil universel)', () => {
  it('rue vide : libre pour tous', () => {
    const g = singleStreet(8);
    const st = stateWithLoad(g, 0);
    expect([st.footState[0], st.vehState[0], st.speedFactor[0]]).toEqual([0, 0, 1]);
  });

  it('états intermédiaires croissants avec la foule : libre → ralenti → partiel → bloqué', () => {
    const g = singleStreet(8); // 100 m × 8 m = 800 m²
    const veh: number[] = [];
    const foot: number[] = [];
    for (const persons of [0, 300, 450, 700, 1000, 1600, 5000]) {
      const st = stateWithLoad(g, persons);
      veh.push(st.vehState[0] as number);
      foot.push(st.footState[0] as number);
    }
    // monotone non décroissant et présence d'états intermédiaires
    for (let i = 1; i < veh.length; i++) expect(veh[i]).toBeGreaterThanOrEqual(veh[i - 1] as number);
    expect(new Set(veh).size).toBeGreaterThanOrEqual(3);
    expect(veh[veh.length - 1]).toBe(3);
    expect(foot[0]).toBe(0);
    expect(foot).toContain(1);
    expect(foot).toContain(2);
    expect(foot[foot.length - 1]).toBe(3);
  });

  it('même effectif, résultat différent selon la largeur : pas de seuil universel', () => {
    const narrow = stateWithLoad(singleStreet(6), 600); // 600 personnes sur 600 m² : occupent 3 m, restent 3 m
    const wide = stateWithLoad(singleStreet(30), 600); // 600 personnes sur 3000 m² : occupent 3 m, restent 27 m
    expect(narrow.vehState[0]).toBe(3);
    expect(wide.vehState[0]).toBeLessThan(3);
    expect(wide.footState[0]).toBeLessThanOrEqual(1);
  });

  it('un véhicule passe tant que la largeur libre ≥ largeur du véhicule + marge', () => {
    const g = singleStreet(20);
    // largeur occupée = n / (L · ρ_réf) → n = 8 m × 100 m × 2 = 1600 → occupe 8 m, reste 12 m
    expect(stateWithLoad(g, 1600).vehState[0]).toBeLessThan(3);
    // occupe 17 m → reste 3 m < 3,5 m
    expect(stateWithLoad(g, 3400).vehState[0]).toBe(3);
    // un piéton passe encore (lentement) tant que la densité n'atteint pas la saturation
    expect(stateWithLoad(g, 3400).footState[0]).toBeLessThan(3);
  });

  it('relation densité-vitesse : plus la foule est dense, plus la vitesse chute (plancher respecté)', () => {
    const g = singleStreet(10);
    const f = [0, 500, 1500, 4000, 100000].map((n) => stateWithLoad(g, n).speedFactor[0] as number);
    for (let i = 1; i < f.length; i++) expect(f[i]).toBeLessThanOrEqual(f[i - 1] as number);
    expect(f[f.length - 1]).toBeCloseTo(P.minSpeedFactor, 6);
  });

  it('la version n’augmente que si un état change', () => {
    const g = singleStreet(8);
    const st = createEdgeState(g);
    expect(deriveStates(g, st, P)).toBe(false);
    st.load[0] = 1200;
    expect(deriveStates(g, st, P)).toBe(true);
    const v = st.version;
    expect(deriveStates(g, st, P)).toBe(false);
    expect(st.version).toBe(v);
    expect(setScenarioBlock(st, 0, true)).toBe(true);
    expect(setScenarioBlock(st, 0, true)).toBe(false);
  });

  it('le coût et la routabilité suivent l’état : foule dense → rue infranchissable aux véhicules, franchissable à pied', () => {
    const g = gridGraph({ cols: 3, rows: 1, spacing: 100, width: 8 });
    const st = createEdgeState(g);
    const ctx = new NavContext(g, P, st);
    const A = { x: -100, y: 0 };
    const B = { x: 100, y: 0 };
    expect(ctx.findRoute(A, B, 'vehicle')).not.toBeNull();
    st.load[0] = 1600; // première rue pleine largeur
    deriveStates(g, st, P);
    expect(ctx.findRoute(A, B, 'vehicle')).toBeNull();
    const walk = ctx.findRoute(A, B, 'crowd');
    expect(walk).not.toBeNull();
    // et plus lentement qu'à vide
    const free = new NavContext(g, P, createEdgeState(g)).findRoute(A, B, 'crowd')!;
    expect(walk!.cost).toBeGreaterThan(free.cost);
  });
});

describe('répartition de la charge par groupe', () => {
  const g = gridGraph({ cols: 7, rows: 7, spacing: 100, width: 10 });
  const ctx = new NavContext(g, P, createEdgeState(g));

  it('cortège : la charge totale = effectif × part de la colonne située sur la route', () => {
    const route = ctx.findRoute({ x: -300, y: 0 }, { x: 300, y: 0 }, 'crowd')!;
    const fp: CrowdFootprint = { kind: 'march', route, centreS: 300, columnLength: 200, size: 4000 };
    const load = new Float32Array(g.edgeCount);
    accumulateLoads(g, ctx.grid, [fp], load);
    const total = load.reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(4000, 1); // colonne entièrement sur la route
    const half: CrowdFootprint = { ...fp, centreS: 0 }; // la moitié de la colonne est avant le départ
    accumulateLoads(g, ctx.grid, [half], load);
    expect(load.reduce((a, b) => a + b, 0)).toBeCloseTo(2000, 1);
  });

  it('rassemblement statique : effectif réparti sur les rues de l’emprise, jamais davantage que l’effectif', () => {
    const load = new Float32Array(g.edgeCount);
    accumulateLoads(g, ctx.grid, [{ kind: 'static', center: { x: 0, y: 0 }, radius: 80, size: 5000 }], load);
    const total = load.reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(4999);
    expect(total).toBeLessThanOrEqual(5000.5);
    expect(load.filter((v) => v > 0).length).toBeGreaterThanOrEqual(4);
  });

  it('le calcul de longueur dans un cercle est exact', () => {
    expect(segmentLengthInCircle(-10, 0, 10, 0, 0, 0, 5)).toBeCloseTo(10, 6);
    expect(segmentLengthInCircle(-10, 20, 10, 20, 0, 0, 5)).toBe(0);
    expect(segmentLengthInCircle(0, 0, 3, 0, 0, 0, 5)).toBeCloseTo(3, 6);
  });

  it('compteur des rues par état (zone)', () => {
    const st = createEdgeState(g);
    st.load[0] = 5000;
    deriveStates(g, st, P);
    setScenarioBlock(st, 1, true);
    const c = countStreetStates(g, st, { halfWidth: 1000, halfHeight: 1000 });
    expect(c.total).toBe(g.edgeCount);
    expect(c.blocked).toBe(2);
    expect(c.scenarioClosed).toBe(1);
    const small = countStreetStates(g, st, { halfWidth: 1, halfHeight: 1 });
    expect(small.total).toBeLessThan(c.total);
  });
});
