import type { Bounds, LngLat, ViewState } from '../geo/mercator';

export type MapStatus =
  | { state: 'loading' }
  | { state: 'ready' }
  /** La carte est affichée mais une partie des tuiles échoue (réseau instable, quota…). */
  | { state: 'degraded'; reason: string }
  | { state: 'failed'; reason: string };

/**
 * Contrat entre le jeu et le fond de carte. Le moteur de simulation et la couche de rendu
 * n'importent jamais MapLibre : ils ne connaissent que cette interface (caméra + événements).
 */
export interface MapAdapter {
  readonly kind: 'maplibre' | 'schematic';
  /** Résolue quand le fond est utilisable ; rejetée si le style / le service est indisponible. */
  readonly ready: Promise<void>;
  /** Caméra courante (sans rotation ni inclinaison dans cette version). */
  getView(): ViewState;
  jumpTo(center: LngLat, zoom?: number): void;
  flyTo(center: LngLat, zoom?: number): void;
  fitBounds(bounds: Bounds, paddingPx?: number): void;
  zoomBy(delta: number): void;
  resize(): void;
  onMove(cb: () => void): () => void;
  onStatus(cb: (s: MapStatus) => void): () => void;
  setTactical(on: boolean): void;
  /** Origine de la partie : le fond schématique régénère sa ville autour de ce point. */
  setScenarioOrigin(origin: LngLat): void;
  /** Diagnostic : projection native du fond (sert aux tests de calage). */
  debugProject?(p: LngLat): { x: number; y: number };
  destroy(): void;
}
