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

Réaction de la foule à un incident : détachement d'une partie du cortège qui reste sur les lieux, puis, à l'arrivée des secours ou des forces, dispersion, fuite ou dégénérescence (jets abstraits). Exigence consignée au cahier §8.4 ; elle s'implémentera avec les comportements individuels (phase 5) et les secours (phase 6). Points d'accroche déjà en place : `splitGroup` (scission causale), `Incident.groupId`, `CrowdGroup.tension / cohesion / affectedUntilMs`, présence d'unités (`unitNear`), états d'incident.
