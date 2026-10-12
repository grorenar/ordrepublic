/**
 * Index spatial par grille régulière (tri par comptage) pour retrouver le point le plus proche d'un clic
 * sans parcourir toute la foule : seules les cellules voisines du point sont examinées.
 */
export class PointGrid {
  private cols = 1;
  private rows = 1;
  private minX = 0;
  private minY = 0;
  private cell = 4;
  private start = new Int32Array(2);
  private items = new Int32Array(0);
  private xs: Float32Array = new Float32Array(0);
  private ys: Float32Array = new Float32Array(0);
  /** Nombre de points comparés lors de la dernière requête (diagnostic / tests de complexité). */
  comparisons = 0;
  count = 0;

  /** Construit l'index sur les points [from, to) ; `include` permet d'exclure des points (ex. blocs périmés). */
  build(xs: Float32Array, ys: Float32Array, from: number, to: number, cell = 4, include?: (i: number) => boolean): void {
    this.xs = xs;
    this.ys = ys;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let n = 0;
    for (let i = from; i < to; i++) {
      if (include && !include(i)) continue;
      const x = xs[i] as number;
      const y = ys[i] as number;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      n++;
    }
    this.count = n;
    if (n === 0) {
      this.cols = this.rows = 1;
      this.start = new Int32Array(2);
      this.items = new Int32Array(0);
      return;
    }
    let c = Math.max(0.5, cell);
    while (((maxX - minX) / c + 1) * ((maxY - minY) / c + 1) > 4_000_000) c *= 2; // borne la mémoire
    this.cell = c;
    this.minX = minX;
    this.minY = minY;
    this.cols = Math.floor((maxX - minX) / c) + 1;
    this.rows = Math.floor((maxY - minY) / c) + 1;
    const cells = this.cols * this.rows;
    const counts = new Int32Array(cells + 1);
    const key = (i: number) => Math.floor(((ys[i] as number) - minY) / c) * this.cols + Math.floor(((xs[i] as number) - minX) / c);
    for (let i = from; i < to; i++) if (!include || include(i)) counts[key(i) + 1]!++;
    for (let k = 0; k < cells; k++) counts[k + 1]! += counts[k] as number;
    this.start = counts;
    const fill = new Int32Array(cells);
    this.items = new Int32Array(n);
    for (let i = from; i < to; i++) {
      if (include && !include(i)) continue;
      const k = key(i);
      this.items[(counts[k] as number) + (fill[k] as number)++] = i;
    }
  }

  /** Indice du point le plus proche de (px, py) à moins de `maxR` mètres, ou -1. */
  nearest(px: number, py: number, maxR: number): { index: number; dist: number } {
    this.comparisons = 0;
    if (this.count === 0) return { index: -1, dist: Infinity };
    const c = this.cell;
    const cx0 = Math.floor((px - maxR - this.minX) / c);
    const cx1 = Math.floor((px + maxR - this.minX) / c);
    const cy0 = Math.floor((py - maxR - this.minY) / c);
    const cy1 = Math.floor((py + maxR - this.minY) / c);
    let best = -1;
    let bestD2 = maxR * maxR;
    for (let cy = Math.max(0, cy0); cy <= Math.min(this.rows - 1, cy1); cy++) {
      for (let cx = Math.max(0, cx0); cx <= Math.min(this.cols - 1, cx1); cx++) {
        const k = cy * this.cols + cx;
        for (let j = this.start[k] as number; j < (this.start[k + 1] as number); j++) {
          const i = this.items[j] as number;
          this.comparisons++;
          const dx = (this.xs[i] as number) - px;
          const dy = (this.ys[i] as number) - py;
          const d2 = dx * dx + dy * dy;
          if (d2 <= bestD2) {
            bestD2 = d2;
            best = i;
          }
        }
      }
    }
    return { index: best, dist: best < 0 ? Infinity : Math.sqrt(bestD2) };
  }
}
