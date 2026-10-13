import type { LngLat, Vec2 } from '../geo/mercator';
import type { Provenance } from '../nav/graph';
import type { Route } from '../nav/route';
import type { ColumnProfile } from './column';

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
  subject?: { type: 'group' | 'unit' | 'vehicle' | 'edge' | 'scenario' | 'incident' | 'poi'; id: Id };
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
  /** `leave` : les individus sortent de la zone un à un en franchissant la fin de l'itinéraire (dispersion vers une sortie). */
  onArrival: 'settle' | 'join_target' | 'hold' | 'leave';
  joinTargetId?: Id;
  /** Clé du rassemblement à rejoindre, résolue à la création du groupe (scénarios). */
  joinTargetKey?: string;
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
  /** Rassemblement statique : sens (vecteur unitaire) dans lequel il s'étire de préférence, typiquement le sens de départ du cortège. */
  fillBias?: Vec2;
}

/** Individus simulés : tableaux typés, un enregistrement par personne (aucun plafond structurel). */
export interface MemberSet {
  n: number;
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
  /** État du remplissage géodésique (reprise au prochain agrandissement du groupe). */
  geo?: GeoFill;
  /** Réglages du remplissage : coût relatif d'un espace ouvert, pénalité des cellules à l'opposé du sens de départ. */
  fill?: { openCost: number; behindPenalty: number; dir?: Vec2 };
}

/** Remplissage d'un rassemblement par distance de MARCHE depuis l'ancre (contourne les bâtiments, reste sur les surfaces praticables). */
export interface GeoFill {
  heap: import('../nav/heap').MinHeap;
  seen: Set<number>;
  carry: number;
  cells: number;
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
  /** Tension de fond vers laquelle le groupe retombe en l'absence d'incident (modifiée par le scénario). */
  baseTension: number;
  /** Jusqu'à cet instant (ms de jeu), le groupe est « affecté » par un incident proche. */
  affectedUntilMs: number;
  /** Dernier déclenchement d'un incident par ce groupe (ms de jeu) : délai de réarmement. */
  lastIncidentMs: number;
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
  /** Densité courante de la colonne (personnes/m²) : monte quand elle est bloquée, redescend quand elle repart. */
  density: number;
  /** Premier individu déjà entré dans la zone (colonne arrivant par une porte) : les précédents attendent hors de la zone, invisibles. */
  entryStart: number;
  /** Premier individu déjà sorti de la zone (groupe qui part par une sortie) : les suivants sont hors zone, invisibles. = n tant que personne n'est sorti. */
  exitStart: number;
  /** Positions de départ (x,y) d'une colonne qui se forme à partir d'un rassemblement : chaque individu rejoint le début de la route depuis SA place. */
  startPos: Float32Array | null;
  /** Distance initiale (m) de chaque individu derrière la tête de colonne (|s| au départ) : sert à étaler le démarrage de tout le monde. */
  startBehind: Float32Array | null;
  /** Instant (ms de jeu) où le cortège s'est mis en marche depuis un rassemblement. */
  marchStartMs: number;
  /** Espace praticable le long de la route (largeur locale de chaque position de la colonne). */
  profile: ColumnProfile | null;
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
  /** Aire cumulée que doit atteindre la TÊTE de colonne pour que tous les individus aient rejoint leur créneau (Infinity = arrivée non commencée). */
  settleAtS: number;
  // dispersion
  dispersal: Dispersal | null;
  // niveaux de simulation
  level: SimLevel;
  /** Niveaux par bloc d'individus (très gros groupes en marche) ; null = niveau unique du groupe. */
  blocks: BlockLevels | null;
  /** Vrai quand les positions sont périmées (sortie du niveau N0) et doivent être réalignées sur les cibles sans transition. */
  needsSnap: boolean;
  blend: Blend | null;
}

export interface BlockLevels {
  size: number;
  level: Uint8Array;
  /** 1 si le bloc était en N0 (positions périmées) : à réaligner sur ses cibles dès qu'il repasse en N1/N2. */
  stale: Uint8Array;
}

// --- Forces de l'ordre et véhicules (phase 3c) ---------------------------------
export type ForceKind = 'crs' | 'police_nationale' | 'gendarmerie_mobile' | 'unite_speciale';
export type VehicleKind =
  | 'fourgon_police'
  | 'fourgon_crs'
  | 'voiture_police'
  | 'ambulance'
  | 'camion_pompiers'
  | 'vehicule_secours_leger'
  | 'vehicule_gendarmerie'
  | 'voiture_banalisee'
  | 'moto_police'
  | 'camion_a_eau';
/** États d'unité (↔ anneaux de la planche de référence). */
export type UnitStatus = 'idle' | 'moving' | 'waiting' | 'engaged' | 'in_difficulty' | 'unavailable';

export interface Loadout {
  shield: boolean;
  helmet: boolean;
}

export interface OrderState {
  id: Id;
  kind: 'move';
  target: Vec2;
  cause: Cause;
  issuedAtMs: number;
}

/** État de déplacement commun aux unités et aux véhicules. */
export interface Mover {
  mode: 'foot' | 'vehicle';
  x: number;
  y: number;
  /** Position et cap au tick précédent (interpolation du rendu). */
  px: number;
  py: number;
  heading: number;
  prevHeading: number;
  speedMps: number;
  route: Route | null;
  routeS: number;
  status: UnitStatus;
  order: OrderState | null;
  waitingSinceMs: number | null;
  lastRouteStateVersion: number;
  lastRetryTick: number;
}

export interface UnitEntity extends Mover {
  id: Id;
  entity: 'unit';
  force: ForceKind;
  loadout: Loadout;
  /** Identifiant fictif STABLE de jeu (jamais réattribué, jamais modifié par un déplacement ou un zoom). */
  callsign: string;
  /** Numéro court affiché sur le pion. */
  num: string;
  headcount: number;
}

export interface VehicleEntity extends Mover {
  id: Id;
  entity: 'vehicle';
  /** Avertisseurs lumineux et sonores : plus rapide (limites non respectées), sens interdits permis, ralentit près de la foule. */
  emergency: boolean;
  vehicle: VehicleKind;
  callsign: string;
  crew: number;
}

export type MoverEntity = UnitEntity | VehicleEntity;

export interface UnitSpec {
  force: ForceKind;
  loadout?: Partial<Loadout>;
  callsign: string;
  num: string;
  headcount: number;
  pos: Vec2;
  heading?: number;
}

export interface VehicleSpec {
  vehicle: VehicleKind;
  callsign: string;
  crew: number;
  pos: Vec2;
  heading?: number;
}

export type OrderRequest =
  | { kind: 'move'; ids: Id[]; target: Vec2 }
  | { kind: 'cancel'; ids: Id[] }
  /** Active ou coupe les avertisseurs des véhicules (les unités à pied sont ignorées). */
  | { kind: 'lights'; ids: Id[]; on: boolean };

export interface OrderResult {
  id: Id;
  ok: boolean;
  /** Longueur de l'itinéraire (m) si l'ordre est accepté. */
  routeLengthM?: number;
  /** Raison du refus, en français, sinon. */
  reason?: string;
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

// --- Monde : décor, lieux d'intérêt, incidents (phase 4) -----------------------------
/** Objets urbains. Ce sont des DONNÉES (le rendu choisit le sprite) : le moteur ne connaît pas les images. */
export type DecorKind = 'bin' | 'bench' | 'barrier' | 'cone' | 'container' | 'shopfront' | 'bus_shelter' | 'debris';
export type DecorState = 'intact' | 'damaged' | 'burning' | 'burnt' | 'destroyed';

export interface DecorItem {
  id: Id;
  kind: DecorKind;
  x: number;
  y: number;
  heading: number;
  state: DecorState;
  /** `osm` : mobilier cartographié ; `synthetic` : objet de scénario généré de façon déterministe le long des rues. */
  source: 'osm' | 'synthetic';
  /** Lieu d'intérêt de rattachement (une vitrine fictive appartient à un commerce fictif). */
  poiId?: Id;
  /** Cause de sa présence (génération du monde, fermeture de rue du scénario…). */
  cause: Cause;
  /** Incident en cours qui l'affecte. */
  incidentId?: Id;
}

export type PoiState = 'intact' | 'damaged' | 'burning' | 'destroyed';

/**
 * Lieu d'intérêt. `fictional` : objet de scénario synthétique (seule cible possible d'un incident) ; un lieu OSM est
 * affiché avec son nom mais n'est JAMAIS ciblé ni classé (cahier §16.4).
 */
export interface Poi {
  id: Id;
  kind: 'commerce' | 'public' | 'school' | 'company' | 'furniture' | 'gathering';
  category: string;
  name?: string;
  x: number;
  y: number;
  radius: number;
  source: Provenance;
  osmId?: number;
  fictional: boolean;
  /** Dégâts cumulés 0..100 (persistants). */
  damage: number;
  state: PoiState;
  decorIds: Id[];
  incidentIds: Id[];
  /** Catégorie générale de la rue (ex. « rue commerçante »), seule information tirée d'OSM sur les commerces. */
  streetCategory?: string;
}

export type IncidentKind = 'bin_fire' | 'fire' | 'furniture_damage' | 'window_break';
export type IncidentState = 'emerging' | 'active' | 'escalating' | 'contained' | 'resolved' | 'lingering';

export interface Incident {
  id: Id;
  kind: IncidentKind;
  x: number;
  y: number;
  severity: 1 | 2 | 3 | 4 | 5;
  state: IncidentState;
  startedAtMs: number;
  /** Durée naturelle restante du phénomène à partir de `stateSinceMs` (ms). */
  durationMs: number;
  stateSinceMs: number;
  endedAtMs: number | null;
  targetDecorId: Id;
  poiId?: Id;
  /** Libellé explicitement fictif, affiché tel quel. */
  label: string;
  /** Cause d'origine (règle de tension d'un groupe, événement de scénario, propagation d'un autre incident). */
  cause: Cause;
  /** Incident parent (propagation). */
  parentId?: Id;
  /** Incidents et objets engendrés (chaînage explicite). */
  childIds: Id[];
  /** Groupe de foule à l'origine (si l'incident vient de la foule). */
  groupId?: Id;
  /** Secondes cumulées sans surveillance par une unité (pilote l'escalade). */
  unattendedS: number;
  /** Secondes consécutives de présence d'une unité (pilote le confinement). */
  attendedS: number;
  /** Coût fictif cumulé (€). */
  costEur: number;
  history: HistoryEntry[];
}

export interface IncidentStats {
  total: number;
  active: number;
  resolved: number;
  fires: number;
  byKind: Record<IncidentKind, number>;
  costEur: number;
  damagedPois: number;
  damagedDecor: number;
}
