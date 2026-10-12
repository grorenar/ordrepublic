import type { City } from '../state/types';

/**
 * Recherche de ville via un service compatible Nominatim (point d'accès configurable).
 * Respect de la politique d'usage du service public :
 *  - requête uniquement sur validation explicite (pas d'autocomplétion à la frappe) ;
 *  - 1 requête par seconde maximum pour toute l'application ;
 *  - résultats mis en cache (localStorage) pour ne pas répéter la même requête ;
 *  - le navigateur envoie le Referer ; aucun contournement.
 */
export interface GeocodeResult {
  city: City;
  type: string;
}

export interface GeocodeDeps {
  fetchFn?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
}

export class GeocodeError extends Error {
  constructor(
    message: string,
    readonly kind: 'network' | 'rate_limited' | 'http' | 'invalid',
  ) {
    super(message);
  }
}

const MIN_INTERVAL_MS = 1100;
const CACHE_KEY = 'ordrepublic.geocache.v1';
const CACHE_TTL_MS = 7 * 24 * 3600 * 1000;
const CACHE_MAX = 40;
let lastRequestAt = 0;

export function parseNominatim(json: unknown): GeocodeResult[] {
  if (!Array.isArray(json)) throw new GeocodeError('Réponse du service de recherche inattendue.', 'invalid');
  const out: GeocodeResult[] = [];
  for (const item of json) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const lat = Number(r.lat);
    const lng = Number(r.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 85 || Math.abs(lng) > 180) continue;
    const label = typeof r.display_name === 'string' ? r.display_name : '';
    const name =
      (typeof r.name === 'string' && r.name) || label.split(',')[0]?.trim() || `${lat.toFixed(3)}, ${lng.toFixed(3)}`;
    out.push({
      type: typeof r.type === 'string' ? r.type : 'place',
      city: { id: `osm-${r.osm_type ?? 'x'}-${r.osm_id ?? out.length}`, name, label, center: { lat, lng } },
    });
  }
  return out;
}

export async function searchCity(query: string, endpoint: string, deps: GeocodeDeps = {}): Promise<GeocodeResult[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const fetchFn = deps.fetchFn ?? fetch.bind(globalThis);
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const storage = deps.storage ?? safeStorage();

  const cacheKey = `${endpoint}|${q.toLowerCase()}`;
  const cached = readCache(storage, cacheKey, now());
  if (cached) return cached;

  const wait = lastRequestAt + MIN_INTERVAL_MS - now();
  if (wait > 0) await sleep(wait);
  lastRequestAt = now();

  const url = new URL(endpoint);
  url.searchParams.set('q', q);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', '6');
  url.searchParams.set('accept-language', 'fr');
  url.searchParams.set('featuretype', 'settlement');

  let res: Response;
  try {
    res = await fetchFn(url.toString(), { headers: { Accept: 'application/json' }, referrerPolicy: 'strict-origin-when-cross-origin' });
  } catch {
    throw new GeocodeError('Service de recherche injoignable (connexion Internet ?).', 'network');
  }
  if (res.status === 429) throw new GeocodeError('Trop de requêtes : réessayez dans quelques secondes.', 'rate_limited');
  if (!res.ok) throw new GeocodeError(`Le service de recherche a répondu ${res.status}.`, 'http');
  const results = parseNominatim(await res.json());
  writeCache(storage, cacheKey, results, now());
  return results;
}

type CacheShape = Record<string, { at: number; results: GeocodeResult[] }>;

function readCache(storage: GeocodeDeps['storage'], key: string, now: number): GeocodeResult[] | null {
  try {
    const all = JSON.parse(storage?.getItem(CACHE_KEY) ?? '{}') as CacheShape;
    const hit = all[key];
    return hit && now - hit.at < CACHE_TTL_MS ? hit.results : null;
  } catch {
    return null;
  }
}

function writeCache(storage: GeocodeDeps['storage'], key: string, results: GeocodeResult[], now: number): void {
  try {
    const all = JSON.parse(storage?.getItem(CACHE_KEY) ?? '{}') as CacheShape;
    all[key] = { at: now, results };
    const keys = Object.keys(all).sort((a, b) => (all[a]?.at ?? 0) - (all[b]?.at ?? 0));
    while (keys.length > CACHE_MAX) delete all[keys.shift() as string];
    storage?.setItem(CACHE_KEY, JSON.stringify(all));
  } catch {
    /* cache indisponible : on ignore */
  }
}

export function resetGeocodeThrottleForTests(): void {
  lastRequestAt = 0;
}

function safeStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}
