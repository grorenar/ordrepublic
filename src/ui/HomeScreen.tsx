import { useState } from 'preact/hooks';
import { PRESET_CITIES } from '../geo/cities';
import { MAP_PROVIDERS, type MapProviderId } from '../config/mapConfig';
import type { Settings } from '../config/settings';
import type { City } from '../state/types';
import { CitySearch } from './CitySearch';

interface Props {
  settings: Settings;
  onSettings: (s: Settings) => void;
  onStart: (city: City) => void;
}

export function HomeScreen({ settings, onSettings, onStart }: Props) {
  const [city, setCity] = useState<City>(PRESET_CITIES[0] as City);
  const set = (patch: Partial<Settings>) => onSettings({ ...settings, ...patch });
  const providers = Object.values(MAP_PROVIDERS).filter((p) => p.id !== 'test-local');

  return (
    <main class="home">
      <div class="home-card">
        <header>
          <div class="logo" aria-hidden="true">
            <svg viewBox="0 0 32 32" width="44" height="44">
              <path d="M16 2 4 7v8c0 8 5 13 12 15 7-2 12-7 12-15V7z" fill="#1d4ed8" stroke="#bfdbfe" stroke-width="1.6" />
              <path d="M16 6v21" stroke="#bfdbfe" stroke-width="1.2" opacity=".6" />
            </svg>
          </div>
          <div>
            <h1>ORDRE PUBLIC</h1>
            <p class="tagline">Simulation fictive de commandement du maintien de l’ordre</p>
          </div>
        </header>
        <p class="notice">
          Jeu entièrement fictif, à usage personnel. Les événements, unités et incidents sont simulés ; aucune donnée réelle de foule ou
          d’opération n’est utilisée. <strong>Phase 2 : prototype cartographique</strong> — les pions affichés sont des données de démonstration.
        </p>

        <section aria-labelledby="h-city">
          <h2 id="h-city">1. Choisir une ville</h2>
          <div class="city-grid" role="radiogroup" aria-label="Villes prédéfinies">
            {PRESET_CITIES.map((c) => (
              <button
                key={c.id}
                type="button"
                role="radio"
                aria-checked={city.id === c.id}
                class={`city-card ${city.id === c.id ? 'active' : ''}`}
                data-testid={`city-${c.id}`}
                onClick={() => setCity(c)}
              >
                {c.name}
              </button>
            ))}
          </div>
          <CitySearch geocoderUrl={settings.geocoderUrl} onPick={setCity} />
          {!PRESET_CITIES.some((c) => c.id === city.id) && (
            <p class="picked" data-testid="picked-city">
              Ville choisie : <strong>{city.name}</strong>
            </p>
          )}
        </section>

        <section aria-labelledby="h-map">
          <h2 id="h-map">2. Fond de carte</h2>
          <label class="radio">
            <input
              type="radio"
              name="mapmode"
              checked={!settings.preferSchematic}
              onChange={() => set({ preferSchematic: false })}
              data-testid="mode-osm"
            />
            <span>
              <strong>Carte OpenStreetMap</strong> — rues, bâtiments, places et commerces (connexion Internet requise). Bascule automatique en
              mode schématique en cas d’indisponibilité.
            </span>
          </label>
          <label class="radio">
            <input
              type="radio"
              name="mapmode"
              checked={settings.preferSchematic}
              onChange={() => set({ preferSchematic: true })}
              data-testid="mode-schematic"
            />
            <span>
              <strong>Fond schématique</strong> — ville générée localement, fonctionne sans aucun service externe.
            </span>
          </label>
          <details class="advanced">
            <summary>Réglages avancés des services cartographiques</summary>
            <label>
              Fournisseur de fond
              <select
                value={settings.provider}
                onChange={(e) => set({ provider: (e.target as HTMLSelectElement).value as MapProviderId })}
                data-testid="provider-select"
              >
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            <p class="fineprint">{MAP_PROVIDERS[settings.provider].description}</p>
            {settings.provider === 'custom-style' && (
              <label>
                URL du style MapLibre (https)
                <input
                  type="url"
                  value={settings.customStyleUrl}
                  placeholder="https://exemple.org/style.json"
                  onInput={(e) => set({ customStyleUrl: (e.target as HTMLInputElement).value })}
                />
              </label>
            )}
            <label>
              Service de géocodage (compatible Nominatim)
              <input type="url" value={settings.geocoderUrl} onInput={(e) => set({ geocoderUrl: (e.target as HTMLInputElement).value })} />
            </label>
            <label class="check">
              <input type="checkbox" checked={settings.tacticalLook} onChange={(e) => set({ tacticalLook: (e.target as HTMLInputElement).checked })} />
              Rendu « vue tactique » (fond assombri pour faire ressortir les pions)
            </label>
          </details>
        </section>

        <button class="start" type="button" data-testid="start" onClick={() => onStart(city)}>
          Démarrer la démonstration — {city.name}
        </button>
        <p class="fineprint">
          Données de carte © contributeurs <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> (licence ODbL).
          Aucune clé API requise.
        </p>
      </div>
    </main>
  );
}
