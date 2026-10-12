import type { LngLat, Vec2 } from '../geo/mercator';
import type { Provenance } from '../nav/graph';
import type { Route } from '../nav/route';

export type Id = string;

// --- Causalité (cahier §14) ---------------------------------------------------
export interface Cause {
  kind: 'scenario_plan' | 'scenario_event' | 'transition' | 'player_order' | 'rule';
  /** Identifiant de l'élément à l'origine (événement, plan, groupe parent…). */
  refId: string;
  /** Phrase explicative en français, reprise par le journal. */
  note: string;
}

// --- Journal explicatif --------------------------------------------------------
export interface LogEvent {
  id: number;
  tick: number;
  simTimeMs: number;
  level: 'info' | 'warn' | 'alert';
  subject?: { type: 'group' | 'unit' | 'vehicle' | 'edge' | 'scenario'; id: Id };
  /** Code stable, ex. `group.created`, `group.arrived`, `group.rerouted`. */
  code: string;
  text: string;
  why: Cause;
  data?: Record<string, number | string>;
}

export interface HistoryEntry {
  tick: number;
  simTimeMs: number;
  code: string;
  text: string;
  why: Cause;
}

// --- Lieux -----------------------------------------------------------------------
export interface Anchor {
  id: Id;
  kind: 'node' | 'space' | 'place';
  pos: Vec2;
  radius: number;
  /** Nom affiché (nom OSM tel quel pour les lieux réels, décision v0.4 ; libellé fictif sinon). */
  label: string;
  source: Provenance;
}

// --- Groupes ------------------------------------------------------------------------
export type GatheringKind = 'march' | 'static' | 'secondary';
export type GroupPhase = 'forming' | 'moving' | 'waiting' | 'settled' | 'dispersing' | 'dispersed';
export type SimLevel = 0 | 1 | 2;

export interface GroupPlan {
  destination?: Anchor;
  waypoints: Anchor[];
  onArrival: 'settle' | 'join_target' | 'hold';
  joinTargetId?: Id;
  /** Attente maximale si aucun itinéraire (ms, 0 = illimitée). */
  patienceMs: number;
  dispersalExit?: Anchor;
}

export interface GroupSpec {
  label: string;
  kind: GatheringKind;
  size: number;
  /** March : point d'origine. Static : centre du rassemblement. */
  origin: Vec2;
  /** March : `inside` = colonne centrée sur l'origine ; `gateway` = colonne entièrement derrière l'origine (entrée de zone). */
  entry?: 'inside' | 'gateway';
  startAtMs?: number;
  plan?: Partial<GroupPlan>;
  /** Anchor d'un rassemblement statique. */
  anchor?: Anchor;
  seed?: number;
  cohesion?: number;
  tension?: number;
  /** Surcharge de vitesse (m/s) pour ce groupe. */
  speedMps?: number;
  parentId?: Id;
}

/** Individus simulés : tableaux typés, un enregistrement par personne (aucun plafond structurel). */
export interface MemberSet {
  n: number;
  subgroupSize: number;
  x: Float32Array;
  y: Float32Array;
  /** Positions du tick précédent (interpolation du rendu). */
  px: Float32Array;
  py: Float32Array;
  /** Cibles (tampon de travail). */
  tx: Float32Array;
  ty: Float32Array;
  /** Décalage latéral normalisé stable, dans [-1, 1]. */
  lat: Float32Array;
  /** Graine individuelle stable (bruit, apparence — le rendu choisit le sprite). */
  seed: Uint32Array;
  /** Rôle sémantique (0 = standard ; codes réservés au scénario / phase 4). */
  role: Uint8Array;
  /** Indice de créneau dans la disposition statique. */
  slotOf: Uint32Array;
  /** Premier individu encore présent (les précédents ont quitté la zone). */
  activeStart: number;
}

export interface StaticLayout {
  anchor: Vec2;
  /** Prochain indice de candidat de la spirale (état du générateur déterministe). */
  k: number;
  rot: number;
  density: number;
  /** Points (x,y) acceptés, par rayon croissant (propriété de préfixe : la disposition de n personnes est un préfixe de celle de n+k). */
  pts: Float32Array;
  count: number;
  rMax: number;
  overflow: number;
}

export interface Blend {
  t0Ms: number;
  durMs: number;
  fromX: Float32Array;
  fromY: Float32Array;
}

export interface Dispersal {
  route: Route;
  startMs: number;
  durationMs: number;
  speedMps: number;
  maxDist: number;
  /** Distance (m) de chaque individu à l'ancre (créneau). */
  dist: Float32Array;
}

export interface CrowdGroup {
  id: Id;
  label: string;
  kind: GatheringKind;
  phase: GroupPhase;
  members: MemberSet;
  cohesion: number;
  tension: number;
  morale: number;
  plan: GroupPlan;
  anchor: Anchor | null;
  origin: Cause;
  parentId?: Id;
  history: HistoryEntry[];
  seed: number;
  startAtMs: number;
  // marche
  route: Route | null;
  sCentre: number;
  columnLength: number;
  frontWidth: number;
  speedMps: number;
  speedCause: string;
  speedOverride?: number;
  /** Facteur de vitesse dû aux AUTRES foules sur les rues de la colonne (calculé avec les états de rue). */
  otherCrowdFactor: number;
  waitingSinceMs: number | null;
  patienceReported: boolean;
  lastRouteStateVersion: number;
  lastRetryTick: number;
  entry: 'inside' | 'gateway';
  // arrivée / rassemblement statique
  layout: StaticLayout | null;
  settleAtS: number;
  // dispersion
  dispersal: Dispersal | null;
  // niveaux de simulation
  level: SimLevel;
  /** Vrai quand les positions sont périmées (sortie du niveau N0) et doivent être réalignées sur les cibles sans transition. */
  needsSnap: boolean;
  blend: Blend | null;
}

export type Command =
  | { kind: 'close_street'; edgeId: number; cause: Cause }
  | { kind: 'open_street'; edgeId: number; cause: Cause }
  | { kind: 'begin_dispersal'; groupId: Id; exit: Anchor; durationMs: number; cause: Cause };

export interface Focus {
  x: number;
  y: number;
  /** Rayon d'attention en mètres (ex. demi-diagonale de la fenêtre de caméra). */
  radius: number;
}

export interface SimOrigin {
  origin: LngLat;
}
