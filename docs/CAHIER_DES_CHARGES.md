# ORDRE PUBLIC — Cahier des charges technique et fonctionnel (Phase 1)

Version : **0.4** — 2026-10-11
Statut : phases 1 et 2 livrées ; **phase 3 en cours** (plan validé avec les décisions v0.4 : [`PHASE3_PLAN.md`](PHASE3_PLAN.md)) ; **validation intermédiaire à mi-phase** prévue avant la seconde moitié.

### Journal des révisions

| Version | Changement |
|---|---|
| 0.1 | Cahier des charges initial (phase 1). |
| 0.2 | **Google Maps abandonné au profit d'OpenStreetMap + MapLibre GL JS** (décision du commanditaire, phase 2). Les §3 (tableau Google), §4 et les mentions Google des §2.5/§11/§12 sont **supersédés** : voir README et §14 ci-dessous. |
| 0.4 | **Décisions du commanditaire** : planche graphique de référence reçue (§18bis, §22–§27) ; capacité cible 50 000 personnes sans plafond structurel (§23) ; paramètres de mouvement/densité configurables, blocage géométrique à états intermédiaires, plus de facteur de détour maximal (§24) ; **noms OSM affichés, plus d'anonymisation par défaut** (§16.4 révisé, §25) ; fond schématique si pas de graphe cohérent ; validation à mi-phase (§27). Voir §22 à §27. |
| 0.3 | Ajout des **exigences v0.3** : logique comportementale causale des foules, utilisation des données OSM (POI, graphe de navigation indépendant), style visuel des pions, conséquences sur le moteur, nouveau découpage des phases 3 à 7. Voir §14 à §21. |

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

### 2.5 Navigation *(révisé v0.3 — voir §17 et `PHASE3_PLAN.md` §3)*

- Le moteur embarque son **propre graphe de navigation**, indépendant de la carte : construit à partir des voies OSM (paquets de ville pré-calculés ou requête bornée) ou de la ville schématique ; il n'est jamais extrait des tuiles affichées.
- L'ancienne « navigation en espace libre » est **supprimée** : sans graphe réel, le jeu bascule sur le fond schématique.
- **Rues bloquées** = état dynamique des arêtes du graphe ; le compteur « N/M » en est dérivé.

---

## 3. Technologies retenues

| Choix | Décision | Justification |
|---|---|---|
| Langage | **TypeScript (strict)** | Typage des états et commandes, refactoring sûr, moteur testable. Un projet de cette taille (12 modules, sauvegardes versionnées) se maintient mal en JS pur. |
| Build | **Vite** | Démarrage instantané, bundle statique, aucune infra serveur. |
| UI | **DOM + Preact (≈3 Ko) ou Web Components légers** | HUD riche (listes, panneaux, formulaires) plus simple en DOM qu'en canvas ; accessibilité et CSS gratuits. Pas de framework lourd. |
| Rendu des pions | **Canvas 2D en couche superposée** (v1), **abstraction permettant PixiJS/WebGL** si nécessaire | Canvas 2D suffit pour quelques milliers de points avec LOD ; évite la complexité WebGL au départ. Plan B documenté : PixiJS ou WebGL Overlay View / deck.gl. |
| Carte | ~~Google Maps~~ → **MapLibre GL JS + OpenStreetMap** (v0.2) via l'interface `MapAdapter` | Choix du commanditaire (coût, intégration) ; sans clé ; fournisseur de tuiles et géocodeur configurables. |
| Carte de repli | **SchematicAdapter** : rendu canvas du graphe de rues + îlots + hydro/espaces verts (pas de satellite) | Mode démo sans clé / hors ligne, 100 % autonome. |
| Tests | **Vitest** (moteur sous Node) + **Playwright** (parcours UI, Chromium déjà présent dans l'environnement) | Moteur déterministe → tests de replay ; E2E pour sauvegarde et flux principaux. |
| Persistance | **IndexedDB** (sauvegardes, historique) + **localStorage** (préférences) + export/import JSON | Sauvegardes volumineuses → IndexedDB ; JSON versionné avec migrations. |
| Données de villes | Packs JSON compressés générés par script (Overpass → graphe/commerces) | Chargement instantané, pas de dépendance réseau pendant la partie. |

**Alternatives écartées** : Phaser/Unity-WebGL (poids, intégration carte complexe), JS sans TS (maintenabilité), MapLibre+tuiles satellite tierces (change l'apparence demandée ; reste le plan B si Google devient inadapté — voir §4.4).

**Lancement** : `npm install && npm run dev` pour le développement ; `npm run build` produit un dossier statique à servir par n'importe quel serveur HTTP (voir question Q3 : `file://` est incompatible avec une clé Google restreinte par référent).

---

## 4. Contraintes Google Maps Platform — *SUPERSÉDÉ (v0.2) : Google Maps n'est plus utilisé ; section conservée pour mémoire*

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

**Exigence notée (v0.5, à implémenter en phases 5/6, non commencée) — réaction de la foule à un incident.** Quand une dégradation survient (ex. feu de poubelle), une partie du cortège **se détache et reste sur les lieux** (attroupement autour de l'incident, effectif et durée liés à la gravité, à la tension et à la cohésion du groupe) ; le reste poursuit. À l'**arrivée des secours ou des forces**, l'attroupement peut réagir selon sa tension et sa cohésion : se disperser, **fuir**, ou **dégénérer** (jets de projectiles — « caillassage » — abstraits, sans valeurs réalistes ; escalade de l'incident). Chaque étape est une transition causale journalisée (scission → attroupement → réaction à l'arrivée → fuite / escalade), alimente la tension des groupes et les conséquences persistantes des incidents (phase 4), et s'appuie sur les acteurs individuels de la phase 5 et les secours de la phase 6.

**Exigence notée (v0.5, phases 5/6, non commencée) — affrontements et dégénérescence.** Les confrontations entre une partie de la foule et les forces (jets de projectiles, riposte, repli, contact) doivent être **crédibles dans leur dynamique** : montée graduelle (tension, cohésion, provocation, présence et posture des unités), foule **non homogène** (noyau agressif minoritaire, curieux, pacifiques qui s'éloignent), effets de contagion et de reflux, et **possibilité réelle de dégénérer comme de se désamorcer** selon les ordres du joueur (dialogue, avertissement, retrait, maintien, usage proportionné des moyens du §8.3) — avec effets de bord et jamais d'effet « toujours efficace ». Le réalisme porte sur le **comportement et les conséquences** (blessés, dégâts, opinion, risque pour les personnes : jauges abstraites) ; il ne porte **pas** sur des données opérationnelles : aucune portée, cadence, dosage ou tactique réelle, paramètres « de bon sens » uniquement (§8.3), tout reste fictif. Chaque affrontement est causal et journalisé (« pourquoi »), testable (déterminisme, bilans) et s'appuie sur les acteurs individuels (phase 5), les blessés et secours (phase 6), puis l'évaluation (phase 7).

**Exigence notée (v0.5, cible phases 6/7, non commencée) — outil de planification en mode bac à sable.** Avant le lancement, le joueur prépare une opération à la manière d'une manifestation déclarée en préfecture, puis la simule avec les conséquences de ses choix :
- **Manifestation déclarée** : lieu de départ, lieu d'arrivée, heure de départ, effectif attendu **avec incertitude** (estimation déclarée, effectif réel tiré autour d'elle : plus ou moins nombreux), itinéraire déclaré (le groupe peut s'en écarter selon sa tension).
- **Dispositif** : fermeture d'axes routiers, **itinéraire imposé**, positionnement d'unités (CRS…) à des points stratégiques, véhicules d'escorte sur demande ; chaque choix a des **conséquences mesurables** (circulation et riverains, fatigue et relève, tension, report de flux vers d'autres rues, coûts fictifs).
- **Blessés civils** (phase 6) : plusieurs filières possibles — extraction par les forces ou par des manifestants, prise en charge par un véhicule de secours (VSAV) ou un médecin de la police, évacuation, suivi jusqu'à résolution.
- **Interpellations et garde à vue** (phase 6) : placement de personnes en GAV, évacuation nécessaire par un vecteur de police (capacité, trajet, délais), conséquences sur la tension et sur l'opinion.
- Le bac à sable réutilise le moteur existant (scénario = données : chronologie d'événements, rues fermées, groupes, unités) : le plan du joueur est **compilé en `ScenarioEvent`** ; sauvegarde/chargement des plans (JSON versionné) ; bilan comparant le prévu et le réel (phase 7).
- Même cadre que pour le reste : tout fictif, paramètres de bon sens (§8.3), aucune donnée opérationnelle réelle.

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

## 10. Plan par phases *(révisé en v0.3 — remplace le tableau initial)*

| Phase | Contenu | État |
|---|---|---|
| 1 | Analyse et cahier des charges | ✅ validée |
| 2 | Prototype cartographique et interface (OSM/MapLibre, fond schématique, rendu Canvas 2D, pions de démonstration) | ✅ livrée, en attente d'un test sur services réels |
| 3 | **Moteur de simulation et navigation** : graphe indépendant, groupes logiques et individus simulés à grande échelle (objectif de test 50 000), cortèges / rassemblements statiques / groupes secondaires, transitions causales, déplacements d'unités et de véhicules, temps/pause, **interfaces pour le futur système de sprites** — découpée en **3a/3b (jusqu'à la validation intermédiaire)** puis **3c/3d** | ✅ livrée (3d : `PHASE3_3D.md`) |
| 4 | **Incidents et lieux d'intérêt (POI)** : POI issus d'OSM + objets de scénario synthétiques, dégradations, incendies, interactions avec le décor | ✅ livrée (`PHASE4.md`) |
| 5 | **Rendu avancé et comportements** : silhouettes de personnes, densité de foule, comportements individuels, représentation des unités | à venir |
| 6 | **Interventions et secours** : moyens, blessures, secours, pompiers, conséquences humaines | à venir |
| 7 | **Missions et évaluation** : scénarios, bac à sable, objectifs, bilans, sauvegardes | à venir |
| 8 | Finition, performance, documentation | à venir |

Règle de gouvernance : pour chaque phase, **plan → structures/mécaniques → tests → validation → code → résultat testable documenté**,
en distinguant les tests simulés des vérifications sur services réels. Aucun commit ni pull request sans autorisation.

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

---

# ADDENDUM v0.3 — Exigences complémentaires

## 14. Principe directeur : causalité de toute entité

> **Aucune foule n'apparaît ni ne se déplace sans raison.** Toute entité de jeu (groupe, unité, véhicule, incident) a une
> *origine* (`cause`) identifiable dans le scénario, un événement ou une transition d'état explicite.

- Chaque création passe par `createGroup(spec, cause)` ; **un invariant du moteur refuse** (et un test vérifie) toute création sans cause.
- `Cause = { kind: 'scenario_plan' | 'scenario_event' | 'transition' | 'player_order' | 'rule', refId, note }`.
- Toute transition importante écrit une entrée de journal **explicative** (« pourquoi ») et une entrée dans l'historique du groupe.
- Les apparitions autorisées sont : (a) mise en place initiale décrite par le scénario ; (b) arrivée programmée par le scénario à une
  *porte d'entrée* de la zone (le groupe est alors créé à l'extérieur/au bord et rejoint son objectif par le graphe) ; (c) scission, jonction ou
  départ issus d'une transition d'un groupe existant.
- Les déplacements suivent des routes du graphe ; une destination ne change **que** par une cause journalisée (événement, blocage prolongé, ordre du scénario).

## 15. Types de rassemblements

| Type | Rattachement | Mouvement | Évolution locale |
|---|---|---|---|
| **A. Cortège mobile** | point de départ + destination (+ points de passage éventuels) | suit un **itinéraire calculé sur le graphe** à vitesse de marche de jeu ; progression visible | cohésion, ralentissement, arrêt, fragmentation selon règles explicables |
| **B. Rassemblement statique** | un **lieu précis ou une zone** (ancre : place, devant un établissement, piquet…) | aucun déplacement d'ensemble ; le *centre* est fixe | densification, légère extension, arrivées/départs d'individus, baisse d'effectif |
| **C. Groupe mobile secondaire** | origine (groupe parent ou porte d'entrée) + destination prévue | itinéraire graphe, indépendant du cortège | idem A ; apparition **toujours expliquée** |

Distinction fondamentale : **position centrale du rassemblement** (logique collective) ≠ **position individuelle** de chaque personne
(membres simulés, contraints par le groupe).

**Transitions** (chacune avec cause + journal) : cortège → statique à l'arrivée ; statique → dispersion progressive ; division en groupes plus petits ;
départs individuels ; déplacement vers une destination prévue ; changement de tension après incident (Phase 4+). Détail et table de gardes : `PHASE3_PLAN.md` §5.

## 16. Données OpenStreetMap, lieux d'intérêt (POI) et provenance

### 16.1 Principes
- OSM = **information géographique incomplète et variable**, jamais une connaissance exhaustive. Aucune hypothèse de complétude par bâtiment.
- Chaque objet porte une **provenance** : `source: 'osm' | 'synthetic'` (+ `osmId` si applicable) et un **niveau de confiance** par attribut.
- **Ce qui vient d'OSM** : géométrie des voies, intersections, sens uniques, places, bâtiments (emprises), catégories de lieux, noms quand ils existent.
  **Ce que génère le jeu** : tout objet de scénario (vitrines/commerces fictifs d'incident, poubelles, abribus fictifs, véhicules), effectifs, états de simulation, incidents.

### 16.2 Catégories et attributs OSM pertinents *(à valider sur la documentation OSM avant implémentation ⚠️)*

| Domaine de jeu | Étiquettes OSM usuelles | Fiabilité attendue | Usage |
|---|---|---|---|
| Voirie | `highway=*` (primary…residential, living_street, pedestrian, footway, steps, service), `oneway`, `access`, `foot`, `motor_vehicle`, `bridge`, `tunnel`, `name`, `width`/`lanes` | géométrie : bonne ; `width`/`lanes` : rare → valeurs par défaut par classe | graphe de navigation |
| Places / espaces publics | `place=square`, `highway=pedestrian`+`area=yes`, `leisure=park\|garden` | variable | zones de rassemblement, positions de membres |
| Bâtiments | `building=*` (emprises) | bonne (géométrie), attributs rares | obstacles, exclusion des positions, décor |
| Commerces | `shop=*`, `amenity=restaurant\|cafe\|bank\|pharmacy…` | incomplète | **catégorie de rue** (« rue commerçante ») uniquement |
| Écoles | `amenity=school\|kindergarten\|college\|university` | bonne en ville | ancres de rassemblement (choisies par le scénario) |
| Administrations | `amenity=townhall\|courthouse`, `office=government`, `government=*` | moyenne | ancres de rassemblement (choisies par le scénario) |
| Entreprises | `office=*`, `craft=*`, `landuse=commercial\|industrial` | moyenne | ancres (blocus/piquet fictifs) |
| Équipements | `amenity=hospital`, `amenity=fire_station`, `amenity=parking`, `public_transport=platform`, `amenity=shelter` | bonne/moyenne | bases de secours, accès, décor |
| Mobilier | `amenity=waste_basket`, `highway=street_lamp`, `emergency=fire_hydrant`… | **très incomplète** | si absent → objets **synthétiques** |

Les installations de police/gendarmerie **ne sont pas** utilisées comme cibles ni catégorisées par vulnérabilité.

### 16.3 Structure POI minimale
`Poi { id, kind, category, geometry|pos, name?, osm?: { id, tags(utiles) }, source: 'osm'|'synthetic', sim: { state, … }, incidentIds[] }`.
Le moteur distingue : commerce, établissement public, école, entreprise, espace de rassemblement, mobilier. Les POI sont affichables et sélectionnables (Phase 4 ; la Phase 3 n'introduit que l'*ancre* minimale).

### 16.4 Règle de choix des cibles d'incident (non négociable)
- Les incidents sont générés par **scénarios synthétiques et règles de jeu** ; **aucune** donnée OSM n'est utilisée pour classer des établissements réels selon leur vulnérabilité (aucun champ « vulnérabilité » n'existe dans le modèle).
- Les cibles sont des **objets de scénario synthétiques** (vitrine fictive, commerce fictif, poubelle, abribus…) posés sur des **emplacements de décor** générés de façon déterministe le long des rues (pas sur les établissements réels). OSM ne fournit au plus qu'une *catégorie générale de rue* (ex. « rue commerçante »).
- **Noms OSM affichés** *(révisé v0.4, remplace l'anonymisation par défaut)* : les noms disponibles dans OSM (rues, places, commerces, établissements) sont affichés lorsque pertinent. En contrepartie, **tout incident, dommage, incendie ou pillage reste explicitement fictif** (étiquette « scénario fictif » / objet synthétique) et n'est **jamais présenté comme un fait réel concernant un établissement réel** ; aucun classement de vulnérabilité n'existe.
- Un incident a **une durée, un état et des conséquences mesurables** (Phase 4).

### 16.5 Données manquantes
Le jeu ne doit jamais dépendre de la richesse d'OSM : (1) objets synthétiques, (2) catégories génériques, (3) mode démonstration (ville schématique avec son graphe), (4) repli du graphe : paquet pré-calculé → récupération ciblée → graphe synthétique. Une ville pauvre en données reste jouable ; l'interface indique la part de données OSM vs synthétiques.

### 16.6 Obtention des données et licence
- **Pas de téléchargement massif via des services publics non prévus pour cela.** Le serveur public Overpass indique ≈ moins de 10 000 requêtes et 1 Go par jour comme repère de non-nuisance, **à diviser par 100 pour un usage régulier**, avec `User-Agent`/`Referer` identifiant l'application (source wiki OSM ✅ recherche web, à re-vérifier).
- Voie principale : **paquets de ville pré-calculés** (graphe + POI utiles, emprise limitée autour de la zone de jeu) produits **une fois, hors ligne**, par un script du dépôt à partir d'un extrait régional ou d'une requête unique et bornée ; paquets conservés dans `data/` avec mention de licence.
- Voie secondaire (villes libres) : **une** requête bornée à la zone de jeu, déclenchée explicitement par le joueur, mise en cache locale (IndexedDB), sinon repli synthétique.
- **ODbL** (⚠️ à confirmer, pas un avis juridique) : les paquets extraits d'OSM sont une *base de données dérivée* ; s'ils sont **redistribués publiquement**, ils doivent rester sous ODbL avec attribution « © contributeurs OpenStreetMap ». Ils seront donc isolés dans `data/osm/` avec leur licence, séparés du code. Un usage purement personnel ne déclenche pas d'obligation de redistribution.

## 17. Navigation indépendante

- Le **graphe de navigation** est construit à partir de **données géographiques** (voies OSM, ou ville schématique), **jamais** à partir des tuiles visuelles ni de `queryRenderedFeatures` (mécanisme de la Phase 2 : **abandonné** pour le moteur).
- Le graphe est **indépendant de MapLibre** ; le moteur fonctionne identiquement sur le fond schématique.
- Format : nœuds + arêtes (longueur, classe, largeur estimée, sens unique, accès piéton/véhicule, nom) en structure statique **immuable**, plus un **état dynamique** par arête (blocages, coûts) modifiable par la simulation.
- Les **rues bloquées** de la simulation modifient l'état dynamique (coût/interdiction) ; les itinéraires sont recalculés selon des règles explicables ; le compteur « rues bloquées N/M » est dérivé de ce même état (M = arêtes de la zone de jeu).
- Un trajet est calculé entre deux points de jeu (nœuds ou points projetés sur le graphe) avec A*. Spécification détaillée : `PHASE3_PLAN.md` §3.
- Si aucun graphe réel n'est disponible pour une ville, la partie ne peut pas se jouer **sur le fond OSM** (les rues du jeu ne correspondraient pas à la carte affichée) : le jeu propose alors le fond schématique (voir décision D5).

## 18. Style visuel des pions (référence : planche graphique reçue en v0.4 — voir §18bis)

Rendu de type **simulation tactique aérienne** en **Canvas 2D** (conservé), couche distincte de la carte.

**A. Manifestants** : silhouettes humaines très simplifiées vues du dessus (tête + épaules/corps), couleur de vêtement variable, orientation, contour/ombre léger, animation discrète (marche ou mouvement sur place), variations d'apparence et de position sans répétition mécanique ; densité suffisante pour une vraie foule, lisibilité préservée ; mouvements individuels contraints par le groupe.

**B. CRS/police** : silhouette compacte, équipement de protection identifiable, **bouclier visible**, orientation = déplacement/état, **identifiant numérique fictif stable** (jamais modifié par un déplacement ou un zoom, taille adaptée au zoom), contour de sélection, états visuels : au repos / en déplacement / sélectionnée / occupée / en difficulté / indisponible. CRS distincts des policiers, manifestants, ambulances, pompiers.

**C. Véhicules** : symboles vus du dessus, orientés selon le déplacement, catégories distinctes : police, CRS, ambulance, pompiers, soutien ; **ils suivent le système de déplacement** (jamais figés quand l'unité reçoit un ordre).

**D. États visuels** — groupes : rassemblement statique / cortège en mouvement / dispersé / affecté par un incident / en cours de départ ; incidents : actif / en traitement / résolu. Couleurs et animations parcimonieuses.

**E. Niveaux de détail** : faible zoom → symboles de groupe agrégés et unités simplifiées ; zoom moyen → pions individuels, identifiants conservés, véhicules et incidents plus visibles ; fort zoom → détails des personnages et équipements, sélection précise, animation fluide. **Nombre d'entités simulées ≠ nombre de pions dessinés** (échantillon représentatif selon le zoom, sélection stable par permutation fixe pour éviter le scintillement).

**F. Intégration technique** : le moteur stocke **positions et états en mètres locaux** (jamais en pixels) ; le rendu convertit via la caméra de la carte (alignement conservé en zoom/déplacement — déjà vérifié en Phase 2) ; animations indépendantes de la simulation ; redessin limité (dirty flags) ; optimisation foule dense (atlas de sprites pré-rendus + `drawImage`, voir `PHASE3_PLAN.md` §9) ; **détection de clic sub-linéaire** (index spatial : groupes d'abord, puis grille des membres du seul groupe touché).

## 19. Conséquences sur le moteur

Un **groupe logique** possède : type de rassemblement, effectif, état comportemental, position/zone de référence, destination éventuelle, progression, ensemble de **membres simulés**, **historique** des événements importants. Le moteur distingue quatre niveaux :

1. **logique collective** du groupe (FSM, route, effectif, tension) ;
2. **comportements individuels** (suivi de créneau, hésitation, départ) ;
3. **positions de simulation** (mètres locaux, tableaux typés) ;
4. **marqueurs dessinés** (échantillon, décidé par le rendu).

Les événements modifient l'état de façon **déterministe/reproductible** (graine, flux aléatoires séparés, bruit stateless par (membre, tick)). Le journal peut expliquer pourquoi un groupe s'est déplacé, arrêté, fragmenté ou associé à un incident.

## 20. Tests exigés (extension)
Causalité (aucune création sans cause), optimalité/déterminisme de la navigation, replanification sur blocage, contrainte des membres au corridor de rue, transitions d'état et journal explicatif, reproductibilité (même graine → même hash d'état ; sauvegarde/chargement à mi-parcours identique), pause/reprise sans saut, alignement carte/rendu, sélection sub-linéaire, repli sur données manquantes, séparation des tests **simulés** et des vérifications **sur services réels** (tableau dans `PHASE3_PLAN.md` §11).

## 21. Décisions ouvertes
Résolues en v0.4 : voir §22 à §27.

---

# ADDENDUM v0.4 — Décisions du commanditaire (planche graphique, capacité, paramètres, données)

## 18bis. Planche graphique de référence — analyse et architecture de sprites

Fichier : `docs/reference/planche-graphique-reference.png` (**référence de direction artistique, pas un fond d'écran ni un livrable définitif**).

### 18bis.1 Contenu de la planche (inventaire)
| Famille | Éléments représentés |
|---|---|
| Manifestants (vue du dessus) | classique, veste jaune, casquette, capuche, sac à dos, drapeau, pancarte, groupe compact, **direction de déplacement** (flèche) |
| « Casseurs » (rôle fictif de scénario) | classique, capuche noire, masque, sac, objet (projectile) ; poses **lanceur** et **course** |
| Forces de l'ordre | CRS bouclier / CRS sans bouclier, police nationale bouclier / sans bouclier, gendarmerie (mobile), unité spéciale (casque) |
| États d'unité (anneaux) | sélectionnée (cyan pointillé), en déplacement (vert pointillé + triangle), en attente (cercle blanc), en action (rouge pointillé), indisponible (gris) |
| Secours | secouriste, sapeur-pompier, équipe médicale |
| Véhicules | fourgon police, fourgon CRS, voiture de police, ambulance, camion de pompiers, véhicule de secours léger, véhicule de gendarmerie, voiture banalisée, moto de police, camion à eau |
| Objets et décors | poubelle, poubelle en feu, conteneur, conteneur en feu, banc, barrière, cône, palette/débris, gravats |
| Signalisation / marqueurs UI | sélection, destination, point d'intérêt, incident, zone d'influence, zone de jeu, rue bloquée (✕—✕ rouge), itinéraire (pointillé bleu fléché) |
| Effets visuels | fumée légère, fumée dense, feu, explosion, gaz lacrymogène |
| Groupe simplifié (zoom éloigné) | petit groupe, groupe moyen, grand cortège (nuées de points colorés) |
| Environnement urbain | passage piéton, route, intersection, place, bâtiment, entrée (école/mairie/entreprise), espace vert |
| Icônes d'information | information, alerte, incident, blessé, décès |

Enseignements de style : vue strictement zénithale, **silhouettes lisibles** (tête + épaules, accessoire marquant), contour sombre, couleurs d'identification fortes (bleu foncé = forces, orange/rouge = secours/feu, blanc/neutre = foule), **foule en nuée de points colorés** à grande distance, anneaux d'état pointillés autour des unités.

### 18bis.2 Architecture de sprites (infrastructure posée en phase 3, rendu détaillé en phase 5)
Objectif : **remplacer progressivement** les éléments provisoires par des sprites cohérents avec la planche, **sans toucher au moteur**.

1. **Le moteur ne connaît pas les sprites** : il stocke des données sémantiques (`ForceKind`, `loadout`, `VehicleKind`, `DecorKind`, composition d'une foule, graine d'apparence par individu). Le rendu traduit « donnée sémantique → sprite ».
2. **Catalogue + manifeste** (`SpriteManifest`, JSON versionné) : pour chaque sprite `id`, `famille`, taille réelle en mètres (`wM × hM`), point d'ancrage, `orientations` (1/8/16/32), animations (`idle`, `walk`, `throw`, `run`…) avec nombre d'images, **niveaux de détail** (`T0 agrégé`, `T1 points`, `T2 silhouette simple`, `T3 détaillé`) avec plages de zoom, variantes de teinte/accessoire.
3. **Fournisseurs interchangeables** (`SpriteProvider`) : `ProceduralSpriteProvider` (provisoire, dessiné par code dans un atlas hors écran — c'est le look actuel) et `ImageSpriteProvider` (un PNG par sprite ou feuilles par famille, chargés depuis `public/sprites/<jeu>/` selon le manifeste). Les deux exposent `get(spriteId, variant, orientation, frame, lodTier) → région d'atlas`. Un manifeste peut **mélanger** les deux (remplacement sprite par sprite).
4. **Atlas à l'exécution** (packer sur `OffscreenCanvas`/canvas) avec plusieurs échelles par LOD ; dessin par `drawImage` en lots ; **orientation** : bacs pré-rendus pour le personnel (nombreux), rotation `ctx.rotate` pour les véhicules (peu nombreux).
5. **Chaque élément est indépendant** : déplaçable, orientable, animable, sélectionnable, remplaçable ; **jamais une image de fond unique** issue de la planche.
6. **Marqueurs d'interface** (sélection, destination, incident, alerte, zone d'influence, zone de jeu, rue bloquée, itinéraire, anneaux d'état) : primitives vectorielles (`MarkerStyle`) distinctes des sprites, pour une lisibilité garantie à toute échelle.
7. **Effets** (fumée, feu, explosion, gaz) : système d'effets du rendu (`EffectSpec` : durée, évolution, mélange) — phase 5 ; la donnée moteur ne contient que l'état (« incendie actif », intensité).
8. **Correspondance états ↔ visuels** : `UnitStatus` { idle, moving, engaged, waiting, unavailable, in_difficulty } ↔ anneaux de la planche ; états de groupes/incidents du §18D.
9. **Sélection cohérente avec les sprites** : l'index spatial opère sur la **géométrie logique** (position, rayon en mètres), non sur les pixels du sprite ; un sprite remplacé garde la même zone de sélection (`hitRadiusM` dans le manifeste).
10. **Différenciation des acteurs** : `ForceKind` ∈ {`crs`, `police_nationale`, `gendarmerie_mobile`, `unite_speciale`} × `loadout` {bouclier, casque…} ; `RescueKind` ∈ {`secouriste`, `sapeur_pompier`, `equipe_medicale`} ; `VehicleKind` ∈ {fourgon_police, fourgon_crs, voiture_police, ambulance, camion_pompiers, vehicule_secours_leger, vehicule_gendarmerie, voiture_banalisee, moto_police, camion_a_eau}.

## 23. Capacité de simulation et performances

- **Objectif de capacité à tester : 50 000 personnes simulées**, architecture évolutive au-delà. **Aucun plafond structurel** (ni 6 000 au total, ni 600 par groupe).
- Trois niveaux **distincts** : **individus simulés** (tableaux typés, un par personne), **sous-groupes de calcul** (blocs d'individus contigus partageant un calcul de référence), **pions dessinés** (échantillon choisi par le rendu).
- **Niveaux de simulation** (par groupe, selon distance/foyer d'attention, densité, pertinence des événements) : *N0 agrégé* (le centre bouge, les positions sont des fonctions analytiques évaluées à la demande), *N1 sous-groupes* (repères mis à jour, individus placés par décalage), *N2 individuel* (dynamique complète). **Aucun individu ne disparaît** ; seule la finesse de mise à jour varie.
- **Mesures obligatoires à 5 000, 10 000, 25 000 et 50 000 personnes** : temps de calcul d'un tick (moyenne/p95/max), FPS, mémoire utilisée, limites constatées. Protocole reproductible documenté ; **aucune performance promise sans mesure**, et mesures **dépendantes de la machine** clairement signalées.
- Optimisation **progressive à partir des mesures**, jamais par réduction préventive du périmètre ; tout compromis est expliqué, mesuré, puis proposé avant adoption.

## 24. Paramètres de mouvement, de densité et de blocage

Tous **configurables** (`SimParams`, par scénario / type de groupe), **aucune constante définitive** :

- vitesse initiale de cortège **1,1 m/s** (variable selon type de groupe, densité, arrêts, obstacles, largeur des rues) ;
- nombre maximal de membres par groupe et nombre total d'individus : **sans plafond structurel** ;
- **détours** : aucun facteur maximal ; un itinéraire alternatif valide est toujours recherché ; paramètre optionnel `maxDetourRatio` (désactivé par défaut) ;
- **blocage de rue** : pas de seuil universel de 60 personnes. Calcul **géométrique** : largeur de la rue, surface occupée, densité (personnes/m²), répartition → **états intermédiaires** `libre → ralenti → partiellement obstrué → bloqué` ;
  un véhicule passe si la largeur libre ≥ largeur du véhicule + marge ; la vitesse de marche suit une relation densité-vitesse paramétrable ;
- itinéraires : **pas de traversée de bâtiments, pas de boucles, pas de déplacements instantanés** (validations testées) ; si aucun itinéraire satisfaisant n'existe, **le groupe reste sur place** (état « en attente » journalisé).

## 25. Données OpenStreetMap et lieux (décisions v0.4)

- **Pas d'anonymisation par défaut** : noms de commerces et établissements OSM affichés quand pertinent ; attributs utiles conservés (ODbL, conditions des services, attribution).
- Données géographiques réelles et objets/événements fictifs **toujours distingués** ; dommages, incendies, pillages restent fictifs et ne sont jamais présentés comme des faits réels concernant un établissement réel ; **aucun classement de vulnérabilité**.
- Graphe de navigation **indépendant du rendu**, issu de données routières adaptées (pas des tuiles). **Paquets préparés une fois** pour les villes prises en charge, **procédure locale documentée**, éventuel **téléchargement limité** ; conditions d'usage, attribution et obligations de redistribution respectées.
- **Sans graphe réel cohérent avec la carte affichée : fond schématique** (jamais de rues de jeu mal alignées sur la carte).

## 26. Architecture et interactions

Inchangée (TypeScript/Vite/Preact, Canvas 2D, MapLibre) sauf justification technique démontrée. Exigences : coordonnées de simulation indépendantes de l'écran ; **index spatial** pour sélectionner individus et objets ; séparation moteur / navigation / données géographiques / rendu / interface ; **ordres simultanés** ; pause complète et reprise ; sélection cohérente avec les futurs sprites ; journal explicatif ; tests et benchmarks reproductibles.

## 27. Organisation : validation intermédiaire à mi-phase 3

La phase 3 est découpée : **3a** navigation (graphe, A*, états de rues, données OSM sur fixtures, graphe schématique) ; **3b** noyau du moteur (horloge, journal causal, groupes, individus à grande échelle, niveaux de simulation, benchmarks) → **VALIDATION INTERMÉDIAIRE** (fonctionnalités, tests et résultats, benchmarks et limites, problèmes restants, décisions à arbitrer) ; **3c** unités/véhicules, ordres, scénario de démonstration, intégration carte/UI ; **3d** interfaces de sprites, finition, documentation. Aucune phase suivante sans validation. **Aucun commit/push/PR sans autorisation explicite.**

