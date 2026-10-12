import { useState } from 'preact/hooks';
import { searchCity, GeocodeError, type GeocodeResult } from '../geo/geocode';
import type { City } from '../state/types';

interface Props {
  geocoderUrl: string;
  onPick: (city: City) => void;
  compact?: boolean;
}

/** Recherche libre de ville : déclenchée à la validation (pas d'autocomplétion), limitée à 1 requête/s. */
export function CitySearch({ geocoderUrl, onPick, compact }: Props) {
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<GeocodeResult[] | null>(null);

  const submit = async (e: Event) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await searchCity(q, geocoderUrl);
      setResults(r);
      if (r.length === 0) setError('Aucun résultat pour cette recherche.');
    } catch (err) {
      setResults(null);
      setError(err instanceof GeocodeError ? err.message : 'La recherche a échoué.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class={`city-search ${compact ? 'compact' : ''}`}>
      <form onSubmit={submit} role="search">
        <input
          type="search"
          value={q}
          placeholder="Rechercher une ville (ex. Nancy, Lille…)"
          aria-label="Rechercher une ville"
          data-testid="city-search-input"
          onInput={(e) => setQ((e.target as HTMLInputElement).value)}
        />
        <button type="submit" disabled={busy || q.trim().length < 2} data-testid="city-search-submit">
          {busy ? '…' : 'Rechercher'}
        </button>
      </form>
      {error && (
        <div class="inline-error" role="alert" data-testid="city-search-error">
          {error}
        </div>
      )}
      {results && results.length > 0 && (
        <ul class="search-results" data-testid="city-search-results">
          {results.map((r) => (
            <li key={r.city.id}>
              <button
                type="button"
                onClick={() => {
                  onPick(r.city);
                  setResults(null);
                  setQ('');
                }}
              >
                <strong>{r.city.name}</strong>
                <span>{r.city.label}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <p class="fineprint">Recherche via OpenStreetMap Nominatim (connexion Internet requise) · © contributeurs OpenStreetMap</p>
    </div>
  );
}
