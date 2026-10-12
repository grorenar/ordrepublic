// Génère tests/fixtures/overpass-mini.json : mini réponse Overpass SIMULÉE (écrite à la main, sans réseau)
// couvrant les cas de la politique de filtrage. Les noms sont fictifs.  Usage : node tests/fixtures/make-overpass-mini.mjs
import { writeFileSync } from 'node:fs';
const lat0 = 49.1193, lon0 = 6.1757, R = 6378137;
const rad = (d) => (d * Math.PI) / 180, deg = (r) => (r * 180) / Math.PI;
const ll = (x, y) => ({ lat: +(lat0 + deg(y / R)).toFixed(7), lon: +(lon0 + deg(x / (R * Math.cos(rad(lat0))))).toFixed(7) });
const els = [];
let nid = 1;
const nodes = new Map();
const node = (key, x, y) => { if (!nodes.has(key)) { const id = nid++; nodes.set(key, id); els.push({ type: 'node', id, ...ll(x, y) }); } return nodes.get(key); };
const way = (id, keys, tags) => els.push({ type: 'way', id, nodes: keys.map((k) => nodes.get(k)), tags });
// grille 4 colonnes x 3 lignes
for (let c = 0; c < 4; c++) for (let r = 0; r < 3; r++) node(`g${c}${r}`, c * 100, r * 80);
node('mid', 50, 6); // point de forme (non intersection) sur la rue de la ligne 0
node('steps-end', 300, 230);
for (let r = 0; r < 3; r++) {
  const keys = r === 0 ? ['g00', 'mid', 'g10', 'g20', 'g30'] : [0, 1, 2, 3].map((c) => `g${c}${r}`);
  if (r === 1) way(100 + r, keys, { highway: 'primary', name: 'Avenue Principale (fictive)', width: '14' });
  else way(100 + r, keys, { highway: 'residential', name: `Rue Horizontale ${r} (fictive)` });
}
way(200, ['g00', 'g01', 'g02'], { highway: 'residential', name: 'Rue Verticale 0 (fictive)' });
way(201, ['g10', 'g11', 'g12'], { highway: 'residential', name: 'Rue Verticale 1 (fictive)' });
way(202, ['g20', 'g21', 'g22'], { highway: 'residential', name: 'Sens Unique (fictif)', oneway: 'yes' });
way(203, ['g30', 'g31', 'g32'], { highway: 'pedestrian', name: 'Rue Piétonne (fictive)' });
way(204, ['g32', 'steps-end'], { highway: 'steps' });
// exclusions
node('mw1', -500, 500); node('mw2', 500, 500);
way(300, ['mw1', 'mw2'], { highway: 'motorway' });
node('sw1', 0, 3); node('sw2', 100, 3);
way(301, ['sw1', 'sw2'], { highway: 'footway', footway: 'sidewalk' });
node('pv1', 0, 400); node('pv2', 100, 400);
way(302, ['pv1', 'pv2'], { highway: 'service', access: 'private' });
way(303, ['pv1', 'pv2'], { highway: 'construction' });
// îlot déconnecté
node('is1', 2000, 2000); node('is2', 2100, 2000);
way(304, ['is1', 'is2'], { highway: 'residential', name: 'Rue Isolée (fictive)' });
// polygones
const ring = (id, pts, tags) => { const ks = pts.map(([x, y], i) => { const k = `p${id}-${i}`; node(k, x, y); return k; }); way(id, [...ks, ks[0]], tags); };
ring(400, [[110, 10], [190, 10], [190, 70], [110, 70]], { place: 'square', name: 'Place du Test (fictive)' });
ring(401, [[210, 10], [290, 10], [290, 70], [210, 70]], { leisure: 'park', name: 'Parc du Test (fictif)' });
ring(402, [[10, 90], [90, 90], [90, 150], [10, 150]], { building: 'retail', name: 'Commerce Test (fictif)' });
ring(403, [[110, 90], [190, 90], [190, 150], [110, 150]], { building: 'yes' });
els.push({ type: 'relation', id: 9, members: [], tags: { type: 'multipolygon', building: 'yes' } });
writeFileSync(new URL('./overpass-mini.json', import.meta.url), JSON.stringify({ version: 0.6, generator: 'fixture simulée', elements: els }, null, 1));
console.log('éléments :', els.length);
