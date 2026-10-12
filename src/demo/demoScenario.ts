import type { Vec2 } from '../geo/mercator';
import { mulberry32 } from '../state/rng';
import type {
  Banner,
  City,
  CrowdGroup,
  ForceUnit,
  GameZone,
  Id,
  Incident,
  IncidentKind,
  LogEntry,
  StreetSegment,
  Vehicle,
} from '../state/types';

/**
 * Données de DÉMONSTRATION de la phase 2 : elles servent uniquement à valider le rendu, les
 * interactions et le calage sur la carte. Aucune simulation (ni comportement, ni conséquence)
 * n'est calculée ici ; le moteur arrive en phase 3.
 */
export const ZONE_LEVELS: readonly GameZone[] = [
  { halfWidth: 380, halfHeight: 290 },
  { halfWidth: 600, halfHeight: 450 },
  { halfWidth: 900, halfHeight: 680 },
  { halfWidth: 1400, halfHeight: 1050 },
];

export interface DemoState {
  cityId: string;
  units: ForceUnit[];
  vehicles: Vehicle[];
  groups: CrowdGroup[];
  incidents: Incident[];
  log: LogEntry[];
  banners: Banner[];
  eventCounter: number;
  nextLogId: number;
}

export interface DemoOptions {
  /** Groupes de foule supplémentaires (banc d'essai de performance uniquement). */
  extraGroups?: number;
}

export function makeDemo(city: City, nowMs: number, opts: DemoOptions = {}): DemoState {
  const crs = (i: number, pos: Vec2, heading: number, headcount: number, status: string): ForceUnit => ({
    id: `U-${i}`,
    kind: 'crs',
    callsign: `CRS-J ${String(i).padStart(2, '0')}/${(i % 3) + 1}`,
    num: String(i).padStart(2, '0'),
    pos,
    heading,
    headcount,
    fatigue: 0.05 * i,
    status,
  });
  const pol = (i: number, pos: Vec2, heading: number): ForceUnit => ({
    id: `U-${i}`,
    kind: 'police',
    callsign: `POL-J ${i}`,
    num: String(i),
    pos,
    heading,
    headcount: 8,
    fatigue: 0.1,
    status: 'En position',
  });
  const units: ForceUnit[] = [
    crs(7, { x: 55, y: -75 }, 0, 28, 'En position'),
    crs(8, { x: 62, y: -20 }, 0, 26, 'En position'),
    crs(9, { x: 58, y: 40 }, 0, 30, 'En position'),
    crs(12, { x: -150, y: 70 }, -Math.PI / 2, 24, 'En réserve'),
    crs(14, { x: 150, y: -150 }, Math.PI, 22, 'En réserve'),
    pol(21, { x: -95, y: 110 }, 0),
    pol(22, { x: 30, y: 135 }, 0),
    pol(23, { x: 215, y: -10 }, Math.PI),
  ];
  const vehicle = (id: Id, kind: Vehicle['kind'], callsign: string, pos: Vec2, heading: number, crew: number, status: string): Vehicle => ({
    id,
    kind,
    callsign,
    pos,
    heading,
    crew,
    status,
  });
  const vehicles: Vehicle[] = [
    vehicle('V-1', 'van', 'Transport CRS-J 07', { x: 18, y: -110 }, 0.1, 8, 'Stationné'),
    vehicle('V-2', 'van', 'Transport CRS-J 09', { x: 20, y: 80 }, -0.1, 8, 'Stationné'),
    vehicle('V-3', 'police_car', 'Véhicule POL 21', { x: -120, y: 125 }, 0.4, 3, 'Stationné'),
    vehicle('V-4', 'water_cannon', 'Lanceur d’eau LE-1', { x: -30, y: -150 }, 0, 3, 'En réserve'),
    vehicle('V-5', 'ambulance', 'Secours AMB-1', { x: -210, y: -30 }, 1.57, 2, 'Disponible'),
    vehicle('V-6', 'fire_truck', 'Pompiers SP-1', { x: 235, y: -105 }, 3.14, 4, 'Disponible'),
  ];
  const groups: CrowdGroup[] = [
    { id: 'G-1', label: 'Cortège principal', pos: { x: -45, y: 15 }, size: 260, tension: 28, disposition: 'peaceful', seed: 11 },
    { id: 'G-2', label: 'Groupe agité', pos: { x: 125, y: -75 }, size: 140, tension: 58, disposition: 'restless', seed: 23 },
    { id: 'G-3', label: 'Groupe violent', pos: { x: 190, y: 85 }, size: 70, tension: 82, disposition: 'hostile', seed: 37 },
    { id: 'G-4', label: 'Riverains / passants', pos: { x: -175, y: -105 }, size: 40, tension: 10, disposition: 'peaceful', seed: 41 },
  ];
  for (let k = 0; k < (opts.extraGroups ?? 0); k++) {
    const a = k * 2.399963;
    const r = 60 + 14 * Math.sqrt(k) * 9;
    groups.push({
      id: `G-x${k}`,
      label: `Groupe test ${k + 1}`,
      pos: { x: Math.cos(a) * r, y: Math.sin(a) * r * 0.8 },
      size: 300,
      tension: (k * 17) % 100,
      disposition: 'restless',
      seed: 100 + k,
    });
  }
  const incident = (id: Id, kind: IncidentKind, pos: Vec2, severity: Incident['severity'], label: string): Incident => ({
    id,
    kind,
    pos,
    severity,
    startedAtMs: nowMs,
    label,
  });
  const incidents: Incident[] = [
    incident('I-1', 'bin_fire', { x: 150, y: -40 }, 2, 'Feu de poubelle'),
    incident('I-2', 'vandalism', { x: 100, y: 125 }, 2, 'Vitrine brisée'),
    incident('I-3', 'projectiles', { x: 142, y: 28 }, 3, 'Jets de projectiles'),
    incident('I-4', 'casualty', { x: -22, y: -62 }, 1, 'Personne blessée (légère)'),
  ];
  const state: DemoState = {
    cityId: city.id,
    units,
    vehicles,
    groups,
    incidents,
    log: [],
    banners: [],
    eventCounter: 0,
    nextLogId: 1,
  };
  return pushLog(state, nowMs, 'info', `Démonstration chargée : ${city.name}. Données fictives.`);
}

export function pushLog(s: DemoState, atMs: number, level: LogEntry['level'], text: string, banner = false): DemoState {
  const entry: LogEntry = { id: s.nextLogId, atMs, level, text };
  const banners = banner ? [...s.banners, { id: entry.id, level, text, untilMs: atMs + 6500 }].slice(-3) : s.banners;
  return { ...s, log: [entry, ...s.log].slice(0, 200), banners, nextLogId: s.nextLogId + 1 };
}

export function pruneBanners(s: DemoState, nowMs: number): DemoState {
  const kept = s.banners.filter((b) => b.untilMs > nowMs);
  return kept.length === s.banners.length ? s : { ...s, banners: kept };
}

const EVENT_TEMPLATES: Array<{ kind: IncidentKind; severity: Incident['severity']; level: LogEntry['level']; text: string; label: string }> = [
  { kind: 'bin_fire', severity: 2, level: 'warn', text: 'Départ de feu signalé : poubelle en feu', label: 'Feu de poubelle' },
  { kind: 'vandalism', severity: 2, level: 'warn', text: 'Dégradation signalée : vitrine brisée', label: 'Vitrine brisée' },
  { kind: 'projectiles', severity: 3, level: 'alert', text: 'Jets de projectiles signalés sur la ligne', label: 'Jets de projectiles' },
  { kind: 'casualty', severity: 2, level: 'alert', text: 'Personne blessée signalée : secours demandés', label: 'Personne blessée' },
];

/** Ajoute un incident de démonstration (sans conséquence simulée) près d'un groupe, de façon déterministe. */
export function applyDemoEvent(s: DemoState, nowMs: number, zone: GameZone): DemoState {
  const rng = mulberry32(0xc0ffee + s.eventCounter * 7919);
  const tpl = EVENT_TEMPLATES[s.eventCounter % EVENT_TEMPLATES.length] as (typeof EVENT_TEMPLATES)[number];
  const g = s.groups[Math.floor(rng() * s.groups.length)] as CrowdGroup;
  const clamp = (v: number, lim: number) => Math.max(-lim + 20, Math.min(lim - 20, v));
  const pos = {
    x: clamp(g.pos.x + (rng() - 0.5) * 90, zone.halfWidth),
    y: clamp(g.pos.y + (rng() - 0.5) * 90, zone.halfHeight),
  };
  const incident: Incident = {
    id: `I-${s.incidents.length + 1 + s.eventCounter}`,
    kind: tpl.kind,
    pos,
    severity: tpl.severity,
    startedAtMs: nowMs,
    label: tpl.label,
  };
  const next = { ...s, incidents: [...s.incidents, incident], eventCounter: s.eventCounter + 1 };
  return pushLog(next, nowMs, tpl.level, tpl.text, true);
}

export function groupRadius(g: CrowdGroup): number {
  return 3 + 1.15 * Math.sqrt(g.size);
}

function distToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Un segment est « bloqué » si un groupe d'au moins 60 personnes le recouvre (règle de démonstration). */
export function blockedSegmentIds(segments: StreetSegment[], groups: CrowdGroup[]): Set<Id> {
  const out = new Set<Id>();
  for (const seg of segments) {
    for (const g of groups) {
      if (g.size < 60) continue;
      const r = groupRadius(g) * 0.8;
      for (let i = 0; i + 1 < seg.points.length; i++) {
        if (distToSegment(g.pos, seg.points[i] as Vec2, seg.points[i + 1] as Vec2) <= r) {
          out.add(seg.id);
          break;
        }
      }
      if (out.has(seg.id)) break;
    }
  }
  return out;
}

export interface DemoStats {
  headcountForces: number;
  headcountCrowd: number;
  vehicles: number;
  activeIncidents: number;
  tension: number;
  blocked: number;
  totalSegments: number;
}

export function computeStats(s: DemoState, segments: StreetSegment[], blocked: ReadonlySet<Id>): DemoStats {
  const crowd = s.groups.reduce((n, g) => n + g.size, 0);
  const tension = crowd === 0 ? 0 : s.groups.reduce((n, g) => n + g.tension * g.size, 0) / crowd;
  return {
    headcountForces: s.units.reduce((n, u) => n + u.headcount, 0),
    headcountCrowd: crowd,
    vehicles: s.vehicles.length,
    activeIncidents: s.incidents.length,
    tension: Math.round(tension),
    blocked: blocked.size,
    totalSegments: segments.length,
  };
}
