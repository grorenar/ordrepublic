import {
  LocalFrame,
  lngLatToWorld,
  metersPerPixel,
  project,
  unproject,
  worldToLngLat,
  zoomForBounds,
  type Bounds,
  type LngLat,
  type Vec2,
  type ViewState,
} from '../geo/mercator';
import type { MapAdapter, MapStatus } from './MapAdapter';
import {
  MAJOR_WIDTH,
  MINOR_WIDTH,
  RIVER_WIDTH,
  blockKind,
  blockRect,
  buildingQuads,
  fromGrid,
  makeSchematicCity,
  riverCenterY,
  streetWidth,
  toGrid,
  type SchematicCity,
} from '../geo/schematicCity';

const MIN_Z = 12;
const MAX_Z = 19.5;

/**
 * Fond schématique autonome : aucune requête réseau, aucune donnée cartographique réelle.
 * Il gère lui-même le déplacement (glisser), le zoom (molette, double-clic, pincement) et
 * expose la même caméra Web Mercator que MapLibre.
 */
export class SchematicAdapter implements MapAdapter {
  readonly kind = 'schematic' as const;
  readonly ready = Promise.resolve();

  private readonly canvas = document.createElement('canvas');
  private readonly note = document.createElement('div');
  private readonly ctx: CanvasRenderingContext2D;
  private view: ViewState;
  private city: SchematicCity;
  private origin: LngLat;
  private moveCbs = new Set<() => void>();
  private statusCbs = new Set<(s: MapStatus) => void>();
  private dirty = true;
  private raf = 0;
  private anim = 0;
  private pointers = new Map<number, Vec2>();
  private lastPinch = 0;
  private readonly cleanups: Array<() => void> = [];

  constructor(
    private readonly container: HTMLElement,
    center: LngLat,
    zoom: number,
  ) {
    this.origin = center;
    this.city = makeSchematicCity(center);
    this.view = { ...center, zoom: clampZoom(zoom), width: 1, height: 1 };
    this.canvas.className = 'schematic-canvas';
    this.canvas.setAttribute('aria-label', 'Fond de carte schématique généré localement');
    this.note.className = 'schematic-note';
    this.note.textContent = 'Fond schématique généré localement — aucune donnée cartographique réelle';
    container.append(this.canvas, this.note);
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D indisponible');
    this.ctx = ctx;
    this.bindEvents();
    this.resize();
    queueMicrotask(() => this.emitStatus({ state: 'ready' }));
    const loop = () => {
      if (this.dirty) {
        this.dirty = false;
        this.draw();
      }
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  getView(): ViewState {
    return this.view;
  }

  setScenarioOrigin(origin: LngLat): void {
    this.origin = origin;
    this.city = makeSchematicCity(origin);
    this.dirty = true;
  }

  debugProject(p: LngLat): Vec2 {
    return project(this.view, p);
  }

  setTactical(): void {
    /* le fond schématique est déjà sombre */
  }

  jumpTo(center: LngLat, zoom?: number): void {
    cancelAnimationFrame(this.anim);
    this.setView({ ...center, zoom: zoom ?? this.view.zoom });
  }

  flyTo(center: LngLat, zoom?: number): void {
    cancelAnimationFrame(this.anim);
    const from = { ...this.view };
    const toZoom = clampZoom(zoom ?? this.view.zoom);
    const dur = 700;
    const t0 = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / dur);
      const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
      this.setView({
        lng: from.lng + (center.lng - from.lng) * e,
        lat: from.lat + (center.lat - from.lat) * e,
        zoom: from.zoom + (toZoom - from.zoom) * e,
      });
      if (t < 1) this.anim = requestAnimationFrame(step);
    };
    this.anim = requestAnimationFrame(step);
  }

  fitBounds(b: Bounds, paddingPx = 40): void {
    const z = zoomForBounds(b, this.view.width, this.view.height, paddingPx);
    this.flyTo({ lng: (b.west + b.east) / 2, lat: (b.south + b.north) / 2 }, z);
  }

  zoomBy(delta: number): void {
    this.flyTo(this.view, this.view.zoom + delta);
  }

  resize(): void {
    const r = this.container.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width));
    const h = Math.max(1, Math.round(r.height));
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.view = { ...this.view, width: w, height: h };
    this.dirty = true;
    this.moveCbs.forEach((cb) => cb());
  }

  onMove(cb: () => void): () => void {
    this.moveCbs.add(cb);
    return () => this.moveCbs.delete(cb);
  }

  onStatus(cb: (s: MapStatus) => void): () => void {
    this.statusCbs.add(cb);
    return () => this.statusCbs.delete(cb);
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    cancelAnimationFrame(this.anim);
    this.cleanups.forEach((fn) => fn());
    this.canvas.remove();
    this.note.remove();
    this.moveCbs.clear();
    this.statusCbs.clear();
  }

  // ---------------------------------------------------------------- interactions

  private setView(v: { lng: number; lat: number; zoom: number }): void {
    this.view = { ...this.view, lng: v.lng, lat: Math.max(-80, Math.min(80, v.lat)), zoom: clampZoom(v.zoom) };
    this.dirty = true;
    this.moveCbs.forEach((cb) => cb());
  }

  private emitStatus(s: MapStatus): void {
    this.statusCbs.forEach((cb) => cb(s));
  }

  private local(e: { clientX: number; clientY: number }): Vec2 {
    const r = this.container.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private panBy(dx: number, dy: number): void {
    const c = lngLatToWorld(this.view, this.view.zoom);
    const ll = worldToLngLat({ x: c.x - dx, y: c.y - dy }, this.view.zoom);
    this.setView({ ...ll, zoom: this.view.zoom });
  }

  private zoomAround(px: Vec2, newZoom: number): void {
    const z = clampZoom(newZoom);
    const anchor = unproject(this.view, px);
    const probe: ViewState = { ...this.view, zoom: z };
    const a = project(probe, anchor);
    const c = lngLatToWorld(probe, z);
    const ll = worldToLngLat({ x: c.x + (a.x - px.x), y: c.y + (a.y - px.y) }, z);
    this.setView({ ...ll, zoom: z });
  }

  private bindEvents(): void {
    const on = <K extends keyof HTMLElementEventMap>(
      type: K,
      fn: (e: HTMLElementEventMap[K]) => void,
      opts?: AddEventListenerOptions,
    ) => {
      this.container.addEventListener(type, fn as EventListener, opts);
      this.cleanups.push(() => this.container.removeEventListener(type, fn as EventListener));
    };
    on('pointerdown', (e) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      cancelAnimationFrame(this.anim);
      this.pointers.set(e.pointerId, this.local(e));
      this.container.setPointerCapture?.(e.pointerId);
      this.canvas.classList.add('grabbing');
      this.lastPinch = this.pinchDistance();
    });
    on('pointermove', (e) => {
      const prev = this.pointers.get(e.pointerId);
      if (!prev) return;
      const cur = this.local(e);
      this.pointers.set(e.pointerId, cur);
      if (this.pointers.size === 1) {
        this.panBy(cur.x - prev.x, cur.y - prev.y);
      } else if (this.pointers.size === 2) {
        const d = this.pinchDistance();
        if (this.lastPinch > 0 && d > 0) {
          const [a, b] = [...this.pointers.values()] as [Vec2, Vec2];
          this.zoomAround({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, this.view.zoom + Math.log2(d / this.lastPinch));
        }
        this.lastPinch = d;
      }
    });
    const end = (e: PointerEvent) => {
      this.pointers.delete(e.pointerId);
      this.lastPinch = this.pinchDistance();
      if (this.pointers.size === 0) this.canvas.classList.remove('grabbing');
    };
    on('pointerup', end);
    on('pointercancel', end);
    on(
      'wheel',
      (e) => {
        e.preventDefault();
        const dz = -e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0022);
        this.zoomAround(this.local(e), this.view.zoom + dz);
      },
      { passive: false },
    );
    on('dblclick', (e) => this.zoomAround(this.local(e), this.view.zoom + 1));
    const ro = new ResizeObserver(() => this.resize());
    ro.observe(this.container);
    this.cleanups.push(() => ro.disconnect());
  }

  private pinchDistance(): number {
    if (this.pointers.size !== 2) return 0;
    const [a, b] = [...this.pointers.values()] as [Vec2, Vec2];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  // ---------------------------------------------------------------- dessin

  private draw(): void {
    const { ctx, view, city } = this;
    const dpr = this.canvas.width / view.width;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#26302b';
    ctx.fillRect(0, 0, view.width, view.height);

    const frame = new LocalFrame(this.origin);
    // Projection affine de la trame vers l'écran, calibrée sur le centre de la vue (écart < 0,1 px :
    // l'échelle Mercator varie de moins de 0,01 % sur l'écran). Évite des milliers d'appels trigonométriques.
    const exact = (g: Vec2): Vec2 => project(view, frame.toLngLat(fromGrid(city, g)));
    const g0 = toGrid(city, frame.toMeters(view));
    const D = 400;
    const p0 = exact(g0);
    const pu = exact({ x: g0.x + D, y: g0.y });
    const pv = exact({ x: g0.x, y: g0.y + D });
    const axx = (pu.x - p0.x) / D;
    const axy = (pu.y - p0.y) / D;
    const ayx = (pv.x - p0.x) / D;
    const ayy = (pv.y - p0.y) / D;
    const toPx = (g: Vec2): Vec2 => ({
      x: p0.x + (g.x - g0.x) * axx + (g.y - g0.y) * ayx,
      y: p0.y + (g.x - g0.x) * axy + (g.y - g0.y) * ayy,
    });
    const ppm = 1 / metersPerPixel(view.lat, view.zoom);

    // Emprise visible en coordonnées de trame.
    const localCorners = [
      { x: 0, y: 0 },
      { x: view.width, y: 0 },
      { x: 0, y: view.height },
      { x: view.width, y: view.height },
    ].map((c) => frame.toMeters(unproject(view, c)));
    const corners = localCorners.map((c) => toGrid(city, c));
    const minX = Math.min(...localCorners.map((c) => c.x));
    const maxX = Math.max(...localCorners.map((c) => c.x));
    const minU = Math.min(...corners.map((c) => c.x));
    const maxU = Math.max(...corners.map((c) => c.x));
    const minV = Math.min(...corners.map((c) => c.y));
    const maxV = Math.max(...corners.map((c) => c.y));
    const k0 = Math.floor(minU / city.bx) - 1;
    const k1 = Math.ceil(maxU / city.bx) + 1;
    const l0 = Math.floor(minV / city.by) - 1;
    const l1 = Math.ceil(maxV / city.by) + 1;

    const showBlocks = view.zoom >= 14.2;
    const showBuildings = view.zoom >= 15.4;
    const showShops = view.zoom >= 16.6;

    if (showBlocks) {
      for (let k = k0; k < k1; k++) {
        for (let l = l0; l < l1; l++) {
          const { u0, v0, u1, v1 } = blockRect(city, k, l);
          const kind = blockKind(city, k, l);
          this.fillQuad(toPx, u0, v0, u1, v1, kind === 'park' ? '#2e5a38' : kind === 'plaza' ? '#4b4f52' : '#3a443d');
          if (kind !== 'built' || !showBuildings) continue;
          for (const q of buildingQuads(city, k, l)) {
            const g = Math.round(88 + q.h * 60);
            this.fillQuad(toPx, q.u0 + 1.5, q.v0 - 1.5, q.u1 + 1.5, q.v1 - 1.5, 'rgba(0,0,0,0.28)');
            this.fillQuad(toPx, q.u0, q.v0, q.u1, q.v1, `rgb(${g},${g - 4},${g - 10})`);
            if (showShops && q.h > 0.74) {
              const p = toPx({ x: (q.u0 + q.u1) / 2, y: q.v0 });
              ctx.fillStyle = q.h > 0.88 ? '#f5b942' : '#7dd3fc';
              ctx.beginPath();
              ctx.arc(p.x, p.y, Math.max(1.6, ppm * 1.8), 0, Math.PI * 2);
              ctx.fill();
            }
          }
        }
      }
    }

    // Fleuve (sous les rues pour que les ponts restent visibles).
    {
      const pts: Vec2[] = [];
      const step = 60;
      const xs0 = Math.floor((minX - 400) / step) * step;
      for (let x = xs0; x <= maxX + 400; x += step) {
        pts.push(toPxLocal(frame, view, x, riverCenterY(city, x)));
      }
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.strokeStyle = '#1d3a55';
      ctx.lineWidth = Math.max(2, RIVER_WIDTH * ppm);
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.stroke();
    }

    // Rues.
    const drawStreets = (majorOnly: boolean) => {
      for (let pass = 0; pass < 2; pass++) {
        for (let k = k0; k <= k1; k++) {
          const major = k % city.majorEvery === 0;
          if (majorOnly && !major) continue;
          this.strokeLine(toPx, k * city.bx, minV - city.by, k * city.bx, maxV + city.by, major, pass, ppm);
        }
        for (let l = l0; l <= l1; l++) {
          const major = l % city.majorEvery === 0;
          if (majorOnly && !major) continue;
          this.strokeLine(toPx, minU - city.bx, l * city.by, maxU + city.bx, l * city.by, major, pass, ppm);
        }
      }
    };
    drawStreets(!showBlocks);
  }

  private fillQuad(toPx: (g: Vec2) => Vec2, u0: number, v0: number, u1: number, v1: number, color: string): void {
    const { ctx } = this;
    const a = toPx({ x: u0, y: v0 });
    const b = toPx({ x: u1, y: v0 });
    const c = toPx({ x: u1, y: v1 });
    const d = toPx({ x: u0, y: v1 });
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.lineTo(c.x, c.y);
    ctx.lineTo(d.x, d.y);
    ctx.closePath();
    ctx.fill();
  }

  private strokeLine(
    toPx: (g: Vec2) => Vec2,
    u0: number,
    v0: number,
    u1: number,
    v1: number,
    major: boolean,
    pass: number,
    ppm: number,
  ): void {
    const { ctx } = this;
    const a = toPx({ x: u0, y: v0 });
    const b = toPx({ x: u1, y: v1 });
    const w = (major ? MAJOR_WIDTH : MINOR_WIDTH) * ppm;
    ctx.lineCap = 'butt';
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    if (pass === 0) {
      ctx.strokeStyle = '#15181b';
      ctx.lineWidth = w + Math.min(3, ppm * 1.2) + 1;
      ctx.setLineDash([]);
    } else {
      ctx.strokeStyle = major ? '#4a5058' : '#3b4046';
      ctx.lineWidth = w;
      ctx.setLineDash([]);
    }
    ctx.stroke();
    if (pass === 1 && major && w > 7) {
      ctx.strokeStyle = 'rgba(255,255,255,0.16)';
      ctx.lineWidth = 1;
      ctx.setLineDash([8, 10]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
}

function toPxLocal(frame: LocalFrame, view: ViewState, x: number, y: number): Vec2 {
  return project(view, frame.toLngLat({ x, y }));
}

function clampZoom(z: number): number {
  return Math.max(MIN_Z, Math.min(MAX_Z, z));
}
