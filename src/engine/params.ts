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
  /** Largeur maximale du front d'un cortège (m). */
  marchFrontWidthMaxM: number;
  /** Marge entre le cortège et le bord de la rue (m). */
  streetMarginM: number;
  /** Variation maximale de la longueur de colonne (m/s) : évite les sauts de position. */
  columnLengthRateMps: number;
  /** Rayon maximal exploré pour le placement d'un rassemblement statique (m). */
  staticMaxRadiusM: number;

  // --- individus -------------------------------------------------------------
  /** Taille des sous-groupes de calcul (individus partageant un repère). */
  subgroupSize: number;
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
    /** Distance (m) au foyer en dessous de laquelle un groupe est simulé individuellement (N2). */
    n2RadiusM: number;
    /** Distance (m) en dessous de laquelle les sous-groupes sont mis à jour (N1) ; au-delà : N0. */
    n1RadiusM: number;
  };

  // --- états de rue / navigation -------------------------------------------------
  /** Recalcul des états de rue tous les N ticks. */
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
  referenceStreetWidthM: 10,
  narrowStreetMinFactor: 0.6,
  marchDensity: 2,
  staticDensity: 2,
  marchFrontWidthMaxM: 14,
  streetMarginM: 0.8,
  columnLengthRateMps: 4,
  staticMaxRadiusM: 2500,
  subgroupSize: 32,
  memberSpring: 3,
  memberMaxSpeedFactor: 2.2,
  noiseAmplitudeM: 0.25,
  blendMaxSpeedMps: 3,
  lod: { defaultLevel: 2, n2RadiusM: 400, n1RadiusM: 2500 },
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
