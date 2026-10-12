# Phase 3 — Validation intermédiaire (fin de 3a + 3b)

Date : 2026-10-11 · **Aucun commit, push ni pull request n'a été effectué.**

## 1. Fonctionnalités réalisées

**Navigation (3a)** — `src/nav/`
- Graphe de rues **indépendant de la carte** (tableaux typés, mètres locaux), construit depuis des données OSM (parseur Overpass JSON + politique de filtrage des voies) **ou** depuis la ville schématique. Provenance `osm` / `synthetic` conservée ; noms OSM conservés tels quels ; largeurs par défaut signalées ; composantes isolées écartées ; emprises de bâtiments et places extraites.
- Index spatial (grille 50 m), accrochage d'un point sur le graphe, **A\*** avec points de départ/arrivée libres, sens uniques (véhicules), départ sans demi-tour, règle de **sortie** d'une rue bloquée, **aucun facteur de détour maximal** (option `maxDetourRatio` désactivée par défaut), validation d'itinéraire (continuité, pas de boucle, pas de saut).
- **États de rue géométriques** (libre / ralenti / partiellement obstrué / bloqué) calculés par rue à partir de la largeur, de la surface, de la densité et de l'occupation — **plus aucun seuil universel de personnes** ; relation densité-vitesse ; fermetures de scénario ; compteur de rues bloquées dérivé.
- **Masque de marche** (rasterisation des bâtiments) pour interdire les positions dans les bâtiments.

**Moteur (3b)** — `src/engine/`
- Horloge à pas fixe (0, 0,5×, 1×, 3×, 6×), pause/reprise sans saut, plafond de rattrapage ; PRNG à graine + bruit stateless ; empreinte d'état (`stateHash`).
- **Causalité imposée** : `createGroup(spec, cause)` refuse toute création sans cause ; journal avec `why` ; historique par groupe ; `explain(id)`.
- Groupes : **cortège** (itinéraire sur le graphe, colonne qui s'étire selon la largeur, vitesse variable : type de groupe, largeur de rue, autres foules, cohésion, arrêts), **rassemblement statique** (ancre + zone praticable qui grandit avec l'effectif, propriété de préfixe), **groupe secondaire**, arrivée progressive (les individus s'absorbent un à un) puis installation, **replanification / attente / reprise** sur rue fermée ou saturée, **dispersion progressive**, **scission** et **jonction**, événements de scénario datés (apparition, fermeture/ouverture de rue, dispersion, scission).
- Individus : **un enregistrement par personne, aucun plafond** (≈ 45 octets/personne de tableaux typés), évaluation analytique continue, rappel amorti + bruit + rejet des bâtiments (N2).
- **Niveaux de simulation** par groupe (N0 agrégé, N1, N2) choisis selon des **foyers d'attention** abstraits fournis par l'hôte ; un groupe épinglé reste en N2 ; aucun individu ne disparaît.
- Paramètres : tout est dans `SimParams` (vitesse du cortège 1,1 m/s, densités, marges, rayons de niveaux…), surchargeable par scénario ou par groupe.

Non couvert à ce stade (3c/3d) : unités et véhicules, ordres, scénario de démonstration, intégration carte/interface, sélection par index spatial, interfaces de sprites, script de production des paquets OSM.

## 2. Tests exécutés et résultats

| Suite | Résultat |
|---|---|
| `npm run typecheck` | ✅ sans erreur |
| `npm test` (Vitest, 14 fichiers) | ✅ **132 tests passés** |
| `npx playwright test` (non-régression phase 2) | ✅ **23 tests passés** |
| `npm run build` | ✅ |

Couverture des tests de cette moitié de phase (principaux) :
- **Navigation** : A\* = Dijkstra sur graphes aléatoires (trois modes, sens uniques, trous) ; détour sur rue fermée ; absence d'itinéraire ; accrochage ; routes continues ; politique OSM (accès, trottoirs, sens uniques, largeurs, relations ignorées) sur **fixture simulée** ; graphe schématique connexe, bâtiments jamais sur une rue ; masque de marche (polygones concaves).
- **États de rue** : monotonie des états, résultat **différent selon la largeur pour un même effectif** (preuve de l'absence de seuil universel), passage des véhicules selon la largeur libre, relation densité-vitesse, versions, répartition de la charge par groupe.
- **Moteur** : causalité (refus sans cause, causes de scénario), cortège → arrivée → installation avec journal exact, vitesse bornée et configurable, colonne qui s'étire, **aucun individu dans un bâtiment** (≈ 10⁵ contrôles N2), individus dans la bande de rue (N1), **aucun déplacement instantané** (bornes testées en N1 et N2, y compris pendant scission/jonction), replanification/attente/reprise avec causes, dispersion progressive monotone, états de rue produits par la simulation, **reproductibilité** (même graine ⇒ même empreinte et journal ; logique collective identique en N0/N1/N2 ; effectif conservé), niveaux de simulation sans saut au retour en N2, scission/jonction (effectif conservé à chaque instant), horloge (indépendance du FPS, pause, plafond), pureté (aucun `Math.random`/horloge murale, aucune dépendance carte/DOM).

Défauts trouvés et corrigés grâce aux tests pendant cette moitié de phase : sens uniques et nœuds exacts dans A\* ; blocage par la rue de départ ; saut latéral aux virages (repères de sous-groupes, remplacés par évaluation exacte continue) ; micro-segments faussant les tangentes ; saut de position à l'entrée/sortie de la route (décalage latéral) ; ancre dans un bâtiment (exploration infinie de la spirale) ; mutation partagée des paramètres par défaut.

**Tests simulés vs services réels** : tout ce qui précède utilise des données **simulées** (fixture Overpass écrite à la main, ville schématique). **Aucune vérification n'a été faite sur un graphe OSM réel** (pas d'accès réseau ici) : voir §5.

## 3. Benchmarks et limites constatées

Détails complets : [`BENCHMARKS.md`](BENCHMARKS.md) (reproductible : `npm run bench:engine`, `-- --extended` pour 100 000 et 250 000). Machine : Xeon 2,1 GHz, 4 vCPU, Node 22, **un seul fil, moteur seul, sans rendu**. Valeurs dépendantes de la machine.

Temps moyen d'un tick (pas de 100 ms de jeu), en ms :

| Personnes | N2 individuel | N1 | N0 | mixte (foyer 250 m) |
|---|---|---|---|---|
| **Cortège géant (1 groupe)** | | | | |
| 5 000 | 0,81 | 0,45 | 0,01 | 0,48 |
| 10 000 | 1,84 | 0,75 | 0,02 | 0,83 |
| 25 000 | 3,91 | 1,98 | 0,03 | 2,19 |
| **50 000** | **8,25** | 4,27 | 0,02 | 4,24 |
| 100 000 | 17,2 | 8,34 | 0,02 | **16,8** |
| **20 groupes (marche + statique)** | | | | |
| 50 000 | 6,34 | 2,49 | 0,10 | 3,51 |
| 100 000 | 13,2 | 4,74 | 0,09 | 8,58 |
| **Rassemblements statiques** | | | | |
| 50 000 | 3,85 | 0,23 | 0,11 | — |

- **Mémoire** : ≈ **45 octets par personne** de tableaux typés (50 000 personnes ≈ 2,3 Mo) ; masque de marche ≈ 7,6 Mo pour 2,8 × 2,1 km à 1 m (croît avec la surface : 2 m de résolution diviserait par 4).
- **Mise en place** : groupes multiples ≈ 1,4 ms par 1 000 personnes (70 ms à 50 000) ; **cortège géant ≈ 24 ms par 1 000** (1,2 s à 50 000, ≈ 7 s à 250 000) car la disposition d'arrivée teste la visibilité de chaque créneau.
- **A\*** : ≈ 0,15 ms en moyenne (graphe de 1 800 arêtes).
- **Objectif 50 000 atteint** : 8 ms/tick en N2 ⇒ à 1× le moteur occupe ≈ 8 % du temps ; à 6× ≈ 50 % (sur cette machine, moteur seul).
- **Linéarité** : coût ∝ nombre d'individus en N2 (≈ 0,17 µs/personne/tick) ; 250 000 personnes = 46 ms/tick (non temps réel à 1×).

**Limites constatées**
1. **Un seul gros groupe ne profite pas du niveau « mixte »** (16,8 ms ≈ N2 à 100 000) : le niveau est choisi **par groupe**, or un cortège géant couvre tout le foyer. Optimisation proposée : **niveau par bloc d'individus (sous-groupes)** — seuls les blocs proches du foyer en N2.
2. **Coût de mise en place** du cortège géant (test de visibilité par rayons) : acceptable à 50 000, lourd au-delà ; optimisable (rayons échantillonnés, cache) si nécessaire.
3. **Rendu non mesuré** : le FPS navigateur sera mesuré en 3d, une fois le moteur branché (le rendu de la phase 2 tenait 60 img/s pour ≈ 1 200 points dessinés ; le rendu de dizaines de milliers de personnes nécessitera l'échantillonnage par LOD et l'atlas de sprites).
4. Moteur mono-fil : un `Worker` reste possible si le rendu et le moteur se concurrencent (non nécessaire à ce stade).

## 4. Problèmes restant à résoudre
- Intégration carte/interface, unités, véhicules, ordres (3c) ; interfaces de sprites (3d).
- **Aucune validation sur graphe OSM réel** ; le **script de production des paquets** reste à écrire (3c) ; qualité et alignement réels graphe ↔ carte à vérifier chez vous.
- **T5** (installation sur place après attente prolongée) non implémenté : le groupe reste en attente et alerte.
- Dispersion d'un cortège **en marche** (hors rassemblement installé) non couverte ; scission d'un groupe en dispersion refusée.
- Densités et paramètres de gameplay à valider visuellement (rayon d'un rassemblement de 50 000 personnes ≈ 150–400 m selon la voirie).
- Journal : pas encore de regroupement des messages répétitifs.

## 5. Décisions à arbitrer
1. **Modèle de blocage** : piétons bloqués **seulement à saturation** (ρ ≥ 5,4 pers/m²) ; véhicules bloqués si largeur libre < largeur du véhicule (2,5 m) + marge (1 m). Valeurs et principe OK ?
2. **Optimisation proposée (recommandée)** : niveau de simulation **par sous-groupe** pour les très gros groupes, à réaliser **en 3c** — ou la reporter, les mesures actuelles (8 ms à 50 000) suffisant ?
3. **Évaluation exacte plutôt que repères de sous-groupes** (continuité des positions) : les sous-groupes servent désormais uniquement à la simulation par blocs. D'accord ?
4. **Paquets OSM** : je livre en 3c le script `build-city-pack` (testé sur fixtures). Qui l'exécute pour Metz/Paris/Lyon/Marseille : **vous** (réseau + procédure documentée), ou souhaitez-vous m'ouvrir un accès réseau limité ?
5. **Périmètre de 3c** : unités/véhicules et ordres simultanés, scénario de démonstration (cortège, rassemblement, fermeture de rue, scission, jonction, dispersion), HUD avec vraies vitesses/journal « pourquoi », index de sélection, suppression des données de démonstration de la phase 2. Confirmé ?
6. **Paramètres initiaux** (densité 2 pers/m² en marche et en rassemblement, largeur de front max 14 m, vitesses 1,1 / 1,2 m/s, rayons de niveaux 400 m / 2,5 km…) : à conserver ou ajuster ?

## 6. Fichiers

**Créés** : `src/nav/{graph,params,spatialGrid,heap,route,astar,streetState,walkMask,schematicGraph}.ts`, `src/nav/osm/{tagsPolicy,parseOverpass,buildGraph}.ts`, `src/engine/{params,rng,types,journal,clock,layout,members,motion,sim}.ts`, `scripts/bench-engine.ts`, `tests/unit/{navHelpers,engineHelpers,osmGraph,astar,streetState,schematicGraph,engine,clock,purity}…`, `tests/fixtures/{make-overpass-mini.mjs,overpass-mini.json}`, `docs/{PHASE3_PLAN,PHASE3_MIDPOINT,BENCHMARKS}.md`, `docs/reference/planche-graphique-reference.png`.
**Modifiés** : `docs/CAHIER_DES_CHARGES.md` (v0.4), `src/map/SchematicAdapter.ts` (dessin des bâtiments via la source commune), `src/geo/schematicCity.ts` (déplacé de `src/map/schematic/city.ts`, + `blockRect`/`buildingQuads`), `package.json` (script `bench:engine`), `vite.config.ts` (délai des tests), `.gitignore`, `README.md`.
