/**
 * Types de données partagés. L'état des entités est exprimé en mètres locaux (x = est, y = nord)
 * par rapport à l'origine de la partie : il ne dépend d'aucune bibliothèque cartographique.
 * (Phase 2 : seulement un échantillon de démonstration ; le moteur complet viendra en phase 3.)
 */
import type { LngLat, Vec2 } from '../geo/mercator';

export type Id = string;

export interface City {
  id: string;
  name: string;
  center: LngLat;
  /** Libellé complet (résultat de géocodage) ; absent pour les villes prédéfinies. */
  label?: string;
}

/** Zone de jeu rectangulaire centrée sur l'origine, en demi-côtés (mètres). */
export interface GameZone {
  halfWidth: number;
  halfHeight: number;
}

export type UnitKind = 'crs' | 'police';
export interface ForceUnit {
  id: Id;
  kind: UnitKind;
  callsign: string; // identifiant fictif de jeu, ex. « CRS-J 07/2 »
  num: string; // numéro court affiché sur le pion
  pos: Vec2;
  heading: number; // radians, 0 = est, sens trigonométrique
  headcount: number;
  fatigue: number; // 0..1
  status: string;
}

export type VehicleKind = 'van' | 'police_car' | 'water_cannon' | 'ambulance' | 'fire_truck';
export interface Vehicle {
  id: Id;
  kind: VehicleKind;
  callsign: string;
  pos: Vec2;
  heading: number;
  crew: number;
  status: string;
}

export type Disposition = 'peaceful' | 'restless' | 'hostile';
export interface CrowdGroup {
  id: Id;
  label: string;
  pos: Vec2;
  size: number;
  tension: number; // 0..100
  disposition: Disposition;
  seed: number;
}

export type IncidentKind = 'bin_fire' | 'vandalism' | 'projectiles' | 'casualty';
export interface Incident {
  id: Id;
  kind: IncidentKind;
  pos: Vec2;
  severity: 1 | 2 | 3 | 4 | 5;
  startedAtMs: number;
  label: string;
}

/** Segment de rue (polyligne en mètres locaux). */
export interface StreetSegment {
  id: Id;
  points: Vec2[];
  name?: string;
}

export interface LogEntry {
  id: number;
  atMs: number;
  level: 'info' | 'warn' | 'alert';
  text: string;
}

export interface Banner {
  id: number;
  level: 'info' | 'warn' | 'alert';
  text: string;
  untilMs: number;
}

export type EntityRef =
  | { type: 'unit'; id: Id }
  | { type: 'vehicle'; id: Id }
  | { type: 'group'; id: Id }
  | { type: 'incident'; id: Id };

/** Contenu rendu par la couche de jeu (immuable du point de vue du renderer). */
export interface RenderSnapshot {
  origin: LngLat;
  zone: GameZone;
  units: ForceUnit[];
  vehicles: Vehicle[];
  groups: CrowdGroup[];
  incidents: Incident[];
  segments: StreetSegment[];
  blockedSegmentIds: ReadonlySet<Id>;
  selection: EntityRef | null;
}
