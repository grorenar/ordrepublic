# Phase 4 — Incidents et lieux d'intérêt (rapport)

Branche `claude/cahier-des-charges-phase1`. Périmètre : cahier §8.4 (incidents), §16 (POI, règle de choix des cibles), §10 (phase 4 : POI issus d'OSM + objets de scénario synthétiques, dégradations, incendies, interactions avec le décor). **Hors périmètre** (phases suivantes) : blessés et secours (6), effets visuels avancés (5), objectifs et bilans (7).

## Règle non négociable respectée (§16.4)

- Les incidents ne visent **que des objets de scénario synthétiques** (poubelle, conteneur, banc, abribus fictif, vitrine d'un **commerce fictif**), posés de façon déterministe le long des rues. Un lieu OSM est affiché avec son nom mais n'est **jamais** une cible ni classé (test : `incidents.test.ts`, `osmGraph.test.ts`, e2e).
- OSM ne fournit sur les commerces que la **catégorie générale de la rue** (« rue commerçante » quand ≥ 3 commerces OSM sont à moins de 80 m) : elle augmente seulement le nombre de commerces *fictifs*.
- Les installations de police et de gendarmerie ne sont jamais retenues comme lieux d'intérêt.
- Tout incident porte « (scénario fictif) » dans son libellé, ses événements de journal et ses panneaux.

## Ce qui a été livré

**Données (`src/nav`)** : `StreetGraph.pois` (`GraphPoi` : commerce, public, école, entreprise, mobilier ; nom OSM, source, `osmId`) ; extraction depuis les bâtiments/lieux étiquetés et les nœuds étiquetés (`classifyPoi`) ; requête Overpass étendue (`nwr[shop]`, `amenity` utiles, `office`) ; paquets de ville rétro-compatibles (`pois` facultatif) ; clé de cache `zone2` (les secteurs téléchargés avant la phase 4 sont retéléchargés pour obtenir les lieux).

**Moteur (`src/engine`, indépendant de la carte et du rendu)**
- `world.ts` : `World` = lieux d'intérêt (`Poi`) + décor (`DecorItem`), généré de façon déterministe depuis la graine, le graphe, les largeurs praticables et le masque des bâtiments (objets hors bâtiments, vitrines contre une façade, mobilier dans les places et parcs, mobilier OSM repris). Barrières et cônes posés en travers d'une rue **fermée par le scénario**, retirés à sa réouverture. Paramètres `world.*`.
- `incidents.ts` : `IncidentSystem`. Types : feu de poubelle, incendie, dégradation de mobilier, bris de vitrine. Machine à états `emerging → active → escalating | contained → lingering → resolved`.
  - **Naissance par règle** : tension d'un groupe ≥ seuil, individus à portée d'un objet, probabilité par seconde pondérée par la tension, la taille de la foule, la nature de l'objet, et **réduite si une unité est proche** (dissuasion). Délai de réarmement par groupe, plafond d'incidents actifs. Bruit sans état (`hash32`) : reproductible.
  - **Évolution** : sans unité à proximité, un incendie s'aggrave (gravité 1→5) ; avec une unité présente de façon continue, il est **confiné** (plus d'aggravation ni de propagation ; l'extinction relève des secours, phase 6). Propagation de proche en proche à des objets inflammables (incidents enfants chaînés à leur parent, cause = parent).
  - **Conséquences persistantes** : état du décor (`intact → burning → burnt / damaged / destroyed`), dégâts cumulés sur le lieu (0–100), commerce fictif détruit par un incendie prolongé, coûts fictifs par objet.
  - **Effets sur la foule** : la tension des groupes proches monte à la naissance et à l'aggravation, puis retombe vers la tension de fond ; le groupe est marqué « affecté » (liseré pulsé).
  - **Causalité** : chaque incident a une `cause` (règle de tension d'un groupe, événement de scénario, propagation) ; chaque transition est journalisée (`incident.created / active / escalated / contained / spread / ended / resolved / destroyed`) avec son « pourquoi ».
- `Sim` : `world`, `incidents`, `setTension`, événements de scénario `set_tension` et `spawn_incident`. 38 nouveaux paramètres (`world.*`, `incidents.*`) documentés dans `docs/PARAMETRES.md`.

**Rendu et interface (état lu depuis le moteur, aucune donnée de démonstration)** : décor en sprites (`decorSpriteFor`, les objets changent de sprite selon leur état : poubelle en feu, brûlée, vitrine brisée, gravats…), lueur et fumée des incendies, épingle d'alerte et étiquette « fictif », lieux d'intérêt en épingles (nom OSM affiché tel quel), groupes affectés ; sélection d'un incident ou d'un lieu (panneau de détail : état, gravité, coût, cible, chaîne de causes, conséquences, historique) ; liste « Incidents (fictifs) » ; compteurs « Incidents actifs » et « coût fictif » lus depuis `Sim.incidents.stats()`.

**Scénario de démonstration** : le scénario règle seulement la tension du cortège (28 au départ, 68 au tiers du parcours, 25 à l'approche) ; les incidents en découlent par les règles du moteur. Un départ de feu de poubelle est scénarisé près du piquet (cause « événement de scénario »).

## Tests

- `tests/unit/incidents.test.ts` (22) : monde déterministe, objets hors bâtiments, commerces fictifs, déclenchement par règle (cause citant groupe et tension), foule calme sans incident, jamais de cible OSM, dissuasion par une unité, plafonds, machine à états complète, escalade / confinement, propagation chaînée, bris de vitrine persistant, destruction d'un commerce fictif, effet sur la tension, journal explicatif, statistiques, déterminisme, scénario (tension, incident, barrières).
- `tests/unit/osmGraph.test.ts` (+5) : extraction des lieux, exclusion de la police, paquet, monde bâti sur ces données, requête Overpass.
- `tests/e2e/incidents.spec.ts` (4) : incident visible, sélectionnable, causes affichées, compteurs égaux à l'état du moteur ; commerce fictif ; scénario de démonstration par règles.

## Limites restantes

- Non vérifié en production : l'extraction réelle des lieux depuis Overpass (la requête et le parseur sont testés sur des réponses simulées uniquement) ; la densité de lieux OSM varie beaucoup selon les villes.
- Aucune extinction (secours, phase 6) ; le confinement par une unité est une simplification de gameplay documentée.
- Pas d'acteurs individuels « casseurs » (phase 5) : l'incident vient de la tension d'un groupe et de la proximité d'un objet.
- Les effets de fumée/feu sont des primitives vectorielles provisoires (`EffectSpec` : phase 5).

## Suite prévue (demandée, non commencée)

Réaction de la foule à un incident : détachement d'une partie du cortège qui reste sur les lieux, puis, à l'arrivée des secours ou des forces, dispersion, fuite ou dégénérescence (jets abstraits). Exigences consignées au cahier §8.4 (dont les affrontements et leur possible dégénérescence, sans données opérationnelles réelles) ; elle s'implémentera avec les comportements individuels (phase 5) et les secours (phase 6). Points d'accroche déjà en place : `splitGroup` (scission causale), `Incident.groupId`, `CrowdGroup.tension / cohesion / affectedUntilMs`, présence d'unités (`unitNear`), états d'incident.

## Retours d'essai (après livraison)

- Chargement OSM à la demande : jusqu'à **10 tentatives** (services alternés, attente croissante, annulable) avant l'échec ; la progression affiche « tentative n/10 ».
- Incidents moins fréquents (taux 0,003/s, réarmement 150 s, 6 actifs maximum) ; coût fictif compté dès que le feu a pris ; la gravité est expliquée dans le panneau (1 départ de feu limité … 5 embrasement généralisé).
- URL `?foule=N` : ajoute un rassemblement d'essai de N personnes (test de charge).
- Vue aérienne mixte : noms de rues et de lieux + contours de bâtiments (OpenFreeMap) par-dessus la photo IGN, case « Noms de rues et lieux ». Non vérifiée sur les vrais services (pas de réseau ici).
- Correctif du chargement OSM (retour d'essai : « charge indéfiniment ») : la cause probable était une requête devenue plus lourde (lieux d'intérêt, relations incluses) combinée à 10 tentatives de 60 s. Désormais : délai de **20 s par tentative**, requête **sans relations** ; à partir de la **3e tentative**, requête **allégée sans lieux d'intérêt** (le jeu reste jouable) ; une réponse HTTP 200 portant une erreur d'exécution Overpass est retentée. Pire cas ≈ 4 minutes, avec la progression affichée et l'annulation possible. Non vérifié sur le vrai service (pas de réseau ici).
- Retour d'essai suivant : (1) le **fond de carte choisi au départ est verrouillé** en jeu (plus de bouton de bascule ; le choix se fait à l'accueil et reste mémorisé ; le repli automatique vers le fond schématique en cas d'échec de la carte reste, avec « Réessayer ») ; (2) le chargeur OSM **n'allège plus la requête d'office** : une case « Charger aussi les lieux d'intérêt » est proposée pendant le chargement (relue à chaque tentative), avec un message d'aide après 3 échecs ; le joueur décide de continuer à attendre, d'alléger ou d'annuler.
- Retour d'essai : « accumuler les requêtes fonctionne moins bien qu'avant ». Cause probable : Overpass continue de traiter côté serveur une requête que le client abandonne ; relancer aussitôt en occupe un second créneau (limite par adresse) et les tentatives se bloquent entre elles, alors que cliquer à la main laissait du temps. Désormais : **45 s par tentative** (au lieu de 20), requête serveur limitée à 40 s, attente de base 4 s croissante, et **avant chaque nouvelle tentative on consulte la page d'état du service (`/api/status`) et on attend le créneau libre annoncé** (ou le `Retry-After` d'un 429), jusqu'à 60 s. Les deux services sont toujours alternés. Non vérifié sur le vrai service (pas de réseau ici) ; la page d'état peut ne pas être accessible depuis le navigateur, auquel cas seule l'attente croissante s'applique.
- Retour d'essai (place de la République, Metz : la foule s'amasse dans la rue voisine) : cause probable = place cartographiée en **multipolygone**, ignorée jusque-là, donc absente du graphe et non praticable. Corrigé : multipolygones demandés (`out geom`) et assemblés ; écart ≤ 6 m entre rue et place comblé. Voir `docs/DONNEES_OSM.md`. Non vérifié sur les vraies données de Metz (pas de réseau ici).
- Retours d'essai sur Metz : (1) chargement OSM — l'attente de créneau, le délai court et l'alternance des services ralentissaient plutôt qu'ils n'aidaient : retour à **60 s par tentative**, relance après **1 s**, **uniquement sur overpass-api.de** (l'autre service seulement si le premier est injoignable), page d'état en option désactivée ; (2) voies de bus : base **9 m/s** (plafond d'urgence 16 m/s ≈ 58 km/h) ; (3) arrivée : le rassemblement **occupe d'abord la place voisine** avant de déborder dans les rues (`fill.openCost`) ; (4) départ : le rassemblement s'**étire dans le sens de la marche** (`fill.behindPenalty`, `GroupSpec.fillBias`), pour limiter l'effet « aspirateur » (convergence depuis l'arrière vers le point de départ). À valider visuellement sur Metz.
- Retour d'essai : **commerces réels ciblables** (décision du commanditaire, cahier §16.4 révisé) : leur vitrine est une cible d'incident fictif au même titre que les commerces fictifs, tirage au hasard à égalité, sans catégorie privilégiée, libellé « (scénario fictif) » avec le nom réel ; réglage `incidents.realShopsTargetable`. Et **démarrage étalé** d'un cortège (`departureUnroll`) : tout le monde part en même temps vers l'entrée de l'itinéraire, les plus éloignés de la tête avancent plus lentement (le cortège s'étire) au lieu d'attendre puis de converger.
