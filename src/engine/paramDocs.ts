import { DEFAULT_SIM_PARAMS, type SimParams } from './params';

/**
 * Documentation des paramètres de simulation : signification, unité, valeur par défaut, effet.
 * Le fichier docs/PARAMETRES.md est GÉNÉRÉ depuis ce tableau (`npm run docs:params`) ; un test vérifie que chaque paramètre
 * est documenté et que le document n'est pas périmé. La valeur par défaut affichée est lue dans `DEFAULT_SIM_PARAMS`.
 */
export interface ParamDoc {
  /** Chemin dans `SimParams` ; `*` remplace un segment variable. */
  path: string;
  group: string;
  unit: string;
  meaning: string;
  effect: string;
}

export const PARAM_DOCS: ParamDoc[] = [
  { path: 'tickMs', group: 'Temps', unit: 'ms', meaning: 'Pas de temps fixe de la simulation (indépendant du rafraîchissement de l’écran).', effect: 'Plus petit : mouvements plus fins mais plus de calcul par seconde de jeu ; toutes les vitesses restent en m/s.' },

  // --- vitesses des groupes
  { path: 'speedByKind.march', group: 'Vitesses des groupes', unit: 'm/s', meaning: 'Vitesse de base d’un cortège en rue libre.', effect: 'Multipliée par les facteurs de largeur de rue, de cohésion et de foules rencontrées. 1,1 m/s ≈ marche de cortège.' },
  { path: 'speedByKind.secondary', group: 'Vitesses des groupes', unit: 'm/s', meaning: 'Vitesse de base d’un groupe secondaire détaché.', effect: 'Même rôle que `speedByKind.march`, pour les petits groupes qui se déplacent indépendamment.' },
  { path: 'speedByKind.dispersing', group: 'Vitesses des groupes', unit: 'm/s', meaning: 'Vitesse de marche des personnes qui quittent un rassemblement.', effect: 'Détermine la durée pendant laquelle un rassemblement se vide (avec la durée de dispersion du scénario).' },
  { path: 'referenceStreetWidthM', group: 'Vitesses des groupes', unit: 'm', meaning: 'Largeur de rue au-delà de laquelle la largeur ne ralentit plus un cortège.', effect: 'Facteur de vitesse = largeur du front / cette valeur (plafonné à 1).' },
  { path: 'narrowStreetMinFactor', group: 'Vitesses des groupes', unit: 'sans unité (0–1)', meaning: 'Facteur de vitesse plancher dû à l’étroitesse de la rue.', effect: 'Empêche un cortège de s’arrêter simplement parce que la rue est étroite.' },

  // --- densités et géométrie
  { path: 'marchDensity', group: 'Densités et géométrie', unit: 'personnes/m²', meaning: 'Densité d’un cortège en marche.', effect: 'Longueur de colonne = effectif / (densité × largeur du front). Doit rester < `nav.jamDensity` (validé).' },
  { path: 'staticDensity', group: 'Densités et géométrie', unit: 'personnes/m²', meaning: 'Densité d’un rassemblement installé.', effect: 'Aire occupée = effectif / densité (rayon de la zone praticable). Détermine aussi la largeur de rue occupée donc le blocage. Doit rester < `nav.jamDensity` (validé).' },
  { path: 'marchFrontWidthMaxM', group: 'Densités et géométrie', unit: 'm', meaning: 'Largeur maximale du front d’un cortège.', effect: 'Un cortège plus large que la rue se réduit à la largeur disponible (moins marges) ; au-delà de cette valeur il s’allonge.' },
  { path: 'marchFrontWidthMinM', group: 'Densités et géométrie', unit: 'm', meaning: 'Largeur minimale du front : un petit groupe forme un bloc compact.', effect: 'Largeur du front = √(effectif / densité), bornée par ce minimum et le maximum.' },
  { path: 'arrivalZoneM', group: 'Densités et géométrie', unit: 'm', meaning: 'Rayon autour d’une destination où un groupe (ou une unité à pied) peut traverser une foule dense pour la rejoindre.', effect: 'Évite qu’un rassemblement existant ferme l’accès à sa propre place. Les véhicules ne traversent jamais une foule.' },
  { path: 'streetMarginM', group: 'Densités et géométrie', unit: 'm', meaning: 'Marge entre un cortège et le bord de la rue.', effect: 'Réduit la largeur utile du front (2 marges retirées de la largeur de rue).' },
  { path: 'columnLengthRateMps', group: 'Densités et géométrie', unit: 'm/s', meaning: 'Vitesse maximale de variation de la longueur de colonne.', effect: 'Lisse l’allongement/raccourcissement quand la largeur de rue change : aucun saut de position.' },
  { path: 'staticMaxRadiusM', group: 'Densités et géométrie', unit: 'm', meaning: 'Rayon maximal exploré pour placer un rassemblement statique.', effect: 'Au-delà, la densité effective augmente (journalisé) ; borne le coût de mise en place.' },

  // --- individus
  { path: 'memberSpring', group: 'Individus (N2)', unit: '1/s', meaning: 'Raideur du rappel d’un individu vers sa position visée.', effect: 'Plus élevé : suit plus étroitement (moins de retard). Retard en régime ≈ vitesse / raideur.' },
  { path: 'memberMaxSpeedFactor', group: 'Individus (N2)', unit: 'multiple', meaning: 'Vitesse individuelle maximale = multiple de la vitesse du groupe.', effect: 'Borne les rattrapages (jamais de déplacement instantané).' },
  { path: 'noiseAmplitudeM', group: 'Individus (N2)', unit: 'm', meaning: 'Amplitude du bruit de position individuel (reproductible, sans état).', effect: 'Foule moins mécanique ; 0 = positions strictement alignées sur les cibles.' },
  { path: 'blendMaxSpeedMps', group: 'Individus (N2)', unit: 'm/s', meaning: 'Vitesse maximale de recomposition lors d’une transition (scission, jonction, retour en N1).', effect: 'Durée d’une recomposition = déplacement maximal / cette vitesse ; borne les mouvements artificiels.' },

  // --- unités
  { path: 'units.footSpeedMps', group: 'Unités et véhicules', unit: 'm/s', meaning: 'Vitesse maximale d’une unité à pied.', effect: 'Réduite par la densité de foule sur la rue (facteur de vitesse piéton).' },
  { path: 'units.vehicleSpeedMps', group: 'Unités et véhicules', unit: 'm/s', meaning: 'Vitesse maximale d’un véhicule en ville.', effect: 'Réduite en rue ralentie/partiellement obstruée (×0,7 / ×0,35).' },
  { path: 'units.footAccelMps2', group: 'Unités et véhicules', unit: 'm/s²', meaning: 'Accélération d’une unité à pied.', effect: 'Temps pour atteindre la vitesse maximale.' },
  { path: 'units.vehicleAccelMps2', group: 'Unités et véhicules', unit: 'm/s²', meaning: 'Accélération d’un véhicule.', effect: 'Temps pour atteindre la vitesse maximale du véhicule.' },
  { path: 'units.footDecelMps2', group: 'Unités et véhicules', unit: 'm/s²', meaning: 'Décélération d’une unité à pied.', effect: 'Distance de freinage avant l’arrivée.' },
  { path: 'units.vehicleDecelMps2', group: 'Unités et véhicules', unit: 'm/s²', meaning: 'Décélération d’un véhicule.', effect: 'Distance de freinage avant l’arrivée.' },
  { path: 'units.footTurnRateRadPerS', group: 'Unités et véhicules', unit: 'rad/s', meaning: 'Rotation maximale du cap d’une unité à pied.', effect: 'Élevée : le cap suit presque instantanément la route.' },
  { path: 'units.vehicleTurnRateRadPerS', group: 'Unités et véhicules', unit: 'rad/s', meaning: 'Rotation maximale du cap d’un véhicule.', effect: 'Un véhicule ne pivote pas sur place : cap lissé dans les virages.' },
  { path: 'units.arrivalToleranceM', group: 'Unités et véhicules', unit: 'm', meaning: 'Distance à la destination à laquelle un ordre est considéré accompli.', effect: 'Arrêt et passage au statut « au repos ».' },
  { path: 'units.formationSpacingM', group: 'Unités et véhicules', unit: 'm', meaning: 'Écart entre cibles d’unités envoyées au même point.', effect: 'Les unités d’un même ordre ne se superposent pas (spirale autour de la cible).' },

  // --- niveaux de simulation
  { path: 'lod.defaultLevel', group: 'Niveaux de simulation', unit: '0 / 1 / 2', meaning: 'Niveau utilisé quand l’hôte ne fournit aucun foyer d’attention.', effect: '2 = tous les individus en dynamique complète (référence de test).' },
  { path: 'lod.n2RadiusM', group: 'Niveaux de simulation', unit: 'm', meaning: 'Distance, mesurée au BORD du foyer d’attention, en dessous de laquelle on simule individuellement (N2).', effect: 'Marge hors écran garantissant un défilement sans pop. Doit rester ≤ `lod.n1RadiusM` (validé).' },
  { path: 'lod.n1RadiusM', group: 'Niveaux de simulation', unit: 'm', meaning: 'Distance au bord du foyer en dessous de laquelle les positions suivent leurs cibles (N1) ; au-delà : N0.', effect: 'N0 ne met rien à jour (positions réévaluées à la demande) : coût quasi nul.' },
  { path: 'lod.blockSize', group: 'Niveaux de simulation', unit: 'individus', meaning: 'Taille d’un bloc de niveau dans un très gros groupe en marche (individus consécutifs le long de la colonne).', effect: 'Plus petit : découpage plus fin mais plus de blocs à évaluer.' },
  { path: 'lod.blockMinGroupSize', group: 'Niveaux de simulation', unit: 'individus', meaning: 'Effectif à partir duquel un groupe en marche est découpé en blocs de niveaux distincts.', effect: 'En dessous : un seul niveau pour le groupe (pas de complexité inutile).' },
  { path: 'lod.hysteresis', group: 'Niveaux de simulation', unit: 'ratio', meaning: 'Marge relative avant de rétrograder un niveau.', effect: 'Évite l’oscillation de niveau d’un bloc situé à la frontière d’un seuil.' },

  // --- états de rue / navigation
  { path: 'streetStateEveryTicks', group: 'Rues et navigation', unit: 'ticks', meaning: 'Période de recalcul des états de rue.', effect: 'Réactivité du blocage de rue (5 ticks = 0,5 s de jeu).' },
  { path: 'waitRetryTicks', group: 'Rues et navigation', unit: 'ticks', meaning: 'Période de nouvelle tentative d’un groupe ou d’une unité en attente.', effect: 'Reprise après réouverture ou apparition d’un itinéraire.' },
  { path: 'lookAheadM', group: 'Rues et navigation', unit: 'm', meaning: 'Distance d’anticipation devant la tête d’un cortège pour la vitesse due aux autres foules.', effect: 'Un cortège ralentit avant d’entrer dans une rue encombrée.' },
  { path: 'walkMaskResolutionM', group: 'Rues et navigation', unit: 'm/cellule', meaning: 'Résolution du masque de marche (bâtiments rasterisés).', effect: 'Précision du rejet des bâtiments ; mémoire ∝ 1/résolution².' },
  { path: 'nav.speedFootMps', group: 'Rues et navigation', unit: 'm/s', meaning: 'Vitesse piétonne nominale pour le calcul du coût d’itinéraire.', effect: 'Coût en secondes ; n’influence pas la vitesse réelle des groupes.' },
  { path: 'nav.speedVehicleByClass.*', group: 'Rues et navigation', unit: 'm/s', meaning: 'Vitesse nominale des véhicules par classe de voie (0 = interdit).', effect: 'Préférence d’itinéraire des véhicules (grandes voies favorisées).' },
  { path: 'nav.crowdPenaltyFootway', group: 'Rues et navigation', unit: 'multiple', meaning: 'Surcoût pour un cortège empruntant un chemin piéton étroit.', effect: 'Les cortèges préfèrent rues et places.' },
  { path: 'nav.crowdPenaltySteps', group: 'Rues et navigation', unit: 'multiple', meaning: 'Surcoût pour un cortège empruntant des escaliers.', effect: 'Les cortèges évitent les escaliers sauf nécessité.' },
  { path: 'nav.maxDetourRatio', group: 'Rues et navigation', unit: 'ratio (∞ = aucun)', meaning: 'Détour maximal accepté par rapport à l’itinéraire direct.', effect: 'Infini par défaut : aucun facteur ne peut empêcher un itinéraire alternatif valide.' },

  // --- blocage des rues
  { path: 'nav.referenceDensity', group: 'Blocage des rues', unit: 'personnes/m²', meaning: 'Densité de référence d’une foule « pleine largeur » (estimation de la largeur occupée quand la section n’est pas connue).', effect: 'Doit rester cohérente avec `marchDensity`/`staticDensity` (avertissement sinon).' },
  { path: 'nav.slowedDensity', group: 'Blocage des rues', unit: 'personnes/m²', meaning: 'Densité locale à partir de laquelle une rue est « ralentie ».', effect: 'État 1 ; doit rester < saturation.' },
  { path: 'nav.partialObstruction', group: 'Blocage des rues', unit: 'ratio (0–1)', meaning: 'Part de la largeur occupée à partir de laquelle la rue est « partiellement obstruée ».', effect: 'État 2.' },
  { path: 'nav.jamDensity', group: 'Blocage des rues', unit: 'personnes/m²', meaning: 'Densité de saturation (5,4 par défaut) : critère PARMI d’autres de blocage piéton ; sert aussi à la relation densité-vitesse.', effect: 'Au-delà : la rue est bloquée aux piétons, quelle que soit la largeur libre.' },
  { path: 'nav.footBlockMinDensity', group: 'Blocage des rues', unit: 'personnes/m²', meaning: 'Densité en dessous de laquelle une foule ne bloque jamais les piétons, même si elle occupe toute la largeur.', effect: 'Le blocage piéton combine densité ET largeur libre (voir `nav.footMinWidthM`).' },
  { path: 'nav.footMinWidthM', group: 'Blocage des rues', unit: 'm', meaning: 'Largeur libre minimale pour qu’un piéton franchisse une foule dense.', effect: 'Une foule dense qui ne laisse pas cette largeur ferme la rue aux piétons.' },
  { path: 'nav.vehicleMinFreeWidthM', group: 'Blocage des rues', unit: 'm', meaning: 'Largeur libre minimale pour qu’un véhicule franchisse une section occupée (3,5 m = véhicule + marge).', effect: 'Au-dessous : rue « bloquée » pour les véhicules ; plafonnée à la largeur de la rue.' },
  { path: 'nav.minPresenceM', group: 'Blocage des rues', unit: 'm', meaning: 'Longueur minimale de présence d’une foule sur une arête pour qu’elle occupe une section.', effect: 'Ignore la queue ou la tête d’une colonne qui effleure l’arête.' },
  { path: 'nav.minSpeedFactor', group: 'Blocage des rues', unit: 'ratio', meaning: 'Facteur de vitesse piéton plancher.', effect: 'Dans une foule très dense on avance encore très lentement plutôt que de s’arrêter.' },
];

export type Leaf = [path: string, value: unknown];

export function flattenParams(obj: unknown, prefix = ''): Leaf[] {
  const out: Leaf[] = [];
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) out.push(...flattenParams(v, prefix ? `${prefix}.${k}` : k));
  } else out.push([prefix, obj]);
  return out;
}

export function docFor(path: string): ParamDoc | undefined {
  return PARAM_DOCS.find((d) => d.path === path || (d.path.endsWith('.*') && path.startsWith(d.path.slice(0, -1)) && !path.slice(d.path.length - 1).includes('.')));
}

export interface ParamIssues {
  errors: string[];
  warnings: string[];
}

/** Contrôle de cohérence : les paramètres de densité ne doivent pas contredire les règles de blocage ; les rayons de niveaux doivent être ordonnés. */
export function validateSimParams(p: SimParams): ParamIssues {
  const errors: string[] = [];
  const warnings: string[] = [];
  const n = p.nav;
  const positive: Array<[string, number]> = [
    ['tickMs', p.tickMs],
    ['marchDensity', p.marchDensity],
    ['staticDensity', p.staticDensity],
    ['marchFrontWidthMaxM', p.marchFrontWidthMaxM],
    ['marchFrontWidthMinM', p.marchFrontWidthMinM],
    ['speedByKind.march', p.speedByKind.march],
    ['speedByKind.secondary', p.speedByKind.secondary],
    ['speedByKind.dispersing', p.speedByKind.dispersing],
    ['units.footSpeedMps', p.units.footSpeedMps],
    ['units.vehicleSpeedMps', p.units.vehicleSpeedMps],
    ['nav.jamDensity', n.jamDensity],
    ['nav.referenceDensity', n.referenceDensity],
    ['nav.vehicleMinFreeWidthM', n.vehicleMinFreeWidthM],
    ['lod.blockSize', p.lod.blockSize],
  ];
  for (const [k, v] of positive) if (!(v > 0) || !Number.isFinite(v)) errors.push(`${k} doit être un nombre strictement positif (reçu ${v}).`);
  if (p.marchFrontWidthMinM > p.marchFrontWidthMaxM) errors.push('marchFrontWidthMinM ne peut pas dépasser marchFrontWidthMaxM.');
  // cohérence densités ↔ blocage
  if (p.marchDensity >= n.jamDensity) errors.push(`marchDensity (${p.marchDensity}) ≥ nav.jamDensity (${n.jamDensity}) : un cortège saturerait lui-même sa rue et se bloquerait.`);
  if (p.staticDensity >= n.jamDensity) errors.push(`staticDensity (${p.staticDensity}) ≥ nav.jamDensity (${n.jamDensity}) : tout rassemblement saturerait ses rues dès sa création.`);
  if (n.slowedDensity >= n.jamDensity) errors.push('nav.slowedDensity doit être inférieure à nav.jamDensity.');
  if (n.footBlockMinDensity > n.jamDensity) errors.push('nav.footBlockMinDensity ne peut pas dépasser nav.jamDensity.');
  if (!(n.partialObstruction > 0 && n.partialObstruction < 1)) errors.push('nav.partialObstruction doit être dans ]0 ; 1[.');
  if (p.lod.n1RadiusM < p.lod.n2RadiusM) errors.push(`lod.n1RadiusM (${p.lod.n1RadiusM}) doit être ≥ lod.n2RadiusM (${p.lod.n2RadiusM}) : les niveaux doivent s’emboîter.`);
  if (p.lod.n2RadiusM < 0 || p.lod.hysteresis < 0) errors.push('lod.n2RadiusM et lod.hysteresis ne peuvent pas être négatifs.');
  if (Math.abs(p.marchDensity - n.referenceDensity) / n.referenceDensity > 0.5) warnings.push(`marchDensity (${p.marchDensity}) s’écarte de plus de 50 % de nav.referenceDensity (${n.referenceDensity}) : l’estimation de largeur occupée sans section connue sera biaisée.`);
  if (Math.abs(p.staticDensity - n.referenceDensity) / n.referenceDensity > 0.5) warnings.push(`staticDensity (${p.staticDensity}) s’écarte de plus de 50 % de nav.referenceDensity (${n.referenceDensity}).`);
  if (p.marchDensity >= n.footBlockMinDensity || p.staticDensity >= n.footBlockMinDensity) warnings.push(`Les densités de marche/rassemblement (≥ ${n.footBlockMinDensity} pers/m²) bloquent les piétons dès qu’une foule remplit la largeur de la rue (comportement voulu : rues fermées aux piétons par une foule pleine largeur).`);
  if (n.vehicleMinFreeWidthM > p.marchFrontWidthMaxM) warnings.push('nav.vehicleMinFreeWidthM dépasse la largeur maximale du front : un véhicule pourrait être bloqué par une foule étroite sur une rue large.');
  return { errors, warnings };
}

const fmt = (v: unknown): string => (v === Infinity ? '∞' : typeof v === 'number' ? String(v) : String(v));

/** Génère docs/PARAMETRES.md. */
export function paramsMarkdown(): string {
  const leaves = flattenParams(DEFAULT_SIM_PARAMS);
  const lines: string[] = [];
  lines.push('# Paramètres de simulation');
  lines.push('');
  lines.push('> Fichier **généré** par `npm run docs:params` depuis `src/engine/paramDocs.ts` — ne pas modifier à la main. Toutes ces valeurs sont des **paramètres de gameplay configurables** (surcharge par scénario via `new Sim({ params: { … } })`), jamais des constantes définitives. Ce ne sont pas des règles officielles.');
  lines.push('');
  lines.push('Contrôles de cohérence appliqués à la création d’un `Sim` (`validateSimParams`) : densités de marche et de rassemblement **strictement inférieures** à la saturation (`nav.jamDensity`) ; `nav.slowedDensity` < saturation ; `lod.n1RadiusM` ≥ `lod.n2RadiusM` ; largeurs de front ordonnées ; valeurs positives. Un avertissement non bloquant (`sim.paramWarnings`) est émis si les densités s’écartent de la densité de référence ou si une foule pleine largeur ferme la rue aux piétons.');
  lines.push('');
  const groups = [...new Set(PARAM_DOCS.map((d) => d.group))];
  for (const g of groups) {
    lines.push(`## ${g}`);
    lines.push('');
    lines.push('| Paramètre | Unité | Défaut | Signification | Effet sur la simulation |');
    lines.push('|---|---|---|---|---|');
    for (const d of PARAM_DOCS.filter((x) => x.group === g)) {
      const vals = leaves.filter(([path]) => docFor(path) === d);
      const def = d.path.endsWith('.*') ? vals.map(([path, v]) => `${path.slice(d.path.length - 1)}: ${fmt(v)}`).join(' · ') : fmt(vals[0]?.[1]);
      lines.push(`| \`${d.path}\` | ${d.unit} | ${def} | ${d.meaning} | ${d.effect} |`);
    }
    lines.push('');
  }
  lines.push('## Rayons des niveaux de simulation : application cohérente');
  lines.push('');
  lines.push('- La distance est **toujours** mesurée au bord du foyer d’attention : `distance = |point − centre du foyer| − rayon du foyer` (un point dans le foyer a une distance ≤ 0).');
  lines.push('- Niveau **par groupe** : le point est le centre du groupe, la distance est diminuée de l’étendue du groupe (demi-longueur de colonne ou rayon de la zone). Niveau **par bloc** (groupes en marche ≥ `lod.blockMinGroupSize`) : le point est le milieu du bloc sur la route.');
  lines.push('- Seuils : N2 si distance ≤ `lod.n2RadiusM` ; N1 si ≤ `lod.n1RadiusM` ; sinon N0. Rétrogradation retardée de `lod.hysteresis`. Un groupe sélectionné (épinglé) reste en N2.');
  lines.push('- N0 → N1/N2 : positions réalignées sur leurs cibles dans le tick (le bloc n’était pas affiché). N2 → N1 : rapprochement borné par `blendMaxSpeedMps` (aucune téléportation).');
  lines.push('');
  return lines.join('\n');
}
