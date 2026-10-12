/**
 * Paramètres de navigation et de modèle de rue. Valeurs initiales de GAMEPLAY (jamais des constantes
 * définitives) : surchargeables par scénario / type de groupe via `SimParams.nav`.
 */
export interface NavParams {
  /** Vitesse nominale (m/s) par classe d'arête, utilisée pour le coût (en secondes). 0 = interdit. */
  speedFootMps: number;
  speedVehicleByClass: Record<number, number>;
  /** Multiplicateurs de coût pour les cortèges (préfèrent rues et places). */
  crowdPenaltyFootway: number;
  crowdPenaltySteps: number;
  /** Largeur d'un véhicule et marge de manœuvre (m) : passage possible si largeur libre ≥ somme. */
  vehicleWidthM: number;
  vehicleMarginM: number;
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
  crowdPenaltyFootway: 0.5,
  crowdPenaltySteps: 2,
  vehicleWidthM: 2.5,
  vehicleMarginM: 1,
  referenceDensity: 2,
  slowedDensity: 0.5,
  partialObstruction: 0.4,
  jamDensity: 5.4,
  minSpeedFactor: 0.08,
  maxDetourRatio: Infinity,
};
