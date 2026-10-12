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
/**
 * Délai par tentative. Il ne doit pas être trop court : Overpass continue de traiter côté serveur une requête que le client
 * abandonne, et lui en envoyer aussitôt une autre occupe un second créneau (limite par adresse) : les tentatives qui
 * s'accumulent se bloquent alors entre elles.
 */
export const LIVE_TIMEOUT_MS = 45_000;
export const MIN_EDGES = 10;
/** Les services Overpass publics sont souvent saturés : on réessaie jusqu'à 10 fois (attente croissante) avant de déclarer l'échec. */
export const LIVE_MAX_ATTEMPTS = 10;
export const LIVE_RETRY_DELAY_MS = 4000;
/** Attente maximale dictée par le service (créneau libre annoncé, `Retry-After`). */
export const LIVE_MAX_SERVER_WAIT_MS = 60_000;

/** Lit la page d'état d'Overpass (`/api/status`) : créneaux libres maintenant, ou secondes avant le prochain créneau. */
export function parseOverpassStatus(text: string): { freeNow: boolean; waitS: number } {
  const free = /(\d+)\s+slots?\s+available now/i.exec(text);
  if (free && Number(free[1]) > 0) return { freeNow: true, waitS: 0 };
  const rate = /Rate limit:\s*(\d+)/i.exec(text);
  if (rate && Number(rate[1]) === 0) return { freeNow: true, waitS: 0 }; // pas de limite
  const after = /in\s+(\d+)\s+seconds?/i.exec(text);
  return { freeNow: false, waitS: after ? Number(after[1]) : 0 };
}

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
  /** Choix du joueur, relu à chaque tentative : inclure les lieux d'intérêt (défaut oui). Jamais imposé par le chargeur. */
  includePois?: () => boolean;
  /** Consulter la page d'état du service avant de réessayer (attend un créneau libre au lieu d'empiler les requêtes). Défaut oui. */
  useStatus?: boolean;
  /** Nombre maximal de tentatives (toutes erreurs de service confondues), défaut 10. */
  maxAttempts?: number;
  /** Attente de base entre deux tentatives (ms) ; croît linéairement (×n), plafonnée à 8×. Défaut 1500. */
  retryDelayMs?: number;
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
  const fullQuery = overpassQuery(bbox, { timeoutS: 40 });
  const lightQuery = overpassQuery(bbox, { timeoutS: 40, pois: false });
  const fetchFn = o.fetchFn ?? fetch.bind(globalThis);
  let json: unknown = null;
  let used = '';
  let lastErr: LiveLoadError | null = null;
  let retryAfterMs = 0;
  const endpoints = o.endpoints ?? OVERPASS_ENDPOINTS;
  const maxAttempts = Math.max(1, o.maxAttempts ?? LIVE_MAX_ATTEMPTS);
  const baseDelay = o.retryDelayMs ?? LIVE_RETRY_DELAY_MS;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const endpoint = endpoints[(attempt - 1) % endpoints.length] as string;
    const light = o.includePois ? !o.includePois() : false;
    const query = light ? lightQuery : fullQuery;
    progress(`Téléchargement des rues et bâtiments OpenStreetMap (${new URL(endpoint).host})${maxAttempts > 1 ? ` — tentative ${attempt}/${maxAttempts}` : ''}${light ? ', requête allégée sans lieux' : ''}…`, 1);
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), o.timeoutMs ?? LIVE_TIMEOUT_MS);
    const onAbort = () => ctl.abort();
    o.signal?.addEventListener('abort', onAbort);
    try {
      const res = await fetchFn(endpoint, { method: 'POST', body: new URLSearchParams({ data: query }), signal: ctl.signal });
      if (res.status === 429 || res.status === 504) {
        const ra = Number(res.headers.get('retry-after'));
        if (Number.isFinite(ra) && ra > 0) retryAfterMs = Math.min(LIVE_MAX_SERVER_WAIT_MS, ra * 1000);
        lastErr = new LiveLoadError(`Le service Overpass est surchargé ou limite l'usage (HTTP ${res.status}).`, 'overloaded');
      } else if (!res.ok) {
        lastErr = new LiveLoadError(`Le service Overpass a répondu HTTP ${res.status}.`, 'network');
      } else {
        const body = (await res.json()) as { remark?: unknown };
        // Overpass renvoie parfois HTTP 200 avec une « remark » d'erreur d'exécution (délai serveur dépassé) et des données vides ou partielles
        if (typeof body.remark === 'string' && /runtime error|timed out|out of memory|too busy/i.test(body.remark)) lastErr = new LiveLoadError(`Le service Overpass n'a pas terminé la requête (${body.remark.slice(0, 80)}).`, 'timeout');
        else {
          json = body;
          used = endpoint;
          break;
        }
      }
    } catch (e) {
      if (o.signal?.aborted) throw cancelled();
      if (e instanceof DOMException && e.name === 'AbortError') lastErr = new LiveLoadError('Délai dépassé : le service Overpass ne répond pas.', 'timeout');
      else lastErr = new LiveLoadError('Service Overpass injoignable (réseau, bloqueur de contenu ou service indisponible).', 'network');
    } finally {
      clearTimeout(timer);
      o.signal?.removeEventListener('abort', onAbort);
    }
    if (attempt < maxAttempts) {
      // attente croissante (politesse envers un service public) ; si le service annonce un créneau libre plus tard, on l'attend
      let wait = Math.max(baseDelay * Math.min(8, attempt), retryAfterMs);
      retryAfterMs = 0;
      if (o.useStatus !== false) {
        try {
          const sctl = new AbortController();
          const st = setTimeout(() => sctl.abort(), 4000);
          const sres = await fetchFn(endpoint.replace(/interpreter\/?$/, 'status'), { signal: sctl.signal });
          clearTimeout(st);
          if (sres.ok) {
            const info = parseOverpassStatus(await sres.text());
            if (!info.freeNow && info.waitS > 0) wait = Math.max(wait, Math.min(LIVE_MAX_SERVER_WAIT_MS, (info.waitS + 1) * 1000));
          }
        } catch {
          /* page d'état indisponible : on s'en tient à l'attente croissante */
        }
      }
      progress(`${(lastErr as LiveLoadError).message} Nouvelle tentative dans ${Math.max(1, Math.round(wait / 1000))} s (${attempt}/${maxAttempts} échouée${attempt > 1 ? 's' : ''})…`, 1);
      await new Promise<void>((res) => {
        const t = setTimeout(res, wait);
        o.signal?.addEventListener('abort', () => (clearTimeout(t), res()), { once: true });
      });
      if (o.signal?.aborted) throw cancelled();
    }
  }
  if (json === null && lastErr) lastErr = new LiveLoadError(`${lastErr.message} Échec après ${maxAttempts} tentative${maxAttempts > 1 ? 's' : ''}. Réessayez dans quelques minutes ou choisissez une zone plus petite.`, lastErr.kind);
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
