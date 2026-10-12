# Phase 3c — rapport intermédiaire : moteur réel branché à l'interface

Date : 2026-10-12. Branche `claude/cahier-des-charges-phase1`. **Rien n'est passé en phase 4** ; en attente de votre validation.

Légende : ✅ vérifié par un test ou une mesure indiquée · ⚠️ non vérifié / à valider sur données réelles · 🎮 hypothèse de gameplay.

## 1. Ce qui est jouable maintenant

Au lancement (fond schématique), une partie réelle démarre sur le moteur :

- **Scénario de démonstration** (`src/scenarios/demoScenario.ts`), généré sur n'importe quel graphe, chaque événement avec sa raison :
  piquet statique de 120 personnes devant un bâtiment ; cortège de 2 500 personnes entrant par l'ouest vers la place ; **rue fermée par le scénario**
  à 30 % de l'ETA (travaux fictifs) → le cortège replanifie (« longueur inchangée » si la déviation fait la même longueur) ; rue rouverte à 75 % ;
  à l'arrivée un détachement de 6 % rejoint le piquet (scission puis jonction) ; le cortège s'installe, puis se disperse vers le sud.
  ETA estimée ≈ 1 180 s de jeu (≈ 3 à 6 min à 6×). Dispositif : 8 unités (CRS, police nationale, gendarmerie mobile, unité spécialisée) et 7 véhicules.
- **Horloge** : ⏸ / 0,5× / 1× / 3× / 6× réels (pas fixe 100 ms), Espace = pause.
- **Interface lue depuis le moteur** : compteurs (rues bloquées N/M avec détail partielles/ralenties, forces, manifestants, véhicules), horloge de jeu,
  panneau de sélection (type, phase, effectif, **vitesse réelle** en km/h et m/s, **raison de la vitesse**, tension, niveau de simulation N0/N1/N2,
  destination, avancement, « pourquoi ce groupe existe », historique et causes), **journal** avec « Pourquoi ? » sur chaque ligne, bandeaux issus des événements importants.
- **Ordres** (unités et véhicules) : clic gauche = sélection (Maj = ajout, plusieurs unités/véhicules), clic droit sur la carte ou bouton « Aller ici » = déplacement
  (ordre simultané en formation, pas de superposition), « Annuler l'ordre » / Suppr, refus expliqué. Itinéraire fantôme et marqueur de destination dessinés.
- **Rendu** : individus tracés depuis les positions interpolées du moteur (échantillonnage uniforme au-delà de 9 000 points), symboles agrégés à faible zoom,
  10 types de véhicules, 4 types de forces, anneaux d'état des unités (en position, déplacement + flèche, attente, engagé, difficulté, indisponible),
  surcouche des états de rue (ralentie / partiellement obstruée / bloquée / fermée ✕). Visuels volontairement provisoires ; architecture de sprites inchangée (3d).
- **Sélection** par index spatial (`SelectionIndex`) : unités/véhicules d'abord, puis individus d'un groupe (grille construite seulement pour le groupe touché).
- **Cohérence fond ↔ graphe** : le graphe simulé est celui de la carte affichée. Fond OSM → paquet `public/data/osm/<ville>.graph.json` ; **absent ou invalide → repli
  automatique sur le fond schématique avec message explicite** (jamais de rues simulées qui ne correspondent pas à la carte). Changement de ville ou de fond = redémarrage du moteur.
- **Supprimé** : toutes les données de démonstration de la phase 2 (compteurs d'incidents, « tension » générale, objectifs factices, bouton d'événement de démonstration,
  `getStreetSegments`, `src/demo`, `src/geo/streets.ts`, ancienne foule animée).

## 2. Arbitrages appliqués

| Sujet | Réalisation |
|---|---|
| Blocage de rue | 5,4 pers/m² = `jamDensity` configurable, **jamais le seul critère** : géométrie (largeur libre en section, présence sur l'arête), répartition, passabilité. Véhicules : largeur libre minimale 3,5 m (`vehicleMinFreeWidthM`). États : libre / ralenti / partiellement obstrué / bloqué. Tests dans `streetState.test.ts`. ✅ |
| Niveaux de simulation | N2 par **blocs d'individus** proches du foyer ; pas de téléportation (réalignement des positions périmées N0 uniquement hors de la zone détaillée, voir §3) ✅ |
| Positions | évaluation individuelle exacte le long des routes ; les blocs ne servent qu'aux niveaux ✅ |
| Paquets OSM | script documenté et testé sur fixtures, **aucun téléchargement lancé** (voir §6) ✅ fixtures / ⚠️ réel |
| Paramètres | tous dans `SimParams`, documentés (`docs/PARAMETRES.md`, généré et testé), validés (`validateSimParams`) ✅ |
| Git | jalon moteur poussé (`338c9bc`), puis ce jalon ; aucun push forcé, aucune PR |

Valeurs initiales (configurables) : densité 2 pers/m² (marche et rassemblements), front max 14 m, vitesses 1,1 / 1,2 m/s, rayon détaillé 400 m, rayon intermédiaire 2,5 km.
Cohérence vérifiée par `params.test.ts` : densités < `jamDensity` (5,4), `slowedDensity` < `jamDensity`, `n1 ≥ n2`, etc. ; les rayons N2/N1 sont appliqués partout
par la même fonction (`levelFor`, distance au **bord** du foyer), à la fois pour les groupes et pour les blocs ✅.

## 3. Niveaux N2/N1/N0 par blocs : critères, coût, transitions

**Foyer d'attention** = centre de la vue + demi-diagonale (m) → distance d'un point = distance au centre − rayon du foyer. N2 si ≤ 400 m, N1 si ≤ 2,5 km, sinon N0 ;
10 % d'hystérésis à la rétrogradation ; les groupes **sélectionnés** restent en N2 complet.

**Sélection des blocs** (`selectBlockLevels`) : seuls les groupes **en marche de plus de 4 000 personnes** (`lod.blockMinGroupSize`) sont découpés ; un bloc = 256 individus
consécutifs le long de la colonne (`lod.blockSize`, contigus donc spatialement compacts). Son niveau vient de la distance au foyer du **milieu du bloc sur la route**
(prolongement rectiligne derrière le point d'entrée compris : **un défaut trouvé et corrigé pendant cette étape** — les blocs situés derrière l'entrée étaient évalués au point d'entrée
donc toujours en N2 ; test de non-régression ajouté). En dessous du seuil : un seul niveau par groupe (pas de complexité inutile).

**Coût de la sélection** (mesuré) : 11 µs (40 blocs, 10 000 pers.) · 32 µs (196 blocs, 50 000) · 139 µs (977 blocs, 250 000) par tick. Négligeable devant le tick (> 1 ms).

**Gain mesuré** (Node, Xeon 2,1 GHz, moteur seul, foyer 250 m suivant le groupe, cortège géant entrant par une porte) :

| Personnes | N2 partout | « mixte » (blocs) |
|---:|---:|---:|
| 50 000 | 8,4 ms/tick | 5,4 ms |
| 100 000 | 17,7 ms | 9,3 ms |
| 250 000 | 38,8 ms | 8,9 ms |

Plus de gain lorsque la colonne est longue par rapport au foyer. Sur le scénario « multi-groupes » (20 groupes de < 12 500 pers., niveau par groupe) le gain est faible
(50 000 : 5,5 → 5,5 ms ; 250 000 : 30,6 → 30,2 ms) : la dispersion des groupes dans la zone place beaucoup d'entre eux dans les 400 m + 2,5 km. Les mesures varient d'environ ±20 % d'une exécution à l'autre.

**Transitions** (tests) : `lod.test.ts` (seuils, hystérésis, blocs, effectif conservé, continuité à l'entrée/sortie des niveaux) et `controller.test.ts` : une caméra qui revient vers un groupe
passé en N0 le fait traverser N0 → N1 → N2 ; **dès qu'un individu est dans la zone détaillée, son déplacement par tick reste physique** (≤ `blendMaxSpeedMps`·dt + marche) ;
le réalignement des positions périmées d'un bloc ex-N0 a lieu **uniquement tant qu'il est au-delà de 400 m du bord de la vue**, donc jamais visible ✅. ⚠️ Limite : si la caméra *saute* brutalement
(changement de ville, recentrage instantané) sur un groupe en N0, ses individus sont placés d'emblée à leur position analytique réelle (ils n'ont jamais été visibles auparavant) — il n'y a pas de transition à animer.

## 4. Tests exécutés (cette machine)

| Suite | Résultat |
|---|---|
| `tsc --noEmit` | ✅ |
| Vitest | **193 tests / 18 fichiers ✅** (navigation, états de rue, moteur, LOD, unités/ordres, paramètres, paquets OSM sur fixtures, sélection, **contrôleur**, **scénario de démonstration headless** : histoire du journal avec causes, conservation des effectifs, déterminisme, aucun individu dans un bâtiment, fermeture comptée) |
| Playwright | **27 tests ✅** (`--workers=1`, Chromium 1194) : accueil, recherche de ville, schématique sans requête externe, compteurs = moteur, alignement (< 0,75 px, en pause), sélection clic/liste, ordres simples et simultanés (vitesse/état réels, annulation), vitesses ⏸ 1× 6×, journal « Pourquoi ? », changement de ville, zone, **scénario complet** (fermeture, réouverture, scission, dispersion), MapLibre (calage, animation de caméra 0,01 px), repli sans paquet / erreur de style / tuiles |

## 5. Benchmarks

**Moteur seul** (`npm run bench:engine -- --extended`, `docs/BENCHMARKS.md` régénéré) : voir §3 ; rappel 50 000 personnes ≈ 8 ms/tick en N2 (cortège géant), 5 ms (statique) ;
250 000 ≈ 39 ms/tick en N2 ; mémoire 45 octets/personne (10,7 Mo pour 250 000).

**Navigateur, rendu logiciel sans GPU** (Playwright, schématique, caméra animée en continu autour de la place, `npx playwright test bench`) :

| Foule supplémentaire | Personnes | Points tracés (≈) | Dessin moy. (p95) | Tick moteur moy. | Cadence |
|---:|---:|---:|---:|---:|---:|
| 0 | 2 620 | ≈ 120 (en vue) | 0,44 ms (0,70) | 0,64 ms | 60 img/s |
| 20 000 | 22 620 | ≈ 6 700 | 3,5 ms (4,9) | 2,3 ms | 32 img/s* |
| 50 000 | 52 620 | ≈ 5 200 | 2,9 ms (4,6) | 5,6 ms | 36 img/s* |

\* Le coût du dessin de la couche de jeu et le tick moteur totalisent < 10 ms ; la cadence plus basse vient du redessin complet du fond schématique (Canvas 2D logiciel) à chaque
déplacement de caméra imposé par le banc d'essai. ⚠️ Non mesuré sur une machine avec GPU ni avec la carte MapLibre/OSM réelle.

## 6. Paquets OSM (pas de réseau ici)

Script `npm run data:pack` (`scripts/build-city-pack.ts`) : requête Overpass unique bornée (≤ 12 km²), `--print-query` pour un export manuel, `--input` pour un fichier local, `--fetch` seulement avec
`--confirm-network` et `--user-agent` explicite, 20 s entre villes, arrêt sur HTTP 429/504, licence ODbL écrite dans chaque paquet. Procédure complète (dépendances, commandes, fichiers produits,
limites des services) : `docs/DONNEES_OSM.md`. ✅ Testé sur la fixture `overpass-mini.json` (de bout en bout dans un dossier temporaire : 18 arêtes, 13 nœuds, 2 espaces, 2 bâtiments, 0 requête réseau).
⚠️ **Aucun vrai paquet OSM n'a été généré ni testé** : les performances, la qualité du graphe (impasses, largeurs, sens uniques) et l'alignement sur de vraies rues restent à valider sur votre machine.
Tant qu'aucun paquet n'est présent, le jeu fonctionne en fond schématique.

## 7. Vérifié / non vérifié

| Vérifié | Non vérifié |
|---|---|
| Moteur ↔ UI ↔ rendu sur le graphe schématique, scénario complet de bout en bout (unitaire headless + navigateur) | Tout sur **données OSM réelles** (graphe, bâtiments, noms, largeurs, noms de rues, performances A*) |
| Alignement des pions sur la caméra (MapLibre style de test et schématique) | Fluidité sur GPU réel ; carte OSM réelle (tuiles) |
| Blocage géométrique, états intermédiaires, replanification, attente, fermetures | Équilibrage du gameplay (vitesses, tailles) : paramètres initiaux uniquement |
| N0/N1/N2 et blocs (tests + benchmarks), pas de saut visible | Accessibilité clavier complète des ordres (clic droit / bouton / Suppr seulement) |
| Journal causal : chaque événement a une cause (test) | Rendu final (sprites) : prévu en 3d |

## 8. Limites et points à arbitrer

1. **Fond OSM sans paquet → repli schématique** : conforme à votre règle de cohérence, mais l'écran d'accueil lancera donc le schématique jusqu'à ce que vous ayez généré les paquets. OK ?
2. `T5` (installation sur place après attente) reste différée.
3. Les unités ne gèrent encore qu'un ordre « aller à » ; engagement, fatigue, embarquement dans les véhicules : phases 4 et 6.
4. Le clic sur un individu précis le sélectionne (`member`), mais le panneau n'affiche que son numéro (pas encore de comportement individuel).
5. 3d à venir (non commencée) : interfaces de sprites (`SpriteManifest`, `SpriteProvider`, `RenderableSnapshot`), finition, benchmarks navigateur avec GPU.
