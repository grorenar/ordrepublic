/**
 * Banc d'essai reproductible du moteur de simulation (Node, sans navigateur).
 *   npm run bench:engine            → écrit docs/BENCHMARKS.md et affiche les résultats
 *   npm run bench:engine -- --quick → tailles réduites (vérification rapide)
 * Mesure, pour 5 000 / 10 000 / 25 000 / 50 000 personnes : temps d'un tick (moyenne, p50, p95, max),
 * mémoire, coût de mise en place, par niveau de simulation (N2 individuel, N1 sous-groupes, N0 agrégé) et par
 * type de scénario. Les valeurs dépendent de la machine : elles sont consignées avec sa description.
 */
import { writeFileSync } from 'node:fs';
import os from 'node:os';
import { Sim } from '../src/engine/sim';
import { memberBytes } from '../src/engine/members';
import { NavContext } from '../src/nav/astar';
import { DEFAULT_NAV_PARAMS } from '../src/nav/params';
import { buildSchematicGraph } from '../src/nav/schematicGraph';
import { createEdgeState } from '../src/nav/streetState';
import { WalkMask } from '../src/nav/walkMask';
import type { Anchor, Cause } from '../src/engine/types';
import { mulberry32 } from '../src/state/rng';
import { locate, type Located } from '../src/nav/route';

const quick = process.argv.includes('--quick');
const extended = process.argv.includes('--extended');
const SIZES = quick ? [5000, 10000] : extended ? [5000, 10000, 25000, 50000, 100000, 250000] : [5000, 10000, 25000, 50000];
const TICKS = quick ? 40 : 100;
const WARMUP = 15;
const HALF_W = 1400;
const HALF_H = 1050;
const ORIGIN = { lng: 6.1757, lat: 49.1193 };
const PLAN: Cause = { kind: 'scenario_plan', refId: 'bench', note: 'banc d’essai' };
const gc = (globalThis as { gc?: () => void }).gc;

const anchor = (x: number, y: number, label: string): Anchor => ({ id: label, kind: 'place', pos: { x, y }, radius: 20, label, source: 'synthetic' });
const mb = (b: number) => (b / 1048576).toFixed(1);
const fmt = (v: number) => (v < 10 ? v.toFixed(2) : v.toFixed(1));

function stats(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b);
  const mean = s.reduce((a, b) => a + b, 0) / s.length;
  return { mean, p50: s[Math.floor(s.length * 0.5)] as number, p95: s[Math.min(s.length - 1, Math.floor(s.length * 0.95))] as number, max: s[s.length - 1] as number };
}

const t0 = performance.now();
const graph = buildSchematicGraph(ORIGIN, HALF_W, HALF_H);
const tGraph = performance.now() - t0;
const t1 = performance.now();
const mask = WalkMask.fromGraph(graph, 1);
const tMask = performance.now() - t1;

type Scenario = 'giant-march' | 'multi-group' | 'static-only';
function populate(sim: Sim, n: number, scenario: Scenario): void {
  const rng = mulberry32(42);
  if (scenario === 'giant-march') {
    sim.createGroup({ label: 'Cortège géant', kind: 'march', size: n, origin: { x: -1300, y: -900 }, entry: 'gateway', plan: { destination: anchor(300, 200, 'Place centrale'), waypoints: [], onArrival: 'settle', patienceMs: 0 } }, PLAN);
    return;
  }
  const groups = 20;
  const each = Math.floor(n / groups);
  for (let k = 0; k < groups; k++) {
    const size = k === groups - 1 ? n - each * (groups - 1) : each;
    const ax = (rng() - 0.5) * 2200;
    const ay = (rng() - 0.5) * 1600;
    if (scenario === 'static-only' || k % 2 === 1) {
      sim.createGroup({ label: `Rassemblement ${k}`, kind: 'static', size, origin: { x: ax, y: ay }, anchor: anchor(ax, ay, `Lieu ${k}`) }, PLAN);
    } else {
      sim.createGroup({ label: `Cortège ${k}`, kind: 'march', size, origin: { x: -1300 + rng() * 200, y: -1000 + rng() * 2000 }, entry: 'gateway', plan: { destination: anchor(ax, ay, `Destination ${k}`), waypoints: [], onArrival: 'settle', patienceMs: 0 } }, PLAN);
    }
  }
}

interface Row {
  n: number;
  scenario: Scenario;
  level: string;
  setupMs: number;
  mean: number;
  p50: number;
  p95: number;
  max: number;
  arrayMB: number;
  bytesPerPerson: number;
  heapMB: number;
  groupsMs: number;
  membersMs: number;
  /** Part des individus (%) simulés à chaque niveau en fin de mesure : [N0, N1, N2]. */
  levels: [number, number, number];
}

function run(n: number, scenario: Scenario, level: 0 | 1 | 2 | 'mixed'): Row {
  gc?.();
  const mem0 = process.memoryUsage();
  const ts = performance.now();
  const sim = new Sim({
    graph,
    seed: 7,
    mask,
    zone: { halfWidth: HALF_W, halfHeight: HALF_H },
    params: { lod: { defaultLevel: level === 'mixed' ? 2 : level } },
  });
  populate(sim, n, scenario);
  const setupMs = performance.now() - ts;
  // niveau « mixte » : le foyer d'attention (rayon 250 m) suit le centre du premier groupe, comme une caméra qui le suit
  const loc: Located = { x: 0, y: 0, tx: 0, ty: 0, seg: 0 };
  const follow = () => {
    const g = sim.groups[0];
    if (!g) return;
    if (g.route && g.kind !== 'static') {
      locate(g.route, Math.max(0, Math.min(g.route.length, g.sCentre)), loc);
      sim.setFoci([{ x: loc.x, y: loc.y, radius: 250 }]);
    } else sim.setFoci([{ x: g.layout?.anchor.x ?? 0, y: g.layout?.anchor.y ?? 0, radius: 250 }]);
  };
  if (level === 'mixed') follow();
  let people = 0;
  let arr = 0;
  for (const g of sim.groups) {
    people += sim.size(g);
    arr += memberBytes(g.members) + (g.layout?.pts.byteLength ?? 0) + (g.dispersal?.dist.byteLength ?? 0);
  }
  gc?.();
  const mem1 = process.memoryUsage();
  const times: number[] = [];
  for (let i = 0; i < WARMUP; i++) {
    if (level === 'mixed') follow();
    sim.step();
  }
  sim.profile.groups = sim.profile.members = sim.profile.ticks = 0;
  for (let i = 0; i < TICKS; i++) {
    if (level === 'mixed') follow();
    const a = performance.now();
    sim.step();
    times.push(performance.now() - a);
  }
  const st = stats(times);
  const lv: [number, number, number] = [0, 0, 0];
  for (const g of sim.groups) {
    if (g.blocks) {
      for (let b = 0; b < g.blocks.level.length; b++) lv[g.blocks.level[b] as 0 | 1 | 2] += Math.min(g.blocks.size, g.members.n - b * g.blocks.size);
    } else lv[g.level] += sim.size(g);
  }
  const lvPct = lv.map((v) => (100 * v) / n) as [number, number, number];
  const used = mem1.heapUsed + mem1.arrayBuffers - (mem0.heapUsed + mem0.arrayBuffers);
  if (people !== n) throw new Error(`effectif inattendu ${people} ≠ ${n}`);
  return {
    n,
    scenario,
    level: level === 'mixed' ? 'mixte (foyer 250 m suivant le groupe)' : `N${level}`,
    setupMs,
    ...st,
    arrayMB: arr / 1048576,
    bytesPerPerson: arr / n,
    heapMB: Math.max(0, used) / 1048576,
    groupsMs: sim.profile.groups / TICKS,
    membersMs: sim.profile.members / TICKS,
    levels: lvPct,
  };
}

const rows: Row[] = [];
const scenarios: Scenario[] = ['giant-march', 'multi-group', 'static-only'];
const levels: Array<0 | 1 | 2 | 'mixed'> = [2, 1, 0, 'mixed'];
for (const scenario of scenarios) {
  for (const n of SIZES) {
    for (const level of levels) {
      if (scenario === 'static-only' && level === 'mixed') continue;
      const r = run(n, scenario, level);
      rows.push(r);
      console.log(`${scenario.padEnd(12)} n=${String(n).padStart(6)} ${r.level.padEnd(20)} tick moy ${fmt(r.mean)} ms  p95 ${fmt(r.p95)}  max ${fmt(r.max)}  mise en place ${Math.round(r.setupMs)} ms  tableaux ${r.arrayMB.toFixed(1)} Mo (${Math.round(r.bytesPerPerson)} o/pers.)`);
    }
  }
}

// --- navigation ---------------------------------------------------------------
const nav = new NavContext(graph, DEFAULT_NAV_PARAMS, createEdgeState(graph));
const rng = mulberry32(9);
const qs: number[] = [];
let found = 0;
for (let i = 0; i < 300; i++) {
  const a = { x: (rng() - 0.5) * 2600, y: (rng() - 0.5) * 1900 };
  const b = { x: (rng() - 0.5) * 2600, y: (rng() - 0.5) * 1900 };
  const s = performance.now();
  const r = nav.findRoute(a, b, i % 2 ? 'crowd' : 'vehicle');
  qs.push(performance.now() - s);
  if (r) found++;
}
const nq = stats(qs);

// --- rapport -----------------------------------------------------------------------
const cpu = os.cpus()[0]?.model ?? 'inconnu';
const lines: string[] = [];
lines.push('# Benchmarks du moteur de simulation (phase 3, mi-parcours)');
lines.push('');
lines.push('> Généré par `npm run bench:engine` — **valeurs dépendantes de la machine**, à reproduire sur la vôtre.');
lines.push('');
lines.push(`- Date : ${new Date().toISOString().slice(0, 10)} · Node ${process.version} · ${cpu} · ${os.cpus().length} cœurs · ${mb(os.totalmem())} Mo RAM`);
lines.push(`- Graphe : ville schématique ${graph.edgeCount} arêtes, ${graph.obstacles.length} bâtiments (zone ${HALF_W * 2}×${HALF_H * 2} m) — construction ${Math.round(tGraph)} ms ; masque de marche ${mask.cols}×${mask.rows} (${mb(mask.bytes)} Mo) — rasterisation ${Math.round(tMask)} ms`);
lines.push(`- Tailles : ${SIZES.join(' / ')} personnes${extended ? ' (mode étendu : recherche des limites au-delà de l\'objectif de 50 000)' : ''}.`);
lines.push(`- Protocole : graine fixe, ${WARMUP} ticks d'échauffement puis ${TICKS} ticks mesurés (pas de 100 ms de jeu), un seul fil, sans rendu.${quick ? ' **Mode rapide (--quick) : tailles réduites.**' : ''}`);
lines.push('- Niveaux : **N2** dynamique individuelle (rappel + bruit + rejet des bâtiments) · **N1** positions = cibles analytiques · **N0** rien n\'est mis à jour (positions évaluées à la demande) · **mixte** : foyer d\'attention de 250 m de rayon qui suit le centre du premier groupe (N2 à moins de 400 m de son bord, N1 jusqu\'à 2,5 km) ; pour un très gros groupe en marche (≥ 4 000), les niveaux sont attribués **par bloc de 256 individus**.');
lines.push('- Mémoire : « tableaux d\'individus » = taille exacte des tableaux typés (positions, cibles, graines, créneaux, disposition statique) ; « tas JS observé » = variation de `heapUsed + arrayBuffers` autour de la création (indicatif, bruité par le ramasse-miettes). Le masque de marche (grille d\'occupation) est compté à part.');
lines.push('- « Vitesse max soutenable » = multiple de vitesse de jeu pour lequel le moteur occuperait ≤ 50 % du temps réel (10 ticks de jeu par seconde à 1×) : `50 / tick_moyen_ms`.');
lines.push('');
for (const scenario of scenarios) {
  lines.push(`## Scénario « ${scenario} »`);
  lines.push('');
  lines.push('| Personnes | Niveau | Tick moy. (ms) | p50 | p95 | max | dont groupes / individus (ms) | Mise en place (ms) | Tableaux d’individus (Mo) | Octets/personne | Tas JS observé (Mo, approx.) | Individus N0/N1/N2 (%) | Vitesse max soutenable |');
  lines.push('|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
  for (const r of rows.filter((x) => x.scenario === scenario)) {
    lines.push(`| ${r.n} | ${r.level} | ${fmt(r.mean)} | ${fmt(r.p50)} | ${fmt(r.p95)} | ${fmt(r.max)} | ${fmt(r.groupsMs)} / ${fmt(r.membersMs)} | ${Math.round(r.setupMs)} | ${r.arrayMB.toFixed(1)} | ${Math.round(r.bytesPerPerson)} | ${r.heapMB.toFixed(1)} | ${r.levels.map((v) => Math.round(v)).join('/')} | ×${(50 / Math.max(r.mean, 0.001)).toFixed(0)} |`);
  }
  lines.push('');
}
lines.push('## Navigation (A*)');
lines.push('');
lines.push(`300 itinéraires aléatoires (piétons et véhicules alternés) sur le graphe de ${graph.edgeCount} arêtes : moyenne ${fmt(nq.mean)} ms, p95 ${fmt(nq.p95)} ms, max ${fmt(nq.max)} ms ; ${found}/300 trouvés.`);
lines.push('');
if (!quick) writeFileSync(new URL('../docs/BENCHMARKS.md', import.meta.url), lines.join('\n') + '\n');
console.log(`\nA* : moy ${fmt(nq.mean)} ms, p95 ${fmt(nq.p95)} ms (${found}/300)`);
console.log(`graphe ${Math.round(tGraph)} ms, masque ${Math.round(tMask)} ms`);
