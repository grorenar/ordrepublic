import { LocalFrame, type LngLat } from '../../geo/mercator';
import { packGraph, type Pack } from '../pack';
import { buildGraphFromOsm, type BuildReport } from './buildGraph';
import { parseOverpass } from './parseOverpass';
import { POI_AMENITY_REGEX } from './tagsPolicy';

/** Emprise par défaut d'un paquet de ville : couvre la plus grande zone de jeu (2 800 × 2 100 m) avec marge. */
export const PACK_HALF_WIDTH_M = 1700;
export const PACK_HALF_HEIGHT_M = 1350;
/** Garde-fou : emprise maximale d'une requête (km²). Refus au-delà : pas de requête massive. */
export const MAX_QUERY_AREA_KM2 = 12;

export interface CitySpec {
  id: string;
  name: string;
  center: LngLat;
}

export interface Bbox {
  south: number;
  west: number;
  north: number;
  east: number;
}

export function bboxAround(center: LngLat, halfWidthM = PACK_HALF_WIDTH_M, halfHeightM = PACK_HALF_HEIGHT_M): Bbox {
  const f = new LocalFrame(center);
  const sw = f.toLngLat({ x: -halfWidthM, y: -halfHeightM });
  const ne = f.toLngLat({ x: halfWidthM, y: halfHeightM });
  return { south: sw.lat, west: sw.lng, north: ne.lat, east: ne.lng };
}

export function bboxAreaKm2(b: Bbox): number {
  const midLat = ((b.north + b.south) / 2) * (Math.PI / 180);
  const h = (b.north - b.south) * 111.32;
  const w = (b.east - b.west) * 111.32 * Math.cos(midLat);
  return Math.abs(h * w);
}

export class PackSafetyError extends Error {}

export function checkBboxSafety(b: Bbox, maxKm2 = MAX_QUERY_AREA_KM2): void {
  const a = bboxAreaKm2(b);
  if (!(a > 0) || a > maxKm2) throw new PackSafetyError(`Emprise de ${a.toFixed(1)} km² refusée (maximum ${maxKm2} km²) : une requête plus grande n'est pas adaptée aux services publics. Réduisez la zone.`);
}

/**
 * Requête Overpass unique et bornée : voies, places, parcs et (optionnellement) bâtiments de l'emprise.
 * Les relations (multipolygones) ne sont pas demandées : elles ne sont pas gérées par le constructeur de graphe.
 */
export function overpassQuery(b: Bbox, o: { buildings?: boolean; timeoutS?: number } = {}): string {
  const bb = `${b.south.toFixed(6)},${b.west.toFixed(6)},${b.north.toFixed(6)},${b.east.toFixed(6)}`;
  const parts = [
    `way["highway"](${bb});`,
    `way["place"="square"](${bb});`,
    `way["leisure"~"^(park|garden|common)$"](${bb});`,
    // administrations (mairie, tribunal, bâtiments gouvernementaux) : pour placer un piquet devant une vraie administration
    `way["amenity"~"^(townhall|courthouse)$"](${bb});`,
    `way["office"="government"](${bb});`,
    // lieux d'intérêt (commerces, écoles, établissements, mobilier) : affichage et contexte de rue, jamais des cibles
    `nwr["shop"](${bb});`,
    `nwr["amenity"~"${POI_AMENITY_REGEX}"](${bb});`,
    `nwr["office"](${bb});`,
  ];
  if (o.buildings !== false) parts.push(`way["building"](${bb});`);
  return `[out:json][timeout:${o.timeoutS ?? 90}];\n(\n  ${parts.join('\n  ')}\n);\n(._;>;);\nout body qt;`;
}

export function licenseText(city: CitySpec, generatedAt: string): string {
  return `# Licence des données du paquet « ${city.name} »

Ce paquet contient des **données dérivées d'OpenStreetMap** (réseau de voies, places, parcs, emprises de bâtiments, noms).

© Contributeurs OpenStreetMap — données disponibles sous la licence ODbL 1.0 :
https://www.openstreetmap.org/copyright · https://opendatacommons.org/licenses/odbl/1-0/

- Généré le ${generatedAt} par \`npm run data:pack\` (Ordre Public).
- Si vous **redistribuez publiquement** ce paquet (dépôt public, site hébergé…), il constitue une base de données dérivée : il doit rester sous licence ODbL, avec cette attribution et la mention des modifications (extraction, filtrage, simplification, conversion en graphe).
- Un usage strictement personnel et local ne déclenche pas d'obligation de redistribution.
- Ce n'est pas un avis juridique : consultez le texte de la licence.
`;
}

export interface PackBuildResult {
  pack: Pack;
  report: BuildReport;
}

/** Construit le paquet d'une ville depuis une réponse Overpass JSON déjà obtenue (aucun accès réseau ici). */
export function buildCityPack(city: CitySpec, overpassJson: unknown, opts: { generatedAt: string; bbox?: Bbox; osmTimestamp?: string }): PackBuildResult {
  const data = parseOverpass(overpassJson);
  const { graph, report } = buildGraphFromOsm(data, { origin: city.center, osmTimestamp: opts.osmTimestamp, label: city.name });
  const meta = {
    city: city.id,
    name: city.name,
    generatedAt: opts.generatedAt,
    source: 'osm' as const,
    osmTimestamp: opts.osmTimestamp,
    bbox: opts.bbox,
    attribution: '© contributeurs OpenStreetMap',
    license: 'ODbL 1.0',
    report: report as unknown as Record<string, unknown>,
  };
  return { pack: packGraph(graph, meta), report };
}
