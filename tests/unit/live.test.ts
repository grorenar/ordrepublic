import { describe, expect, it } from 'vitest';
import { LiveLoadError, loadZoneGraph, zoneKey, type ZoneCache } from '../../src/nav/osm/live';
import { GameController } from '../../src/game/controller';
import { overpassGrid } from '../fixtures/overpassGrid';

const metz = { lng: 6.1757, lat: 49.1193 };
const half = { halfWidth: 600, halfHeight: 450 };
const okFetch = (calls: string[]) => async (url: RequestInfo | URL, init?: RequestInit) => {
  calls.push(String(url));
  expect(init?.method).toBe('POST');
  expect(String((init?.body as URLSearchParams).get('data'))).toContain('way["highway"]');
  return new Response(JSON.stringify(overpassGrid(metz)), { status: 200 });
};
const memCache = (): ZoneCache & { store: Map<string, unknown> } => {
  const store = new Map<string, unknown>();
  return { store, get: async (k) => store.get(k), set: async (k, v) => void store.set(k, v) };
};

describe('chargement à la demande du graphe OSM d’un secteur', () => {
  it('une requête POST bornée, graphe construit avec origine = centre choisi, puis lecture du cache sans réseau', async () => {
    const calls: string[] = [];
    const cache = memCache();
    const a = await loadZoneGraph(metz, half, 'Metz', { fetchFn: okFetch(calls) as typeof fetch, cache });
    expect(calls.length).toBe(1);
    expect(a.fromCache).toBe(false);
    expect(a.graph.provenance.source).toBe('osm');
    expect(a.graph.edgeCount).toBeGreaterThan(100);
    expect(a.graph.origin).toEqual(metz);
    expect(cache.store.has(zoneKey(metz, 600, 450))).toBe(true);
    const b = await loadZoneGraph(metz, half, 'Metz', { fetchFn: (async () => { throw new Error('ne doit pas être appelé'); }) as typeof fetch, cache });
    expect(b.fromCache).toBe(true);
    expect(b.graph.edgeCount).toBe(a.graph.edgeCount);
  });

  it('HTTP 429 : jusqu’à 10 tentatives (services alternés) avant l’échec, message explicite avec le nombre de tentatives', async () => {
    const urls: string[] = [];
    const f = (async (u: RequestInfo | URL) => { urls.push(String(u)); return new Response('', { status: 429 }); }) as typeof fetch;
    const err = await loadZoneGraph(metz, half, 'Metz', { fetchFn: f, cache: null, retryDelayMs: 1 }).catch((e) => e);
    expect(err).toBeInstanceOf(LiveLoadError);
    expect(err.kind).toBe('overloaded');
    expect(err.message).toMatch(/10 tentatives/);
    expect(urls.length).toBe(10);
    expect(new Set(urls).size).toBe(2);
  });

  it('un service qui finit par répondre après plusieurs échecs (429, 504, réseau) : le chargement réussit', async () => {
    let n = 0;
    const progress: string[] = [];
    const f = (async () => {
      n++;
      if (n === 1) return new Response('', { status: 429 });
      if (n === 2) return new Response('', { status: 504 });
      if (n === 3) throw new TypeError('Failed to fetch');
      return new Response(JSON.stringify(overpassGrid(metz)), { status: 200 });
    }) as typeof fetch;
    const r = await loadZoneGraph(metz, half, 'Metz', { fetchFn: f, cache: null, retryDelayMs: 1, onProgress: (t) => progress.push(t) });
    expect(n).toBe(4);
    expect(r.graph.edgeCount).toBeGreaterThan(100);
    expect(progress.some((t) => /tentative 4\/10/.test(t))).toBe(true);
    expect(progress.some((t) => /Nouvelle tentative/.test(t))).toBe(true);
  });

  it('le nombre de tentatives est réglable ; l’annulation pendant l’attente est immédiate', async () => {
    let n = 0;
    const f = (async () => { n++; return new Response('', { status: 429 }); }) as typeof fetch;
    await expect(loadZoneGraph(metz, half, 'Metz', { fetchFn: f, cache: null, maxAttempts: 3, retryDelayMs: 1 })).rejects.toMatchObject({ kind: 'overloaded' });
    expect(n).toBe(3);
    const ctl = new AbortController();
    const g = (async () => new Response('', { status: 429 })) as typeof fetch;
    const p = loadZoneGraph(metz, half, 'Metz', { fetchFn: g, cache: null, signal: ctl.signal, retryDelayMs: 60_000 });
    setTimeout(() => ctl.abort(), 20);
    const t0 = Date.now();
    await expect(p).rejects.toMatchObject({ kind: 'cancelled' });
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  it('service principal injoignable : bascule sur le second ; tous injoignables : erreur claire', async () => {
    const urls: string[] = [];
    const f = (async (u: RequestInfo | URL) => {
      urls.push(String(u));
      if (urls.length === 1) throw new TypeError('Failed to fetch');
      return new Response(JSON.stringify(overpassGrid(metz)), { status: 200 });
    }) as typeof fetch;
    const r = await loadZoneGraph(metz, half, 'Metz', { fetchFn: f, cache: null });
    expect(urls.length).toBe(2);
    expect(r.endpoint).toBe(urls[1]);
    const dead = (async () => { throw new TypeError('Failed to fetch'); }) as typeof fetch;
    await expect(loadZoneGraph(metz, half, 'Metz', { fetchFn: dead, cache: null, retryDelayMs: 1 })).rejects.toMatchObject({ kind: 'network' });
  });

  it('zone trop grande, secteur sans rues, réponse illisible : erreurs typées', async () => {
    await expect(loadZoneGraph(metz, { halfWidth: 4000, halfHeight: 4000 }, 'Metz', { cache: null, fetchFn: (async () => new Response('{}')) as typeof fetch })).rejects.toMatchObject({ kind: 'too_large' });
    const empty = (async () => new Response(JSON.stringify({ elements: [] }), { status: 200 })) as typeof fetch;
    await expect(loadZoneGraph(metz, half, 'Metz', { fetchFn: empty, cache: null })).rejects.toBeInstanceOf(LiveLoadError);
    const bad = (async () => new Response(JSON.stringify({ pas: 'overpass' }), { status: 200 })) as typeof fetch;
    await expect(loadZoneGraph(metz, half, 'Metz', { fetchFn: bad, cache: null })).rejects.toMatchObject({ kind: 'invalid' });
  });

  it('l’annulation par le joueur interrompt la requête (erreur « cancelled »)', async () => {
    const ctl = new AbortController();
    const slow = ((_u: RequestInfo | URL, init?: RequestInit) => new Promise((_res, rej) => init?.signal?.addEventListener('abort', () => rej(new DOMException('x', 'AbortError'))))) as typeof fetch;
    const p = loadZoneGraph(metz, half, 'Metz', { fetchFn: slow, cache: null, signal: ctl.signal, endpoints: ['https://a.example/api'] });
    setTimeout(() => ctl.abort(), 10);
    await expect(p).rejects.toMatchObject({ kind: 'cancelled' });
    ctl.abort();
    await expect(loadZoneGraph(metz, half, 'Metz', { fetchFn: slow, cache: null, signal: ctl.signal })).rejects.toMatchObject({ kind: 'cancelled' });
  });

  it('le délai dépassé est signalé', async () => {
    const slow = ((_u: RequestInfo | URL, init?: RequestInit) => new Promise((_res, rej) => init?.signal?.addEventListener('abort', () => rej(new DOMException('x', 'AbortError'))))) as typeof fetch;
    await expect(loadZoneGraph(metz, half, 'Metz', { fetchFn: slow, cache: null, timeoutMs: 20, retryDelayMs: 1, maxAttempts: 2, endpoints: ['https://a.example/api'] })).rejects.toMatchObject({ kind: 'timeout' });
  });

  it('le scénario de démonstration et le moteur démarrent sur ce graphe OSM (simulé) et jouent sans erreur', async () => {
    const { graph } = await loadZoneGraph(metz, half, 'Metz', { fetchFn: okFetch([]) as typeof fetch, cache: null });
    const c = new GameController({ graph, zoneLevel: 1 });
    expect(c.sim.units.length).toBe(8);
    c.runTicks((c.scenario.milestones.arrivalS + 120) * 10);
    expect(c.sim.totalPeople()).toBeGreaterThan(0);
    expect(c.sim.journal.events.some((e) => e.code === 'group.march_started')).toBe(true);
  }, 60_000);
});
