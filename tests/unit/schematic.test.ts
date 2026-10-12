import { describe, expect, it } from 'vitest';
import { makeSchematicCity, fromGrid, toGrid } from '../../src/geo/schematicCity';

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

});
