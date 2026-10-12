import { Map as MLMap, setWorkerUrl, type StyleSpecification } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Bounds, LngLat, ViewState } from '../geo/mercator';
import { hybridOverlay } from './hybrid';
import { MAP_PROVIDERS, MIN_ZOOM, OPENFREEMAP_GLYPHS, OPENFREEMAP_STYLE_URL, STYLE_LOAD_TIMEOUT_MS, type MapProviderId } from '../config/mapConfig';
import type { MapAdapter, MapStatus } from './MapAdapter';

export interface MapLibreOptions {
  provider: MapProviderId;
  customStyleUrl?: string;
  center: LngLat;
  zoom: number;
  tactical: boolean;
}

// MapLibre 6 distribue son worker en module séparé : on le fait servir par Vite (pas de CDN).
setWorkerUrl(workerUrl);

/** Construit le style MapLibre pour un fournisseur ; exporté pour les tests. */
export function buildStyle(
  provider: MapProviderId,
  customStyleUrl: string | undefined,
  center: LngLat,
): string | StyleSpecification {
  const cfg = MAP_PROVIDERS[provider];
  if (provider === 'custom-style') {
    if (!customStyleUrl || !/^https?:\/\//.test(customStyleUrl)) throw new Error("URL de style personnalisé invalide.");
    return customStyleUrl;
  }
  if (provider === 'test-local') return buildTestStyle(center);
  if (provider === 'ign-hybrid') {
    return {
      version: 8,
      glyphs: OPENFREEMAP_GLYPHS,
      sources: { base: { type: 'raster', tiles: cfg.rasterTiles ?? [], tileSize: 256, maxzoom: cfg.maxZoom, attribution: cfg.attribution ?? '' } },
      layers: [{ id: 'base', type: 'raster', source: 'base' }],
    };
  }
  if (cfg.styleUrl) return cfg.styleUrl;
  return {
    version: 8,
    sources: {
      base: { type: 'raster', tiles: cfg.rasterTiles ?? [], tileSize: 256, maxzoom: cfg.maxZoom, attribution: cfg.attribution ?? '' },
    },
    layers: [{ id: 'base', type: 'raster', source: 'base' }],
  };
}

/** Style hors réseau : fond uni + quadrillage tous les 0,001° (≈ 70-110 m) autour du centre. */
export function buildTestStyle(center: LngLat): StyleSpecification {
  type Feat = { type: 'Feature'; properties: { major: boolean }; geometry: { type: 'LineString'; coordinates: number[][] } };
  const features: Feat[] = [];
  const step = 0.001;
  const n = 40;
  const lat0 = Math.round(center.lat / step) * step;
  const lng0 = Math.round(center.lng / step) * step;
  for (let i = -n; i <= n; i++) {
    features.push({
      type: 'Feature',
      properties: { major: i % 5 === 0 },
      geometry: { type: 'LineString', coordinates: [[lng0 - n * step, lat0 + i * step], [lng0 + n * step, lat0 + i * step]] },
    });
    features.push({
      type: 'Feature',
      properties: { major: i % 5 === 0 },
      geometry: { type: 'LineString', coordinates: [[lng0 + i * step, lat0 - n * step], [lng0 + i * step, lat0 + n * step]] },
    });
  }
  return {
    version: 8,
    sources: {
      grid: { type: 'geojson', data: { type: 'FeatureCollection', features }, attribution: 'Style local de test' },
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#2a3a30' } },
      {
        id: 'grid',
        type: 'line',
        source: 'grid',
        paint: { 'line-color': ['case', ['get', 'major'], '#8aa39a', '#4f6359'], 'line-width': ['case', ['get', 'major'], 3, 1.5] },
      },
    ],
  };
}

const DEGRADED: MapStatus = {
  state: 'degraded',
  reason: 'Les tuiles de la carte ne se chargent pas (réseau ou service indisponible).',
};

export class MapLibreAdapter implements MapAdapter {
  readonly kind = 'maplibre' as const;
  readonly ready: Promise<void>;
  private readonly map: MLMap;
  private statusCbs = new Set<(s: MapStatus) => void>();
  private moveCbs = new Set<() => void>();
  private tilesOk = 0;
  private tileErrors = 0;
  private degraded = false;
  private loaded = false;
  private styleLoaded = false;
  private ro: ResizeObserver;

  constructor(
    private readonly container: HTMLElement,
    opts: MapLibreOptions,
  ) {
    const style = buildStyle(opts.provider, opts.customStyleUrl, opts.center);
    this.map = new MLMap({
      container,
      style,
      center: [opts.center.lng, opts.center.lat],
      zoom: opts.zoom,
      minZoom: MIN_ZOOM,
      maxZoom: MAP_PROVIDERS[opts.provider].maxZoom,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      renderWorldCopies: false,
      attributionControl: { compact: false },
      fadeDuration: 0,
    });
    this.map.touchZoomRotate.disableRotation();
    this.map.keyboard.disableRotation();
    this.setTactical(opts.tactical);

    this.ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => fail('Délai dépassé : le service de carte ne répond pas.'), STYLE_LOAD_TIMEOUT_MS);
      const fail = (reason: string) => {
        clearTimeout(timer);
        this.emit({ state: 'failed', reason });
        reject(new Error(reason));
      };
      this.map.once('style.load', () => {
        this.styleLoaded = true;
      });
      if (opts.provider === 'ign-hybrid') void this.addLabels();
      this.map.once('load', () => {
        clearTimeout(timer);
        this.loaded = true;
        this.emit(this.degraded ? DEGRADED : { state: 'ready' });
        resolve();
      });
      this.map.on('error', (e: unknown) => {
        const ev = e as { error?: Error };
        if (!this.styleLoaded) {
          // erreur de style (JSON introuvable, invalide, refusé…) : la carte est inutilisable
          const host = typeof style === 'string' ? new URL(style, location.href).host : 'style local';
          fail(`Chargement de la carte impossible depuis ${host} (${String(ev.error?.message ?? 'erreur inconnue')}). Causes possibles : service indisponible, réseau, bloqueur de contenu.`);
          return;
        }
        this.tileErrors++;
        if (this.tilesOk === 0 && this.tileErrors >= 3 && !this.degraded) {
          this.degraded = true;
          this.emit(DEGRADED);
        }
      });
      this.map.on('data', (e: unknown) => {
        const ev = e as { dataType?: string; tile?: unknown };
        if (ev.dataType === 'source' && ev.tile) {
          this.tilesOk++;
          if (this.degraded) {
            this.degraded = false;
            this.emit({ state: 'ready' });
          }
        }
      });
    });
    this.ready.catch(() => undefined);

    this.map.on('move', () => this.moveCbs.forEach((cb) => cb()));
    this.ro = new ResizeObserver(() => this.map.resize());
    this.ro.observe(container);
  }

  /** Vue mixte : ajoute noms et contours depuis le style vectoriel ; sans réseau, la photo reste affichée seule (non bloquant). */
  private async addLabels(): Promise<void> {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 12_000);
      const res = await fetch(OPENFREEMAP_STYLE_URL, { signal: ctl.signal });
      clearTimeout(t);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const overlay = hybridOverlay((await res.json()) as StyleSpecification);
      const add = () => {
        for (const [id, src] of Object.entries(overlay.sources)) if (!this.map.getSource(id)) this.map.addSource(id, src);
        for (const l of overlay.layers) if (!this.map.getLayer(l.id)) this.map.addLayer(l);
      };
      if (this.map.isStyleLoaded()) add();
      else this.map.once('style.load', add);
    } catch (e) {
      console.warn('[Ordre Public] noms de rues indisponibles pour la vue mixte :', e);
    }
  }

  getView(): ViewState {
    const c = this.map.getCenter();
    const cv = this.map.getCanvas();
    return { lng: c.lng, lat: c.lat, zoom: this.map.getZoom(), width: cv.clientWidth, height: cv.clientHeight };
  }

  jumpTo(center: LngLat, zoom?: number): void {
    this.map.jumpTo({ center: [center.lng, center.lat], ...(zoom !== undefined ? { zoom } : {}) });
  }

  flyTo(center: LngLat, zoom?: number): void {
    this.map.flyTo({ center: [center.lng, center.lat], ...(zoom !== undefined ? { zoom } : {}), duration: 1100, essential: true });
  }

  fitBounds(b: Bounds, paddingPx = 40): void {
    this.map.fitBounds([[b.west, b.south], [b.east, b.north]], { padding: paddingPx, duration: 700 });
  }

  zoomBy(delta: number): void {
    this.map.easeTo({ zoom: this.map.getZoom() + delta, duration: 250 });
  }

  resize(): void {
    this.map.resize();
  }

  onMove(cb: () => void): () => void {
    this.moveCbs.add(cb);
    return () => this.moveCbs.delete(cb);
  }

  onStatus(cb: (s: MapStatus) => void): () => void {
    this.statusCbs.add(cb);
    return () => this.statusCbs.delete(cb);
  }

  setScenarioOrigin(): void {
    /* sans objet : la carte réelle n'est pas générée autour de l'origine */
  }

  setTactical(on: boolean): void {
    this.container.classList.toggle('tactical', on);
  }

  debugProject(p: LngLat): { x: number; y: number } {
    const r = this.map.project([p.lng, p.lat]);
    return { x: r.x, y: r.y };
  }

  destroy(): void {
    this.ro.disconnect();
    this.moveCbs.clear();
    this.statusCbs.clear();
    this.map.remove();
  }

  private emit(s: MapStatus): void {
    this.statusCbs.forEach((cb) => cb(s));
  }
}
