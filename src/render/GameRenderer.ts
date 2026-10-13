import { LocalFrame, pixelsPerMeter, type Vec2, type ViewState } from '../geo/mercator';
import type { GameController } from '../game/controller';
import { groupBox, memberLive, sameRef, type EntityRef } from '../game/selection';
import type { CrowdGroup, ForceKind, MoverEntity } from '../engine/types';
import type { GameZone } from '../state/types';
import { lodForZoom, type Lod } from './lod';
import { defaultManifest, forceSpriteId, ManifestIndex, PERSON_COLORS, vehicleSpriteId, VEHICLE_DIMENSIONS } from './sprites/manifest';
import { ProceduralSpriteProvider } from './sprites/procedural';
import { MARKERS, ringMarker, STATUS_MARKERS, statusMarker } from './sprites/markers';
import { buildSnapshot, crowdPose, decorSpriteFor, orientationIndex, type RenderablePose, type RenderableSnapshot, type RenderableUnit, type RenderableVehicle } from './sprites/snapshot';
import type { SpriteProvider, SpriteQuery, SpriteRegion } from './sprites/types';
import type { OperationPlan } from '../scenarios/plan';

const COLORS = {
  accent: '#22d3ee',
  crowdCalm: '#eef2f7',
  crowdTense: '#ffc857',
  crowdHot: '#ff5a4d',
  blocked: '#ff3b30',
  partial: '#fb923c',
  slowed: '#facc15',
  zone: '#38bdf8',
  text: '#f8fafc',
  pill: 'rgba(8,12,20,0.82)',
};

const FORCE_STYLE: Record<ForceKind, { code: string; fill: string; edge: string }> = {
  crs: { code: 'CRS', fill: '#1d4ed8', edge: '#bfdbfe' },
  police_nationale: { code: 'POL', fill: '#38bdf8', edge: '#e0f2fe' },
  gendarmerie_mobile: { code: 'GM', fill: '#312e81', edge: '#c7d2fe' },
  unite_speciale: { code: 'US', fill: '#374151', edge: '#d1d5db' },
};

const VEHICLE_LIGHTS: Record<keyof typeof VEHICLE_DIMENSIONS, 'blue' | 'emergency' | 'none'> = {
  fourgon_police: 'blue',
  fourgon_crs: 'blue',
  voiture_police: 'blue',
  ambulance: 'emergency',
  camion_pompiers: 'emergency',
  vehicule_secours_leger: 'emergency',
  vehicule_gendarmerie: 'blue',
  voiture_banalisee: 'none',
  moto_police: 'blue',
  camion_a_eau: 'blue',
};
export const VEHICLE_LABEL = Object.fromEntries(Object.entries(VEHICLE_DIMENSIONS).map(([k, v]) => [k, v.label])) as Record<keyof typeof VEHICLE_DIMENSIONS, string>;
export const FORCE_CODE: Record<ForceKind, string> = Object.fromEntries(Object.entries(FORCE_STYLE).map(([k, v]) => [k, v.code])) as Record<ForceKind, string>;

export interface FrameStats {
  frames: number;
  avgMs: number;
  p95Ms: number;
  maxMs: number;
  /** Nombre de points de foule tracés lors de la dernière image. */
  dots: number;
  fps: number;
  frameIntervalP95Ms: number;
}

export interface ScreenTarget {
  ref: EntityRef;
  x: number;
  y: number;
}

/** Budget de points de foule tracés par image (échantillonnage uniforme au-delà). */
export const DOT_BUDGET = 9000;
/** Budget de silhouettes (sprites) par image : plus coûteuses que des points. */
export const SPRITE_BUDGET = 6000;

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * Couche de rendu du jeu (Canvas 2D) superposée à la carte. Elle lit l'état du moteur (interpolé entre deux ticks)
 * et la caméra de l'adaptateur de carte à chaque image : les pions restent alignés pendant le déplacement et le zoom.
 * La projection est affine, ancrée au centre de la vue (erreur < 1 px sur la zone de jeu aux zooms utiles).
 */
export class GameRenderer {
  private readonly ctx: CanvasRenderingContext2D;
  private ctrl: GameController | null = null;
  private frame: LocalFrame | null = null;
  private zone: GameZone = { halfWidth: 600, halfHeight: 450 };
  private previewZone: GameZone | null = null;
  private raf = 0;
  private running = false;
  private durations: number[] = [];
  private frameCount = 0;
  private lastDots = 0;
  private intervals: number[] = [];
  private lastTick = 0;
  private targets: ScreenTarget[] = [];
  /** Diagnostic : couches à ne pas dessiner (zone, streets, crowd, vehicles, units, routes). */
  readonly skip = new Set<string>();
  hover: EntityRef | null = null;
  /** Obscurité (0 jour … 1 nuit) : voile bleuté sous les pions, qui restent bien visibles. */
  darkness = 0;
  /** Fournisseur de sprites (procédural par défaut) : interchangeable sans toucher au moteur ni à l'interface. */
  sprites: SpriteProvider;
  /** Manifeste actif : tailles réelles, rayons de sélection, orientations. */
  manifest: ManifestIndex;
  /** Plan d'opération en cours d'édition (mode planification) et aperçu de l'itinéraire : dessinés par-dessus la carte. */
  planOverlay: { plan: OperationPlan; route: Vec2[] | null; routeError: string | null } | null = null;
  /** Dernier instantané de rendu (positions interpolées, données sémantiques). */
  snapshot: RenderableSnapshot | null = null;
  private readonly pose: RenderablePose = { x: 0, y: 0, dir: 0, variant: 0, walking: false, seed: 0 };
  /** Fond aérien : les individus sont cerclés d'un liseré sombre pour rester lisibles sur la photo. */
  aerial = false;
  /** Mode « Aller ici » actif : curseur de ciblage dessiné par l'interface. */
  readonly reducedMotion: boolean;
  motion = 1;
  private cssW = 0;
  private cssH = 0;
  private dpr = 1;
  // projection affine de l'image courante
  private cx = 0;
  private cy = 0;
  private mx = 0;
  private my = 0;
  private ppm = 1;
  /** Fonction appelée avant chaque dessin (avance la simulation) avec le temps réel écoulé en ms. */
  beforeDraw: ((dtMs: number) => void) | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly getView: () => ViewState,
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D indisponible');
    this.ctx = ctx;
    this.manifest = new ManifestIndex(defaultManifest());
    const procedural = new ProceduralSpriteProvider(this.manifest);
    this.sprites = procedural;
    this.reducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (this.reducedMotion) this.motion = 0;
  }

  setController(c: GameController | null, origin?: { lng: number; lat: number }): void {
    this.ctrl = c;
    if (c) c.picker.hitRadius = (e) => this.manifest.hitRadiusM(e.entity === 'unit' ? forceSpriteId(e.force, e.loadout) : vehicleSpriteId(e.vehicle));
    this.frame = origin ? new LocalFrame(origin) : null;
  }

  setZone(z: GameZone): void {
    this.zone = z;
  }

  /** Aperçu du secteur de jeu avant chargement : rectangle centré à l'écran (la carte se déplace dessous). */
  setPreviewZone(z: GameZone | null): void {
    this.previewZone = z;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const loop = (now: number) => {
      if (!this.running) return;
      const dt = this.lastTick ? now - this.lastTick : 16;
      if (this.lastTick) {
        this.intervals.push(dt);
        if (this.intervals.length > 240) this.intervals.shift();
      }
      this.lastTick = now;
      this.beforeDraw?.(dt);
      this.draw(now);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  getTargets(): ScreenTarget[] {
    return this.targets.map((t) => ({ ...t }));
  }

  getStats(): FrameStats {
    const d = [...this.durations].sort((a, b) => a - b);
    const n = d.length;
    const iv = [...this.intervals].sort((a, b) => a - b);
    const meanIv = iv.length ? iv.reduce((x, y) => x + y, 0) / iv.length : 0;
    return {
      fps: meanIv > 0 ? 1000 / meanIv : 0,
      frameIntervalP95Ms: iv.length ? (iv[Math.min(iv.length - 1, Math.floor(iv.length * 0.95))] as number) : 0,
      frames: this.frameCount,
      avgMs: n ? d.reduce((s, v) => s + v, 0) / n : 0,
      p95Ms: n ? (d[Math.min(n - 1, Math.floor(n * 0.95))] as number) : 0,
      maxMs: n ? (d[n - 1] as number) : 0,
      dots: this.lastDots,
    };
  }

  resetStats(): void {
    this.durations = [];
    this.intervals = [];
    this.frameCount = 0;
  }

  // ------------------------------------------------------------------ conversions écran ↔ monde

  /** Point du repère local (m) → pixels écran (projection de l'image courante). */
  toScreen(m: Vec2): Vec2 {
    return { x: this.cx + (m.x - this.mx) * this.ppm, y: this.cy - (m.y - this.my) * this.ppm };
  }

  /** Pixels écran → repère local (m), d'après la vue courante. */
  toWorld(p: Vec2): Vec2 | null {
    const view = this.getView();
    if (!this.frame) return null;
    this.setProjection(view);
    return { x: this.mx + (p.x - this.cx) / this.ppm, y: this.my - (p.y - this.cy) / this.ppm };
  }

  /** Mètres par pixel dans la vue courante. */
  metersPerPixel(): number {
    return 1 / this.ppm;
  }

  private setProjection(view: ViewState): void {
    const frame = this.frame as LocalFrame;
    const m = frame.toMeters({ lng: view.lng, lat: view.lat });
    this.mx = m.x;
    this.my = m.y;
    this.cx = view.width / 2;
    this.cy = view.height / 2;
    this.ppm = pixelsPerMeter(view.lat, view.zoom);
  }

  // ------------------------------------------------------------------ dessin

  draw(nowMs: number): void {
    const t0 = performance.now();
    const view = this.getView();
    this.fitCanvas(view);
    const { ctx } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.cssW, this.cssH);
    this.targets = [];
    this.lastDots = 0;
    if (this.previewZone && !this.ctrl && this.cssW > 1) {
      // projection affine centrée sur l'écran (pas de repère local : la carte réelle seule)
      const ppm = pixelsPerMeter(view.lat, view.zoom);
      const w = this.previewZone.halfWidth * ppm;
      const h = this.previewZone.halfHeight * ppm;
      const cx = this.cssW / 2;
      const cy = this.cssH / 2;
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, this.cssW, this.cssH);
      ctx.rect(cx - w, cy - h, 2 * w, 2 * h);
      ctx.fillStyle = 'rgba(4,10,20,0.42)';
      ctx.fill('evenodd');
      ctx.setLineDash([14, 8]);
      ctx.lineWidth = 2.4;
      ctx.strokeStyle = COLORS.zone;
      ctx.strokeRect(cx - w, cy - h, 2 * w, 2 * h);
      ctx.restore();
      this.pill(`Secteur de jeu ${Math.round(this.previewZone.halfWidth * 2)} × ${Math.round(this.previewZone.halfHeight * 2)} m`, cx - w + 10, cy - h + 14, { size: 11, bg: 'rgba(8,47,73,0.85)', border: COLORS.zone, align: 'left' });
    }
    if (this.ctrl && this.frame && this.cssW > 1) {
      this.setProjection(view);
      this.drawScene(this.ctrl, view, nowMs / 1000);
      this.sprites.flush?.();
    }
    this.frameCount++;
    this.durations.push(performance.now() - t0);
    if (this.durations.length > 240) this.durations.shift();
  }

  private fitCanvas(view: ViewState): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(view.width));
    const h = Math.max(1, Math.round(view.height));
    if (w !== this.cssW || h !== this.cssH || dpr !== this.dpr) {
      this.cssW = w;
      this.cssH = h;
      this.dpr = dpr;
      this.sprites.setDevicePixelRatio?.(dpr);
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
      this.canvas.style.width = `${w}px`;
      this.canvas.style.height = `${h}px`;
    }
  }

  private drawScene(c: GameController, view: ViewState, t: number): void {
    const lod = lodForZoom(view.zoom);
    const on = (k: string) => !this.skip.has(k);
    const alpha = c.alpha;
    if (this.darkness > 0.01) {
      this.ctx.fillStyle = `rgba(6,12,38,${(0.55 * this.darkness).toFixed(3)})`;
      this.ctx.fillRect(0, 0, this.cssW, this.cssH);
    }
    if (on('zone')) this.drawZone(t);
    if (on('streets')) this.drawStreets(c, t, lod);
    if (on('routes')) this.drawRoutes(c, alpha, t);
    if (this.planOverlay) this.drawPlan(this.planOverlay, t);
    if (on('crowd')) this.drawCrowds(c, alpha, lod, t);
    const snap = buildSnapshot(c, alpha, t);
    this.snapshot = snap;
    if (on('decor')) this.drawDecor(c, t, lod);
    if (on('pois')) this.drawPois(c, lod);
    if (on('vehicles')) for (const v of snap.vehicles) this.drawVehicle(c, v, t, lod);
    if (on('units')) for (const u of snap.units) this.drawUnit(c, u, t, lod);
    if (on('incidents')) this.drawIncidents(c, snap, t, lod);
  }

  // -- zone, rues ---------------------------------------------------------

  private drawZone(t: number): void {
    const { ctx } = this;
    const { halfWidth: w, halfHeight: h } = this.zone;
    const a = this.toScreen({ x: -w, y: h });
    const b = this.toScreen({ x: w, y: -h });
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, this.cssW, this.cssH);
    ctx.rect(a.x, a.y, b.x - a.x, b.y - a.y);
    ctx.fillStyle = 'rgba(4,10,20,0.42)';
    ctx.fill('evenodd');
    ctx.beginPath();
    ctx.rect(a.x, a.y, b.x - a.x, b.y - a.y);
    ctx.strokeStyle = 'rgba(56,189,248,0.22)';
    ctx.lineWidth = 8;
    ctx.stroke();
    ctx.setLineDash([14, 8]);
    ctx.lineDashOffset = -t * 10 * this.motion;
    ctx.strokeStyle = COLORS.zone;
    ctx.lineWidth = 2.4;
    ctx.stroke();
    ctx.restore();
    this.pill('ZONE DE JEU', a.x + 10, a.y + 10, { size: 11, bg: 'rgba(8,47,73,0.85)', border: COLORS.zone, align: 'left' });
  }

  /** Surcouche des états de rue : ralentie, partiellement obstruée, bloquée, fermée par le scénario. */
  private drawStreets(c: GameController, t: number, lod: Lod): void {
    const { ctx } = this;
    const g = c.sim.graph;
    const st = c.sim.state;
    const ppm = this.ppm;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let e = 0; e < g.edgeCount; e++) {
      const closed = st.scenarioBlock[e] === 1;
      const s = Math.max(st.footState[e] as number, st.vehState[e] as number);
      if (!closed && s === 0) continue;
      const a = g.shapeStart[e] as number;
      const b = g.shapeStart[e + 1] as number;
      const x0 = g.shape[2 * a] as number;
      const y0 = g.shape[2 * a + 1] as number;
      const p0 = this.toScreen({ x: x0, y: y0 });
      if (p0.x < -400 || p0.y < -400 || p0.x > this.cssW + 400 || p0.y > this.cssH + 400) continue;
      const lw = Math.max(3, Math.min(9, (g.edgeWidth[e] as number) * ppm * 0.45));
      ctx.beginPath();
      for (let k = a; k < b; k++) {
        const p = this.toScreen({ x: g.shape[2 * k] as number, y: g.shape[2 * k + 1] as number });
        if (k === a) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      }
      if (closed || s === 3) {
        ctx.setLineDash([]);
        ctx.strokeStyle = 'rgba(10,0,0,0.65)';
        ctx.lineWidth = lw + 2.5;
        ctx.stroke();
        ctx.setLineDash([lw * 2.2, lw * 1.4]);
        ctx.lineDashOffset = -t * 14 * this.motion;
        ctx.strokeStyle = COLORS.blocked;
        ctx.lineWidth = lw;
        ctx.stroke();
      } else {
        ctx.setLineDash(s === 2 ? [lw * 3, lw * 1.2] : []);
        ctx.strokeStyle = s === 2 ? COLORS.partial : COLORS.slowed;
        ctx.globalAlpha = 0.85;
        ctx.lineWidth = s === 2 ? lw : Math.max(2.5, lw * 0.7);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      if (closed && lod.labels) {
        const mid = this.toScreen({ x: ((g.shape[2 * a] as number) + (g.shape[2 * (b - 1)] as number)) / 2, y: ((g.shape[2 * a + 1] as number) + (g.shape[2 * (b - 1) + 1] as number)) / 2 });
        this.barrierIcon(mid.x, mid.y, Math.max(6, Math.min(11, ppm * 3)));
      }
    }
    ctx.restore();
  }

  private barrierIcon(x: number, y: number, r: number): void {
    const { ctx } = this;
    ctx.save();
    ctx.setLineDash([]);
    ctx.fillStyle = '#7f1d1d';
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - r * 0.5, y - r * 0.5);
    ctx.lineTo(x + r * 0.5, y + r * 0.5);
    ctx.moveTo(x + r * 0.5, y - r * 0.5);
    ctx.lineTo(x - r * 0.5, y + r * 0.5);
    ctx.stroke();
    ctx.restore();
  }

  // -- itinéraires et destinations ----------------------------------------

  private drawRoutes(c: GameController, alpha: number, t: number): void {
    const { ctx } = this;
    for (const r of c.selection) {
      let route = null as MoverEntity['route'];
      let s0 = 0;
      let dest: Vec2 | null = null;
      let color = COLORS.accent;
      if (r.type === 'group') {
        const g = c.sim.group(r.id);
        if (!g?.route) continue;
        route = g.route;
        s0 = Math.max(0, g.sCentre);
        const d = g.plan.destination;
        dest = d ? d.pos : null;
        color = '#e2e8f0';
      } else {
        const e = c.sim.entity(r.id);
        if (!e?.route) continue;
        route = e.route;
        s0 = e.routeS;
        dest = e.order ? e.order.target : null;
        color = e.status === 'waiting' ? '#fbbf24' : '#4ade80';
      }
      if (!route) continue;
      void alpha;
      const pts = route.pts;
      const cum = route.cum;
      ctx.save();
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < cum.length; i++) {
        if ((cum[i] as number) < s0 - 1) continue;
        const p = this.toScreen({ x: pts[2 * i] as number, y: pts[2 * i + 1] as number });
        if (!started) {
          const cur = this.toScreen(r.type === 'group' ? (c.positionOf(r) ?? { x: pts[2 * i] as number, y: pts[2 * i + 1] as number }) : { x: (c.sim.entity(r.id) as MoverEntity).x, y: (c.sim.entity(r.id) as MoverEntity).y });
          ctx.moveTo(cur.x, cur.y);
          started = true;
        }
        ctx.lineTo(p.x, p.y);
      }
      ctx.setLineDash([8, 6]);
      ctx.lineDashOffset = -t * 20 * this.motion;
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.lineWidth = 4.5;
      ctx.stroke();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.4;
      ctx.stroke();
      ctx.restore();
      if (dest) this.destinationMarker(this.toScreen(dest), color);
    }
  }

  private destinationMarker(p: Vec2, color: string): void {
    const { ctx } = this;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.beginPath();
    ctx.arc(0, 0, 9, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(8,12,20,0.8)';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = color;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-5, 0);
    ctx.lineTo(5, 0);
    ctx.moveTo(0, -5);
    ctx.lineTo(0, 5);
    ctx.stroke();
    ctx.restore();
  }

  // -- foule --------------------------------------------------------------

  private drawCrowds(c: GameController, alpha: number, lod: Lod, t: number): void {
    const { ctx } = this;
    const groups = c.sim.groups.filter((g) => g.phase !== 'dispersed');
    let total = 0;
    for (const g of groups) total += Math.min(g.members.n, g.exitStart) - g.members.activeStart;
    if (total === 0) return;
    const dotR = Math.max(1.2, Math.min(4.2, 0.32 * this.ppm));
    for (const g of groups) {
      const m = g.members;
      const n = Math.min(m.n, g.exitStart) - m.activeStart;
      if (n <= 0) continue;
      const box = groupBox(g, 0);
      if (!box) continue;
      const centre = this.toScreen({ x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 });
      const rPx = (Math.hypot(box.maxX - box.minX, box.maxY - box.minY) / 2) * this.ppm;
      const selected = c.selection.some((r) => r.type === 'group' && r.id === g.id);
      const hovered = this.hover?.type === 'group' && this.hover.id === g.id;
      this.targets.push({ ref: { type: 'group', id: g.id }, x: centre.x, y: centre.y });
      const tone = g.tension > 65 ? COLORS.crowdHot : g.tension > 35 ? COLORS.crowdTense : COLORS.crowdCalm;
      // hors écran (avec marge) : rien à tracer
      const sx0 = this.toScreen({ x: box.minX, y: box.maxY });
      const sx1 = this.toScreen({ x: box.maxX, y: box.minY });
      if (sx1.x < -40 || sx0.x > this.cssW + 40 || sx1.y < -40 || sx0.y > this.cssH + 40) continue;

      if (lod.aggregateCrowd) {
        const r = Math.max(13, Math.min(34, 4 + Math.sqrt(n) * 1.1));
        ctx.save();
        ctx.beginPath();
        ctx.arc(centre.x, centre.y, r, 0, Math.PI * 2);
        ctx.fillStyle = tone;
        ctx.globalAlpha = 0.92;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.lineWidth = selected ? 3 : 1.5;
        ctx.strokeStyle = selected ? COLORS.accent : 'rgba(0,0,0,0.6)';
        ctx.stroke();
        ctx.fillStyle = '#0b1220';
        ctx.font = '700 12px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(n), centre.x, centre.y + 0.5);
        ctx.restore();
        continue;
      }

      if (lod.tier >= 2) {
        this.drawPeople(g, alpha, lod.tier, total, selected || hovered ? tone : tone, t);
        if (selected || hovered) this.crowdOutline(centre, rPx, selected, t);
        if (lod.labels) this.pill(`${g.label} · ${n}`, centre.x, centre.y - Math.min(rPx, 200) - 14, { size: 11, bg: COLORS.pill, border: tone });
        continue;
      }
      // individus : échantillonnage régulier selon le budget global
      const stride = Math.max(1, Math.ceil(total / DOT_BUDGET));
      ctx.save();
      ctx.fillStyle = tone;
      if (this.aerial) {
        ctx.strokeStyle = 'rgba(8,12,20,0.75)';
        ctx.lineWidth = 1.2;
      }
      ctx.beginPath();
      const W = this.cssW + 8;
      const H = this.cssH + 8;
      let drawn = 0;
      const first = Math.max(m.activeStart, g.entryStart) + ((g.seed >>> 0) % stride);
      const bl = g.blocks;
      const lastI = Math.min(m.n, g.exitStart);
      for (let i = first; i < lastI; i += stride) {
        if (bl ? (bl.level[Math.floor(i / bl.size)] as number) === 0 : g.level === 0) continue;
        const x = (m.px[i] as number) + ((m.x[i] as number) - (m.px[i] as number)) * alpha;
        const y = (m.py[i] as number) + ((m.y[i] as number) - (m.py[i] as number)) * alpha;
        const sx = this.cx + (x - this.mx) * this.ppm;
        const sy = this.cy - (y - this.my) * this.ppm;
        if (sx < -8 || sy < -8 || sx > W || sy > H) continue;
        ctx.moveTo(sx + dotR, sy);
        ctx.arc(sx, sy, dotR, 0, Math.PI * 2);
        drawn++;
      }
      if (this.aerial) ctx.stroke();
      ctx.fill();
      ctx.restore();
      this.lastDots += drawn;

      if (selected || hovered) {
        ctx.save();
        ctx.beginPath();
        ctx.ellipse(centre.x, centre.y, rPx * 1.05 + 10, rPx * 1.05 + 10, 0, 0, Math.PI * 2);
        ctx.setLineDash([6, 5]);
        ctx.lineDashOffset = -t * 12 * this.motion;
        ctx.strokeStyle = selected ? COLORS.accent : 'rgba(255,255,255,0.55)';
        ctx.lineWidth = 1.6;
        ctx.stroke();
        ctx.restore();
      }
      if (lod.labels) this.pill(`${g.label} · ${n}`, centre.x, centre.y - Math.min(rPx, 200) - 14, { size: 11, bg: COLORS.pill, border: tone });
    }
    // individu sélectionné
    for (const r of c.selection) {
      if (r.type !== 'group' || r.member === undefined) continue;
      const g = c.sim.group(r.id);
      if (!g || r.member < g.members.activeStart || !memberLive(g, r.member)) continue;
      const p = this.toScreen({ x: g.members.x[r.member] as number, y: g.members.y[r.member] as number });
      this.ring(p, 7, COLORS.accent, t);
    }
  }

  /** Individus en silhouettes (paliers T2/T3) : sprites orientés et animés, échantillon stable par permutation fixe. */
  private drawPeople(g: CrowdGroup, alpha: number, tier: SpriteQuery['tier'], total: number, _tone: string, t: number): void {
    const m = g.members;
    const stride = Math.max(1, Math.ceil(total / SPRITE_BUDGET));
    const first = Math.max(m.activeStart, g.entryStart) + ((g.seed >>> 0) % stride);
    const lastI = Math.min(m.n, g.exitStart);
    const bl = g.blocks;
    const pose = this.pose;
    const q: SpriteQuery = { id: 'person', variant: 0, orientation: 0, frame: 0, tier, ppm: this.ppm, deferred: true };
    const dotR = Math.max(1.2, Math.min(3.2, 0.3 * this.ppm));
    const tf = Math.floor(t * 3);
    const W = this.cssW + 12;
    const H = this.cssH + 12;
    const { ctx } = this;
    let drawn = 0;
    for (let i = first; i < lastI; i += stride) {
      if (bl ? (bl.level[Math.floor(i / bl.size)] as number) === 0 : g.level === 0) continue;
      crowdPose(g, i, alpha, pose);
      const sx = this.cx + (pose.x - this.mx) * this.ppm;
      const sy = this.cy - (pose.y - this.my) * this.ppm;
      if (sx < -12 || sy < -12 || sx > W || sy > H) continue;
      q.variant = pose.variant;
      q.orientation = orientationIndex(pose.dir, 8);
      q.frame = pose.walking ? 1 + ((tf + pose.seed) & 1) : 0;
      const r = this.sprites.get(q);
      if (!r) {
        // sprite en préparation : point provisoire (jamais de trou dans la foule)
        ctx.fillStyle = PERSON_COLORS[pose.variant % PERSON_COLORS.length] as string;
        ctx.fillRect(sx - dotR, sy - dotR, dotR * 2, dotR * 2);
        continue;
      }
      ctx.drawImage(r.image, r.sx, r.sy, r.sw, r.sh, sx + r.ox, sy + r.oy, r.w, r.h);
      drawn++;
    }
    this.lastDots += drawn;
  }

  private crowdOutline(centre: Vec2, rPx: number, selected: boolean, t: number): void {
    const { ctx } = this;
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(centre.x, centre.y, rPx * 1.05 + 10, rPx * 1.05 + 10, 0, 0, Math.PI * 2);
    ctx.setLineDash([6, 5]);
    ctx.lineDashOffset = -t * 12 * this.motion;
    ctx.strokeStyle = selected ? COLORS.accent : 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.restore();
  }

  /** Plan d'opération : itinéraire prévu, départ, arrivée, points de passage, axes fermés, unités. */
  private drawPlan(o: NonNullable<GameRenderer['planOverlay']>, t: number): void {
    const { ctx } = this;
    const pt = (v: Vec2) => this.toScreen(v);
    if (o.route && o.route.length > 1) {
      ctx.save();
      ctx.beginPath();
      o.route.forEach((v, i) => {
        const p = pt(v);
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      ctx.setLineDash([10, 7]);
      ctx.lineDashOffset = -t * 14 * this.motion;
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = 'rgba(8,12,20,0.7)';
      ctx.stroke();
      ctx.lineWidth = 2.2;
      ctx.strokeStyle = '#60a5fa';
      ctx.stroke();
      ctx.restore();
    }
    for (const c of o.plan.closures) {
      const p = pt(c);
      this.barrierIcon(p.x, p.y, 11);
    }
    o.plan.units.forEach((u, i) => {
      const p = pt(u.pos);
      ctx.save();
      ctx.fillStyle = '#1d4ed8';
      ctx.strokeStyle = '#bfdbfe';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.rect(p.x - 9, p.y - 9, 18, 18);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      this.pill(`Unité ${i + 1}`, p.x, p.y - 20, { size: 10, bg: 'rgba(8,18,50,0.92)', border: '#bfdbfe' });
    });
    const flag = (v: Vec2, color: string, text: string) => {
      const p = pt(v);
      ctx.save();
      ctx.strokeStyle = '#0b1220';
      ctx.fillStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      this.pill(text, p.x, p.y - 20, { size: 11, bg: COLORS.pill, border: color, bold: true });
    };
    o.plan.waypoints.forEach((w, i) => flag(w, '#facc15', `Passage ${i + 1}`));
    flag(o.plan.start, '#4ade80', 'Départ');
    flag(o.plan.end, '#f87171', 'Arrivée');
  }

  // -- monde : décor, lieux d'intérêt, incidents ---------------------------

  /** Objets urbains (poubelles, bancs, barrières, vitrines fictives…) : sprites, dès que l'échelle les rend lisibles. */
  private drawDecor(c: GameController, t: number, lod: Lod): void {
    if (this.ppm < 2.2) return;
    const { ctx } = this;
    const q: SpriteQuery = { id: '', variant: 0, orientation: 0, frame: 0, tier: lod.tier >= 3 ? 3 : 2, ppm: this.ppm, deferred: true };
    const burnFrame = Math.floor(t * 4) & 1;
    const W = this.cssW + 40;
    const H = this.cssH + 40;
    for (const d of c.sim.world.decor) {
      if (d.source === 'osm' && d.kind === 'shopfront' && d.state === 'intact') continue; // commerce réel intact : seule l'épingle du lieu s'affiche
      const sx = this.cx + (d.x - this.mx) * this.ppm;
      const sy = this.cy - (d.y - this.my) * this.ppm;
      if (sx < -40 || sy < -40 || sx > W || sy > H) continue;
      q.id = decorSpriteFor(d.kind, d.state);
      q.frame = d.state === 'burning' ? burnFrame : 0;
      const r = this.sprites.get(q);
      if (!r) continue;
      this.blit(r, sx, sy, -d.heading);
    }
  }

  private static readonly POI_COLORS: Record<string, string> = { commerce: '#fbbf24', public: '#a78bfa', school: '#34d399', company: '#94a3b8', gathering: '#38bdf8' };

  /** Lieux d'intérêt : épingles discrètes ; le nom OSM s'affiche tel quel, un commerce fictif est marqué comme tel. */
  private drawPois(c: GameController, lod: Lod): void {
    if (!lod.labels) return;
    const { ctx } = this;
    const hovered = this.hover?.type === 'poi' ? this.hover.id : null;
    let labels = 0;
    for (const p of c.sim.world.pois) {
      if (p.kind === 'gathering') continue;
      const sx = this.cx + (p.x - this.mx) * this.ppm;
      const sy = this.cy - (p.y - this.my) * this.ppm;
      if (sx < -20 || sy < -20 || sx > this.cssW + 20 || sy > this.cssH + 20) continue;
      const selected = c.selection.some((r) => r.type === 'poi' && r.id === p.id);
      this.targets.push({ ref: { type: 'poi', id: p.id }, x: sx, y: sy });
      if (p.fictional && !selected && hovered !== p.id && p.state === 'intact') continue; // la vitrine fictive est déjà dessinée
      const col = GameRenderer.POI_COLORS[p.kind] ?? '#cbd5e1';
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(sx, sy - 5);
      ctx.lineTo(sx + 4, sy);
      ctx.lineTo(sx, sy + 5);
      ctx.lineTo(sx - 4, sy);
      ctx.closePath();
      ctx.fillStyle = p.state === 'destroyed' ? '#64748b' : p.state === 'burning' ? '#ff5a4d' : p.state === 'damaged' ? '#fb923c' : col;
      ctx.globalAlpha = 0.95;
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(8,12,20,0.85)';
      ctx.stroke();
      ctx.restore();
      if (selected) this.ring({ x: sx, y: sy }, 11, COLORS.accent, 0);
      const showName = p.name && (selected || hovered === p.id || (this.ppm >= 4.5 && labels < 18));
      if (showName) {
        labels++;
        this.pill(p.name as string, sx, sy - 14, { size: 10, bg: COLORS.pill, border: col });
      }
    }
  }

  /** Incidents : fumée et flammes procédurales (effets de la phase 5 à venir), épingle d'alerte, étiquette « fictif ». */
  private drawIncidents(c: GameController, snap: RenderableSnapshot, t: number, lod: Lod): void {
    const { ctx } = this;
    for (const i of snap.incidents) {
      const sx = this.cx + (i.x - this.mx) * this.ppm;
      const sy = this.cy - (i.y - this.my) * this.ppm;
      if (sx < -60 || sy < -60 || sx > this.cssW + 60 || sy > this.cssH + 60) continue;
      const ref: EntityRef = { type: 'incident', id: i.id };
      const selected = c.isSelected(ref);
      this.targets.push({ ref, x: sx, y: sy });
      const fire = i.kind === 'bin_fire' || i.kind === 'fire';
      // fumée : cercles translucides qui montent (écran), plus denses selon la gravité
      if (fire && (i.state === 'active' || i.state === 'escalating' || i.state === 'lingering' || i.state === 'contained') && this.ppm >= 1.2) {
        const dense = i.state === 'lingering' ? 0.35 : 1;
        const puffs = 3 + i.severity;
        ctx.save();
        for (let k = 0; k < puffs; k++) {
          const ph = ((t * 0.35 * this.motion + k / puffs) % 1 + 1) % 1;
          const r = (1.2 + i.severity * 0.5 + ph * 2.2) * this.ppm;
          ctx.globalAlpha = (1 - ph) * 0.5 * dense;
          ctx.fillStyle = '#3b3f46';
          ctx.beginPath();
          ctx.arc(sx + Math.sin(k * 2.1 + t * 0.4) * 0.8 * this.ppm, sy - ph * 3.5 * this.ppm, Math.min(r, 60), 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }
      // lueur du feu : visible même quand l'objet est minuscule à l'écran
      if (fire && (i.state === 'active' || i.state === 'escalating')) {
        const gr = Math.max(9, (1.6 + 0.5 * i.severity) * this.ppm);
        const grad = ctx.createRadialGradient(sx, sy, 0, sx, sy, gr);
        const flick = this.motion ? 0.75 + 0.25 * Math.sin(t * 11 + i.severity) : 1;
        grad.addColorStop(0, `rgba(255,190,60,${0.85 * flick})`);
        grad.addColorStop(0.5, `rgba(255,90,40,${0.4 * flick})`);
        grad.addColorStop(1, 'rgba(255,60,30,0)');
        ctx.save();
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(sx, sy, gr, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      // épingle d'alerte (toujours visible, y compris aux faibles zooms)
      const col = i.state === 'contained' ? '#fbbf24' : i.state === 'lingering' ? '#94a3b8' : '#ff5a4d';
      const pulse = this.motion ? 1 + 0.12 * Math.sin(t * 5) : 1;
      ctx.save();
      ctx.beginPath();
      ctx.arc(sx, sy - 12, 8 * pulse, 0, Math.PI * 2);
      ctx.fillStyle = col;
      ctx.fill();
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = 'rgba(8,12,20,0.9)';
      ctx.stroke();
      ctx.fillStyle = '#0b1220';
      ctx.font = '700 11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('!', sx, sy - 11.5);
      ctx.restore();
      ringMarker(ctx, sx, sy, Math.max(10, 2.2 * this.ppm), MARKERS.incident, t, this.motion);
      if (selected) this.ring({ x: sx, y: sy }, Math.max(16, 3 * this.ppm), COLORS.accent, t);
      if (lod.labels || selected) this.pill(`${i.label} · gravité ${i.severity}`, sx, sy - 30, { size: 10, bg: 'rgba(60,10,10,0.92)', border: col });
    }
    // groupes affectés par un incident : liseré orangé pulsé
    const now = c.sim.timeMs;
    for (const g of c.sim.groups) {
      if (g.affectedUntilMs <= now || g.phase === 'dispersed') continue;
      const box = groupBox(g, 0);
      if (!box) continue;
      const a = this.toScreen({ x: box.minX, y: box.maxY });
      const b = this.toScreen({ x: box.maxX, y: box.minY });
      ctx.save();
      ctx.strokeStyle = '#fb923c';
      ctx.globalAlpha = 0.5 + (this.motion ? 0.3 * Math.sin(t * 6) : 0);
      ctx.lineWidth = 2;
      ctx.setLineDash([3, 4]);
      ctx.strokeRect(a.x - 6, a.y - 6, b.x - a.x + 12, b.y - a.y + 12);
      ctx.restore();
    }
  }

  // -- forces -------------------------------------------------------------

  /** Dessine une région d'atlas centrée en (x, y), pivotée de `rot` rad (sens écran horaire = -cap). */
  private blit(r: SpriteRegion, x: number, y: number, rot: number): void {
    const { ctx } = this;
    if (rot === 0) {
      ctx.drawImage(r.image, r.sx, r.sy, r.sw, r.sh, x + r.ox, y + r.oy, r.w, r.h);
      return;
    }
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.drawImage(r.image, r.sx, r.sy, r.sw, r.sh, r.ox, r.oy, r.w, r.h);
    ctx.restore();
  }

  private spriteQuery(id: string, tier: SpriteQuery['tier'], variant = 0, frame = 0): SpriteQuery {
    return { id, variant, orientation: 0, frame, tier, ppm: this.ppm };
  }

  private drawUnit(c: GameController, u: RenderableUnit, t: number, lod: Lod): void {
    const p = this.toScreen(u);
    if (p.x < -80 || p.y < -80 || p.x > this.cssW + 80 || p.y > this.cssH + 80) return;
    const ref: EntityRef = { type: 'unit', id: u.id };
    const selected = c.isSelected(ref);
    const hovered = sameRef(this.hover, ref);
    this.targets.push({ ref, x: p.x, y: p.y });
    const style = FORCE_STYLE[u.force];
    const { ctx } = this;
    const heavy = u.force === 'crs' || u.force === 'gendarmerie_mobile';
    let hitR: number;
    if (lod.shieldFormation) {
      // formation : un sprite par groupe de 3 agents (CRS et gendarmerie mobile), jamais plus de quelques silhouettes
      const n = heavy ? Math.max(5, Math.round(u.headcount / 3)) : 3;
      const spacingM = 0.95;
      const frame = u.status === 'moving' ? 1 + (Math.floor(t * 3) & 1) : 0;
      const q = this.spriteQuery(u.sprite, 3, 0, frame);
      const region = this.sprites.get(q);
      const spacing = spacingM * this.ppm;
      const span = (n - 1) * spacing;
      if (region) {
        const cs = Math.cos(-u.heading);
        const sn = Math.sin(-u.heading);
        for (let i = 0; i < n; i++) {
          const off = i * spacing - span / 2; // ligne perpendiculaire au cap
          this.blit(region, p.x - sn * off, p.y + cs * off, -u.heading);
        }
      }
      hitR = Math.max(span / 2 + (region ? region.w / 2 : 0), 16);
    } else {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(-u.heading);
      const size = heavy ? 26 : 20;
      this.shieldGlyph(ctx, 0, 0, size, style);
      ctx.restore();
      hitR = heavy ? 26 : 20;
    }
    const ring = STATUS_MARKERS[u.status];
    statusMarker(ctx, p.x, p.y, hitR + 3, ring, t, this.motion, u.status === 'moving' ? u.heading : null);
    if (selected) this.ring(p, hitR + 8, COLORS.accent, t);
    else if (hovered) this.ring(p, hitR + 6, MARKERS.hover.color);
    this.pill(`${style.code} ${u.num}`, p.x, p.y - hitR - 11, { size: 11, bg: 'rgba(8,18,50,0.92)', border: selected ? COLORS.accent : style.edge, bold: true });
    if (lod.labels && (selected || hovered)) this.pill(`${u.headcount} agents · ${(u.speedMps * 3.6).toFixed(1)} km/h`, p.x, p.y + hitR + 13, { size: 10, bg: COLORS.pill, border: 'transparent' });
  }

  /** Bouclier de gameplay (pictogramme), dessiné vers +x (le « devant » de l'unité). */
  private shieldGlyph(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, style: { fill: string; edge: string }): void {
    const w = size * 0.85;
    const h = size;
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.arc(-w * 0.12, 0, w * 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(w * 0.15, -h / 2);
    ctx.quadraticCurveTo(w * 0.75, -h * 0.34, w * 0.75, 0);
    ctx.quadraticCurveTo(w * 0.75, h * 0.34, w * 0.15, h / 2);
    ctx.quadraticCurveTo(-w * 0.1, 0, w * 0.15, -h / 2);
    ctx.closePath();
    ctx.fillStyle = style.fill;
    ctx.fill();
    ctx.lineWidth = Math.max(1, size * 0.08);
    ctx.strokeStyle = style.edge;
    ctx.stroke();
    ctx.restore();
  }

  private drawVehicle(c: GameController, v: RenderableVehicle, t: number, lod: Lod): void {
    const p = this.toScreen(v);
    if (p.x < -80 || p.y < -80 || p.x > this.cssW + 80 || p.y > this.cssH + 80) return;
    const dims = VEHICLE_DIMENSIONS[v.vehicle];
    const ref: EntityRef = { type: 'vehicle', id: v.id };
    const selected = c.isSelected(ref);
    const hovered = sameRef(this.hover, ref);
    this.targets.push({ ref, x: p.x, y: p.y });
    const len = Math.max(15, dims.len * this.ppm);
    const wid = Math.max(7, dims.wid * this.ppm);
    const { ctx } = this;
    const region = this.sprites.get(this.spriteQuery(v.sprite, 3));
    if (region) this.blit(region, p.x, p.y, -v.heading);
    const lights = VEHICLE_LIGHTS[v.vehicle];
    if (lights !== 'none') {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(-v.heading);
      // gyrophares : allumés (et clignotants) seulement quand les avertisseurs sont actifs
      const phase = v.emergency && Math.sin(t * 9 + v.callsign.length) > 0;
      const flash = (x: number, y: number, color: string) => {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, Math.max(2, wid * 0.14), 0, Math.PI * 2);
        ctx.fill();
      };
      if (!v.emergency) {
        flash(len * 0.28, -wid * 0.28, 'rgba(100,116,139,0.7)');
        flash(len * 0.28, wid * 0.28, 'rgba(100,116,139,0.7)');
      } else if (lights === 'emergency') {
        flash(len * 0.3, -wid * 0.3, phase ? '#ff2d2d' : '#3b82f6');
        flash(len * 0.3, wid * 0.3, phase ? '#3b82f6' : '#ff2d2d');
      } else {
        flash(len * 0.25, -wid * 0.28, phase ? '#3b82f6' : 'rgba(59,130,246,0.25)');
        flash(len * 0.25, wid * 0.28, phase ? 'rgba(59,130,246,0.25)' : '#3b82f6');
      }
      ctx.restore();
    }
    const hit = Math.max(len, wid) * 0.6 + 4;
    const ring = STATUS_MARKERS[v.status];
    if (v.status !== 'idle') statusMarker(ctx, p.x, p.y, hit + 2, ring, t, this.motion, v.status === 'moving' ? v.heading : null);
    if (selected) this.ring(p, hit + 7, COLORS.accent, t);
    else if (hovered) this.ring(p, hit + 5, MARKERS.hover.color);
    if (lod.vehicleDetail || selected || hovered) this.pill(v.callsign, p.x, p.y + hit + 9, { size: 10, bg: COLORS.pill, border: selected ? COLORS.accent : 'transparent' });
  }

  // -- primitives ---------------------------------------------------------

  private ring(c: Vec2, r: number, color: string, t = 0): void {
    ringMarker(this.ctx, c.x, c.y, r, { color, width: MARKERS.selection.width, dash: MARKERS.selection.dash }, t, this.motion);
  }

  private pill(text: string, x: number, y: number, o: { size: number; bg: string; border: string; bold?: boolean; align?: 'center' | 'left' }): void {
    const { ctx } = this;
    ctx.save();
    ctx.font = `${o.bold ? 700 : 600} ${o.size}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    const w = ctx.measureText(text).width + 10;
    const h = o.size + 7;
    const left = o.align === 'left' ? x : x - w / 2;
    ctx.fillStyle = o.bg;
    this.roundRectPath(left, y - h / 2, w, h, h / 2);
    ctx.fill();
    if (o.border !== 'transparent') {
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = o.border;
      ctx.stroke();
    }
    ctx.fillStyle = COLORS.text;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, left + 5, y + 0.5);
    ctx.restore();
  }

  private roundRectPath(x: number, y: number, w: number, h: number, r: number): void {
    const { ctx } = this;
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }
}

