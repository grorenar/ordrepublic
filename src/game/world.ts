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
  /**
   * Vrai quand le fond OSM était demandé mais qu'aucun graphe cohérent n'est disponible (paquet absent ou invalide) :
   * l'interface affiche alors la carte réelle SANS simulation (aperçu), jamais un moteur posé sur des rues qui ne correspondent pas.
   */
  missingPack?: boolean;
}

/**
 * Fournit le graphe de rues cohérent avec le fond affiché.
 *  - fond schématique → graphe schématique (mêmes rues, places et bâtiments que le dessin) ;
 *  - fond OSM → paquet préparé de la ville (public/data/osm/<ville>.graph.json) ; s'il n'existe pas, `missingPack` est vrai :
 *    la carte réelle reste affichée en aperçu, sans simulation (le graphe schématique renvoyé ne doit PAS être utilisé avec elle).
 */
export async function provideWorld(city: City, want: WorldKind, fetchFn?: typeof fetch): Promise<World> {
  if (want === 'osm') {
    try {
      const pack = await loadCityPack(city.id, fetchFn);
      if (pack) return { kind: 'osm', graph: pack.graph };
    } catch (err) {
      const why = err instanceof PackError ? err.message : 'lecture impossible';
      return { ...schematic(city), missingPack: true, notice: `Paquet OSM invalide (${why}). Voir docs/DONNEES_OSM.md.` };
    }
    return {
      ...schematic(city),
      missingPack: true,
      notice: `Aucun paquet OSM préparé pour ${city.name} : les rues du secteur choisi seront chargées à la demande.`,
    };
  }
  return schematic(city);
}

function schematic(city: City, notice?: string): World {
  const max = ZONE_LEVELS[ZONE_LEVELS.length - 1]!;
  return { kind: 'schematic', graph: buildSchematicGraph(city.center, max.halfWidth, max.halfHeight), notice };
}
