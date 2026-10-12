import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GeocodeError, parseNominatim, resetGeocodeThrottleForTests, searchCity } from '../../src/geo/geocode';

const sample = [
  { osm_type: 'relation', osm_id: 1, lat: '47.2184', lon: '-1.5536', display_name: 'Nantes, Loire-Atlantique, France', name: 'Nantes', type: 'city' },
  { osm_type: 'node', osm_id: 2, lat: 'abc', lon: '1', display_name: 'Invalide' },
];
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
function memStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
}

beforeEach(() => resetGeocodeThrottleForTests());

describe('géocodage (Nominatim)', () => {
  it('ignore les résultats invalides', () => {
    const r = parseNominatim(sample);
    expect(r).toHaveLength(1);
    expect(r[0]?.city.name).toBe('Nantes');
    expect(r[0]?.city.center).toEqual({ lat: 47.2184, lng: -1.5536 });
  });

  it('rejette une réponse inattendue', () => {
    expect(() => parseNominatim({ error: 'x' })).toThrow(GeocodeError);
  });

  it('ignore les requêtes trop courtes sans appeler le réseau', async () => {
    const fetchFn = vi.fn();
    expect(await searchCity('a', 'https://geo.example/search', { fetchFn: fetchFn as never })).toEqual([]);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('envoie une requête paramétrée et met le résultat en cache', async () => {
    const storage = memStorage();
    const fetchFn = vi.fn(async () => ok(sample));
    const deps = { fetchFn: fetchFn as never, storage, sleep: async () => undefined };
    const r1 = await searchCity('Nantes', 'https://geo.example/search', deps);
    const r2 = await searchCity('nantes', 'https://geo.example/search', deps);
    expect(r1).toEqual(r2);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const url = new URL((fetchFn.mock.calls[0] as unknown as [string])[0]);
    expect(url.searchParams.get('q')).toBe('Nantes');
    expect(url.searchParams.get('format')).toBe('jsonv2');
  });

  it('impose au moins ~1 s entre deux requêtes distinctes', async () => {
    let t = 10_000;
    const sleeps: number[] = [];
    const deps = {
      fetchFn: (async () => ok(sample)) as never,
      storage: memStorage(),
      now: () => t,
      sleep: async (ms: number) => void sleeps.push(ms),
    };
    await searchCity('Nantes', 'https://geo.example/search', deps);
    t += 200;
    await searchCity('Rennes', 'https://geo.example/search', deps);
    expect(sleeps).toHaveLength(1);
    expect(sleeps[0]).toBeGreaterThanOrEqual(900);
  });

  it('signale clairement 429, erreur HTTP et réseau', async () => {
    const mk = (f: () => Promise<Response>) => ({ fetchFn: f as never, storage: memStorage(), sleep: async () => undefined });
    await expect(searchCity('Nantes', 'https://g/s', mk(async () => new Response('', { status: 429 })))).rejects.toMatchObject({ kind: 'rate_limited' });
    resetGeocodeThrottleForTests();
    await expect(searchCity('Nantes', 'https://g/s', mk(async () => new Response('', { status: 500 })))).rejects.toMatchObject({ kind: 'http' });
    resetGeocodeThrottleForTests();
    await expect(searchCity('Nantes', 'https://g/s', mk(async () => { throw new TypeError('fail'); }))).rejects.toMatchObject({ kind: 'network' });
  });
});
