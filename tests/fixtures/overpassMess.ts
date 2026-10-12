import { LocalFrame, type LngLat } from '../../src/geo/mercator';

/**
 * Réponse Overpass SIMULÉE « difficile » : quadrillage tourné et déformé (rues non rectilignes, carrefours obliques), immeubles
 * irréguliers (sommets décalés, retraits variables, certains empiétant sur l'axe d'une rue comme avec des données OSM imparfaites),
 * une rue en tunnel sous un grand bâtiment et une place ouverte. Déterministe (graine). Aucun réseau.
 */
export function overpassMess(center: LngLat, seed = 7) {
  let st = seed >>> 0;
  const rnd = () => ((st = (Math.imul(st, 1664525) + 1013904223) >>> 0) / 4294967296);
  const frame = new LocalFrame(center);
  const cols = 13;
  const rows = 11;
  const step = 85;
  const rot = (33 * Math.PI) / 180;
  const els: unknown[] = [];
  let id = 1;
  const pts = new Map<string, number>();
  const mk = (key: string, x: number, y: number) => {
    let n = pts.get(key);
    if (n === undefined) {
      n = id++;
      pts.set(key, n);
      const p = frame.toLngLat({ x, y });
      els.push({ type: 'node', id: n, lat: +p.lat.toFixed(7), lon: +p.lng.toFixed(7) });
    }
    return n;
  };
  const gx = (c: number, r: number) => {
    const x = (c - (cols - 1) / 2) * step + (rnd() - 0.5) * 14;
    const y = (r - (rows - 1) / 2) * step + (rnd() - 0.5) * 14;
    return { x: x * Math.cos(rot) - y * Math.sin(rot), y: x * Math.sin(rot) + y * Math.cos(rot) };
  };
  const grid: Array<Array<{ x: number; y: number }>> = [];
  for (let c = 0; c < cols; c++) {
    grid.push([]);
    for (let r = 0; r < rows; r++) grid[c]!.push(gx(c, r));
  }
  const at = (c: number, r: number) => mk(`g${c}:${r}`, grid[c]![r]!.x, grid[c]![r]!.y);
  let wid = 1000;
  // rues : segments avec un point de forme décalé (rues sinueuses)
  const street = (a: number, b: number, c0: number, r0: number, c1: number, r1: number, tags: Record<string, string>) => {
    const p = grid[c0]![r0]!;
    const q = grid[c1]![r1]!;
    const mx = (p.x + q.x) / 2 + (rnd() - 0.5) * 10;
    const my = (p.y + q.y) / 2 + (rnd() - 0.5) * 10;
    const m = mk(`m${a}:${b}:${wid}`, mx, my);
    els.push({ type: 'way', id: wid++, nodes: [a, m, b], tags });
  };
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      if (c + 1 < cols) street(at(c, r), at(c + 1, r), c, r, c + 1, r, { highway: r % 3 === 0 ? 'secondary' : 'residential', name: `Rue ${r}-${c} (fictive)` });
      if (r + 1 < rows) street(at(c, r), at(c, r + 1), c, r, c, r + 1, { highway: c % 3 === 0 ? 'tertiary' : r % 5 === 2 ? 'service' : 'residential', name: `Ruelle ${c}-${r} (fictive)` });
    }
  }
  // immeubles irréguliers dans chaque îlot
  const sc = Math.floor(cols / 2);
  const sr = Math.floor(rows / 2);
  for (let c = 0; c + 1 < cols; c++) {
    for (let r = 0; r + 1 < rows; r++) {
      const corners = [grid[c]![r]!, grid[c + 1]![r]!, grid[c + 1]![r + 1]!, grid[c]![r + 1]!];
      const cx = corners.reduce((s, p) => s + p.x, 0) / 4;
      const cy = corners.reduce((s, p) => s + p.y, 0) / 4;
      const isSquare = c === sc && r === sr;
      const inset = isSquare ? 0 : 0.45 + rnd() * 0.2; // retrait variable : certains immeubles débordent presque sur la rue
      const ring: number[] = [];
      const key = `b${c}:${r}`;
      corners.forEach((p, i) => {
        const x = cx + (p.x - cx) * (1 - inset * (isSquare ? 0 : 0.35)) * (1 + (rnd() - 0.5) * 0.12);
        const y = cy + (p.y - cy) * (1 - inset * (isSquare ? 0 : 0.35)) * (1 + (rnd() - 0.5) * 0.12);
        ring.push(mk(`${key}:${i}`, x, y));
      });
      const tags: Record<string, string> = isSquare ? { place: 'square', name: 'Place du Test (fictive)' } : { building: 'yes' };
      if (c === sc - 2 && r === sr + 2) Object.assign(tags, { amenity: 'townhall', name: 'Hôtel de Ville (fictif)' });
      els.push({ type: 'way', id: wid++, nodes: [...ring, ring[0]], tags });
    }
  }
  return { version: 0.6, generator: 'simulation de test (données difficiles)', osm3s: { timestamp_osm_base: '2000-01-01T00:00:00Z' }, elements: els };
}
