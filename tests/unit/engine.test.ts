import { describe, expect, it } from 'vitest';
import { anchorAt, cityGraph, makeSim, PLAN, runUntil } from './engineHelpers';
import { CausalityError, Sim, type ScenarioEvent } from '../../src/engine/sim';
import { goneCount } from '../../src/engine/motion';
import { locate, type Located } from '../../src/nav/route';
import { gridGraph } from './navHelpers';
import type { CrowdGroup, GroupSpec } from '../../src/engine/types';

const marchSpec = (size = 1500, over: Partial<GroupSpec> = {}): GroupSpec => ({
  label: 'Cortège de test',
  kind: 'march',
  size,
  origin: { x: -600, y: -300 },
  plan: { destination: anchorAt({ x: 300, y: 200 }, 'Place du test'), waypoints: [], onArrival: 'settle', patienceMs: 0 },
  ...over,
});
const loc: Located = { x: 0, y: 0, tx: 0, ty: 0, seg: 0 };

describe('causalité : aucune foule sans raison', () => {
  it('refuse toute création sans cause identifiable', () => {
    const sim = makeSim();
    expect(() => sim.createGroup(marchSpec(), undefined as never)).toThrow(CausalityError);
    expect(() => sim.createGroup(marchSpec(), { kind: 'scenario_plan', refId: '', note: 'x' })).toThrow(CausalityError);
    expect(() => sim.createGroup(marchSpec(), { kind: 'scenario_plan', refId: 'p', note: '' })).toThrow(CausalityError);
    expect(sim.groups).toHaveLength(0);
  });

  it('chaque groupe porte son origine, journalisée dès la création', () => {
    const sim = makeSim();
    const id = sim.createGroup(marchSpec(300), PLAN);
    const g = sim.group(id)!;
    expect(g.origin).toEqual(PLAN);
    const e = sim.journal.byCode('group.created')[0]!;
    expect(e.why).toEqual(PLAN);
    expect(sim.explain(id)[0]?.why).toEqual(PLAN);
  });

  it('un événement de scénario crée un groupe avec une cause « scenario_event » explicite', () => {
    const timeline: ScenarioEvent[] = [{ id: 'ev-1', atMs: 5000, kind: 'spawn_group', spec: marchSpec(200, { entry: 'gateway' }), reason: 'arrivée prévue à la porte ouest' }];
    const sim = makeSim({ timeline });
    sim.run(40);
    expect(sim.groups).toHaveLength(0);
    sim.run(20);
    expect(sim.groups).toHaveLength(1);
    expect(sim.groups[0]!.origin).toMatchObject({ kind: 'scenario_event', refId: 'ev-1', note: 'arrivée prévue à la porte ouest' });
  });

  it('effectif invalide refusé', () => {
    const sim = makeSim();
    expect(() => sim.createGroup(marchSpec(0), PLAN)).toThrow(RangeError);
    expect(() => sim.createGroup(marchSpec(10.5), PLAN)).toThrow(RangeError);
  });
});

describe('cortège mobile', () => {
  it('suit son itinéraire, passe par arriving puis devient un rassemblement statique (T2) avec journal explicatif', () => {
    const sim = makeSim();
    const id = sim.createGroup(marchSpec(1500), PLAN);
    const g = sim.group(id)!;
    expect(g.kind).toBe('march');
    expect(g.route!.length).toBeGreaterThan(1000);
    runUntil(sim, () => g.phase === 'settled', 30000);
    expect(g.phase).toBe('settled');
    expect(g.kind).toBe('static');
    expect(g.anchor?.label).toBe('Place du test');
    const codes = sim.journal.events.map((e) => e.code);
    expect(codes).toEqual(['group.created', 'group.arriving', 'group.settled']);
    for (const e of sim.journal.events) expect(e.why.note.length).toBeGreaterThan(5);
    expect(sim.size(g)).toBe(1500);
    // l'historique du groupe reprend la chaîne causale
    expect(sim.explain(id).map((h) => h.code)).toEqual(codes);
  });

  it('la progression est monotone et la vitesse ne dépasse jamais la vitesse configurée', () => {
    const sim = makeSim({ params: { speedByKind: { march: 1.1 } } });
    const g = sim.group(sim.createGroup(marchSpec(800), PLAN))!;
    let last = g.sCentre;
    for (let i = 0; i < 3000; i++) {
      sim.step();
      expect(g.sCentre).toBeGreaterThanOrEqual(last);
      expect(g.speedMps).toBeLessThanOrEqual(1.1 + 1e-9);
      last = g.sCentre;
    }
    expect(g.sCentre).toBeGreaterThan(200);
  });

  it('vitesse configurable par type de groupe et par groupe ; plus rapide = arrive plus tôt', () => {
    const t = (over: Partial<GroupSpec>, params = {}) => {
      const sim = makeSim({ params });
      const g = sim.group(sim.createGroup(marchSpec(500, over), PLAN))!;
      return runUntil(sim, () => g.phase === 'settled', 60000);
    };
    const base = t({});
    const fast = t({ speedMps: 2.2 });
    expect(fast).toBeLessThan(base * 0.7);
    const faster = t({}, { speedByKind: { march: 2.2 } });
    expect(Math.abs(faster - fast)).toBeLessThan(5);
  });

  it('les rues étroites ralentissent le cortège (facteur de largeur)', () => {
    const wide = gridGraph({ cols: 6, rows: 1, spacing: 100, width: 14 });
    const narrow = gridGraph({ cols: 6, rows: 1, spacing: 100, width: 5 });
    const run = (graph: typeof wide) => {
      const sim = new Sim({ graph, seed: 1, mask: null });
      const g = sim.group(sim.createGroup({ label: 'c', kind: 'march', size: 200, origin: { x: -250, y: 0 }, plan: { destination: anchorAt({ x: 250, y: 0 }), waypoints: [], onArrival: 'settle', patienceMs: 0 } }, PLAN))!;
      sim.run(100);
      return g.speedMps;
    };
    expect(run(narrow)).toBeLessThan(run(wide));
  });

  it('la colonne s’étire dans une rue étroite : longueur = effectif / (densité × largeur)', () => {
    const narrow = gridGraph({ cols: 6, rows: 1, spacing: 100, width: 5 });
    const wide = gridGraph({ cols: 6, rows: 1, spacing: 100, width: 14 });
    const L = (graph: typeof wide) => {
      const sim = new Sim({ graph, seed: 1, mask: null });
      const g = sim.group(sim.createGroup({ label: 'c', kind: 'march', size: 3000, origin: { x: -250, y: 0 }, plan: { destination: anchorAt({ x: 250, y: 0 }), waypoints: [], onArrival: 'settle', patienceMs: 0 } }, PLAN))!;
      return g.columnLength;
    };
    expect(L(narrow)).toBeGreaterThan(L(wide) * 2);
    // 3000 / (2 pers/m² × (5 − 1,6) m) ≈ 441 m
    expect(L(narrow)).toBeCloseTo(3000 / (2 * 3.4), 0);
  });

  it('aucun plafond : un cortège de 20 000 personnes se crée et avance', () => {
    const sim = makeSim({ params: { lod: { defaultLevel: 1 } } });
    const g = sim.group(sim.createGroup(marchSpec(20000), PLAN))!;
    expect(g.members.n).toBe(20000);
    sim.run(50);
    expect(sim.size(g)).toBe(20000);
    expect(sim.totalPeople()).toBe(20000);
  });

  it('entrée par une porte : la colonne commence entièrement derrière l’origine puis entre dans la zone', () => {
    const sim = makeSim();
    const g = sim.group(sim.createGroup(marchSpec(2000, { entry: 'gateway' }), PLAN))!;
    expect(g.sCentre).toBeCloseTo(-g.columnLength / 2, 3);
    sim.run(10);
    // aucun individu n'est en avance sur le point d'origine au départ
    expect(g.sCentre + g.columnLength / 2).toBeLessThan(5);
  });

  it('un groupe démarre à l’heure prévue par le scénario (forming → moving, T1)', () => {
    const sim = makeSim();
    const g = sim.group(sim.createGroup(marchSpec(300, { startAtMs: 3000 }), PLAN))!;
    expect(g.phase).toBe('forming');
    sim.run(20);
    expect(g.phase).toBe('forming');
    expect(g.sCentre).toBe(0);
    sim.run(15);
    expect(g.phase).toBe('moving');
    const dep = sim.journal.byCode('group.departed')[0]!;
    expect(dep.why.kind).toBe('scenario_plan');
  });
});

describe('cohérence spatiale des individus', () => {
  it('N2 : aucun individu n’entre dans un bâtiment pendant tout le trajet, jusqu’au rassemblement', () => {
    const sim = makeSim();
    const g = sim.group(sim.createGroup(marchSpec(1200), PLAN))!;
    const mask = sim.mask!;
    let violations = 0;
    let checks = 0;
    while (g.phase !== 'settled' && sim.tick < 30000) {
      sim.step();
      if (sim.tick % 25 === 0) {
        for (let i = 0; i < g.members.n; i++) {
          checks++;
          if (mask.isBlocked(g.members.x[i] as number, g.members.y[i] as number)) violations++;
        }
      }
    }
    expect(g.phase).toBe('settled');
    expect(checks).toBeGreaterThan(100000);
    expect(violations).toBe(0);
  });

  it('N1 : les individus restent dans la bande de la rue (distance à la route ≤ demi-largeur du front)', () => {
    const sim = makeSim({ params: { lod: { defaultLevel: 1 } } });
    const g = sim.group(sim.createGroup(marchSpec(2500), PLAN))!;
    const route = g.route!;
    sim.run(2400);
    let worst = 0;
    const segs = route.cum.length - 1;
    for (let i = g.members.activeStart; i < g.members.n; i += 7) {
      const x = g.members.x[i] as number;
      const y = g.members.y[i] as number;
      let best = Infinity;
      for (let s = 0; s < segs; s++) {
        const ax = route.pts[2 * s]!, ay = route.pts[2 * s + 1]!, bx = route.pts[2 * s + 2]!, by = route.pts[2 * s + 3]!;
        const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
        const f = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2));
        best = Math.min(best, Math.hypot(x - (ax + dx * f), y - (ay + dy * f)));
      }
      worst = Math.max(worst, best);
    }
    // largeur maximale du front 14 m → demi-largeur 7 m, plus l'extension d'arrivée éventuelle
    expect(worst).toBeLessThan(7.5);
  });

  it('aucun déplacement instantané : le déplacement individuel par tick reste borné (N1 et N2)', () => {
    for (const level of [1, 2] as const) {
      const sim = makeSim({ params: { lod: { defaultLevel: level } } });
      const g = sim.group(sim.createGroup(marchSpec(1000), PLAN))!;
      let maxStep = 0;
      let prevX = Float32Array.from(g.members.x);
      let prevY = Float32Array.from(g.members.y);
      for (let t = 0; t < 12000 && g.phase !== 'settled'; t++) {
        sim.step();
        if (t % 3 === 0) {
          for (let i = 0; i < g.members.n; i++) maxStep = Math.max(maxStep, Math.hypot((g.members.x[i] as number) - (prevX[i] as number), (g.members.y[i] as number) - (prevY[i] as number)));
        }
        prevX = Float32Array.from(g.members.x);
        prevY = Float32Array.from(g.members.y);
      }
      // vitesse max ≈ 2,6 m/s × 0,1 s ; marge pour les variations de colonne
      expect(maxStep, `niveau N${level}`).toBeLessThan(0.75);
    }
  });

  it('la position du rassemblement (ancre) est distincte des positions individuelles', () => {
    const sim = makeSim();
    const anchor = anchorAt({ x: 100, y: 100 }, 'Parvis');
    const g = sim.group(sim.createGroup({ label: 'Rassemblement', kind: 'static', size: 500, origin: { x: 100, y: 100 }, anchor }, PLAN))!;
    expect(g.phase).toBe('settled');
    expect(g.anchor!.pos).toEqual({ x: 100, y: 100 });
    const xs = new Set(Array.from(g.members.x));
    expect(xs.size).toBeGreaterThan(300);
    // tous les créneaux sont visibles depuis l'ancre : aucun dans un bâtiment
    for (let i = 0; i < g.members.n; i++) expect(sim.mask!.isBlocked(g.members.x[i] as number, g.members.y[i] as number)).toBe(false);
  });

  it('rassemblement statique : le centre ne bouge pas, la zone grandit avec l’effectif (propriété de préfixe)', () => {
    const sim = makeSim();
    const mk = (n: number) => sim.group(sim.createGroup({ label: `S${n}`, kind: 'static', size: n, origin: { x: 0, y: 0 }, anchor: anchorAt({ x: 0, y: 0 }), seed: 7 }, PLAN))!;
    const small = mk(300);
    const big = mk(3000);
    expect(big.layout!.rMax).toBeGreaterThan(small.layout!.rMax * 2);
    // préfixe : les 300 premiers créneaux sont identiques
    for (let i = 0; i < 600; i++) expect(big.layout!.pts[i]).toBe(small.layout!.pts[i]);
    sim.run(100);
    expect(big.anchor!.pos).toEqual({ x: 0, y: 0 });
  });
});

describe('rues bloquées : replanification, attente, reprise (T3, T3b, T4)', () => {
  it('une rue fermée par le scénario provoque un détour ; la destination ne change pas ; cause = événement', () => {
    const sim = makeSim();
    const g = sim.group(sim.createGroup(marchSpec(400), PLAN))!;
    sim.run(600);
    const route0 = g.route!;
    // ferme une arête loin devant la tête
    const head = g.sCentre + g.columnLength / 2;
    const idx = route0.edges.findIndex((_, i) => (route0.edgeStart[i] as number) > head + 120);
    const edge = route0.edges[idx] as number;
    sim.closeStreet(edge, { kind: 'scenario_event', refId: 'ev-close', note: 'travaux fictifs' });
    sim.run(5);
    const reroute = sim.journal.byCode('group.rerouted')[0];
    expect(reroute).toBeDefined();
    expect(reroute!.why).toMatchObject({ kind: 'scenario_event', refId: 'ev-close' });
    expect(Array.from(g.route!.edges)).not.toContain(edge);
    expect(g.plan.destination!.label).toBe('Place du test');
    runUntil(sim, () => g.phase === 'settled', 40000);
    expect(g.phase).toBe('settled');
    expect(g.anchor!.label).toBe('Place du test');
  });

  it('aucun itinéraire alternatif : le groupe reste sur place ; reprise à la réouverture', () => {
    // couloir unique : fermer un tronçon coupe tout
    const graph = gridGraph({ cols: 7, rows: 1, spacing: 100, width: 10 });
    const sim = new Sim({ graph, seed: 3, mask: null });
    const g = sim.group(sim.createGroup({ label: 'Cortège', kind: 'march', size: 200, origin: { x: -300, y: 0 }, plan: { destination: anchorAt({ x: 300, y: 0 }, 'Fin'), waypoints: [], onArrival: 'settle', patienceMs: 20000 } }, PLAN))!;
    sim.run(200);
    const edge = g.route!.edges[4] as number;
    sim.closeStreet(edge, { kind: 'scenario_event', refId: 'barrage', note: 'barrage de scénario' });
    sim.run(20);
    expect(g.phase).toBe('waiting');
    expect(g.speedMps).toBe(0);
    const w = sim.journal.byCode('group.waiting')[0]!;
    expect(w.why.refId).toBe('barrage');
    const frozen = g.sCentre;
    sim.run(100);
    expect(g.sCentre).toBe(frozen); // reste sur place
    sim.run(150);
    expect(sim.journal.byCode('group.patience_exceeded').length).toBe(1);
    sim.openStreet(edge, { kind: 'scenario_event', refId: 'fin-barrage', note: 'fin du barrage' });
    sim.run(20);
    expect(g.phase).toBe('moving');
    expect(sim.journal.byCode('group.resumed')).toHaveLength(1);
    runUntil(sim, () => g.phase === 'settled', 30000);
    expect(g.phase).toBe('settled');
  });

  it('aucun itinéraire dès la création : le groupe reste sur place et réessaie', () => {
    const graph = gridGraph({ cols: 4, rows: 1, spacing: 100 });
    const sim = new Sim({ graph, seed: 1, mask: null });
    sim.closeStreet(1, { kind: 'scenario_plan', refId: 'init', note: 'rue fermée dès le début' });
    const g = sim.group(sim.createGroup({ label: 'Bloqué', kind: 'march', size: 100, origin: { x: -150, y: 0 }, plan: { destination: anchorAt({ x: 150, y: 0 }), waypoints: [], onArrival: 'settle', patienceMs: 0 } }, PLAN))!;
    expect(g.phase).toBe('waiting');
    expect(g.route).toBeNull();
    sim.run(30);
    expect(g.phase).toBe('waiting');
    sim.openStreet(1, { kind: 'scenario_event', refId: 'open', note: 'rouverte' });
    sim.run(20);
    expect(g.route).not.toBeNull();
    expect(g.phase).toBe('moving');
  });
});

describe('dispersion (T8, T9)', () => {
  it('un rassemblement se disperse progressivement jusqu’à disparition, avec journal causal', () => {
    const sim = makeSim();
    const id = sim.createGroup({ label: 'Rassemblement', kind: 'static', size: 2000, origin: { x: 0, y: 0 }, anchor: anchorAt({ x: 0, y: 0 }, 'Place') }, PLAN);
    const g = sim.group(id)!;
    expect(sim.beginDispersal(id, anchorAt({ x: -650, y: -480 }, 'Sortie sud-ouest'), 120000, { kind: 'scenario_event', refId: 'fin', note: 'fin de l’événement prévue' })).toBe(true);
    expect(g.phase).toBe('dispersing');
    const sizes: number[] = [];
    while (g.phase !== 'dispersed' && sim.tick < 40000) {
      sim.step();
      if (sim.tick % 100 === 0) sizes.push(sim.size(g));
    }
    expect(g.phase).toBe('dispersed');
    for (let i = 1; i < sizes.length; i++) expect(sizes[i]).toBeLessThanOrEqual(sizes[i - 1] as number);
    expect(sizes.some((s) => s > 0 && s < 2000)).toBe(true); // dispersion PROGRESSIVE, pas instantanée
    expect(sim.groups).toHaveLength(0); // retiré après journalisation
    expect(sim.journal.events.map((e) => e.code)).toEqual(['group.created', 'group.dispersing', 'group.dispersed']);
    expect(sim.journal.byCode('group.dispersing')[0]!.why.refId).toBe('fin');
  });

  it('le nombre de personnes parties est analytique et monotone', () => {
    const sim = makeSim();
    const g = sim.group(sim.createGroup({ label: 'R', kind: 'static', size: 1000, origin: { x: 0, y: 0 }, anchor: anchorAt({ x: 0, y: 0 }) }, PLAN))!;
    sim.beginDispersal(g.id, anchorAt({ x: 600, y: 400 }), 60000, PLAN);
    let last = 0;
    for (let t = 0; t < 3000000; t += 5000) {
      const c = goneCount(g, t);
      expect(c).toBeGreaterThanOrEqual(last);
      last = c;
    }
    expect(last).toBe(1000);
  });

  it('dispersion impossible (aucun itinéraire) : le rassemblement reste en place, avec alerte', () => {
    const graph = gridGraph({ cols: 5, rows: 1, spacing: 100 });
    const sim = new Sim({ graph, seed: 1, mask: null });
    const id = sim.createGroup({ label: 'R', kind: 'static', size: 100, origin: { x: -200, y: 0 }, anchor: anchorAt({ x: -200, y: 0 }) }, PLAN);
    sim.closeStreet(0, PLAN);
    sim.closeStreet(1, PLAN);
    sim.closeStreet(2, PLAN);
    sim.closeStreet(3, PLAN);
    expect(sim.beginDispersal(id, anchorAt({ x: 200, y: 0 }), 10000, PLAN)).toBe(false);
    expect(sim.group(id)!.phase).toBe('settled');
    expect(sim.journal.byCode('group.dispersal_failed')).toHaveLength(1);
  });
});

describe('états de rue produits par la simulation', () => {
  it('une grande foule statique sature les rues voisines ; le compteur de rues bloquées en dérive', () => {
    const sim = makeSim({ zone: { halfWidth: 600, halfHeight: 450 } });
    expect(sim.streetCounts().blocked).toBe(0);
    sim.createGroup({ label: 'Grand rassemblement', kind: 'static', size: 40000, origin: { x: 0, y: 0 }, anchor: anchorAt({ x: 0, y: 0 }) }, PLAN);
    sim.run(10);
    const c = sim.streetCounts();
    expect(c.blocked).toBeGreaterThan(3);
    expect(c.total).toBeGreaterThan(c.blocked);
  });

  it('un petit rassemblement ne bloque pas les rues (pas de seuil universel de personnes)', () => {
    const sim = makeSim({ zone: { halfWidth: 600, halfHeight: 450 } });
    sim.createGroup({ label: 'Petit', kind: 'static', size: 60, origin: { x: 0, y: 0 }, anchor: anchorAt({ x: 0, y: 0 }) }, PLAN);
    sim.run(10);
    expect(sim.streetCounts().blocked).toBe(0);
  });

  it('un cortège ralentit s’il traverse une rue occupée par une autre foule', () => {
    const graph = gridGraph({ cols: 8, rows: 1, spacing: 100, width: 10 });
    const run = (withCrowd: boolean) => {
      const sim = new Sim({ graph, seed: 1, mask: null });
      if (withCrowd) sim.createGroup({ label: 'Autre foule', kind: 'static', size: 1500, origin: { x: 100, y: 0 }, anchor: anchorAt({ x: 100, y: 0 }) }, PLAN);
      const g = sim.group(sim.createGroup({ label: 'c', kind: 'march', size: 300, origin: { x: -340, y: 0 }, plan: { destination: anchorAt({ x: 340, y: 0 }), waypoints: [], onArrival: 'settle', patienceMs: 0 } }, PLAN))!;
      let minSpeed = Infinity;
      for (let i = 0; i < 4500; i++) {
        sim.step();
        if (i > 20 && g.phase === 'moving') minSpeed = Math.min(minSpeed, g.speedMps);
      }
      return { minSpeed, cause: g.speedCause };
    };
    const free = run(false);
    const crowded = run(true);
    expect(crowded.minSpeed).toBeLessThan(free.minSpeed);
  });
});

describe('reproductibilité', () => {
  const script = (seed: number, level: 0 | 1 | 2) => {
    const timeline: ScenarioEvent[] = [
      { id: 'e1', atMs: 20000, kind: 'close_street', edgeId: 40, reason: 'travaux fictifs' },
      { id: 'e2', atMs: 1000, kind: 'spawn_group', spec: { ...marchSpec(600, { entry: 'gateway' }), key: 'm1' }, reason: 'arrivée programmée' },
    ];
    const sim = makeSim({ seed, timeline, params: { lod: { defaultLevel: level } } });
    sim.run(1500);
    return sim;
  };
  it('même graine + mêmes événements ⇒ même empreinte et même journal', () => {
    const a = script(5, 2);
    const b = script(5, 2);
    expect(a.stateHash()).toBe(b.stateHash());
    expect(a.journal.events.map((e) => e.text)).toEqual(b.journal.events.map((e) => e.text));
  });
  it('une autre graine change les individus mais pas la logique de groupe', () => {
    const a = script(5, 2);
    const c = script(6, 2);
    expect(a.stateHash()).not.toBe(c.stateHash());
    expect(a.groups[0]!.sCentre).toBeCloseTo(c.groups[0]!.sCentre, 6);
  });
  it('la logique collective ne dépend pas du niveau de simulation (N0, N1, N2)', () => {
    const s0 = script(5, 0);
    const s1 = script(5, 1);
    const s2 = script(5, 2);
    for (const s of [s0, s1]) {
      expect(s.groups[0]!.sCentre).toBeCloseTo(s2.groups[0]!.sCentre, 6);
      expect(s.groups[0]!.phase).toBe(s2.groups[0]!.phase);
      expect(s.journal.events.map((e) => e.code)).toEqual(s2.journal.events.map((e) => e.code));
    }
  });
  it('les niveaux inférieurs n’altèrent pas l’effectif : aucun individu ne disparaît', () => {
    for (const level of [0, 1, 2] as const) {
      const s = script(5, level);
      expect(s.totalPeople()).toBe(600);
    }
  });
});

describe('niveaux de simulation selon le foyer d’attention', () => {
  it('N2 près du foyer, N1 plus loin, N0 très loin ; un groupe épinglé reste en N2 ; le retour en N2 ne crée pas de saut', () => {
    const sim = makeSim();
    const far = sim.group(sim.createGroup({ label: 'Loin', kind: 'static', size: 500, origin: { x: 650, y: 480 }, anchor: anchorAt({ x: 650, y: 480 }) }, PLAN))!;
    const near = sim.group(sim.createGroup({ label: 'Près', kind: 'static', size: 500, origin: { x: 0, y: 0 }, anchor: anchorAt({ x: 0, y: 0 }) }, PLAN))!;
    sim.setFoci([{ x: 0, y: 0, radius: 50 }]);
    sim.step();
    expect(near.level).toBe(2);
    expect(far.level).toBe(1);
    sim.params.lod.n1RadiusM = 300;
    sim.step();
    expect(far.level).toBe(0);
    sim.setFoci([{ x: 0, y: 0, radius: 50 }], [far.id]);
    sim.step();
    expect(far.level).toBe(2);
    sim.setFoci([{ x: 650, y: 480, radius: 50 }]);
    sim.step();
    expect(far.level).toBe(2);
    const before = Float32Array.from(far.members.x);
    sim.step();
    let maxJump = 0;
    for (let i = 0; i < far.members.n; i++) maxJump = Math.max(maxJump, Math.abs((far.members.x[i] as number) - (before[i] as number)));
    expect(maxJump).toBeLessThan(0.5);
  });
});

describe('transitions : positions et route continues', () => {
  it('locate() de la route d’un cortège est continue (pas de téléportation de la tête)', () => {
    const sim = makeSim();
    const g = sim.group(sim.createGroup(marchSpec(500), PLAN))!;
    let px = NaN;
    let py = NaN;
    for (let s = 0; s <= g.route!.length; s += 0.5) {
      locate(g.route!, s, loc);
      if (!Number.isNaN(px)) expect(Math.hypot(loc.x - px, loc.y - py)).toBeLessThan(0.51);
      px = loc.x;
      py = loc.y;
    }
  });

  it('un cortège avec points de passage les traverse dans l’ordre', () => {
    const sim = makeSim();
    const wp = anchorAt({ x: -300, y: 300 }, 'Point de passage');
    const g = sim.group(sim.createGroup(marchSpec(200, { plan: { destination: anchorAt({ x: 300, y: -300 }, 'Arrivée'), waypoints: [wp], onArrival: 'settle', patienceMs: 0 } }), PLAN))!;
    let nearest = Infinity;
    for (let s = 0; s <= g.route!.length; s += 1) {
      locate(g.route!, s, loc);
      nearest = Math.min(nearest, Math.hypot(loc.x - wp.pos.x, loc.y - wp.pos.y));
    }
    expect(nearest).toBeLessThan(45); // accroché à l'arête la plus proche du point de passage
  });
});

describe('graphe réel de la ville de test', () => {
  it('le graphe schématique utilisé est connexe et couvre la zone', () => {
    const g = cityGraph();
    expect(g.edgeCount).toBeGreaterThan(300);
  });
});
export type { CrowdGroup };

describe('scission et jonction (T6, T7)', () => {
  const setup = (level: 0 | 1 | 2 = 2) => {
    const sim = makeSim({ params: { lod: { defaultLevel: level } } });
    const a = anchorAt({ x: -200, y: -100 }, 'Place A');
    const b = anchorAt({ x: 250, y: 200 }, 'Place B');
    const sA = sim.group(sim.createGroup({ label: 'Rassemblement A', kind: 'static', size: 1500, origin: a.pos, anchor: a, key: 'A' }, PLAN))!;
    const sB = sim.group(sim.createGroup({ label: 'Rassemblement B', kind: 'static', size: 800, origin: b.pos, anchor: b, key: 'B' }, PLAN))!;
    return { sim, a, b, sA, sB };
  };
  const SPLIT = { kind: 'scenario_event', refId: 'ev-split', note: 'un groupe se détache pour rejoindre l’autre piquet (plan du scénario)' } as const;

  it('un rassemblement se scinde : effectif conservé, enfant avec cause « transition », journal explicatif', () => {
    const { sim, b, sA } = setup();
    const total0 = sim.totalPeople();
    const childId = sim.splitGroup(sA.id, 200, { label: 'Groupe détaché', destination: b, onArrival: 'settle', key: 'C' }, SPLIT)!;
    expect(childId).toBeTruthy();
    const child = sim.group(childId)!;
    expect(sim.size(sA)).toBe(1300);
    expect(sim.size(child)).toBe(200);
    expect(sim.totalPeople()).toBe(total0);
    expect(child.kind).toBe('secondary');
    expect(child.parentId).toBe(sA.id);
    expect(child.origin).toMatchObject({ kind: 'transition', refId: sA.id });
    const split = sim.journal.byCode('group.split')[0]!;
    expect(split.why).toMatchObject(SPLIT);
    expect(sim.explain(childId)[0]!.why.kind).toBe('transition');
    expect(sim.explain(sA.id).map((h) => h.code)).toContain('group.split');
  });

  it('le groupe détaché rejoint sa destination et s’y installe ; l’effectif total est conservé à chaque instant', () => {
    const { sim, b, sA } = setup();
    const total0 = sim.totalPeople();
    const child = sim.group(sim.splitGroup(sA.id, 200, { label: 'Groupe détaché', destination: b, onArrival: 'settle' }, SPLIT)!)!;
    while (child.phase !== 'settled' && sim.tick < 60000) {
      sim.step();
      if (sim.tick % 50 === 0) expect(sim.totalPeople()).toBe(total0);
    }
    expect(child.phase).toBe('settled');
    expect(child.anchor!.label).toBe('Place B');
    expect(sim.size(child)).toBe(200);
  });

  it('jonction : le groupe arrive, rejoint le rassemblement cible (+effectif), disparaît ; journal « joined »', () => {
    const { sim, b, sA, sB } = setup();
    const total0 = sim.totalPeople();
    const child = sim.group(sim.splitGroup(sA.id, 250, { label: 'Renfort', destination: b, onArrival: 'join_target', joinTargetKey: 'B' }, SPLIT)!)!;
    expect(child.plan.joinTargetId).toBe(sB.id);
    while (sim.group(child.id) && sim.tick < 80000) {
      sim.step();
      if (sim.tick % 100 === 0) expect(sim.totalPeople()).toBe(total0);
    }
    expect(sim.group(child.id)).toBeUndefined();
    expect(sim.size(sB)).toBe(800 + 250);
    expect(sim.totalPeople()).toBe(total0);
    const joined = sim.journal.byCode('group.joined')[0]!;
    expect(joined.why.kind).toBe('transition');
    expect(joined.text).toContain('Renfort');
    expect(sim.journal.byCode('group.merged')).toHaveLength(1);
  });

  it('aucun déplacement instantané pendant scission et jonction (N1 et N2) ; aucun individu dans un bâtiment (N2)', () => {
    for (const level of [1, 2] as const) {
      const { sim, b, sA, sB } = setup(level);
      sim.splitGroup(sA.id, 250, { label: 'Renfort', destination: b, onArrival: 'join_target', joinTargetKey: 'B' }, SPLIT);
      const snap = () => sim.groups.map((g) => ({ id: g.id, x: Float32Array.from(g.members.x), y: Float32Array.from(g.members.y), n: g.members.n }));
      let prev = snap();
      let maxStep = 0;
      let violations = 0;
      for (let t = 0; t < 40000 && sim.groups.length > 2 - 0 && sim.group('G-3'); t++) {
        sim.step();
        const cur = snap();
        for (const c of cur) {
          const p = prev.find((q) => q.id === c.id);
          if (p && p.n === c.n) for (let i = 0; i < c.n; i += 3) maxStep = Math.max(maxStep, Math.hypot((c.x[i] as number) - (p.x[i] as number), (c.y[i] as number) - (p.y[i] as number)));
        }
        if (level === 2 && t % 20 === 0) for (const g of sim.groups) for (let i = 0; i < g.members.n; i += 5) if (sim.mask!.isBlocked(g.members.x[i] as number, g.members.y[i] as number)) violations++;
        prev = cur;
      }
      expect(maxStep, `niveau N${level}`).toBeLessThan(0.75);
      expect(violations).toBe(0);
      expect(sim.size(sB)).toBe(1050);
    }
  });

  it('scission d’un cortège en marche : la queue se détache ; effectifs conservés', () => {
    const sim = makeSim();
    const g = sim.group(sim.createGroup(marchSpec(1000), PLAN))!;
    sim.run(500);
    const childId = sim.splitGroup(g.id, 100, { label: 'Queue du cortège', destination: anchorAt({ x: -100, y: 350 }, 'Autre lieu'), onArrival: 'settle' }, SPLIT)!;
    expect(sim.size(g)).toBe(900);
    expect(sim.size(sim.group(childId)!)).toBe(100);
    expect(sim.totalPeople()).toBe(1000);
    runUntil(sim, () => g.phase === 'settled' && sim.group(childId)!.phase === 'settled', 80000);
    expect(g.phase).toBe('settled');
    expect(sim.group(childId)!.phase).toBe('settled');
    expect(sim.totalPeople()).toBe(1000);
  });

  it('scission invalide (effectif ≥ groupe, groupe en dispersion, id inconnu) : refusée sans effet', () => {
    const { sim, b, sA } = setup();
    const before = sim.totalPeople();
    expect(sim.splitGroup(sA.id, 1500, { label: 'x', destination: b }, SPLIT)).toBeNull();
    expect(sim.splitGroup(sA.id, 0, { label: 'x', destination: b }, SPLIT)).toBeNull();
    expect(sim.splitGroup('G-999', 10, { label: 'x', destination: b }, SPLIT)).toBeNull();
    sim.beginDispersal(sA.id, anchorAt({ x: -650, y: -480 }), 60000, SPLIT);
    expect(sim.splitGroup(sA.id, 10, { label: 'x', destination: b }, SPLIT)).toBeNull();
    expect(sim.totalPeople()).toBe(before);
    expect(sim.groups).toHaveLength(2);
  });

  it('événement de scénario « split_group » : même comportement, cause = événement', () => {
    const b = anchorAt({ x: 250, y: 200 }, 'Place B');
    const a = anchorAt({ x: -200, y: -100 }, 'Place A');
    const timeline: ScenarioEvent[] = [
      { id: 'sp1', atMs: 2000, kind: 'spawn_group', spec: { label: 'A', kind: 'static', size: 600, origin: a.pos, anchor: a, key: 'A' }, reason: 'rassemblement initial' },
      { id: 'sp2', atMs: 5000, kind: 'split_group', groupKey: 'A', count: 100, child: { label: 'Détachement', destination: b }, reason: 'un groupe quitte le rassemblement pour rejoindre la place B' },
    ];
    const sim = makeSim({ timeline });
    sim.run(80);
    expect(sim.groups).toHaveLength(2);
    expect(sim.journal.byCode('group.split')[0]!.why).toMatchObject({ kind: 'scenario_event', refId: 'sp2' });
    expect(sim.totalPeople()).toBe(600);
  });
});
