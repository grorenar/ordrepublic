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
    st.load[0] = 1200; // 1,5 pers/m² : occupe 6 m sur 8, il reste 2 m (< 3,5 m pour un véhicule, > 0,6 m pour un piéton)
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
  const total = (st: ReturnType<typeof createEdgeState>) => st.load.reduce((a, b) => a + b, 0);

  it('cortège : la charge totale = effectif × part de la colonne située sur la route', () => {
    const route = ctx.findRoute({ x: -300, y: 0 }, { x: 300, y: 0 }, 'crowd')!;
    const fp: CrowdFootprint = { kind: 'march', route, centreS: 300, columnLength: 200, size: 4000, frontWidth: 10 };
    const st = createEdgeState(g);
    accumulateLoads(g, ctx.grid, [fp], st, P);
    expect(total(st)).toBeCloseTo(4000, 1); // colonne entièrement sur la route
    accumulateLoads(g, ctx.grid, [{ ...fp, centreS: 0 }], st, P); // la moitié de la colonne est avant le départ
    expect(total(st)).toBeCloseTo(2000, 1);
  });

  it('rassemblement statique : effectif réparti sur les rues de l’emprise, jamais davantage que l’effectif', () => {
    const st = createEdgeState(g);
    accumulateLoads(g, ctx.grid, [{ kind: 'static', center: { x: 0, y: 0 }, radius: 80, size: 5000, density: 2 }], st, P);
    expect(total(st)).toBeGreaterThan(4999);
    expect(total(st)).toBeLessThanOrEqual(5000.5);
    expect(st.load.filter((v) => v > 0).length).toBeGreaterThanOrEqual(4);
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
    expect(countStreetStates(g, st, { halfWidth: 1, halfHeight: 1 }).total).toBeLessThan(c.total);
  });
});

describe('blocage par section : géométrie, répartition et possibilité de circulation', () => {
  const run = (width: number, fp: (route: ReturnType<NavContext['findRoute']> & object) => CrowdFootprint, params = P) => {
    const g = gridGraph({ cols: 3, rows: 1, spacing: 200, width });
    const ctx = new NavContext(g, params, createEdgeState(g));
    const route = ctx.findRoute({ x: -200, y: 0 }, { x: 200, y: 0 }, 'crowd')!;
    const st = createEdgeState(g);
    accumulateLoads(g, ctx.grid, [fp(route)], st, params);
    deriveStates(g, st, params);
    return { st, g };
  };

  it('une foule courte bloque quand même le véhicule si sa section occupe la rue (pas de moyenne sur l’arête)', () => {
    // colonne de 30 m sur une arête de 200 m : occupation MOYENNE faible, mais la section est pleine (rue de 10 m, front de 14 m)
    const { st } = run(10, (route) => ({ kind: 'march', route, centreS: 100, columnLength: 30, size: 300, frontWidth: 14 }));
    expect(st.density[0]).toBeLessThan(1.5);
    expect(st.vehState[0]).toBe(3);
    expect(st.footState[0]).toBeLessThan(3); // un piéton traverse une foule clairsemée
  });

  it('la même foule sur une rue plus large laisse passer les véhicules (largeur libre ≥ 3,5 m)', () => {
    const { st } = run(20, (route) => ({ kind: 'march', route, centreS: 100, columnLength: 30, size: 600, frontWidth: 14 }));
    expect(st.vehState[0]).toBeLessThan(3);
    expect(st.occupiedWidth[0]).toBeCloseTo(14, 3);
    expect(st.vehState[0]).toBeGreaterThanOrEqual(2); // partiellement obstruée
  });

  it('largeur libre minimale configurable (3,5 m par défaut)', () => {
    const fp = (route: never) => ({ kind: 'march', route, centreS: 100, columnLength: 30, size: 600, frontWidth: 14 }) as CrowdFootprint;
    expect(run(17, fp as never).st.vehState[0]).toBe(3); // 17 − 14 = 3 m < 3,5 m
    expect(run(17, fp as never, { ...P, vehicleMinFreeWidthM: 2.5 }).st.vehState[0]).toBeLessThan(3);
  });

  it('une présence de quelques mètres seulement n’occupe pas de section (seuil de présence)', () => {
    const { st } = run(10, (route) => ({ kind: 'march', route, centreS: 1, columnLength: 2, size: 8, frontWidth: 14 }));
    expect(st.vehState[0]).toBe(0);
  });

  it('piéton : la saturation n’est pas le seul critère — largeur libre nulle ET densité élevée bloquent aussi', () => {
    // 1 800 personnes sur 30 m × 10 m = 6 pers/m² ≥ saturation
    const jam = run(10, (route) => ({ kind: 'march', route, centreS: 100, columnLength: 30, size: 1800, frontWidth: 10 }));
    expect(jam.st.footState[0]).toBe(3);
    // 750 personnes sur la même section : 2,5 pers/m² (< saturation), rue pleine (0 m libre) mais densité ≥ 1,5 → bloqué
    const dense = run(10, (route) => ({ kind: 'march', route, centreS: 100, columnLength: 30, size: 750, frontWidth: 10 }));
    expect(dense.st.density[0]).toBeLessThan(P.jamDensity);
    expect(dense.st.footState[0]).toBe(3);
    // densité faible malgré la rue occupée : jamais bloqué
    const sparse = run(10, (route) => ({ kind: 'march', route, centreS: 100, columnLength: 30, size: 150, frontWidth: 10 }));
    expect(sparse.st.density[0]).toBeLessThan(P.footBlockMinDensity);
    expect(sparse.st.footState[0]).toBeLessThan(3);
  });

  it('les seuils de saturation et de densité sont configurables', () => {
    const fp = (route: never) => ({ kind: 'march', route, centreS: 100, columnLength: 30, size: 750, frontWidth: 10 }) as CrowdFootprint;
    expect(run(10, fp as never, { ...P, footBlockMinDensity: 4 }).st.footState[0]).toBeLessThan(3);
    expect(run(10, fp as never, { ...P, jamDensity: 2 }).st.footState[0]).toBe(3);
  });
});
