import type { GameController } from '../../game/controller';
import type { CrowdGroup, DecorKind, DecorState, ForceKind, IncidentKind, IncidentState, Loadout, UnitStatus, VehicleKind } from '../../engine/types';
import { forceSpriteId, PERSON_COLORS, PERSON_VARIANTS, vehicleSpriteId } from './manifest';

/**
 * Instantané de rendu : données SÉMANTIQUES + positions interpolées + graines d'apparence. C'est la seule frontière
 * entre le moteur et le rendu. Aucune coordonnée écran, aucun nom de sprite imposé au moteur (le choix du sprite est
 * fait ici, par correspondance sémantique → identifiant, remplaçable sans toucher au moteur).
 */
export interface RenderableMover {
  id: string;
  x: number;
  y: number;
  /** Cap en radians (sens trigonométrique depuis +x), interpolé. */
  heading: number;
  status: UnitStatus;
  speedMps: number;
  callsign: string;
  sprite: string;
}

export interface RenderableUnit extends RenderableMover {
  kind: 'unit';
  force: ForceKind;
  loadout: Loadout;
  num: string;
  headcount: number;
}

export interface RenderableVehicle extends RenderableMover {
  kind: 'vehicle';
  vehicle: VehicleKind;
  emergency: boolean;
  crew: number;
}

export interface RenderablePose {
  x: number;
  y: number;
  /** Direction de déplacement (rad) ou NaN à l'arrêt. */
  dir: number;
  variant: number;
  walking: boolean;
  seed: number;
}

export interface RenderableIncident {
  id: string;
  kind: IncidentKind;
  state: IncidentState;
  severity: number;
  x: number;
  y: number;
  label: string;
}

/**
 * Sprite d'un objet de décor selon sa nature et son état (donnée sémantique → identifiant). Remplaçable sans toucher
 * au moteur : seul ce tableau de correspondance connaît les noms de sprites.
 */
export function decorSpriteFor(kind: DecorKind, state: DecorState): string {
  const burnt = state === 'burnt' || state === 'destroyed';
  switch (kind) {
    case 'bin':
      return state === 'burning' ? 'decor.bin_fire' : burnt ? 'decor.debris' : 'decor.bin';
    case 'container':
      return state === 'burning' ? 'decor.container_fire' : state === 'destroyed' ? 'decor.rubble' : burnt ? 'decor.debris' : 'decor.container';
    case 'shopfront':
      return burnt ? 'decor.rubble' : state === 'damaged' || state === 'burning' ? 'decor.shopfront_broken' : 'decor.shopfront';
    case 'bus_shelter':
      return burnt ? 'decor.debris' : state === 'damaged' || state === 'burning' ? 'decor.bus_shelter_broken' : 'decor.bus_shelter';
    case 'bench':
      return burnt || state === 'damaged' ? 'decor.debris' : 'decor.bench';
    case 'barrier':
      return state === 'destroyed' ? 'decor.debris' : 'decor.barrier';
    case 'cone':
      return 'decor.cone';
    default:
      return 'decor.debris';
  }
}

export interface RenderableSnapshot {
  tick: number;
  alpha: number;
  /** Temps de jeu en secondes (animations indépendantes de la simulation). */
  timeSec: number;
  units: RenderableUnit[];
  vehicles: RenderableVehicle[];
  incidents: RenderableIncident[];
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export function buildSnapshot(c: GameController, alpha: number, timeSec: number): RenderableSnapshot {
  const sim = c.sim;
  const units: RenderableUnit[] = sim.units.map((u) => ({
    kind: 'unit',
    id: u.id,
    x: u.px + (u.x - u.px) * alpha,
    y: u.py + (u.y - u.py) * alpha,
    heading: u.prevHeading + wrap(u.heading - u.prevHeading) * alpha,
    status: u.status,
    speedMps: u.speedMps,
    callsign: u.callsign,
    sprite: forceSpriteId(u.force, u.loadout),
    force: u.force,
    loadout: u.loadout,
    num: u.num,
    headcount: u.headcount,
  }));
  const vehicles: RenderableVehicle[] = sim.vehicles.map((v) => ({
    kind: 'vehicle',
    id: v.id,
    x: v.px + (v.x - v.px) * alpha,
    y: v.py + (v.y - v.py) * alpha,
    heading: v.prevHeading + wrap(v.heading - v.prevHeading) * alpha,
    status: v.status,
    speedMps: v.speedMps,
    callsign: v.callsign,
    sprite: vehicleSpriteId(v.vehicle),
    vehicle: v.vehicle,
    emergency: v.emergency,
    crew: v.crew,
  }));
  const incidents: RenderableIncident[] = sim.incidents.incidents.filter((i) => i.state !== 'resolved').map((i) => ({ id: i.id, kind: i.kind, state: i.state, severity: i.severity, x: i.x, y: i.y, label: i.label }));
  return { tick: sim.tick, alpha, timeSec, units, vehicles, incidents };
}

/**
 * Apparence stable d'un individu à partir de sa graine : couleur de vêtement (8) × accessoire (6, rares).
 * La même graine donne toujours la même apparence (aucun scintillement), quel que soit le zoom.
 */
export function appearanceOf(seed: number): number {
  const color = seed & 7;
  const r = (seed >>> 3) & 15;
  const acc = r < 9 ? 0 : r < 11 ? 1 : r < 12 ? 2 : r < 14 ? 3 : r < 15 ? 4 : 5;
  return acc * PERSON_COLORS.length + color;
}

/** Orientation en secteurs : indice 0..count-1 (sens trigonométrique depuis +x). */
export function orientationIndex(angle: number, count: number): number {
  const step = (Math.PI * 2) / count;
  return ((Math.round(angle / step) % count) + count) % count;
}

/**
 * Pose d'un individu (sans allocation : écrit dans `out`). Direction = déplacement entre deux ticks ; à l'arrêt,
 * orientation stable tirée de la graine.
 */
export function crowdPose(g: CrowdGroup, i: number, alpha: number, out: RenderablePose): void {
  const m = g.members;
  const px = m.px[i] as number;
  const py = m.py[i] as number;
  const x = m.x[i] as number;
  const y = m.y[i] as number;
  out.x = px + (x - px) * alpha;
  out.y = py + (y - py) * alpha;
  const dx = x - px;
  const dy = y - py;
  const seed = m.seed[i] as number;
  out.seed = seed;
  out.variant = appearanceOf(seed);
  out.walking = dx * dx + dy * dy > 0.0004; // > 0,02 m par tick (0,2 m/s)
  out.dir = out.walking ? Math.atan2(dy, dx) : (((seed >>> 8) & 255) / 256) * Math.PI * 2;
}

export const PERSON_VARIANT_COUNT = PERSON_VARIANTS;
