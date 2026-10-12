import { hash32, unit } from './rng';
import type { SimParams } from './params';
import type { Cause, CrowdGroup, DecorItem, DecorKind, HistoryEntry, Id, Incident, IncidentKind, IncidentState, IncidentStats, LogEvent, UnitEntity } from './types';
import type { World } from './world';

export interface IncidentDeps {
  world: World;
  params: SimParams;
  seed: number;
  groups: CrowdGroup[];
  units: UnitEntity[];
  timeMs: () => number;
  tick: () => number;
  log: (level: LogEvent['level'], code: string, text: string, why: Cause, subject?: LogEvent['subject'], data?: LogEvent['data']) => void;
}

const KIND_LABEL: Record<IncidentKind, string> = {
  bin_fire: 'Feu de poubelle',
  fire: 'Incendie',
  furniture_damage: 'Dégradation de mobilier',
  window_break: 'Vitrine brisée',
};

const DECOR_LABEL: Record<DecorKind, string> = {
  bin: 'poubelle',
  bench: 'banc',
  barrier: 'barrière',
  cone: 'cône',
  container: 'conteneur',
  shopfront: 'vitrine',
  bus_shelter: 'abribus (fictif)',
  debris: 'débris',
};

/** Pondération du risque d'un objet selon sa nature (0 = jamais ciblé spontanément). */
const TARGET_WEIGHT: Record<DecorKind, number> = { bin: 1, shopfront: 0.6, container: 0.5, bench: 0.5, bus_shelter: 0.4, barrier: 0, cone: 0, debris: 0 };

/** Objets susceptibles de s'enflammer par propagation, et gravité minimale de l'incendie voisin pour cela. */
const FLAMMABLE: Partial<Record<DecorKind, number>> = { bin: 1, container: 1, bench: 2, shopfront: 3, bus_shelter: 3 };

export const incidentKindFor = (k: DecorKind): IncidentKind | null => {
  switch (k) {
    case 'bin':
      return 'bin_fire';
    case 'container':
      return 'fire';
    case 'shopfront':
      return 'window_break';
    case 'bench':
    case 'bus_shelter':
    case 'barrier':
      return 'furniture_damage';
    default:
      return null;
  }
};

const isFire = (k: IncidentKind) => k === 'bin_fire' || k === 'fire';
const hashStr = (s: string): number => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

interface Sample {
  x: number;
  y: number;
}

/**
 * Incidents (cahier §8.4, §16.4) : machine à états `emerging → active → escalating / contained → lingering → resolved`.
 * Ils naissent de règles explicites (tension d'un groupe au contact d'un objet à portée) ou d'événements de scénario,
 * visent UNIQUEMENT des objets de scénario synthétiques (jamais un établissement réel), laissent des conséquences
 * persistantes (états du décor et des lieux, coûts fictifs) et chaînent leurs causes. Aucune donnée de démonstration :
 * tout est lu depuis l'état du moteur.
 */
export class IncidentSystem {
  readonly incidents: Incident[] = [];
  private counter = 0;
  /** Échantillons de positions de chaque groupe à la dernière évaluation (rayon d'effet, portée). */
  private samples = new Map<Id, Sample[]>();

  constructor(private readonly d: IncidentDeps) {}

  get(id: Id): Incident | undefined {
    return this.incidents.find((i) => i.id === id);
  }

  active(): Incident[] {
    return this.incidents.filter((i) => i.state !== 'resolved');
  }

  stats(): IncidentStats {
    const byKind: Record<IncidentKind, number> = { bin_fire: 0, fire: 0, furniture_damage: 0, window_break: 0 };
    let active = 0;
    let resolved = 0;
    let fires = 0;
    let cost = 0;
    for (const i of this.incidents) {
      byKind[i.kind]++;
      if (i.state === 'resolved') resolved++;
      else active++;
      if (isFire(i.kind)) fires++;
      cost += i.costEur;
    }
    let damagedPois = 0;
    for (const p of this.d.world.pois) if (p.damage > 0) damagedPois++;
    let damagedDecor = 0;
    for (const x of this.d.world.decor) if (x.state !== 'intact') damagedDecor++;
    return { total: this.incidents.length, active, resolved, fires, byKind, costEur: Math.round(cost), damagedPois, damagedDecor };
  }

  // ------------------------------------------------------------------ évaluation périodique

  step(): void {
    const p = this.d.params;
    if (this.d.tick() % p.incidents.everyTicks !== 0) return;
    const dtS = (p.incidents.everyTicks * p.tickMs) / 1000;
    this.sampleGroups();
    this.relaxTension(dtS);
    this.triggerFromCrowds(dtS);
    for (const inc of this.incidents) if (inc.state !== 'resolved') this.update(inc, dtS);
  }

  private sampleGroups(): void {
    this.samples.clear();
    for (const g of this.d.groups) {
      if (g.phase === 'dispersed') continue;
      const m = g.members;
      const lo = Math.max(m.activeStart, g.entryStart);
      const hi = Math.min(m.n, g.exitStart);
      const n = hi - lo;
      if (n <= 0 || g.level === 0) continue;
      const step = Math.max(1, Math.floor(n / 80));
      const out: Sample[] = [];
      for (let i = lo; i < hi; i += step) out.push({ x: m.x[i] as number, y: m.y[i] as number });
      this.samples.set(g.id, out);
    }
  }

  private relaxTension(dtS: number): void {
    const decay = this.d.params.incidents.tensionDecayPerS * dtS;
    for (const g of this.d.groups) if (g.tension > g.baseTension) g.tension = Math.max(g.baseTension, g.tension - decay);
  }

  private unitNear(x: number, y: number): boolean {
    const r = this.d.params.incidents.unitWatchM;
    for (const u of this.d.units) if (Math.hypot(u.x - x, u.y - y) <= r) return true;
    return false;
  }

  private triggerFromCrowds(dtS: number): void {
    const ip = this.d.params.incidents;
    const now = this.d.timeMs();
    let activeCount = this.active().length;
    for (const g of this.d.groups) {
      if (activeCount >= ip.maxActive) return;
      if (g.tension < ip.triggerTension || now - g.lastIncidentMs < ip.cooldownS * 1000) continue;
      const pts = this.samples.get(g.id);
      if (!pts) continue;
      const size = g.members.n - g.members.activeStart;
      const factor = ((g.tension - ip.triggerTension) / Math.max(1, 100 - ip.triggerTension)) * Math.min(1, Math.sqrt(size / ip.crowdFullSize));
      if (factor <= 0) continue;
      const seen = new Map<Id, DecorItem>();
      for (const s of pts) this.d.world.near(s.x, s.y, ip.reachM, (it) => seen.set(it.id, it));
      const candidates = [...seen.values()].filter((it) => it.state === 'intact' && !it.incidentId && TARGET_WEIGHT[it.kind] > 0 && it.source === 'synthetic').sort((a, b) => (a.id < b.id ? -1 : 1));
      for (const it of candidates) {
        const prob = ip.baseRatePerS * dtS * factor * TARGET_WEIGHT[it.kind] * (this.unitNear(it.x, it.y) ? ip.unitDeterrence : 1);
        if (unit(hash32(this.d.seed, hash32(this.d.tick(), hashStr(it.id))), 7) >= prob) continue;
        const kind = incidentKindFor(it.kind);
        if (!kind) continue;
        const cause: Cause = { kind: 'rule', refId: g.id, note: `tension ${Math.round(g.tension)} du groupe « ${g.label} » (${size} personnes) au contact de ${DECOR_LABEL[it.kind]} (objet de scénario fictif)` };
        if (this.create(kind, it, cause, { groupId: g.id })) {
          g.lastIncidentMs = now;
          activeCount++;
          break;
        }
      }
    }
  }

  // ------------------------------------------------------------------ création

  /** Incident déclenché par le scénario sur l'objet le plus proche de (x, y) (rayon 40 m) compatible avec `kind`. */
  spawnNear(kind: IncidentKind, x: number, y: number, cause: Cause): Incident | null {
    let best: DecorItem | null = null;
    let bestD = 40;
    this.d.world.near(x, y, 40, (it) => {
      if (it.state !== 'intact' || it.incidentId || it.source !== 'synthetic' || TARGET_WEIGHT[it.kind] <= 0) return;
      const k = incidentKindFor(it.kind);
      const ok = kind === k || (kind === 'fire' && (it.kind === 'shopfront' || it.kind === 'container' || it.kind === 'bus_shelter' || it.kind === 'bench'));
      if (!ok) return;
      const d = Math.hypot(it.x - x, it.y - y);
      if (d < bestD) {
        best = it;
        bestD = d;
      }
    });
    if (!best) return null;
    return this.create(kind, best, cause, {});
  }

  private create(kind: IncidentKind, it: DecorItem, cause: Cause, o: { groupId?: Id; parent?: Incident }): Incident | null {
    const ip = this.d.params.incidents;
    const now = this.d.timeMs();
    const poi = it.poiId ? this.d.world.poi(it.poiId) : undefined;
    const inc: Incident = {
      id: `I-${String(++this.counter).padStart(4, '0')}`,
      kind,
      x: it.x,
      y: it.y,
      severity: kind === 'fire' ? 2 : 1,
      state: 'emerging',
      startedAtMs: now,
      durationMs: ip.emergingS * 1000,
      stateSinceMs: now,
      endedAtMs: null,
      targetDecorId: it.id,
      poiId: it.poiId,
      label: `${KIND_LABEL[kind]} — ${DECOR_LABEL[it.kind]} (scénario fictif)`,
      cause,
      parentId: o.parent?.id,
      childIds: [],
      groupId: o.groupId,
      unattendedS: 0,
      attendedS: 0,
      costEur: 0,
      history: [],
    };
    this.incidents.push(inc);
    it.incidentId = inc.id;
    poi?.incidentIds.push(inc.id);
    o.parent?.childIds.push(inc.id);
    this.record(inc, 'incident.created', `${inc.label} : naissant.`, cause, 'warn');
    this.raiseTension(inc, ip.tensionPerSeverity * inc.severity);
    return inc;
  }

  private record(inc: Incident, code: string, text: string, why: Cause, level: LogEvent['level'] = 'info', data?: LogEvent['data']): void {
    const h: HistoryEntry = { tick: this.d.tick(), simTimeMs: this.d.timeMs(), code, text, why };
    inc.history.push(h);
    this.d.log(level, code, text, why, { type: 'incident', id: inc.id }, { ...data, severity: inc.severity, state: inc.state });
  }

  private setState(inc: Incident, st: IncidentState, durationMs: number): void {
    inc.state = st;
    inc.stateSinceMs = this.d.timeMs();
    inc.durationMs = durationMs;
  }

  /** La tension des groupes proches monte (effet d'entraînement), et ils sont marqués « affectés ». */
  private raiseTension(inc: Incident, amount: number): void {
    const ip = this.d.params.incidents;
    const now = this.d.timeMs();
    for (const g of this.d.groups) {
      const pts = this.samples.get(g.id) ?? this.liveSamples(g);
      if (!pts.some((s) => Math.hypot(s.x - inc.x, s.y - inc.y) <= ip.affectRadiusM)) continue;
      g.tension = Math.min(100, g.tension + amount);
      g.affectedUntilMs = Math.max(g.affectedUntilMs, now + 5000);
    }
  }

  private liveSamples(g: CrowdGroup): Sample[] {
    const m = g.members;
    const lo = Math.max(m.activeStart, g.entryStart);
    const hi = Math.min(m.n, g.exitStart);
    const out: Sample[] = [];
    const step = Math.max(1, Math.floor((hi - lo) / 80));
    for (let i = lo; i < hi; i += step) out.push({ x: m.x[i] as number, y: m.y[i] as number });
    return out;
  }

  // ------------------------------------------------------------------ évolution

  private update(inc: Incident, dtS: number): void {
    const ip = this.d.params.incidents;
    const w = this.d.world;
    const now = this.d.timeMs();
    const it = w.item(inc.targetDecorId);
    const poi = inc.poiId ? w.poi(inc.poiId) : undefined;
    const ends = inc.stateSinceMs + inc.durationMs;

    if (inc.state === 'emerging') {
      if (now < ends) return;
      this.setState(inc, 'active', (isFire(inc.kind) ? (inc.kind === 'bin_fire' ? ip.binFireS : ip.fireS) : ip.damageActS) * 1000);
      if (it) {
        if (isFire(inc.kind)) it.state = 'burning';
        else it.state = it.kind === 'barrier' ? 'destroyed' : 'damaged';
      }
      if (poi) {
        if (isFire(inc.kind)) poi.state = 'burning';
        else {
          poi.damage = Math.min(100, poi.damage + 25);
          if (poi.state === 'intact') poi.state = 'damaged';
        }
      }
      if (inc.kind === 'window_break') inc.costEur += ip.costWindowEur;
      if (inc.kind === 'furniture_damage') inc.costEur += it?.kind === 'bus_shelter' ? ip.costShelterEur : ip.costBenchEur;
      this.record(inc, 'incident.active', `${inc.label} : ${isFire(inc.kind) ? 'le feu a pris' : 'dégâts constatés'}.`, { kind: 'transition', refId: inc.id, note: 'fin de la phase naissante' }, 'alert');
      this.raiseTension(inc, ip.tensionPerSeverity);
      return;
    }

    if (inc.state === 'lingering') {
      if (now < ends) return;
      inc.endedAtMs = now;
      this.setState(inc, 'resolved', 0);
      if (it && it.incidentId === inc.id) it.incidentId = undefined;
      if (poi && poi.state === 'burning') poi.state = poi.damage >= 100 ? 'destroyed' : 'damaged';
      this.record(inc, 'incident.resolved', `${inc.label} : terminé, les dégâts restent (fumée dissipée).`, { kind: 'transition', refId: inc.id, note: 'fin de la persistance (fumée, ruines, verre brisé)' });
      return;
    }

    // active / escalating / contained
    if (isFire(inc.kind)) {
      if (this.unitNear(inc.x, inc.y)) {
        inc.attendedS += dtS;
        inc.unattendedS = 0;
      } else {
        inc.unattendedS += dtS;
        inc.attendedS = 0;
      }
      if (inc.state !== 'contained' && inc.attendedS >= ip.containAfterS) {
        const remaining = Math.max(0, ends - now);
        this.setState(inc, 'contained', remaining * 0.5);
        this.record(inc, 'incident.contained', `${inc.label} : périmètre tenu par une unité, le feu ne se propage plus.`, { kind: 'rule', refId: inc.id, note: `une unité à moins de ${ip.unitWatchM} m depuis ${Math.round(inc.attendedS)} s` });
        return;
      }
      if (inc.state !== 'contained') {
        if (inc.unattendedS >= ip.escalateEveryS && inc.severity < 5) {
          inc.severity = (inc.severity + 1) as Incident['severity'];
          inc.unattendedS = 0;
          this.setState(inc, 'escalating', Math.max(0, ends - now) + ip.escalateEveryS * 1000 * 0.5);
          this.record(inc, 'incident.escalated', `${inc.label} : s'aggrave (gravité ${inc.severity}) faute de surveillance.`, { kind: 'rule', refId: inc.id, note: `aucune unité à proximité depuis ${ip.escalateEveryS} s` }, 'alert');
          this.raiseTension(inc, ip.tensionPerSeverity * 0.5);
        }
        this.spread(inc, dtS);
      }
      // dégâts cumulés sur un lieu (fictif) en feu
      if (poi && inc.state !== 'contained') {
        poi.damage = Math.min(100, poi.damage + inc.severity * 0.12 * dtS);
        if (poi.damage >= 100 && poi.state !== 'destroyed') {
          poi.state = 'destroyed';
          inc.costEur += ip.costShopDestroyedEur;
          if (it) it.state = 'destroyed';
          this.record(inc, 'incident.destroyed', `${poi.name ?? 'Commerce fictif'} : détruit par l'incendie (objet fictif).`, { kind: 'rule', refId: inc.id, note: 'dégâts cumulés au maximum' }, 'alert');
        }
      }
    }
    if (now >= inc.stateSinceMs + inc.durationMs) {
      if (isFire(inc.kind)) {
        if (it && it.state !== 'destroyed') it.state = 'burnt';
        if (it?.kind === 'bin') inc.costEur += ip.costBinEur;
        if (it?.kind === 'container') inc.costEur += ip.costContainerEur;
      }
      this.setState(inc, 'lingering', ip.lingerS * 1000);
      this.record(inc, 'incident.ended', `${inc.label} : ${isFire(inc.kind) ? 'le feu s’éteint de lui-même' : 'fin de l’acte'}, persistance (fumée, ruines).`, { kind: 'transition', refId: inc.id, note: 'durée naturelle écoulée' });
    }
  }

  private spread(inc: Incident, dtS: number): void {
    const ip = this.d.params.incidents;
    if (this.active().length >= ip.maxActive) return;
    const p = ip.spreadRatePerSeverity * inc.severity * dtS;
    const cands: DecorItem[] = [];
    this.d.world.near(inc.x, inc.y, ip.spreadReachM, (it) => {
      const minSev = FLAMMABLE[it.kind];
      if (minSev === undefined || inc.severity < minSev || it.state !== 'intact' || it.incidentId || it.source !== 'synthetic') return;
      cands.push(it);
    });
    cands.sort((a, b) => (a.id < b.id ? -1 : 1));
    for (const it of cands) {
      if (unit(hash32(this.d.seed, hash32(this.d.tick(), hashStr(it.id) ^ 0x5bd1e995)), 9) >= p) continue;
      const kind: IncidentKind = it.kind === 'bin' ? 'bin_fire' : 'fire';
      const cause: Cause = { kind: 'rule', refId: inc.id, note: `propagation de « ${inc.label} » (gravité ${inc.severity}) à ${DECOR_LABEL[it.kind]} voisin` };
      const child = this.create(kind, it, cause, { parent: inc, groupId: inc.groupId });
      if (child) {
        this.record(inc, 'incident.spread', `${inc.label} : le feu gagne ${DECOR_LABEL[it.kind]} voisin.`, cause, 'alert');
        return;
      }
    }
  }
}

export const INCIDENT_LABEL = KIND_LABEL;
export const DECOR_KIND_LABEL = DECOR_LABEL;
