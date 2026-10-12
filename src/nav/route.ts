import type { Vec2 } from '../geo/mercator';

/** `emergency` : véhicule avec avertisseurs — mêmes voies que `vehicle` mais sens interdits permis et limites de vitesse non respectées. */
export type NavMode = 'crowd' | 'foot' | 'vehicle' | 'emergency';

/**
 * Itinéraire : polyligne continue + abscisses curvilignes. Les arêtes de départ et d'arrivée sont
 * partielles (le point de départ/d'arrivée est projeté sur l'arête).
 */
export interface Route {
  mode: NavMode;
  /** Intersections traversées (sans les extrémités virtuelles). Aucun nœud n'apparaît deux fois. */
  nodes: Uint32Array;
  /** Arêtes parcourues dans l'ordre (la première et la dernière peuvent être partielles). */
  edges: Uint32Array;
  /** Abscisse de route où commence chaque arête ; taille edges.length + 1 (dernier = longueur). */
  edgeStart: Float32Array;
  /** Points (x,y) de la polyligne et abscisse cumulée de chaque point. */
  pts: Float32Array;
  cum: Float32Array;
  length: number;
  /** Coût estimé (secondes de jeu) au moment du calcul. */
  cost: number;
  /** Version de l'état des rues au moment du calcul. */
  stateVersion: number;
}

export interface Located {
  x: number;
  y: number;
  /** Tangente unitaire (direction de marche). */
  tx: number;
  ty: number;
  /** Indice de segment de polyligne. */
  seg: number;
}

export function buildRoute(
  mode: NavMode,
  nodes: number[],
  edges: number[],
  edgeLengths: number[],
  points: Vec2[],
  cost: number,
  stateVersion: number,
): Route {
  const pts = new Float32Array(points.length * 2);
  const cum = new Float32Array(points.length);
  let acc = 0;
  points.forEach((p, i) => {
    pts[2 * i] = p.x;
    pts[2 * i + 1] = p.y;
    if (i > 0) acc += Math.hypot(p.x - points[i - 1]!.x, p.y - points[i - 1]!.y);
    cum[i] = acc;
  });
  const edgeStart = new Float32Array(edges.length + 1);
  let s = 0;
  edgeLengths.forEach((l, i) => {
    edgeStart[i] = s;
    s += l;
  });
  edgeStart[edges.length] = acc; // longueur réelle de la polyligne
  return { mode, nodes: Uint32Array.from(nodes), edges: Uint32Array.from(edges), edgeStart, pts, cum, length: acc, cost, stateVersion };
}

/** Position et tangente à l'abscisse `s` (extrapolation linéaire hors de [0, longueur]). */
export function locate(route: Route, s: number, out: Located): Located {
  const n = route.cum.length;
  if (n < 2) {
    out.x = route.pts[0] ?? 0;
    out.y = route.pts[1] ?? 0;
    out.tx = 1;
    out.ty = 0;
    out.seg = 0;
    return out;
  }
  let seg: number;
  if (s <= 0) seg = 0;
  else if (s >= route.length) seg = n - 2;
  else {
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if ((route.cum[mid] as number) <= s) lo = mid;
      else hi = mid;
    }
    seg = lo;
  }
  // saute les segments de longueur nulle pour la tangente
  const x0 = route.pts[2 * seg]!;
  const y0 = route.pts[2 * seg + 1]!;
  const x1 = route.pts[2 * seg + 2]!;
  const y1 = route.pts[2 * seg + 3]!;
  const l = (route.cum[seg + 1] as number) - (route.cum[seg] as number);
  const dx = x1 - x0;
  const dy = y1 - y0;
  const dl = Math.hypot(dx, dy) || 1;
  const f = l > 0 ? (s - (route.cum[seg] as number)) / l : 0; // peut sortir de [0,1] : extrapolation
  out.x = x0 + dx * f;
  out.y = y0 + dy * f;
  out.tx = dx / dl;
  out.ty = dy / dl;
  out.seg = seg;
  return out;
}

export function edgeIndexAt(route: Route, s: number): number {
  const m = route.edges.length;
  if (m === 0) return -1;
  if (s <= 0) return 0;
  if (s >= route.length) return m - 1;
  let lo = 0;
  let hi = m;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if ((route.edgeStart[mid] as number) <= s) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** Contrôles de validité d'un itinéraire (continuité, pas de boucle, pas de saut, longueur > 0). */
export function validateRoute(route: Route, maxSegmentJump = 1e-3): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  if (route.length <= 0) problems.push('longueur nulle');
  const seen = new Set<number>();
  for (const n of route.nodes) {
    if (seen.has(n)) problems.push(`nœud ${n} répété (boucle)`);
    seen.add(n);
  }
  for (let i = 1; i < route.cum.length; i++) {
    const d = Math.hypot(route.pts[2 * i]! - route.pts[2 * i - 2]!, route.pts[2 * i + 1]! - route.pts[2 * i - 1]!);
    const dc = (route.cum[i] as number) - (route.cum[i - 1] as number);
    if (Math.abs(d - dc) > maxSegmentJump + 1e-4 * d) problems.push(`abscisse incohérente au point ${i}`);
  }
  for (let i = 1; i < route.edgeStart.length; i++) {
    if ((route.edgeStart[i] as number) < (route.edgeStart[i - 1] as number)) problems.push('abscisses d’arêtes non croissantes');
  }
  return { ok: problems.length === 0, problems };
}

/** Tronque l'itinéraire à l'abscisse `s` (le point de coupe devient la fin de la route). */
export function truncateRoute(route: Route, s: number): Route {
  const cut = Math.max(0, Math.min(route.length, s));
  const n = route.cum.length;
  let seg = 0;
  while (seg < n - 2 && (route.cum[seg + 1] as number) < cut) seg++;
  const pts: number[] = [];
  for (let i = 0; i <= seg; i++) pts.push(route.pts[2 * i] as number, route.pts[2 * i + 1] as number);
  const l = (route.cum[seg + 1] as number) - (route.cum[seg] as number);
  const f = l > 0 ? (cut - (route.cum[seg] as number)) / l : 0;
  const x0 = route.pts[2 * seg]!;
  const y0 = route.pts[2 * seg + 1]!;
  const x1 = route.pts[2 * seg + 2]!;
  const y1 = route.pts[2 * seg + 3]!;
  pts.push(x0 + (x1 - x0) * f, y0 + (y1 - y0) * f);
  const k = edgeIndexAt(route, cut);
  const points = pts.length / 2;
  const out = new Float32Array(pts);
  const cum = new Float32Array(points);
  for (let i = 1; i < points; i++) cum[i] = (cum[i - 1] as number) + Math.hypot(out[2 * i]! - out[2 * i - 2]!, out[2 * i + 1]! - out[2 * i - 1]!);
  const edgeStart = new Float32Array(k + 2);
  for (let i = 0; i <= k; i++) edgeStart[i] = route.edgeStart[i] as number;
  edgeStart[k + 1] = cum[points - 1] as number;
  return {
    mode: route.mode,
    nodes: route.nodes.slice(0, k),
    edges: route.edges.slice(0, k + 1),
    edgeStart,
    pts: out,
    cum,
    length: cum[points - 1] as number,
    cost: route.cost,
    stateVersion: route.stateVersion,
  };
}

/** Met bout à bout plusieurs itinéraires contigus (le début de chacun suit la fin du précédent). */
export function joinRoutes(parts: Route[]): Route {
  const first = parts[0] as Route;
  const pts: number[] = [];
  const nodes: number[] = [];
  const edges: number[] = [];
  const starts: number[] = [];
  let offset = 0;
  let cost = 0;
  for (const r of parts) {
    for (let i = 0; i < r.cum.length; i++) {
      const x = r.pts[2 * i] as number;
      const y = r.pts[2 * i + 1] as number;
      const lx = pts[pts.length - 2];
      const ly = pts[pts.length - 1];
      if (lx !== undefined && Math.hypot(x - (lx as number), y - (ly as number)) < 0.3) {
        if (pts.length > 2) {
          pts[pts.length - 2] = x;
          pts[pts.length - 1] = y;
        }
        continue;
      }
      pts.push(x, y);
    }
    for (const n of r.nodes) nodes.push(n);
    for (let i = 0; i < r.edges.length; i++) {
      edges.push(r.edges[i] as number);
      starts.push(offset + (r.edgeStart[i] as number));
    }
    offset += r.length;
    cost += r.cost;
  }
  const out = new Float32Array(pts);
  const points = pts.length / 2;
  const cum = new Float32Array(points);
  for (let i = 1; i < points; i++) cum[i] = (cum[i - 1] as number) + Math.hypot(out[2 * i]! - out[2 * i - 2]!, out[2 * i + 1]! - out[2 * i - 1]!);
  const total = cum[points - 1] as number;
  const edgeStart = new Float32Array(edges.length + 1);
  starts.forEach((v, i) => (edgeStart[i] = Math.min(v, total)));
  edgeStart[edges.length] = total;
  return { mode: first.mode, nodes: Uint32Array.from(nodes), edges: Uint32Array.from(edges), edgeStart, pts: out, cum, length: total, cost, stateVersion: first.stateVersion };
}

export interface CursorOut {
  x: number;
  y: number;
  /** Normale unitaire (à gauche du sens de marche), lissée autour des sommets pour rester continue. */
  nx: number;
  ny: number;
  edge: number;
  /** Distance (m) au début / à la fin de l'arête courante (pour lisser les largeurs). */
  dStart: number;
  dEnd: number;
}

interface Dirs {
  dx: Float32Array;
  dy: Float32Array;
}
const dirCache = new WeakMap<Route, Dirs>();

function dirsOf(route: Route): Dirs {
  let d = dirCache.get(route);
  if (!d) {
    const n = Math.max(0, route.cum.length - 1);
    const dx = new Float32Array(n);
    const dy = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const ax = route.pts[2 * i + 2]! - route.pts[2 * i]!;
      const ay = route.pts[2 * i + 3]! - route.pts[2 * i + 1]!;
      const l = Math.hypot(ax, ay) || 1;
      dx[i] = ax / l;
      dy[i] = ay / l;
    }
    dirCache.set(route, (d = { dx, dy }));
  }
  return d;
}

/**
 * Curseur d'évaluation exacte et CONTINUE le long d'un itinéraire : O(1) amorti quand les abscisses
 * demandées sont monotones (cas des individus d'une colonne triés par rang). Extrapole en ligne droite hors
 * de [0, longueur]. La normale est lissée sur `cornerM` mètres autour des sommets (pas de saut latéral).
 */
export class RouteCursor {
  private seg = 0;
  private edge = 0;
  private readonly d: Dirs;
  constructor(
    private readonly route: Route,
    private readonly cornerM = 5,
  ) {
    this.d = dirsOf(route);
  }

  at(s: number, out: CursorOut): void {
    const r = this.route;
    const nseg = r.cum.length - 1;
    if (nseg < 1) {
      out.x = r.pts[0] ?? 0;
      out.y = r.pts[1] ?? 0;
      out.nx = 0;
      out.ny = 1;
      out.edge = 0;
      out.dStart = 0;
      out.dEnd = 0;
      return;
    }
    while (this.seg > 0 && (r.cum[this.seg] as number) > s) this.seg--;
    while (this.seg < nseg - 1 && (r.cum[this.seg + 1] as number) <= s) this.seg++;
    const k = this.seg;
    const dx = this.d.dx[k] as number;
    const dy = this.d.dy[k] as number;
    const ds = s - (r.cum[k] as number);
    out.x = (r.pts[2 * k] as number) + dx * ds;
    out.y = (r.pts[2 * k + 1] as number) + dy * ds;
    let nx = -dy;
    let ny = dx;
    const segLen = (r.cum[k + 1] as number) - (r.cum[k] as number);
    const R = Math.min(this.cornerM, segLen / 2);
    const de = (r.cum[k + 1] as number) - s;
    if (R > 1e-6) {
      if (ds < R && ds >= 0 && k > 0) {
        const w = 0.5 + (0.5 * ds) / R;
        nx = w * nx + (1 - w) * -(this.d.dy[k - 1] as number);
        ny = w * ny + (1 - w) * (this.d.dx[k - 1] as number);
      } else if (de < R && de >= 0 && k < nseg - 1) {
        const w = 0.5 + (0.5 * de) / R;
        nx = w * nx + (1 - w) * -(this.d.dy[k + 1] as number);
        ny = w * ny + (1 - w) * (this.d.dx[k + 1] as number);
      }
      const l = Math.hypot(nx, ny) || 1;
      nx /= l;
      ny /= l;
    }
    out.nx = nx;
    out.ny = ny;
    const ne = r.edges.length;
    while (this.edge > 0 && (r.edgeStart[this.edge] as number) > s) this.edge--;
    while (this.edge < ne - 1 && (r.edgeStart[this.edge + 1] as number) <= s) this.edge++;
    out.edge = this.edge;
    out.dStart = s - (r.edgeStart[this.edge] as number);
    out.dEnd = (r.edgeStart[this.edge + 1] as number) - s;
  }
}
