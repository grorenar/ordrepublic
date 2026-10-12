# ORDRE PUBLIC — jeu de simulation fictif de commandement du maintien de l'ordre

Jeu solo en navigateur. **Entièrement fictif** : événements, unités, incidents et identifiants sont simulés.
Cahier des charges : [`docs/CAHIER_DES_CHARGES.md`](docs/CAHIER_DES_CHARGES.md).

**État : phase 3 en cours (mi-parcours : navigation + noyau du moteur, en attente de validation).**
L'interface de la phase 2 affiche encore des *données de démonstration* ; le moteur (`src/engine`, `src/nav`) est testé et mesuré
mais **pas encore branché** à l'interface (3c). Rapport : [`docs/PHASE3_MIDPOINT.md`](docs/PHASE3_MIDPOINT.md) · plan : [`docs/PHASE3_PLAN.md`](docs/PHASE3_PLAN.md).

## Installation et lancement

Prérequis : Node.js ≥ 20.

```bash
npm install
npm run dev          # développement : http://localhost:5173
npm run build        # vérification des types + build statique dans dist/
npm run preview      # sert dist/ sur http://localhost:4173
```

Aucun serveur applicatif : `dist/` est un site statique (à servir par HTTP, pas via `file://`).

### Tests

```bash
npm run typecheck
npm test                                   # tests unitaires (Vitest) : navigation, moteur, horloge, reproductibilité
npm run bench:engine                       # benchmarks du moteur (5k à 50k personnes) → docs/BENCHMARKS.md
npm run bench:engine -- --extended         # + 100 000 et 250 000 (recherche des limites)
npm run bench:engine -- --quick            # vérification rapide, n'écrit pas le rapport
npx playwright test                        # tests d'intégration (build + preview automatiques)
npx playwright test bench                  # banc d'essai de rendu (affiche les mesures)
```

Playwright utilise son Chromium par défaut ; pour utiliser un Chromium déjà installé :
`PW_CHROMIUM=/chemin/vers/chrome npx playwright test`.
Ne pas forcer `--use-angle=swiftshader` : en environnement sans GPU cela ralentit fortement le canvas 2D (mesures faussées).

Paramètres d'URL de diagnostic : `?debug` (expose `window.__ORDRE__`), `&autostart=metz|paris|lyon|marseille`,
`&map=schematic|osm|test` (`test` = style MapLibre local sans réseau), `&bench=N` (N groupes de foule supplémentaires).

## Arborescence

```
src/
  app/            App.tsx : écrans, paramètres d'URL de diagnostic
  config/         mapConfig.ts (fournisseurs de fond, délais), settings.ts (réglages locaux)
  geo/            mercator.ts (projection + repère local en mètres), cities.ts, geocode.ts (Nominatim), streets.ts (phase 2, sera supprimé),
                  schematicCity.ts (ville procédurale pure : rues, places, bâtiments)
  nav/            graphe de navigation indépendant de la carte : graph, spatialGrid, astar, route, streetState (états de rue géométriques),
                  walkMask, schematicGraph, osm/ (parseur Overpass, politique de filtrage, construction)
  engine/         moteur de simulation (sans DOM ni carte) : sim (groupes, causalité, transitions), motion (positions des individus),
                  clock, journal, layout, members, params, rng
  map/            MapAdapter.ts (contrat), MapLibreAdapter.ts, SchematicAdapter.ts, schematic/city.ts
  render/         GameRenderer.ts (Canvas 2D), lod.ts (niveaux de détail, clic), crowd.ts (foule animée)
  state/          types.ts (données indépendantes de la carte), rng.ts (PRNG à graine)
  demo/           demoScenario.ts (données de démonstration + compteurs dérivés)
  ui/             HomeScreen, GameScreen, panels, CitySearch (Preact)
tests/unit/       Vitest — projection, géocodage, réglages, LOD, nav (A*, états de rue, OSM sur fixtures), moteur, horloge, pureté
tests/e2e/        Playwright — accueil, schématique, MapLibre (calage), erreurs réseau, banc d'essai
docs/             cahier des charges, plan et rapport de phase 3, benchmarks, planche graphique de référence
scripts/          bench-engine.ts
```

Principe : le **moteur/état** n'importe ni MapLibre ni le DOM (coordonnées en mètres locaux) ; la **carte** est derrière
l'interface `MapAdapter` (caméra + événements) ; le **rendu du jeu** projette lui-même via la caméra de l'adaptateur.

## Services externes (tous optionnels)

| Service | Usage | Conditions / remarques |
|---|---|---|
| **OpenFreeMap** (défaut) `tiles.openfreemap.org` | Style + tuiles vectorielles OSM | Gratuit, sans clé ; attribution ajoutée par le style (© OpenMapTiles, données © contributeurs OpenStreetMap). Pas de garantie de service. |
| Tuiles OSM officielles `tile.openstreetmap.org` | Choix « usage léger » dans les réglages | Serveur communautaire : usage intensif et pré-chargement interdits, Referer et attribution obligatoires. **Non utilisé par défaut.** |
| Style MapLibre personnalisé | Réglages avancés | Fournisseur commercial ou auto-hébergé de votre choix. |
| **Nominatim** `nominatim.openstreetmap.org` | Recherche libre de ville | Requête à la validation uniquement (pas d'autocomplétion), ≤ 1 requête/s, résultats mis en cache 7 jours, Referer fourni par le navigateur. Point d'accès modifiable (réglages avancés). |

Sans connexion ou en cas d'échec : bascule automatique (avec message) vers le **fond schématique**, généré localement,
qui ne fait aucune requête externe. Aucune dépendance à Google Maps ni à une clé API.

Licence des données : OpenStreetMap — ODbL, attribution « © contributeurs OpenStreetMap » conservée visible
(contrôle d'attribution de MapLibre, jamais masqué). Les sources et conditions ci-dessus sont à re-vérifier avant toute diffusion.
