import type { LngLat } from '../geo/mercator';

/** Ville de la partie : centre géographique (l'origine du repère local en mètres). */
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
