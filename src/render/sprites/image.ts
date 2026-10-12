import type { ManifestIndex } from './manifest';
import type { SpriteProvider, SpriteQuery, SpriteRegion } from './types';

/**
 * Fournisseur d'images (futures planches graphiques). Un sprite dont `def.image` est renseigné est lu depuis
 * `<baseUrl>/<file>` : une grille de cellules `cellPx × cellPx` dont les LIGNES sont les orientations et les COLONNES
 * `variante × images d'animation + image`. Tant que l'image n'est pas chargée, `get` renvoie `null` (le mélange retombe
 * alors sur le fournisseur procédural) : le jeu ne bloque jamais sur une ressource manquante.
 */
export type ImageLoader = (url: string) => { image: CanvasImageSource; ready: () => boolean; failed: () => boolean };

export const browserImageLoader: ImageLoader = (url) => {
  const img = new Image();
  let state: 'loading' | 'ready' | 'failed' = 'loading';
  img.onload = () => (state = 'ready');
  img.onerror = () => (state = 'failed');
  img.src = url;
  return { image: img, ready: () => state === 'ready', failed: () => state === 'failed' };
};

export class ImageSpriteProvider implements SpriteProvider {
  readonly name = 'images';
  private readonly sheets = new Map<string, ReturnType<ImageLoader>>();

  constructor(
    private readonly index: ManifestIndex,
    private readonly baseUrl: string,
    private readonly loader: ImageLoader = browserImageLoader,
  ) {}

  has(id: string): boolean {
    return !!this.index.get(id)?.image;
  }

  /** Ressources demandées mais en échec (pour le diagnostic). */
  failedFiles(): string[] {
    return [...this.sheets].filter(([, s]) => s.failed()).map(([f]) => f);
  }

  get(q: SpriteQuery): SpriteRegion | null {
    const def = this.index.get(q.id);
    if (!def?.image) return null;
    let sheet = this.sheets.get(def.image.file);
    if (!sheet) {
      sheet = this.loader(`${this.baseUrl.replace(/\/$/, '')}/${def.image.file}`);
      this.sheets.set(def.image.file, sheet);
    }
    if (!sheet.ready()) return null;
    const cell = def.image.cellPx;
    const frames = Math.max(1, def.animations.walk ?? def.animations.burn ?? 1);
    const frame = frames === 1 ? 0 : ((q.frame % frames) + frames) % frames;
    const variant = Math.max(0, Math.min(def.variants - 1, q.variant));
    const orient = def.orientations === 1 ? 0 : ((q.orientation % def.orientations) + def.orientations) % def.orientations;
    const wanted = Math.max(q.ppm, def.minPx / Math.max(def.wM, def.hM));
    const oriented = def.orientations > 1;
    const wM = oriented ? Math.hypot(def.wM, def.hM) : def.wM;
    const hM = oriented ? Math.hypot(def.wM, def.hM) : def.hM;
    const ax = oriented ? 0.5 : def.anchor.x;
    const ay = oriented ? 0.5 : def.anchor.y;
    return { image: sheet.image, sx: (variant * frames + frame) * cell, sy: orient * cell, sw: cell, sh: cell, w: wM * wanted, h: hM * wanted, ox: -ax * wM * wanted, oy: -ay * hM * wanted };
  }
}

/** Mélange sprite par sprite : le premier fournisseur qui possède l'identifiant ET renvoie une région l'emporte. */
export class MixedSpriteProvider implements SpriteProvider {
  readonly name: string;
  constructor(private readonly providers: SpriteProvider[]) {
    this.name = `mixed(${providers.map((p) => p.name).join('>')})`;
  }
  has(id: string): boolean {
    return this.providers.some((p) => p.has(id));
  }
  setDevicePixelRatio(dpr: number): void {
    for (const p of this.providers) p.setDevicePixelRatio?.(dpr);
  }
  flush(maxRenders?: number): number {
    let n = 0;
    for (const p of this.providers) n += p.flush?.(maxRenders) ?? 0;
    return n;
  }
  get(q: SpriteQuery): SpriteRegion | null {
    for (const p of this.providers) {
      if (!p.has(q.id)) continue;
      const r = p.get(q);
      if (r) return r;
    }
    return null;
  }
}
