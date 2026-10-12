/**
 * Production des paquets de ville OpenStreetMap — voir docs/DONNEES_OSM.md.
 *   npm run data:pack -- --city metz --input export-metz.json
 * Aucun accès réseau sans `--fetch --confirm-network`.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { gzipSync } from 'node:zlib';
import { CliUsageError, PackSafetyError, parseArgs, runPackCli, type CliDeps } from '../src/nav/osm/packCli';

const deps: CliDeps = {
  async readText(path) {
    try {
      return await readFile(path, 'utf8');
    } catch {
      return null;
    }
  },
  async writeText(path, text) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, text);
  },
  async writeGz(path, text) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, gzipSync(Buffer.from(text, 'utf8'), { level: 9 }));
  },
  async postOverpass(endpoint, query, userAgent) {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'User-Agent': userAgent, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: `data=${encodeURIComponent(query)}`,
    });
    return { status: res.status, text: res.status === 200 ? await res.text() : '' };
  },
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  now: () => new Date().toISOString(),
  log: (l) => console.log(l),
};

try {
  const result = await runPackCli(parseArgs(process.argv.slice(2)), deps);
  console.log(`\nTerminé : ${result.built.length} paquet(s) produit(s), ${result.skipped.length} ignoré(s), ${result.requests} requête(s) réseau.`);
  if (result.skipped.length && !result.built.length) process.exitCode = 1;
} catch (e) {
  if (e instanceof CliUsageError || e instanceof PackSafetyError) {
    console.error(`Erreur : ${e.message}`);
    process.exitCode = 2;
  } else throw e;
}
