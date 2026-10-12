# Phase 3d — Architecture de sprites, finition (rapport)

Branche `claude/cahier-des-charges-phase1`. Périmètre : cahier §18bis.2 et `PHASE3_PLAN.md` §9 (interfaces de sprites, finition, benchmarks navigateur).

## Ce qui a été livré

**Séparation en couches** (vérifiée par tests : `tests/unit/purity.test.ts`, `tests/unit/sprites.test.ts`)

```
moteur (sim, nav)  →  GameController  →  buildSnapshot (RenderableSnapshot)  →  GameRenderer (Canvas 2D)  →  SpriteProvider (atlas)
 mètres locaux          pont UI             données sémantiques + positions        projection, LOD, marqueurs     dessin par code ou images
                                            interpolées + graines d'apparence
```

- Le moteur ne connaît ni sprite, ni pixel, ni écran. Il fournit `ForceKind`, `loadout`, `VehicleKind`, `UnitStatus`, une graine d'apparence par individu.
- `src/render/sprites/` :
  - `types.ts` — `SpriteDef`, `SpriteManifest` (JSON versionné), `SpriteProvider`, `SpriteRegion`, `SpriteQuery`, `MarkerStyle`, `EffectSpec`.
  - `manifest.ts` — manifeste des sprites provisoires (≈ 60 entrées) : manifestant (48 variantes : 8 couleurs × 6 accessoires), CRS / police nationale / gendarmerie mobile avec ou sans bouclier, unité spéciale casquée, secouristes (3), 10 véhicules, 13 objets urbains (poubelle, poubelle en feu, banc, barrière, cône, conteneur, conteneur en feu, débris, gravats, vitrine fictive intacte/brisée, abribus fictif intact/endommagé). Taille réelle en mètres, ancrage, orientations (1/8), animations, variantes, `hitRadiusM`, `minPx`. `validateManifest` contrôle la cohérence.
  - `atlas.ts` — planches `OffscreenCanvas` rangées par étagères, saturation gérée (remise à zéro et redessin à la demande).
  - `procedural.ts` — `ProceduralSpriteProvider` : formes géométriques simples, aplats, contour sombre, vue strictement zénithale. Atlas à échelles quantifiées (quart d'octave), pré-rendu par orientation (8) / variante / image d'animation, rendu à la résolution de l'écran (DPR). Dessin remplaçable par sprite ou par famille (`register`).
  - `image.ts` — `ImageSpriteProvider` (planche : lignes = orientations, colonnes = variante × images, chemin `<baseUrl>/<fichier>` du manifeste) et `MixedSpriteProvider` (remplacement **sprite par sprite**, repli procédural tant qu'une image charge ou si elle manque).
  - `snapshot.ts` — `buildSnapshot`, `crowdPose`, `appearanceOf`, `orientationIndex`.
  - `markers.ts` — marqueurs d'interface vectoriels (anneaux d'état ↔ `UnitStatus`, sélection, survol, destination, rue bloquée, itinéraire, zone…), distincts des sprites.
  - `gallery.ts` + `?gallery` — planche de contrôle (toutes orientations, images, variantes ; fond jour/nuit ; échelle et palier réglables) : outil de recette pour la future planche graphique.
- **Niveaux de détail** (`render/lod.ts`, `Lod.tier`) : T0 agrégé (zoom < 14,8) ; T1 points (< 17,8) ; T2 silhouette simple (< 18,7) ; T3 détaillé (accessoires, bras animés).
- **Orientation et animation** : manifestants orientés selon leur déplacement (8 secteurs pré-rendus ; orientation stable tirée de la graine à l'arrêt), 3 images de marche ; unités et véhicules orientés par rotation du canvas (cap interpolé). Animations indépendantes de la simulation (temps de jeu).
- **États** : anneaux d'état par `UnitStatus`, gyrophares dynamiques (superposés au sprite statique), CRS avec/sans bouclier = sprites distincts.
- **Sélection cohérente avec les sprites** : `SelectionIndex.hitRadius` lit `hitRadiusM` du manifeste (géométrie logique en mètres) ; remplacer un sprite ne change pas la zone de clic (test).
- **Performance** : la requête `deferred` met en file les sprites absents du cache et le rendu les réalise en fin d'image (`flush`). Sans cela, alterner dessin dans l'atlas et copie vers l'écran faisait chuter le rendu à ≈ 1,5 img/s (500 ms/image) ; avec : ≈ 5 ms/image. En attendant, un point coloré est dessiné (pas de trou dans la foule).

## Mesures (conteneur sans GPU, rendu logiciel : valeurs indicatives, dépendantes de la machine)

| Régime | Manifestants | Éléments dessinés/image | Cadence | Dessin moyen (p95) | Tick moteur |
|---|---|---|---|---|---|
| points (zoom 16,2–17,4) | 668 / 20 668 / 50 668 | 120 / 6 707 / 8 353 | 58,8 / 32,5 / 25,3 img/s | 0,55 / 3,4 / 4,7 ms | 0,28 / 2,2 / 4,9 ms |
| silhouettes (zoom 18,4–19) | 668 / 20 668 / 50 668 | 120 / 3 441 / 1 709 | 60 / 50,7 / 57,3 img/s | 0,63 / 5,0 / 3,2 ms | 0,35 / 2,3 / 5,3 ms |

Budget : 9 000 points ou 6 000 silhouettes par image au plus (échantillon régulier stable par permutation fixe). Commande : `npm run test:e2e -- bench`.

## Limites restantes

- Sprites provisoires : volontairement simples ; aucune planche d'images fournie (le chemin `ImageSpriteProvider` est testé avec un chargeur factice, pas avec de vrais PNG).
- Pas de GPU dans l'environnement : les cadences réelles sur poste de jeu n'ont pas été mesurées.
- Les icônes d'information (info, alerte, blessé, décès) et les effets (fumée, feu, explosion, gaz : `EffectSpec`) ne sont que des interfaces ; leur rendu relève des phases 5/6.
- À fort zoom, les silhouettes ne sont pas encore recoupées par des collisions visuelles (chevauchements possibles dans une foule dense).
