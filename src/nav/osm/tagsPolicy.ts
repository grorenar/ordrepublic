import { EdgeClass, EdgeFlag, type EdgeClassId } from '../graph';

export type Tags = Record<string, string>;

export interface HighwayInfo {
  cls: EdgeClassId;
  flags: number;
  width: number;
  widthDefaulted: boolean;
  /** Le sens de la voie doit être inversé (oneway=-1). */
  reverse: boolean;
}

interface ClassRule {
  cls: EdgeClassId;
  foot: boolean;
  motor: boolean;
  width: number;
}

/**
 * Politique de filtrage des voies OSM pour la navigation du jeu (⚠️ à revalider sur le wiki OSM).
 * Exclus : autoroutes/voies rapides, chemins en construction/projet, trottoirs et passages piétons
 * cartographiés comme voies séparées (la rue est modélisée comme un corridor unique), accès privés.
 */
const HIGHWAY: Record<string, ClassRule> = {
  primary: { cls: EdgeClass.Primary, foot: true, motor: true, width: 14 },
  primary_link: { cls: EdgeClass.Primary, foot: true, motor: true, width: 8 },
  secondary: { cls: EdgeClass.Secondary, foot: true, motor: true, width: 12 },
  secondary_link: { cls: EdgeClass.Secondary, foot: true, motor: true, width: 7 },
  tertiary: { cls: EdgeClass.Tertiary, foot: true, motor: true, width: 10 },
  tertiary_link: { cls: EdgeClass.Tertiary, foot: true, motor: true, width: 6 },
  unclassified: { cls: EdgeClass.Unclassified, foot: true, motor: true, width: 8 },
  residential: { cls: EdgeClass.Residential, foot: true, motor: true, width: 8 },
  living_street: { cls: EdgeClass.LivingStreet, foot: true, motor: true, width: 7 },
  service: { cls: EdgeClass.Service, foot: true, motor: true, width: 5 },
  pedestrian: { cls: EdgeClass.Pedestrian, foot: true, motor: false, width: 10 },
  footway: { cls: EdgeClass.Footway, foot: true, motor: false, width: 3 },
  path: { cls: EdgeClass.Path, foot: true, motor: false, width: 2.5 },
  steps: { cls: EdgeClass.Steps, foot: true, motor: false, width: 2.5 },
  track: { cls: EdgeClass.Track, foot: true, motor: false, width: 4 },
  // voies de bus en site propre (BHNS, ex. Mettis à Metz) : praticables à pied, fermées à la circulation générale
  busway: { cls: EdgeClass.Busway, foot: true, motor: false, width: 8 },
};

/** Voie de bus en site propre : `highway=busway`, `service=busway|bus`, ou accès réservé aux bus (`bus=designated`, `psv=designated`). */
export function isBusway(tags: Tags): boolean {
  if (tags.highway === 'busway') return true;
  if (tags.highway === 'service' && (tags.service === 'busway' || tags.service === 'bus')) return true;
  const reserved = tags.bus === 'designated' || tags.psv === 'designated' || tags.bus === 'yes' || tags.psv === 'yes';
  return reserved && !!tags.access && DENIED.has(tags.access) && (tags.highway === 'service' || tags.highway === 'residential' || tags.highway === 'unclassified' || tags.highway === 'tertiary');
}

const EXCLUDED_SERVICE = new Set(['parking_aisle', 'driveway', 'drive-through', 'emergency_access']);
const EXCLUDED_FOOTWAY = new Set(['sidewalk', 'crossing', 'traffic_island']);
const DENIED = new Set(['no', 'private']);

export function parseWidth(v: string | undefined): number | null {
  if (!v) return null;
  const m = /^\s*(\d+(?:[.,]\d+)?)\s*(m)?\s*$/.exec(v);
  if (!m) return null;
  const w = parseFloat((m[1] as string).replace(',', '.'));
  return w >= 1 && w <= 60 ? w : null;
}

export type ExclusionReason =
  | 'not_highway'
  | 'excluded_class'
  | 'excluded_service'
  | 'excluded_footway'
  | 'no_access'
  | 'area';

export function classifyHighway(tags: Tags): HighwayInfo | { excluded: ExclusionReason } {
  const hw = tags.highway;
  if (!hw) return { excluded: 'not_highway' };
  if (tags.area === 'yes') return { excluded: 'area' };
  const busway = isBusway(tags);
  const rule = busway ? HIGHWAY.busway : HIGHWAY[hw];
  if (!rule) return { excluded: 'excluded_class' };
  if (!busway && hw === 'service' && tags.service && EXCLUDED_SERVICE.has(tags.service)) return { excluded: 'excluded_service' };
  if (hw === 'footway' && tags.footway && EXCLUDED_FOOTWAY.has(tags.footway)) return { excluded: 'excluded_footway' };

  const access = tags.access;
  let foot = rule.foot;
  let motor = rule.motor;
  if (busway) {
    // l'interdiction légale (access=no, foot=no) n'empêche pas matériellement un cortège de s'y engager
    foot = true;
    motor = false;
  } else if (access && DENIED.has(access)) {
    foot = tags.foot === 'yes' || tags.foot === 'designated' || tags.foot === 'permissive';
    motor = tags.motor_vehicle === 'yes' || tags.motor_vehicle === 'permissive';
  }
  if (!busway && tags.foot && DENIED.has(tags.foot)) foot = false;
  for (const k of ['motor_vehicle', 'vehicle', 'motorcar']) if (tags[k] && DENIED.has(tags[k] as string)) motor = false;
  if (!foot && !motor) return { excluded: 'no_access' };

  const w = parseWidth(tags.width);
  let flags = 0;
  if (foot) flags |= EdgeFlag.Foot;
  if (motor) flags |= EdgeFlag.Motor;
  if (tags.bridge && tags.bridge !== 'no') flags |= EdgeFlag.Bridge;
  // passage souterrain, passage couvert sous un bâtiment (tunnel=building_passage), voie couverte ou en niveau négatif :
  // les bâtiments cartographiés au-dessus ne sont pas des murs
  if ((tags.tunnel && tags.tunnel !== 'no') || tags.covered === 'yes' || Number(tags.layer) < 0) flags |= EdgeFlag.Tunnel;
  let reverse = false;
  const ow = tags.oneway;
  if (ow === 'yes' || ow === '1' || ow === 'true' || tags.junction === 'roundabout') flags |= EdgeFlag.Oneway;
  else if (ow === '-1' || ow === 'reverse') {
    flags |= EdgeFlag.Oneway;
    reverse = true;
  }
  if (w === null) flags |= EdgeFlag.WidthDefault;
  return { cls: rule.cls, flags, width: w ?? rule.width, widthDefaulted: w === null, reverse };
}

export type SpaceKind = 'square' | 'park' | 'pedestrian_area';
export function classifySpace(tags: Tags): SpaceKind | null {
  if (tags.place === 'square') return 'square';
  if (tags.highway === 'pedestrian' && tags.area === 'yes') return 'pedestrian_area';
  if (tags.leisure === 'park' || tags.leisure === 'garden' || tags.leisure === 'common') return 'park';
  return null;
}

/** Administration publique (mairie, préfecture, tribunal, bâtiment gouvernemental) d'après les étiquettes OSM. */
export function isAdministration(tags: Tags): boolean {
  return (
    tags.amenity === 'townhall' ||
    tags.amenity === 'courthouse' ||
    tags.office === 'government' ||
    !!tags.government ||
    tags.building === 'government' ||
    tags.building === 'civic'
  );
}

export function isBuilding(tags: Tags): boolean {
  return (!!tags.building && tags.building !== 'no') || isAdministration(tags);
}

const COMMERCE_AMENITIES = new Set(['restaurant', 'cafe', 'bar', 'fast_food', 'pub', 'bank', 'pharmacy', 'marketplace']);
const SCHOOL_AMENITIES = new Set(['school', 'kindergarten', 'college', 'university']);
const PUBLIC_AMENITIES = new Set(['townhall', 'courthouse', 'post_office', 'library', 'community_centre']);
const FURNITURE_AMENITIES = new Set(['waste_basket', 'bench']);

/** Pour la requête Overpass : valeurs d'`amenity` d'intérêt (jamais la police ni la gendarmerie). */
export const POI_AMENITY_REGEX = '^(restaurant|cafe|bar|fast_food|pub|bank|pharmacy|marketplace|school|kindergarten|college|university|townhall|courthouse|post_office|library|community_centre|waste_basket|bench)$';

export interface PoiClass {
  kind: 'commerce' | 'public' | 'school' | 'company' | 'furniture';
  category: string;
}

/**
 * Lieu d'intérêt d'après les étiquettes OSM (cahier §16.2). Les installations de police et de gendarmerie ne sont
 * JAMAIS retenues (aucune cible, aucune catégorisation).
 */
export function classifyPoi(tags: Tags): PoiClass | null {
  if (tags.amenity === 'police' || tags.amenity === 'gendarmerie' || tags.office === 'police') return null;
  const am = tags.amenity;
  if (am && FURNITURE_AMENITIES.has(am)) return { kind: 'furniture', category: am };
  if (isAdministration(tags) || (am && PUBLIC_AMENITIES.has(am))) return { kind: 'public', category: am ?? tags.office ?? tags.government ?? 'administration' };
  if (am && SCHOOL_AMENITIES.has(am)) return { kind: 'school', category: am };
  if (tags.shop && tags.shop !== 'no') return { kind: 'commerce', category: tags.shop };
  if (am && COMMERCE_AMENITIES.has(am)) return { kind: 'commerce', category: am };
  if (tags.office) return { kind: 'company', category: tags.office };
  return null;
}
