import { describe, expect, it } from 'vitest';
import { GameController } from '../../src/game/controller';
import { buildSchematicGraph } from '../../src/nav/schematicGraph';
import { provideWorld } from '../../src/game/world';

const metz = { lng: 6.1757, lat: 49.1193 };
const graph = buildSchematicGraph(metz, 1400, 1050);
const make = () => new GameController({ graph, seed: 3 });

describe('contrôleur de jeu (pont moteur ↔ interface)', () => {
  it('l’horloge avance le moteur à pas fixe selon la vitesse, et la pause l’arrête', () => {
    const c = make();
    c.setSpeed(1);
    for (let i = 0; i < 20; i++) c.advance(50);
    expect(c.sim.tick).toBe(10);
    c.setSpeed(0);
    for (let i = 0; i < 20; i++) c.advance(50);
    expect(c.sim.tick).toBe(10);
    c.setSpeed(6);
    c.advance(100);
    expect(c.sim.tick).toBeGreaterThanOrEqual(15);
  });

  it('les statistiques proviennent du moteur', () => {
    const c = make();
    c.runTicks(5);
    const s = c.stats();
    expect(s.people).toBe(c.sim.totalPeople());
    expect(s.units).toBe(8);
    expect(s.vehicles).toBe(7);
    expect(s.forces).toBe(c.sim.units.reduce((a, u) => a + u.headcount, 0));
    expect(s.streets.total).toBeGreaterThan(20);
  });

  it('sélection : remplacement, extension (Maj) pour les unités, groupe épinglé en N2', () => {
    const c = make();
    c.runTicks(5);
    c.select({ type: 'unit', id: 'U-1' });
    c.select({ type: 'unit', id: 'U-2' }, true);
    c.select({ type: 'vehicle', id: 'V-1' }, true);
    expect(c.selectedMovers().map((e) => e.id)).toEqual(['U-1', 'U-2', 'V-1']);
    c.select({ type: 'unit', id: 'U-2' }, true);
    expect(c.selectedMovers().map((e) => e.id)).toEqual(['U-1', 'V-1']);
    c.select({ type: 'group', id: 'G-1' });
    expect(c.selection).toEqual([{ type: 'group', id: 'G-1' }]);
    c.select(null);
    expect(c.selection).toEqual([]);
  });

  it('ordre simultané : toute la sélection reçoit un itinéraire ; annulation ; refus signalé', () => {
    const c = make();
    c.select({ type: 'unit', id: 'U-1' });
    c.select({ type: 'unit', id: 'U-2' }, true);
    c.select({ type: 'vehicle', id: 'V-1' }, true);
    const p = c.sim.entity('U-1')!;
    const res = c.orderMove({ x: p.x + 80, y: p.y + 40 });
    expect(res.map((r) => r.ok)).toEqual([true, true, true]);
    c.runTicks(100);
    expect(c.sim.entity('U-1')!.status).toBe('moving');
    expect(c.sim.entity('U-1')!.speedMps).toBeGreaterThan(0.3);
    c.cancelOrders();
    c.runTicks(60);
    expect(['U-1', 'U-2', 'V-1'].map((id) => c.sim.entity(id)!.status)).toEqual(['idle', 'idle', 'idle']);
    // sans sélection : aucun ordre
    c.select(null);
    expect(c.orderMove({ x: 0, y: 0 })).toEqual([]);
  });

  it('pick : unités et véhicules d’abord, puis individus d’un groupe', () => {
    const c = make();
    c.runTicks(5);
    const u = c.sim.units[0]!;
    expect(c.pick({ x: u.x, y: u.y }, 3, true)).toEqual({ type: 'unit', id: u.id });
    expect(c.pick({ x: 9e5, y: 9e5 }, 3, true)).toBeNull();
    const g = c.sim.groups.find((x) => x.kind === 'static')!;
    const p = c.positionOf({ type: 'group', id: g.id })!;
    expect(c.pick(p, 6, true)?.type).toBe('group');
  });

  it('le journal est diffusé une seule fois à l’interface (bandeaux)', () => {
    const c = make();
    c.runTicks(5);
    const first = c.newEvents();
    expect(first.length).toBeGreaterThan(0);
    expect(c.newEvents()).toEqual([]);
    expect(first.every((e) => e.why.note.length > 0)).toBe(true);
  });

  it('le foyer d’attention suit la vue : une caméra qui revient vers un groupe lointain le fait passer par N0 → N1 → N2 sans aucun saut d’individu', () => {
    const c = make();
    c.setView({ x: 0, y: 0 }, 300);
    c.runTicks(200);
    const g = c.sim.group('G-1')!;
    // la caméra s'éloigne brusquement (hors de portée) : le cortège passe en N0 et n'est plus mis à jour
    c.setView({ x: 20000, y: 20000 }, 300);
    c.runTicks(300);
    expect(g.level).toBe(0);
    // la caméra revient par un trajet continu (vol de caméra à ~1 km/s) : on suit 5 individus répartis dans la colonne
    const probes = [0, 0.25, 0.5, 0.75, 0.99].map((f) => g.members.activeStart + Math.floor(f * (g.members.n - g.members.activeStart)));
    const last = probes.map((i) => ({ x: g.members.x[i]!, y: g.members.y[i]! }));
    const levels: number[] = [];
    let maxStep = 0; // plus grand déplacement par tick, mesuré tant que l'individu est à portée du niveau N2
    let maxStepFar = 0; // idem au-delà (niveaux N0/N1 : le réalignement sur la cible y est invisible)
    let nearSamples = 0;
    let cam = { x: 20000, y: 20000 };
    const from = { x: 20000, y: 20000 };
    const to = c.positionOf({ type: 'group', id: g.id })!;
    for (let k = 1; k <= 400; k++) {
      const f = Math.min(1, k / 200);
      cam = { x: from.x + (to.x - from.x) * f, y: from.y + (to.y - from.y) * f };
      c.setView(cam, 300);
      c.runTicks(1);
      if (levels[levels.length - 1] !== g.level) levels.push(g.level);
      probes.forEach((i, n) => {
        const cur = { x: g.members.x[i]!, y: g.members.y[i]! };
        const step = Math.hypot(cur.x - last[n]!.x, cur.y - last[n]!.y);
        // distance au bord du foyer (même définition que le moteur)
        const d = Math.hypot(cur.x - cam.x, cur.y - cam.y) - 300;
        if (d <= c.sim.params.lod.n2RadiusM) {
          maxStep = Math.max(maxStep, step);
          nearSamples++;
        } else maxStepFar = Math.max(maxStepFar, step);
        last[n] = cur;
      });
    }
    expect(levels.includes(1)).toBe(true);
    expect(levels[levels.length - 1]).toBe(2);
    // dès qu'un individu est dans la zone détaillée (donc potentiellement visible), son déplacement par tick (0,1 s)
    // reste physique : jamais de saut. Le réalignement des positions périmées (N0) se fait au loin, hors de vue.
    expect(nearSamples).toBeGreaterThan(50);
    expect(maxStep).toBeLessThan(c.sim.params.blendMaxSpeedMps * 0.1 + 0.5);
    expect(maxStepFar).toBeGreaterThan(0);
  }, 60_000);
});

describe('fourniture du monde (graphe cohérent avec le fond)', () => {
  const city = { id: 'metz', name: 'Metz', center: metz };
  it('fond schématique : graphe schématique, sans message', async () => {
    const w = await provideWorld(city, 'schematic');
    expect(w.kind).toBe('schematic');
    expect(w.notice).toBeUndefined();
  });
  it('fond OSM sans paquet : repli schématique expliqué', async () => {
    const w = await provideWorld(city, 'osm', async () => new Response('', { status: 404 }));
    expect(w.kind).toBe('schematic');
    expect(w.notice).toContain('Aucun paquet OSM');
  });
  it('fond OSM avec paquet valide : graphe du paquet', async () => {
    const { packGraph } = await import('../../src/nav/pack');
    const pack = packGraph(graph, { city: 'metz', name: 'Metz', generatedAt: '2000-01-01T00:00:00Z', source: 'synthetic', attribution: 'test', license: 'test' });
    const w = await provideWorld(city, 'osm', async () => new Response(JSON.stringify(pack), { status: 200, headers: { 'content-type': 'application/json' } }));
    expect(w.kind).toBe('osm');
    expect(w.graph.edgeCount).toBe(graph.edgeCount);
  });
  it('paquet invalide : repli schématique avec message', async () => {
    const w = await provideWorld(city, 'osm', async () => new Response('{"format":"autre"}', { status: 200, headers: { 'content-type': 'application/json' } }));
    expect(w.kind).toBe('schematic');
    expect(w.notice).toContain('invalide');
  });
});
