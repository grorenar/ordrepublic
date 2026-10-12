import { LocalFrame, type LngLat } from '../../src/geo/mercator';

/**
 * Réponse Overpass SIMULÉE (aucun réseau) : quadrillage de rues autour d'un centre, immeubles dans les îlots,
 * une place. Noms fictifs. Sert aux tests du chargement à la demande (unitaires et navigateur).
 */
export function overpassGrid(center: LngLat, o: { cols?: number; rows?: number; step?: number } = {}) {
  const cols = o.cols ?? 12;
  const rows = o.rows ?? 10;
  const step = o.step ?? 90;
  const frame = new LocalFrame(center);
  const els: unknown[] = [];
  let id = 1;
  const ids = new Map<string, number>();
  const node = (key: string, x: number, y: number): number => {
    let n = ids.get(key);
    if (n === undefined) {
      n = id++;
      ids.set(key, n);
      const p = frame.toLngLat({ x, y });
      els.push({ type: 'node', id: n, lat: +p.lat.toFixed(7), lon: +p.lng.toFixed(7) });
    }
    return n;
  };
  const x0 = -((cols - 1) * step) / 2;
  const y0 = -((rows - 1) * step) / 2;
  const at = (c: number, r: number) => node(`g${c}:${r}`, x0 + c * step, y0 + r * step);
  let wid = 1000;
  for (let r = 0; r < rows; r++) els.push({ type: 'way', id: wid++, nodes: Array.from({ length: cols }, (_, c) => at(c, r)), tags: { highway: r % 4 === 0 ? 'secondary' : 'residential', name: `Rue Horizontale ${r} (fictive)` } });
  for (let c = 0; c < cols; c++) els.push({ type: 'way', id: wid++, nodes: Array.from({ length: rows }, (_, r) => at(c, r)), tags: { highway: c % 4 === 0 ? 'secondary' : 'residential', name: `Rue Verticale ${c} (fictive)` } });
  // immeubles : un carré par îlot (sauf l'îlot central = place)
  const sc = Math.floor(cols / 2) - 1;
  const sr = Math.floor(rows / 2) - 1;
  for (let c = 0; c < cols - 1; c++) {
    for (let r = 0; r < rows - 1; r++) {
      const ax = x0 + c * step + 14;
      const ay = y0 + r * step + 14;
      const bx = x0 + (c + 1) * step - 14;
      const by = y0 + (r + 1) * step - 14;
      const key = `b${c}:${r}`;
      const ring = [node(`${key}a`, ax, ay), node(`${key}b`, bx, ay), node(`${key}c`, bx, by), node(`${key}d`, ax, by)];
      const isSquare = c === sc && r === sr;
      els.push({ type: 'way', id: wid++, nodes: [...ring, ring[0]], tags: isSquare ? { place: 'square', name: 'Place du Test (fictive)' } : { building: 'yes' } });
    }
  }
  return { version: 0.6, generator: 'simulation de test', osm3s: { timestamp_osm_base: '2000-01-01T00:00:00Z' }, elements: els };
}
