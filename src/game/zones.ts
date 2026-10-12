import type { GameZone } from '../state/types';

/** Tailles de zone de jeu proposées au joueur (demi-côtés en mètres). */
export const ZONE_LEVELS: readonly GameZone[] = [
  { halfWidth: 380, halfHeight: 290 },
  { halfWidth: 600, halfHeight: 450 },
  { halfWidth: 900, halfHeight: 680 },
  { halfWidth: 1400, halfHeight: 1050 },
];
/** Niveau par défaut au démarrage : assez grand pour que le cortège ait un vrai trajet. */
export const DEFAULT_ZONE_LEVEL = 1;
