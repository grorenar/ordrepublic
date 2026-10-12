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
