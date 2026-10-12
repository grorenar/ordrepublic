import { describe, expect, it } from 'vitest';
import { Sim, type ScenarioEvent } from '../../src/engine/sim';
import type { Cause, Incident } from '../../src/engine/types';
import { anchorAt, cityGraph, makeSim, PLAN } from './engineHelpers';

const calm: Cause = { kind: 'scenario_event', refId: 'test', note: 'incident déclenché par le test' };

/** Place une foule tendue sur un objet de décor donné (poubelle, conteneur, vitrine…). */
function crowdAt(sim: Sim, x: number, y: number, o: { size?: number; tension?: number } = {}) {
  const id = sim.createGroup({ label: 'Foule de test', kind: 'static', size: o.size ?? 900, origin: { x, y }, anchor: anchorAt({ x, y }, 'foule', 15), tension: o.tension ?? 90 }, PLAN);
  return sim.group(id)!;
}

const firstOf = (sim: Sim, kind: string) => sim.world.decor.find((d) => d.kind === kind && d.source === 'synthetic')!;

describe('monde : décor et lieux d’intérêt générés de façon déterministe', () => {
  it('même graine → même monde ; autre graine → autre monde', () => {
    const a = makeSim({ seed: 5 }).world;
    const b = makeSim({ seed: 5 }).world;
    const c = makeSim({ seed: 6 }).world;
    expect(a.decor.length).toBeGreaterThan(100);
    expect(a.decor.map((d) => `${d.kind}${d.x.toFixed(2)},${d.y.toFixed(2)}`)).toEqual(b.decor.map((d) => `${d.kind}${d.x.toFixed(2)},${d.y.toFixed(2)}`));
    expect(c.decor.map((d) => d.x.toFixed(1)).join()).not.toBe(a.decor.map((d) => d.x.toFixed(1)).join());
  });

  it('les objets ne sont jamais dans un bâtiment, hors vitrines posées contre les façades', () => {
    const sim = makeSim();
    let bad = 0;
    for (const d of sim.world.decor) if (d.kind !== 'shopfront' && sim.mask!.isBlocked(d.x, d.y)) bad++;
    expect(bad).toBe(0);
  });

  it('les commerces du jeu sont FICTIFS (nom explicite, source synthétique) et rattachés à une vitrine', () => {
    const sim = makeSim();
    const shops = sim.world.pois.filter((p) => p.kind === 'commerce');
    expect(shops.length).toBeGreaterThan(10);
    for (const p of shops) {
      expect(p.fictional).toBe(true);
      expect(p.source).toBe('synthetic');
      expect(p.name).toMatch(/fictif/);
      expect(p.decorIds.length).toBe(1);
      expect(sim.world.item(p.decorIds[0]!)?.poiId).toBe(p.id);
    }
  });

  it('places et parcs deviennent des lieux de rassemblement ; tout objet a une cause', () => {
    const sim = makeSim();
    expect(sim.world.pois.some((p) => p.kind === 'gathering')).toBe(true);
    for (const d of sim.world.decor) expect(d.cause.note.length).toBeGreaterThan(5);
  });

  it('plafond du nombre d’objets respecté', () => {
    const sim = makeSim({ params: { world: { maxDecor: 50 } } });
    expect(sim.world.decor.length).toBeLessThanOrEqual(50);
  });
});

describe('déclenchement par la foule (règle explicite, jamais gratuit)', () => {
  it('une foule tendue au contact d’un objet provoque un incident dont la cause cite le groupe et la tension', () => {
    const sim = makeSim({ seed: 3 });
    const bin = firstOf(sim, 'bin');
    const g = crowdAt(sim, bin.x, bin.y);
    sim.run(6000);
    expect(sim.incidents.incidents.length).toBeGreaterThan(0);
    const inc = sim.incidents.incidents[0] as Incident;
    expect(inc.cause.kind).toBe('rule');
    expect(inc.cause.refId).toBe(g.id);
    expect(inc.cause.note).toMatch(/tension/);
    expect(inc.cause.note).toMatch(/fictif/);
    expect(inc.label).toMatch(/scénario fictif/);
    expect(inc.groupId).toBe(g.id);
  });

  it('une foule calme (tension sous le seuil) ne provoque jamais rien', () => {
    const sim = makeSim({ seed: 3 });
    const bin = firstOf(sim, 'bin');
    crowdAt(sim, bin.x, bin.y, { tension: 30 });
    sim.run(8000);
    expect(sim.incidents.incidents.length).toBe(0);
  });

  it('seuls des objets de scénario SYNTHÉTIQUES sont ciblés : jamais un lieu ou un mobilier OSM', () => {
    const sim = makeSim({ seed: 4 });
    // un mobilier « OSM » au centre de la foule ne doit jamais être désigné
    const osmBin = sim.world.addDecor({ kind: 'bin', x: 0, y: 0, heading: 0, source: 'osm', cause: calm });
    crowdAt(sim, 0, 0);
    sim.run(6000);
    expect(osmBin.state).toBe('intact');
    expect(sim.incidents.incidents.every((i) => sim.world.item(i.targetDecorId)?.source === 'synthetic')).toBe(true);
  });

  it('la présence d’une unité dissuade : moins d’incidents avec une unité proche (même graine)', () => {
    const count = (withUnit: boolean) => {
      let n = 0;
      for (let seed = 1; seed <= 6; seed++) {
        const sim = makeSim({ seed, params: { incidents: { baseRatePerS: 0.01, cooldownS: 20, maxActive: 12 } } });
        const bin = firstOf(sim, 'bin');
        if (withUnit) sim.addUnit({ force: 'crs', callsign: 'CRS test', num: '01', headcount: 20, pos: { x: bin.x + 3, y: bin.y } }, PLAN);
        crowdAt(sim, bin.x, bin.y, { tension: 70 });
        sim.run(3000);
        n += sim.incidents.incidents.length;
      }
      return n;
    };
    const alone = count(false);
    const watched = count(true);
    expect(alone).toBeGreaterThan(0);
    expect(watched).toBeLessThan(alone);
  });

  it('plafond d’incidents actifs et délai de réarmement par groupe', () => {
    const sim = makeSim({ seed: 3, params: { incidents: { maxActive: 2, cooldownS: 10 } } });
    const bin = firstOf(sim, 'bin');
    crowdAt(sim, bin.x, bin.y, { size: 3000, tension: 100 });
    sim.run(4000);
    expect(sim.incidents.active().length).toBeLessThanOrEqual(2);
  });
});

describe('machine à états et conséquences persistantes', () => {
  const fireOn = (kind: 'bin' | 'container', seed = 1, params = {}) => {
    const sim = makeSim({ seed, params });
    const it = firstOf(sim, kind);
    const inc = sim.incidents.spawnNear(kind === 'bin' ? 'bin_fire' : 'fire', it.x, it.y, calm)!;
    return { sim, it, inc };
  };

  it('feu de poubelle : emerging → active → (escalating) → lingering → resolved ; l’objet reste brûlé', () => {
    const { sim, it, inc } = fireOn('bin');
    const seen: string[] = [inc.state];
    for (let t = 0; t < 12000; t++) {
      sim.step();
      if (seen[seen.length - 1] !== inc.state) seen.push(inc.state);
    }
    expect(seen[0]).toBe('emerging');
    expect(seen).toContain('active');
    expect(seen[seen.length - 1]).toBe('resolved');
    expect(seen.indexOf('lingering')).toBeGreaterThan(seen.indexOf('active'));
    expect(it.state).toBe('burnt'); // conséquence persistante
    expect(inc.costEur).toBe(sim.params.incidents.costBinEur);
    expect(it.incidentId).toBeUndefined();
    expect(inc.endedAtMs).not.toBeNull();
  });

  it('pendant le feu, l’objet brûle ; les durées sont celles des paramètres', () => {
    const { sim, it, inc } = fireOn('bin');
    sim.run((sim.params.incidents.emergingS + 5) * 10);
    expect(inc.state === 'active' || inc.state === 'escalating').toBe(true);
    expect(it.state).toBe('burning');
    sim.run((sim.params.incidents.binFireS * 1.6 + sim.params.incidents.lingerS + 60) * 10);
    expect(inc.state).toBe('resolved');
  });

  it('sans surveillance, l’incendie s’aggrave ; avec une unité continue, il est confiné et ne se propage plus', () => {
    const a = fireOn('container');
    a.sim.run(3000);
    expect(a.inc.severity).toBeGreaterThan(2);
    expect(a.inc.history.some((h) => h.code === 'incident.escalated')).toBe(true);
    const b = fireOn('container');
    b.sim.addUnit({ force: 'crs', callsign: 'CRS test', num: '01', headcount: 20, pos: { x: b.it.x + 2, y: b.it.y } }, PLAN);
    b.sim.run(1500);
    expect(b.inc.state).toBe('contained');
    expect(b.inc.severity).toBe(2);
    expect(b.inc.history.some((h) => h.code === 'incident.contained')).toBe(true);
  });

  it('bris de vitrine : dégâts persistants sur le commerce FICTIF, coût compté', () => {
    const sim = makeSim({ seed: 2 });
    const shop = firstOf(sim, 'shopfront');
    const poi = sim.world.poi(shop.poiId!)!;
    const inc = sim.incidents.spawnNear('window_break', shop.x, shop.y, calm)!;
    sim.run(12000);
    expect(inc.state).toBe('resolved');
    expect(shop.state).toBe('damaged');
    expect(poi.damage).toBe(25);
    expect(poi.state).toBe('damaged');
    expect(poi.incidentIds).toContain(inc.id);
    expect(sim.incidents.stats().costEur).toBe(sim.params.incidents.costWindowEur);
    expect(sim.incidents.stats().damagedPois).toBeGreaterThanOrEqual(1);
  });

  it('un incendie se propage de proche en proche : incidents enfants chaînés à leur parent', () => {
    const sim = makeSim({ seed: 1, params: { incidents: { spreadRatePerSeverity: 0.5, spreadReachM: 60 } } });
    const bin = firstOf(sim, 'bin');
    const parent = sim.incidents.spawnNear('bin_fire', bin.x, bin.y, calm)!;
    sim.run(3000);
    expect(parent.childIds.length).toBeGreaterThan(0);
    for (const id of parent.childIds) {
      const c = sim.incidents.get(id)!;
      expect(c.parentId).toBe(parent.id);
      expect(c.cause.kind).toBe('rule');
      expect(c.cause.refId).toBe(parent.id);
    }
  });

  it('un commerce fictif en feu finit détruit (dégâts cumulés), coût compté une fois', () => {
    const sim = makeSim({ seed: 2 });
    const shop = firstOf(sim, 'shopfront');
    const poi = sim.world.poi(shop.poiId!)!;
    const inc = sim.incidents.spawnNear('fire', shop.x, shop.y, calm)!;
    sim.run(15000);
    expect(poi.damage).toBe(100);
    expect(poi.state).toBe('destroyed');
    expect(shop.state).toBe('destroyed');
    expect(inc.costEur).toBeGreaterThanOrEqual(sim.params.incidents.costShopDestroyedEur);
  });

  it('les incidents réagissent sur les groupes proches : tension relevée puis retombée vers la valeur de fond', () => {
    const sim = makeSim({ seed: 1 });
    const bin = firstOf(sim, 'bin');
    const g = crowdAt(sim, bin.x, bin.y, { tension: 20 });
    const before = g.tension;
    sim.run(5);
    sim.incidents.spawnNear('bin_fire', bin.x, bin.y, calm);
    sim.run(100);
    expect(g.tension).toBeGreaterThan(before);
    expect(g.affectedUntilMs).toBeGreaterThan(sim.timeMs);
    sim.run(6000);
    expect(g.tension).toBeCloseTo(g.baseTension, 0);
  });
});

describe('journal, causes et statistiques : état réel du moteur', () => {
  it('chaque incident a une cause et des événements de journal explicatifs', () => {
    const sim = makeSim({ seed: 1 });
    const it = firstOf(sim, 'bin');
    const inc = sim.incidents.spawnNear('bin_fire', it.x, it.y, calm)!;
    sim.run(12000);
    const ev = sim.journal.forSubject('incident', inc.id);
    expect(ev.map((e) => e.code)).toEqual(expect.arrayContaining(['incident.created', 'incident.active', 'incident.ended', 'incident.resolved']));
    for (const e of ev) {
      expect(e.why.note.length).toBeGreaterThan(5);
      expect(e.text).toMatch(/fictif/);
    }
  });

  it('les statistiques sont calculées depuis l’état (pas de données de démonstration)', () => {
    const sim = makeSim({ seed: 1 });
    expect(sim.incidents.stats()).toMatchObject({ total: 0, active: 0, resolved: 0, costEur: 0, damagedDecor: 0 });
    const a = firstOf(sim, 'bin');
    const b = firstOf(sim, 'shopfront');
    sim.incidents.spawnNear('bin_fire', a.x, a.y, calm);
    sim.incidents.spawnNear('window_break', b.x, b.y, calm);
    sim.run(200);
    let s = sim.incidents.stats();
    expect(s.total).toBe(2);
    expect(s.active).toBe(2);
    expect(s.fires).toBe(1);
    expect(s.byKind.window_break).toBe(1);
    sim.run(12000);
    s = sim.incidents.stats();
    expect(s.resolved).toBe(2);
    expect(s.active).toBe(0);
    expect(s.damagedDecor).toBe(2);
    expect(s.costEur).toBe(sim.params.incidents.costBinEur + sim.params.incidents.costWindowEur);
  });

  it('déterminisme : même graine, mêmes incidents', () => {
    const run = () => {
      const sim = makeSim({ seed: 9 });
      const bin = firstOf(sim, 'bin');
      crowdAt(sim, bin.x, bin.y);
      sim.run(6000);
      return JSON.stringify(sim.incidents.incidents.map((i) => [i.id, i.kind, i.targetDecorId, i.state, i.severity, i.costEur, i.startedAtMs]));
    };
    expect(run()).toBe(run());
  });
});

describe('scénario : événements et rues fermées', () => {
  it('set_tension et spawn_incident passent par la chronologie, avec cause de scénario', () => {
    const graph = cityGraph();
    const sim0 = makeSim();
    const bin = firstOf(sim0, 'bin');
    const timeline: ScenarioEvent[] = [
      { id: 'ev-g', atMs: 0, kind: 'spawn_group', spec: { key: 'foule', label: 'Foule', kind: 'static', size: 300, origin: { x: bin.x, y: bin.y }, anchor: anchorAt({ x: bin.x, y: bin.y }), tension: 10 }, reason: 'test' },
      { id: 'ev-t', atMs: 2000, kind: 'set_tension', groupKey: 'foule', tension: 55, reason: 'montée de tension du scénario' },
      { id: 'ev-i', atMs: 3000, kind: 'spawn_incident', incident: 'bin_fire', x: bin.x, y: bin.y, reason: 'départ de feu prévu au scénario' },
    ];
    const sim = new Sim({ graph, seed: 1, timeline });
    sim.run(100);
    const g = sim.groupByKey('foule')!;
    expect(g.baseTension).toBe(55);
    expect(sim.journal.byCode('group.tension')).toHaveLength(1);
    sim.run(250);
    const inc = sim.incidents.incidents[0]!;
    expect(inc.cause.kind).toBe('scenario_event');
    expect(inc.cause.refId).toBe('ev-i');
  });

  it('une rue fermée par le scénario reçoit des barrières et des cônes ; rouverte, ils disparaissent', () => {
    const graph = cityGraph();
    let e = 0;
    while (e < graph.edgeCount && (graph.edgeLen[e] as number) < 60) e++;
    const timeline: ScenarioEvent[] = [
      { id: 'c', atMs: 1000, kind: 'close_street', edgeId: e, reason: 'travaux fictifs' },
      { id: 'o', atMs: 20000, kind: 'open_street', edgeId: e, reason: 'fin des travaux fictifs' },
    ];
    const sim = new Sim({ graph, seed: 1, timeline });
    const base = sim.world.decor.length;
    sim.run(150);
    const placed = sim.world.decor.length - base;
    expect(placed).toBeGreaterThanOrEqual(4);
    expect(sim.world.decor.filter((d) => d.kind === 'barrier').length).toBeGreaterThanOrEqual(2);
    expect(sim.journal.byCode('edge.closed')[0]!.text).toMatch(/barrières/);
    sim.run(500);
    expect(sim.world.decor.length).toBe(base);
  });
});
