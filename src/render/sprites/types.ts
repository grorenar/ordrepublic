/**
 * Architecture de sprites (cahier §18bis.2). Le moteur ne connaît pas les sprites : il expose des données sémantiques
 * (`ForceKind`, `loadout`, `VehicleKind`, graine d'apparence). Le rendu traduit « donnée sémantique → identifiant de
 * sprite → région d'atlas » par l'intermédiaire d'un `SpriteProvider` interchangeable.
 */

export type SpriteFamily = 'person' | 'force' | 'rescue' | 'vehicle' | 'decor' | 'poi';

/** Niveaux de détail : T0 agrégé, T1 points, T2 silhouette simple, T3 détaillé. */
export type LodTier = 0 | 1 | 2 | 3;

/** Nombre d'orientations pré-rendues (1 = pas d'orientation : le rendu fait pivoter le canvas). */
export type OrientationCount = 1 | 8 | 16 | 32;

export interface SpriteDef {
  /** Identifiant stable, ex. `person`, `force.crs.shield`, `vehicle.fourgon_crs`, `decor.bin`. */
  id: string;
  family: SpriteFamily;
  label: string;
  /** Taille réelle en mètres : `wM` selon l'axe avant-arrière (+x au repos), `hM` selon l'axe latéral. */
  wM: number;
  hM: number;
  /** Point d'ancrage (fractions de la boîte, 0..1) ; (0.5, 0.5) = centre. */
  anchor: { x: number; y: number };
  orientations: OrientationCount;
  /** Animations disponibles (nom → nombre d'images). `idle` toujours présent. */
  animations: Record<string, number>;
  /** Nombre de variantes (teinte / accessoire). */
  variants: number;
  /** Rayon de sélection logique en mètres : indépendant des pixels du sprite (un sprite remplacé garde la même zone). */
  hitRadiusM: number;
  /** Taille minimale à l'écran (px) pour rester lisible quand le zoom est éloigné. */
  minPx: number;
  /** Image externe facultative : le sprite est alors fourni par un `ImageSpriteProvider`. */
  image?: { file: string; cellPx: number };
}

export interface SpriteManifest {
  /** Version du format du manifeste. */
  version: 1;
  name: string;
  sprites: SpriteDef[];
}

/** Région d'un atlas à dessiner : image source, rectangle source, taille logique et ancrage (pixels). */
export interface SpriteRegion {
  image: CanvasImageSource;
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  /** Taille logique (px CSS) de la région au `ppm` demandé. */
  w: number;
  h: number;
  /** Décalage du coin haut-gauche par rapport au point d'ancrage (px CSS, <= 0). */
  ox: number;
  oy: number;
}

export interface SpriteQuery {
  id: string;
  variant: number;
  /** Indice d'orientation (0..orientations-1), sens trigonométrique depuis +x. */
  orientation: number;
  frame: number;
  tier: LodTier;
  /** Pixels par mètre de la vue courante. */
  ppm: number;
  /**
   * Sprite très nombreux (foule) : si absent du cache, `get` renvoie `null` et le dessin est mis en file ; il est
   * réalisé par `flush()` en fin d'image. Évite d'alterner dessin dans l'atlas et copie vers l'écran (très coûteux).
   */
  deferred?: boolean;
}

/** Fournisseur de sprites : procédural (provisoire), images, ou mélange sprite par sprite. */
export interface SpriteProvider {
  readonly name: string;
  has(id: string): boolean;
  /** Région d'atlas, ou `null` si le sprite n'est pas (encore) disponible. */
  get(q: SpriteQuery): SpriteRegion | null;
  /** Densité de pixels de l'écran (les sprites sont pré-rendus à cette résolution). */
  setDevicePixelRatio?(dpr: number): void;
  /** Réalise les sprites mis en file par des requêtes `deferred` (appelé en fin d'image). Renvoie le nombre de sprites dessinés. */
  flush?(maxRenders?: number): number;
}

/** Style d'un marqueur d'interface (primitive vectorielle, indépendante des sprites). */
export interface MarkerStyle {
  color: string;
  width: number;
  dash: number[] | null;
}

/** Effet visuel (phase 5) : le moteur ne fournit que l'état (ex. « incendie actif, intensité »). */
export interface EffectSpec {
  id: string;
  durationMs: number;
  loop: boolean;
  blend: 'normal' | 'add';
}
