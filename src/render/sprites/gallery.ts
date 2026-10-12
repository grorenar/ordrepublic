import type { ManifestIndex } from './manifest';
import type { LodTier, SpriteProvider } from './types';

export interface GalleryOptions {
  ppm: number;
  tier: LodTier;
  dpr: number;
  /** Teinte de fond (jour ou nuit) pour vérifier la lisibilité. */
  background: string;
}

/** Planche de contrôle : tous les sprites du manifeste (toutes orientations, variantes et images), pour la recette et le remplacement graphique. */
export function drawGallery(ctx: CanvasRenderingContext2D, w: number, h: number, index: ManifestIndex, provider: SpriteProvider, o: GalleryOptions): number {
  ctx.save();
  ctx.fillStyle = o.background;
  ctx.fillRect(0, 0, w, h);
  ctx.font = '11px system-ui, sans-serif';
  ctx.textBaseline = 'top';
  let y = 8;
  let drawn = 0;
  for (const def of index.manifest.sprites) {
    const cell = Math.ceil(Math.hypot(def.wM, def.hM) * o.ppm) + 8;
    ctx.fillStyle = '#cbd5e1';
    ctx.fillText(`${def.id} — ${def.label} (${def.wM}×${def.hM} m, ${def.orientations} orient., sélection ${def.hitRadiusM.toFixed(1)} m)`, 8, y);
    y += 16;
    let x = 8 + cell / 2;
    const items: Array<{ variant: number; orientation: number; frame: number }> = [];
    const frames = Math.max(1, def.animations.walk ?? def.animations.burn ?? 1);
    const variants = def.id === 'person' ? [0, 1, 2, 3, 12, 14, 24, 27, 29] : Array.from({ length: Math.min(def.variants, 1) }, (_, i) => i);
    for (const v of variants) for (let f = 0; f < frames; f++) items.push({ variant: v, orientation: 0, frame: f });
    if (def.orientations > 1) for (let k = 1; k < def.orientations; k++) items.push({ variant: 0, orientation: k, frame: 0 });
    for (const it of items) {
      if (x + cell / 2 > w - 8) {
        x = 8 + cell / 2;
        y += cell;
      }
      const r = provider.get({ id: def.id, variant: it.variant, orientation: it.orientation, frame: it.frame, tier: o.tier, ppm: o.ppm });
      if (r) {
        ctx.drawImage(r.image, r.sx, r.sy, r.sw, r.sh, x + r.ox, y + cell / 2 + r.oy, r.w, r.h);
        drawn++;
      }
      x += cell;
    }
    y += cell + 6;
    if (y > h) break;
  }
  ctx.restore();
  return drawn;
}
