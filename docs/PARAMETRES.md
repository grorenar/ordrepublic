# Paramètres de simulation

> Fichier **généré** par `npm run docs:params` depuis `src/engine/paramDocs.ts` — ne pas modifier à la main. Toutes ces valeurs sont des **paramètres de gameplay configurables** (surcharge par scénario via `new Sim({ params: { … } })`), jamais des constantes définitives. Ce ne sont pas des règles officielles.

Contrôles de cohérence appliqués à la création d’un `Sim` (`validateSimParams`) : densités de marche et de rassemblement **strictement inférieures** à la saturation (`nav.jamDensity`) ; `nav.slowedDensity` < saturation ; `lod.n1RadiusM` ≥ `lod.n2RadiusM` ; largeurs de front ordonnées ; valeurs positives. Un avertissement non bloquant (`sim.paramWarnings`) est émis si les densités s’écartent de la densité de référence ou si une foule pleine largeur ferme la rue aux piétons.

## Temps

| Paramètre | Unité | Défaut | Signification | Effet sur la simulation |
|---|---|---|---|---|
| `tickMs` | ms | 100 | Pas de temps fixe de la simulation (indépendant du rafraîchissement de l’écran). | Plus petit : mouvements plus fins mais plus de calcul par seconde de jeu ; toutes les vitesses restent en m/s. |

## Vitesses des groupes

| Paramètre | Unité | Défaut | Signification | Effet sur la simulation |
|---|---|---|---|---|
| `speedByKind.march` | m/s | 1.1 | Vitesse de base d’un cortège en rue libre. | Multipliée par les facteurs de largeur de rue, de cohésion et de foules rencontrées. 1,1 m/s ≈ marche de cortège. |
| `speedByKind.secondary` | m/s | 1.2 | Vitesse de base d’un groupe secondaire détaché. | Même rôle que `speedByKind.march`, pour les petits groupes qui se déplacent indépendamment. |
| `speedByKind.dispersing` | m/s | 1.2 | Vitesse de marche des personnes qui quittent un rassemblement. | Détermine la durée pendant laquelle un rassemblement se vide (avec la durée de dispersion du scénario). |
| `referenceStreetWidthM` | m | 5 | Largeur de rue au-delà de laquelle la largeur ne ralentit plus un cortège. | Facteur de vitesse = largeur du front / cette valeur (plafonné à 1). |
| `narrowStreetMinFactor` | sans unité (0–1) | 0.8 | Facteur de vitesse plancher dû à l’étroitesse de la rue. | Empêche un cortège de s’arrêter simplement parce que la rue est étroite. |
| `speedFactorByClass.*` | multiple | 0: 1.05 · 1: 1.03 · 2: 1 · 3: 0.98 · 4: 0.98 · 5: 0.95 · 6: 0.92 · 7: 1 · 8: 0.95 · 9: 0.85 · 10: 0.6 · 11: 0.8 | Facteur de vitesse d’un cortège selon la classe de la voie (0 grand axe … 10 escaliers, 11 piste). | Nuances modérées : un peu plus vite sur un grand axe (×1,05), un peu moins en voie de service (×0,92), sentier (×0,85), escaliers (×0,6). Moyenne des facteurs sous le centre et la tête de la colonne. |
| `crowdAccelMps2` | m/s² | 0.35 | Accélération maximale d’un cortège (le freinage est deux fois plus fort). | Lisse les changements de vitesse (type de rue, foule devant) : pas de saut de vitesse. |

## Densités et géométrie

| Paramètre | Unité | Défaut | Signification | Effet sur la simulation |
|---|---|---|---|---|
| `marchDensity` | personnes/m² | 2 | Densité d’un cortège en marche. | Longueur de colonne = effectif / (densité × largeur du front). Doit rester < `nav.jamDensity` (validé). |
| `staticDensity` | personnes/m² | 2 | Densité d’un rassemblement installé. | Aire occupée = effectif / densité (rayon de la zone praticable). Détermine aussi la largeur de rue occupée donc le blocage. Doit rester < `nav.jamDensity` (validé). |
| `marchDensityMin` | personnes/m² | 0.8 | Densité minimale d’un cortège qui s’étale dans un espace large. | Au-delà de la largeur de front des rues, le front s’élargit et la densité diminue (jusqu’à ce plancher) : les gens se séparent les uns des autres sans ralentir ni allonger la colonne. |
| `marchFrontWidthMaxM` | m | 14 | Largeur maximale du front d’un cortège. | Un cortège plus large que la rue se réduit à la largeur disponible (moins marges) ; au-delà de cette valeur il s’allonge. |
| `marchFrontWidthMinM` | m | 2 | Largeur minimale du front : un petit groupe forme un bloc compact. | Largeur du front = √(effectif / densité), bornée par ce minimum et le maximum. |
| `arrivalZoneM` | m | 40 | Rayon autour d’une destination où un groupe (ou une unité à pied) peut traverser une foule dense pour la rejoindre. | Évite qu’un rassemblement existant ferme l’accès à sa propre place. Les véhicules ne traversent jamais une foule. |
| `waitDensity` | personnes/m² | 3 | Densité d’un cortège arrêté et bloqué. | La colonne se tasse en bloc contre l’obstacle (longueur = effectif / (densité × largeur praticable)), tête immobile ; doit rester < nav.jamDensity. |
| `walkHalfWidthMaxM` | m | 32 | Demi-largeur praticable maximale de chaque côté de l’axe d’une rue (espaces ouverts compris). | Plafonne l’étalement d’une foule sur une place ou une esplanade. |
| `streetHalfWidthM` | m | 12 | Distance maximale à laquelle une façade est considérée comme bordant la rue. | Au-delà, seul un espace ouvert cartographié (place, zone piétonne, parc) élargit l’espace praticable : une foule ne marche pas dans un fleuve ni un parking. |
| `openSpaceWidthM` | m | 30 | Largeur praticable à partir de laquelle un cortège peut déborder la largeur de front maximale des rues. | Transition progressive (sur 10 m) entre largeur de front de rue et largeur de front d’espace ouvert. |
| `openSpaceFrontMaxM` | m | 40 | Largeur maximale du front d’un cortège dans un espace ouvert. | Un cortège traversant une place s’étale jusqu’à cette largeur (au lieu de marchFrontWidthMaxM). |
| `densityRatePerS` | personnes/m² par s | 0.05 | Vitesse maximale de variation de la densité d’un cortège qui se tasse (bloqué) ou se relâche. | Durée du tassement : (waitDensity − marchDensity) / densityRatePerS. |
| `walkWidthSampleEveryM` | m | 10 | Intervalle entre points de mesure de la largeur praticable le long d’une rue. | Plus petit : mesure plus fine, calcul initial plus long. |
| `sidewalkAllowanceM` | m | 2.5 | Trottoir supposé de chaque côté d’une rue ouverte aux véhicules quand aucun bâtiment ne permet de mesurer. | Largeur praticable = chaussée + 2 × trottoir. Sans effet quand les bâtiments sont connus (largeur mesurée façade à façade). |
| `entryBufferM` | m | 10 | Distance derrière une porte d’entrée au-delà de laquelle un individu est hors de la zone (aucune rue connue). | Les individus d’une colonne qui arrive par une porte sont invisibles tant qu’ils n’ont pas franchi la porte : pas de foule posée à travers les immeubles à l’apparition. |
| `streetMarginM` | m | 0.8 | Marge entre un cortège et le bord de la rue. | Réduit la largeur utile du front (2 marges retirées de la largeur de rue). |
| `columnLengthRateMps` | m/s | 4 | Vitesse maximale de variation de la longueur de colonne. | Lisse l’allongement/raccourcissement quand la largeur de rue change : aucun saut de position. |
| `staticMaxRadiusM` | m | 2500 | Rayon maximal exploré pour placer un rassemblement statique. | Au-delà, la densité effective augmente (journalisé) ; borne le coût de mise en place. |

## Individus (N2)

| Paramètre | Unité | Défaut | Signification | Effet sur la simulation |
|---|---|---|---|---|
| `memberSpring` | 1/s | 3 | Raideur du rappel d’un individu vers sa position visée. | Plus élevé : suit plus étroitement (moins de retard). Retard en régime ≈ vitesse / raideur. |
| `memberMaxSpeedFactor` | multiple | 2.2 | Vitesse individuelle maximale = multiple de la vitesse du groupe. | Borne les rattrapages (jamais de déplacement instantané). |
| `noiseAmplitudeM` | m | 0.25 | Amplitude du bruit de position individuel (reproductible, sans état). | Foule moins mécanique ; 0 = positions strictement alignées sur les cibles. |
| `blendMaxSpeedMps` | m/s | 3 | Vitesse maximale de recomposition lors d’une transition (scission, jonction, retour en N1). | Durée d’une recomposition = déplacement maximal / cette vitesse ; borne les mouvements artificiels. |

## Unités et véhicules

| Paramètre | Unité | Défaut | Signification | Effet sur la simulation |
|---|---|---|---|---|
| `units.footSpeedMps` | m/s | 1.6 | Vitesse maximale d’une unité à pied. | Réduite par la densité de foule sur la rue (facteur de vitesse piéton). |
| `units.vehicleSpeedMps` | m/s | 6 | Vitesse maximale d’un véhicule en ville. | Réduite en rue ralentie/partiellement obstruée (×0,7 / ×0,35). |
| `units.footAccelMps2` | m/s² | 2 | Accélération d’une unité à pied. | Temps pour atteindre la vitesse maximale. |
| `units.vehicleAccelMps2` | m/s² | 2.5 | Accélération d’un véhicule. | Temps pour atteindre la vitesse maximale du véhicule. |
| `units.footDecelMps2` | m/s² | 3 | Décélération d’une unité à pied. | Distance de freinage avant l’arrivée. |
| `units.vehicleDecelMps2` | m/s² | 4 | Décélération d’un véhicule. | Distance de freinage avant l’arrivée. |
| `units.footTurnRateRadPerS` | rad/s | 8 | Rotation maximale du cap d’une unité à pied. | Élevée : le cap suit presque instantanément la route. |
| `units.vehicleTurnRateRadPerS` | rad/s | 1.8 | Rotation maximale du cap d’un véhicule. | Un véhicule ne pivote pas sur place : cap lissé dans les virages. |
| `units.arrivalToleranceM` | m | 2 | Distance à la destination à laquelle un ordre est considéré accompli. | Arrêt et passage au statut « au repos ». |
| `units.formationSpacingM` | m | 3 | Écart entre cibles d’unités envoyées au même point. | Les unités d’un même ordre ne se superposent pas (spirale autour de la cible). |

## Niveaux de simulation

| Paramètre | Unité | Défaut | Signification | Effet sur la simulation |
|---|---|---|---|---|
| `lod.defaultLevel` | 0 / 1 / 2 | 2 | Niveau utilisé quand l’hôte ne fournit aucun foyer d’attention. | 2 = tous les individus en dynamique complète (référence de test). |
| `lod.n2RadiusM` | m | 400 | Distance, mesurée au BORD du foyer d’attention, en dessous de laquelle on simule individuellement (N2). | Marge hors écran garantissant un défilement sans pop. Doit rester ≤ `lod.n1RadiusM` (validé). |
| `lod.n1RadiusM` | m | 2500 | Distance au bord du foyer en dessous de laquelle les positions suivent leurs cibles (N1) ; au-delà : N0. | N0 ne met rien à jour (positions réévaluées à la demande) : coût quasi nul. |
| `lod.blockSize` | individus | 256 | Taille d’un bloc de niveau dans un très gros groupe en marche (individus consécutifs le long de la colonne). | Plus petit : découpage plus fin mais plus de blocs à évaluer. |
| `lod.blockMinGroupSize` | individus | 4000 | Effectif à partir duquel un groupe en marche est découpé en blocs de niveaux distincts. | En dessous : un seul niveau pour le groupe (pas de complexité inutile). |
| `lod.hysteresis` | ratio | 0.1 | Marge relative avant de rétrograder un niveau. | Évite l’oscillation de niveau d’un bloc situé à la frontière d’un seuil. |

## Rues et navigation

| Paramètre | Unité | Défaut | Signification | Effet sur la simulation |
|---|---|---|---|---|
| `streetStateEveryTicks` | ticks | 5 | Période de recalcul des états de rue. | Réactivité du blocage de rue (5 ticks = 0,5 s de jeu). |
| `waitRetryTicks` | ticks | 10 | Période de nouvelle tentative d’un groupe ou d’une unité en attente. | Reprise après réouverture ou apparition d’un itinéraire. |
| `lookAheadM` | m | 15 | Distance d’anticipation devant la tête d’un cortège pour la vitesse due aux autres foules. | Un cortège ralentit avant d’entrer dans une rue encombrée. |
| `walkMaskResolutionM` | m/cellule | 1 | Résolution du masque de marche (bâtiments rasterisés). | Précision du rejet des bâtiments ; mémoire ∝ 1/résolution². |
| `nav.speedFootMps` | m/s | 1.4 | Vitesse piétonne nominale pour le calcul du coût d’itinéraire. | Coût en secondes ; n’influence pas la vitesse réelle des groupes. |
| `nav.speedVehicleByClass.*` | m/s | 0: 8 · 1: 7 · 2: 6.5 · 3: 5.5 · 4: 5 · 5: 3 · 6: 3 | Vitesse nominale des véhicules par classe de voie (0 = interdit). | Préférence d’itinéraire des véhicules (grandes voies favorisées). |
| `nav.crowdPreferredWidthM` | m | 8 | Largeur praticable en dessous de laquelle une rue est pénalisée pour un cortège. | Les cortèges préfèrent les rues larges ; une ruelle reste possible si c’est nécessaire. |
| `nav.crowdNarrowPenalty` | multiple | 1.2 | Surcoût maximal (proportionnel au manque de largeur) pour un cortège dans une rue très étroite. | 0 : aucune préférence de largeur. |
| `nav.crowdPenaltyFootway` | multiple | 0.5 | Surcoût pour un cortège empruntant un chemin piéton étroit. | Les cortèges préfèrent rues et places. |
| `nav.crowdPenaltySteps` | multiple | 2 | Surcoût pour un cortège empruntant des escaliers. | Les cortèges évitent les escaliers sauf nécessité. |
| `nav.maxDetourRatio` | ratio (∞ = aucun) | ∞ | Détour maximal accepté par rapport à l’itinéraire direct. | Infini par défaut : aucun facteur ne peut empêcher un itinéraire alternatif valide. |

## Blocage des rues

| Paramètre | Unité | Défaut | Signification | Effet sur la simulation |
|---|---|---|---|---|
| `nav.referenceDensity` | personnes/m² | 2 | Densité de référence d’une foule « pleine largeur » (estimation de la largeur occupée quand la section n’est pas connue). | Doit rester cohérente avec `marchDensity`/`staticDensity` (avertissement sinon). |
| `nav.slowedDensity` | personnes/m² | 0.5 | Densité locale à partir de laquelle une rue est « ralentie ». | État 1 ; doit rester < saturation. |
| `nav.partialObstruction` | ratio (0–1) | 0.4 | Part de la largeur occupée à partir de laquelle la rue est « partiellement obstruée ». | État 2. |
| `nav.jamDensity` | personnes/m² | 5.4 | Densité de saturation (5,4 par défaut) : critère PARMI d’autres de blocage piéton ; sert aussi à la relation densité-vitesse. | Au-delà : la rue est bloquée aux piétons, quelle que soit la largeur libre. |
| `nav.footBlockMinDensity` | personnes/m² | 1.5 | Densité en dessous de laquelle une foule ne bloque jamais les piétons, même si elle occupe toute la largeur. | Le blocage piéton combine densité ET largeur libre (voir `nav.footMinWidthM`). |
| `nav.footMinWidthM` | m | 0.6 | Largeur libre minimale pour qu’un piéton franchisse une foule dense. | Une foule dense qui ne laisse pas cette largeur ferme la rue aux piétons. |
| `nav.vehicleMinFreeWidthM` | m | 3.5 | Largeur libre minimale pour qu’un véhicule franchisse une section occupée (3,5 m = véhicule + marge). | Au-dessous : rue « bloquée » pour les véhicules ; plafonnée à la largeur de la rue. |
| `nav.minPresenceM` | m | 3 | Longueur minimale de présence d’une foule sur une arête pour qu’elle occupe une section. | Ignore la queue ou la tête d’une colonne qui effleure l’arête. |
| `nav.minSpeedFactor` | ratio | 0.08 | Facteur de vitesse piéton plancher. | Dans une foule très dense on avance encore très lentement plutôt que de s’arrêter. |

## Rayons des niveaux de simulation : application cohérente

- La distance est **toujours** mesurée au bord du foyer d’attention : `distance = |point − centre du foyer| − rayon du foyer` (un point dans le foyer a une distance ≤ 0).
- Niveau **par groupe** : le point est le centre du groupe, la distance est diminuée de l’étendue du groupe (demi-longueur de colonne ou rayon de la zone). Niveau **par bloc** (groupes en marche ≥ `lod.blockMinGroupSize`) : le point est le milieu du bloc sur la route.
- Seuils : N2 si distance ≤ `lod.n2RadiusM` ; N1 si ≤ `lod.n1RadiusM` ; sinon N0. Rétrogradation retardée de `lod.hysteresis`. Un groupe sélectionné (épinglé) reste en N2.
- N0 → N1/N2 : positions réalignées sur leurs cibles dans le tick (le bloc n’était pas affiché). N2 → N1 : rapprochement borné par `blendMaxSpeedMps` (aucune téléportation).
