import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PRESET_CITIES } from '../../src/geo/cities';
import { NavContext } from '../../src/nav/astar';
import { DEFAULT_NAV_PARAMS } from '../../src/nav/params';
import { PACK_FORMAT, PackError, packGraph, unpackGraph } from '../../src/nav/pack';
import { loadCityPack } from '../../src/nav/packLoader';
import { buildGraphFromOverpassJson } from '../../src/nav/osm/buildGraph';
import { MAX_QUERY_AREA_KM2, PackSafetyError, bboxAreaKm2, bboxAround, buildCityPack, checkBboxSafety, licenseText, overpassQuery } from '../../src/nav/osm/packBuild';
import { CliUsageError, parseArgs, runPackCli, type CliDeps } from '../../src/nav/osm/packCli';
import { createEdgeState } from '../../src/nav/streetState';

const fixtureText = readFileSync(new URL('../fixtures/overpass-mini.json', import.meta.url), 'utf8');
const fixture = JSON.parse(fixtureText);
const metz = PRESET_CITIES.find((c) => c.id === 'metz')!;
const city = { id: metz.id, name: metz.name, center: metz.center };

describe('paquet de ville : sérialisation', () => {
  const { graph } = buildGraphFromOverpassJson(fixture, { origin: city.center });
  const meta = { city: 'metz', name: 'Metz', generatedAt: '2026-10-12T00:00:00Z', source: 'osm' as const, attribution: '© contributeurs OpenStreetMap', license: 'ODbL 1.0' };

  it('aller-retour sans perte (JSON → paquet → JSON → graphe)', () => {
    const text = JSON.stringify(packGraph(graph, meta));
    const back = unpackGraph(JSON.parse(text)).graph;
    expect(back.nodeCount).toBe(graph.nodeCount);
    expect(back.edgeCount).toBe(graph.edgeCount);
    Array.from(back.edgeLen).forEach((l, i) => expect(l).toBeCloseTo(graph.edgeLen[i] as number, 3)); // longueurs recalculées depuis la géométrie
    expect(Array.from(back.edgeWidth)).toEqual(Array.from(graph.edgeWidth));
    expect(Array.from(back.edgeFlags)).toEqual(Array.from(graph.edgeFlags));
    expect(back.edgeName).toEqual(graph.edgeName);
    expect(Array.from(back.shape)).toEqual(Array.from(graph.shape));
    expect(back.spaces.map((s) => [s.kind, s.name])).toEqual(graph.spaces.map((s) => [s.kind, s.name]));
    expect(back.obstacles.map((o) => o.name)).toEqual(graph.obstacles.map((o) => o.name));
    expect(back.provenance.source).toBe('osm');
  });

  it('le graphe relu produit les mêmes itinéraires que l’original', () => {
    const back = unpackGraph(JSON.parse(JSON.stringify(packGraph(graph, meta)))).graph;
    const a = new NavContext(graph, DEFAULT_NAV_PARAMS, createEdgeState(graph)).findRoute({ x: 0, y: 0 }, { x: 290, y: 150 }, 'crowd')!;
    const b = new NavContext(back, DEFAULT_NAV_PARAMS, createEdgeState(back)).findRoute({ x: 0, y: 0 }, { x: 290, y: 150 }, 'crowd')!;
    expect(a).not.toBeNull();
    expect(b.length).toBeCloseTo(a.length, 3);
    expect(Array.from(b.edges)).toEqual(Array.from(a.edges));
  });

  it('refuse un fichier inconnu, une autre version, un contenu tronqué ou incohérent (erreurs claires)', () => {
    const good = JSON.parse(JSON.stringify(packGraph(graph, meta)));
    expect(() => unpackGraph(null)).toThrow(PackError);
    expect(() => unpackGraph({ format: 'autre' })).toThrow(/inconnu/);
    expect(() => unpackGraph({ ...good, version: 99 })).toThrow(/Version/);
    expect(() => unpackGraph({ ...good, graph: { ...good.graph, nodeX: good.graph.nodeX.slice(0, 8) } })).toThrow(/corrompu/);
    expect(() => unpackGraph({ ...good, graph: { ...good.graph, edgeName: [] } })).toThrow(/corrompu/);
    expect(good.format).toBe(PACK_FORMAT);
  });

  it('chargeur : paquet trouvé, 404 → null, page HTML (serveur de dev) → null, fichier corrompu → erreur', async () => {
    const body = JSON.stringify(packGraph(graph, meta));
    const mk = (status: number, type: string, text: string) => (async () => new Response(text, { status, headers: { 'content-type': type } })) as unknown as typeof fetch;
    const ok = await loadCityPack('metz', mk(200, 'application/json', body));
    expect(ok?.graph.edgeCount).toBe(graph.edgeCount);
    expect(ok?.meta.license).toBe('ODbL 1.0');
    expect(await loadCityPack('metz', mk(404, 'text/plain', ''))).toBeNull();
    expect(await loadCityPack('metz', mk(200, 'text/html', '<html></html>'))).toBeNull();
    await expect(loadCityPack('metz', mk(200, 'application/json', '{"format":"x"'))).rejects.toThrow(PackError);
    expect(await loadCityPack('metz', (async () => { throw new TypeError('réseau'); }) as never)).toBeNull();
  });
});

describe('requête Overpass : bornée et sobre', () => {
  it('une seule requête avec emprise, délai d’attente, sortie JSON ; multipolygones demandés avec leur géométrie ; bâtiments optionnels', () => {
    const b = bboxAround(city.center);
    const q = overpassQuery(b);
    expect(q).toContain('[out:json][timeout:90]');
    expect(q).toContain(`${b.south.toFixed(6)},${b.west.toFixed(6)},${b.north.toFixed(6)},${b.east.toFixed(6)}`);
    expect(q).toContain('way["highway"]');
    expect(q).toContain('way["building"]');
    expect(q).toContain('relation["type"="multipolygon"]["place"="square"]');
    expect(q).toContain('out geom;');
    expect(overpassQuery(b, { buildings: false })).not.toContain('building');
  });
  it('l’emprise par défaut d’une ville reste sous le plafond ; une emprise trop grande est refusée', () => {
    const b = bboxAround(city.center);
    expect(bboxAreaKm2(b)).toBeGreaterThan(8);
    expect(bboxAreaKm2(b)).toBeLessThan(MAX_QUERY_AREA_KM2);
    expect(() => checkBboxSafety(b)).not.toThrow();
    expect(() => checkBboxSafety(bboxAround(city.center, 5000, 5000))).toThrow(PackSafetyError);
  });
  it('le texte de licence cite ODbL, l’attribution et l’obligation de redistribution', () => {
    const t = licenseText(city, '2026-10-12');
    expect(t).toContain('ODbL');
    expect(t).toContain('Contributeurs OpenStreetMap');
    expect(t).toContain('redistribuez');
  });
  it('buildCityPack produit un paquet avec rapport et attribution (fixture)', () => {
    const { pack, report } = buildCityPack(city, fixture, { generatedAt: '2026-10-12T00:00:00Z' });
    expect(pack.meta.license).toBe('ODbL 1.0');
    expect(report.edges).toBe(18);
    expect(report.warnings.join(' ')).toContain('relations');
  });
});

describe('CLI de production des paquets', () => {
  const mkDeps = (opts: { files?: Record<string, string>; post?: CliDeps['postOverpass'] } = {}) => {
    const files = new Map(Object.entries(opts.files ?? {}));
    const written = new Map<string, string>();
    const gz: string[] = [];
    const logs: string[] = [];
    const sleeps: number[] = [];
    const posts: Array<{ endpoint: string; query: string; userAgent: string }> = [];
    const deps: CliDeps = {
      readText: async (p) => files.get(p) ?? null,
      writeText: async (p, t) => void written.set(p, t),
      writeGz: async (p) => void gz.push(p),
      postOverpass:
        opts.post ??
        (async (endpoint, query, userAgent) => {
          posts.push({ endpoint, query, userAgent });
          return { status: 200, text: fixtureText };
        }),
      sleep: async (ms) => void sleeps.push(ms),
      now: () => '2026-10-12T00:00:00Z',
      log: (l) => logs.push(l),
    };
    return { deps, files, written, gz, logs, sleeps, posts };
  };
  const noNetwork: CliDeps['postOverpass'] = async () => {
    throw new Error('accès réseau interdit dans ce test');
  };

  it('analyse des options et refus des combinaisons dangereuses', () => {
    expect(parseArgs(['--city', 'metz,paris', '--input', 'x.json']).cities).toEqual(['metz', 'paris']);
    expect(() => parseArgs(['--bizarre'])).toThrow(CliUsageError);
    expect(() => parseArgs(['--city'])).toThrow(CliUsageError);
  });

  it('--print-query : affiche la requête de chaque ville sans accès réseau ni écriture', async () => {
    const t = mkDeps({ post: noNetwork });
    const r = await runPackCli(parseArgs(['--city', 'metz,lyon', '--print-query']), t.deps);
    expect(r.requests).toBe(0);
    expect(t.written.size).toBe(0);
    const out = t.logs.join('\n');
    expect(out).toContain('// Metz');
    expect(out).toContain('// Lyon');
    expect(out).toContain('[out:json]');
  });

  it('--input : produit graphe, version .gz, rapport et licence ; AUCUNE requête réseau', async () => {
    const t = mkDeps({ files: { 'export.json': fixtureText }, post: noNetwork });
    const r = await runPackCli(parseArgs(['--city', 'metz', '--input', 'export.json', '--out', 'out']), t.deps);
    expect(r.built).toEqual(['metz']);
    expect(r.requests).toBe(0);
    expect([...t.written.keys()].sort()).toEqual(['out/LICENSE-ODbL.md', 'out/metz.graph.json', 'out/metz.report.json']);
    expect(t.gz).toEqual(['out/metz.graph.json.gz']);
    const unpacked = unpackGraph(JSON.parse(t.written.get('out/metz.graph.json')!));
    expect(unpacked.graph.edgeCount).toBe(18);
    expect(JSON.parse(t.written.get('out/metz.report.json')!).edges).toBe(18);
  });

  it('sans donnée ni option réseau : rien n’est téléchargé, instructions claires', async () => {
    const t = mkDeps({ post: noNetwork });
    const r = await runPackCli(parseArgs(['--city', 'lyon']), t.deps);
    expect(r.built).toEqual([]);
    expect(r.requests).toBe(0);
    expect(r.skipped[0]!.reason).toContain('docs/DONNEES_OSM.md');
  });

  it('utilise le cache brut hors ligne s’il existe', async () => {
    const t = mkDeps({ files: { 'data/osm/raw/metz.overpass.json': fixtureText }, post: noNetwork });
    const r = await runPackCli(parseArgs(['--city', 'metz']), t.deps);
    expect(r.built).toEqual(['metz']);
    expect(r.requests).toBe(0);
  });

  it('--fetch exige la confirmation réseau et un User-Agent identifiant', async () => {
    const t = mkDeps();
    await expect(runPackCli(parseArgs(['--city', 'metz', '--fetch']), t.deps)).rejects.toThrow(/confirm-network/);
    await expect(runPackCli(parseArgs(['--city', 'metz', '--fetch', '--confirm-network']), t.deps)).rejects.toThrow(/user-agent/);
    await expect(runPackCli(parseArgs(['--city', 'metz', '--fetch', '--confirm-network', '--user-agent', 'x']), t.deps)).rejects.toThrow(/user-agent/);
    expect(t.posts).toHaveLength(0);
  });

  it('--fetch : exactement UNE requête par ville, User-Agent transmis, pause entre villes, cache brut conservé', async () => {
    const t = mkDeps();
    const r = await runPackCli(parseArgs(['--city', 'metz', '--fetch', '--confirm-network', '--user-agent', 'OrdrePublic-test (contact@exemple.org)', '--delay', '12', '--out', 'out']), t.deps);
    expect(r.requests).toBe(1);
    expect(t.posts).toHaveLength(1);
    expect(t.posts[0]!.userAgent).toContain('OrdrePublic-test');
    expect(t.posts[0]!.query).toContain('[out:json]');
    expect(t.written.has('data/osm/raw/metz.overpass.json')).toBe(true);
    // plusieurs villes : une requête chacune, pause entre elles ; la fixture est à Metz mais le test vérifie le protocole
    const t2 = mkDeps();
    const r2 = await runPackCli(parseArgs(['--city', 'metz,paris', '--fetch', '--confirm-network', '--user-agent', 'OrdrePublic-test (contact@exemple.org)', '--delay', '12']), t2.deps);
    expect(r2.requests).toBe(2);
    expect(t2.sleeps).toEqual([12000]);
  });

  it('service surchargé (429/504) : ville ignorée, aucune relance automatique', async () => {
    const t = mkDeps({ post: async () => ({ status: 429, text: '' }) });
    const r = await runPackCli(parseArgs(['--city', 'metz', '--fetch', '--confirm-network', '--user-agent', 'OrdrePublic-test (contact@exemple.org)']), t.deps);
    expect(r.requests).toBe(1);
    expect(r.built).toEqual([]);
    expect(r.skipped[0]!.reason).toContain('429');
  });

  it('villes inconnues, fichier introuvable, JSON invalide, aucune voie : erreurs ou ignorés explicites', async () => {
    const t = mkDeps({ files: { 'bad.json': '{pas du json', 'empty.json': '{"elements":[]}' }, post: noNetwork });
    await expect(runPackCli(parseArgs(['--city', 'atlantide']), t.deps)).rejects.toThrow(/inconnue/);
    await expect(runPackCli(parseArgs(['--city', 'metz', '--input', 'absent.json']), t.deps)).rejects.toThrow(/introuvable/);
    await expect(runPackCli(parseArgs(['--city', 'metz,paris', '--input', 'x.json']), t.deps)).rejects.toThrow(/une seule ville/);
    expect((await runPackCli(parseArgs(['--city', 'metz', '--input', 'bad.json']), t.deps)).skipped[0]!.reason).toContain('JSON');
    expect((await runPackCli(parseArgs(['--city', 'metz', '--input', 'empty.json']), t.deps)).skipped[0]!.reason).toContain('schématique');
  });
});
