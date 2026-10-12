/**
 * Paramètres de navigation et de modèle de rue. Valeurs initiales de GAMEPLAY (jamais des constantes
 * définitives) : surchargeables par scénario / type de groupe via `SimParams.nav`.
 */
export interface NavParams {
  /** Vitesse nominale (m/s) par classe d'arête, utilisée pour le coût (en secondes). 0 = interdit. */
  speedFootMps: number;
  speedVehicleByClass: Record<number, number>;
  /** Multiplicateurs de coût pour les cortèges (préfèrent rues et places). */
  /** Un véhicule avec avertisseurs roule jusqu'à ce multiple de la vitesse de sa classe de voie (limites non respectées). */
  emergencySpeedFactor: number;
  crowdPenaltyFootway: number;
  /** Largeur praticable (m) en dessous de laquelle une rue est pénalisée pour un cortège (surcoût proportionnel au manque). */
  crowdPreferredWidthM: number;
  /** Surcoût maximal (multiple) pour une rue très étroite. */
  crowdNarrowPenalty: number;
  crowdPenaltySteps: number;
  /** Largeur libre minimale (m) pour qu'un véhicule franchisse une section de rue partiellement occupée (véhicule + marge de manœuvre). */
  vehicleMinFreeWidthM: number;
  /** Largeur libre minimale (m) pour qu'un piéton franchisse une foule, combinée à `footBlockMinDensity`. */
  footMinWidthM: number;
  /** Densité (pers/m²) en dessous de laquelle une foule ne bloque jamais les piétons, quelle que soit la largeur libre. */
  footBlockMinDensity: number;
  /** Longueur minimale (m) de présence d'une foule sur une arête pour qu'elle occupe une section de la rue. */
  minPresenceM: number;
  /** Densité de référence d'une foule « pleine largeur » (personnes/m²). */
  referenceDensity: number;
  /** Densité (pers/m²) à partir de laquelle la rue est « ralentie ». */
  slowedDensity: number;
  /** Part de la largeur occupée à partir de laquelle la rue est « partiellement obstruée ». */
  partialObstruction: number;
  /** Densité de blocage total (pers/m²) pour la relation densité-vitesse. */
  jamDensity: number;
  /** Facteur de vitesse plancher (relation densité-vitesse). */
  minSpeedFactor: number;
  /** Détour maximal accepté (ratio de coût). `Infinity` = aucune limite (valeur par défaut). */
  maxDetourRatio: number;
}

import { EdgeClass } from './graph';

export const DEFAULT_NAV_PARAMS: NavParams = {
  speedFootMps: 1.4,
  speedVehicleByClass: {
    [EdgeClass.Primary]: 8,
    [EdgeClass.Secondary]: 7,
    [EdgeClass.Tertiary]: 6.5,
    [EdgeClass.Unclassified]: 5.5,
    [EdgeClass.Residential]: 5,
    [EdgeClass.LivingStreet]: 3,
    [EdgeClass.Service]: 3,
  },
  emergencySpeedFactor: 1.8,
  crowdPenaltyFootway: 0.5,
  crowdPreferredWidthM: 8,
  crowdNarrowPenalty: 1.2,
  crowdPenaltySteps: 2,
  vehicleMinFreeWidthM: 3.5,
  footMinWidthM: 0.6,
  footBlockMinDensity: 1.5,
  minPresenceM: 3,
  referenceDensity: 2,
  slowedDensity: 0.5,
  partialObstruction: 0.4,
  jamDensity: 5.4,
  minSpeedFactor: 0.08,
  maxDetourRatio: Infinity,
};
