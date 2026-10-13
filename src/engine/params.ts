import { DEFAULT_NAV_PARAMS, type NavParams } from '../nav/params';

/**
 * Paramètres de simulation. TOUTES ces valeurs sont des paramètres de gameplay configurables
 * (par scénario ou par type de groupe) : aucune n'est une constante définitive, aucun plafond
 * structurel de population n'existe.
 */
export interface SimParams {
  /** Pas de simulation fixe (ms). */
  tickMs: number;
  nav: NavParams;

  // --- vitesse (m/s) par type de groupe -------------------------------------
  speedByKind: { march: number; secondary: number; dispersing: number };
  /** Largeur de rue de référence (m) en dessous de laquelle le cortège ralentit. */
  referenceStreetWidthM: number;
  /** Facteur de vitesse minimal dû à l'étroitesse de la rue. */
  narrowStreetMinFactor: number;

  // --- densités (personnes/m²) et géométrie ---------------------------------
  marchDensity: number;
  staticDensity: number;
  /** Densité minimale (personnes/m²) d'un cortège qui s'étale dans un espace large : il se relâche au lieu de ralentir. */
  marchDensityMin: number;
  /** Largeur maximale du front d'un cortège (m). */
  marchFrontWidthMaxM: number;
  /** Largeur minimale du front d'un cortège (m) : un petit groupe forme un bloc compact, pas un front de 14 m. */
  marchFrontWidthMinM: number;
  /** Rayon (m) autour de la destination dans lequel un groupe peut traverser une foule dense pour la rejoindre. */
  arrivalZoneM: number;
  /** Facteur de vitesse d'un cortège selon la classe de la voie (indice = EdgeClass) : boulevard > rue > ruelle > escaliers. */
  speedFactorByClass: Record<number, number>;
  /** Accélération/décélération maximale d'un cortège (m/s²) : les changements de type de rue sont lissés. */
  crowdAccelMps2: number;
  /** Densité (personnes/m²) d'un cortège à l'arrêt bloqué : il se tasse en bloc contre l'obstacle, sur toute la largeur praticable. */
  waitDensity: number;
  /** Demi-largeur praticable maximale (m) de chaque côté de l'axe d'une rue ; mesurée avec les bâtiments, espaces ouverts compris. */
  walkHalfWidthMaxM: number;
  /** Distance maximale (m) à laquelle une façade borde la rue ; au-delà, seul un espace ouvert cartographié élargit le corridor. */
  streetHalfWidthM: number;
  /** Largeur praticable (m) à partir de laquelle un cortège peut déborder la largeur de front des rues (places, esplanades). */
  openSpaceWidthM: number;
  /** Largeur maximale du front d'un cortège dans un espace ouvert (m). */
  openSpaceFrontMaxM: number;
  /** Vitesse maximale de variation de la densité d'un cortège qui se tasse ou se relâche (personnes/m² par s). */
  densityRatePerS: number;
  /** Intervalle entre points de mesure de la largeur praticable le long d'une rue (m). */
  walkWidthSampleEveryM: number;
  /** Trottoir supposé de chaque côté (m) d'une rue ouverte aux véhicules quand aucun bâtiment ne permet de mesurer. */
  sidewalkAllowanceM: number;
  /** Distance (m) derrière une porte d'entrée à partir de laquelle un individu est considéré hors de la zone (invisible, il n'y a pas de rue connue). */
  entryBufferM: number;
  /** Marge entre le cortège et le bord de la rue (m). */
  streetMarginM: number;
  /** Variation maximale de la longueur de colonne (m/s) : évite les sauts de position. */
  columnLengthRateMps: number;
  /** Rayon maximal exploré pour le placement d'un rassemblement statique (m). */
  staticMaxRadiusM: number;

  // --- unités et véhicules ----------------------------------------------------
  units: {
    /** Vitesse de déplacement maximale (m/s). */
    footSpeedMps: number;
    /** Plafond de vitesse d'un véhicule (m/s) ; la limite de la classe de voie s'applique en dessous (nav.speedVehicleByClass). */
    vehicleSpeedMps: number;
    /** Plafond de vitesse d'un véhicule avec avertisseurs (m/s). */
    vehicleEmergencySpeedMps: number;
    /** Distance (m) devant un véhicule à avertisseurs à partir de laquelle il ralentit à l'approche d'une foule. */
    emergencyCrowdSlowM: number;
    /** Facteur de vitesse d'un véhicule à avertisseurs près d'une foule dense. */
    emergencyCrowdFactor: number;
    /** Accélération et décélération (m/s²). */
    footAccelMps2: number;
    vehicleAccelMps2: number;
    footDecelMps2: number;
    vehicleDecelMps2: number;
    /** Vitesse de rotation maximale du cap (rad/s) ; élevée pour un piéton, limitée pour un véhicule. */
    footTurnRateRadPerS: number;
    vehicleTurnRateRadPerS: number;
    /** Distance (m) à la destination en dessous de laquelle l'ordre est considéré comme accompli. */
    arrivalToleranceM: number;
    /** Écart (m) entre unités envoyées au même point (elles ne se superposent pas). */
    formationSpacingM: number;
  };

  // --- individus -------------------------------------------------------------
  /** Raideur du rappel individuel vers sa cible (1/s). */
  memberSpring: number;
  /** Vitesse maximale individuelle = multiple de la vitesse du groupe. */
  memberMaxSpeedFactor: number;
  /** Amplitude du bruit de position individuel (m). */
  noiseAmplitudeM: number;
  /** Vitesse maximale de recomposition lors des transitions (m/s) — borne les déplacements « instantanés ». */
  blendMaxSpeedMps: number;

  // --- niveaux de simulation ---------------------------------------------------
  lod: {
    /** Niveau utilisé quand l'hôte ne fournit aucun foyer d'attention (2 = individuel). */
    defaultLevel: 0 | 1 | 2;
    /** Distance (m) au bord du foyer d'attention en dessous de laquelle on simule individuellement (N2). */
    n2RadiusM: number;
    /** Distance (m) au bord du foyer en dessous de laquelle les positions suivent leurs cibles (N1) ; au-delà : N0. */
    n1RadiusM: number;
    /** Taille (nombre d'individus contigus) d'un bloc de niveau de simulation dans un très gros groupe en marche. */
    blockSize: number;
    /** Effectif à partir duquel un groupe en marche est découpé en blocs de niveaux distincts. */
    blockMinGroupSize: number;
    /** Hystérésis relative (0,1 = 10 %) avant de rétrograder un bloc : évite l'oscillation de niveau en bordure de seuil. */
    hysteresis: number;
  };

  // --- états de rue / navigation -------------------------------------------------
  /** Recalcul des états de rue tous les N ticks. */
  /** Remplissage d'un rassemblement (distance de marche depuis l'ancre). */
  fill: {
    /** Coût relatif (< 1) d'un déplacement en espace ouvert : places et parcs sont occupés avant les rues voisines. */
    openCost: number;
    /** Surcoût (0 = aucun) des cellules à l'opposé du sens de départ : la foule s'étire dans le sens de la marche. */
    behindPenalty: number;
  };
  /** Monde : décor et lieux d'intérêt générés de façon déterministe le long des rues (phase 4). */
  world: {
    binSpacingM: number;
    benchSpacingM: number;
    shelterSpacingM: number;
    containerSpacingM: number;
    shopSpacingM: number;
    /** Espacement des commerces fictifs dans une « rue commerçante » (d'après la densité de commerces OSM). */
    shopSpacingCommercialM: number;
    /** Nombre de commerces OSM à moins de `commercialRadiusM` d'un point pour qualifier la rue de commerçante. */
    commercialShopCount: number;
    commercialRadiusM: number;
    /** Plafond du nombre d'objets de décor générés (protège la mémoire). */
    maxDecor: number;
    /** Distance minimale (m) entre un objet de décor et l'axe de la rue. */
    minOffsetM: number;
  };
  /** Incidents : déclenchement par la foule, escalade, propagation, confinement, conséquences (phase 4). */
  incidents: {
    /** Période d'évaluation des incidents (ticks). */
    everyTicks: number;
    /** Tension (0–100) à partir de laquelle une foule peut provoquer un incident. */
    triggerTension: number;
    /** Distance (m) maximale entre un individu de la foule et un objet pour que celui-ci soit à portée. */
    reachM: number;
    /** Probabilité par seconde, pour un objet à portée d'une foule à tension 100 et d'au moins `crowdFullSize` personnes. */
    baseRatePerS: number;
    crowdFullSize: number;
    /** Délai (s) avant qu'un même groupe provoque un nouvel incident. */
    cooldownS: number;
    /** Nombre maximal d'incidents actifs simultanés. */
    maxActive: number;
    /** Distance (m) d'une unité qui « surveille » un incident ; elle réduit aussi les risques de déclenchement. */
    unitWatchM: number;
    /** Multiplicateur de la probabilité de déclenchement d'un incident à portée d'une unité (< 1 : dissuasion). */
    unitDeterrence: number;
    /** Secondes de présence continue d'une unité pour confiner un incendie. */
    containAfterS: number;
    /** Secondes sans surveillance entre deux aggravations d'un incendie. */
    escalateEveryS: number;
    /** Distance (m) de propagation d'un incendie vers un objet inflammable voisin. */
    spreadReachM: number;
    /** Probabilité par seconde et par niveau de gravité de propagation à un objet voisin. */
    spreadRatePerSeverity: number;
    emergingS: number;
    /** Durées naturelles (s) : feu de poubelle, incendie, acte de dégradation, persistance (fumée, ruines) après la fin. */
    binFireS: number;
    fireS: number;
    damageActS: number;
    lingerS: number;
    /** Hausse de tension d'un groupe à portée à la naissance d'un incident (par niveau de gravité). */
    tensionPerSeverity: number;
    /** Rayon (m) dans lequel un incident affecte les groupes de foule. */
    affectRadiusM: number;
    /** Retour de la tension vers sa valeur de fond (points par seconde). */
    tensionDecayPerS: number;
    /** Coût fictif (€) par type d'objet endommagé. */
    costBinEur: number;
    costBenchEur: number;
    costShelterEur: number;
    costContainerEur: number;
    costWindowEur: number;
    costShopDestroyedEur: number;
  };
  streetStateEveryTicks: number;
  /** Nouvelle tentative de route pour un groupe en attente tous les N ticks. */
  waitRetryTicks: number;
  /** Distance d'anticipation (m) au-delà de la tête pour détecter une rue bloquée. */
  lookAheadM: number;
  /** Résolution du masque de marche (m par cellule). */
  walkMaskResolutionM: number;
}

export const DEFAULT_SIM_PARAMS: SimParams = {
  tickMs: 100,
  nav: DEFAULT_NAV_PARAMS,
  speedByKind: { march: 1.1, secondary: 1.2, dispersing: 1.2 },
  units: {
    footSpeedMps: 1.6,
    vehicleSpeedMps: 9,
    vehicleEmergencySpeedMps: 16,
    emergencyCrowdSlowM: 40,
    emergencyCrowdFactor: 0.3,
    footAccelMps2: 2,
    vehicleAccelMps2: 2.5,
    footDecelMps2: 3,
    vehicleDecelMps2: 4,
    footTurnRateRadPerS: 8,
    vehicleTurnRateRadPerS: 1.8,
    arrivalToleranceM: 2,
    formationSpacingM: 3,
  },
  referenceStreetWidthM: 5,
  narrowStreetMinFactor: 0.8,
  marchDensity: 2,
  staticDensity: 2,
  marchDensityMin: 0.8,
  marchFrontWidthMaxM: 14,
  marchFrontWidthMinM: 2,
  arrivalZoneM: 40,
  speedFactorByClass: { 0: 1.05, 1: 1.03, 2: 1, 3: 0.98, 4: 0.98, 5: 0.95, 6: 0.92, 7: 1, 8: 0.95, 9: 0.85, 10: 0.6, 11: 0.8, 12: 1 },
  crowdAccelMps2: 0.35,
  waitDensity: 3,
  walkHalfWidthMaxM: 32,
  streetHalfWidthM: 12,
  openSpaceWidthM: 30,
  openSpaceFrontMaxM: 40,
  densityRatePerS: 0.05,
  walkWidthSampleEveryM: 10,
  sidewalkAllowanceM: 2.5,
  entryBufferM: 10,
  streetMarginM: 0.8,
  columnLengthRateMps: 4,
  staticMaxRadiusM: 2500,
  memberSpring: 3,
  memberMaxSpeedFactor: 2.2,
  noiseAmplitudeM: 0.25,
  blendMaxSpeedMps: 3,
  lod: { defaultLevel: 2, n2RadiusM: 400, n1RadiusM: 2500, blockSize: 256, blockMinGroupSize: 4000, hysteresis: 0.1 },
  fill: { openCost: 0.45, behindPenalty: 0.9 },
  world: { binSpacingM: 70, benchSpacingM: 180, shelterSpacingM: 260, containerSpacingM: 200, shopSpacingM: 100, shopSpacingCommercialM: 35, commercialShopCount: 3, commercialRadiusM: 80, maxDecor: 8000, minOffsetM: 1.2 },
  incidents: {
    everyTicks: 10,
    triggerTension: 40,
    reachM: 25,
    baseRatePerS: 0.003,
    crowdFullSize: 900,
    cooldownS: 150,
    maxActive: 6,
    unitWatchM: 30,
    unitDeterrence: 0.25,
    containAfterS: 20,
    escalateEveryS: 45,
    spreadReachM: 7,
    spreadRatePerSeverity: 0.006,
    emergingS: 5,
    binFireS: 420,
    fireS: 900,
    damageActS: 20,
    lingerS: 90,
    tensionPerSeverity: 3,
    affectRadiusM: 60,
    tensionDecayPerS: 0.3,
    costBinEur: 150,
    costBenchEur: 400,
    costShelterEur: 3000,
    costContainerEur: 1200,
    costWindowEur: 2500,
    costShopDestroyedEur: 40000,
  },
  streetStateEveryTicks: 5,
  waitRetryTicks: 10,
  lookAheadM: 15,
  walkMaskResolutionM: 1,
};

/** Fusion profonde d'un surcharge partielle sur les paramètres par défaut. */
export function withParams(over: DeepPartial<SimParams> = {}): SimParams {
  const merge = <T extends object>(base: T, o: DeepPartial<T> | undefined): T => {
    const out = {} as Record<string, unknown>;
    for (const [k, v] of Object.entries(base as Record<string, unknown>)) out[k] = v && typeof v === 'object' && !Array.isArray(v) ? merge(v as object, undefined) : v;
    if (!o) return out as T;
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      const b = (base as Record<string, unknown>)[k];
      out[k] = v && typeof v === 'object' && !Array.isArray(v) && b && typeof b === 'object' ? merge(b as object, v as DeepPartial<object>) : v;
    }
    return out as T;
  };
  return merge(DEFAULT_SIM_PARAMS, over);
}

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };
