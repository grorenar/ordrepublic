import { LocalFrame, pixelsPerMeter, project, type Vec2, type ViewState } from '../geo/mercator';
import { groupRadius } from '../demo/demoScenario';
import type { CrowdGroup, EntityRef, ForceUnit, Incident, RenderSnapshot, Vehicle } from '../state/types';
import { buildCrowdLayout, toneThresholds, type CrowdLayout } from './crowd';
import { crowdDotCount, hitTest, lodForZoom, type HitTarget, type Lod } from './lod';

const COLORS = {
  accent: '#22d3ee',
  crowdCalm: '#eef2f7',
  crowdTense: '#ffc857',
  crowdHot: '#ff5a4d',
  shield: '#1d4ed8',
  shieldEdge: '#bfdbfe',
  police: '#7dd3fc',
  blocked: '#ff3b30',
  zone: '#38bdf8',
  text: '#f8fafc',
  pill: 'rgba(8,12,20,0.82)',
};

export interface FrameStats {
  frames: number;
  avgMs: number;
  p95Ms: number;
  maxMs: number;
  /** Nombre de points de foule tracés lors de la dernière image. */
  dots: number;
  /** Cadence réellement observée (intervalle entre deux images navigateur), en images/s. */
  fps: number;
  /** Intervalle p95 entre deux images, en ms. */
  frameIntervalP95Ms: number;
}

/**
 * Couche de rendu du jeu (Canvas 2D) superposée à la carte. Elle lit la caméra de l'adaptateur de
 * carte à chaque image et projette elle-même les coordonnées : les pions restent donc alignés
 * pendant le déplacement, le zoom et les animations de caméra.
 */
export class GameRenderer {
  private readonly ctx: CanvasRenderingContext2D;
  private snapshot: RenderSnapshot | null = null;
  private targets: HitTarget[] = [];
  private layouts = new Map<string, CrowdLayout>();
  private raf = 0;
  private running = false;
  private frame: LocalFrame | null = null;
  private frameOriginKey = '';
  private durations: number[] = [];
  private frameCount = 0;
  private lastDots = 0;
  private intervals: number[] = [];
  private lastTick = 0;
  /** Diagnostic de performance : couches à ne pas dessiner (zone, blocked, glow, crowd, vehicles, units, incidents, selection). */
  readonly skip = new Set<string>();
  private hoverId: string | null = null;
  readonly reducedMotion: boolean;
  /** Amplitude globale des animations (0 si « réduire les animations » est demandé). */
  motion = 1;
  private cssW = 0;
  private cssH = 0;
  private dpr = 1;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly getView: () => ViewState,
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D indisponible');
    this.ctx = ctx;
    this.reducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (this.reducedMotion) this.motion = 0;
  }

  setSnapshot(s: RenderSnapshot | null): void {
    this.snapshot = s;
    if (!s) this.targets = [];
  }

  setHover(id: string | null): void {
    this.hoverId = id;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const loop = (now: number) => {
      if (!this.running) return;
      if (this.lastTick) {
        this.intervals.push(now - this.lastTick);
        if (this.intervals.length > 240) this.intervals.shift();
      }
      this.lastTick = now;
      this.draw(now);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  hit(p: Vec2): EntityRef | null {
    return hitTest(this.targets, p);
  }

  /** Cibles interactives de la dernière image (position écran de chaque pion). */
  getTargets(): HitTarget[] {
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

  /** Projette un point du repère local en pixels écran (exact, via Mercator). */
  toScreen(m: Vec2): Vec2 | null {
    if (!this.snapshot || !this.frame) return null;
    return project(this.getView(), this.frame.toLngLat(m));
  }

  // ------------------------------------------------------------------ dessin

  draw(nowMs: number): void {
    const t0 = performance.now();
    const view = this.getView();
    this.fitCanvas(view);
    const { ctx } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.cssW, this.cssH);
    const snap = this.snapshot;
    this.targets = [];
    this.lastDots = 0;
    if (snap && this.cssW > 1) {
      const key = `${snap.origin.lng},${snap.origin.lat}`;
      if (key !== this.frameOriginKey || !this.frame) {
        this.frame = new LocalFrame(snap.origin);
        this.frameOriginKey = key;
      }
      this.drawScene(snap, view, nowMs / 1000);
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
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
      this.canvas.style.width = `${w}px`;
      this.canvas.style.height = `${h}px`;
    }
  }

  private drawScene(snap: RenderSnapshot, view: ViewState, t: number): void {
    const frame = this.frame as LocalFrame;
    const ppm = pixelsPerMeter(view.lat, view.zoom);
    const lod = lodForZoom(view.zoom);
    const px = (m: Vec2): Vec2 => project(view, frame.toLngLat(m));

    const on = (k: string) => !this.skip.has(k);
    if (on('zone')) this.drawZone(snap, px, t);
    if (on('blocked')) this.drawBlocked(snap, px, ppm, t, lod);
    if (on('glow')) this.drawIncidentGlow(snap, px, ppm, t);
    if (on('crowd')) for (const g of snap.groups) this.drawCrowd(g, snap, px, ppm, t, lod, view.zoom);
    if (on('vehicles')) for (const v of snap.vehicles) this.drawVehicle(v, px, ppm, t, lod, snap);
    if (on('units')) for (const u of snap.units) this.drawUnit(u, px, ppm, t, lod, snap);
    if (on('incidents')) for (const i of snap.incidents) this.drawIncident(i, px, ppm, t, snap, lod);
    if (on('selection')) this.drawSelection(snap, px, ppm, t);
  }

  // -- zone, rues ---------------------------------------------------------

  private drawZone(snap: RenderSnapshot, px: (m: Vec2) => Vec2, t: number): void {
    const { ctx } = this;
    const { halfWidth: w, halfHeight: h } = snap.zone;
    const c = [px({ x: -w, y: h }), px({ x: w, y: h }), px({ x: w, y: -h }), px({ x: -w, y: -h })] as [Vec2, Vec2, Vec2, Vec2];
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, this.cssW, this.cssH);
    ctx.moveTo(c[0].x, c[0].y);
    for (let i = 1; i < 4; i++) ctx.lineTo(c[i]!.x, c[i]!.y);
    ctx.closePath();
    ctx.fillStyle = 'rgba(4,10,20,0.42)';
    ctx.fill('evenodd');
    ctx.beginPath();
    ctx.moveTo(c[0].x, c[0].y);
    for (let i = 1; i < 4; i++) ctx.lineTo(c[i]!.x, c[i]!.y);
    ctx.closePath();
    ctx.strokeStyle = 'rgba(56,189,248,0.22)'; // halo bon marché (le flou de canvas est trop coûteux en rendu logiciel)
    ctx.lineWidth = 8;
    ctx.stroke();
    ctx.setLineDash([14, 8]);
    ctx.lineDashOffset = -t * 10 * this.motion;
    ctx.strokeStyle = COLORS.zone;
    ctx.lineWidth = 2.4;
    ctx.stroke();
    ctx.restore();
    // Étiquette de zone
    this.pill('ZONE DE JEU', c[0].x + 10, c[0].y + 10, { size: 11, bg: 'rgba(8,47,73,0.85)', border: COLORS.zone, align: 'left' });
  }

  private drawBlocked(snap: RenderSnapshot, px: (m: Vec2) => Vec2, ppm: number, t: number, lod: Lod): void {
    if (snap.blockedSegmentIds.size === 0) return;
    const { ctx } = this;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const lw = Math.max(3, Math.min(9, 5 * ppm * 0.9));
    for (const seg of snap.segments) {
      if (!snap.blockedSegmentIds.has(seg.id) || seg.points.length < 2) continue;
      const pts = seg.points.map(px);
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.strokeStyle = 'rgba(10,0,0,0.65)';
      ctx.setLineDash([]);
      ctx.lineWidth = lw + 2.5;
      ctx.stroke();
      ctx.strokeStyle = COLORS.blocked;
      ctx.setLineDash([lw * 2.2, lw * 1.4]);
      ctx.lineDashOffset = -t * 14 * this.motion;
      ctx.lineWidth = lw;
      ctx.stroke();
      if (lod.labels) {
        const a = pts[0] as Vec2;
        const b = pts[pts.length - 1] as Vec2;
        this.barrierIcon((a.x + b.x) / 2, (a.y + b.y) / 2, Math.max(6, Math.min(11, ppm * 3)));
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

  // -- foule --------------------------------------------------------------

  private layoutFor(g: CrowdGroup, count: number): CrowdLayout {
    const key = `${g.id}:${count}:${g.seed}`;
    let l = this.layouts.get(key);
    if (!l) {
      if (this.layouts.size > 64) this.layouts.clear();
      l = buildCrowdLayout(count, g.seed);
      this.layouts.set(key, l);
    }
    return l;
  }

  private drawCrowd(g: CrowdGroup, snap: RenderSnapshot, px: (m: Vec2) => Vec2, ppm: number, t: number, lod: Lod, zoom: number): void {
    const { ctx } = this;
    const c = px(g.pos);
    const R = groupRadius(g);
    const rpx = R * ppm;
    if (c.x < -rpx - 60 || c.y < -rpx - 60 || c.x > this.cssW + rpx + 60 || c.y > this.cssH + rpx + 60) return;
    const selected = snap.selection?.type === 'group' && snap.selection.id === g.id;
    this.targets.push({ ref: { type: 'group', id: g.id }, x: c.x, y: c.y, r: Math.max(rpx, 14), z: 0 });

    const tone = g.tension > 65 ? COLORS.crowdHot : g.tension > 35 ? COLORS.crowdTense : COLORS.crowdCalm;
    if (lod.aggregateCrowd) {
      const r = Math.max(13, Math.min(34, 4 + Math.sqrt(g.size) * 1.9));
      ctx.save();
      ctx.beginPath();
      ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
      ctx.fillStyle = tone;
      ctx.globalAlpha = 0.9;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.lineWidth = selected ? 3 : 1.5;
      ctx.strokeStyle = selected ? COLORS.accent : 'rgba(0,0,0,0.6)';
      ctx.stroke();
      ctx.fillStyle = '#0b1220';
      ctx.font = '700 12px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(g.size), c.x, c.y + 0.5);
      ctx.restore();
      return;
    }

    const count = crowdDotCount(g, lod);
    const layout = this.layoutFor(g, count);
    const th = toneThresholds(g.tension);
    const agit = (1 + g.tension / 55) * this.motion;
    const dotR = Math.max(1.3, Math.min(4.8, 0.85 * ppm));
    const driftX = Math.sin(t * 0.21 + g.seed) * 1.6 * this.motion;
    const driftY = Math.cos(t * 0.17 + g.seed * 1.7) * 1.2 * this.motion;
    const breathe = 1 + 0.035 * Math.sin(t * 0.6 + g.seed) * this.motion;
    const amp = 0.55 * ppm * agit;

    // Ombre portée (haut zoom uniquement), puis trois passes de teinte.
    const buckets: Array<{ color: string; pts: number[] }> = [
      { color: COLORS.crowdCalm, pts: [] },
      { color: COLORS.crowdTense, pts: [] },
      { color: COLORS.crowdHot, pts: [] },
    ];
    const cx = c.x + driftX * ppm;
    const cy = c.y - driftY * ppm;
    for (let i = 0; i < layout.count; i++) {
      const ph = layout.phase[i] as number;
      const sp = layout.speed[i] as number;
      const x = cx + (layout.rx[i] as number) * rpx * breathe + Math.sin(t * sp + ph) * amp;
      const y = cy + (layout.ry[i] as number) * rpx * breathe + Math.cos(t * sp * 0.83 + ph * 1.3) * amp;
      const tn = layout.tone[i] as number;
      const b = tn < th.red ? 2 : tn < th.red + th.amber ? 1 : 0;
      (buckets[b] as { pts: number[] }).pts.push(x, y);
    }
    ctx.save();
    if (zoom >= 16.6) {
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath();
      for (const b of buckets) for (let k = 0; k < b.pts.length; k += 2) {
        const x = b.pts[k] as number + 0.9;
        const y = b.pts[k + 1] as number + 1.1;
        ctx.moveTo(x + dotR + 0.6, y);
        ctx.arc(x, y, dotR + 0.6, 0, Math.PI * 2);
      }
      ctx.fill();
    }
    for (const b of buckets) {
      if (!b.pts.length) continue;
      ctx.fillStyle = b.color;
      ctx.beginPath();
      for (let k = 0; k < b.pts.length; k += 2) {
        const x = b.pts[k] as number;
        const y = b.pts[k + 1] as number;
        ctx.moveTo(x + dotR, y);
        ctx.arc(x, y, dotR, 0, Math.PI * 2);
      }
      ctx.fill();
    }
    ctx.restore();
    this.lastDots += layout.count;

    if (selected || this.hoverId === g.id) {
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(c.x, c.y, rpx * 1.1, rpx * 0.95, 0, 0, Math.PI * 2);
      ctx.setLineDash([6, 5]);
      ctx.strokeStyle = selected ? COLORS.accent : 'rgba(255,255,255,0.55)';
      ctx.lineWidth = 1.6;
      ctx.stroke();
      ctx.restore();
    }
    if (lod.labels) this.pill(`${g.label} · ${g.size}`, c.x, c.y - rpx - 8, { size: 11, bg: COLORS.pill, border: tone });
  }

  // -- forces -------------------------------------------------------------

  private drawUnit(u: ForceUnit, px: (m: Vec2) => Vec2, ppm: number, t: number, lod: Lod, snap: RenderSnapshot): void {
    const c = px(u.pos);
    if (c.x < -80 || c.y < -80 || c.x > this.cssW + 80 || c.y > this.cssH + 80) return;
    const selected = snap.selection?.type === 'unit' && snap.selection.id === u.id;
    const { ctx } = this;
    const crs = u.kind === 'crs';
    const sway = this.motion * 0.25 * ppm;
    ctx.save();
    ctx.translate(c.x + Math.sin(t * 0.9 + u.headcount) * sway, c.y + Math.cos(t * 0.7 + u.headcount) * sway * 0.6);
    // Le cap est en repère monde (y vers le nord) ; l'écran a y vers le bas.
    ctx.rotate(-u.heading);

    let hitR: number;
    if (lod.shieldFormation) {
      const n = crs ? Math.max(5, Math.round(u.headcount / 3)) : 3;
      const size = Math.max(10, Math.min(24, (crs ? 3.4 : 2.6) * ppm));
      const spacing = size * 0.92;
      const span = (n - 1) * spacing;
      for (let i = 0; i < n; i++) {
        const off = i * spacing - span / 2;
        const wob = Math.sin(t * 1.6 + i * 1.3) * 0.35 * this.motion;
        this.shieldGlyph(ctx, wob + size * 0.15, off, size, crs);
      }
      hitR = Math.max(span / 2 + size, 16);
    } else {
      const size = crs ? 26 : 20;
      this.shieldGlyph(ctx, 0, 0, size, crs);
      hitR = size;
    }
    ctx.restore();
    this.targets.push({ ref: { type: 'unit', id: u.id }, x: c.x, y: c.y, r: hitR, z: 2 });

    // Identifiant fictif au-dessus du pion (toujours horizontal).
    const label = crs ? `CRS ${u.num}` : `POL ${u.num}`;
    this.pill(label, c.x, c.y - hitR - 9, {
      size: 11,
      bg: crs ? 'rgba(15,32,92,0.92)' : 'rgba(12,45,70,0.92)',
      border: selected ? COLORS.accent : crs ? '#60a5fa' : '#7dd3fc',
      bold: true,
    });
    if (lod.labels && selected) this.pill(`${u.headcount} agents`, c.x, c.y + hitR + 11, { size: 10, bg: COLORS.pill, border: 'transparent' });
    if (this.hoverId === u.id && !selected) this.ring(c, hitR + 4, 'rgba(255,255,255,0.6)');
  }

  /** Bouclier de gameplay (pictogramme), dessiné vers +x (le « devant » de l'unité). */
  private shieldGlyph(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, crs: boolean): void {
    const w = size * 0.85;
    const h = size;
    ctx.save();
    ctx.translate(x, y);
    // agent derrière le bouclier
    ctx.fillStyle = crs ? '#0f172a' : '#1e293b';
    ctx.beginPath();
    ctx.arc(-w * 0.12, 0, w * 0.3, 0, Math.PI * 2);
    ctx.fill();
    // bouclier
    ctx.beginPath();
    ctx.moveTo(w * 0.15, -h / 2);
    ctx.quadraticCurveTo(w * 0.75, -h * 0.34, w * 0.75, 0);
    ctx.quadraticCurveTo(w * 0.75, h * 0.34, w * 0.15, h / 2);
    ctx.quadraticCurveTo(-w * 0.1, 0, w * 0.15, -h / 2);
    ctx.closePath();
    ctx.fillStyle = crs ? COLORS.shield : '#38bdf8';
    ctx.fill();
    ctx.lineWidth = Math.max(1, size * 0.08);
    ctx.strokeStyle = crs ? COLORS.shieldEdge : '#e0f2fe';
    ctx.stroke();
    if (size > 9) {
      ctx.strokeStyle = 'rgba(255,255,255,0.45)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(w * 0.32, -h * 0.28);
      ctx.lineTo(w * 0.32, h * 0.28);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawVehicle(v: Vehicle, px: (m: Vec2) => Vec2, ppm: number, t: number, lod: Lod, snap: RenderSnapshot): void {
    const c = px(v.pos);
    if (c.x < -80 || c.y < -80 || c.x > this.cssW + 80 || c.y > this.cssH + 80) return;
    const dims: Record<Vehicle['kind'], [number, number]> = {
      van: [6.2, 2.4],
      police_car: [4.7, 1.9],
      water_cannon: [9, 3],
      ambulance: [6.2, 2.4],
      fire_truck: [9.6, 2.7],
    };
    const [lm, wm] = dims[v.kind];
    const len = Math.max(16, lm * ppm);
    const wid = Math.max(7, wm * ppm);
    const { ctx } = this;
    const selected = snap.selection?.type === 'vehicle' && snap.selection.id === v.id;
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate(-v.heading);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    roundRect(ctx, -len / 2 + 1, -wid / 2 + 2, len, wid, Math.min(4, wid * 0.3));
    ctx.fill();
    const body: Record<Vehicle['kind'], string> = {
      van: '#1e3a8a',
      police_car: '#f1f5f9',
      water_cannon: '#1e293b',
      ambulance: '#ffffff',
      fire_truck: '#dc2626',
    };
    ctx.fillStyle = body[v.kind];
    roundRect(ctx, -len / 2, -wid / 2, len, wid, Math.min(4, wid * 0.3));
    ctx.fill();
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = 'rgba(0,0,0,0.65)';
    ctx.stroke();
    // bandes / détails
    ctx.fillStyle = v.kind === 'police_car' ? '#1d4ed8' : v.kind === 'ambulance' ? '#ef4444' : v.kind === 'fire_truck' ? '#fde68a' : '#93c5fd';
    ctx.fillRect(-len / 2 + 2, -wid * 0.08, len - 4, wid * 0.16);
    ctx.fillStyle = 'rgba(15,23,42,0.75)'; // pare-brise
    ctx.fillRect(len * 0.22, -wid * 0.36, len * 0.14, wid * 0.72);
    if (v.kind === 'ambulance' && lod.vehicleDetail) {
      ctx.fillStyle = '#ef4444';
      const s = wid * 0.36;
      ctx.fillRect(-s * 0.2 - len * 0.1, -s, s * 0.4, s * 2);
      ctx.fillRect(-s - len * 0.1, -s * 0.2, s * 2, s * 0.4);
    }
    if (v.kind === 'water_cannon') {
      ctx.fillStyle = '#38bdf8';
      ctx.beginPath();
      ctx.arc(-len * 0.1, 0, wid * 0.22, 0, Math.PI * 2);
      ctx.fill();
    }
    // gyrophares animés
    const phase = Math.sin(t * 9 + v.callsign.length) > 0;
    const flash = (x: number, y: number, color: string) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, Math.max(2, wid * 0.14), 0, Math.PI * 2);
      ctx.fill();
    };
    if (v.kind === 'ambulance' || v.kind === 'fire_truck') {
      flash(len * 0.3, -wid * 0.3, phase ? '#ff2d2d' : '#3b82f6');
      flash(len * 0.3, wid * 0.3, phase ? '#3b82f6' : '#ff2d2d');
    } else {
      flash(len * 0.25, -wid * 0.28, phase ? '#3b82f6' : 'rgba(59,130,246,0.2)');
      flash(len * 0.25, wid * 0.28, phase ? 'rgba(59,130,246,0.2)' : '#3b82f6');
    }
    ctx.restore();
    const hit = Math.max(len, wid) * 0.6 + 4;
    this.targets.push({ ref: { type: 'vehicle', id: v.id }, x: c.x, y: c.y, r: hit, z: 1 });
    if (lod.vehicleDetail || selected || this.hoverId === v.id) {
      this.pill(v.callsign, c.x, c.y + hit + 8, { size: 10, bg: COLORS.pill, border: selected ? COLORS.accent : 'transparent' });
    }
    if (selected) this.ring(c, hit + 5, COLORS.accent);
    else if (this.hoverId === v.id) this.ring(c, hit + 3, 'rgba(255,255,255,0.6)');
  }

  // -- incidents ----------------------------------------------------------

  private drawIncidentGlow(snap: RenderSnapshot, px: (m: Vec2) => Vec2, ppm: number, t: number): void {
    const { ctx } = this;
    for (const i of snap.incidents) {
      if (i.kind !== 'bin_fire') continue;
      const c = px(i.pos);
      const r = Math.max(14, (4 + i.severity * 2.2) * ppm) * (1 + 0.08 * Math.sin(t * 5 + i.severity) * this.motion);
      const g = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, r);
      g.addColorStop(0, 'rgba(255,170,40,0.75)');
      g.addColorStop(0.5, 'rgba(255,90,20,0.35)');
      g.addColorStop(1, 'rgba(255,60,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawIncident(i: Incident, px: (m: Vec2) => Vec2, ppm: number, t: number, snap: RenderSnapshot, lod: Lod): void {
    const c = px(i.pos);
    if (c.x < -60 || c.y < -60 || c.x > this.cssW + 60 || c.y > this.cssH + 60) return;
    const { ctx } = this;
    const selected = snap.selection?.type === 'incident' && snap.selection.id === i.id;
    const r = Math.max(11, Math.min(18, 3.2 * ppm));
    const pulse = (t * 1.4 + i.severity * 0.3) % 1;
    const sevColor = i.severity >= 4 ? '#ef4444' : i.severity === 3 ? '#f97316' : '#facc15';
    ctx.save();
    if (this.motion) {
      ctx.beginPath();
      ctx.arc(c.x, c.y, r + pulse * 16, 0, Math.PI * 2);
      ctx.strokeStyle = sevColor;
      ctx.globalAlpha = 1 - pulse;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.beginPath();
    ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(8,12,20,0.88)';
    ctx.fill();
    ctx.lineWidth = 2.2;
    ctx.strokeStyle = sevColor;
    ctx.stroke();
    ctx.translate(c.x, c.y);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    switch (i.kind) {
      case 'bin_fire': {
        for (let k = 0; k < 3; k++) {
          const fl = 1 + 0.25 * Math.sin(t * 8 + k * 2) * this.motion;
          const ox = (k - 1) * r * 0.32;
          const h = r * (k === 1 ? 0.95 : 0.65) * fl;
          ctx.fillStyle = k === 1 ? '#ffb020' : '#ff5a1f';
          ctx.beginPath();
          ctx.moveTo(ox, r * 0.5);
          ctx.quadraticCurveTo(ox - r * 0.34, r * 0.1, ox, r * 0.5 - h);
          ctx.quadraticCurveTo(ox + r * 0.34, r * 0.1, ox, r * 0.5);
          ctx.fill();
        }
        break;
      }
      case 'vandalism': {
        ctx.strokeStyle = '#a5f3fc';
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        for (let k = 0; k < 6; k++) {
          const a = (k * Math.PI) / 3 + 0.3;
          ctx.moveTo(0, 0);
          ctx.lineTo(Math.cos(a) * r * 0.72, Math.sin(a) * r * 0.72);
        }
        ctx.stroke();
        break;
      }
      case 'projectiles': {
        ctx.fillStyle = '#fca5a5';
        for (let k = 0; k < 3; k++) {
          const p = (t * 0.9 + k / 3) % 1;
          ctx.beginPath();
          ctx.arc(-r * 0.6 + p * r * 1.2, r * 0.35 - Math.sin(p * Math.PI) * r * 0.8, 1.9, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      }
      case 'casualty': {
        ctx.fillStyle = '#ef4444';
        const s = r * 0.52;
        ctx.fillRect(-s * 0.3, -s, s * 0.6, s * 2);
        ctx.fillRect(-s, -s * 0.3, s * 2, s * 0.6);
        break;
      }
    }
    ctx.restore();
    this.targets.push({ ref: { type: 'incident', id: i.id }, x: c.x, y: c.y, r: r + 4, z: 3 });
    if (lod.labels || selected || this.hoverId === i.id) {
      this.pill(i.label, c.x, c.y - r - 12, { size: 10, bg: COLORS.pill, border: sevColor });
    }
    if (selected) this.ring(c, r + 8, COLORS.accent);
  }

  private drawSelection(snap: RenderSnapshot, px: (m: Vec2) => Vec2, ppm: number, t: number): void {
    const sel = snap.selection;
    if (!sel) return;
    const pos = this.entityPos(snap, sel);
    if (!pos) return;
    const c = px(pos);
    const r = (sel.type === 'group' ? 0 : 0) + 28 + Math.sin(t * 3) * 1.5 * this.motion;
    if (sel.type === 'unit' || sel.type === 'vehicle') this.ring(c, r, COLORS.accent, t);
    void ppm;
  }

  private entityPos(snap: RenderSnapshot, ref: EntityRef): Vec2 | null {
    switch (ref.type) {
      case 'unit':
        return snap.units.find((u) => u.id === ref.id)?.pos ?? null;
      case 'vehicle':
        return snap.vehicles.find((v) => v.id === ref.id)?.pos ?? null;
      case 'group':
        return snap.groups.find((g) => g.id === ref.id)?.pos ?? null;
      case 'incident':
        return snap.incidents.find((i) => i.id === ref.id)?.pos ?? null;
    }
  }

  // -- primitives ---------------------------------------------------------

  private ring(c: Vec2, r: number, color: string, t = 0): void {
    const { ctx } = this;
    ctx.save();
    ctx.beginPath();
    ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
    ctx.setLineDash([7, 5]);
    ctx.lineDashOffset = -t * 18 * this.motion;
    ctx.lineWidth = 2.2;
    ctx.strokeStyle = color;
    ctx.stroke();
    ctx.restore();
  }

  private pill(
    text: string,
    x: number,
    y: number,
    o: { size: number; bg: string; border: string; bold?: boolean; align?: 'center' | 'left' },
  ): void {
    const { ctx } = this;
    ctx.save();
    ctx.font = `${o.bold ? 700 : 600} ${o.size}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    const w = ctx.measureText(text).width + 10;
    const h = o.size + 7;
    const left = o.align === 'left' ? x : x - w / 2;
    ctx.fillStyle = o.bg;
    roundRect(ctx, left, y - h / 2, w, h, h / 2);
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
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
