/**
 * Projection Web Mercator partagée par la couche de rendu du jeu et par le fond schématique.
 * Convention identique à MapLibre GL (tuiles de 512 px) : le rendu du jeu peut donc se caler
 * sur la caméra de MapLibre sans appeler son API de projection pour chaque pion.
 * Le moteur de simulation, lui, travaille en mètres locaux (voir `LocalFrame`).
 */
export interface LngLat {
  lng: number;
  lat: number;
}

export interface Vec2 {
  x: number;
  y: number;
}

export interface ViewState extends LngLat {
  zoom: number;
  /** Taille CSS du conteneur en pixels. */
  width: number;
  height: number;
}

export const TILE_SIZE = 512;
export const EARTH_CIRCUMFERENCE = 40_075_016.686;
const EARTH_RADIUS = 6_378_137;
const MAX_LAT = 85.0511287798;

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

export function worldSize(zoom: number): number {
  return TILE_SIZE * 2 ** zoom;
}

/** Coordonnées « monde » en pixels (origine en haut à gauche de la carte du monde). */
export function lngLatToWorld(p: LngLat, zoom: number): Vec2 {
  const size = worldSize(zoom);
  const lat = Math.max(-MAX_LAT, Math.min(MAX_LAT, p.lat));
  const x = ((p.lng + 180) / 360) * size;
  const y = (0.5 - Math.log(Math.tan(Math.PI / 4 + rad(lat) / 2)) / (2 * Math.PI)) * size;
  return { x, y };
}

export function worldToLngLat(w: Vec2, zoom: number): LngLat {
  const size = worldSize(zoom);
  const lng = (w.x / size) * 360 - 180;
  const lat = deg(2 * Math.atan(Math.exp((0.5 - w.y / size) * 2 * Math.PI)) - Math.PI / 2);
  return { lng, lat };
}

/** Position en pixels (dans le conteneur) d'un point géographique. */
export function project(view: ViewState, p: LngLat): Vec2 {
  const c = lngLatToWorld(view, view.zoom);
  const w = lngLatToWorld(p, view.zoom);
  return { x: w.x - c.x + view.width / 2, y: w.y - c.y + view.height / 2 };
}

export function unproject(view: ViewState, px: Vec2): LngLat {
  const c = lngLatToWorld(view, view.zoom);
  return worldToLngLat({ x: px.x - view.width / 2 + c.x, y: px.y - view.height / 2 + c.y }, view.zoom);
}

/** Mètres représentés par un pixel CSS à une latitude et un zoom donnés. */
export function metersPerPixel(lat: number, zoom: number): number {
  return (EARTH_CIRCUMFERENCE * Math.cos(rad(lat))) / worldSize(zoom);
}

export function pixelsPerMeter(lat: number, zoom: number): number {
  return 1 / metersPerPixel(lat, zoom);
}

/**
 * Repère local en mètres (x = est, y = nord) centré sur l'origine d'un scénario.
 * Approximation sphérique : largement suffisante sur quelques kilomètres.
 */
export class LocalFrame {
  private readonly cosLat: number;
  constructor(readonly origin: LngLat) {
    this.cosLat = Math.cos(rad(origin.lat));
  }
  toLngLat(v: Vec2): LngLat {
    return {
      lat: this.origin.lat + deg(v.y / EARTH_RADIUS),
      lng: this.origin.lng + deg(v.x / (EARTH_RADIUS * this.cosLat)),
    };
  }
  toMeters(p: LngLat): Vec2 {
    return {
      x: rad(p.lng - this.origin.lng) * EARTH_RADIUS * this.cosLat,
      y: rad(p.lat - this.origin.lat) * EARTH_RADIUS,
    };
  }
}

export interface Bounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

/** Zoom fractionnaire permettant de faire tenir `bounds` dans une fenêtre. */
export function zoomForBounds(bounds: Bounds, width: number, height: number, padding = 0): number {
  const availW = Math.max(1, width - 2 * padding);
  const availH = Math.max(1, height - 2 * padding);
  const nw = lngLatToWorld({ lng: bounds.west, lat: bounds.north }, 0);
  const se = lngLatToWorld({ lng: bounds.east, lat: bounds.south }, 0);
  const spanX = Math.max(1e-9, se.x - nw.x);
  const spanY = Math.max(1e-9, se.y - nw.y);
  return Math.log2(Math.min(availW / spanX, availH / spanY));
}
