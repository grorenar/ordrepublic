import type { City } from '../state/types';
import type { StreetGraph } from '../nav/graph';
import { loadCityPack } from '../nav/packLoader';
import { PackError } from '../nav/pack';
import { buildSchematicGraph } from '../nav/schematicGraph';
import { ZONE_LEVELS } from './zones';

export type WorldKind = 'osm' | 'schematic';

export interface World {
  kind: WorldKind;
  graph: StreetGraph;
  /** Message à afficher au joueur quand le fond demandé n'a pas pu être honoré. */
  notice?: string;
}

/**
 * Fournit le graphe de rues cohérent avec le fond affiché.
 *  - fond schématique → graphe schématique (mêmes rues, places et bâtiments que le dessin) ;
 *  - fond OSM → paquet préparé de la ville (public/data/osm/<ville>.graph.json) ; s'il n'existe pas, le graphe
 *    ne correspondrait pas à la carte : on retombe sur le fond schématique en le disant clairement.
 */
export async function provideWorld(city: City, want: WorldKind, fetchFn?: typeof fetch): Promise<World> {
  if (want === 'osm') {
    try {
      const pack = await loadCityPack(city.id, fetchFn);
      if (pack) return { kind: 'osm', graph: pack.graph };
    } catch (err) {
      const why = err instanceof PackError ? err.message : 'lecture impossible';
      return schematic(city, `Paquet OSM invalide (${why}) : fond schématique utilisé. Voir docs/DONNEES_OSM.md.`);
    }
    return schematic(
      city,
      `Aucun paquet OSM préparé pour ${city.name} : les rues simulées ne correspondraient pas à la carte. Fond schématique utilisé (voir docs/DONNEES_OSM.md pour générer le paquet).`,
    );
  }
  return schematic(city);
}

function schematic(city: City, notice?: string): World {
  const max = ZONE_LEVELS[ZONE_LEVELS.length - 1]!;
  return { kind: 'schematic', graph: buildSchematicGraph(city.center, max.halfWidth, max.halfHeight), notice };
}
