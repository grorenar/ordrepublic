import type { StreetGraph } from './graph';
import { PackError, unpackGraph, type PackMeta } from './pack';

export interface LoadedPack {
  graph: StreetGraph;
  meta: PackMeta;
}

/**
 * Charge le paquet d'une ville depuis le site (public/data/osm/<ville>.graph.json[.gz]).
 * Retourne null si aucun paquet n'existe (404) ; lève `PackError` si le fichier est invalide.
 * Aucun service externe : les fichiers sont servis par l'application elle-même.
 */
export async function loadCityPack(cityId: string, fetchFn: typeof fetch = fetch.bind(globalThis), base = `${import.meta.env.BASE_URL}data/osm/`): Promise<LoadedPack | null> {
  const url = `${base}${cityId}.graph.json`;
  let res: Response;
  try {
    res = await fetchFn(url, { headers: { Accept: 'application/json' } });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const type = res.headers.get('content-type') ?? '';
  // un serveur de développement peut renvoyer index.html pour un chemin inconnu : ce n'est pas un paquet
  if (type.includes('text/html')) return null;
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new PackError(`Paquet illisible (${url}).`);
  }
  return unpackGraph(json);
}
