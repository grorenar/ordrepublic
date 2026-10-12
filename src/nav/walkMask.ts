import type { Obstacle, StreetGraph } from './graph';

/**
 * Masque de marche : grille d'occupation rasterisée des emprises de bâtiments (1 = interdit).
 * Sert à rejeter toute position individuelle dans un bâtiment (O(1) par test) et à échantillonner
 * les créneaux des rassemblements statiques. Résolution paramétrable (m par cellule).
 */
export class WalkMask {
  readonly cols: number;
  readonly rows: number;
  private readonly data: Uint8Array;

  constructor(
    readonly minX: number,
    readonly minY: number,
    readonly maxX: number,
    readonly maxY: number,
    readonly res: number,
  ) {
    this.cols = Math.max(1, Math.ceil((maxX - minX) / res));
    this.rows = Math.max(1, Math.ceil((maxY - minY) / res));
    this.data = new Uint8Array(this.cols * this.rows);
  }

  static fromGraph(g: StreetGraph, res = 1, margin = 100): WalkMask {
    let minX = g.bounds.minX - margin;
    let minY = g.bounds.minY - margin;
    let maxX = g.bounds.maxX + margin;
    let maxY = g.bounds.maxY + margin;
    for (const o of g.obstacles) {
      for (let i = 0; i < o.ring.length; i += 2) {
        minX = Math.min(minX, o.ring[i]!);
        maxX = Math.max(maxX, o.ring[i]!);
        minY = Math.min(minY, o.ring[i + 1]!);
        maxY = Math.max(maxY, o.ring[i + 1]!);
      }
    }
    const m = new WalkMask(minX, minY, maxX, maxY, res);
    for (const o of g.obstacles) m.rasterize(o);
    return m;
  }

  /** Rasterise un polygone (remplissage par lignes de balayage, règle pair/impair) sur les cellules dont le centre est dedans. */
  rasterize(o: Obstacle): void {
    const n = o.ring.length / 2;
    if (n < 3) return;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (let i = 0; i < n; i++) {
      y0 = Math.min(y0, o.ring[2 * i + 1]!);
      y1 = Math.max(y1, o.ring[2 * i + 1]!);
    }
    const r0 = Math.max(0, Math.floor((y0 - this.minY) / this.res));
    const r1 = Math.min(this.rows - 1, Math.floor((y1 - this.minY) / this.res));
    const xs: number[] = [];
    for (let r = r0; r <= r1; r++) {
      const y = this.minY + (r + 0.5) * this.res;
      xs.length = 0;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const ay = o.ring[2 * i + 1]!;
        const by = o.ring[2 * j + 1]!;
        if ((ay <= y && by > y) || (by <= y && ay > y)) {
          const ax = o.ring[2 * i]!;
          const bx = o.ring[2 * j]!;
          xs.push(ax + ((y - ay) / (by - ay)) * (bx - ax));
        }
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const c0 = Math.max(0, Math.ceil((xs[k]! - this.minX) / this.res - 0.5));
        const c1 = Math.min(this.cols - 1, Math.floor((xs[k + 1]! - this.minX) / this.res - 0.5));
        for (let c = c0; c <= c1; c++) this.data[r * this.cols + c] = 1;
      }
    }
  }

  /** Vrai si le point est dans un bâtiment (hors masque : libre). */
  isBlocked(x: number, y: number): boolean {
    const c = Math.floor((x - this.minX) / this.res);
    const r = Math.floor((y - this.minY) / this.res);
    if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return false;
    return this.data[r * this.cols + c] === 1;
  }

  get bytes(): number {
    return this.data.byteLength;
  }

  blockedCells(): number {
    let n = 0;
    for (let i = 0; i < this.data.length; i++) n += this.data[i]!;
    return n;
  }
}
