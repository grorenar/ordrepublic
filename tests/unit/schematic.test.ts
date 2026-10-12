import { describe, expect, it } from 'vitest';
import { makeSchematicCity, schematicSegments, fromGrid, toGrid } from '../../src/geo/schematicCity';
import { ZONE_LEVELS } from '../../src/demo/demoScenario';

const metz = { lng: 6.1757, lat: 49.1193 };

describe('ville schématique', () => {
  it('est déterministe par origine et différente selon la ville', () => {
    expect(makeSchematicCity(metz)).toEqual(makeSchematicCity(metz));
    expect(makeSchematicCity(metz)).not.toEqual(makeSchematicCity({ lng: 2.3522, lat: 48.8566 }));
  });

  it('aller-retour repère local ↔ trame', () => {
    const c = makeSchematicCity(metz);
    const p = fromGrid(c, toGrid(c, { x: 123, y: -45 }));
    expect(p.x).toBeCloseTo(123, 9);
    expect(p.y).toBeCloseTo(-45, 9);
  });

  it('les segments sont dans la zone, uniques, et plus nombreux quand la zone s’étend', () => {
    const c = makeSchematicCity(metz);
    let prev = 0;
    for (const z of ZONE_LEVELS) {
      const segs = schematicSegments(c, z);
      expect(new Set(segs.map((s) => s.id)).size).toBe(segs.length);
      for (const s of segs) for (const p of s.points) {
        expect(Math.abs(p.x)).toBeLessThanOrEqual(z.halfWidth + 1e-6);
        expect(Math.abs(p.y)).toBeLessThanOrEqual(z.halfHeight + 1e-6);
      }
      expect(segs.length).toBeGreaterThan(prev);
      prev = segs.length;
    }
  });
});
