import { EdgeFlag, type StreetGraph } from './graph';

/**
 * Masque de marche : grille d'occupation rasterisée des emprises de bâtiments (1 = interdit).
 * Sert à rejeter toute position individuelle dans un bâtiment (O(1) par test) et à échantillonner
 * les créneaux des rassemblements statiques. Résolution paramétrable (m par cellule).
 */
export class WalkMask {
  readonly cols: number;
  readonly rows: number;
  private readonly data: Uint8Array;
  /** Espaces ouverts cartographiés (places, zones piétonnes, parcs) : une foule peut s'y étaler hors de la rue. */
  private readonly open: Uint8Array;
  /** Surface praticable : couloirs des rues (façade à façade) ∪ espaces ouverts, hors bâtiments. Vide tant que `buildWalkable` n'a pas été appelé. */
  private readonly walk: Uint8Array;
  private walkReady = false;

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
    this.open = new Uint8Array(this.cols * this.rows);
    this.walk = new Uint8Array(this.cols * this.rows);
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
    for (const sp of g.spaces) m.rasterize({ ring: sp.ring, source: sp.source }, m.open, 1);
    // les voies en tunnel / passage couvert / pont ne sont pas bloquées par les bâtiments cartographiés au-dessus
    for (let e = 0; e < g.edgeCount; e++) {
      const covered = ((g.edgeFlags[e] as number) & (EdgeFlag.Tunnel | EdgeFlag.Bridge)) !== 0;
      // la rue prime sur un bâtiment mal superposé : l'axe de toute voie reste praticable (bande de ±1 à 3 m) ; sous un tunnel ou un pont, toute la largeur
      const half = covered ? Math.max(1.5, (g.edgeWidth[e] as number) / 2 + 0.5) : Math.max(1, Math.min(3, (g.edgeWidth[e] as number) / 2));
      for (let i = (g.shapeStart[e] as number) + 1; i < (g.shapeStart[e + 1] as number); i++) {
        m.clearSegment(g.shape[2 * (i - 1)]!, g.shape[2 * (i - 1) + 1]!, g.shape[2 * i]!, g.shape[2 * i + 1]!, half);
      }
    }
    return m;
  }

  /** Rasterise un polygone (remplissage par lignes de balayage, règle pair/impair) sur les cellules dont le centre est dedans. */
  rasterize(o: { ring: Float32Array; source?: string }, target: Uint8Array = this.data, value = 1): void {
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
        for (let c = c0; c <= c1; c++) target[r * this.cols + c] = value;
      }
    }
  }

  /**
   * Construit la surface praticable : pour chaque rue, le couloir mesuré de part et d'autre de l'axe (`left`/`right`, orientation a→b),
   * plus les espaces ouverts cartographiés. Un rassemblement ne déborde pas hors de cette surface (fleuve, parking, pelouse non cartographiée).
   */
  buildWalkable(g: StreetGraph, left: Float32Array, right: Float32Array): void {
    this.walk.fill(0);
    for (let e = 0; e < g.edgeCount; e++) {
      const l = left[e] as number;
      const r = right[e] as number;
      const a = g.shapeStart[e] as number;
      const b = g.shapeStart[e + 1] as number;
      for (let i = a + 1; i < b; i++) {
        const x0 = g.shape[2 * (i - 1)] as number;
        const y0 = g.shape[2 * (i - 1) + 1] as number;
        const x1 = g.shape[2 * i] as number;
        const y1 = g.shape[2 * i + 1] as number;
        const len = Math.hypot(x1 - x0, y1 - y0);
        if (len < 1e-6) continue;
        const nx = -(y1 - y0) / len;
        const ny = (x1 - x0) / len;
        this.rasterize({ ring: new Float32Array([x0 + nx * l, y0 + ny * l, x1 + nx * l, y1 + ny * l, x1 - nx * r, y1 - ny * r, x0 - nx * r, y0 - ny * r]) }, this.walk, 1);
        this.fillDisk(x1, y1, Math.max(l, r));
        if (i === a + 1) this.fillDisk(x0, y0, Math.max(l, r));
      }
    }
    // cellules de rue seules (avant d'ajouter les espaces ouverts) : sert à combler les petits écarts place ↔ rue
    const street = Uint8Array.from(this.walk);
    for (const sp of g.spaces) this.rasterize({ ring: sp.ring }, this.walk, 1);
    this.bridgeGaps(street, WalkMask.GAP_BRIDGE_M);
    this.walkReady = true;
  }

  /** Écart maximal (m) comblé entre une rue et un espace ouvert voisin (trottoir, bordure, rangée de potelets) : sans cela une place cartographiée à quelques mètres de la chaussée serait inaccessible. */
  static readonly GAP_BRIDGE_M = 6;

  /** Rend praticables les cellules libres (hors bâtiment) situées à la fois près d'un espace ouvert et près d'une rue. */
  private bridgeGaps(street: Uint8Array, bridgeM: number): void {
    const k = Math.max(1, Math.round(bridgeM / this.res));
    const near = (src: Uint8Array): Uint8Array => {
      const { cols, rows } = this;
      const tmp = new Uint8Array(cols * rows);
      const out = new Uint8Array(cols * rows);
      for (let r = 0; r < rows; r++) {
        let last = -1e9;
        const row = r * cols;
        // passe avant : dernière cellule occupée à gauche
        for (let c = 0; c < cols; c++) {
          if (src[row + c]) last = c;
          if (c - last <= k) tmp[row + c] = 1;
        }
        last = 1e9;
        for (let c = cols - 1; c >= 0; c--) {
          if (src[row + c]) last = c;
          if (last - c <= k) tmp[row + c] = 1;
        }
      }
      for (let c = 0; c < cols; c++) {
        let last = -1e9;
        for (let r = 0; r < rows; r++) {
          if (tmp[r * cols + c]) last = r;
          if (r - last <= k) out[r * cols + c] = 1;
        }
        last = 1e9;
        for (let r = rows - 1; r >= 0; r--) {
          if (tmp[r * cols + c]) last = r;
          if (last - r <= k) out[r * cols + c] = 1;
        }
      }
      return out;
    };
    let anyOpen = false;
    for (let i = 0; i < this.open.length && !anyOpen; i++) if (this.open[i]) anyOpen = true;
    if (!anyOpen) return;
    const nearOpen = near(this.open);
    const nearStreet = near(street);
    for (let i = 0; i < this.walk.length; i++) if (!this.walk[i] && nearOpen[i] && nearStreet[i] && this.data[i] !== 1) this.walk[i] = 1;
  }

  private fillDisk(x: number, y: number, rad: number): void {
    const c0 = Math.floor((x - rad - this.minX) / this.res);
    const c1 = Math.floor((x + rad - this.minX) / this.res);
    const r0 = Math.floor((y - rad - this.minY) / this.res);
    const r1 = Math.floor((y + rad - this.minY) / this.res);
    for (let r = Math.max(0, r0); r <= Math.min(this.rows - 1, r1); r++) {
      for (let c = Math.max(0, c0); c <= Math.min(this.cols - 1, c1); c++) {
        const cx = this.minX + (c + 0.5) * this.res;
        const cy = this.minY + (r + 0.5) * this.res;
        if (Math.hypot(cx - x, cy - y) <= rad) this.walk[r * this.cols + c] = 1;
      }
    }
  }

  get hasWalkable(): boolean {
    return this.walkReady;
  }

  /** Vrai si le point est sur une surface où une foule peut se tenir (rue, place, parc), hors bâtiment. */
  isWalkable(x: number, y: number): boolean {
    const c = Math.floor((x - this.minX) / this.res);
    const r = Math.floor((y - this.minY) / this.res);
    if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return false;
    const i = r * this.cols + c;
    return this.data[i] !== 1 && (!this.walkReady || this.walk[i] === 1);
  }

  /** Libère les cellules d'un couloir (segment élargi de `half` m) : passage souterrain ou couvert sous un bâtiment. */
  clearSegment(x0: number, y0: number, x1: number, y1: number, half: number): void {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.max(1, Math.ceil(len / (this.res * 0.5)));
    const rad = Math.ceil(half / this.res);
    for (let k = 0; k <= steps; k++) {
      const x = x0 + ((x1 - x0) * k) / steps;
      const y = y0 + ((y1 - y0) * k) / steps;
      const c = Math.floor((x - this.minX) / this.res);
      const r = Math.floor((y - this.minY) / this.res);
      for (let dr = -rad; dr <= rad; dr++) {
        for (let dc = -rad; dc <= rad; dc++) {
          if (Math.hypot(dc, dr) * this.res > half) continue;
          const cc = c + dc;
          const rr = r + dr;
          if (cc >= 0 && rr >= 0 && cc < this.cols && rr < this.rows) this.data[rr * this.cols + cc] = 0;
        }
      }
    }
  }

  /** Vrai si le point est dans un espace ouvert cartographié (place, zone piétonne, parc). */
  isOpen(x: number, y: number): boolean {
    const c = Math.floor((x - this.minX) / this.res);
    const r = Math.floor((y - this.minY) / this.res);
    if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return false;
    return this.open[r * this.cols + c] === 1;
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
