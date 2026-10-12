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
};

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
  const rule = HIGHWAY[hw];
  if (!rule) return { excluded: 'excluded_class' };
  if (hw === 'service' && tags.service && EXCLUDED_SERVICE.has(tags.service)) return { excluded: 'excluded_service' };
  if (hw === 'footway' && tags.footway && EXCLUDED_FOOTWAY.has(tags.footway)) return { excluded: 'excluded_footway' };

  const access = tags.access;
  let foot = rule.foot;
  let motor = rule.motor;
  if (access && DENIED.has(access)) {
    foot = tags.foot === 'yes' || tags.foot === 'designated' || tags.foot === 'permissive';
    motor = tags.motor_vehicle === 'yes' || tags.motor_vehicle === 'permissive';
  }
  if (tags.foot && DENIED.has(tags.foot)) foot = false;
  for (const k of ['motor_vehicle', 'vehicle', 'motorcar']) if (tags[k] && DENIED.has(tags[k] as string)) motor = false;
  if (!foot && !motor) return { excluded: 'no_access' };

  const w = parseWidth(tags.width);
  let flags = 0;
  if (foot) flags |= EdgeFlag.Foot;
  if (motor) flags |= EdgeFlag.Motor;
  if (tags.bridge && tags.bridge !== 'no') flags |= EdgeFlag.Bridge;
  if (tags.tunnel && tags.tunnel !== 'no') flags |= EdgeFlag.Tunnel;
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

export function isBuilding(tags: Tags): boolean {
  return !!tags.building && tags.building !== 'no';
}
