import { PRESET_CITIES } from '../../geo/cities';
import { MAX_QUERY_AREA_KM2, PACK_HALF_HEIGHT_M, PACK_HALF_WIDTH_M, PackSafetyError, bboxAround, buildCityPack, checkBboxSafety, licenseText, overpassQuery, type CitySpec } from './packBuild';

export interface CliArgs {
  cities: string[];
  input?: string;
  fetch: boolean;
  confirmNetwork: boolean;
  endpoint: string;
  out: string;
  rawDir: string;
  buildings: boolean;
  userAgent: string;
  delayS: number;
  maxAreaKm2: number;
  printQuery: boolean;
  help: boolean;
}

export const DEFAULT_ENDPOINT = 'https://overpass-api.de/api/interpreter';

export class CliUsageError extends Error {}

export function parseArgs(argv: string[]): CliArgs {
  const a: CliArgs = {
    cities: [],
    fetch: false,
    confirmNetwork: false,
    endpoint: DEFAULT_ENDPOINT,
    out: 'public/data/osm',
    rawDir: 'data/osm/raw',
    buildings: true,
    userAgent: '',
    delayS: 20,
    maxAreaKm2: MAX_QUERY_AREA_KM2,
    printQuery: false,
    help: false,
  };
  const need = (i: number, flag: string): string => {
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) throw new CliUsageError(`${flag} attend une valeur.`);
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i] as string;
    switch (t) {
      case '--city':
        a.cities.push(...need(i++, t).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
        break;
      case '--input':
        a.input = need(i++, t);
        break;
      case '--out':
        a.out = need(i++, t);
        break;
      case '--raw-dir':
        a.rawDir = need(i++, t);
        break;
      case '--endpoint':
        a.endpoint = need(i++, t);
        break;
      case '--user-agent':
        a.userAgent = need(i++, t);
        break;
      case '--delay':
        a.delayS = Number(need(i++, t));
        if (!(a.delayS >= 0)) throw new CliUsageError('--delay doit être un nombre de secondes ≥ 0.');
        break;
      case '--max-area-km2':
        a.maxAreaKm2 = Number(need(i++, t));
        break;
      case '--fetch':
        a.fetch = true;
        break;
      case '--confirm-network':
        a.confirmNetwork = true;
        break;
      case '--print-query':
        a.printQuery = true;
        break;
      case '--no-buildings':
        a.buildings = false;
        break;
      case '-h':
      case '--help':
        a.help = true;
        break;
      default:
        throw new CliUsageError(`Option inconnue : ${t}`);
    }
  }
  return a;
}

export const USAGE = `Production des paquets de ville OpenStreetMap (hors ligne par défaut).

Usage : npm run data:pack -- --city <metz|paris|lyon|marseille|all> [options]

Modes (un seul) :
  --print-query            affiche la requête Overpass de chaque ville (aucun accès réseau) pour un export manuel
  --input <fichier.json>   réponse Overpass JSON déjà téléchargée (aucun accès réseau)        [recommandé]
  (rien)                   utilise le cache data/osm/raw/<ville>.overpass.json s'il existe (aucun accès réseau)
  --fetch --confirm-network  UNE requête bornée par ville vers --endpoint (accès réseau, voir docs/DONNEES_OSM.md)

Options : --out <dossier> (défaut public/data/osm) · --raw-dir <dossier> (cache brut) · --endpoint <url> ·
          --user-agent "<application + contact>" (obligatoire avec --fetch) · --delay <s> (pause entre villes, défaut 20) ·
          --no-buildings · --max-area-km2 <n> (défaut ${MAX_QUERY_AREA_KM2})
`;

/** Accès système injectables (tests sans disque ni réseau). */
export interface CliDeps {
  readText(path: string): Promise<string | null>;
  writeText(path: string, text: string): Promise<void>;
  writeGz(path: string, text: string): Promise<void>;
  postOverpass(endpoint: string, query: string, userAgent: string): Promise<{ status: number; text: string }>;
  sleep(ms: number): Promise<void>;
  now(): string;
  log(line: string): void;
}

export interface CliResult {
  built: string[];
  skipped: Array<{ city: string; reason: string }>;
  requests: number;
}

const join = (...p: string[]) => p.join('/').replace(/\/+/g, '/');

/** Logique complète de la CLI, sans accès direct au réseau ni au disque. */
export async function runPackCli(args: CliArgs, deps: CliDeps): Promise<CliResult> {
  const result: CliResult = { built: [], skipped: [], requests: 0 };
  if (args.help || args.cities.length === 0) {
    deps.log(USAGE);
    return result;
  }
  const wanted = args.cities.includes('all') ? PRESET_CITIES.map((c) => c.id) : args.cities;
  const specs: CitySpec[] = [];
  for (const id of wanted) {
    const c = PRESET_CITIES.find((p) => p.id === id);
    if (!c) throw new CliUsageError(`Ville inconnue : « ${id} » (villes prises en charge : ${PRESET_CITIES.map((p) => p.id).join(', ')}).`);
    specs.push({ id: c.id, name: c.name, center: c.center });
  }
  if (args.printQuery) {
    for (const c of specs) {
      const bbox = bboxAround(c.center, PACK_HALF_WIDTH_M, PACK_HALF_HEIGHT_M);
      checkBboxSafety(bbox, args.maxAreaKm2);
      deps.log(`// ${c.name}\n${overpassQuery(bbox, { buildings: args.buildings })}\n`);
    }
    return result;
  }
  if (args.input && specs.length !== 1) throw new CliUsageError('--input ne s’utilise qu’avec une seule ville (--city <ville>).');
  if (args.fetch && !args.confirmNetwork) throw new CliUsageError('--fetch exige --confirm-network : cette option contacte un service public (voir docs/DONNEES_OSM.md).');
  if (args.fetch && args.input) throw new CliUsageError('--fetch et --input sont exclusifs.');
  if (args.fetch && args.userAgent.trim().length < 8) throw new CliUsageError('--fetch exige --user-agent "<application + contact>" identifiant votre usage (politique des services publics).');

  for (let k = 0; k < specs.length; k++) {
    const city = specs[k] as CitySpec;
    const bbox = bboxAround(city.center, PACK_HALF_WIDTH_M, PACK_HALF_HEIGHT_M);
    checkBboxSafety(bbox, args.maxAreaKm2);
    const rawPath = join(args.rawDir, `${city.id}.overpass.json`);
    let raw: string | null = null;
    if (args.input) {
      raw = await deps.readText(args.input);
      if (raw === null) throw new CliUsageError(`Fichier introuvable : ${args.input}`);
    } else if (args.fetch) {
      if (k > 0 && args.delayS > 0) {
        deps.log(`Pause de ${args.delayS} s entre deux villes (usage raisonnable du service)…`);
        await deps.sleep(args.delayS * 1000);
      }
      const query = overpassQuery(bbox, { buildings: args.buildings });
      deps.log(`[${city.name}] UNE requête vers ${args.endpoint} (emprise ${PACK_HALF_WIDTH_M * 2} × ${PACK_HALF_HEIGHT_M * 2} m)…`);
      result.requests++;
      const res = await deps.postOverpass(args.endpoint, query, args.userAgent);
      if (res.status === 429 || res.status === 504) {
        result.skipped.push({ city: city.id, reason: `le service est surchargé ou limite l'usage (HTTP ${res.status}) : réessayez plus tard, ou importez un export manuel avec --input.` });
        continue;
      }
      if (res.status !== 200) {
        result.skipped.push({ city: city.id, reason: `réponse HTTP ${res.status} du service.` });
        continue;
      }
      raw = res.text;
      await deps.writeText(rawPath, raw);
      deps.log(`[${city.name}] réponse brute conservée dans ${rawPath} (réutilisable hors ligne).`);
    } else {
      raw = await deps.readText(rawPath);
      if (raw === null) {
        result.skipped.push({ city: city.id, reason: `aucune donnée : fournissez --input <export Overpass JSON> ou placez-le dans ${rawPath} (procédure : docs/DONNEES_OSM.md).` });
        continue;
      }
    }
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      result.skipped.push({ city: city.id, reason: 'fichier non valide (JSON attendu).' });
      continue;
    }
    const generatedAt = deps.now();
    const osmTs = (json as { osm3s?: { timestamp_osm_base?: string } }).osm3s?.timestamp_osm_base;
    const { pack, report } = buildCityPack(city, json, { generatedAt, bbox, osmTimestamp: osmTs });
    if (report.edges === 0) {
      result.skipped.push({ city: city.id, reason: 'aucune voie exploitable dans les données : le jeu utilisera le fond schématique.' });
      continue;
    }
    const graphPath = join(args.out, `${city.id}.graph.json`);
    const text = JSON.stringify(pack);
    await deps.writeText(graphPath, text);
    await deps.writeGz(`${graphPath}.gz`, text);
    await deps.writeText(join(args.out, `${city.id}.report.json`), JSON.stringify({ city: city.id, generatedAt, bbox, ...report }, null, 2));
    await deps.writeText(join(args.out, 'LICENSE-ODbL.md'), licenseText(city, generatedAt));
    result.built.push(city.id);
    deps.log(`[${city.name}] ${report.edges} arêtes, ${report.nodes} nœuds, ${report.lengthKm.toFixed(1)} km de voies, ${report.spaces} places/parcs, ${report.obstacles} bâtiments → ${graphPath}`);
    for (const w of report.warnings) deps.log(`[${city.name}] ⚠ ${w}`);
  }
  if (result.skipped.length) for (const s of result.skipped) deps.log(`[${s.city}] ignorée : ${s.reason}`);
  return result;
}

export { PackSafetyError };
