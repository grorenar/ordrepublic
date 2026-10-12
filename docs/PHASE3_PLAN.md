# Phase 3 — Moteur de simulation et navigation : plan technique détaillé

Version **2.0** du plan — 2026-10-11 — **plan validé avec les décisions v0.4** (cahier des charges §22–§27) ; implémentation en cours.
Changements substantiels par rapport à la v1.0 : **plus de plafonds** de membres (objectif de test 50 000, architecture évolutive), **niveaux de simulation**
(N0/N1/N2) et **sous-groupes de calcul**, **blocage de rue géométrique à états intermédiaires** (plus de seuil de 60), **plus de facteur de détour maximal**,
paramètres tous configurables (`SimParams`), **noms OSM affichés**, **architecture de sprites** issue de la planche de référence, **validation intermédiaire à mi-phase**.

Légende : ✅ vérifié · ⚠️ à re-vérifier · 🎮 paramètre/hypothèse de gameplay (jamais présenté comme règle officielle).

---

## 1. Objectif et périmètre

**Objectif** : un moteur minimal mais fonctionnel, indépendant de la carte, où des **groupes cohérents** (cortèges, rassemblements statiques, groupes
secondaires) et des **unités/véhicules** se déplacent **sur un graphe de rues**, avec des **états vérifiables**, un **journal explicatif**, un
**temps réel avec pause et vitesses**, branché sur la carte et le rendu existants.

| Inclus en phase 3 | Hors phase 3 (phase indiquée) |
|---|---|
| Graphe de navigation (OSM + schématique), A*, état dynamique des arêtes, rues bloquées | POI complets, incidents, incendies, dégradations (4) |
| Groupes logiques, membres simulés, 3 types de rassemblement, FSM + transitions causales | Silhouettes finales, densité de foule avancée, comportements individuels riches (5) |
| Unités et véhicules : ordres « aller à », annuler, replanification, état visuel | Moyens de maintien de l'ordre, blessures, secours, pompiers (6) |
| Horloge à pas fixe, pause, 0,5×/1×/3×/6×, interpolation | Objectifs, score, bilan, sauvegarde complète, bac à sable (7) |
| Journal explicatif (« pourquoi ») + historique par groupe | Embarquement des unités dans les véhicules (4/6) |
| Rendu : lecture de l'état du moteur, états visuels de base, index de sélection | Fragmentation déclenchée par des incidents (4) |
| Scénario de démonstration du moteur + tests | |

---

## 2. Structures de données

Principe : **tout l'état est de la donnée sérialisable** (objets simples + tableaux typés), en **mètres locaux** (x = est, y = nord, origine = centre de la
ville), sans référence à MapLibre ni au DOM. Le rendu ne stocke jamais de coordonnées écran comme position principale.

```ts
type Id = string;
type Provenance = 'osm' | 'synthetic';

// --- Causalité (§14) -------------------------------------------------------
interface Cause {
  kind: 'scenario_plan' | 'scenario_event' | 'transition' | 'player_order' | 'rule';
  refId: string;          // id de l'élément de plan/événement/groupe parent à l'origine
  note: string;           // phrase explicative en français, utilisée par le journal
}

// --- Journal explicatif ------------------------------------------------------
interface LogEvent {
  id: number; tick: number; simTimeMs: number;
  level: 'info' | 'warn' | 'alert';
  subject?: { type: 'group' | 'unit' | 'vehicle' | 'edge' | 'scenario'; id: Id };
  code: string;           // ex. 'group.arrived', 'group.rerouted', 'group.split'
  text: string;           // message court affiché
  why: Cause;             // cause identifiable
  data?: Record<string, number | string>;
}

// --- Graphe (statique, immuable) --------------------------------------------
interface StreetGraph {
  version: 1;
  origin: { lng: number; lat: number };       // repère local
  nodeCount: number; edgeCount: number;
  nodeX: Float32Array; nodeY: Float32Array;   // m
  // arêtes (orientation a→b conventionnelle)
  edgeA: Uint32Array; edgeB: Uint32Array;
  edgeLen: Float32Array;                      // m (longueur de la géométrie)
  edgeClass: Uint8Array;                      // énum : primary…residential, pedestrian, footway, steps, service
  edgeWidth: Float32Array;                    // m, estimée (width OSM sinon défaut par classe)
  edgeFlags: Uint8Array;                      // bits : oneway(a→b), onewayRev, foot, motor, bridge, tunnel
  edgeShapeStart: Uint32Array; shape: Float32Array; // polyligne (x,y…) par arête, CSR
  edgeName: (string | undefined)[];
  // adjacence (CSR) : pour chaque nœud, liste d'arêtes incidentes
  adjStart: Uint32Array; adj: Uint32Array;
  spaces: OpenSpace[];                        // places/parcs (polygones) — zones de rassemblement possibles
  obstacles: Polygon[];                       // emprises de bâtiments (peut être vide)
  provenance: { source: Provenance; osmTimestamp?: string; coverage: number /*0..1 estimé*/ };
}
interface OpenSpace { id: Id; kind: 'square' | 'park' | 'pedestrian_area'; ring: Float32Array; name?: string; source: Provenance }

// --- État dynamique des arêtes (modifiable par la simulation) ----------------
type StreetState = 0 | 1 | 2 | 3;    // 0 libre · 1 ralenti · 2 partiellement obstrué · 3 bloqué
interface EdgeState {
  scenarioBlock: Uint8Array;  // 1 si fermée par le scénario (barrage, travaux fictifs…)
  load: Float32Array;         // personnes présentes sur l'arête (dérivé des groupes)
  density: Float32Array;      // personnes / m² de surface de rue
  occupiedWidth: Float32Array;// largeur occupée estimée (m)
  footState: Uint8Array;      // StreetState pour les piétons (géométrie + densité), voir §3.4
  vehState: Uint8Array;       // StreetState pour les véhicules (largeur libre ≥ largeur du véhicule + marge)
  speedFactor: Float32Array;  // facteur de vitesse piéton (relation densité-vitesse)
  version: number;            // incrémenté quand un état change → revalidation des routes
}

// --- Route -------------------------------------------------------------------
interface Route {
  id: Id; mode: 'foot' | 'vehicle';
  nodes: Uint32Array; edges: Uint32Array;
  pts: Float32Array; cum: Float32Array;       // polyligne continue + abscisses curvilignes
  length: number; graphVersion: number;
}

// --- Groupes de manifestants (logique collective) -----------------------------
type GatheringKind = 'march' | 'static' | 'secondary';
type GroupPhase =
  | 'forming'      // en cours de constitution à l'origine
  | 'moving'       // en déplacement sur sa route
  | 'waiting'      // arrêté (route bloquée, attente)
  | 'settled'      // rassemblement installé (statique)
  | 'dispersing'   // départ progressif
  | 'dispersed';   // dissous (effectif 0) — retiré après journalisation
interface CrowdGroup {
  id: Id; label: string;
  kind: GatheringKind; phase: GroupPhase;
  size: number;                               // effectif logique (personnes)
  members: MemberSet;                         // membres simulés (échantillon pondéré)
  cohesion: number; tension: number; morale: number;   // 0..100 (phase 3 : cohésion et tension actives)
  anchor?: Anchor;                            // lieu de rattachement (static) ou destination
  route?: Route; routeS: number;              // progression le long de la route (m)
  plan: GroupPlan;                            // destination, points de passage, comportement à l'arrivée
  origin: Cause;                              // OBLIGATOIRE (invariant)
  parentId?: Id;
  history: HistoryEntry[];                    // événements importants (borné)
  speedMps: number;                           // vitesse courante (dérivée, affichable)
}
interface GroupPlan {
  destination?: Anchor;                       // pour march/secondary
  waypoints: Anchor[];
  onArrival: 'settle' | 'disperse' | 'join_target' | 'hold';
  patienceMs: number;                         // attente max si aucun itinéraire (0 = illimitée)
  dispersalExit?: Anchor;                     // porte de sortie
}
interface Anchor { id: Id; kind: 'node' | 'space' | 'place' ; pos: Vec2; nodeId?: number; radius: number; label: string; source: Provenance }

// Membres : tableaux typés (structure of arrays) — O(N) par tick
interface MemberSet {
  n: number;                  // individus simulés = effectif du groupe (aucun plafond structurel)
  subgroupSize: number;       // taille des sous-groupes de calcul (paramètre)
  x: Float32Array; y: Float32Array;       // positions courantes
  px: Float32Array; py: Float32Array;     // positions du tick précédent (interpolation)
  slotA: Float32Array; slotB: Float32Array; // créneau : (along, lateral) en marche ; (angle, rayon relatif) en statique
  seed: Uint32Array;          // graine individuelle stable (bruit, apparence : le rendu choisit le sprite)
  role: Uint8Array;           // rôle sémantique (0 = standard ; codes réservés scénario/phase 4)
  state: Uint8Array;          // 0 suit, 1 hésite, 2 part, 3 parti
  leaveAt: Float32Array;      // temps de départ échelonné (dispersion)
}

// --- Unités et véhicules ---------------------------------------------------------
type UnitStatus = 'idle' | 'moving' | 'waiting' | 'engaged' | 'in_difficulty' | 'unavailable';   // ↔ anneaux de la planche de référence
type ForceKind = 'crs' | 'police_nationale' | 'gendarmerie_mobile' | 'unite_speciale';
interface Loadout { shield: boolean; helmet: boolean }   // sémantique ; le rendu choisit le sprite
interface Mover {              // commun unités/véhicules
  pos: Vec2; prevPos: Vec2; heading: number; prevHeading: number;
  speedMps: number; maxSpeedMps: number; turnRateRadPerS: number;
  mode: 'foot' | 'vehicle';
  route?: Route; routeS: number; orderId?: Id; status: UnitStatus;
}
// ForceUnit/Vehicle (phase 2) enrichis de Mover + identifiant fictif STABLE (callsign/num) ; id jamais réattribué.

interface Order { id: Id; kind: 'move' | 'hold' | 'cancel'; unitIds: Id[]; target?: Vec2; issuedAtTick: number; cause: Cause /* player_order */ }

// --- Scénario (phase 3 : forme minimale) ------------------------------------------
interface Scenario {
  id: string; seed: number;
  anchors: Anchor[]; gateways: Anchor[];     // portes d'entrée/sortie de la zone
  groups: GroupPlanEntry[];                  // mise en place initiale (avec cause)
  timeline: ScenarioEvent[];                 // événements datés, chacun avec « reason »
  forces: UnitSpawn[];                       // unités et véhicules de départ
}
type ScenarioEvent =
  | { id: Id; atMs: number; kind: 'spawn_group'; groupSpec: GroupSpec; reason: string }
  | { id: Id; atMs: number; kind: 'close_street'; edgeId: number; reason: string }
  | { id: Id; atMs: number; kind: 'open_street'; edgeId: number; reason: string }
  | { id: Id; atMs: number; kind: 'split_group'; groupId: Id; count: number; child: GroupSpec; reason: string }
  | { id: Id; atMs: number; kind: 'begin_dispersal'; groupId: Id; exit: Id; reason: string };

// --- État global ------------------------------------------------------------------
interface SimState {
  schemaVersion: 1;
  meta: { seed: number; rngState: number[]; tick: number; simTimeMs: number; scenarioId: string };
  edge: EdgeState;
  groups: Record<Id, CrowdGroup>; units: Record<Id, ForceUnit>; vehicles: Record<Id, Vehicle>;
  orders: Record<Id, Order>; pendingCommands: Command[];
  nextScenarioIndex: number; log: LogEvent[]; counters: { nextId: number; nextLogId: number };
}
```

**Aucun plafond structurel de membres** (ni par groupe, ni au total). Trois niveaux distincts :

| Niveau | Contenu | Où |
|---|---|---|
| **Individus simulés** | un enregistrement par personne dans des tableaux typés (`MemberSet`, `n = size`) | moteur |
| **Sous-groupes de calcul** | blocs contigus d'individus (taille paramétrable, défaut 32) qui partagent un calcul de référence (position sur la route, repère local, largeur de rue) | moteur (optimisation) |
| **Pions dessinés** | échantillon des individus, décidé par le rendu selon le zoom (permutation fixe → pas de scintillement) | rendu |

**Niveaux de simulation par groupe** (choisis chaque tick par `SimLodPolicy` selon distance au foyer d'attention, densité, présence d'événements/sélection ; paramétrables) :
**N0 agrégé** (seul le centre avance ; positions des individus = fonctions analytiques évaluées à la demande), **N1 sous-groupes** (repères de sous-groupes mis à jour,
individus placés par décalage), **N2 individuel** (ressort amorti, hésitations, départs). Aucun individu ne disparaît : seule la **finesse de mise à jour** varie ;
les passages de niveau n'introduisent pas de saut (les positions sont initialisées depuis la fonction analytique). Les seuils sont des paramètres, réglés **à partir des benchmarks** (§11.3).

---

## 3. Graphe de navigation

### 3.1 Sources (aucune dépendance aux tuiles affichées)
1. **Paquet de ville pré-calculé** (`data/osm/<ville>.graph.json.gz`) — voie principale (voir §3.5 pour la production).
2. **Requête Overpass bornée** à la zone de jeu — voie secondaire, **déclenchée par le joueur**, mise en cache IndexedDB.
3. **Graphe schématique** (`buildSchematicGraph`) — mode démonstration et repli : généré depuis la ville procédurale existante ; mêmes structures.

**Règle** : si une ville n'a ni paquet ni requête réussie, la partie bascule sur le fond schématique (D5) ; on n'affiche **jamais** un graphe synthétique
par-dessus une vraie carte.

### 3.2 Construction depuis OSM (`nav/osm/`)
- `parseOverpass(json)` → voies et nœuds bruts (format Overpass JSON `out geom` ; parseur testé sur des **fixtures écrites à la main**, sans réseau).
- **Politique de filtrage** (table testée, ⚠️ à revalider sur le wiki OSM) :
  - piétons/cortèges : `highway` ∈ {pedestrian, living_street, residential, unclassified, tertiary, secondary, primary, service, footway, path, steps, track}
    ; exclus : `access=no|private` (sauf `foot=yes`), `highway=motorway|trunk`, `indoor=*` ;
  - véhicules : sous-ensemble sans pedestrian/footway/path/steps, `motor_vehicle` ≠ no/private ; `oneway` respecté (véhicules uniquement) ;
  - `area=yes` + `highway=pedestrian` ou `place=square` → `OpenSpace` (pas d'arête-ligne) ;
  - `bridge`/`tunnel` : conservés comme drapeaux (pas de gestion de niveaux en V1).
- **Découpage** des voies en arêtes aux intersections (nœud partagé par ≥ 2 voies ou extrémité), géométrie conservée en polyligne (virages, rendu, route).
- **Largeur** : `width` si présent et plausible, sinon table par classe (🎮 : primary 14 m, residential 8 m, pedestrian 10 m, footway 3 m…). Les largeurs
  par défaut sont **signalées** (`widthDefaulted`) pour que l'interface n'affiche pas une précision inexistante.
- **Nettoyage** : composantes connexes minuscules supprimées ; nœuds de degré 2 non intersectifs fusionnés ; arêtes dupliquées dédoublonnées.
- `coverage` : ratio estimé (longueur des voies / surface de la zone) → alerte « données OSM pauvres ».
- Places : `OpenSpace` reliées au graphe par des **arêtes d'accès** entre le centroïde et les nœuds proches du contour (zone traversable pour les membres).

### 3.3 Requêtes et structures
- **Index spatial** : grille uniforme (cellule 50 m) → `nearestEdge(p)`, `edgesInDisc(c, r)` en O(k).
- **Accrochage** (`snap`) d'un point libre sur le graphe : projette sur l'arête la plus proche → point virtuel (arête + abscisse).
- **A\*** (tas binaire) sur arêtes avec **points de départ/arrivée virtuels** (on amorce la recherche avec les deux extrémités de l'arête d'accrochage,
  coût partiel de la demi-arête) ; heuristique euclidienne / vitesse maximale (admissible) ; résultat en `Route` (polyligne continue + abscisses).
- **Coût d'arête** (fonction pure, paramétrable) :
  `coût = longueur / (vitesseClasse(mode) × facteurÉtat) × (1 + pénalitéClasse)` ; `facteurÉtat` dérive de l'état de rue (§3.4) : libre 1, ralenti/partiel = facteur de vitesse issu de la densité,
  bloqué = ∞ pour les véhicules et pour les piétons seulement si la largeur franchissable est nulle ; fermeture de scénario → ∞ ; sens uniques → ∞ à contresens (véhicules) ;
  `steps` et `footway` pénalisés pour les cortèges (paramètres).
- **Aucun facteur de détour maximal** : A* cherche toujours un itinéraire valide ; `maxDetourRatio` existe en option (désactivé par défaut). **Validité d'un itinéraire** (testée) :
  continuité géométrique, **pas de boucle** (aucun nœud répété), longueur > 0, pas de téléportation (déplacement par tick ≤ vitesse × dt) ; **si aucun itinéraire satisfaisant n'existe, le groupe reste sur place** (état « en attente » journalisé).
- Aucun accès au DOM, à MapLibre ni au temps réel : fonctions pures sur `StreetGraph` + `EdgeState`.

### 3.4 Rues bloquées : modèle géométrique à états intermédiaires
Pas de seuil universel. Pour chaque arête (largeur `W`, longueur `L`, surface `A = W·L`) :
1. **Charge** `n_e` : personnes présentes (marche : recouvrement entre l'étendue de la colonne `[s−L/2, s+L/2]` et les arêtes de la route ; statique : part de la surface praticable de chaque arête dans l'emprise du rassemblement). Calcul **par groupe** (agrégé), pas par individu.
2. **Densité** `ρ = n_e / A` (pers/m²) ; **largeur occupée** `w_occ = min(W, n_e / (L·ρ_réf))` (`ρ_réf` : densité de référence d'une foule, paramètre).
3. **Largeur libre** `w_libre = W − w_occ`.
4. **État de rue** (seuils paramétrables) : *libre* ; *ralenti* si `ρ ≥ ρ₁` ; *partiellement obstrué* si `w_occ/W ≥ o₁` ; *bloqué* : pour un **véhicule** si `w_occ > 0` et `w_libre < largeurMin` (largeur du véhicule + marge, plafonnée à la largeur de la rue) ; pour un **piéton** seulement à saturation `ρ ≥ ρ_jam` (une foule dense se traverse lentement, elle ne ferme pas la rue aux piétons).
5. **Vitesse piétonne** : relation densité-vitesse `f(ρ) = clamp(1 − ρ/ρ_jam, f_min, 1)` (paramètres).
- `EdgeState.version` est incrémenté quand un état change ; les routes portent `graphVersion` et sont revalidées. Fermetures de scénario : `scenarioBlock`.
- Compteur HUD **« rues bloquées N/M »** : `N` = arêtes de la zone *bloquées* (pour véhicules) ou fermées, avec détail ralenties/partielles en info-bulle ; `M` = arêtes de la zone.
  Même source que la simulation (le mécanisme `queryRenderedFeatures` de la phase 2 est **supprimé**).

### 3.5 Production des paquets de ville et licence
- Script `scripts/build-city-pack.mjs` (livré et testé sur fixtures) : prend un fichier Overpass JSON ou OSM PBF/XML local et produit le paquet
  (graphe + POI utiles en phase 4) pour une emprise limitée (zone max 2 800 × 2 100 m + marge).
- **Aucun téléchargement massif** : une exécution **unique** par ville, côté développeur, avec un identifiant d'application (`User-Agent`) ; le dépôt ne
  contient jamais de requête automatique répétée. Repères du service public Overpass ✅ (recherche web) : < 10 000 requêtes et < 1 Go/jour, à diviser par 100 pour un usage régulier ; usage commercial → instance dédiée.
  Alternative sans service interactif : extrait régional OSM + outil d'extraction local (⚠️ conditions de téléchargement à vérifier).
- **Licence** ⚠️ : paquets = base de données dérivée OSM (ODbL) → dossier `data/osm/` avec `LICENSE-ODbL.md` et attribution, séparé du code ; l'attribution
  reste affichée dans l'interface quand des données OSM du paquet sont utilisées. **Noms OSM affichés** (décision v0.4) ; objets et événements fictifs toujours étiquetés comme tels.
- **Limite de cet environnement** : le bac à sable n'a pas accès aux services OSM. Je ne peux donc **pas** produire ni valider les paquets de Metz/Paris/Lyon/Marseille ici (voir D2).

---

## 4. Groupes et individus

### 4.1 Création (invariant de causalité)
`sim.createGroup(spec, cause)` est la **seule** voie de création ; `cause` est requis par le type et vérifié à l'exécution (`invariants.ts`).
Origines autorisées : `scenario_plan` (mise en place), `scenario_event` (arrivée programmée par une porte), `transition` (scission/jonction/départ).

### 4.2 Individus, sous-groupes, niveaux de simulation
- `MemberSet` en tableaux typés, **un enregistrement par personne, sans plafond** ; mise à jour **O(n)** au plus, **O(n / tailleSousGroupe)** en N1.
- **Marche** : le *centre* avance (`routeS += v·dt`). Rang `i` → décalage longitudinal `a_i = (i/n − ½)·L` ; décalage latéral normalisé `b_i ∈ [−1, 1]` stable ;
  `L = n_eff / (ρ_marche · W_eff)` avec `W_eff = min(largeurFrontMax, largeur de rue la plus étroite dans l'étendue − marge)`. **La colonne s'étire dans une rue étroite** (50 000 personnes à 2 pers/m² sur 12 m ≈ 2 km de long : résultat attendu et documenté).
  Position individuelle = **évaluation exacte et continue** le long de la polyligne (curseur `RouteCursor`, O(1) amorti car les individus sont triés par rang) avec normale lissée aux sommets et largeur lissée aux jonctions. **Les individus restent dans la bande de voie par construction.**
  *Écart par rapport à la v1 du plan* : des repères de sous-groupes partagés (approximation locale) produisaient des sauts de plusieurs mètres dans les virages (mesurés par test) ; l'évaluation exacte est aussi rapide. Les **sous-groupes sont désormais réservés au niveau de simulation par bloc** (§16, optimisation proposée).
- **Statique** : créneaux tirés dans une **zone praticable** (rectangles d'arêtes ± demi-largeur + polygones d'`OpenSpace`) autour de l'ancre, **rayon croissant jusqu'à capacité** (`n / ρ_statique`) ; le centre ne bouge pas, la zone se densifie/s'étend.
- **Masque de marche** (`WalkMask`, grille d'occupation rasterisée à partir des emprises de bâtiments, résolution paramétrable) : **rejet** de toute position individuelle entrant dans un bâtiment (test : aucune position dans un obstacle, tick après tick).
- **Arrivée** : chaque individu atteint la fin de route à son tour (la colonne se « vide » dans le lieu) puis rejoint son créneau statique ; le groupe passe en `settled` quand le dernier est absorbé (transition T2 journalisée).
- **N2** : ressort amorti vers la cible, bruit **stateless** `noise(seed, tick)`, hésitation/départ ; **N1** : placement direct ; **N0** : évaluation analytique à la demande (sélection, rendu).
- **Position du rassemblement ≠ position individuelle** : `group.anchor.pos` (centre logique) vs `members.x/y`.

### 4.3 Vitesse (paramétrable, valeurs initiales 🎮)
`v = v0(type) × f(ρ_local) × g(largeur) × h(arrêts)` ; `v0` initial = **1,1 m/s** pour un cortège, **configurable par type de groupe** ; `f` = relation densité-vitesse ; `g` réduit la vitesse en rue étroite ;
`h` = 0 à l'arrêt. L'interface affiche vitesse et cause du ralentissement. Aucune de ces valeurs n'est une constante : elles vivent dans `SimParams` (surchargeables par scénario).

---

## 5. Machine à états et transitions causales

Chaque groupe a un `kind` (stable sauf transition) et une `phase`. **Toute transition** écrit : (1) une entrée `LogEvent` avec `why: Cause`, (2) une entrée
`history` du groupe. Gardes déterministes (pas de hasard non graine).

| # | Transition | Garde (condition) | Effet | Cause journalisée (exemple) |
|---|---|---|---|---|
| T1 | `forming → moving` | `simTime ≥ plan.startAtMs` (scénario) | calcule la route origine→destination | scénario : « départ du cortège prévu à T+0 » |
| T2 | `moving → settled` (march → static) | tous les individus absorbés dans la zone de destination ET `onArrival='settle'` | `kind='static'`, crée les créneaux statiques | « arrivé place X : devient rassemblement statique » |
| T3 | `moving → waiting` | **aucun itinéraire valide** vers la destination (ou aucun satisfaisant selon `maxDetourRatio` s'il est activé) | reste sur place, démarre le compteur de patience | « rue Y fermée : aucun itinéraire disponible, le groupe attend » |
| T3b | `moving` (replanification) | arête(s) restante(s) bloquée(s) ET itinéraire alternatif valide trouvé | nouvelle route, **même destination** | « rue Y fermée : itinéraire modifié (+130 m) » |
| T4 | `waiting → moving` | un itinéraire valide redevient disponible (réouverture, densité réduite…) | reprend | « rue Y rouverte » |
| T5 | `waiting → settled/dispersing` | attente > `patienceMs` (si ≠ 0) | selon `plan.onBlocked` (`settle` ou `disperse`) | « attente trop longue : le cortège s'installe sur place » |
| T6 | `moving/settled → split` | événement scénario `split_group` | crée un groupe `secondary` (cause=`transition`, `parentId`), partage l'effectif et des membres | « un groupe de 40 personnes se détache pour rejoindre le piquet (plan de scénario) » |
| T7 | `secondary` arrive à sa cible + `onArrival='join_target'` | à ≤ rayon de la cible | **fusion** : `size` cible += ; membres transférés ; groupe supprimé | « le groupe rejoint le rassemblement Z » |
| T8 | `settled → dispersing` | événement scénario `begin_dispersal` (ou fin de plage) | route vers la porte de sortie ; **départs échelonnés** (`leaveAt`) | « fin de l'événement prévue : dispersion progressive » |
| T9 | `dispersing → dispersed` | `size == 0` | retiré (journalisé) | « le rassemblement s'est dispersé » |
| T10 | `settled` (inflow) | événement scénario `spawn_group` rattaché | arrivées par une porte, route, T7 | « renfort attendu à 18 h (scénario) » |

Phase 3 **n'a pas** de transition de tension déclenchée par des incidents (phase 4) ; `tension`/`cohesion` existent comme variables et sont modifiables par
événements de scénario (pour les tests).

**Journal** : `explain(groupId)` renvoie la chaîne causale (historique) ; le panneau « Journal » gagne un déroulé « Pourquoi ? » par entrée.

---

## 6. Déplacements des unités et véhicules

- `Mover` commun : suit une `Route` (mode `foot` ou `vehicle`), vitesse maximale par type (paramètres de `SimParams`, valeurs initiales 🎮 : unité à pied 1,6 m/s ; véhicule 6 m/s ≈ 22 km/h), accélération/décélération lissées, **cap = tangente de la route** avec limitation de vitesse de rotation (véhicules), recul interdit.
- **Ordres** : `move` (cible = point de la carte → accroché au graphe), `hold`, `cancel`. Le clic « Aller ici » sur la carte envoie la commande ; **en pause**,
  l'ordre est mis en file et appliqué à la reprise ; l'**aperçu** de l'itinéraire (ligne fantôme) est calculé immédiatement sans modifier l'état.
- **Blocage** : même mécanisme que les groupes (replanification, sinon `waiting` + journal) ; les véhicules ne traversent pas une arête `CROWD`.
- **Statuts** (`UnitStatus`, ↔ anneaux de la planche) : au repos, en déplacement, en attente, en action, en difficulté, indisponible (phase 3 produit repos/déplacement/attente ; les autres sont réservés).
- **Ordres simultanés** : une commande peut viser plusieurs unités ; traitée dans l'ordre déterministe des identifiants.
- **Identifiants stables** : `callsign`/`num` attribués à la création, jamais modifiés ; les véhicules suivent leur propre mouvement (non figés).

---

## 7. Temps, pause, interpolation

- `SimClock` (module pur) : pas fixe **100 ms** (10 Hz) ; `advance(realDtMs)` → nombre de ticks à exécuter (accumulateur) ; vitesses **0 (pause), 0,5, 1, 3, 6** ;
  plafond de rattrapage (ex. 8 ticks/image, 🎮) pour éviter la spirale ; onglet masqué → l'avance réelle est plafonnée (pas de « saut » au retour).
- **Pause** : `speed = 0` → aucun tick ; l'UI, la sélection, l'aperçu d'itinéraire, les ordres en file et les animations de rendu continuent.
- **Reprise sans saut** : l'accumulateur est remis à 0 à la reprise ; les états `prev*` = `curr*` ; test « pause → N ms → reprise = même état qu'un run sans pause ».
- **Interpolation** : le rendu reçoit `alpha = accumulator / tick` et interpole `prev → curr` (positions, caps) ; **horloge d'animation séparée** (`renderClock`)
  qui tourne même en pause (respiration, flammes, gyrophares, pas des membres).
- **Niveaux de simulation** : `SimLodPolicy` (§2) évalué à chaque tick (ou tous les k ticks) à partir du foyer d'attention fourni par l'hôte (rectangle de caméra en mètres, sélection) — le moteur ne connaît ni la caméra ni l'écran, seulement des « foyers » abstraits.
- Ordre des systèmes par tick : commandes → événements de scénario → routes (revalidation) → mouvement unités/véhicules → groupes (FSM, route, membres) →
  recalcul `EdgeState` (CROWD) → journal. Aucun accès à `Date.now()`/`Math.random()` dans le moteur (lint + test).
- **Reproductibilité** : PRNG à graine avec **flux séparés** (scénario, groupes, bruit) ; hash d'état (`stateHash`) exposé pour les tests de replay ;
  sérialisation `serialize()/deserialize()` (migration `schemaVersion`) testée dès la phase 3, même si l'interface de sauvegarde vient en phase 7.

---

## 8. Intégration avec la carte et l'interface existantes

| Élément existant | Évolution |
|---|---|
| `MapAdapter` | **retrait** de `getStreetSegments` ; caméra, projection, événements inchangés (alignement déjà vérifié en phase 2). |
| `geo/streets.ts` + `queryRenderedFeatures` | **supprimés** (la navigation ne dépend plus des tuiles). |
| `demo/demoScenario.ts` | **remplacé** par `scenarios/engineDemo.ts` (scénario du moteur) ; plus de données d'état dans `demo/`. |
| `SchematicAdapter` / `schematic/city.ts` | la ville procédurale alimente `buildSchematicGraph` (mêmes rues que le dessin → cohérence visuelle exacte). |
| `GameScreen` | pilote `GameController` (horloge + `sim.step` + snapshot) ; commandes joueur ; chargement du graphe (paquet → requête → schématique). |
| HUD | **vraies** commandes de vitesse (⏸ 0,5× 1× 3× 6×), horloge = temps de simulation, compteurs dérivés du moteur, panneau groupe (type, phase, destination, progression, historique), ordres « Aller ici / Annuler ». |
| Rendu | lit le snapshot interpolé ; état visuel par groupe/unité/véhicule (§9) ; ligne de route pour l'entité sélectionnée ; surbrillance des rues bloquées depuis `EdgeState`. |
| Boutons de la phase 2 sans effet moteur | « Déclencher un événement de démonstration » retiré (remplacé par la chronologie du scénario). |

Si un graphe réel manque pour la ville choisie en mode OSM : message explicite + proposition de bascule schématique (D5).

---

## 9. Rendu (Canvas 2D conservé) — travail de la phase 3 vs phase 5

**Phase 3 (nécessaire pour afficher le moteur correctement)**
- Lecture du snapshot interpolé (positions des membres échantillonnés, des unités, des véhicules) ; **aucune** coordonnée écran n'est stockée.
- Échantillon de membres dessinés : **permutation fixe** par groupe (premiers *k* selon le zoom) → pas de scintillement quand le zoom change ; `k` ≤ `n`.
- États visuels de base : groupe statique (contour fixe), cortège (flèche de progression + traînée), dispersion (opacité décroissante), « affecté » (réservé phase 4) ;
  unité : au repos / en déplacement / sélectionnée / en attente / indisponible ; véhicule orienté selon sa route.
- **Index de sélection sub-linéaire** : (1) unités/véhicules/incidents : petite liste triée par priorité ; (2) groupes : disques englobants ;
  (3) **grille spatiale des membres** (cellule 4 m, reconstruite seulement si le groupe a bougé depuis le dernier clic) pour trouver le membre/groupe sans parcourir toute la foule.
- Dirty flags : la couche de jeu n'est redessinée que si la caméra bouge, si un tick a eu lieu, ou si une animation visible est active.

**Phase 3 pose aussi les interfaces de sprites** (voir cahier §18bis.2) : types `SpriteManifest`, `SpriteProvider`, `RenderableSnapshot` (données sémantiques + positions interpolées + graines d'apparence), `MarkerStyle`, `EffectSpec` ; un `ProceduralSpriteProvider` encapsule le dessin provisoire actuel ; aucun sprite définitif.
**Phase 5 (non traité ici)** : silhouettes selon la planche de référence (manifestants variés, forces, secours, véhicules, décors, effets), atlas à plusieurs LOD et orientations, animations, densité de foule, comportements individuels.

---

## 10. Scénario de démonstration du moteur (ce que vous verrez en phase 3)

Sur la ville schématique (et sur tout paquet OSM valide), zone niveau 1 :

1. **t = 0** — *Rassemblement statique* « Piquet devant l'administration (fictive) » : 120 personnes ancrées sur une **ancre synthétique** près de la place (`scenario_plan`).
2. **t = 0** — *Cortège* « Cortège syndical » : 220 personnes créées à la **porte ouest** (`scenario_plan`), destination = place centrale, **itinéraire calculé** et tracé.
3. **t ≈ 90 s** — *Événement de scénario* : une rue de l'itinéraire est fermée (« travaux fictifs ») → le cortège **replanifie** (journal : « itinéraire modifié, +N m ») ou **attend** si le détour est trop long.
4. **À l'arrivée** — le cortège **devient un rassemblement statique** sur la place (T2), journalisé.
5. **t ≈ 5 min** — *Événement de scénario* : **40 personnes se détachent** (T6) et rejoignent le piquet (T7) ; l'effectif du piquet augmente.
6. **Fin de plage** — le rassemblement de la place **se disperse progressivement** vers la porte sud (T8/T9).
7. **Forces** : 5 unités CRS, 3 de police, 6 véhicules ; le joueur sélectionne une unité, clique « Aller ici », voit l'itinéraire fantôme, la voit **se déplacer en suivant les rues**, peut **annuler** ; les véhicules bougent sur le graphe véhicule ;
   les rues occupées par une foule dense deviennent « bloquées » pour les véhicules et le compteur **N/M** évolue.
8. **Temps** : pause complète (l'itinéraire d'un ordre reste prévisualisable), 0,5×/1×/3×/6×, reprise sans saut.

Tout le scénario est **déterministe** (graine) : mêmes événements, mêmes lignes de journal.

---

## 11. Tests

### 11.1 Unitaires (Vitest, sans navigateur)
- **Graphe** : construction depuis fixtures Overpass (intersections, découpage, sens uniques, accès, `area=yes`, largeurs par défaut, composantes minuscules) ; grille spatiale ; accrochage.
- **A\*** : optimal = Dijkstra sur graphes aléatoires (propriété, graine) ; sens uniques ; arête bloquée → détour ; inatteignable → `null` ; points virtuels de départ/arrivée ; coûts piéton/véhicule ; déterminisme.
- **Routes** : abscisse curviligne, `pointAt`/tangente, revalidation sur changement de version.
- **Membres** : tous restent dans la bande de voie ; cortège plus étroit → plus long ; statique : centre immobile, rayon croît avec l'effectif, aucune position dans un obstacle ; reproductibilité du bruit.
- **Groupes (FSM)** : chaque transition T1–T10 sur graphe-jouet (garde vraie/fausse, effets, cause) ; **aucune création sans cause** (invariant + test négatif) ; destination inchangée sauf cause journalisée ; fusion et scission conservent l'effectif total ; dispersion → 0 et retrait.
- **Journal** : chaque transition émet exactement une entrée avec `why` ; `explain()` reconstitue la chaîne ; textes contiennent les identifiants attendus.
- **Mouvement** : vitesse bornée, arrivée exacte, cap = tangente, véhicule non figé sur ordre, annulation, ordre sur cible inaccessible → refus explicite.
- **Temps** : accumulateur ; pause ; reprise sans saut ; plafond de rattrapage ; interpolation `alpha` ; **indépendance du FPS** (mêmes résultats avec dt réels différents).
- **Reproductibilité** : même graine → même `stateHash` après N ticks ; sérialisation à mi-parcours puis reprise = run continu.
- **Rues bloquées** : le compteur N/M vient de `EdgeState` ; `CROWD` bloque les véhicules, pas les piétons.
- **Index de sélection** : correct et sous-linéaire (compte de comparaisons borné) sur 5 000 membres.
- **Données manquantes** : graphe vide/pauvre → message et repli, jamais d'exception.

### 11.2 Intégration (Playwright, navigateur)
Chargement du scénario ; pions qui avancent le long des rues (positions successives sur le graphe) ; pause (positions figées) / reprise ; vitesses ; ordre « Aller ici » + annulation ;
journal explicatif visible ; alignement pions/carte (reprise de la phase 2) ; bascule carte OSM ↔ schématique **sans perdre l'état du moteur** ; clic sur un membre → groupe sélectionné.

### 11.3 Performance et capacité (benchmarks reproductibles — rien n'est promis sans mesure)
Script `npm run bench:engine` (Node, sans navigateur) et banc navigateur Playwright :
- **Charges** : 5 000, 10 000, 25 000, 50 000 personnes (groupes de tailles variées, y compris un seul groupe géant), sur graphe schématique agrandi.
- **Métriques** : temps de calcul d'un tick (moyen/p95/max) **par niveau de simulation** (N0/N1/N2) ; temps de recalcul des états de rues ; coût d'A* ; mémoire (`process.memoryUsage`, octets/individu) ; en navigateur : FPS réel et coût de rendu.
- **Protocole** : graine fixe, échauffement, N ticks, machine décrite (CPU/cœurs/Node), résultats consignés dans `docs/BENCHMARKS.md` avec **limites constatées** ; les valeurs dépendent de la machine.
- Les optimisations (niveaux de simulation, sous-groupes, structures) sont décidées **d'après ces mesures**.

### 11.4 Simulé vs services réels

| Vérification | Réalisée en phase 3 avec… | Statut attendu |
|---|---|---|
| Parseur/constructeur de graphe | **fixtures simulées** (Overpass JSON écrits à la main) | automatique |
| Moteur, FSM, A*, temps, journal | **graphes synthétiques** et ville schématique | automatique |
| Alignement carte ↔ pions | style MapLibre **local** sans réseau (comme en phase 2) | automatique |
| Graphe OSM **réel** de Metz/Paris/Lyon/Marseille | **non réalisable dans cet environnement** (pas d'accès aux services OSM) | **à faire par vous** : lancer le script, charger la ville, jouer le scénario ; je fournis la procédure et un rapport de contrôle (couverture, composantes, nombre d'arêtes) |
| Carte réelle OpenFreeMap / géocodeur Nominatim | **simulés** (interception) | **à vérifier par vous** (déjà demandé en phase 2) |
| Cohérence graphe réel ↔ carte affichée (rues superposées) | impossible ici | **à vérifier par vous** à l'écran (ligne de rues du jeu vs rues de la carte) |

---

## 12. Fichiers créés / modifiés / supprimés

```
CRÉÉS    src/nav/{graph,spatialGrid,snap,astar,heap,costs,route}.ts
         src/nav/osm/{parseOverpass,tagsPolicy,buildGraph}.ts   src/nav/schematicGraph.ts
         src/engine/{clock,sim,rng,commands,journal,invariants,serialize,hash}.ts
         src/engine/systems/{scenario,routes,units,groups,members,edgeState}.ts
         src/scenarios/engineDemo.ts      scripts/build-city-pack.mjs      data/osm/README+LICENSE
         tests/unit/{nav,astar,groups,members,clock,journal,replay,selection}.test.ts   tests/fixtures/*.json   tests/e2e/engine.spec.ts
MODIFIÉS src/render/{GameRenderer,lod}.ts   src/ui/{GameScreen,panels}.tsx   src/map/{MapAdapter,MapLibreAdapter,SchematicAdapter}.ts
         src/state/types.ts (réduit : l'état vit dans src/engine)   README.md   docs/*
SUPPRIMÉS src/demo/demoScenario.ts   src/geo/streets.ts   tests/unit/streets.test.ts
```

## 13. Risques

| Risque | Mitigation |
|---|---|
| Graphe OSM réel de mauvaise qualité (rues manquantes, composantes isolées) | métrique de couverture, nettoyage, alerte, repli schématique |
| Désalignement graphe ↔ carte affichée (données/millésimes différents) | même source OSM que le style quand possible ; avertissement d'âge du paquet ; vérification visuelle |
| Foule dense lente | membres plafonnés + pondérés, tableaux typés, mesures avant de figer les plafonds |
| Explosion du nombre de transitions/journal | historique borné, regroupement des messages répétitifs |
| Détours irréalistes | seuil 1,6× + patience ; paramètres exposés et testés |
| Bruit/animation rompant la contrainte de rue | clamp latéral strict + test de bande |

## 14. Décisions (toutes tranchées en v0.4)

| # | Décision |
|---|---|
| D1 | Planche graphique reçue et analysée (cahier §18bis) ; référence artistique, pas livrable final. |
| D2 | Paquets OSM préparés une fois par ville, **procédure locale documentée**, téléchargement limité éventuel. Environnement actuel sans accès OSM : paquets réels **non produits ici** (script + fixtures livrés). |
| D3 | **Noms OSM affichés** ; incidents toujours fictifs et étiquetés ; pas de classement de vulnérabilité. |
| D4 | **Interfaces de sprites posées en phase 3** ; rendu détaillé en phase 5. |
| D5 | Sans graphe réel cohérent : **fond schématique**. |
| D6 | Paramètres **configurables** (`SimParams`) ; pas de plafond ; pas de facteur de détour ; blocage géométrique ; **validation intermédiaire à mi-phase**. |

## 15. Découpage et jalons

| Étape | Contenu | Livrable |
|---|---|---|
| **3a** | `nav/` : graphe, grille spatiale, accrochage, A*, états de rues géométriques, parseur/constructeur OSM sur fixtures, graphe schématique, `WalkMask` | tests unitaires |
| **3b** | `engine/` : horloge, PRNG, paramètres, journal causal, groupes (FSM), individus à grande échelle, niveaux N0/N1/N2, benchmarks 5k–50k | tests + `docs/BENCHMARKS.md` |
| **⏸ Validation intermédiaire** | rapport : fonctionnalités, tests exécutés, benchmarks et limites, problèmes restants, décisions à arbitrer | **attente de votre accord** |
| **3c** | unités/véhicules et ordres simultanés, scénario de démonstration, intégration carte/UI (vitesses réelles, journal « pourquoi », index de sélection) | e2e |
| **3d** | interfaces de sprites (`SpriteManifest`, `SpriteProvider`, `RenderableSnapshot`), finition, documentation, benchmarks navigateur | rapport final de phase |

## 16. État à mi-phase (réel) — voir aussi `PHASE3_MIDPOINT.md`

| Étape | État |
|---|---|
| **3a** navigation | ✅ réalisée : graphe, grille spatiale, accrochage, A* (points virtuels, sens uniques, règle de sortie d'une rue bloquée), états de rue géométriques, parseur/constructeur OSM **sur fixture simulée**, graphe schématique, masque de marche |
| **3b** noyau du moteur | ✅ réalisée : horloge, paramètres, journal causal, groupes (création causale, cortège, rassemblement statique, arrivée, attente/replanification, dispersion, **scission et jonction**), individus sans plafond, niveaux N0/N1/N2, benchmarks 5 000 → 250 000 |
| **⏸ Validation intermédiaire** | **en attente de votre accord** |
| **3c** | ✅ réalisée (voir `PHASE3_3C.md`) : unités/véhicules et ordres simultanés, scénario de démonstration, moteur branché à l'interface, index de sélection, script de paquets OSM (testé sur fixtures uniquement) |
| **3d** | à faire : interfaces de sprites, finition, benchmarks navigateur |

Écarts assumés par rapport au plan v2.0 : (1) évaluation exacte par curseur au lieu de repères de sous-groupes ; (2) piétons bloqués seulement à saturation ; (3) la scission/jonction sont livrées dès 3b ; (4) le script `build-city-pack` et la sélection par index spatial passent en 3c ; (5) `T5` (installation sur place après attente) est reporté : un groupe en attente reste en attente et signale l'alerte de patience.

