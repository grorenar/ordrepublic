import type { City } from '../state/types';

/** Villes prédéfinies (centres approximatifs, utilisés comme origine de la partie). */
export const PRESET_CITIES: readonly City[] = [
  { id: 'metz', name: 'Metz', center: { lng: 6.1757, lat: 49.1193 } },
  { id: 'paris', name: 'Paris', center: { lng: 2.3522, lat: 48.8566 } },
  { id: 'lyon', name: 'Lyon', center: { lng: 4.8357, lat: 45.764 } },
  { id: 'marseille', name: 'Marseille', center: { lng: 5.3698, lat: 43.2965 } },
];

export function findPresetCity(id: string): City | undefined {
  return PRESET_CITIES.find((c) => c.id === id);
}
