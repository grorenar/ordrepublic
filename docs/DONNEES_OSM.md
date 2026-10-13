# Données OpenStreetMap : générer les paquets de ville (Metz, Paris, Lyon, Marseille)

Le jeu utilise, pour jouer **sur la carte OpenStreetMap**, un **graphe de rues réel** (voies, places, parcs, emprises de bâtiments) préparé **une fois** par ville. Sans paquet, le jeu bascule sur le **fond schématique** (décision D5 : jamais de rues de jeu mal alignées sur la carte).

> **État de vérification** : le script est testé sur une **fixture simulée** (`tests/fixtures/overpass-mini.json`) et par des tests unitaires (aucun accès réseau). **Aucune donnée OSM réelle n'a été téléchargée ni traitée depuis l'environnement de développement** : la procédure ci-dessous est à exécuter sur votre machine ; le rapport produit (§6) permet de contrôler le résultat.

## 1. Dépendances
- Node.js ≥ 20 et `npm install` dans le dépôt (aucune autre dépendance : pas d'osmium, pas de Python).
- Un navigateur (méthode A) **ou** un accès Internet pour la commande `--fetch` (méthode B).

## 2. Méthode A — export manuel (recommandée, un téléchargement par ville fait par vous)
1. Afficher la requête de la ville (aucun accès réseau) :
   ```bash
   npm run data:pack -- --city metz --print-query
   ```
   La requête est **unique et bornée** : emprise 3,4 × 2,7 km ≈ 9,2 km² autour du centre de la ville (refusée au-delà de 12 km²), voies + places + parcs + bâtiments, sans relations.
2. Dans un navigateur : ouvrir <https://overpass-turbo.eu>, coller la requête, *Exécuter*, puis **Exporter → données brutes OSM (JSON)** et enregistrer le fichier (ex. `metz.json`).
3. Générer le paquet :
   ```bash
   npm run data:pack -- --city metz --input metz.json
   ```
4. Répéter pour `paris`, `lyon`, `marseille` (une ville par appel avec `--input`). Les emprises de Paris/Lyon/Marseille sont denses : le fichier peut atteindre plusieurs dizaines de Mo ; ajouter `--no-buildings` à `--print-query` et à l'import réduit fortement la taille (le rejet des bâtiments par les foules est alors désactivé pour cette ville).

## 3. Méthode B — requête directe (une requête par ville, avec confirmation explicite)
```bash
npm run data:pack -- --city all --fetch --confirm-network \
  --user-agent "OrdrePublic-prive (votre-contact@exemple.org)"
```
- **Une seule requête par ville** (4 au total pour `all`), **20 s de pause** entre deux villes (`--delay`), aucune relance automatique. Une réponse 429/504 ignore la ville : réessayez plus tard ou utilisez la méthode A.
- `--user-agent` est **obligatoire** et doit identifier l'application et un moyen de vous contacter (politique des serveurs publics).
- L'`--endpoint` par défaut est l'instance publique `https://overpass-api.de/api/interpreter`. D'autres instances publiques existent (listées sur le wiki OSM « Overpass API ») avec **leurs propres conditions** : vérifiez-les avant de les utiliser.
- La réponse brute est conservée dans `data/osm/raw/<ville>.overpass.json` (ignorée par Git) : relancer `npm run data:pack -- --city metz` **sans option** reconstruit le paquet **hors ligne** depuis ce cache.

## 4. Fichiers produits (dans `public/data/osm/`)
| Fichier | Contenu |
|---|---|
| `<ville>.graph.json` | paquet : graphe, places, bâtiments, noms OSM, provenance, méta (date, emprise, attribution) |
| `<ville>.graph.json.gz` | même contenu compressé (à servir si votre hébergeur gère `Content-Encoding`) |
| `<ville>.report.json` | rapport de qualité (§6) |
| `LICENSE-ODbL.md` | notice de licence et d'attribution |

Le jeu charge `/data/osm/<ville>.graph.json` au lancement. Ces fichiers sont **ignorés par Git** par défaut (voir §5).

## 5. Limites des services et conditions de licence
**Overpass (service public)** — repères de la documentation OSM (⚠️ à re-vérifier, ils évoluent) : moins de ~10 000 requêtes et ~1 Go par jour comme seuil de non-nuisance ; **diviser par 100 pour un usage régulier** ; identifier l'application (User-Agent/Referer) ; ne pas s'en servir comme infrastructure de production d'une application ; pour un usage soutenu ou commercial, instance dédiée. Ce projet : 1 requête par ville, une fois, avec cache.

**Licence ODbL 1.0** (⚠️ non juridique, à confirmer) :
- Les paquets sont une **base de données dérivée** d'OpenStreetMap. **Usage personnel/local** : aucune obligation de redistribution.
- **Redistribution publique** (dépôt public, site hébergé, archive téléchargeable) : le paquet doit rester sous **ODbL**, avec l'attribution « © contributeurs OpenStreetMap » et l'indication des modifications (extraction, filtrage, conversion). C'est pourquoi `public/data/osm/*.graph.json*` est dans `.gitignore` : **ne les commitez que si vous acceptez ces obligations** (et conservez `LICENSE-ODbL.md` à côté).
- L'**attribution** reste visible dans l'interface quand des données OSM sont utilisées (contrôle d'attribution de la carte).
- Les **noms** de lieux provenant d'OSM sont affichés tels quels ; les événements (incendies, dommages…) restent fictifs et ne sont jamais présentés comme réels.

**Tuiles de la carte** : indépendantes des paquets (voir README, fournisseurs de fond et leurs conditions).

## 6. Contrôler le résultat
Le script affiche et écrit un rapport par ville :
- nombre d'arêtes, de nœuds, kilomètres de voies, places/parcs, bâtiments ;
- **densité de voirie** (km/km²) : un avertissement apparaît si elle est inférieure à 5 (données OSM incomplètes ou emprise mal placée) ;
- composantes connexes (seule la plus grande est conservée) ; part de largeurs **estimées par défaut** (largeur OSM absente) ;
- relations ignorées (multipolygones non gérés : quelques grands bâtiments ou places peuvent manquer) ;
- exclusions par raison (autoroutes, trottoirs séparés, accès privés…).

Puis, dans le jeu, choisir la ville avec le fond « Carte OpenStreetMap » : **les rues du jeu (blocages, itinéraires) doivent se superposer aux rues de la carte**. Sinon, le paquet est périmé ou l'emprise ne correspond pas : régénérez-le et signalez-le.

## 7. Dépannage
| Symptôme | Cause probable | Action |
|---|---|---|
| `HTTP 429` / `504` | service surchargé ou limite d'usage | attendre, méthode A, ou autre instance (conditions à vérifier) |
| « aucune voie exploitable » | export vide ou autre zone | refaire l'export avec la requête exacte de `--print-query` |
| « Emprise … refusée » | `--max-area-km2` dépassé | ne pas augmenter l'emprise ; réduire la zone |
| fichier très gros / lent | bâtiments de Paris | `--no-buildings` |
| le jeu reste en fond schématique | paquet absent ou en 404 | vérifier `public/data/osm/<ville>.graph.json` et relancer le serveur |

## Voies de bus en site propre (BHNS, ex. Mettis à Metz)

Retenues comme classe `Busway` : `highway=busway`, `highway=service` + `service=busway|bus`, ou voie fermée (`access=no`) réservée aux bus (`bus=designated`, `psv=designated`). Praticables **à pied** par un cortège (l'interdiction légale n'empêche pas matériellement de s'y engager), non ouvertes à la circulation générale ; les véhicules **avec avertisseurs** peuvent les emprunter **à vitesse d'artère** (9 m/s de base × facteur d’urgence, plafonné à 16 m/s ≈ 58 km/h) : ces voies accueillent des bus de plusieurs tonnes et sont donc larges (largeur par défaut 8 m, minimum 4 m pour un véhicule). Les véhicules sans avertisseurs n'y accèdent pas. Avant ce correctif elles étaient exclues du graphe (`excluded_class` / `no_access`), donc invisibles pour le moteur. Les couloirs de bus **dans** la chaussée d'une rue ordinaire font déjà partie de cette rue.

## Liaisons piétonnes entre voies adjacentes

Dans OSM, deux voies voisines (chaussées séparées d'un terre-plein, voie de bus le long d'une avenue…) ne sont reliées qu'à leurs carrefours. À pied, on passe pourtant de l'une à l'autre dès qu'**aucun bâtiment** ne les sépare. `addPedestrianLinks` (`src/nav/links.ts`, appelé à la construction du graphe OSM) ajoute donc des arêtes piétonnes courtes (3 m de large, aucune circulation) entre deux voies :
- distantes de 3 à 24 m, **sans bâtiment** sur le segment (masque des bâtiments), ni tunnel ni pont ni escalier ;
- seulement si le trajet existant est au moins 3 × l'écart + 60 m (pas de liaison redondante avec un carrefour proche) ;
- espacées d'au moins 45 m sur une même voie, à plus de 5 m d'un carrefour ; les voies sont coupées aux points de liaison (longueurs, classes et noms conservés).
Les paramètres sont `DEFAULT_LINK_OPTIONS`. Déterministe ; environ 1 s pour plusieurs milliers d'arêtes. Le rapport de construction indique `pedestrianLinks`. Option `links: false` pour désactiver. Les paquets de ville déjà générés n'en contiennent pas : à régénérer, ou chargement à la demande (déjà inclus).

## Places et parcs cartographiés en multipolygone, et accès à la place

- Les **multipolygones** (`type=multipolygon`) de places (`place=square`), zones piétonnes (`highway=pedestrian`), parcs/jardins et bâtiments sont maintenant demandés à Overpass avec leur géométrie (`out geom`) ; leurs anneaux extérieurs sont assemblés à la lecture (trous non gérés). Une grande place cartographiée ainsi (cas fréquent) était auparavant **absente du jeu** : la foule s'amassait dans la rue voisine, ses cellules n'étant pas praticables.
- Un **petit écart** (≤ 6 m : trottoir, bordure, rangée de potelets) entre une rue et un espace ouvert voisin est comblé (`WalkMask.GAP_BRIDGE_M`) : la place est accessible depuis la rue.
- Une place **non cartographiée du tout** reste inaccessible aux rassemblements (le jeu ne marche que sur du sol connu : rues, places, parcs). Si une place de votre secteur est absente, indiquez-moi ses étiquettes OSM.

## Traversée des places et zones piétonnes cartographiées en surface

Une place ou zone piétonne (`place=square`, `highway=pedestrian` + `area=yes`, parc) n'a le plus souvent **aucune arête à l'intérieur** : le graphe de navigation ne sait donc pas qu'on peut la traverser, et un cortège la contourne ou refuse d'y passer (exemple : place Saint-Jacques à Metz). `addOpenSpaceLinks` relie par des arêtes piétonnes droites les nœuds de BORDURE du réseau (à ≤ 10 m du contour : les rues qui aboutissent à la place), quand le segment reste dans l’espace (hors bâtiment) et que le trajet existant — liaisons déjà posées comprises — est au moins 1,5 × plus long (+ 30 m). Portée 15–220 m, 2 traversées par nœud au plus ; les parcs (allées déjà cartographiées) sont exclus. Comme sur toute voie piétonne large, un véhicule peut la traverser au pas.

## Mobilier : OSM d'abord

Les bancs (`amenity=bench`) et poubelles (`amenity=waste_basket`) OSM sont repris tels quels. Si OSM en recense au moins 15 d'un type dans le secteur, la cartographie est jugée complète et **aucun objet synthétique de ce type n'est ajouté** ; sinon les objets synthétiques ne comblent que les manques (à plus de 30 m d'un objet OSM du même type). Paramètres `world.osmFurnitureCoverageMin` et `world.osmFurnitureClearM`.

## Plans d'eau (fleuve, lacs) et trous

Les plans d’eau et bassins (`natural=water` même `intermittent=yes`, `water=basin`, `amenity=fountain`, `waterway=riverbank`, `landuse=reservoir|basin`), en chemins fermés ou en multipolygones, sont demandés à Overpass et traités comme des **obstacles « eau »** : une foule ne s'y tient pas. Les **ponts** restent praticables (la voie prime sur l'obstacle, sur toute la largeur du pont). Les **anneaux intérieurs** des multipolygones sont gérés : une île d'un plan d'eau est libre, un bassin à l'intérieur d'un parc est exclu de la surface praticable. Avant ce correctif, un fleuve non chargé n'était pas bloqué : un rassemblement proche d'un pont pouvait s'étaler dans l'eau (quai de la Moselle à Metz).

## Remarque sur le démarrage d'un cortège

Voir `PARAMETRES.md` : `departureUnroll`, `departureWaveMps`, `departureWalkMps`, `departureCompress` (« dès qu'il y a de la place, les plus éloignés avancent vers la suite »).
