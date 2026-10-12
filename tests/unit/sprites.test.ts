import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SpriteAtlas, type AtlasCanvas } from '../../src/render/sprites/atlas';
import { ImageSpriteProvider, MixedSpriteProvider } from '../../src/render/sprites/image';
import { DECOR_DIMENSIONS, decorSpriteId, defaultManifest, forceSpriteId, FORCE_CODES, ManifestIndex, validateManifest, VEHICLE_DIMENSIONS, vehicleSpriteId } from '../../src/render/sprites/manifest';
import { MARKERS, STATUS_MARKERS } from '../../src/render/sprites/markers';
import { ProceduralSpriteProvider } from '../../src/render/sprites/procedural';
import { appearanceOf, buildSnapshot, crowdPose, orientationIndex, type RenderablePose } from '../../src/render/sprites/snapshot';
import type { SpriteDef, SpriteManifest, SpriteQuery } from '../../src/render/sprites/types';
import { lodForZoom } from '../../src/render/lod';
import { GameController } from '../../src/game/controller';
import { buildSchematicGraph } from '../../src/nav/schematicGraph';
import type { ForceKind, VehicleKind } from '../../src/engine/types';

/** Canvas factice : enregistre les appels de dessin, sans DOM. */
function fakeCanvas(log: string[] = []) {
  return (w: number, h: number): AtlasCanvas => {
    const ctx = new Proxy({} as Record<string, unknown>, {
      get: (t, k: string) => (k in t ? t[k] : (...a: unknown[]) => void log.push(k + (k === 'fill' || k === 'stroke' ? '' : `(${a.length})`))),
      set: (t, k: string, v) => ((t[k] = v), true),
    });
    return { width: w, height: h, getContext: () => ctx } as unknown as AtlasCanvas;
  };
}

const q = (o: Partial<SpriteQuery> = {}): SpriteQuery => ({ id: 'person', variant: 0, orientation: 0, frame: 0, tier: 3, ppm: 8, ...o });
const index = () => new ManifestIndex(defaultManifest());

describe('manifeste de sprites', () => {
  it('est valide et couvre toutes les données sémantiques du moteur', () => {
    const m = defaultManifest();
    expect(validateManifest(m)).toEqual([]);
    const idx = new ManifestIndex(m);
    for (const f of Object.keys(FORCE_CODES) as ForceKind[]) for (const shield of [true, false]) for (const helmet of [true, false]) expect(idx.has(forceSpriteId(f, { shield, helmet })), `${f} ${shield} ${helmet}`).toBe(true);
    for (const v of Object.keys(VEHICLE_DIMENSIONS) as VehicleKind[]) expect(idx.has(vehicleSpriteId(v))).toBe(true);
    for (const d of Object.keys(DECOR_DIMENSIONS) as Array<keyof typeof DECOR_DIMENSIONS>) expect(idx.has(decorSpriteId(d))).toBe(true);
    for (const id of ['person', 'rescue.medic', 'rescue.firefighter', 'rescue.medical_team']) expect(idx.has(id)).toBe(true);
  });

  it('la validation détecte les défauts', () => {
    const base = defaultManifest().sprites[0] as SpriteDef;
    const bad: SpriteManifest = { version: 1, name: 'x', sprites: [base, { ...base }, { ...base, id: 'b', wM: 0 }, { ...base, id: 'c', anchor: { x: 2, y: 0 } }, { ...base, id: 'd', animations: {} }] };
    const errs = validateManifest(bad).join('|');
    expect(errs).toMatch(/double/);
    expect(errs).toMatch(/taille réelle/);
    expect(errs).toMatch(/ancrage/);
    expect(errs).toMatch(/idle/);
  });

  it('les CRS avec et sans bouclier sont des sprites distincts', () => {
    expect(forceSpriteId('crs', { shield: true, helmet: true })).toBe('force.crs.shield');
    expect(forceSpriteId('crs', { shield: false, helmet: true })).toBe('force.crs.bare');
    expect(forceSpriteId('unite_speciale', { shield: false, helmet: true })).toBe('force.us.helmet');
  });
});

describe('atlas', () => {
  it('range les cellules sans chevauchement, ouvre des planches puis signale la saturation', () => {
    const a = new SpriteAtlas(fakeCanvas(), 64, 2);
    const rects: Array<[number, number, number, number, number]> = [];
    let full = false;
    for (let i = 0; i < 200; i++) {
      const s = a.alloc(14, 10 + (i % 3));
      if (!s) {
        full = true;
        break;
      }
      rects.push([s.page, s.x, s.y, 14, 10]);
    }
    expect(full).toBe(true);
    expect(a.pageCount).toBe(2);
    for (let i = 0; i < rects.length; i++)
      for (let j = i + 1; j < rects.length; j++) {
        const [p1, x1, y1, w1, h1] = rects[i] as number[] as [number, number, number, number, number];
        const [p2, x2, y2, w2, h2] = rects[j] as number[] as [number, number, number, number, number];
        if (p1 !== p2) continue;
        expect(x1 + w1 <= x2 || x2 + w2 <= x1 || y1 + h1 <= y2 || y2 + h2 <= y1, `${i}/${j}`).toBe(true);
      }
    a.clear();
    expect(a.alloc(14, 10)).not.toBeNull();
  });
});

describe('fournisseur procédural', () => {
  it('sert depuis le cache : un même sprite n’est dessiné qu’une fois', () => {
    const p = new ProceduralSpriteProvider(index(), fakeCanvas());
    const a = p.get(q());
    const calls = p.drawCalls;
    const b = p.get(q());
    expect(a).not.toBeNull();
    expect(p.drawCalls).toBe(calls);
    expect(b?.sx).toBe(a?.sx);
  });

  it('chaque orientation, variante et image est une région distincte', () => {
    const p = new ProceduralSpriteProvider(index(), fakeCanvas());
    const seen = new Set<string>();
    for (let o = 0; o < 8; o++) for (let f = 0; f < 3; f++) {
      const r = p.get(q({ orientation: o, frame: f })) as NonNullable<ReturnType<typeof p.get>>;
      seen.add(`${r.sx},${r.sy}`);
    }
    expect(seen.size).toBe(24);
  });

  it('les orientations sont normalisées (négatives ou supérieures au nombre de secteurs)', () => {
    const p = new ProceduralSpriteProvider(index(), fakeCanvas());
    expect(p.get(q({ orientation: -1 }))?.sx).toBe(p.get(q({ orientation: 7 }))?.sx);
    expect(p.get(q({ orientation: 9 }))?.sx).toBe(p.get(q({ orientation: 1 }))?.sx);
  });

  it('la taille suit le zoom avec un minimum lisible', () => {
    const p = new ProceduralSpriteProvider(index(), fakeCanvas());
    const big = p.get(q({ ppm: 40 })) as NonNullable<ReturnType<typeof p.get>>;
    const small = p.get(q({ ppm: 4 })) as NonNullable<ReturnType<typeof p.get>>;
    const tiny = p.get(q({ ppm: 0.2 })) as NonNullable<ReturnType<typeof p.get>>;
    expect(big.w).toBeGreaterThan(small.w);
    expect(Math.max(tiny.w, tiny.h)).toBeGreaterThanOrEqual(5 - 1e-6); // minPx du sprite de personne
    expect(big.w).toBeCloseTo(Math.hypot(0.5, 0.62) * 40, 0);
  });

  it('une échelle voisine réutilise la même cellule d’atlas (quantification), mais s’affiche à la taille exacte', () => {
    const p = new ProceduralSpriteProvider(index(), fakeCanvas());
    const a = p.get(q({ ppm: 20 })) as NonNullable<ReturnType<typeof p.get>>;
    const b = p.get(q({ ppm: 20.5 })) as NonNullable<ReturnType<typeof p.get>>;
    expect(b.sx).toBe(a.sx);
    expect(b.w).toBeGreaterThan(a.w);
  });

  it('les accessoires n’existent qu’au palier détaillé (T3)', () => {
    const p = new ProceduralSpriteProvider(index(), fakeCanvas());
    const withAcc = 8 * 4 + 2; // drapeau, couleur 2
    expect(p.get(q({ variant: withAcc, tier: 2 }))?.sx).toBe(p.get(q({ variant: 2, tier: 2 }))?.sx);
    expect(p.get(q({ variant: withAcc, tier: 3 }))?.sx).not.toBe(p.get(q({ variant: 2, tier: 3 }))?.sx);
  });

  it('requête différée (foule) : null puis disponible après flush, jamais de dessin dans l’atlas pendant l’image', () => {
    const p = new ProceduralSpriteProvider(index(), fakeCanvas());
    expect(p.get(q({ deferred: true, variant: 9 }))).toBeNull();
    expect(p.get(q({ deferred: true, variant: 9 }))).toBeNull(); // pas de doublon en file
    expect(p.pendingCount).toBe(1);
    expect(p.drawCalls).toBe(0);
    expect(p.flush()).toBe(1);
    expect(p.get(q({ deferred: true, variant: 9 }))).not.toBeNull();
    for (let i = 0; i < 50; i++) p.get(q({ deferred: true, variant: i % 8, orientation: i % 8, frame: i % 3, ppm: 8 }));
    expect(p.flush(5)).toBe(5); // budget par image
    expect(p.pendingCount).toBeGreaterThan(0);
  });

  it('sprite inconnu : null ; dessin remplaçable sprite par sprite ou par famille', () => {
    const log: string[] = [];
    const p = new ProceduralSpriteProvider(index(), fakeCanvas(log));
    expect(p.get(q({ id: 'inconnu' }))).toBeNull();
    let hits = 0;
    p.register('vehicle.', () => void hits++);
    p.get(q({ id: 'vehicle.fourgon_crs', tier: 3 }));
    p.get(q({ id: 'vehicle.ambulance', tier: 3 }));
    expect(hits).toBe(2);
    let one = 0;
    p.register('decor.bin', () => void one++);
    p.get(q({ id: 'decor.bin' }));
    p.get(q({ id: 'decor.bench' }));
    expect(one).toBe(1);
  });

  it('tous les sprites du manifeste se dessinent sans erreur, à tous les paliers', () => {
    const idx = index();
    const p = new ProceduralSpriteProvider(idx, fakeCanvas());
    let n = 0;
    for (const def of idx.manifest.sprites) for (const tier of [2, 3] as const) {
      const r = p.get(q({ id: def.id, tier, variant: def.variants > 1 ? 30 : 0, frame: 1 }));
      expect(r, def.id).not.toBeNull();
      n++;
    }
    expect(n).toBeGreaterThan(60);
  });

  it('la saturation de l’atlas ne perd aucun sprite (redessiné à la demande)', () => {
    const idx = index();
    const p = new ProceduralSpriteProvider(idx, fakeCanvas());
    for (let i = 0; i < 400; i++) expect(p.get(q({ ppm: 4 + i * 0.7, variant: i % 48, orientation: i % 8 }))).not.toBeNull();
  });
});

describe('fournisseurs interchangeables et mélange', () => {
  it('une image remplace un sprite précis ; les autres restent procéduraux ; repli tant que l’image charge', () => {
    const m = defaultManifest();
    const bin = m.sprites.find((s) => s.id === 'decor.bin') as SpriteDef;
    bin.image = { file: 'bin.png', cellPx: 64 };
    const idx = new ManifestIndex(m);
    let ready = false;
    const urls: string[] = [];
    const images = new ImageSpriteProvider(idx, 'sprites/jeu/', (url) => {
      urls.push(url);
      return { image: {} as CanvasImageSource, ready: () => ready, failed: () => false };
    });
    const mixed = new MixedSpriteProvider([images, new ProceduralSpriteProvider(idx, fakeCanvas())]);
    expect(mixed.name).toBe('mixed(images>procedural)');
    const before = mixed.get(q({ id: 'decor.bin' })) as NonNullable<ReturnType<typeof mixed.get>>;
    expect(before.sw).not.toBe(64); // procédural en attendant
    ready = true;
    const after = mixed.get(q({ id: 'decor.bin' })) as NonNullable<ReturnType<typeof mixed.get>>;
    expect(after.sw).toBe(64);
    expect(urls).toEqual(['sprites/jeu/bin.png']);
    expect(mixed.get(q({ id: 'decor.bench' }))).not.toBeNull();
    expect(images.has('decor.bench')).toBe(false);
  });

  it('la grille d’une planche : lignes = orientations, colonnes = variante × images', () => {
    const m = defaultManifest();
    const person = m.sprites.find((s) => s.id === 'person') as SpriteDef;
    person.image = { file: 'p.png', cellPx: 32 };
    const images = new ImageSpriteProvider(new ManifestIndex(m), 'x', () => ({ image: {} as CanvasImageSource, ready: () => true, failed: () => false }));
    const r = images.get(q({ variant: 5, orientation: 3, frame: 2 })) as NonNullable<ReturnType<typeof images.get>>;
    expect(r.sx).toBe((5 * 3 + 2) * 32);
    expect(r.sy).toBe(3 * 32);
  });

  it('la zone de sélection ne dépend pas du fournisseur : elle vient du manifeste (hitRadiusM)', () => {
    const m = defaultManifest();
    const idx = new ManifestIndex(m);
    const before = idx.hitRadiusM('vehicle.fourgon_crs');
    (m.sprites.find((s) => s.id === 'vehicle.fourgon_crs') as SpriteDef).image = { file: 'f.png', cellPx: 128 };
    expect(new ManifestIndex(m).hitRadiusM('vehicle.fourgon_crs')).toBe(before);
    expect(idx.hitRadiusM('inconnu', 7)).toBe(7);
  });
});

describe('apparence et orientation', () => {
  it('apparence déterministe, dans la plage, accessoires rares', () => {
    const counts = new Array(6).fill(0) as number[];
    const N = 20000;
    for (let i = 0; i < N; i++) {
      const v = appearanceOf((Math.imul(i + 1, 2654435761) >>> 0));
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(48);
      counts[Math.floor(v / 8)]!++;
      expect(appearanceOf(i * 77)).toBe(appearanceOf(i * 77));
    }
    expect(counts[0]! / N).toBeGreaterThan(0.5);
    expect(counts[4]! / N).toBeLessThan(0.1);
    expect(counts.every((c) => c > 0)).toBe(true);
  });

  it('orientationIndex : secteurs trigonométriques', () => {
    expect(orientationIndex(0, 8)).toBe(0);
    expect(orientationIndex(Math.PI / 2, 8)).toBe(2);
    expect(orientationIndex(-Math.PI / 2, 8)).toBe(6);
    expect(orientationIndex(Math.PI, 8)).toBe(4);
    expect(orientationIndex(2 * Math.PI + 0.01, 8)).toBe(0);
  });

  it('palier selon le zoom : monotone, T0 agrégé à l’éloigné, T3 de très près', () => {
    let prev = -1;
    for (let z = 10; z <= 20; z += 0.25) {
      const t = lodForZoom(z).tier;
      expect(t).toBeGreaterThanOrEqual(prev);
      prev = t;
    }
    expect(lodForZoom(12).tier).toBe(0);
    expect(lodForZoom(16).tier).toBe(1);
    expect(lodForZoom(18.2).tier).toBe(2);
    expect(lodForZoom(19.5).tier).toBe(3);
    expect(lodForZoom(12).aggregateCrowd).toBe(true);
  });
});

describe('instantané de rendu (frontière moteur / rendu)', () => {
  const graph = buildSchematicGraph({ lng: 6.1757, lat: 49.1193 }, 1400, 1050);
  const c = new GameController({ graph, seed: 3 });
  c.runTicks(300);

  it('expose des données sémantiques et des positions interpolées, sans coordonnées écran', () => {
    const s0 = buildSnapshot(c, 0, 0);
    const s1 = buildSnapshot(c, 1, 0);
    expect(s0.units.length).toBe(c.sim.units.length);
    expect(s0.vehicles.length).toBe(c.sim.vehicles.length);
    const u = c.sim.units[0]!;
    expect(s0.units[0]!.x).toBeCloseTo(u.px, 6);
    expect(s1.units[0]!.x).toBeCloseTo(u.x, 6);
    expect(s0.units[0]!.sprite).toBe(forceSpriteId(u.force, u.loadout));
    expect(s0.vehicles[0]!.sprite).toBe(vehicleSpriteId(c.sim.vehicles[0]!.vehicle));
    expect(JSON.stringify(s0)).not.toMatch(/screen|pixel/i);
  });

  it('la pose d’un individu : direction de marche, ou orientation stable à l’arrêt', () => {
    const g = c.sim.groups.find((x) => x.members.n > 50)!;
    const pose: RenderablePose = { x: 0, y: 0, dir: 0, variant: 0, walking: false, seed: 0 };
    const i = g.members.activeStart + 1;
    g.members.px[i] = 10;
    g.members.py[i] = 10;
    g.members.x[i] = 10;
    g.members.y[i] = 11; // vers le nord
    crowdPose(g, i, 1, pose);
    expect(pose.walking).toBe(true);
    expect(pose.dir).toBeCloseTo(Math.PI / 2, 6);
    g.members.x[i] = 10;
    g.members.y[i] = 10;
    crowdPose(g, i, 1, pose);
    const d1 = pose.dir;
    crowdPose(g, i, 0.3, pose);
    expect(pose.walking).toBe(false);
    expect(pose.dir).toBe(d1);
    expect(pose.variant).toBe(appearanceOf(g.members.seed[i] as number));
  });
});

describe('marqueurs d’interface', () => {
  it('chaque état d’unité du moteur a un anneau distinct', () => {
    const styles = Object.values(STATUS_MARKERS).map((s) => `${s.color}|${s.dash?.join(',')}`);
    expect(new Set(styles).size).toBe(Object.keys(STATUS_MARKERS).length);
    expect(Object.keys(STATUS_MARKERS).sort()).toEqual(['engaged', 'idle', 'in_difficulty', 'moving', 'unavailable', 'waiting']);
    expect(MARKERS.blockedStreet.color).toBe('#ff3b30');
  });
});

describe('séparation moteur / rendu', () => {
  it('seul l’instantané lit le contrôleur ; les autres modules de sprites ne dépendent que de types', () => {
    const dir = new URL('../../src/render/sprites/', import.meta.url).pathname;
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.ts') && x !== 'snapshot.ts')) {
      const text = readFileSync(join(dir, f), 'utf8');
      expect(text, f).not.toMatch(/from '\.\.\/\.\.\/(game|ui|map|app)\//);
      expect(text, f).not.toMatch(/from '\.\.\/\.\.\/engine\/sim'/);
      expect(text, f).not.toMatch(/\bwindow\.|document\.(?!createElement)/);
    }
  });
});
