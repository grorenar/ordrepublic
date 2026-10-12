import { describe, expect, it } from 'vitest';
import { LocalFrame } from '../../src/geo/mercator';
import { segmentsFromFeatures, type RenderedFeatureLike } from '../../src/geo/streets';

const origin = { lng: 6.1757, lat: 49.1193 };
const frame = new LocalFrame(origin);
const zone = { halfWidth: 500, halfHeight: 400 };
const ll = (x: number, y: number): [number, number] => {
  const p = frame.toLngLat({ x, y });
  return [p.lng, p.lat];
};
const road = (coords: [number, number][], props: Record<string, unknown> = { class: 'secondary', name: 'Rue Test' }): RenderedFeatureLike => ({
  sourceLayer: 'transportation',
  properties: props,
  geometry: { type: 'LineString', coordinates: coords },
});

describe('segments de rues issus du fond de carte', () => {
  it('découpe une rue longue en tronçons ≤ ~140 m', () => {
    const segs = segmentsFromFeatures([road([ll(-300, 0), ll(-100, 0), ll(100, 0), ll(300, 0)])], frame, zone);
    expect(segs.length).toBeGreaterThanOrEqual(3);
    for (const s of segs) {
      const len = s.points.slice(1).reduce((n, p, i) => n + Math.hypot(p.x - s.points[i]!.x, p.y - s.points[i]!.y), 0);
      expect(len).toBeLessThanOrEqual(215);
    }
  });

  it('exclut les voies non carrossables, les autres couches et les tronçons hors zone', () => {
    const segs = segmentsFromFeatures(
      [
        road([ll(0, 0), ll(50, 0)], { class: 'path' }),
        { ...road([ll(0, 0), ll(50, 0)]), sourceLayer: 'building' },
        road([ll(900, 0), ll(950, 0)]),
        road([ll(0, 10), ll(60, 10)]),
      ],
      frame,
      zone,
    );
    expect(segs).toHaveLength(1);
    expect(segs[0]?.name).toBe('Rue Test');
  });

  it('dédoublonne une même rue rendue dans plusieurs tuiles', () => {
    const f = road([ll(0, 10), ll(60, 10)]);
    expect(segmentsFromFeatures([f, f], frame, zone)).toHaveLength(1);
  });

  it('accepte les MultiLineString', () => {
    const f: RenderedFeatureLike = {
      sourceLayer: 'transportation',
      properties: { class: 'tertiary' },
      geometry: { type: 'MultiLineString', coordinates: [[ll(0, 0), ll(40, 0)], [ll(0, 100), ll(40, 100)]] },
    };
    expect(segmentsFromFeatures([f], frame, zone)).toHaveLength(2);
  });
});
