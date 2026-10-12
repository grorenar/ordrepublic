import { useState } from 'preact/hooks';
import { loadSettings, saveSettings, type Settings } from '../config/settings';
import type { MapProviderId } from '../config/mapConfig';
import { findPresetCity } from '../geo/cities';
import type { City } from '../state/types';
import { GameScreen, type DebugFlags } from '../ui/GameScreen';
import { HomeScreen } from '../ui/HomeScreen';
import { SpriteGallery } from '../ui/SpriteGallery';

/** Paramètres d'URL de test : ?debug &map=test|schematic|osm &autostart=metz */
function parseFlags(): { debug: DebugFlags; autostart?: City; schematic?: boolean } {
  const q = new URLSearchParams(location.search);
  const map = q.get('map');
  const providerOverride: MapProviderId | undefined = map === 'test' ? 'test-local' : undefined;
  return {
    debug: {
      debug: q.has('debug'),
      providerOverride,
      liveAttempts: q.has('attempts') ? Number(q.get('attempts')) : undefined,
      liveRetryMs: q.has('retryms') ? Number(q.get('retryms')) : undefined,
      extraCrowd: q.has('foule') ? Math.max(0, Math.min(200000, Number(q.get('foule')) || 0)) : undefined,
    },
    autostart: findPresetCity(q.get('autostart') ?? ''),
    schematic: map === 'schematic' ? true : map === 'osm' || map === 'test' ? false : undefined,
  };
}

/** Planche de contrôle des sprites : `?gallery` (outil de recette). */
export function App() {
  return new URLSearchParams(location.search).has('gallery') ? <SpriteGallery /> : <Main />;
}

function Main() {
  const [flags] = useState(parseFlags);
  const [settings, setSettings] = useState<Settings>(() => {
    const s = loadSettings();
    return flags.schematic === undefined ? s : { ...s, preferSchematic: flags.schematic };
  });
  const [city, setCity] = useState<City | null>(flags.autostart ?? null);
  const update = (s: Settings) => {
    setSettings(s);
    saveSettings(s);
  };
  if (city) {
    return <GameScreen key={city.id} city={city} settings={settings} debug={flags.debug} onSettings={update} onExit={() => setCity(null)} />;
  }
  return <HomeScreen settings={settings} onSettings={update} onStart={setCity} />;
}
