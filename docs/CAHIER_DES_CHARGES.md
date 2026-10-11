# ORDRE PUBLIC — Cahier des charges technique et fonctionnel (Phase 1)

Version : 0.1 (brouillon soumis à validation) — 2026-10-11
Statut : **aucun code n'a été écrit.** Ce document attend la validation explicite du commanditaire.

> Légende de fiabilité utilisée dans tout le document
> - ✅ **Vérifié** : confirmé par une source consultée pendant la rédaction.
> - ⚠️ **À re-vérifier** : issu d'une source secondaire ou de ma connaissance, à confirmer sur la source primaire avant la Phase 2.
> - 🎮 **Hypothèse de gameplay** : choix de conception, jamais présenté comme règle officielle.

---

## 0. Limites de cette phase (transparence)

- Les accès directs à `interieur.gouv.fr` et `mapsplatform.google.com` ont **échoué** (résolution DNS bloquée dans l'environnement). Les informations sur la tarification Google et le SNMO proviennent de recherches web (sources secondaires listées en §3 et §4). **Aucune citation textuelle n'est reproduite.** Toute donnée marquée ⚠️ doit être confirmée sur la source officielle avant d'être figée.
- **La capture d'écran de référence n'a pas été reçue** dans cette conversation (aucun fichier image n'est accessible). La direction artistique du §7 est construite à partir de votre description textuelle. Merci de la renvoyer avant la Phase 2.

---

## 1. Reformulation du besoin

**Produit** : un jeu de simulation solo, en navigateur, où le joueur est commandant d'un dispositif fictif de maintien de l'ordre. Une carte aérienne (Google Maps, vue satellite) sert de plateau ; une couche de jeu animée (foules, unités, incidents) est dessinée par-dessus. Le moteur de jeu est local et indépendant de la carte.

**Intention de design** : le joueur est évalué sur la **gestion** de la situation (protection des personnes, proportionnalité, désescalade, secours, dégâts, opinion publique), **pas** sur la rapidité à disperser. Une manifestation pacifique bien accompagnée doit pouvoir être le meilleur résultat possible.

**Garde-fous (non négociables)**
- Tout est fictif et simulé ; aucune donnée de foule, d'unité ou d'événement réels.
- Les actions sensibles sont des **choix de gameplay abstraits** (niveaux, jauges, probabilités génériques), pas des procédures opérationnelles. Aucune valeur « optimale » réelle (distances, cadences, angles, dosages) n'est modélisée ni documentée.
- Aucun mécanisme ne doit servir de guide pour encercler/disperser une foule réelle dans une ville réelle. Les formations sont des états de jeu (ex. « Ligne », « Réserve », « Accompagnement »), sans géométrie réaliste prescrite.
- Pas de représentation graphique explicite de blessures ou de décès.
- Identifiants d'unités **synthétiques** (ex. « CRS-GAME 07/2 »), jamais des numéros opérationnels réels.

---

## 2. Architecture proposée

### 2.1 Principe directeur : trois couches étanches

```
┌───────────────────────────────────────────────────────────┐
│ UI (DOM)  : HUD, panneaux, menus d'ordres, bilan          │
├───────────────────────────────────────────────────────────┤
│ Rendu     : MapProvider (Google | Schématique)            │
│             + GameRenderer (canvas, sprites animés)       │
├───────────────────────────────────────────────────────────┤
│ Moteur    : état pur + systèmes + événements (sans DOM,   │
│             sans API carto, testable sous Node)           │
└───────────────────────────────────────────────────────────┘
        flux : Commandes (UI→moteur) / Snapshots (moteur→rendu)
```

- Le **moteur** ne connaît ni Google Maps, ni le DOM. Il travaille en **coordonnées métriques locales** (repère plan est/nord en mètres, centré sur l'origine du scénario). La conversion lat/lng ↔ mètres n'existe que dans l'adaptateur de carte.
- L'**UI** envoie des *commandes* (`ORDER_MOVE`, `REQUEST_AMBULANCE`, …) dans une file ; le moteur les consomme au tick suivant. Cela donne rejouabilité, tests faciles et pause fiable.
- Le **rendu** lit un *snapshot* immuable/interpolé de l'état ; il ne modifie jamais le moteur.

### 2.2 Découpage en modules (répond à la liste §22 du brief)

```
src/
  engine/        loop, horloge, PRNG, file de commandes, bus d'événements, snapshot
  state/         types de l'état (GameState) + migrations de sauvegarde
  systems/       un fichier par système, exécutés dans un ordre fixe
                 movement, crowd, incidents, fire, injuries, rescue,
                 tension, opinion, logistics, objectives, scoring
  domain/
    units/       forces de l'ordre (CRS, police, soutien) + catalogue
    protesters/  groupes, individus-acteurs, comportements
    vehicles/    transport, soutien, secours, pompiers
    rescue/      SAMU/ambulances/pompiers, files d'attente de prise en charge
    incidents/   catalogue d'incidents + machine à états
    equipment/   moyens (catalogue abstrait, risques/limites)
  scenarios/     définitions JSON/TS des missions + générateur du bac à sable
  scoring/       règles de score, bilan, conséquences institutionnelles
  persistence/   sauvegarde locale, import/export JSON, historique
  settings/      paramètres joueur, difficulté, clé API
  map/           MapProvider (interface) + GoogleMapsProvider + SchematicProvider
  geo/           graphe de rues, projection, génération de secteurs
  render/        couche de rendu des pions, LOD, animations, effets
  ui/            composants HUD, panneaux, menus, écrans
  i18n/          textes FR (extensible)
  data/          packs de villes pré-calculés (graphe de rues, bâtiments, commerces)
tests/           unitaires + intégration + « replays » déterministes
```

### 2.3 Boucle de simulation

- **Pas de temps fixe** de 100 ms (10 Hz) pour la logique, avec accumulateur ; le rendu tourne à la fréquence d'écran et **interpole** entre deux ticks → logique indépendante du FPS.
- Vitesses : pause (0×), lente (0,5×), normale (1×), rapide (3×, 6× en option) = nombre de ticks par seconde réelle ; la pause arrête l'horloge de simulation mais **laisse l'UI et les ordres préparés actifs** (les ordres donnés en pause sont mis en file et appliqués à la reprise, ou aperçus en « fantôme »).
- **PRNG à graine** (mulberry32/sfc32) conservé dans l'état → même graine + mêmes commandes = même partie (tests de replay, sauvegarde exacte).
- Ordre fixe des systèmes par tick : commandes → déplacement → foules → incidents → feu → blessures → secours → tension/opinion → logistique/fatigue → objectifs → score → émission d'événements.

### 2.4 Foule : approche hybride (clé pour la performance et la lisibilité)

- **Niveau simulation** : des **groupes** (10 à 400 personnes) simulés comme agents (position, cap, cohésion, moral, tension, peur…).
- **Niveau acteurs** : au sein d'un groupe, quelques **individus nommés** (jusqu'à ~5-10 par groupe) à comportement propre (casseur isolé, meneur, blessé, journaliste, passant) — ce sont eux qui déclenchent incidents et blessures.
- **Niveau visuel** : le reste de la foule est un **nuage de marqueurs cosmétiques** (boids légers : cohésion/séparation/bruit) autour du centre du groupe, rendus en batch. 3 000 à 8 000 points animés sont réalistes à 60 FPS en Canvas/WebGL ; ils n'ont pas d'état de simulation individuel.
- **LOD au zoom** : zoom faible → symboles de groupe agrégés avec effectif ; zoom moyen → nuage de points ; zoom fort → silhouettes, boucliers, animations plus détaillées.

### 2.5 Navigation simplifiée

- Google Maps **ne fournit pas** de moteur de déplacement de foules. Le jeu embarque son propre graphe de navigation :
  - Pour les villes pré-packagées : un **graphe de rues** (segments + nœuds + îlots) pré-calculé à partir d'OpenStreetMap (licence ODbL, attribution « © contributeurs OpenStreetMap » requise ⚠️).
  - Pour une ville libre : récupération à la demande (API Overpass publique, avec cache local) ; en cas d'échec, **navigation en espace libre** avec obstacles abstraits (îlots de bâtiments approximés par une grille).
- Déplacement : A* sur le graphe (ou flowfield sur grille 8 m) ; vitesse selon type d'unité, fatigue, encombrement, blocages.
- **Rues bloquées** = segments du graphe marqués `blocked` (par foule dense, véhicule, feu, barrage). Le compteur « N / M » = segments bloqués / segments de la zone de jeu active. Il reflète uniquement l'état simulé.

---

## 3. Technologies retenues

| Choix | Décision | Justification |
|---|---|---|
| Langage | **TypeScript (strict)** | Typage des états et commandes, refactoring sûr, moteur testable. Un projet de cette taille (12 modules, sauvegardes versionnées) se maintient mal en JS pur. |
| Build | **Vite** | Démarrage instantané, bundle statique, aucune infra serveur. |
| UI | **DOM + Preact (≈3 Ko) ou Web Components légers** | HUD riche (listes, panneaux, formulaires) plus simple en DOM qu'en canvas ; accessibilité et CSS gratuits. Pas de framework lourd. |
| Rendu des pions | **Canvas 2D en couche superposée** (v1), **abstraction permettant PixiJS/WebGL** si nécessaire | Canvas 2D suffit pour quelques milliers de points avec LOD ; évite la complexité WebGL au départ. Plan B documenté : PixiJS ou WebGL Overlay View / deck.gl. |
| Carte | **Google Maps JavaScript API** (carte vectorielle, type `satellite`/`hybrid`) via interface `MapProvider` | Respect de l'apparence demandée, sans scraping ni tuiles brutes. |
| Carte de repli | **SchematicProvider** : rendu canvas du graphe de rues + îlots + hydro/espaces verts (pas de satellite) | Mode démo sans clé / hors ligne, 100 % autonome. |
| Tests | **Vitest** (moteur sous Node) + **Playwright** (parcours UI, Chromium déjà présent dans l'environnement) | Moteur déterministe → tests de replay ; E2E pour sauvegarde et flux principaux. |
| Persistance | **IndexedDB** (sauvegardes, historique) + **localStorage** (préférences) + export/import JSON | Sauvegardes volumineuses → IndexedDB ; JSON versionné avec migrations. |
| Données de villes | Packs JSON compressés générés par script (Overpass → graphe/commerces) | Chargement instantané, pas de dépendance réseau pendant la partie. |

**Alternatives écartées** : Phaser/Unity-WebGL (poids, intégration carte complexe), JS sans TS (maintenabilité), MapLibre+tuiles satellite tierces (change l'apparence demandée ; reste le plan B si Google devient inadapté — voir §4.4).

**Lancement** : `npm install && npm run dev` pour le développement ; `npm run build` produit un dossier statique à servir par n'importe quel serveur HTTP (voir question Q3 : `file://` est incompatible avec une clé Google restreinte par référent).

---

## 4. Contraintes Google Maps Platform

### 4.1 Ce que j'ai pu établir

| Point | Statut | Détail |
|---|---|---|
| Clé API + compte de facturation obligatoires pour les cartes dynamiques | ⚠️ | Le carte JS exige une clé liée à un projet Google Cloud avec facturation activée. À reconfirmer sur la doc officielle. |
| Quota gratuit | ⚠️ (sources secondaires) | Depuis mars 2025, le crédit mensuel de 200 $ a été remplacé par des **seuils gratuits par SKU** ; Dynamic Maps ≈ **10 000 chargements de carte/mois gratuits**, puis facturation à l'unité (≈ 7 $/1 000 selon des tiers). **Chiffres non vérifiés sur la page officielle** — à confirmer avant tout engagement. Un usage solo personnel devrait rester sous le seuil, mais un plafond de budget/quotas doit être configuré. |
| Mise en cache / stockage / hors ligne | ✅ (politique Map Tiles) / ⚠️ (reste) | La politique de l'API Map Tiles interdit la pré-collecte, l'indexation, le stockage/cache et l'usage hors ligne, hors cas limités par le contrat ; les usages « non visuels » (analyse d'image, détection d'objets, extraction de géodonnées) sont interdits. |
| Coordonnées géocodées | ✅ (conditions Geocoding/Places) | Cache temporaire de lat/lng limité à **30 jours consécutifs** maximum. |
| Contenu Places avec une carte non-Google | ✅ | Le contenu Places ne doit pas être utilisé avec une carte non-Google. |
| Superposition WebGL / deck.gl | ✅ | La carte vectorielle JS supporte WebGL Overlay View et deck.gl (`GoogleMapsOverlay`) ; utile si on passe en rendu WebGL. |
| Attribution | ⚠️ | Les logos/mentions de copyright Google doivent rester visibles : l'UI ne doit **jamais** les masquer. |

### 4.2 Conséquences de conception

1. **Jamais de capture, découpage, cache ou analyse des tuiles/images satellite.** Le moteur n'utilise **aucune** donnée dérivée de l'imagerie Google. Les rues, bâtiments et commerces viennent d'OpenStreetMap (ODbL) ou du mode procédural.
2. **Pas de « hors ligne Google »** : promis nulle part. Hors ligne ou sans clé → bascule automatique et explicite vers la carte schématique (« Mode démonstration »).
3. **Recherche de ville** : deux voies — (a) liste prédéfinie (Metz, Paris, Lyon, Marseille, …) avec coordonnées embarquées, sans appel API ; (b) recherche libre via Places Autocomplete/Geocoding (SKU facturables, résultat affiché sur la carte Google). Les coordonnées ne sont conservées que dans la sauvegarde du joueur (≤ 30 jours côté cache, jamais en base partagée) ⚠️.
4. **Clé API fournie par le joueur** (champ dans les paramètres, stockée localement, jamais dans le dépôt). Restrictions de clé conseillées : référents HTTP + liste des API autorisées + plafond de quota quotidien.
5. **Pas de cartes statiques/Street View/trafic réel** : inutiles ; les « rues bloquées » sont purement simulées et libellées comme telles.
6. **Chargement paresseux** : le script Google n'est chargé qu'au démarrage d'une partie en mode Google, avec gestion d'erreurs (clé invalide, quota, réseau, `gm_authFailure`) → bascule vers le mode schématique sans perdre l'état.

### 4.3 Coût attendu
Usage personnel : probablement 0 € sous les seuils gratuits, mais **non garanti** tant que la page tarifaire n'est pas confirmée. Prévoir une alerte de budget Google Cloud.

### 4.4 Plan B (si Google s'avère inadapté ou coûteux)
`MapProvider` alternatif **MapLibre GL** avec fond OSM vectoriel ou imagerie sous licence appropriée (ex. fournisseur d'imagerie à conditions d'usage compatibles). Le moteur n'est pas impacté (principe d'étanchéité). L'apparence « satellite » dépendrait alors du fournisseur d'imagerie retenu.

---

## 5. Sources publiques et traçabilité des règles

Mécanisme : un fichier `docs/SOURCES.md` + un champ `provenance` sur chaque mécanique (`official` | `simplified` | `gameplay` | `excluded`), avec source, date de consultation et traduction en règle de jeu.

| Source | Statut | Ce que j'ai établi | Traduction prévue en mécanique |
|---|---|---|---|
| Schéma national du maintien de l'ordre (SNMO), ministère de l'Intérieur — présenté le 11 sept. 2020, actualisé en déc. 2021 selon le ministère (via document parlementaire) | ⚠️ page officielle inaccessible ; texte intégral non lu | Principes affichés : **nécessité, proportionnalité, gradation, réversibilité** de l'usage de la force ; **dialogue permanent** avec les manifestants ; tactiques plus mobiles et réactives ; modernisation des sommations ; **équipes de liaison et d'information** ; retrait de la grenade manuelle de désencerclement (selon le Défenseur des droits). | Jauges de proportionnalité/gradation, option Dialogue/Liaison à vrai poids de gameplay, pénalités pour usage non gradué, ou non réversible. Vocabulaire repris, **sans** reproduire de procédures. |
| Code de la sécurité intérieure (dispositions sur attroupements, sommations, usage de la force) | ⚠️ cité de mémoire — **numéros d'articles à confirmer sur Légifrance avant usage** | — | Mécanique d'« avertissements » abstraite (niveau d'avertissement donné/non donné) influençant les conséquences juridiques fictives. |
| Défenseur des droits, rapports/avis sur le maintien de l'ordre | ⚠️ à consulter | Cité via source secondaire ci-dessus | Alimente les « conséquences institutionnelles » (saisine, rapport, avis). |
| IGPN/IGGN, enquêtes administratives et judiciaires (principes généraux) | ⚠️ à consulter | — | Chaînes de conséquences génériques (enquête → sanction/non-lieu), probabilités de jeu. |

**Règle** : si une règle ne peut être sourcée, elle est étiquetée `gameplay` dans l'interface de documentation (« Cette règle est une hypothèse de jeu »). Rien n'est présenté comme procédure officielle des CRS.

**À ne pas modéliser (`excluded`)** : distances/angles/cadences d'emploi réels des moyens de force, procédures d'encerclement ou de nasse réelles, effectifs réels de dispositifs, identifiants réels d'unités, protocoles internes non publics.

---

## 6. Structures de données (extrait de référence, non exhaustif)

Toutes les entités sont des **données pures sérialisables en JSON** (pas de classes avec références cycliques) → sauvegarde triviale.

```ts
type Id = string;                         // ex. "U-0007", "G-0012"
interface Vec2 { x: number; y: number }   // mètres, repère local

interface GameState {
  schemaVersion: number;
  meta: { seed: number; rngState: number; scenarioId: string; difficulty: 'easy'|'normal'|'hard';
          tick: number; simTimeMs: number; speed: 0|0.5|1|3|6; status: 'running'|'paused'|'ended' };
  world: { origin: { lat: number; lng: number }; zone: Zone[]; graph: StreetGraph;
           sectors: Sector[]; shops: Shop[]; furniture: Furniture[] };
  forces: { units: Record<Id, Unit>; vehicles: Record<Id, Vehicle> };
  crowd: { groups: Record<Id, CrowdGroup>; actors: Record<Id, CrowdActor> };
  incidents: Record<Id, Incident>;
  people: Record<Id, Casualty>;           // chaque victime suivie jusqu'à résolution
  rescue: { teams: Record<Id, RescueTeam>; requests: Record<Id, RescueRequest> };
  logistics: { budget: number; stocks: Record<string, number>; relief: ReliefPlan };
  opinion: { public: number; media: number; command: number; headlines: Headline[] };
  objectives: Record<Id, Objective>;
  orders: Record<Id, Order>;
  log: LogEntry[];                        // journal d'événements
  stats: MissionStats;                    // alimente le bilan
  options: { deathsEnabled: boolean; incidentCategories: string[]; intensity: number };
}

interface Unit {
  id: Id; callsign: string;                 // ex. "CRS-GAME 07/2" (synthétique)
  kind: 'crs'|'police'|'support';
  pos: Vec2; heading: number; headcount: number; headcountMax: number;
  health: number; mobility: number; fatigue: number; morale: number;
  availability: 'ready'|'engaged'|'resting'|'depleted'|'out';
  equipment: Record<string, number>;       // stocks abstraits par catégorie
  stance: 'dialogue'|'hold'|'escort'|'contain'|'intervene'; // choix de jeu, pas de doctrine
  orderId?: Id; vehicleId?: Id; missionStatus: string;
}

interface CrowdGroup {
  id: Id; pos: Vec2; size: number;
  cohesion: number; morale: number; tension: number; fear: number; mobility: number;
  disposition: 'peaceful'|'restless'|'hostile'|'isolated_breakers'|'leaving'|'bystanders';
  state: 'gathering'|'marching'|'sitting'|'dispersing'|'fleeing'|'clashing'; // machine à états
  reactionProfile: { toDialogue: number; toWarning: number; toForce: number; toProvocation: number };
  actorIds: Id[];
}

interface Incident {
  id: Id; kind: 'object_throwing'|'firecrackers'|'assault'|'furniture_damage'|'window_break'
       |'looting_attempt'|'shop_intrusion'|'bin_fire'|'fire'|'crowd_surge'|'vehicle_incident'|'casualty';
  pos: Vec2; sectorId: Id; severity: 1|2|3|4|5; startedAt: number; durationMs: number;
  state: 'emerging'|'active'|'escalating'|'contained'|'resolved'|'lingering';
  causes: Id[]; consequences: Id[];       // chaînage explicite
}

interface Casualty {
  id: Id; role: 'protester'|'officer'|'journalist'|'bystander'|'firefighter'|'rescuer';
  severity: 'minor'|'serious'|'critical'|'deceased'; // deceased: seulement si options.deathsEnabled
  location: Vec2; causeIncidentId?: Id; status: 'awaiting'|'being_treated'|'evacuated'|'resolved';
  waitingSince: number;
}

interface Order { id: Id; unitIds: Id[]; type: 'move'|'hold'|'dialogue'|'warn'|'escort'
                 |'contain'|'protect'|'support_rescue'|'withdraw'|'relieve'|'use_means';
                 target?: Vec2|Id; params: Record<string, number|string>; status: 'queued'|'active'|'done'|'cancelled' }
```

**Sauvegarde** : `{ schemaVersion, state, settingsSnapshot, createdAt }` → JSON ; `migrations[n→n+1]` appliquées au chargement ; test « save → load → N ticks == N ticks sans interruption » (déterminisme).

---

## 7. Interface et direction artistique

**Hiérarchie visuelle** (couleurs distinctes + forme) :
- Forces de l'ordre : marqueurs sombres/bleu nuit, **bouclier visible** (demi-cercle), numéro d'unité fictif au-dessus ; CRS vs police distingués par la silhouette/couleur du liseré ; véhicules = rectangles orientés.
- Manifestants : points clairs animés par groupe, teinte selon *disposition* (neutre → ambre → rouge selon tension du groupe) ; l'interface indique la disposition par un petit pictogramme et pas seulement par la couleur (accessibilité).
- Secours : blanc/rouge (ambulances), rouge vif (pompiers), pictogrammes distincts.
- Incidents : icônes pulsées avec anneau de gravité ; feux = halo animé.
- Sélection : cercle/anneau animé autour de l'unité + trajet fantôme jusqu'à la destination.
- Lignes de jeu : limites de la zone active, segments de rues bloquées (tireté rouge), secteurs (hachures légères).

**Éléments de la capture à retrouver** (⚠️ à affiner avec l'image) : bandeau supérieur de situation ; compteur « rues bloquées N/M » ; indicateurs de tension ; compteurs d'effectifs/ressources ; journal ; bandeaux de messages courts à fort contraste ; marqueur de sélection. **Tous liés à l'état réel** (aucun nombre décoratif : chaque compteur est dérivé de `GameState` via un sélecteur testé).

**Écran principal** : carte centrale plein écran ; barre supérieure (situation, horloge, tension, rues bloquées, opinion) ; panneau gauche (unités/groupes, filtres, disponibilité) ; panneau droit (journal + objectifs) ; barre inférieure (pause/vitesses, menu d'ordres contextuel) ; panneau de détail sur sélection ; bandeaux d'événements empilés.

**Animations** : micro-mouvements des pions (bruit de Perlin léger, respiration), transitions de position interpolées, ondulation de foule, fumées/feux simples ; budget FPS vérifié par un mode « profilage ».

---

## 8. Mécaniques essentielles

### 8.1 Tension, opinion et proportionnalité
- **Tension de groupe** (0-100) : fonction de la disposition, des provocations (incidents), de la proximité d'unités en posture « contain/intervene », des moyens employés, de la fatigue/chaleur du groupe et de l'effet des options de dialogue.
- **Tension de secteur** : agrégat des groupes + incidents actifs, diffusée sur les secteurs voisins.
- **Gradation / réversibilité (🎮)** : chaque moyen a un *niveau* ; passer à un niveau supérieur sans avoir tenté/épuisé les niveaux inférieurs (dialogue, avertissement, temporisation) augmente un indicateur `proportionalityRisk`. Cet indicateur n'est pas un « interdit » mais pèse sur l'opinion, les conséquences juridiques fictives et le score. Inspiré des principes publiquement affichés (§5), **traduction ludique**, pas règle officielle.
- **Opinion** : trois jauges (public, médias, commandement) alimentées par événements pondérés (blessures de tiers, images virales fictives, dégâts, qualité des secours, gestion pacifique). Elles influencent : tolérance des groupes (tension de base), probabilité de renforts/refus de moyens, issue institutionnelle, et le score final.

### 8.2 Ordres et désescalade
Ordres de base : déplacer, tenir, protéger (commerce/secours/secteur), accompagner, dialoguer (équipe de liaison fictive), avertir, temporiser/réévaluer, contenir, intervenir (niveau gradué), se retirer, relever, soutenir les secours. Chaque ordre expose **avantages, risques, coûts** dans l'info-bulle avant validation (lisibilité du compromis).

### 8.3 Moyens (catalogue abstrait)
Chaque moyen : `disponibilité`, `stock`, `portée de gameplay (zone/étendue abstraite)`, `effet sur tension/mobilité de groupe`, `risque pour les personnes (jauge abstraite)`, `risque de dégâts`, `effet sur l'opinion`, `limites` (stock, recharge, météo ludique). Catégories : protections, véhicules, lanceur d'eau, lacrymogène/fumigène, moyen de force intermédiaire. **Aucune valeur de portée/cadence/dosage réaliste** ; paramètres « de bon sens » seulement, jamais optimisés pour une application réelle. Aucun moyen n'est « toujours efficace » : chaque effet est probabiliste, avec effets de bord.

### 8.4 Incidents
Machine à états `emerging → active → escalating/contained → resolved/lingering` ; chaque transition dépend de durée, gravité, présence d'unités/secours, état de la foule. Les conséquences sont **persistantes** (commerce endommagé reste endommagé ; incendie non traité continue de s'étendre ; blessé suivi dans `people` jusqu'à résolution).

### 8.5 Secours et pompiers
Demandes (`RescueRequest`) → file de priorité (gravité, attente) → affectation d'une équipe disponible → trajet (délais simulés selon distance/blocages) → prise en charge → évacuation (capacité véhicule) → fin de mission/retour. Zones d'accès difficile (rues bloquées, foule dense, danger) retardent ou nécessitent une **protection par les forces** ; la sécurité des secouristes est un objectif et un critère de score.

### 8.6 Logistique
Effectifs, fatigue (progressive, récupération au repos), relève (planification et délai), stocks de moyens, budget fictif (coûts de déploiement, dégâts, évacuations, indemnisations). Une ressource non disponible est **grisée avec raison affichée** (ex. « stock épuisé », « unité en repos », « véhicule engagé »).

### 8.7 Objectifs et score
Objectifs primaires/secondaires/cachés, états visibles (en cours/atteint/échoué/menacé).
Score = somme pondérée de critères, **sans** qu'un seul critère (ex. « zone libérée ») n'efface les autres :
- Protection des personnes (blessés/décès, rapidité de prise en charge, sécurité des secours) — poids élevé
- Désescalade et proportionnalité (usage gradué, dialogue, réversibilité)
- Dégâts matériels (commerces, mobilier, incendies)
- Objectifs de mission
- Opinion/médias
- Gestion des ressources (fatigue, relève, budget)
- **Malus de conséquences** (décès, enquêtes) pouvant plafonner la note quel que soit le reste.
Rapport final : facteurs explicatifs triés par impact (« Ce qui a le plus pesé : … »), conséquences institutionnelles fictives (enquête administrative, saisine, polémique médiatique, sanction/relaxe), chronologie des décisions majeures.

### 8.8 Difficulté
Facile/Normal/Difficile modulent des **paramètres explicites et affichés** : ressources initiales, fréquence/intensité d'incidents, réactivité des foules à la provocation, délais des secours, tolérance de l'opinion. Table de paramètres versionnée, visible dans l'écran de briefing.

---

## 9. Périmètre de la première version jouable (V1)

La V1 satisfait chaque point de §24 du brief, au moindre périmètre cohérent :

**Inclus**
- Écran d'accueil, choix de ville (4 villes prédéfinies + recherche libre), clé API dans les paramètres, mode schématique de repli.
- Carte Google satellite + couche de jeu (canvas) synchronisée au zoom/déplacement ; LOD.
- Moteur 10 Hz déterministe, pause, 3 vitesses, interpolation de rendu.
- Forces : 2 types de CRS (compagnie/section) + police + 1 véhicule de transport + soutien ; sélection simple et multiple ; 8-10 ordres.
- Foules : 5 dispositions, 3-6 groupes par scénario, acteurs individuels (casseurs, meneurs, journaliste, passants).
- Incidents : jets d'objets, pétards, dégradations/bris de vitrines, intrusion/pillage, feu de poubelle/départ de feu, mouvement de foule, agression ; blessures (mineure/grave/critique, décès optionnel).
- Secours : ambulances + pompiers + file de prise en charge + évacuation.
- Moyens : protections, lanceur d'eau, fumigène/lacrymogène (abstraits), moyen de force intermédiaire (abstrait), avec risques.
- Opinion/médias (3 jauges) à effets mesurables.
- 3 missions prédéfinies (une pacifique avec risque de dérive, une escalade progressive, une tendue avec incendie/pillage) + bac à sable (paramètres §17.2).
- Bilan final complet, historique des résultats, sauvegarde/chargement/redémarrage, export/import JSON.
- Journal d'événements, bandeaux, compteurs réels, rues bloquées N/M.
- Tests moteur + E2E des parcours principaux.

**Hors V1 (reportés)**
Mode carrière, météo/jour-nuit dynamiques, multi-villes simultanées, bruit/audio avancé, scénarios communautaires, accessibilité complète (lecteur d'écran sur la carte), mobile tactile avancé (V1 cible desktop + tablette en lecture).

---

## 10. Plan par phases (rappel et livrables)

| Phase | Livrables | Critère de sortie |
|---|---|---|
| 2 | Accueil, carte, recherche, repli schématique, HUD statique, premiers marqueurs, gestion d'erreurs | Carte OK avec clé ; repli OK sans clé/erreur ; zoom/pan fluide |
| 3 | Moteur, unités, déplacements, groupes, animation, pause, vitesses | Déterminisme testé ; 3 000+ points à 60 FPS ; pause/reprise sans saut d'état |
| 4 | Incidents, dégradations, incendies, tension, journal | Chaînes causales testées ; état persistant |
| 5 | Moyens, blessures, secours, pompiers, conséquences | Chaque victime suivie jusqu'à résolution ; secouristes protégeables |
| 6 | Scénarios, objectifs, difficulté, bac à sable | 3 missions jouables ; paramètres bac à sable effectifs |
| 7 | Bilan, score, conséquences, sauvegardes, historique | Save→load rejoue identique ; rapport explicatif |
| 8 | Finition, performance, docs | Revue complète des critères §24 |

---

## 11. Coûts et dépendances

- **Logiciels** : Node ≥ 20, Vite, TypeScript, Preact, Vitest, Playwright — tous open source gratuits.
- **Données** : OpenStreetMap (ODbL, attribution) pour graphe de rues/commerces ; Overpass pour villes libres (usage raisonnable, cache).
- **Google Maps Platform** : compte Google Cloud + facturation activée + clé API ; coût probable nul sous les seuils gratuits ⚠️ (à confirmer). Plafonds de quota recommandés.
- **Aucun serveur applicatif obligatoire** (hébergement statique suffit).

## 12. Risques techniques

| Risque | Impact | Mitigation |
|---|---|---|
| Désynchronisation couche canvas / carte Google pendant pan-zoom | visuel | Utiliser `OverlayView`/événements de projection, mise à jour sur `idle` + `bounds_changed`, tests visuels Playwright |
| Performance des foules denses | FPS | Foule hybride (§2.4), batching, LOD, OffscreenCanvas/Worker pour la logique si besoin |
| Qualité du graphe de rues OSM selon les villes | navigation | Packs pré-validés pour 4 villes, repli en espace libre pour les villes libres |
| Changement tarifaire/ToS Google | coût/conformité | Abstraction `MapProvider`, plan B (§4.4), lecture des ToS à chaque phase |
| Équilibrage (jeu « ni trop punitif ni trivial ») | gameplay | Paramètres exposés, replays déterministes, tests de scénarios scriptés |
| Contenu sensible mal calibré | éthique | Revue du catalogue de moyens/incidents à chaque phase ; aucun paramètre opérationnel réel |
| Sauvegardes qui se cassent entre versions | données | `schemaVersion` + migrations testées |
| Quotas IndexedDB/navigateur | persistance | Compression JSON, limites d'historique, avertissement utilisateur |

## 13. Critères de validation (Phase 1)

La Phase 1 est validée si vous approuvez : (a) l'architecture en trois couches et la pile TypeScript/Vite/Canvas, (b) l'approche foule hybride, (c) le traitement des contraintes Google (§4) et le plan B, (d) le principe de traçabilité des sources (§5), (e) le périmètre V1 (§9), (f) les réponses aux questions ci-dessous.
