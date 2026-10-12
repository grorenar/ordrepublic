/** Niveaux de détail du rendu selon le zoom (valeurs de zoom MapLibre / Web Mercator 512 px). */
export interface Lod {
  /** Foule agrégée en un symbole avec effectif. */
  aggregateCrowd: boolean;
  /** Unités en formation de boucliers (sinon pictogramme unique). */
  shieldFormation: boolean;
  labels: boolean;
  vehicleDetail: boolean;
}

export function lodForZoom(zoom: number): Lod {
  return {
    aggregateCrowd: zoom < 14.8,
    shieldFormation: zoom >= 15.8,
    labels: zoom >= 15.2,
    vehicleDetail: zoom >= 16.4,
  };
}
