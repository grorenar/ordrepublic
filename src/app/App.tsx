import { useState } from 'preact/hooks';
import { loadSettings, saveSettings, type Settings } from '../config/settings';
import type { MapProviderId } from '../config/mapConfig';
import { findPresetCity } from '../geo/cities';
import type { City } from '../state/types';
import { GameScreen, type DebugFlags } from '../ui/GameScreen';
import { HomeScreen } from '../ui/HomeScreen';

/** Paramètres d'URL de test : ?debug &map=test|schematic|osm &bench=N &autostart=metz */
function parseFlags(): { debug: DebugFlags; autostart?: City; schematic?: boolean } {
  const q = new URLSearchParams(location.search);
  const map = q.get('map');
  const providerOverride: MapProviderId | undefined = map === 'test' ? 'test-local' : undefined;
  const bench = Math.max(0, Math.min(40, Number(q.get('bench') ?? 0) || 0));
  return {
    debug: { debug: q.has('debug'), extraGroups: bench, providerOverride },
    autostart: findPresetCity(q.get('autostart') ?? ''),
    schematic: map === 'schematic' ? true : map === 'osm' || map === 'test' ? false : undefined,
  };
}

export function App() {
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
