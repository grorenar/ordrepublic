import { describe, expect, it } from 'vitest';
import { PRESET_CITIES } from '../../src/geo/cities';
import {
  ZONE_LEVELS,
  applyDemoEvent,
  blockedSegmentIds,
  computeStats,
  groupRadius,
  makeDemo,
  pruneBanners,
} from '../../src/demo/demoScenario';
import { makeSchematicCity, schematicSegments } from '../../src/geo/schematicCity';

const metz = PRESET_CITIES[0]!;

describe('données de démonstration', () => {
  it('quatre villes prédéfinies', () => {
    expect(PRESET_CITIES.map((c) => c.name)).toEqual(['Metz', 'Paris', 'Lyon', 'Marseille']);
  });

  it('sont déterministes et contiennent CRS, police, véhicules, groupes et incidents', () => {
    const a = makeDemo(metz, 0);
    expect(a).toEqual(makeDemo(metz, 0));
    expect(a.units.some((u) => u.kind === 'crs')).toBe(true);
    expect(a.units.some((u) => u.kind === 'police')).toBe(true);
    expect(new Set(a.vehicles.map((v) => v.kind))).toEqual(new Set(['van', 'police_car', 'water_cannon', 'ambulance', 'fire_truck']));
    expect(a.groups.length).toBeGreaterThan(2);
    expect(a.incidents.length).toBeGreaterThan(2);
    const ids = [...a.units, ...a.vehicles, ...a.groups, ...a.incidents].map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('tous les pions initiaux sont dans la plus petite zone de jeu', () => {
    const z = ZONE_LEVELS[0]!;
    const a = makeDemo(metz, 0);
    for (const e of [...a.units, ...a.vehicles, ...a.groups, ...a.incidents]) {
      expect(Math.abs(e.pos.x)).toBeLessThanOrEqual(z.halfWidth);
      expect(Math.abs(e.pos.y)).toBeLessThanOrEqual(z.halfHeight);
    }
  });

  it('un changement de ville ne conserve aucun pion de la précédente', () => {
    const a = makeDemo(PRESET_CITIES[0]!, 0);
    const b = makeDemo(PRESET_CITIES[1]!, 5);
    expect(b.cityId).toBe('paris');
    expect(b.log).toHaveLength(1);
    expect(b.log[0]?.text).toContain('Paris');
    expect(a.log[0]?.text).toContain('Metz');
  });

  it('les groupes d’essai supplémentaires sont ajoutés à la demande', () => {
    expect(makeDemo(metz, 0, { extraGroups: 12 }).groups).toHaveLength(makeDemo(metz, 0).groups.length + 12);
  });
});

describe('compteurs liés à l’état', () => {
  const city = makeSchematicCity(metz.center);
  const zone = ZONE_LEVELS[1]!;
  const segs = schematicSegments(city, zone);

  it('rues bloquées : uniquement sous un groupe d’au moins 60 personnes', () => {
    const s = makeDemo(metz, 0);
    const blocked = blockedSegmentIds(segs, s.groups);
    expect(blocked.size).toBeGreaterThan(0);
    expect(blocked.size).toBeLessThan(segs.length);
    const small = blockedSegmentIds(segs, s.groups.map((g) => ({ ...g, size: 10 })));
    expect(small.size).toBe(0);
  });

  it('un groupe plus grand bloque au moins autant de rues', () => {
    const s = makeDemo(metz, 0);
    const base = blockedSegmentIds(segs, s.groups).size;
    const big = blockedSegmentIds(segs, s.groups.map((g) => ({ ...g, size: g.size * 4 }))).size;
    expect(big).toBeGreaterThanOrEqual(base);
    expect(groupRadius({ ...s.groups[0]!, size: 400 })).toBeGreaterThan(groupRadius({ ...s.groups[0]!, size: 100 }));
  });

  it('les statistiques sont calculées depuis l’état (pas de valeur décorative)', () => {
    const s = makeDemo(metz, 0);
    const st = computeStats(s, segs, blockedSegmentIds(segs, s.groups));
    expect(st.headcountForces).toBe(s.units.reduce((n, u) => n + u.headcount, 0));
    expect(st.headcountCrowd).toBe(s.groups.reduce((n, g) => n + g.size, 0));
    expect(st.activeIncidents).toBe(s.incidents.length);
    expect(st.totalSegments).toBe(segs.length);
    expect(st.tension).toBeGreaterThan(0);
    expect(st.tension).toBeLessThanOrEqual(100);
  });

  it('un événement de démonstration ajoute un incident, une ligne de journal et un bandeau', () => {
    const s0 = makeDemo(metz, 0);
    const s1 = applyDemoEvent(s0, 1000, zone);
    expect(s1.incidents).toHaveLength(s0.incidents.length + 1);
    expect(s1.log.length).toBe(s0.log.length + 1);
    expect(s1.banners).toHaveLength(1);
    expect(computeStats(s1, segs, new Set()).activeIncidents).toBe(s0.incidents.length + 1);
    const added = s1.incidents[s1.incidents.length - 1]!;
    expect(Math.abs(added.pos.x)).toBeLessThanOrEqual(zone.halfWidth);
    expect(pruneBanners(s1, 1000 + 7000).banners).toHaveLength(0);
    expect(pruneBanners(s1, 2000).banners).toHaveLength(1);
  });

  it('les incidents ajoutés ont des identifiants uniques', () => {
    let s = makeDemo(metz, 0);
    for (let i = 0; i < 9; i++) s = applyDemoEvent(s, i * 10, zone);
    const ids = s.incidents.map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
