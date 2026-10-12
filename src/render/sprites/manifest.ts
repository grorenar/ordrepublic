import type { ForceKind, Loadout, VehicleKind } from '../../engine/types';
import type { OrientationCount, SpriteDef, SpriteFamily, SpriteManifest } from './types';

/** Couleurs de vêtements des manifestants (variante = couleur + accessoire). */
export const PERSON_COLORS = ['#e8edf4', '#f4c542', '#e2574c', '#4c9be2', '#59b36b', '#a97fd1', '#e89a4c', '#6b7a8f'] as const;
/** Accessoires : 0 aucun, 1 casquette, 2 capuche, 3 sac à dos, 4 drapeau, 5 pancarte. Visibles au niveau T3 seulement. */
export const PERSON_ACCESSORIES = 6;
export const PERSON_VARIANTS = PERSON_COLORS.length * PERSON_ACCESSORIES;

export const FORCE_CODES: Record<ForceKind, string> = { crs: 'crs', police_nationale: 'pn', gendarmerie_mobile: 'gm', unite_speciale: 'us' };

export const VEHICLE_DIMENSIONS: Record<VehicleKind, { len: number; wid: number; label: string }> = {
  fourgon_police: { len: 6.2, wid: 2.3, label: 'Fourgon de police' },
  fourgon_crs: { len: 6.8, wid: 2.4, label: 'Transport CRS' },
  voiture_police: { len: 4.7, wid: 1.9, label: 'Véhicule de police' },
  ambulance: { len: 6.2, wid: 2.4, label: 'Ambulance' },
  camion_pompiers: { len: 9.6, wid: 2.7, label: 'Sapeurs-pompiers' },
  vehicule_secours_leger: { len: 4.8, wid: 1.9, label: 'Secours léger' },
  vehicule_gendarmerie: { len: 4.8, wid: 1.9, label: 'Véhicule de gendarmerie' },
  voiture_banalisee: { len: 4.5, wid: 1.8, label: 'Véhicule banalisé' },
  moto_police: { len: 2.2, wid: 0.9, label: 'Moto de police' },
  camion_a_eau: { len: 9, wid: 3, label: 'Lanceur d’eau' },
};

/** Types d'objets urbains (décor synthétique de la phase 4 ; les sprites sont posés dès la phase 3d). */
export type DecorKind = 'bin' | 'bin_fire' | 'bench' | 'barrier' | 'cone' | 'container' | 'container_fire' | 'debris' | 'rubble' | 'shopfront' | 'shopfront_broken' | 'bus_shelter' | 'bus_shelter_broken';

export const DECOR_DIMENSIONS: Record<DecorKind, { w: number; h: number; label: string }> = {
  bin: { w: 0.7, h: 0.7, label: 'Poubelle' },
  bin_fire: { w: 0.8, h: 0.8, label: 'Poubelle en feu' },
  bench: { w: 1.8, h: 0.6, label: 'Banc' },
  barrier: { w: 2.2, h: 0.5, label: 'Barrière' },
  cone: { w: 0.4, h: 0.4, label: 'Cône' },
  container: { w: 2.4, h: 1.5, label: 'Conteneur' },
  container_fire: { w: 2.6, h: 1.7, label: 'Conteneur en feu' },
  debris: { w: 1.2, h: 1.0, label: 'Débris' },
  rubble: { w: 2.0, h: 1.6, label: 'Gravats' },
  shopfront: { w: 5, h: 0.9, label: 'Vitrine (fictive)' },
  shopfront_broken: { w: 5, h: 0.9, label: 'Vitrine brisée (fictive)' },
  bus_shelter: { w: 3.4, h: 1.4, label: 'Abribus (fictif)' },
  bus_shelter_broken: { w: 3.4, h: 1.4, label: 'Abribus endommagé (fictif)' },
};

export const forceSpriteId = (force: ForceKind, loadout: Pick<Loadout, 'shield' | 'helmet'>): string =>
  `force.${FORCE_CODES[force]}.${loadout.shield ? 'shield' : force === 'unite_speciale' && loadout.helmet ? 'helmet' : 'bare'}`;
export const vehicleSpriteId = (k: VehicleKind): string => `vehicle.${k}`;
export const decorSpriteId = (k: DecorKind): string => `decor.${k}`;
export const PERSON_SPRITE = 'person';

function def(id: string, family: SpriteFamily, label: string, wM: number, hM: number, o: Partial<SpriteDef> = {}): SpriteDef {
  const orientations: OrientationCount = o.orientations ?? 1;
  return {
    id,
    family,
    label,
    wM,
    hM,
    anchor: { x: 0.5, y: 0.5 },
    orientations,
    animations: { idle: 1 },
    variants: 1,
    hitRadiusM: Math.max(wM, hM) * 0.6 + 1,
    minPx: 6,
    ...o,
  };
}

/** Manifeste des sprites provisoires (dessinés par code). Une planche d'images peut remplacer n'importe quelle entrée. */
export function defaultManifest(): SpriteManifest {
  const sprites: SpriteDef[] = [];
  sprites.push(def(PERSON_SPRITE, 'person', 'Manifestant', 0.65, 0.8, { orientations: 8, animations: { idle: 1, walk: 3 }, variants: PERSON_VARIANTS, hitRadiusM: 1.2, minPx: 6.5 }));
  const forceLabels: Record<ForceKind, string> = { crs: 'CRS', police_nationale: 'Police nationale', gendarmerie_mobile: 'Gendarmerie mobile', unite_speciale: 'Unité spéciale' };
  for (const k of Object.keys(FORCE_CODES) as ForceKind[]) {
    for (const eq of ['shield', 'bare', ...(k === 'unite_speciale' ? ['helmet'] : [])]) {
      const label = `${forceLabels[k]} ${eq === 'shield' ? 'avec bouclier' : eq === 'helmet' ? 'casqué' : 'sans bouclier'}`;
      sprites.push(def(`force.${FORCE_CODES[k]}.${eq}`, 'force', label, eq === 'shield' ? 0.95 : 0.55, 0.7, { orientations: 8, animations: { idle: 1, walk: 3 }, hitRadiusM: 3, minPx: 12 }));
    }
  }
  sprites.push(def('rescue.medic', 'rescue', 'Secouriste', 0.5, 0.62, { orientations: 8, hitRadiusM: 2, minPx: 9 }));
  sprites.push(def('rescue.firefighter', 'rescue', 'Sapeur-pompier', 0.55, 0.66, { orientations: 8, hitRadiusM: 2, minPx: 9 }));
  sprites.push(def('rescue.medical_team', 'rescue', 'Équipe médicale', 0.8, 0.8, { orientations: 8, hitRadiusM: 2.5, minPx: 11 }));
  for (const k of Object.keys(VEHICLE_DIMENSIONS) as VehicleKind[]) {
    const d = VEHICLE_DIMENSIONS[k];
    sprites.push(def(vehicleSpriteId(k), 'vehicle', d.label, d.len, d.wid, { orientations: 1, hitRadiusM: 5, minPx: 7 }));
  }
  for (const k of Object.keys(DECOR_DIMENSIONS) as DecorKind[]) {
    const d = DECOR_DIMENSIONS[k];
    sprites.push(def(decorSpriteId(k), 'decor', d.label, d.w, d.h, { orientations: 1, hitRadiusM: Math.max(2, Math.max(d.w, d.h) * 0.6), minPx: 5, animations: k.endsWith('_fire') || k === 'bin_fire' ? { idle: 1, burn: 2 } : { idle: 1 } }));
  }
  return { version: 1, name: 'procedural-v1', sprites };
}

export class ManifestIndex {
  private readonly byId = new Map<string, SpriteDef>();
  constructor(readonly manifest: SpriteManifest) {
    for (const s of manifest.sprites) this.byId.set(s.id, s);
  }
  get(id: string): SpriteDef | undefined {
    return this.byId.get(id);
  }
  has(id: string): boolean {
    return this.byId.has(id);
  }
  hitRadiusM(id: string, fallback = 3): number {
    return this.byId.get(id)?.hitRadiusM ?? fallback;
  }
}

/** Contrôle de cohérence d'un manifeste (identifiants uniques, tailles positives, ancrages dans la boîte). */
export function validateManifest(m: SpriteManifest): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  if (m.version !== 1) errors.push(`version ${String(m.version)} non prise en charge`);
  for (const s of m.sprites) {
    if (seen.has(s.id)) errors.push(`identifiant en double : ${s.id}`);
    seen.add(s.id);
    if (!(s.wM > 0 && s.hM > 0)) errors.push(`${s.id} : taille réelle invalide`);
    if (![1, 8, 16, 32].includes(s.orientations)) errors.push(`${s.id} : nombre d'orientations invalide`);
    if (s.anchor.x < 0 || s.anchor.x > 1 || s.anchor.y < 0 || s.anchor.y > 1) errors.push(`${s.id} : ancrage hors de la boîte`);
    if (!((s.animations.idle ?? 0) >= 1)) errors.push(`${s.id} : animation idle manquante`);
    if (!(s.hitRadiusM > 0)) errors.push(`${s.id} : rayon de sélection invalide`);
    if (s.variants < 1) errors.push(`${s.id} : au moins une variante`);
  }
  return errors;
}
