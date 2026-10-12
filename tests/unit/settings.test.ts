import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, loadSettings, sanitize, saveSettings } from '../../src/config/settings';

describe('réglages', () => {
  it('valeurs par défaut sans stockage ni contenu valide', () => {
    expect(loadSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings({ getItem: () => 'pas du json' })).toEqual(DEFAULT_SETTINGS);
  });

  it('assainit les valeurs inconnues et refuse un géocodeur non https', () => {
    const s = sanitize({ provider: 'google', geocoderUrl: 'http://evil', preferSchematic: 'oui', tacticalLook: false });
    expect(s.provider).toBe('openfreemap');
    expect(s.geocoderUrl).toBe(DEFAULT_SETTINGS.geocoderUrl);
    expect(s.preferSchematic).toBe(false);
    expect(s.tacticalLook).toBe(false);
  });

  it('aller-retour de sauvegarde', () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    saveSettings({ ...DEFAULT_SETTINGS, preferSchematic: true, provider: 'osm-raster' }, storage);
    expect(loadSettings(storage)).toMatchObject({ preferSchematic: true, provider: 'osm-raster' });
  });

  it('un stockage qui lève une exception ne casse pas l’application', () => {
    const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
    expect(() => saveSettings(DEFAULT_SETTINGS, broken)).not.toThrow();
    expect(loadSettings(broken)).toEqual(DEFAULT_SETTINGS);
  });
});

import { buildStyle } from '../../src/map/MapLibreAdapter';
describe('vue aérienne IGN', () => {
  it('style raster de la Géoplateforme, attribution IGN, sans clé API', () => {
    const st = buildStyle('ign-aerial', undefined, { lng: 6.17, lat: 49.11 }) as unknown as { sources: { base: { tiles: string[]; attribution: string } } };
    expect(st.sources.base.tiles[0]).toContain('https://data.geopf.fr/wmts');
    expect(st.sources.base.tiles[0]).toContain('ORTHOIMAGERY.ORTHOPHOTOS');
    expect(st.sources.base.attribution).toContain('IGN');
    expect(JSON.stringify(st)).not.toMatch(/key=|apikey|token/i);
  });
});

describe('vue mixte : photo aérienne + noms', () => {
  const vector = {
    version: 8,
    sources: { openmaptiles: { type: 'vector', url: 'https://tiles.example/planet' }, autre: { type: 'vector', url: 'https://x/y' } },
    layers: [
      { id: 'background', type: 'background', paint: {} },
      { id: 'water', type: 'fill', source: 'openmaptiles', 'source-layer': 'water' },
      { id: 'building', type: 'fill', source: 'openmaptiles', 'source-layer': 'building' },
      { id: 'highway_name', type: 'symbol', source: 'openmaptiles', 'source-layer': 'transportation_name', layout: { 'text-field': '{name}', 'text-font': ['Noto Sans Regular'], 'icon-image': 'shield', 'symbol-placement': 'line' }, paint: { 'text-color': '#000' } },
      { id: 'poi', type: 'symbol', source: 'openmaptiles', 'source-layer': 'poi', layout: { 'icon-image': 'x' } },
    ],
  } as unknown as import('maplibre-gl').StyleSpecification;

  it('ne reprend que les textes (sans pictogrammes, recolorés lisibles) et les contours de bâtiments', async () => {
    const { hybridOverlay } = await import('../../src/map/hybrid');
    const o = hybridOverlay(vector);
    expect(o.layers.map((l) => l.id)).toEqual(['hyb-building-outline', 'hyb-highway_name']);
    const label = o.layers.find((l) => l.id === 'hyb-highway_name') as unknown as { layout: Record<string, unknown>; paint: Record<string, unknown>; source: string };
    expect(label.layout['icon-image']).toBeUndefined();
    expect(label.layout['text-field']).toBe('{name}');
    expect(label.paint['text-color']).toBe('#ffffff');
    expect(String(label.paint['text-halo-color'])).toContain('rgba(0,0,0');
    expect(Object.keys(o.sources)).toEqual(['hyb-openmaptiles']); // seules les sources utilisées
    expect(label.source).toBe('hyb-openmaptiles');
    expect((o.layers[0] as unknown as { type: string }).type).toBe('line');
  });

  it('style de base : photo IGN + glyphes OpenFreeMap, attributions IGN et OSM', () => {
    const st = buildStyle('ign-hybrid', undefined, { lng: 6.17, lat: 49.11 }) as unknown as { glyphs: string; sources: { base: { attribution: string } } };
    expect(st.glyphs).toContain('openfreemap');
    expect(st.sources.base.attribution).toContain('IGN');
    expect(st.sources.base.attribution).toContain('OpenStreetMap');
  });
});
