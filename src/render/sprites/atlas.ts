/** Atlas de sprites à l'exécution : planches de canvas hors écran, rangées par étagères (packing « shelf »). */
export type AtlasContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
export type AtlasCanvas = HTMLCanvasElement | OffscreenCanvas;
export type CanvasFactory = (w: number, h: number) => AtlasCanvas;

export const defaultCanvasFactory: CanvasFactory = (w, h) => {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
};

export interface AtlasSlot {
  page: number;
  canvas: AtlasCanvas;
  ctx: AtlasContext;
  x: number;
  y: number;
}

interface Page {
  canvas: AtlasCanvas;
  ctx: AtlasContext;
  shelfY: number;
  shelfH: number;
  cursorX: number;
}

export class SpriteAtlas {
  private pages: Page[] = [];
  /** Nombre de remises à zéro dues à la saturation (les sprites sont alors redessinés à la demande). */
  resets = 0;

  constructor(
    private readonly createCanvas: CanvasFactory = defaultCanvasFactory,
    readonly pageSize = 1024,
    readonly maxPages = 6,
    private readonly pad = 1,
  ) {}

  get pageCount(): number {
    return this.pages.length;
  }

  /** Réserve une cellule `w × h` (px) ; `null` si la planche entière est pleine (l'appelant doit alors `clear`). */
  alloc(w: number, h: number): AtlasSlot | null {
    const W = Math.ceil(w) + this.pad * 2;
    const H = Math.ceil(h) + this.pad * 2;
    if (W > this.pageSize || H > this.pageSize) return null;
    for (let p = 0; p < this.pages.length; p++) {
      const s = this.place(p, W, H);
      if (s) return s;
    }
    if (this.pages.length >= this.maxPages) return null;
    const canvas = this.createCanvas(this.pageSize, this.pageSize);
    const ctx = canvas.getContext('2d') as AtlasContext | null;
    if (!ctx) return null;
    this.pages.push({ canvas, ctx, shelfY: 0, shelfH: 0, cursorX: 0 });
    return this.place(this.pages.length - 1, W, H);
  }

  private place(p: number, W: number, H: number): AtlasSlot | null {
    const pg = this.pages[p] as Page;
    if (pg.cursorX + W > this.pageSize) {
      pg.shelfY += pg.shelfH;
      pg.shelfH = 0;
      pg.cursorX = 0;
    }
    if (pg.shelfY + H > this.pageSize) return null;
    const x = pg.cursorX + this.pad;
    const y = pg.shelfY + this.pad;
    pg.cursorX += W;
    pg.shelfH = Math.max(pg.shelfH, H);
    return { page: p, canvas: pg.canvas, ctx: pg.ctx, x, y };
  }

  clear(): void {
    for (const pg of this.pages) {
      pg.ctx.clearRect(0, 0, this.pageSize, this.pageSize);
      pg.shelfY = 0;
      pg.shelfH = 0;
      pg.cursorX = 0;
    }
    this.resets++;
  }
}
