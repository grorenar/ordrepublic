/**
 * Fournisseurs de fond de carte. Aucun n'est « codé en dur » dans le moteur : on peut en
 * ajouter ou en changer depuis l'écran d'accueil (réglages avancés) ou ce fichier.
 *
 * Conditions à respecter (sources publiques, à re-vérifier avant diffusion) :
 *  - Données OpenStreetMap : licence ODbL, attribution « © contributeurs OpenStreetMap » visible.
 *  - tile.openstreetmap.org : serveur communautaire, usage intensif / pré-chargement interdit sans
 *    autorisation, Referer valide et attribution obligatoires. NON utilisé par défaut.

 *  - IGN Géoplateforme (vue aérienne) : orthophotographies en accès libre sans clé (Licence Ouverte Etalab 2.0), attribution « © IGN »
 *    obligatoire, couverture France ; service public sans garantie de disponibilité.
 *  - OpenFreeMap : instance publique gratuite, sans clé, attribution « © OpenMapTiles, données ©
 *    OpenStreetMap » (ajoutée automatiquement par le style). Aucun SLA contractuel.
 *  - Nominatim public : 1 requête/s maximum pour l'ensemble de l'application, Referer ou User-Agent
 *    identifiant l'application, pas de requêtes périodiques ; mise en cache recommandée.
 */
export type MapProviderId = 'openfreemap' | 'osm-raster' | 'ign-aerial' | 'custom-style' | 'test-local';

export interface MapProviderConfig {
  id: MapProviderId;
  label: string;
  description: string;
  /** URL d'un style MapLibre (JSON). */
  styleUrl?: string;
  /** Gabarit de tuiles raster {z}/{x}/{y}, utilisé si `styleUrl` est absent. */
  rasterTiles?: string[];
  attribution?: string;
  maxZoom: number;
}

export const MAP_PROVIDERS: Record<MapProviderId, MapProviderConfig> = {
  openfreemap: {
    id: 'openfreemap',
    label: 'OpenFreeMap (vectoriel, OSM)',
    description: 'Données OpenStreetMap en tuiles vectorielles, sans clé API. Recommandé.',
    styleUrl: 'https://tiles.openfreemap.org/styles/liberty',
    maxZoom: 19,
  },
  'osm-raster': {
    id: 'osm-raster',
    label: 'Tuiles OSM officielles (usage léger uniquement)',
    description:
      "Serveur communautaire de la fondation OSM : à n'utiliser que pour des tests ponctuels (politique d'usage stricte).",
    rasterTiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
    attribution: '© <a href="https://www.openstreetmap.org/copyright">contributeurs OpenStreetMap</a>',
    maxZoom: 19,
  },
  'ign-aerial': {
    id: 'ign-aerial',
    label: 'Vue aérienne (IGN, France)',
    description: 'Orthophotographies de l’IGN (Géoplateforme), sans clé API, Licence Ouverte Etalab. Couverture : France uniquement.',
    rasterTiles: [
      'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/jpeg',
    ],
    attribution: '© <a href="https://geoservices.ign.fr/">IGN</a> — Géoplateforme (Licence Ouverte Etalab 2.0)',
    maxZoom: 19,
  },
  'custom-style': {
    id: 'custom-style',
    label: 'Style MapLibre personnalisé',
    description: "URL d'un style JSON (fournisseur commercial ou auto-hébergé).",
    maxZoom: 20,
  },
  'test-local': {
    id: 'test-local',
    label: 'Style local de test (sans réseau)',
    description: 'Fond uni généré localement : sert aux tests automatisés de calage.',
    maxZoom: 20,
  },
};

export const DEFAULT_GEOCODER_URL = 'https://nominatim.openstreetmap.org/search';
/** Délai maximal de chargement du style avant de basculer vers le mode schématique. */
export const STYLE_LOAD_TIMEOUT_MS = 10_000;
export const MIN_ZOOM = 11;
export const DEFAULT_ZOOM = 17;
