import { describe, expect, it } from 'vitest';
import { levelFor, distanceToFoci } from '../../src/engine/lod';
import { DEFAULT_SIM_PARAMS } from '../../src/engine/params';
import { locate, type Located } from '../../src/nav/route';
import { anchorAt, makeSim, PLAN } from './engineHelpers';
import type { CrowdGroup, GroupSpec } from '../../src/engine/types';

const lod = DEFAULT_SIM_PARAMS.lod;
const loc: Located = { x: 0, y: 0, tx: 0, ty: 0, seg: 0 };
const giant = (size: number): GroupSpec => ({
  label: 'Cortège géant',
  kind: 'march',
  size,
  origin: { x: -600, y: -300 },
  plan: { destination: anchorAt({ x: 300, y: 200 }, 'Place'), waypoints: [], onArrival: 'settle', patienceMs: 0 },
});

describe('niveaux de simulation : critères de sélection', () => {
  it('valeurs initiales : 400 m (N2) et 2,5 km (N1), mesurées au bord du foyer d’attention', () => {
    expect(lod.n2RadiusM).toBe(400);
    expect(lod.n1RadiusM).toBe(2500);
    expect(levelFor(-100, lod, null)).toBe(2); // à l'intérieur du foyer
    expect(levelFor(400, lod, null)).toBe(2);
    expect(levelFor(401, lod, null)).toBe(1);
    expect(levelFor(2500, lod, null)).toBe(1);
    expect(levelFor(2501, lod, null)).toBe(0);
  });

  it('la distance est celle du bord du foyer (rayon du foyer soustrait) et du foyer le plus proche', () => {
    expect(distanceToFoci(1000, 0, [{ x: 0, y: 0, radius: 600 }])).toBeCloseTo(400, 6);
    expect(distanceToFoci(1000, 0, [{ x: 0, y: 0, radius: 100 }, { x: 900, y: 0, radius: 50 }])).toBeCloseTo(50, 6);
  });

  it('hystérésis : on ne rétrograde qu’après avoir dépassé le seuil de 10 %, on monte immédiatement', () => {
    expect(levelFor(430, lod, 2)).toBe(2); // 430 ≤ 440
    expect(levelFor(445, lod, 2)).toBe(1);
    expect(levelFor(2600, lod, 1)).toBe(1); // 2600 ≤ 2750
    expect(levelFor(2800, lod, 1)).toBe(0);
    expect(levelFor(390, lod, 1)).toBe(2);
    expect(levelFor(1000, lod, 0)).toBe(1);
  });

  it('les seuils sont des paramètres : appliqués tels quels', () => {
    const custom = { ...lod, n2RadiusM: 50, n1RadiusM: 120, hysteresis: 0 };
    expect(levelFor(60, custom, null)).toBe(1);
    expect(levelFor(130, custom, null)).toBe(0);
  });
});

describe('niveaux par bloc dans un très gros cortège', () => {
  const params = { lod: { n2RadiusM: 150, n1RadiusM: 450, blockSize: 256, blockMinGroupSize: 4000 } };
  const headFocus = (g: CrowdGroup) => {
    locate(g.route!, Math.min(g.route!.length, g.sCentre + g.columnLength / 2), loc);
    return { x: loc.x, y: loc.y, radius: 40 };
  };

  it('découpe en blocs N2 / N1 / N0 selon la distance au foyer ; l’effectif ne change jamais', () => {
    const sim = makeSim({ params: { lod: { n2RadiusM: 80, n1RadiusM: 200, blockSize: 256, blockMinGroupSize: 4000 } } });
    const g = sim.group(sim.createGroup(giant(20000), PLAN))!;
    sim.run(300); // la colonne entre dans la zone
    sim.setFoci([headFocus(g)]);
    sim.step();
    expect(g.blocks).not.toBeNull();
    const counts = [0, 0, 0];
    for (const l of g.blocks!.level) counts[l]!++;
    expect(counts.every((c) => c > 0), `N0/N1/N2 = ${counts}`).toBe(true);
    expect(sim.totalPeople()).toBe(20000);
    expect(g.level).toBe(2); // le groupe garde le niveau le plus fin de ses blocs
  });

  it('les blocs en N2 évoluent exactement comme dans une simulation entièrement en N2 (le détail est préservé)', () => {
    const run = (focus: boolean) => {
      const sim = makeSim({ params });
      const g = sim.group(sim.createGroup(giant(8000), PLAN))!;
      sim.run(400);
      if (focus) sim.setFoci([headFocus(g)]);
      for (let t = 0; t < 200; t++) {
        if (focus) sim.setFoci([headFocus(g)]);
        sim.step();
      }
      return { sim, g };
    };
    const full = run(false);
    const mixed = run(true);
    const bl = mixed.g.blocks!;
    let compared = 0;
    for (let b = 0; b < bl.level.length; b++) {
      if (bl.level[b] !== 2) continue;
      for (let i = b * bl.size; i < Math.min((b + 1) * bl.size, mixed.g.members.n); i++) {
        // un bloc devenu N2 récemment démarre depuis ses cibles : on ne compare que ceux restés N2 depuis le début
        compared++;
        expect(Math.abs((mixed.g.members.x[i] as number) - (full.g.members.x[i] as number))).toBeLessThan(2);
      }
    }
    expect(compared).toBeGreaterThan(500);
    expect(mixed.g.sCentre).toBeCloseTo(full.g.sCentre, 6); // la logique collective est identique
  });

  it('aucune téléportation ni disparition quand le foyer parcourt la colonne (changements de niveau en cascade)', () => {
    const sim = makeSim({ params });
    const g = sim.group(sim.createGroup(giant(12000), PLAN))!;
    sim.run(300);
    let prevX = Float32Array.from(g.members.x);
    let prevY = Float32Array.from(g.members.y);
    let prevLevels = Uint8Array.from(g.blocks?.level ?? new Uint8Array(Math.ceil(12000 / 256)).fill(2));
    let maxStep = 0;
    let transitions = 0;
    for (let t = 0; t < 800; t++) {
      // le foyer glisse de la tête vers la queue
      locate(g.route!, Math.max(0, g.sCentre + g.columnLength / 2 - (t / 800) * g.columnLength), loc);
      sim.setFoci([{ x: loc.x, y: loc.y, radius: 40 }]);
      sim.step();
      const levels = g.blocks!.level;
      for (let b = 0; b < levels.length; b++) {
        if (levels[b] !== prevLevels[b]) transitions++;
        // un bloc suivi (N1/N2) au tick précédent ET au tick courant ne peut pas se téléporter
        if (levels[b]! >= 1 && prevLevels[b]! >= 1) {
          for (let i = b * 256; i < Math.min((b + 1) * 256, g.members.n); i++) maxStep = Math.max(maxStep, Math.hypot((g.members.x[i] as number) - (prevX[i] as number), (g.members.y[i] as number) - (prevY[i] as number)));
        }
      }
      expect(sim.totalPeople()).toBe(12000);
      prevX = Float32Array.from(g.members.x);
      prevY = Float32Array.from(g.members.y);
      prevLevels = Uint8Array.from(levels);
    }
    expect(transitions).toBeGreaterThan(10);
    expect(maxStep).toBeLessThan(0.75);
  });

  it('un bloc qui sort de N0 est réaligné sur ses cibles avant d’être suivi (jamais de position périmée)', () => {
    const sim = makeSim({ params });
    const g = sim.group(sim.createGroup(giant(10000), PLAN))!;
    sim.run(200);
    sim.setFoci([{ x: 5000, y: 5000, radius: 10 }]); // très loin : tout en N0
    sim.run(300);
    expect(g.blocks!.level.every((l) => l === 0)).toBe(true);
    sim.setFoci([headFocus(g)]);
    sim.step();
    // après un tick, les blocs N1/N2 suivent leurs cibles : écart faible
    let worst = 0;
    const bl = g.blocks!;
    for (let b = 0; b < bl.level.length; b++) {
      if (bl.level[b] === 0) continue;
      for (let i = b * bl.size; i < Math.min((b + 1) * bl.size, g.members.n); i += 7) worst = Math.max(worst, Math.hypot((g.members.x[i] as number) - (g.members.tx[i] as number), (g.members.y[i] as number) - (g.members.ty[i] as number)));
    }
    expect(worst).toBeLessThan(1.5);
  });

  it('un groupe épinglé (sélectionné) reste entièrement en N2, sans blocs', () => {
    const sim = makeSim({ params });
    const g = sim.group(sim.createGroup(giant(10000), PLAN))!;
    sim.run(100);
    sim.setFoci([headFocus(g)]);
    sim.step();
    expect(g.blocks).not.toBeNull();
    sim.setFoci([headFocus(g)], [g.id]);
    sim.run(2);
    expect(g.blocks).toBeNull();
    expect(g.level).toBe(2);
  });

  it('les petits groupes ne sont pas découpés (pas de complexité inutile) ; la logique collective est indépendante du mode', () => {
    const sim = makeSim({ params });
    const small = sim.group(sim.createGroup(giant(1500), PLAN))!;
    sim.setFoci([{ x: 0, y: 0, radius: 100 }]);
    sim.run(50);
    expect(small.blocks).toBeNull();
  });
});

describe('colonne entrant par une porte de la zone (entièrement derrière le départ de la route)', () => {
  it('les blocs éloignés du foyer, derrière le point d’entrée, ne sont pas traités comme proches', () => {
    const sim = makeSim({ params: { lod: { n2RadiusM: 150, n1RadiusM: 450, blockSize: 256, blockMinGroupSize: 4000 } } });
    const g = sim.group(sim.createGroup({ ...giant(50000), entry: 'gateway' }, PLAN))!;
    locate(g.route!, 0, loc);
    sim.setFoci([{ x: loc.x, y: loc.y, radius: 40 }]); // foyer au point d'entrée ; la colonne s'étend sur ~1,8 km derrière
    sim.run(30);
    const h = [0, 0, 0];
    for (const l of g.blocks!.level) h[l]!++;
    expect(g.columnLength).toBeGreaterThan(1500);
    expect(h[2]).toBeGreaterThan(0);
    expect(h[1]).toBeGreaterThan(0);
    expect(h[0]).toBeGreaterThan(0);
    // la tête de colonne (proche du foyer) est en N2, la queue (≈1,8 km) en N0
    expect(g.blocks!.level[g.blocks!.level.length - 1]).toBe(2);
    expect(g.blocks!.level[0]).toBe(0);
  });
});

