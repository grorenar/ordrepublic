import { describe, expect, it } from 'vitest';
import {
  LocalFrame,
  lngLatToWorld,
  metersPerPixel,
  project,
  unproject,
  worldToLngLat,
  zoomForBounds,
  type ViewState,
} from '../../src/geo/mercator';

const view: ViewState = { lng: 6.1757, lat: 49.1193, zoom: 16, width: 1000, height: 700 };

describe('projection Web Mercator', () => {
  it('projette le centre de la vue au centre du conteneur', () => {
    const p = project(view, view);
    expect(p.x).toBeCloseTo(500, 6);
    expect(p.y).toBeCloseTo(350, 6);
  });

  it('aller-retour monde ↔ lng/lat', () => {
    const ll = { lng: 4.8357, lat: 45.764 };
    const back = worldToLngLat(lngLatToWorld(ll, 14), 14);
    expect(back.lng).toBeCloseTo(ll.lng, 9);
    expect(back.lat).toBeCloseTo(ll.lat, 9);
  });

  it('aller-retour écran ↔ lng/lat', () => {
    const px = { x: 123.4, y: 567.8 };
    const p = project(view, unproject(view, px));
    expect(p.x).toBeCloseTo(px.x, 6);
    expect(p.y).toBeCloseTo(px.y, 6);
  });

  it('échelle : 78271,5 m/px au zoom 0 à l’équateur (tuiles de 512 px)', () => {
    expect(metersPerPixel(0, 0)).toBeCloseTo(78271.517, 2);
    expect(metersPerPixel(0, 1)).toBeCloseTo(78271.517 / 2, 2);
  });

  it('doubler le zoom double les distances en pixels', () => {
    const a = { lng: view.lng + 0.001, lat: view.lat };
    const d1 = project(view, a).x - 500;
    const d2 = project({ ...view, zoom: view.zoom + 1 }, a).x - 500;
    expect(d2 / d1).toBeCloseTo(2, 6);
  });

  it('zoomForBounds : la zone tient dans la fenêtre', () => {
    const b = { west: 6.17, south: 49.115, east: 6.18, north: 49.123 };
    const z = zoomForBounds(b, 800, 600, 40);
    const v: ViewState = { lng: 6.175, lat: 49.119, zoom: z, width: 800, height: 600 };
    const nw = project(v, { lng: b.west, lat: b.north });
    const se = project(v, { lng: b.east, lat: b.south });
    expect(nw.x).toBeGreaterThanOrEqual(39.9);
    expect(nw.y).toBeGreaterThanOrEqual(39.9);
    expect(se.x).toBeLessThanOrEqual(760.1);
    expect(se.y).toBeLessThanOrEqual(560.1);
  });
});

describe('repère local en mètres', () => {
  const frame = new LocalFrame({ lng: 2.3522, lat: 48.8566 });

  it('aller-retour mètres ↔ lng/lat', () => {
    const m = { x: 420, y: -310 };
    const back = frame.toMeters(frame.toLngLat(m));
    expect(back.x).toBeCloseTo(m.x, 6);
    expect(back.y).toBeCloseTo(m.y, 6);
  });

  it('1 000 m vers le nord ≈ 0,009° de latitude', () => {
    expect(frame.toLngLat({ x: 0, y: 1000 }).lat - 48.8566).toBeCloseTo(0.008983, 4);
  });

  it('la distance en pixels correspond à la distance en mètres / échelle', () => {
    const v: ViewState = { lng: 2.3522, lat: 48.8566, zoom: 17, width: 1000, height: 800 };
    const a = project(v, frame.toLngLat({ x: 0, y: 0 }));
    const b = project(v, frame.toLngLat({ x: 100, y: 0 }));
    expect((b.x - a.x) * metersPerPixel(48.8566, 17)).toBeCloseTo(100, 1);
  });
});
