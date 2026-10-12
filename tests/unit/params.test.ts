import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SIM_PARAMS, withParams } from '../../src/engine/params';
import { PARAM_DOCS, docFor, flattenParams, paramsMarkdown, validateSimParams } from '../../src/engine/paramDocs';
import { ParamError, Sim } from '../../src/engine/sim';
import { gridGraph } from './navHelpers';

describe('paramètres de simulation : valeurs initiales validées par le commanditaire', () => {
  const p = DEFAULT_SIM_PARAMS;
  it('densité 2 pers/m², front 14 m, vitesses 1,1 et 1,2 m/s, rayons 400 m et 2,5 km, saturation 5,4, largeur libre véhicule 3,5 m', () => {
    expect(p.marchDensity).toBe(2);
    expect(p.staticDensity).toBe(2);
    expect(p.nav.referenceDensity).toBe(2);
    expect(p.marchFrontWidthMaxM).toBe(14);
    expect(p.speedByKind.march).toBe(1.1);
    expect(p.speedByKind.secondary).toBe(1.2);
    expect(p.lod.n2RadiusM).toBe(400);
    expect(p.lod.n1RadiusM).toBe(2500);
    expect(p.nav.jamDensity).toBe(5.4);
    expect(p.nav.vehicleMinFreeWidthM).toBe(3.5);
    expect(p.nav.maxDetourRatio).toBe(Infinity);
  });
  it('configurables : une surcharge change le comportement, sans modifier les valeurs par défaut', () => {
    const q = withParams({ marchDensity: 1.5, lod: { n2RadiusM: 100 } });
    expect(q.marchDensity).toBe(1.5);
    expect(q.lod.n2RadiusM).toBe(100);
    expect(q.lod.n1RadiusM).toBe(2500);
    expect(DEFAULT_SIM_PARAMS.marchDensity).toBe(2);
    expect(DEFAULT_SIM_PARAMS.lod.n2RadiusM).toBe(400);
  });
});

describe('documentation des paramètres', () => {
  it('chaque paramètre de SimParams est documenté (signification, unité, effet)', () => {
    const missing = flattenParams(DEFAULT_SIM_PARAMS).filter(([path]) => !docFor(path)).map(([path]) => path);
    expect(missing).toEqual([]);
    for (const d of PARAM_DOCS) {
      expect(d.unit.length, d.path).toBeGreaterThan(0);
      expect(d.meaning.length, d.path).toBeGreaterThan(10);
      expect(d.effect.length, d.path).toBeGreaterThan(5);
    }
  });
  it('chaque entrée de documentation correspond à un paramètre existant', () => {
    const leaves = flattenParams(DEFAULT_SIM_PARAMS).map(([path]) => path);
    for (const d of PARAM_DOCS) expect(leaves.some((l) => docFor(l) === d), d.path).toBe(true);
  });
  it('docs/PARAMETRES.md est à jour (régénérer avec « npm run docs:params »)', () => {
    const file = readFileSync(new URL('../../docs/PARAMETRES.md', import.meta.url), 'utf8');
    expect(file).toBe(paramsMarkdown());
  });
});

describe('cohérence des paramètres (densités ↔ blocage, rayons de niveaux)', () => {
  const ok = () => validateSimParams(DEFAULT_SIM_PARAMS);
  it('les valeurs par défaut sont cohérentes ; les avertissements sont non bloquants', () => {
    expect(ok().errors).toEqual([]);
    expect(ok().warnings.length).toBeGreaterThan(0);
  });
  it('une densité de marche ou de rassemblement ≥ saturation est refusée (la foule se bloquerait elle-même)', () => {
    expect(validateSimParams(withParams({ marchDensity: 5.4 })).errors.join(' ')).toContain('marchDensity');
    expect(validateSimParams(withParams({ staticDensity: 6 })).errors.join(' ')).toContain('staticDensity');
    // relever la saturation rend la même densité acceptable : les paramètres sont bien liés
    expect(validateSimParams(withParams({ marchDensity: 5.4, nav: { jamDensity: 7 } })).errors).toEqual([]);
  });
  it('les rayons de niveaux doivent s’emboîter (N1 ≥ N2)', () => {
    expect(validateSimParams(withParams({ lod: { n2RadiusM: 3000 } })).errors.join(' ')).toContain('n1RadiusM');
  });
  it('seuils de rues incohérents refusés', () => {
    expect(validateSimParams(withParams({ nav: { slowedDensity: 6 } })).errors.length).toBeGreaterThan(0);
    expect(validateSimParams(withParams({ nav: { footBlockMinDensity: 9 } })).errors.length).toBeGreaterThan(0);
    expect(validateSimParams(withParams({ marchFrontWidthMinM: 20 })).errors.length).toBeGreaterThan(0);
  });
  it('un écart de densité par rapport à la densité de référence produit un avertissement', () => {
    expect(validateSimParams(withParams({ marchDensity: 0.8 })).warnings.join(' ')).toContain('referenceDensity');
  });
  it('Sim refuse des paramètres incohérents et expose les avertissements', () => {
    const graph = gridGraph({ cols: 3, rows: 1 });
    expect(() => new Sim({ graph, seed: 1, mask: null, params: { marchDensity: 9 } })).toThrow(ParamError);
    const sim = new Sim({ graph, seed: 1, mask: null });
    expect(sim.paramWarnings.length).toBeGreaterThan(0);
  });
});
