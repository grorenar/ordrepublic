import { SpriteAtlas, type AtlasContext, type CanvasFactory, defaultCanvasFactory } from './atlas';
import { PERSON_ACCESSORIES, PERSON_COLORS, type ManifestIndex } from './manifest';
import type { LodTier, SpriteDef, SpriteProvider, SpriteQuery, SpriteRegion } from './types';

/**
 * Fonction de dessin d'un sprite. Repère en MÈTRES, origine au point d'ancrage, +x = avant du sprite, +y = côté droit
 * (écran : vers le bas). Le fournisseur applique l'échelle et la rotation d'orientation avant l'appel.
 */
export type SpriteDrawer = (ctx: AtlasContext, def: SpriteDef, variant: number, frame: number, tier: LodTier) => void;

const OUTLINE = 'rgba(8,12,20,0.78)';

const FORCE_COLORS: Record<string, { fill: string; edge: string }> = {
  crs: { fill: '#1d4ed8', edge: '#bfdbfe' },
  pn: { fill: '#38bdf8', edge: '#e0f2fe' },
  gm: { fill: '#312e81', edge: '#c7d2fe' },
  us: { fill: '#374151', edge: '#d1d5db' },
};

const VEHICLE_COLORS: Record<string, { body: string; stripe: string }> = {
  fourgon_police: { body: '#1e3a8a', stripe: '#93c5fd' },
  fourgon_crs: { body: '#1e40af', stripe: '#bfdbfe' },
  voiture_police: { body: '#f1f5f9', stripe: '#1d4ed8' },
  ambulance: { body: '#ffffff', stripe: '#ef4444' },
  camion_pompiers: { body: '#dc2626', stripe: '#fde68a' },
  vehicule_secours_leger: { body: '#fde047', stripe: '#dc2626' },
  vehicule_gendarmerie: { body: '#1e293b', stripe: '#60a5fa' },
  voiture_banalisee: { body: '#64748b', stripe: '#cbd5e1' },
  moto_police: { body: '#0f172a', stripe: '#38bdf8' },
  camion_a_eau: { body: '#334155', stripe: '#38bdf8' },
};

function rrect(ctx: AtlasContext, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

function ellipse(ctx: AtlasContext, x: number, y: number, rx: number, ry: number): void {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
}

/** Silhouette zénithale : épaules (ellipse) + tête (cercle), contour sombre. */
function shouldersAndHead(ctx: AtlasContext, body: string, head: string, frame: number, lw: number, tier: LodTier): void {
  const swing = frame === 1 ? 0.045 : frame === 2 ? -0.045 : 0;
  if (tier >= 3) {
    // bras : petits ovales qui oscillent à la marche
    ctx.fillStyle = body;
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = lw;
    ellipse(ctx, swing, -0.3, 0.09, 0.05);
    ctx.fill();
    ctx.stroke();
    ellipse(ctx, -swing, 0.3, 0.09, 0.05);
    ctx.fill();
    ctx.stroke();
  }
  ctx.fillStyle = body;
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = lw;
  ellipse(ctx, -0.02, 0, 0.15, 0.27);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = head;
  ellipse(ctx, 0.03, 0, 0.12, 0.12);
  ctx.fill();
  ctx.stroke();
}

const drawPerson: SpriteDrawer = (ctx, _def, variant, frame, tier) => {
  const color = PERSON_COLORS[variant % PERSON_COLORS.length] as string;
  const acc = tier >= 3 ? Math.floor(variant / PERSON_COLORS.length) % PERSON_ACCESSORIES : 0;
  const lw = 0.035;
  if (acc === 3) {
    ctx.fillStyle = '#3b4252';
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = lw;
    rrect(ctx, -0.27, -0.14, 0.2, 0.28, 0.05);
    ctx.fill();
    ctx.stroke();
  }
  if (acc === 4) {
    // drapeau : hampe vers l'arrière-gauche + toile
    ctx.strokeStyle = '#5b4636';
    ctx.lineWidth = 0.03;
    ctx.beginPath();
    ctx.moveTo(0, -0.3);
    ctx.lineTo(-0.1, -0.78);
    ctx.stroke();
    ctx.fillStyle = '#d9382e';
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.moveTo(-0.1, -0.78);
    ctx.lineTo(0.3, -0.7);
    ctx.lineTo(0.28, -0.52);
    ctx.lineTo(-0.06, -0.58);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  shouldersAndHead(ctx, color, acc === 2 ? '#2b2f3a' : '#4a3a30', frame, lw, tier);
  if (acc === 1) {
    // casquette : visière vers l'avant
    ctx.fillStyle = '#2b3a67';
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = lw;
    rrect(ctx, 0.09, -0.08, 0.1, 0.16, 0.04);
    ctx.fill();
    ctx.stroke();
  }
  if (acc === 2) {
    // capuche : demi-cercle sombre autour de la tête
    ctx.fillStyle = '#2b2f3a';
    ctx.beginPath();
    ctx.ellipse(-0.02, 0, 0.17, 0.17, 0, Math.PI * 0.6, Math.PI * 1.4, false);
    ctx.fill();
  }
  if (acc === 5) {
    // pancarte tenue au-dessus de la tête
    ctx.fillStyle = '#f8fafc';
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = lw;
    rrect(ctx, -0.08, -0.34, 0.16, 0.68, 0.02);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = '#d9382e';
    ctx.lineWidth = 0.03;
    ctx.beginPath();
    ctx.moveTo(-0.02, -0.22);
    ctx.lineTo(-0.02, 0.22);
    ctx.stroke();
  }
};

const drawForce: SpriteDrawer = (ctx, def, _variant, frame, tier) => {
  const [, code, eq] = def.id.split('.') as [string, string, string];
  const col = FORCE_COLORS[code] ?? FORCE_COLORS.crs!;
  const lw = 0.04;
  shouldersAndHead(ctx, col.fill, '#0f172a', frame, lw, tier);
  // casque (toujours pour les forces) : calotte sombre cerclée de la couleur de l'unité
  ctx.fillStyle = '#0f172a';
  ctx.strokeStyle = col.edge;
  ctx.lineWidth = lw;
  ellipse(ctx, 0.03, 0, 0.14, 0.14);
  ctx.fill();
  ctx.stroke();
  if (eq === 'shield') {
    ctx.fillStyle = col.fill;
    ctx.strokeStyle = col.edge;
    ctx.lineWidth = 0.05;
    rrect(ctx, 0.18, -0.34, 0.24, 0.68, 0.1);
    ctx.fill();
    ctx.stroke();
    if (tier >= 3) {
      ctx.strokeStyle = col.edge;
      ctx.lineWidth = 0.025;
      ctx.beginPath();
      ctx.moveTo(0.3, -0.2);
      ctx.lineTo(0.3, 0.2);
      ctx.stroke();
    }
  } else if (tier >= 2) {
    // sans bouclier : matraquette tenue en avant
    ctx.strokeStyle = '#111827';
    ctx.lineWidth = 0.05;
    ctx.beginPath();
    ctx.moveTo(0.1, 0.27);
    ctx.lineTo(0.3, 0.2);
    ctx.stroke();
  }
};

const drawRescue: SpriteDrawer = (ctx, def, _v, frame, tier) => {
  const body = def.id.endsWith('firefighter') ? '#c2410c' : def.id.endsWith('medical_team') ? '#ffffff' : '#ef4444';
  shouldersAndHead(ctx, body, def.id.endsWith('firefighter') ? '#fde047' : '#f8fafc', frame, 0.04, tier);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 0.05;
  ctx.beginPath();
  ctx.moveTo(-0.12, -0.12);
  ctx.lineTo(-0.12, 0.12);
  ctx.moveTo(-0.2, 0);
  ctx.lineTo(-0.04, 0);
  ctx.stroke();
};

const drawVehicle: SpriteDrawer = (ctx, def) => {
  const kind = def.id.slice('vehicle.'.length);
  const col = VEHICLE_COLORS[kind] ?? { body: '#64748b', stripe: '#e2e8f0' };
  const L = def.wM;
  const W = def.hM;
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  rrect(ctx, -L / 2 + 0.12, -W / 2 + 0.2, L, W, Math.min(0.5, W * 0.3));
  ctx.fill();
  ctx.fillStyle = col.body;
  ctx.strokeStyle = 'rgba(0,0,0,0.65)';
  ctx.lineWidth = 0.1;
  rrect(ctx, -L / 2, -W / 2, L, W, Math.min(0.5, W * 0.3));
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = col.stripe;
  ctx.fillRect(-L / 2 + 0.25, -W * 0.08, L - 0.5, W * 0.16);
  ctx.fillStyle = 'rgba(15,23,42,0.75)';
  ctx.fillRect(L * 0.22, -W * 0.36, L * 0.14, W * 0.72);
};

function drawDecor(ctx: AtlasContext, def: SpriteDef, _v: number, frame: number): void {
  const kind = def.id.slice('decor.'.length);
  const w = def.wM;
  const h = def.hM;
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 0.06;
  const fire = (r: number) => {
    // flammes : 2 images alternées (le rendu fournit l'animation, le moteur seulement l'état)
    ctx.fillStyle = frame === 1 ? '#fb923c' : '#f97316';
    ellipse(ctx, 0, 0, r, r * 0.85);
    ctx.fill();
    ctx.fillStyle = frame === 1 ? '#fde047' : '#facc15';
    ellipse(ctx, 0, 0, r * 0.55, r * 0.45);
    ctx.fill();
  };
  switch (kind) {
    case 'bin':
    case 'bin_fire':
      ctx.fillStyle = '#4b5563';
      ellipse(ctx, 0, 0, w / 2, h / 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#1f2937';
      ellipse(ctx, 0, 0, w * 0.3, h * 0.3);
      ctx.fill();
      if (kind === 'bin_fire') fire(w * 0.42);
      break;
    case 'bench':
      ctx.fillStyle = '#92400e';
      rrect(ctx, -w / 2, -h / 2, w, h, 0.08);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#78350f';
      ctx.fillRect(-w / 2 + 0.1, -h / 2 + 0.06, w - 0.2, 0.1);
      break;
    case 'barrier':
      ctx.fillStyle = '#e5e7eb';
      rrect(ctx, -w / 2, -h / 2, w, h, 0.06);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#ef4444';
      for (let i = 0; i < 4; i++) ctx.fillRect(-w / 2 + 0.15 + i * (w - 0.3) / 4, -h / 2 + 0.05, (w - 0.3) / 8, h - 0.1);
      break;
    case 'cone':
      ctx.fillStyle = '#f97316';
      ellipse(ctx, 0, 0, w / 2, h / 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ellipse(ctx, 0, 0, w * 0.22, h * 0.22);
      ctx.fill();
      break;
    case 'container':
    case 'container_fire':
      ctx.fillStyle = kind === 'container' ? '#15803d' : '#14532d';
      rrect(ctx, -w / 2, -h / 2, w, h, 0.1);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath();
      for (let i = 1; i < 5; i++) {
        ctx.moveTo(-w / 2 + (i * w) / 5, -h / 2 + 0.1);
        ctx.lineTo(-w / 2 + (i * w) / 5, h / 2 - 0.1);
      }
      ctx.stroke();
      if (kind === 'container_fire') fire(Math.min(w, h) * 0.38);
      break;
    case 'debris':
    case 'rubble': {
      const n = kind === 'rubble' ? 9 : 5;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + 0.7;
        const r = (i % 2 ? 0.28 : 0.12) * Math.min(w, h) * 2;
        ctx.fillStyle = i % 3 === 0 ? '#9ca3af' : i % 3 === 1 ? '#78716c' : '#a8a29e';
        ellipse(ctx, Math.cos(a) * r, Math.sin(a) * r * 0.8, w * 0.13, h * 0.12);
        ctx.fill();
        ctx.stroke();
      }
      break;
    }
    case 'shopfront':
    case 'shopfront_broken':
      ctx.fillStyle = '#e0f2fe';
      ctx.globalAlpha = 0.75;
      rrect(ctx, -w / 2, -h / 2, w, h, 0.06);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.stroke();
      if (kind === 'shopfront_broken') {
        ctx.strokeStyle = '#334155';
        ctx.lineWidth = 0.05;
        ctx.beginPath();
        ctx.moveTo(-w * 0.2, -h / 2);
        ctx.lineTo(0, 0);
        ctx.lineTo(-w * 0.05, h / 2);
        ctx.moveTo(0, 0);
        ctx.lineTo(w * 0.22, -h / 2);
        ctx.moveTo(0, 0);
        ctx.lineTo(w * 0.25, h / 2);
        ctx.stroke();
      }
      break;
    default: // bus_shelter(_broken)
      ctx.fillStyle = '#cbd5e1';
      rrect(ctx, -w / 2, -h / 2, w, h, 0.1);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = 'rgba(147,197,253,0.6)';
      ctx.fillRect(-w / 2 + 0.15, -h / 2 + 0.15, w - 0.3, h - 0.3);
      if (kind === 'bus_shelter_broken') {
        ctx.strokeStyle = '#334155';
        ctx.lineWidth = 0.05;
        ctx.beginPath();
        ctx.moveTo(-w * 0.1, -h / 2 + 0.1);
        ctx.lineTo(w * 0.05, h / 2 - 0.1);
        ctx.moveTo(w * 0.15, -h / 2 + 0.1);
        ctx.lineTo(0, 0);
        ctx.stroke();
      }
  }
}

/** Pas d'échelle de l'atlas : quart d'octave (l'écart de taille avant mise à l'échelle reste < 10 %). */
const bucketOf = (ppm: number): number => Math.round(Math.log2(Math.max(0.05, ppm)) * 4);

/**
 * Fournisseur procédural (provisoire) : dessine chaque sprite par code dans un atlas hors écran, par échelle,
 * orientation, variante et image d'animation, puis le sert depuis le cache.
 */
export class ProceduralSpriteProvider implements SpriteProvider {
  readonly name = 'procedural';
  private readonly atlas: SpriteAtlas;
  private readonly cache = new Map<string, SpriteRegion | null>();
  private readonly drawers = new Map<string, SpriteDrawer>();
  private readonly pending = new Map<string, () => void>();
  private dpr = 1;
  drawCalls = 0;

  constructor(
    private readonly index: ManifestIndex,
    createCanvas: CanvasFactory = defaultCanvasFactory,
  ) {
    this.atlas = new SpriteAtlas(createCanvas);
  }

  /** Remplace le dessin d'un sprite précis (ou d'une famille : `person`, `force.`, `vehicle.`, `decor.`). */
  register(idOrPrefix: string, drawer: SpriteDrawer): void {
    this.drawers.set(idOrPrefix, drawer);
    this.cache.clear();
  }

  setDevicePixelRatio(dpr: number): void {
    const d = Math.max(1, Math.min(3, dpr));
    if (d !== this.dpr) {
      this.dpr = d;
      this.cache.clear();
      this.atlas.clear();
    }
  }

  get pageCount(): number {
    return this.atlas.pageCount;
  }

  get cached(): number {
    return this.cache.size;
  }

  has(id: string): boolean {
    return this.index.has(id);
  }

  get pendingCount(): number {
    return this.pending.size;
  }

  flush(maxRenders = 160): number {
    let n = 0;
    for (const [k, job] of this.pending) {
      if (n >= maxRenders) break;
      this.pending.delete(k);
      if (!this.cache.has(k)) {
        job();
        n++;
      }
    }
    return n;
  }

  private drawerFor(def: SpriteDef): SpriteDrawer {
    const exact = this.drawers.get(def.id);
    if (exact) return exact;
    for (const [k, d] of this.drawers) if (k.endsWith('.') && def.id.startsWith(k)) return d;
    switch (def.family) {
      case 'person':
        return drawPerson;
      case 'force':
        return drawForce;
      case 'rescue':
        return drawRescue;
      case 'vehicle':
        return drawVehicle;
      default:
        return drawDecor;
    }
  }

  get(q: SpriteQuery): SpriteRegion | null {
    const def = this.index.get(q.id);
    if (!def) return null;
    // taille minimale lisible à l'écran
    const wanted = Math.max(q.ppm, def.minPx / Math.max(def.wM, def.hM));
    const bucket = bucketOf(wanted);
    // les accessoires n'existent qu'au niveau T3 ; hors T3 on replie sur la couleur seule
    const variant = Math.max(0, Math.min(def.variants - 1, q.tier >= 3 ? q.variant : q.variant % PERSON_COLORS.length));
    const tier: LodTier = q.tier >= 3 ? 3 : q.tier >= 2 ? 2 : 1;
    const orient = def.orientations === 1 ? 0 : ((q.orientation % def.orientations) + def.orientations) % def.orientations;
    const frames = Math.max(1, def.animations.walk ?? def.animations.burn ?? 1);
    const frame = frames === 1 ? 0 : ((q.frame % frames) + frames) % frames;
    const key = `${def.id}|${variant}|${orient}|${frame}|${bucket}|${tier}`;
    let region = this.cache.get(key);
    if (region === undefined) {
      if (q.deferred) {
        if (!this.pending.has(key)) this.pending.set(key, () => this.cache.set(key, this.render(def, variant, orient, frame, tier, bucket)));
        return null;
      }
      region = this.render(def, variant, orient, frame, tier, bucket);
      this.cache.set(key, region);
    }
    if (!region) return null;
    // mise à l'échelle exacte (le bucket est quantifié) vers la taille voulue
    const k = wanted / (2 ** (bucket / 4));
    return k === 1 ? region : { ...region, w: region.w * k, h: region.h * k, ox: region.ox * k, oy: region.oy * k };
  }

  private render(def: SpriteDef, variant: number, orient: number, frame: number, tier: LodTier, bucket: number): SpriteRegion | null {
    const ppmB = 2 ** (bucket / 4);
    const scale = ppmB * this.dpr;
    // boîte du sprite : orienté → carré circonscrit centré (toutes rotations), sinon boîte autour de l'ancrage
    const oriented = def.orientations > 1;
    const side = Math.hypot(def.wM, def.hM);
    const wM = oriented ? side : def.wM;
    const hM = oriented ? side : def.hM;
    const ax = oriented ? 0.5 : def.anchor.x;
    const ay = oriented ? 0.5 : def.anchor.y;
    const sw = Math.max(2, Math.ceil(wM * scale));
    const sh = Math.max(2, Math.ceil(hM * scale));
    let slot = this.atlas.alloc(sw, sh);
    if (!slot) {
      // planche saturée : tout est redessiné à la demande
      this.atlas.clear();
      this.cache.clear();
      slot = this.atlas.alloc(sw, sh);
      if (!slot) return null;
    }
    const { ctx } = slot;
    ctx.save();
    ctx.beginPath();
    ctx.rect(slot.x, slot.y, sw, sh);
    ctx.clip();
    ctx.translate(slot.x + ax * sw, slot.y + ay * sh);
    ctx.scale(scale, scale);
    if (oriented) ctx.rotate((-orient * Math.PI * 2) / def.orientations);
    // le dessin est exprimé autour du centre de la boîte réelle (non orientée)
    if (!oriented) ctx.translate((0.5 - ax) * def.wM, (0.5 - ay) * def.hM);
    this.drawerFor(def)(ctx, def, variant, frame, tier);
    ctx.restore();
    this.drawCalls++;
    return { image: slot.canvas, sx: slot.x, sy: slot.y, sw, sh, w: wM * ppmB, h: hM * ppmB, ox: -ax * wM * ppmB, oy: -ay * hM * ppmB };
  }
}
