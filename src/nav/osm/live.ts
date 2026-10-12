import type { LngLat } from '../../geo/mercator';
import type { StreetGraph } from '../graph';
import { packGraph, unpackGraph } from '../pack';
import { buildGraphFromOsm, type BuildReport } from './buildGraph';
import { bboxAround, checkBboxSafety, overpassQuery } from './packBuild';
import { parseOverpass } from './parseOverpass';

/**
 * Chargement à la demande du graphe de rues d'un secteur choisi par le joueur (aucun paquet préparé).
 * Une seule requête Overpass bornée (≤ 12 km², vérifiée), déclenchée par une action de l'utilisateur, mise en cache
 * localement (IndexedDB) pour ne jamais redemander le même secteur. Le graphe est construit dans le navigateur avec
 * le même code que les paquets : il vient des mêmes données OSM que la carte affichée.
 */
export const OVERPASS_ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
/** Marge autour de la zone de jeu (m) pour ne pas couper les rues en bordure. */
export const LIVE_MARGIN_M = 80;
export const LIVE_TIMEOUT_MS = 60_000;
export const MIN_EDGES = 10;

export class LiveLoadError extends Error {
  constructor(
    message: string,
    readonly kind: 'overloaded' | 'network' | 'timeout' | 'empty' | 'invalid' | 'too_large' | 'cancelled',
  ) {
    super(message);
  }
}

export interface ZoneCache {
  get(key: string): Promise<unknown | undefined>;
  set(key: string, value: unknown): Promise<void>;
}

export interface LiveOptions {
  fetchFn?: typeof fetch;
  endpoints?: string[];
  cache?: ZoneCache | null;
  timeoutMs?: number;
  /** Étape 1 = téléchargement, 2 = construction du graphe (3 = démarrage, géré par l'interface). */
  onProgress?: (text: string, step: number) => void;
  /** Permet au joueur d'annuler le chargement. */
  signal?: AbortSignal;
}

export interface LiveResult {
  graph: StreetGraph;
  report?: BuildReport;
  fromCache: boolean;
  endpoint?: string;
}

/** Clé de cache : secteur arrondi à ~10 m (4 décimales) + taille. `zone2` : les secteurs téléchargés avant la phase 4 n’ont pas de lieux d’intérêt et sont donc retéléchargés. */
export const zoneKey = (c: LngLat, hw: number, hh: number): string => `zone2:${c.lat.toFixed(4)},${c.lng.toFixed(4)},${Math.round(hw)}x${Math.round(hh)}`;

export async function loadZoneGraph(center: LngLat, half: { halfWidth: number; halfHeight: number }, name: string, o: LiveOptions = {}): Promise<LiveResult> {
  const progress = o.onProgress ?? (() => undefined);
  const cancelled = () => new LiveLoadError('Chargement annulé.', 'cancelled');
  if (o.signal?.aborted) throw cancelled();
  const key = zoneKey(center, half.halfWidth, half.halfHeight);
  if (o.cache) {
    try {
      const hit = await o.cache.get(key);
      if (hit) {
        progress('Secteur déjà téléchargé : lecture du cache local…', 2);
        return { graph: unpackGraph(hit).graph, fromCache: true };
      }
    } catch {
      /* cache illisible : on ignore */
    }
  }
  const bbox = bboxAround(center, half.halfWidth + LIVE_MARGIN_M, half.halfHeight + LIVE_MARGIN_M);
  try {
    checkBboxSafety(bbox);
  } catch (e) {
    throw new LiveLoadError(e instanceof Error ? e.message : 'Zone trop grande.', 'too_large');
  }
  const query = overpassQuery(bbox, { timeoutS: 50 });
  const fetchFn = o.fetchFn ?? fetch.bind(globalThis);
  let json: unknown = null;
  let used = '';
  let lastErr: LiveLoadError | null = null;
  for (const endpoint of o.endpoints ?? OVERPASS_ENDPOINTS) {
    progress(`Téléchargement des rues et bâtiments OpenStreetMap (${new URL(endpoint).host})…`, 1);
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), o.timeoutMs ?? LIVE_TIMEOUT_MS);
    const onAbort = () => ctl.abort();
    o.signal?.addEventListener('abort', onAbort);
    try {
      const res = await fetchFn(endpoint, { method: 'POST', body: new URLSearchParams({ data: query }), signal: ctl.signal });
      if (res.status === 429 || res.status === 504) {
        // le service limite l'usage : on n'insiste pas (politique d'usage), message explicite
        throw new LiveLoadError(`Le service Overpass est surchargé ou limite l'usage (HTTP ${res.status}). Réessayez dans quelques minutes ou choisissez une zone plus petite.`, 'overloaded');
      }
      if (!res.ok) {
        lastErr = new LiveLoadError(`Le service Overpass a répondu HTTP ${res.status}.`, 'network');
        continue;
      }
      json = await res.json();
      used = endpoint;
      break;
    } catch (e) {
      if (e instanceof LiveLoadError) {
        if (e.kind === 'overloaded') throw e;
        lastErr = e;
      } else if (o.signal?.aborted) {
        throw cancelled();
      } else if (e instanceof DOMException && e.name === 'AbortError') {
        lastErr = new LiveLoadError('Délai dépassé : le service Overpass ne répond pas.', 'timeout');
      } else {
        lastErr = new LiveLoadError('Service Overpass injoignable (réseau, bloqueur de contenu ou service indisponible).', 'network');
      }
    } finally {
      clearTimeout(timer);
      o.signal?.removeEventListener('abort', onAbort);
    }
  }
  if (json === null) throw lastErr ?? new LiveLoadError('Aucun service Overpass disponible.', 'network');

  if (o.signal?.aborted) throw cancelled();
  progress('Construction du graphe de navigation…', 2);
  let built;
  try {
    built = buildGraphFromOsm(parseOverpass(json), { origin: center, label: name });
  } catch (e) {
    throw new LiveLoadError(`Données OpenStreetMap illisibles : ${e instanceof Error ? e.message : 'erreur inconnue'}.`, 'invalid');
  }
  if (built.graph.edgeCount < MIN_EDGES) {
    throw new LiveLoadError(`Trop peu de rues dans ce secteur (${built.graph.edgeCount}) : déplacez la carte vers un quartier urbain ou agrandissez la zone.`, 'empty');
  }
  if (o.cache) {
    try {
      await o.cache.set(key, packGraph(built.graph, { city: key, name, generatedAt: new Date().toISOString(), source: 'osm', attribution: '© contributeurs OpenStreetMap', license: 'ODbL 1.0' }));
    } catch {
      /* cache plein ou indisponible : sans conséquence */
    }
  }
  return { graph: built.graph, report: built.report, fromCache: false, endpoint: used };
}

/** Cache IndexedDB (null si indisponible : navigation privée, etc.). */
export function indexedDbCache(dbName = 'ordrepublic-osm', store = 'zones'): ZoneCache | null {
  if (typeof indexedDB === 'undefined') return null;
  const open = (): Promise<IDBDatabase> =>
    new Promise((resolve, reject) => {
      const r = indexedDB.open(dbName, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(store);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  const run = async <T,>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
    const db = await open();
    return new Promise<T>((resolve, reject) => {
      const rq = f(db.transaction(store, mode).objectStore(store));
      rq.onsuccess = () => resolve(rq.result);
      rq.onerror = () => reject(rq.error);
    });
  };
  return {
    get: (k) => run('readonly', (s) => s.get(k)),
    set: async (k, v) => {
      await run('readwrite', (s) => s.put(v, k));
    },
  };
}
