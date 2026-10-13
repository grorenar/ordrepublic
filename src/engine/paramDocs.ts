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
  { path: 'marchDensityMin', group: 'Densités et géométrie', unit: 'personnes/m²', meaning: 'Densité minimale d’un cortège qui s’étale dans un espace large.', effect: 'Au-delà de la largeur de front des rues, le front s’élargit et la densité diminue (jusqu’à ce plancher) : les gens se séparent les uns des autres sans ralentir ni allonger la colonne.' },
  { path: 'marchFrontWidthMaxM', group: 'Densités et géométrie', unit: 'm', meaning: 'Largeur maximale du front d’un cortège.', effect: 'Un cortège plus large que la rue se réduit à la largeur disponible (moins marges) ; au-delà de cette valeur il s’allonge.' },
  { path: 'marchFrontWidthMinM', group: 'Densités et géométrie', unit: 'm', meaning: 'Largeur minimale du front : un petit groupe forme un bloc compact.', effect: 'Largeur du front = √(effectif / densité), bornée par ce minimum et le maximum.' },
  { path: 'arrivalZoneM', group: 'Densités et géométrie', unit: 'm', meaning: 'Rayon autour d’une destination où un groupe (ou une unité à pied) peut traverser une foule dense pour la rejoindre.', effect: 'Évite qu’un rassemblement existant ferme l’accès à sa propre place. Les véhicules ne traversent jamais une foule.' },
  { path: 'speedFactorByClass.*', group: 'Vitesses des groupes', unit: 'multiple', meaning: 'Facteur de vitesse d’un cortège selon la classe de la voie (0 grand axe … 10 escaliers, 11 piste).', effect: 'Nuances modérées : un peu plus vite sur un grand axe (×1,05), un peu moins en voie de service (×0,92), sentier (×0,85), escaliers (×0,6). Moyenne des facteurs sous le centre et la tête de la colonne.' },
  { path: 'crowdAccelMps2', group: 'Vitesses des groupes', unit: 'm/s²', meaning: 'Accélération maximale d’un cortège (le freinage est deux fois plus fort).', effect: 'Lisse les changements de vitesse (type de rue, foule devant) : pas de saut de vitesse.' },
  { path: 'waitDensity', group: 'Densités et géométrie', unit: 'personnes/m²', meaning: 'Densité d’un cortège arrêté et bloqué.', effect: 'La colonne se tasse en bloc contre l’obstacle (longueur = effectif / (densité × largeur praticable)), tête immobile ; doit rester < nav.jamDensity.' },
  { path: 'walkHalfWidthMaxM', group: 'Densités et géométrie', unit: 'm', meaning: 'Demi-largeur praticable maximale de chaque côté de l’axe d’une rue (espaces ouverts compris).', effect: 'Plafonne l’étalement d’une foule sur une place ou une esplanade.' },
  { path: 'streetHalfWidthM', group: 'Densités et géométrie', unit: 'm', meaning: 'Distance maximale à laquelle une façade est considérée comme bordant la rue.', effect: 'Au-delà, seul un espace ouvert cartographié (place, zone piétonne, parc) élargit l’espace praticable : une foule ne marche pas dans un fleuve ni un parking.' },
  { path: 'openSpaceWidthM', group: 'Densités et géométrie', unit: 'm', meaning: 'Largeur praticable à partir de laquelle un cortège peut déborder la largeur de front maximale des rues.', effect: 'Transition progressive (sur 10 m) entre largeur de front de rue et largeur de front d’espace ouvert.' },
  { path: 'openSpaceFrontMaxM', group: 'Densités et géométrie', unit: 'm', meaning: 'Largeur maximale du front d’un cortège dans un espace ouvert.', effect: 'Un cortège traversant une place s’étale jusqu’à cette largeur (au lieu de marchFrontWidthMaxM).' },
  { path: 'densityRatePerS', group: 'Densités et géométrie', unit: 'personnes/m² par s', meaning: 'Vitesse maximale de variation de la densité d’un cortège qui se tasse (bloqué) ou se relâche.', effect: 'Durée du tassement : (waitDensity − marchDensity) / densityRatePerS.' },
  { path: 'walkWidthSampleEveryM', group: 'Densités et géométrie', unit: 'm', meaning: 'Intervalle entre points de mesure de la largeur praticable le long d’une rue.', effect: 'Plus petit : mesure plus fine, calcul initial plus long.' },
  { path: 'sidewalkAllowanceM', group: 'Densités et géométrie', unit: 'm', meaning: 'Trottoir supposé de chaque côté d’une rue ouverte aux véhicules quand aucun bâtiment ne permet de mesurer.', effect: 'Largeur praticable = chaussée + 2 × trottoir. Sans effet quand les bâtiments sont connus (largeur mesurée façade à façade).' },
  { path: 'entryBufferM', group: 'Densités et géométrie', unit: 'm', meaning: 'Distance derrière une porte d’entrée au-delà de laquelle un individu est hors de la zone (aucune rue connue).', effect: 'Les individus d’une colonne qui arrive par une porte sont invisibles tant qu’ils n’ont pas franchi la porte : pas de foule posée à travers les immeubles à l’apparition.' },
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
  { path: 'units.vehicleSpeedMps', group: 'Unités et véhicules', unit: 'm/s', meaning: 'Plafond de vitesse d’un véhicule en circulation normale (la limite de la classe de voie s’applique en dessous).', effect: 'Réduite en rue ralentie/partiellement obstruée (×0,7 / ×0,35).' },
  { path: 'units.vehicleEmergencySpeedMps', group: 'Unités et véhicules', unit: 'm/s', meaning: 'Plafond de vitesse d’un véhicule avec avertisseurs lumineux actifs.', effect: 'Vitesse = limite de la classe de voie × nav.emergencySpeedFactor, plafonnée ici : limites non respectées.' },
  { path: 'units.emergencyCrowdSlowM', group: 'Unités et véhicules', unit: 'm', meaning: 'Distance devant un véhicule à avertisseurs à partir de laquelle il ralentit à l’approche d’une foule (≥ 10 personnes sur une rue de sa route).', effect: 'Plus grand : freine plus tôt.' },
  { path: 'units.emergencyCrowdFactor', group: 'Unités et véhicules', unit: 'sans unité (0–1)', meaning: 'Facteur de vitesse d’un véhicule à avertisseurs au contact d’une foule.', effect: 'Décroît linéairement avec la distance jusqu’à cette valeur au niveau de la foule ; sans foule devant : pleine vitesse.' },
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
  { path: 'fill.openCost', group: 'Densités et géométrie', unit: 'multiple (0–1)', meaning: 'Coût relatif d’un déplacement en espace ouvert (place, parc) dans le remplissage d’un rassemblement.', effect: 'Plus bas : la foule occupe d’abord la place voisine plutôt que les rues ; 1 = aucune préférence.' },
  { path: 'fill.behindPenalty', group: 'Densités et géométrie', unit: 'multiple', meaning: 'Surcoût des cellules situées à l’opposé du sens de départ du cortège dans le remplissage d’un rassemblement.', effect: 'Plus haut : le rassemblement s’étire dans le sens de la marche (moins de convergence depuis l’arrière au départ) ; 0 = remplissage isotrope.' },

  // --- monde (phase 4)
  { path: 'world.binSpacingM', group: 'Monde et incidents', unit: 'm', meaning: 'Espacement moyen des poubelles synthétiques le long des rues.', effect: 'Plus petit : plus de poubelles, donc plus de cibles possibles de feux de poubelle.' },
  { path: 'world.benchSpacingM', group: 'Monde et incidents', unit: 'm', meaning: 'Espacement moyen des bancs synthétiques (rues larges, places, parcs).', effect: 'Nombre d’objets de mobilier pouvant être dégradés.' },
  { path: 'world.shelterSpacingM', group: 'Monde et incidents', unit: 'm', meaning: 'Espacement moyen des abribus fictifs sur les artères.', effect: 'Nombre d’abribus pouvant être endommagés.' },
  { path: 'world.containerSpacingM', group: 'Monde et incidents', unit: 'm', meaning: 'Espacement moyen des conteneurs synthétiques (rues secondaires).', effect: 'Nombre de conteneurs pouvant brûler (incendie plus durable qu’une poubelle).' },
  { path: 'world.shopSpacingM', group: 'Monde et incidents', unit: 'm', meaning: 'Espacement moyen des commerces FICTIFS le long d’une rue ordinaire.', effect: 'Les vitrines fictives sont les seules cibles de bris de vitrine ; jamais un commerce réel.' },
  { path: 'world.shopSpacingCommercialM', group: 'Monde et incidents', unit: 'm', meaning: 'Espacement des commerces fictifs dans une rue qualifiée de commerçante.', effect: 'Plus de vitrines fictives dans les rues où OSM recense de nombreux commerces (seule information tirée d’OSM sur les commerces).' },
  { path: 'world.commercialShopCount', group: 'Monde et incidents', unit: 'nombre', meaning: 'Nombre de commerces OSM proches pour qualifier une rue de « commerçante ».', effect: 'Seuil de la catégorie générale de rue ; aucun établissement réel n’est classé ni ciblé.' },
  { path: 'world.commercialRadiusM', group: 'Monde et incidents', unit: 'm', meaning: 'Rayon de comptage des commerces OSM pour la catégorie de rue.', effect: 'Plus grand : davantage de rues sont qualifiées de commerçantes.' },
  { path: 'world.maxDecor', group: 'Monde et incidents', unit: 'objets', meaning: 'Plafond du nombre d’objets de décor générés.', effect: 'Protège la mémoire et le temps de rendu sur de très grandes zones.' },
  { path: 'world.minOffsetM', group: 'Monde et incidents', unit: 'm', meaning: 'Distance minimale entre un objet de décor et l’axe de la rue.', effect: 'Évite de poser des objets au milieu de la chaussée.' },

  // --- incidents (phase 4)
  { path: 'incidents.everyTicks', group: 'Monde et incidents', unit: 'ticks', meaning: 'Période d’évaluation des incidents.', effect: 'Plus grand : moins de calcul, réactivité moindre (10 ticks = 1 s de jeu).' },
  { path: 'incidents.triggerTension', group: 'Monde et incidents', unit: '0–100', meaning: 'Tension d’un groupe à partir de laquelle il peut provoquer un incident.', effect: 'Plus haut : la foule doit être plus tendue avant le moindre dégât.' },
  { path: 'incidents.reachM', group: 'Monde et incidents', unit: 'm', meaning: 'Distance entre un individu du groupe et un objet pour qu’il soit à portée.', effect: 'Plus grand : plus d’objets exposés autour d’une foule.' },
  { path: 'incidents.baseRatePerS', group: 'Monde et incidents', unit: '1/s', meaning: 'Probabilité par seconde de dégradation d’un objet à portée d’une grande foule à tension maximale.', effect: 'Pondérée par la tension au-dessus du seuil et par la taille de la foule ; réduite si une unité est proche.' },
  { path: 'incidents.crowdFullSize', group: 'Monde et incidents', unit: 'personnes', meaning: 'Effectif à partir duquel la taille de la foule ne réduit plus la probabilité.', effect: 'Sous cet effectif, la probabilité est proportionnelle à la racine de l’effectif.' },
  { path: 'incidents.cooldownS', group: 'Monde et incidents', unit: 's', meaning: 'Délai avant qu’un même groupe provoque un nouvel incident.', effect: 'Évite les rafales d’incidents d’un seul groupe.' },
  { path: 'incidents.maxActive', group: 'Monde et incidents', unit: 'incidents', meaning: 'Nombre maximal d’incidents actifs simultanés.', effect: 'Plafonne la charge de calcul et la lisibilité.' },
  { path: 'incidents.unitWatchM', group: 'Monde et incidents', unit: 'm', meaning: 'Distance d’une unité qui surveille un incident ou un objet.', effect: 'Une unité proche dissuade (déclenchement réduit) et permet de confiner un incendie.' },
  { path: 'incidents.unitDeterrence', group: 'Monde et incidents', unit: 'multiple (0–1)', meaning: 'Multiplicateur de la probabilité de déclenchement à portée d’une unité.', effect: 'Plus bas : la présence d’unités protège mieux le mobilier.' },
  { path: 'incidents.containAfterS', group: 'Monde et incidents', unit: 's', meaning: 'Présence continue d’une unité pour confiner un incendie (périmètre tenu, plus de propagation).', effect: 'Le confinement n’éteint pas le feu : l’extinction relève des secours (phase 6).' },
  { path: 'incidents.escalateEveryS', group: 'Monde et incidents', unit: 's', meaning: 'Durée sans surveillance entre deux aggravations d’un incendie.', effect: 'Plus court : les incendies non surveillés s’aggravent plus vite.' },
  { path: 'incidents.spreadReachM', group: 'Monde et incidents', unit: 'm', meaning: 'Distance de propagation d’un incendie vers un objet inflammable voisin.', effect: 'Plus grand : les incendies gagnent des objets plus éloignés.' },
  { path: 'incidents.spreadRatePerSeverity', group: 'Monde et incidents', unit: '1/s par niveau', meaning: 'Probabilité par seconde et par niveau de gravité de propagation.', effect: 'Un incendie non confiné de gravité élevée se propage plus vite.' },
  { path: 'incidents.emergingS', group: 'Monde et incidents', unit: 's', meaning: 'Durée de la phase « naissant » d’un incident.', effect: 'Délai avant que l’incident ne soit actif (visible et mesurable).' },
  { path: 'incidents.binFireS', group: 'Monde et incidents', unit: 's', meaning: 'Durée naturelle d’un feu de poubelle.', effect: 'Au terme, l’objet est brûlé (débris) et l’incident persiste un temps (fumée).' },
  { path: 'incidents.fireS', group: 'Monde et incidents', unit: 's', meaning: 'Durée naturelle d’un incendie (conteneur, vitrine…).', effect: 'Plus long : dégâts et propagation plus importants.' },
  { path: 'incidents.damageActS', group: 'Monde et incidents', unit: 's', meaning: 'Durée de l’acte de dégradation (bris, destruction de mobilier).', effect: 'Phase « actif » avant que l’incident ne se résorbe ; les dégâts, eux, restent.' },
  { path: 'incidents.lingerS', group: 'Monde et incidents', unit: 's', meaning: 'Persistance d’un incident après sa fin (fumée, ruines, verre brisé).', effect: 'État « persistant » avant « résolu ».' },
  { path: 'incidents.tensionPerSeverity', group: 'Monde et incidents', unit: 'points par niveau', meaning: 'Hausse de tension des groupes proches à la naissance d’un incident.', effect: 'Retombée de la tension après un incident : plus grand = effet d’entraînement plus fort.' },
  { path: 'incidents.affectRadiusM', group: 'Monde et incidents', unit: 'm', meaning: 'Rayon dans lequel un incident affecte les groupes de foule (marquage « affecté », tension).', effect: 'Plus grand : plus de groupes réagissent.' },
  { path: 'incidents.tensionDecayPerS', group: 'Monde et incidents', unit: 'points/s', meaning: 'Retour de la tension d’un groupe vers sa valeur de fond.', effect: 'Plus grand : la tension retombe plus vite après un incident.' },
  { path: 'incidents.costBinEur', group: 'Monde et incidents', unit: '€ (fictif)', meaning: 'Coût fictif d’une poubelle détruite.', effect: 'Alimente le compteur de dégâts (bilan).' },
  { path: 'incidents.costBenchEur', group: 'Monde et incidents', unit: '€ (fictif)', meaning: 'Coût fictif d’un banc ou d’une barrière endommagé.', effect: 'Alimente le compteur de dégâts (bilan).' },
  { path: 'incidents.costShelterEur', group: 'Monde et incidents', unit: '€ (fictif)', meaning: 'Coût fictif d’un abribus endommagé.', effect: 'Alimente le compteur de dégâts (bilan).' },
  { path: 'incidents.costContainerEur', group: 'Monde et incidents', unit: '€ (fictif)', meaning: 'Coût fictif d’un conteneur incendié.', effect: 'Alimente le compteur de dégâts (bilan).' },
  { path: 'incidents.costWindowEur', group: 'Monde et incidents', unit: '€ (fictif)', meaning: 'Coût fictif d’une vitrine brisée.', effect: 'Alimente le compteur de dégâts (bilan).' },
  { path: 'incidents.costShopDestroyedEur', group: 'Monde et incidents', unit: '€ (fictif)', meaning: 'Coût fictif d’un commerce fictif détruit par un incendie.', effect: 'Alimente le compteur de dégâts (bilan).' },

  { path: 'streetStateEveryTicks', group: 'Rues et navigation', unit: 'ticks', meaning: 'Période de recalcul des états de rue.', effect: 'Réactivité du blocage de rue (5 ticks = 0,5 s de jeu).' },
  { path: 'waitRetryTicks', group: 'Rues et navigation', unit: 'ticks', meaning: 'Période de nouvelle tentative d’un groupe ou d’une unité en attente.', effect: 'Reprise après réouverture ou apparition d’un itinéraire.' },
  { path: 'lookAheadM', group: 'Rues et navigation', unit: 'm', meaning: 'Distance d’anticipation devant la tête d’un cortège pour la vitesse due aux autres foules.', effect: 'Un cortège ralentit avant d’entrer dans une rue encombrée.' },
  { path: 'walkMaskResolutionM', group: 'Rues et navigation', unit: 'm/cellule', meaning: 'Résolution du masque de marche (bâtiments rasterisés).', effect: 'Précision du rejet des bâtiments ; mémoire ∝ 1/résolution².' },
  { path: 'nav.speedFootMps', group: 'Rues et navigation', unit: 'm/s', meaning: 'Vitesse piétonne nominale pour le calcul du coût d’itinéraire.', effect: 'Coût en secondes ; n’influence pas la vitesse réelle des groupes.' },
  { path: 'nav.speedVehicleByClass.*', group: 'Rues et navigation', unit: 'm/s', meaning: 'Vitesse nominale des véhicules par classe de voie (0 = interdit). La voie de bus en site propre (9 m/s) n’est ouverte qu’aux véhicules avec avertisseurs.', effect: 'Préférence d’itinéraire des véhicules (grandes voies favorisées) ; avec avertisseurs : multipliée par nav.emergencySpeedFactor, dans la limite du plafond d’urgence.' },
  { path: 'nav.crowdPreferredWidthM', group: 'Rues et navigation', unit: 'm', meaning: 'Largeur praticable en dessous de laquelle une rue est pénalisée pour un cortège.', effect: 'Les cortèges préfèrent les rues larges ; une ruelle reste possible si c’est nécessaire.' },
  { path: 'nav.crowdNarrowPenalty', group: 'Rues et navigation', unit: 'multiple', meaning: 'Surcoût maximal (proportionnel au manque de largeur) pour un cortège dans une rue très étroite.', effect: '0 : aucune préférence de largeur.' },
  { path: 'nav.emergencySpeedFactor', group: 'Rues et navigation', unit: 'multiple', meaning: 'Multiple de la vitesse de la classe de voie atteint par un véhicule avec avertisseurs.', effect: 'Itinéraires et vitesses des véhicules d’urgence ; les sens interdits sont aussi permis.' },
  { path: 'nav.vehicleFootwayMinWidthM', group: 'Rues et navigation', unit: 'm', meaning: 'Largeur à partir de laquelle une voie piétonne (rue piétonne, chemin) est praticable par un véhicule.', effect: 'Plus bas : les véhicules coupent par davantage de voies piétonnes ; jamais les escaliers.' },
  { path: 'nav.vehicleFootwaySpeedMps', group: 'Rues et navigation', unit: 'm/s', meaning: 'Vitesse d’un véhicule sur une voie piétonne.', effect: 'Coût d’itinéraire et vitesse sur ces voies (les avertisseurs la multiplient).' },
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
    ['marchDensityMin', p.marchDensityMin],
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
  if (p.marchDensityMin > p.marchDensity) errors.push('marchDensityMin ne peut pas dépasser marchDensity.');
  if (p.marchFrontWidthMinM > p.marchFrontWidthMaxM) errors.push('marchFrontWidthMinM ne peut pas dépasser marchFrontWidthMaxM.');
  // cohérence densités ↔ blocage
  if (p.marchDensity >= n.jamDensity) errors.push(`marchDensity (${p.marchDensity}) ≥ nav.jamDensity (${n.jamDensity}) : un cortège saturerait lui-même sa rue et se bloquerait.`);
  if (p.waitDensity >= n.jamDensity) errors.push(`waitDensity (${p.waitDensity}) ≥ nav.jamDensity (${n.jamDensity}) : un cortège arrêté saturerait sa propre rue.`);
  if (p.waitDensity < p.marchDensity) warnings.push('waitDensity est inférieure à marchDensity : un cortège bloqué garde sa densité de marche (il ne se relâche pas).');
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
