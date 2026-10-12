# Outil de planification (bac à sable) — première version

Bouton **Planification** (bas de la carte). Le monde est alors vidé de ses manifestants et unités, en pause ; le panneau de gauche permet de définir :

- **Départ** et **arrivée** (clic sur la carte), **heure de départ**, **effectif déclaré** et **incertitude (± %)** : l'effectif réel est tiré autour de l'effectif déclaré (loi triangulaire, reproductible avec la graine du plan) et reste inconnu avant le départ ;
- **points de passage imposés** (itinéraire forcé), **axes fermés** (barrières posées par le moteur), **unités placées** (CRS, police nationale, gendarmerie mobile, unité spéciale) ;
- **maintien sur place** à l'arrivée avant la dispersion ;
- aperçu de l'**itinéraire prévu** (axes fermés pris en compte), longueur et durée ; message explicite si aucun itinéraire n'existe ;
- **export / import** du plan en JSON versionné (`OperationPlan`, `version: 1`).

**Lancer l'opération** compile le plan (`src/scenarios/plan.ts`) en scénario du moteur : rassemblement au départ 10 min avant l'heure dite, mise en marche à l'heure, fermetures d'axes, unités en place, dispersion après le maintien. Toutes les règles existantes s'appliquent (incidents, tension, saturation d'accès, avertisseurs…) ; chaque événement du plan porte une cause lisible dans le journal.

**Limites de cette première version** : pas encore d'escorte par véhicules, ni de blessés, secours, GAV et évacuations (phase 6), ni de bilan prévu/réel (phase 7) ; un seul groupe de manifestants ; pas d'arrivées échelonnées depuis plusieurs accès ; fermetures effectives dès le début (pas d'heure de fermeture).
