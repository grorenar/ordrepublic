import { describe, expect, it } from 'vitest';
import { Sim, CausalityError } from '../../src/engine/sim';
import { anchorAt, makeSim, PLAN, runUntil } from './engineHelpers';
import { gridGraph } from './navHelpers';
import type { UnitSpec } from '../../src/engine/types';

const crs = (n: number, pos = { x: 0, y: 0 }): UnitSpec => ({ force: 'crs', callsign: `CRS-J ${String(n).padStart(2, '0')}/1`, num: String(n).padStart(2, '0'), headcount: 24, pos });
const line = () => new Sim({ graph: gridGraph({ cols: 9, rows: 1, spacing: 100, width: 10 }), seed: 1, mask: null });
const grid = () => new Sim({ graph: gridGraph({ cols: 7, rows: 5, spacing: 100, width: 10 }), seed: 1, mask: null });

describe('unités et véhicules : création', () => {
  it('exige une cause ; l’identifiant et le numéro fictif sont stables', () => {
    const sim = makeSim();
    expect(() => sim.addUnit(crs(7), undefined as never)).toThrow(CausalityError);
    const id = sim.addUnit(crs(7, { x: 50, y: 50 }), PLAN);
    const u = sim.entity(id)!;
    const callsign = u.callsign;
    expect(id).toBe('U-1');
    sim.issueOrder({ kind: 'move', ids: [id], target: { x: 300, y: 200 } });
    sim.run(300);
    expect(sim.entity(id)!.callsign).toBe(callsign);
    expect(sim.units[0]!.num).toBe('07');
  });

  it('place l’entité sur le réseau de rues (jamais dans un bâtiment) et refuse une position hors réseau', () => {
    const sim = makeSim();
    const id = sim.addUnit(crs(1, { x: 3.7, y: 11.3 }), PLAN);
    const u = sim.entity(id)!;
    expect(sim.mask!.isBlocked(u.x, u.y)).toBe(false);
    expect(() => sim.addUnit(crs(2, { x: 90000, y: 90000 }), PLAN)).toThrow(RangeError);
  });

  it('équipement sémantique selon la force (bouclier pour CRS / gendarmerie mobile), modifiable', () => {
    const sim = makeSim();
    const a = sim.addUnit({ ...crs(1), force: 'crs' }, PLAN);
    const b = sim.addUnit({ ...crs(2), force: 'police_nationale' }, PLAN);
    const c = sim.addUnit({ ...crs(3), force: 'police_nationale', loadout: { shield: true } }, PLAN);
    expect((sim.entity(a) as { loadout: { shield: boolean } }).loadout.shield).toBe(true);
    expect((sim.entity(b) as { loadout: { shield: boolean } }).loadout.shield).toBe(false);
    expect((sim.entity(c) as { loadout: { shield: boolean } }).loadout.shield).toBe(true);
  });
});

describe('ordres de déplacement', () => {
  it('une unité rejoint sa destination en suivant les rues ; vitesse bornée ; statut et journal cohérents', () => {
    const sim = line();
    const id = sim.addUnit(crs(7, { x: -400, y: 0 }), PLAN);
    const u = sim.entity(id)!;
    const res = sim.issueOrder({ kind: 'move', ids: [id], target: { x: 300, y: 0 } });
    expect(res[0]!.ok).toBe(true);
    expect(res[0]!.routeLengthM).toBeCloseTo(700, 0);
    expect(u.status).toBe('moving');
    let vmax = 0;
    runUntil(sim, () => {
      vmax = Math.max(vmax, u.speedMps);
      return u.status === 'idle';
    }, 20000);
    expect(u.status).toBe('idle');
    expect(Math.hypot(u.x - 300, u.y)).toBeLessThan(3);
    expect(vmax).toBeLessThanOrEqual(1.6 + 1e-9);
    expect(sim.timeMs / 1000).toBeGreaterThan(700 / 1.6 - 5); // l'arrivée est déclarée à moins de 2 m de la cible
    expect(sim.timeMs / 1000).toBeLessThan(700 / 1.6 + 15);
    expect(sim.journal.events.map((e) => e.code)).toEqual(['unit.created', 'unit.order', 'unit.arrived']);
    expect(sim.journal.byCode('unit.order')[0]!.why.kind).toBe('player_order');
  });

  it('un véhicule suit son ordre (jamais figé), cap lissé à rotation bornée, vitesse bornée', () => {
    const sim = grid();
    const id = sim.addVehicle({ vehicle: 'fourgon_crs', callsign: 'Transport CRS-J 07', crew: 9, pos: { x: -300, y: -200 } }, PLAN);
    const v = sim.entity(id)!;
    sim.issueOrder({ kind: 'move', ids: [id], target: { x: 280, y: 190 } });
    let maxTurn = 0;
    let maxStep = 0;
    let moved = false;
    for (let t = 0; t < 6000 && v.status !== 'idle'; t++) {
      sim.step();
      maxTurn = Math.max(maxTurn, Math.abs(Math.atan2(Math.sin(v.heading - v.prevHeading), Math.cos(v.heading - v.prevHeading))));
      maxStep = Math.max(maxStep, Math.hypot(v.x - v.px, v.y - v.py));
      if (Math.hypot(v.x - -300, v.y - -200) > 5) moved = true;
    }
    expect(moved).toBe(true);
    expect(v.status).toBe('idle');
    expect(maxTurn).toBeLessThanOrEqual(1.8 * 0.1 + 1e-6);
    expect(maxStep).toBeLessThanOrEqual(6 * 0.1 + 1e-6);
  });

  it('ordres simultanés : plusieurs unités et véhicules reçoivent un ordre ensemble et ne se superposent pas à l’arrivée', () => {
    const sim = grid();
    const ids = [crs(1, { x: -250, y: -150 }), crs(2, { x: -250, y: 150 }), crs(3, { x: 0, y: -150 }), crs(4, { x: 250, y: 150 })].map((s) => sim.addUnit(s, PLAN));
    const vid = sim.addVehicle({ vehicle: 'voiture_police', callsign: 'POL 21', crew: 3, pos: { x: 250, y: -150 } }, PLAN);
    const res = sim.issueOrder({ kind: 'move', ids: [...ids, vid], target: { x: 0, y: 0 } });
    expect(res.every((r) => r.ok)).toBe(true);
    runUntil(sim, () => [...ids, vid].every((i) => sim.entity(i)!.status === 'idle'), 30000);
    const pts = [...ids, vid].map((i) => sim.entity(i)!);
    for (let a = 0; a < pts.length; a++) for (let b = a + 1; b < pts.length; b++) expect(Math.hypot(pts[a]!.x - pts[b]!.x, pts[a]!.y - pts[b]!.y)).toBeGreaterThan(0.5);
    expect(sim.journal.byCode('unit.order')).toHaveLength(5);
    expect(sim.journal.byCode('unit.arrived')).toHaveLength(5);
  });

  it('un ordre donné en pause est mis en file, exécuté au tick suivant ; l’aperçu ne modifie pas l’état', () => {
    const sim = line();
    const id = sim.addUnit(crs(1, { x: -300, y: 0 }), PLAN);
    const u = sim.entity(id)!;
    const preview = sim.previewOrder(id, { x: 200, y: 0 });
    expect(preview!.length).toBeCloseTo(500, 0);
    expect(u.status).toBe('idle');
    sim.enqueue({ kind: 'move', ids: [id], target: { x: 200, y: 0 } });
    expect(u.status).toBe('idle'); // rien tant que le moteur ne tourne pas (pause)
    const hash = sim.stateHash();
    expect(sim.stateHash()).toBe(hash);
    sim.step();
    expect(sim.lastOrderResults[0]!.ok).toBe(true);
    expect(u.status).toBe('moving');
  });

  it('annulation : l’unité s’arrête et reste disponible ; annuler sans ordre est signalé', () => {
    const sim = line();
    const id = sim.addUnit(crs(1, { x: -300, y: 0 }), PLAN);
    sim.issueOrder({ kind: 'move', ids: [id], target: { x: 300, y: 0 } });
    sim.run(100);
    const u = sim.entity(id)!;
    const x = u.x;
    expect(sim.issueOrder({ kind: 'cancel', ids: [id] })[0]!.ok).toBe(true);
    expect(u.status).toBe('idle');
    sim.run(100);
    expect(u.speedMps).toBe(0);
    expect(Math.abs(u.x - x)).toBeLessThan(2); // freinage résiduel seulement
    expect(sim.journal.byCode('unit.cancelled')).toHaveLength(1);
    expect(sim.issueOrder({ kind: 'cancel', ids: [id] })[0]).toMatchObject({ ok: false });
  });

  it('ordre impossible : refusé avec raison explicite et journal, sans changer l’état de l’unité', () => {
    const sim = line();
    const id = sim.addUnit(crs(1, { x: -300, y: 0 }), PLAN);
    sim.closeStreet(4, PLAN); // coupe le couloir
    const res = sim.issueOrder({ kind: 'move', ids: [id], target: { x: 300, y: 0 } });
    expect(res[0]).toMatchObject({ ok: false, reason: 'aucun itinéraire vers la destination' });
    expect(sim.entity(id)!.status).toBe('idle');
    expect(sim.journal.byCode('unit.order_refused')).toHaveLength(1);
    expect(sim.issueOrder({ kind: 'move', ids: ['U-99'], target: { x: 0, y: 0 } })[0]).toMatchObject({ ok: false, reason: 'entité inconnue' });
  });
});

describe('rues bloquées et foules pour les unités', () => {
  it('rue fermée en cours de route : détour sans demi-tour, cause = événement ; attente puis reprise si aucun itinéraire', () => {
    const sim = grid();
    const id = sim.addUnit(crs(1, { x: -300, y: 0 }), PLAN);
    const u = sim.entity(id)!;
    sim.issueOrder({ kind: 'move', ids: [id], target: { x: 300, y: 0 } });
    sim.run(100);
    const edge = u.route!.edges[Math.min(u.route!.edges.length - 1, 4)] as number;
    sim.closeStreet(edge, { kind: 'scenario_event', refId: 'ev-x', note: 'travaux fictifs' });
    sim.run(5);
    const rr = sim.journal.byCode('unit.rerouted')[0]!;
    expect(rr.why).toMatchObject({ kind: 'scenario_event', refId: 'ev-x' });
    runUntil(sim, () => u.status === 'idle', 30000);
    expect(Math.hypot(u.x - 300, u.y)).toBeLessThan(3);

    // couloir unique : attente puis reprise
    const lineSim = line();
    const id2 = lineSim.addUnit(crs(2, { x: -300, y: 0 }), PLAN);
    const u2 = lineSim.entity(id2)!;
    lineSim.issueOrder({ kind: 'move', ids: [id2], target: { x: 300, y: 0 } });
    lineSim.run(50);
    const e2 = u2.route!.edges[3] as number;
    lineSim.closeStreet(e2, { kind: 'scenario_event', refId: 'barrage', note: 'barrage' });
    lineSim.run(30);
    expect(u2.status).toBe('waiting');
    lineSim.openStreet(e2, { kind: 'scenario_event', refId: 'fin', note: 'fin du barrage' });
    lineSim.run(30);
    expect(u2.status).toBe('moving');
    runUntil(lineSim, () => u2.status === 'idle', 30000);
    expect(Math.hypot(u2.x - 300, u2.y)).toBeLessThan(3);
  });

  it('un véhicule ne peut pas traverser une rue dont la section est occupée ; une unité à pied traverse une foule clairsemée', () => {
    const mk = () => {
      const sim = new Sim({ graph: gridGraph({ cols: 9, rows: 1, spacing: 100, width: 8 }), seed: 1, mask: null });
      sim.createGroup({ label: 'Foule', kind: 'static', size: 150, origin: { x: 0, y: 0 }, anchor: anchorAt({ x: 0, y: 0 }) }, PLAN);
      sim.run(10);
      return sim;
    };
    const sim = mk();
    const vid = sim.addVehicle({ vehicle: 'fourgon_police', callsign: 'V', crew: 3, pos: { x: -350, y: 0 } }, PLAN);
    const res = sim.issueOrder({ kind: 'move', ids: [vid], target: { x: 350, y: 0 } });
    expect(res[0]!.ok).toBe(false); // largeur libre < 3,5 m : bloquée pour les véhicules
    const uid = sim.addUnit(crs(1, { x: -350, y: 0 }), PLAN);
    const res2 = sim.issueOrder({ kind: 'move', ids: [uid], target: { x: 350, y: 0 } });
    expect(res2[0]!.ok).toBe(true);
  });

  it('aucun déplacement instantané : déplacement par tick ≤ vitesse maximale × pas', () => {
    const sim = grid();
    const ids = [sim.addUnit(crs(1, { x: -300, y: -200 }), PLAN), sim.addVehicle({ vehicle: 'ambulance', callsign: 'AMB', crew: 2, pos: { x: 300, y: 200 } }, PLAN)];
    sim.issueOrder({ kind: 'move', ids, target: { x: 0, y: 0 } });
    let worst = 0;
    for (let t = 0; t < 4000; t++) {
      sim.step();
      for (const id of ids) {
        const e = sim.entity(id)!;
        const v = e.mode === 'vehicle' ? 6 : 1.6;
        worst = Math.max(worst, Math.hypot(e.x - e.px, e.y - e.py) / (v * 0.1));
      }
    }
    expect(worst).toBeLessThanOrEqual(1 + 1e-6);
  });

  it('reproductibilité : mêmes ordres ⇒ même empreinte (unités comprises)', () => {
    const run = () => {
      const sim = grid();
      const a = sim.addUnit(crs(1, { x: -300, y: -200 }), PLAN);
      const b = sim.addVehicle({ vehicle: 'camion_a_eau', callsign: 'LE-1', crew: 3, pos: { x: 300, y: 200 } }, PLAN);
      sim.issueOrder({ kind: 'move', ids: [a, b], target: { x: 0, y: 0 } });
      sim.run(800);
      return sim.stateHash();
    };
    expect(run()).toBe(run());
  });
});
