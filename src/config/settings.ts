import { DEFAULT_GEOCODER_URL, type MapProviderId } from './mapConfig';

export interface Settings {
  provider: MapProviderId;
  customStyleUrl: string;
  geocoderUrl: string;
  /** Préférence de fond au lancement : carte réelle ou schématique. */
  preferSchematic: boolean;
  tacticalLook: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  provider: 'openfreemap',
  customStyleUrl: '',
  geocoderUrl: DEFAULT_GEOCODER_URL,
  preferSchematic: false,
  tacticalLook: true,
};

const KEY = 'ordrepublic.settings.v1';

export function loadSettings(storage: Pick<Storage, 'getItem'> | undefined = safeStorage()): Settings {
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return sanitize(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings, storage: Pick<Storage, 'setItem'> | undefined = safeStorage()): void {
  try {
    storage?.setItem(KEY, JSON.stringify(s));
  } catch {
    /* stockage indisponible (navigation privée, quota) : les réglages ne sont pas persistés */
  }
}

export function sanitize(input: unknown): Settings {
  const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const providers: MapProviderId[] = ['openfreemap', 'osm-raster', 'ign-aerial', 'custom-style', 'test-local'];
  return {
    provider: providers.includes(o.provider as MapProviderId) ? (o.provider as MapProviderId) : DEFAULT_SETTINGS.provider,
    customStyleUrl: typeof o.customStyleUrl === 'string' ? o.customStyleUrl : '',
    geocoderUrl: typeof o.geocoderUrl === 'string' && /^https:\/\//.test(o.geocoderUrl) ? o.geocoderUrl : DEFAULT_GEOCODER_URL,
    preferSchematic: o.preferSchematic === true,
    tacticalLook: o.tacticalLook !== false,
  };
}

function safeStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}
