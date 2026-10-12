import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { LocalFrame, zoomForBounds, type Bounds, type LngLat, type Vec2, type ViewState } from '../geo/mercator';
import { PRESET_CITIES } from '../geo/cities';
import { DEFAULT_ZOOM, MAP_PROVIDERS, type MapProviderId } from '../config/mapConfig';
import type { Settings } from '../config/settings';
import { GameController } from '../game/controller';
import { provideWorld, type WorldKind } from '../game/world';
import { LiveLoadError, indexedDbCache, loadZoneGraph } from '../nav/osm/live';
import type { StreetGraph } from '../nav/graph';
import { DEFAULT_ZONE_LEVEL, ZONE_LEVELS } from '../game/zones';
import type { EntityRef } from '../game/selection';
import type { LogEvent } from '../engine/types';
import { MapLibreAdapter } from '../map/MapLibreAdapter';
import { SchematicAdapter } from '../map/SchematicAdapter';
import type { MapAdapter, MapStatus } from '../map/MapAdapter';
import { GameRenderer } from '../render/GameRenderer';
import { pixelsPerMeter } from '../geo/mercator';
import type { City } from '../state/types';
import { CitySearch } from './CitySearch';
import { DetailPanel, ForcesPanel, LogPanel, TopBar } from './panels';

export interface DebugFlags {
  debug: boolean;
  providerOverride?: MapProviderId;
}

interface Props {
  city: City;
  settings: Settings;
  debug: DebugFlags;
  onSettings: (s: Settings) => void;
  onExit: () => void;
}

interface Notice {
  level: 'warn' | 'error';
  text: string;
  /** `world` : fond/graphe de simulation ; `map` : état des tuiles ou du réseau. */
  source: 'world' | 'map';
}
interface Banner {
  id: number;
  level: LogEvent['level'];
  text: string;
  until: number;
}

/** Événements du journal annoncés par un bandeau (les autres restent dans le journal). */
const BANNER_CODES = new Set(['group.created', 'group.arriving', 'group.settled', 'group.split', 'group.joined', 'group.dispersing', 'edge.closed', 'edge.opened', 'group.rerouted', 'group.waiting', 'unit.waiting']);

function zoneBounds(frame: LocalFrame, zi: number): Bounds {
  const z = ZONE_LEVELS[zi] as (typeof ZONE_LEVELS)[number];
  const sw = frame.toLngLat({ x: -z.halfWidth, y: -z.halfHeight });
  const ne = frame.toLngLat({ x: z.halfWidth, y: z.halfHeight });
  return { west: sw.lng, south: sw.lat, east: ne.lng, north: ne.lat };
}

function zoomToFitZone(adapter: MapAdapter, frame: LocalFrame, zi: number, padding = 48): number {
  const v = adapter.getView();
  const z = zoomForBounds(zoneBounds(frame, zi), v.width, v.height, padding);
  return Math.max(12, Math.min(18, z));
}

export function GameScreen({ city: initialCity, settings, debug, onSettings, onExit }: Props) {
  const [city, setCity] = useState<City>(initialCity);
  const [mapKind, setMapKind] = useState<WorldKind>(settings.preferSchematic ? 'schematic' : 'osm');
  const [mapStatus, setMapStatus] = useState<MapStatus>({ state: 'loading' });
  const [notice, setNotice] = useState<Notice | null>(null);
  const [zoneLevel, setZoneLevel] = useState(DEFAULT_ZONE_LEVEL);
  const [tactical, setTactical] = useState(settings.tacticalLook);
  const [searchOpen, setSearchOpen] = useState(false);
  const [orderMode, setOrderMode] = useState(false);
  const [ctrl, setCtrl] = useState<GameController | null>(null);
  const [, setRev] = useState(0);
  const [banners, setBanners] = useState<Banner[]>([]);
  const [fatal, setFatal] = useState<string | null>(null);
  /** Carte réelle affichée sans simulation (aucun paquet OSM cohérent pour la ville). */
  const [preview, setPreview] = useState<string | null>(null);
  /** Graphe OSM chargé à la demande pour le secteur choisi (origine = centre de la carte au moment du choix). */
  const [live, setLive] = useState<{ origin: LngLat; graph: StreetGraph } | null>(null);
  const [liveStatus, setLiveStatus] = useState<{ state: 'idle' | 'loading' | 'error'; text: string; step: number }>({ state: 'idle', text: '', step: 0 });
  const [loadSecs, setLoadSecs] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const adapterRef = useRef<MapAdapter | null>(null);
  const rendererRef = useRef<GameRenderer | null>(null);
  const ctrlRef = useRef<GameController | null>(null);
  const cityRef = useRef(city);
  const orderModeRef = useRef(orderMode);
  const lastViewRef = useRef<{ center: LngLat; zoom: number } | null>(null);
  const bannerId = useRef(0);
  cityRef.current = city;
  orderModeRef.current = orderMode;
  ctrlRef.current = ctrl;

  const [aerial, setAerial] = useState(false);
  const provider: MapProviderId = debug.providerOverride ?? (aerial ? 'ign-aerial' : settings.provider);
  const origin: LngLat = live?.origin ?? city.center;
  const frame = useMemo(() => new LocalFrame(origin), [origin.lng, origin.lat]);
  const frameRef = useRef(frame);
  frameRef.current = frame;
  const zone = ZONE_LEVELS[zoneLevel] as (typeof ZONE_LEVELS)[number];

  // ---- moteur : (re)création quand la ville ou le type de fond change (le graphe doit correspondre au fond affiché)
  useEffect(() => {
    let cancelled = false;
    setCtrl(null);
    setFatal(null);
    setPreview(null);
    setLive(null);
    setLiveStatus({ state: 'idle', text: '', step: 0 });
    setBanners([]);
    setOrderMode(false);
    // fournisseur de test local (debug) : le fond n'est pas une carte réelle, on simule sur le graphe schématique
    const want: WorldKind = debug.providerOverride ? 'schematic' : mapKind;
    provideWorld(city, want).then((w) => {
      if (cancelled) return;
      if (w.missingPack) {
        // la carte réelle RESTE affichée ; aucune simulation n'est posée dessus
        setPreview(w.notice ?? 'Simulation indisponible sur la carte réelle.');
        return;
      }
      if (w.kind !== want) {
        if (w.notice) setNotice({ level: 'warn', text: w.notice, source: 'world' });
        setMapKind(w.kind);
        return;
      }
      try {
        setCtrl(new GameController({ graph: w.graph, zoneLevel }));
      } catch (err) {
        setFatal(`Initialisation du moteur impossible : ${err instanceof Error ? err.message : String(err)}`);
      }
    }).catch((err: unknown) => {
      if (!cancelled) setFatal(`Chargement du monde impossible : ${err instanceof Error ? err.message : String(err)}`);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [city, mapKind]);

  // temps écoulé affiché pendant le chargement
  useEffect(() => {
    if (liveStatus.state !== 'loading') return;
    const t0 = Date.now();
    const id = window.setInterval(() => setLoadSecs(Math.floor((Date.now() - t0) / 1000)), 500);
    return () => window.clearInterval(id);
  }, [liveStatus.state]);

  // ---- moteur sur le graphe OSM chargé à la demande
  useEffect(() => {
    if (!live) return;
    try {
      setCtrl(new GameController({ graph: live.graph, zoneLevel }));
      setPreview(null);
      setLiveStatus({ state: 'idle', text: '', step: 0 });
    } catch (err) {
      setFatal(`Initialisation du moteur impossible : ${err instanceof Error ? err.message : String(err)}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live]);

  // ---- cycle de vie de l'adaptateur de carte
  useEffect(() => {
    const host = hostRef.current as HTMLDivElement;
    host.replaceChildren();
    setMapStatus({ state: 'loading' });
    const c = cityRef.current;
    const start = lastViewRef.current ?? { center: c.center, zoom: DEFAULT_ZOOM };
    let adapter: MapAdapter;
    try {
      adapter =
        mapKind === 'schematic'
          ? new SchematicAdapter(host, start.center, start.zoom)
          : new MapLibreAdapter(host, { provider, customStyleUrl: settings.customStyleUrl, center: start.center, zoom: start.zoom, tactical });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      setNotice({ level: 'error', text: `Carte indisponible (${reason}). Passage en mode schématique.`, source: 'map' });
      host.replaceChildren();
      if (mapKind !== 'schematic') setMapKind('schematic');
      return;
    }
    adapter.setScenarioOrigin(c.center);
    adapterRef.current = adapter;
    if (!lastViewRef.current) adapter.jumpTo(c.center, zoomToFitZone(adapter, new LocalFrame(c.center), zoneLevel));
    const offMove = adapter.onMove(() => {
      const v = adapter.getView();
      lastViewRef.current = { center: { lng: v.lng, lat: v.lat }, zoom: v.zoom };
      rendererRef.current?.draw(performance.now());
    });
    const offStatus = adapter.onStatus((s) => {
      setMapStatus(s);
      if (s.state === 'degraded') setNotice({ level: 'warn', text: s.reason, source: 'map' });
      if (s.state === 'ready') setNotice((n) => (n && n.source === 'map' && n.level === 'warn' ? null : n));
    });
    adapter.ready.catch((err: unknown) => {
      if (adapterRef.current !== adapter) return;
      const reason = err instanceof Error ? err.message : String(err);
      setNotice({ level: 'error', text: `${reason} Bascule automatique vers le fond schématique (la simulation redémarre sur le graphe schématique).`, source: 'map' });
      setMapKind('schematic');
    });
    return () => {
      offMove();
      offStatus();
      adapter.destroy();
      if (adapterRef.current === adapter) adapterRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapKind, provider, settings.customStyleUrl]);

  useEffect(() => adapterRef.current?.setTactical(tactical && !aerial), [tactical, aerial, mapKind]);
  useEffect(() => {
    if (rendererRef.current) rendererRef.current.aerial = aerial && mapKind === 'osm';
  }, [aerial, mapKind]);

  // ---- couche de rendu : l'horloge de jeu est avancée par la boucle d'affichage
  useEffect(() => {
    const canvas = canvasRef.current as HTMLCanvasElement;
    const fallback: ViewState = { lng: 0, lat: 0, zoom: 1, width: 1, height: 1 };
    const renderer = new GameRenderer(canvas, () => adapterRef.current?.getView() ?? fallback);
    rendererRef.current = renderer;
    renderer.beforeDraw = (dt) => {
      const c = ctrlRef.current;
      const v = adapterRef.current?.getView();
      if (!c || !v) return;
      // foyer d'attention = ce que le joueur voit (centre de la vue, demi-diagonale)
      const centre = frameRef.current.toMeters({ lng: v.lng, lat: v.lat });
      c.setView(centre, Math.hypot(v.width, v.height) / 2 / pixelsPerMeter(v.lat, v.zoom));
      c.advance(dt);
    };
    renderer.start();
    return () => {
      renderer.stop();
      rendererRef.current = null;
    };
  }, []);

  useEffect(() => {
    rendererRef.current?.setController(ctrl, origin);
  }, [ctrl, origin.lng, origin.lat]);
  useEffect(() => {
    rendererRef.current?.setZone(zone);
    rendererRef.current?.setPreviewZone(preview !== null && !ctrl ? zone : null);
    ctrlRef.current?.setZoneLevel(zoneLevel);
  }, [zone, zoneLevel, ctrl, preview]);

  // ---- changement de ville : saut de caméra
  const firstCity = useRef(true);
  useEffect(() => {
    if (firstCity.current) {
      firstCity.current = false;
      return;
    }
    const adapter = adapterRef.current;
    adapter?.setScenarioOrigin(city.center);
    if (adapter) adapter.jumpTo(city.center, zoomToFitZone(adapter, new LocalFrame(city.center), zoneLevel));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [city]);

  // ---- rafraîchissement de l'interface (4 Hz), bandeaux, connexion réseau
  useEffect(() => {
    const id = window.setInterval(() => {
      const c = ctrlRef.current;
      const now = Date.now();
      if (c) {
        const fresh = c.newEvents().filter((e) => BANNER_CODES.has(e.code) || e.level !== 'info');
        if (fresh.length) {
          setBanners((b) => [...b.filter((x) => x.until > now), ...fresh.slice(-2).map((e) => ({ id: ++bannerId.current, level: e.level, text: e.text, until: now + 6000 }))].slice(-2));
        } else setBanners((b) => (b.some((x) => x.until <= now) ? b.filter((x) => x.until > now) : b));
      }
      setRev((r) => r + 1);
    }, 250);
    const off = () => setNotice({ level: 'warn', text: 'Connexion Internet perdue : les tuiles non chargées resteront vides. Vous pouvez passer au fond schématique.', source: 'map' });
    const on = () => setNotice((n) => (n?.text.startsWith('Connexion Internet perdue') ? null : n));
    window.addEventListener('offline', off);
    window.addEventListener('online', on);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('offline', off);
      window.removeEventListener('online', on);
    };
  }, []);

  // ---- interactions (clic = sélection ; clic droit = ordre ; survol)
  useEffect(() => {
    const wrap = wrapRef.current as HTMLDivElement;
    let down: Vec2 | null = null;
    let lastHover = 0;
    const local = (e: PointerEvent | MouseEvent): Vec2 => {
      const r = wrap.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const world = (p: Vec2) => {
      const r = rendererRef.current;
      const w = r?.toWorld(p);
      return r && w ? { w, tol: 14 * r.metersPerPixel() } : null;
    };
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 || (e.target as HTMLElement).closest('.map-ui')) return;
      down = local(e);
    };
    const onUp = (e: PointerEvent) => {
      if (!down) return;
      const p = local(e);
      const moved = Math.hypot(p.x - down.x, p.y - down.y);
      down = null;
      const c = ctrlRef.current;
      if (moved > 5 || !c || (e.target as HTMLElement).closest('.map-ui')) return;
      const at = world(p);
      if (!at) return;
      if (orderModeRef.current) {
        c.orderMove(at.w);
        setOrderMode(false);
      } else c.select(c.pick(at.w, at.tol, true), e.shiftKey);
      setRev((r) => r + 1);
    };
    const onContext = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest('.map-ui')) return;
      e.preventDefault();
      const c = ctrlRef.current;
      const at = world(local(e));
      if (!c || !at) return;
      // clic droit sur une unité non sélectionnée : on la sélectionne d'abord (confort), sinon ordre de déplacement
      if (!c.selectedMovers().length) {
        const hit = c.pick(at.w, at.tol, false);
        if (hit && hit.type !== 'group') c.select(hit);
      } else c.orderMove(at.w);
      setRev((r) => r + 1);
    };
    const onMove = (e: PointerEvent) => {
      const r = rendererRef.current;
      const c = ctrlRef.current;
      if (!r || !c) return;
      const now = performance.now();
      if (now - lastHover < 60) return;
      lastHover = now;
      if (e.buttons || (e.target as HTMLElement).closest('.map-ui')) {
        r.hover = null;
        wrap.classList.remove('hit-hover');
        return;
      }
      const at = world(local(e));
      const h: EntityRef | null = at ? c.pick(at.w, at.tol, false) : null;
      r.hover = h;
      wrap.classList.toggle('hit-hover', !!h);
      wrap.classList.toggle('order-mode', orderModeRef.current);
    };
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      const c = ctrlRef.current;
      if (e.key === 'Escape') {
        setOrderMode(false);
        c?.select(null);
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && c) c.cancelOrders();
      else if (e.key === ' ' && c) {
        e.preventDefault();
        c.setSpeed(c.speed === 0 ? 1 : 0);
      }
      setRev((r) => r + 1);
    };
    wrap.addEventListener('pointerdown', onDown, true);
    wrap.addEventListener('pointerup', onUp, true);
    wrap.addEventListener('pointermove', onMove);
    wrap.addEventListener('contextmenu', onContext);
    window.addEventListener('keydown', onKey);
    return () => {
      wrap.removeEventListener('pointerdown', onDown, true);
      wrap.removeEventListener('pointerup', onUp, true);
      wrap.removeEventListener('pointermove', onMove);
      wrap.removeEventListener('contextmenu', onContext);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  // ---- crochet de diagnostic (tests automatisés et banc d'essai)
  useEffect(() => {
    if (!debug.debug) return;
    const w = window as unknown as Record<string, unknown>;
    w.__ORDRE__ = {
      get kind() {
        return adapterRef.current?.kind;
      },
      get status() {
        return mapStatus;
      },
      get ctrl() {
        return ctrlRef.current;
      },
      getView: () => adapterRef.current?.getView(),
      nativeProject: (m: Vec2) => adapterRef.current?.debugProject?.(frame.toLngLat(m)),
      toScreen: (m: Vec2) => rendererRef.current?.toScreen(m),
      targets: () => rendererRef.current?.getTargets(),
      stats: () => rendererRef.current?.getStats(),
      resetStats: () => rendererRef.current?.resetStats(),
      skip: (layers: string[]) => {
        const sk = rendererRef.current?.skip;
        sk?.clear();
        layers.forEach((l) => sk?.add(l));
      },
      city: () => cityRef.current,
      jumpTo: (lng: number, lat: number, zoom: number) => adapterRef.current?.jumpTo({ lng, lat }, zoom),
      zone: () => ({ level: zoneLevel, ...zone }),
    };
    return () => {
      delete w.__ORDRE__;
    };
  });

  // ---- actions
  const centerOn = useCallback(
    (pos: Vec2) => {
      const adapter = adapterRef.current;
      if (!adapter) return;
      adapter.flyTo(frame.toLngLat(pos), Math.max(adapter.getView().zoom, 16.5));
    },
    [frame],
  );
  const select = useCallback(
    (ref: EntityRef, additive: boolean) => {
      const c = ctrlRef.current;
      if (!c) return;
      c.select(ref, additive);
      const pos = c.positionOf(ref);
      if (pos && !additive) centerOn(pos);
      setRev((r) => r + 1);
    },
    [centerOn],
  );
  const changeZone = (next: number) => {
    setZoneLevel(next);
    const a = adapterRef.current;
    if (a) {
      const v = a.getView();
      const c = ctrlRef.current ? origin : preview !== null ? { lng: v.lng, lat: v.lat } : city.center;
      a.flyTo(c, zoomToFitZone(a, new LocalFrame(c), next));
    }
  };
  const fitZone = () => adapterRef.current?.fitBounds(zoneBounds(frame, zoneLevel), 90);
  const switchMap = () => {
    const next: WorldKind = mapKind === 'osm' ? 'schematic' : 'osm';
    setNotice(null);
    setMapKind(next);
    onSettings({ ...settings, preferSchematic: next === 'schematic' });
  };
  /** « Jouer ici » : charge les rues OSM du rectangle de jeu centré sur la vue, puis démarre la simulation. */
  const playHere = async () => {
    const a = adapterRef.current;
    if (!a || liveStatus.state === 'loading') return;
    const v = a.getView();
    const center = { lng: v.lng, lat: v.lat };
    const ctl = new AbortController();
    abortRef.current = ctl;
    setLoadSecs(0);
    setLiveStatus({ state: 'loading', text: 'Préparation de la requête…', step: 1 });
    try {
      const r = await loadZoneGraph(center, ZONE_LEVELS[zoneLevel] as (typeof ZONE_LEVELS)[number], city.name, {
        cache: indexedDbCache(),
        signal: ctl.signal,
        onProgress: (text, step) => setLiveStatus({ state: 'loading', text, step }),
      });
      // étape 3 : démarrage du moteur (l'écran de chargement reste affiché jusqu'à ce que la simulation soit prête)
      setLiveStatus({ state: 'loading', text: 'Démarrage de la simulation…', step: 3 });
      await new Promise((res) => setTimeout(res, 30));
      setLive({ origin: center, graph: r.graph });
    } catch (err) {
      if (err instanceof LiveLoadError && err.kind === 'cancelled') {
        setLiveStatus({ state: 'idle', text: '', step: 0 });
        return;
      }
      const text = err instanceof LiveLoadError ? err.message : `Chargement impossible : ${err instanceof Error ? err.message : String(err)}`;
      setLiveStatus({ state: 'error', text, step: 0 });
    } finally {
      abortRef.current = null;
    }
  };
  const pickCity = (c: City) => {
    setCity(c);
    setSearchOpen(false);
  };

  const mapLabel = mapKind === 'schematic' ? 'Fond schématique (hors ligne)' : `Carte OSM — ${MAP_PROVIDERS[provider].label.split(' (')[0]}`;
  const adapterKind = mapKind === 'schematic' ? 'schematic' : 'maplibre';
  const loadingWorld = !ctrl;

  return (
    <div class="game" data-testid="game" data-map-kind={adapterKind} data-map-state={mapStatus.state} data-engine={ctrl ? 'ready' : preview ? 'preview' : 'loading'}>
      {ctrl ? (
        <TopBar
          ctrl={ctrl}
          cityName={city.name}
          presetCities={PRESET_CITIES}
          cityId={city.id}
          onCity={pickCity}
          onToggleSearch={() => setSearchOpen((v) => !v)}
          onExit={onExit}
          onSpeed={(s) => {
            ctrl.setSpeed(s);
            setRev((r) => r + 1);
          }}
        />
      ) : (
        <header class="topbar">
          <div class="brand">
            <button type="button" class="ghost" onClick={onExit} data-testid="exit">
              ← Accueil
            </button>
            <strong>ORDRE PUBLIC</strong>
          </div>
          {fatal ? (
            <span class="warn" role="alert" data-testid="engine-error">
              {fatal}{' '}
              <button type="button" onClick={() => { setFatal(null); setMapKind('schematic'); setCity({ ...city }); }}>
                Réessayer en fond schématique
              </button>
            </span>
          ) : preview ? (
            <span class="situation preview" data-testid="preview-banner" role="status">
              <strong>Carte réelle.</strong> Placez le rectangle bleu sur le secteur de jeu (déplacez/zoomez la carte, taille avec ◂ ▸), puis cliquez « Jouer ici ». Les rues OpenStreetMap du secteur sont alors téléchargées (une requête).{' '}
              <button type="button" class="primary" data-testid="play-here" disabled={liveStatus.state === 'loading'} onClick={playHere}>
                {liveStatus.state === 'loading' ? 'Chargement…' : 'Jouer ici'}
              </button>{' '}
              <button type="button" data-testid="start-schematic" onClick={() => { setNotice(null); setMapKind('schematic'); }}>
                Ou jouer sur la ville fictive (fond schématique)
              </button>
              {liveStatus.state === 'error' && (
                <span class="warn" role="alert" data-testid="live-error"> {liveStatus.text}</span>
              )}
            </span>
          ) : (
            <span class="muted">Préparation de la simulation…</span>
          )}
        </header>
      )}
      {searchOpen && (
        <div class="search-pop map-ui" data-testid="search-pop">
          <CitySearch geocoderUrl={settings.geocoderUrl} onPick={pickCity} compact />
        </div>
      )}
      <aside class="side left">{ctrl && <ForcesPanel ctrl={ctrl} onSelect={select} />}</aside>

      <section class={`map-area ${orderMode ? 'order-mode' : ''}`} ref={wrapRef} aria-label="Carte de la zone de jeu">
        <div class={`map-host ${tactical && !aerial ? 'tactical' : ''}`} ref={hostRef} data-testid="map-host" />
        <canvas class="game-layer" ref={canvasRef} data-testid="game-layer" aria-hidden="true" />

        {liveStatus.state === 'loading' && !ctrl && (
          <div class="loading-overlay map-ui" role="status" aria-live="polite" data-testid="loading-overlay">
            <div class="loading-card">
              <div class="spinner" aria-hidden="true" />
              <h2>Préparation du secteur de jeu</h2>
              <ol class="steps">
                {['Téléchargement des rues et bâtiments OpenStreetMap', 'Construction du graphe de navigation', 'Démarrage de la simulation'].map((label, i) => (
                  <li key={label} class={liveStatus.step > i + 1 ? 'done' : liveStatus.step === i + 1 ? 'now' : ''}>
                    <span aria-hidden="true">{liveStatus.step > i + 1 ? '✔' : liveStatus.step === i + 1 ? '⏳' : '○'}</span> {label}
                  </li>
                ))}
              </ol>
              <p class="muted small" data-testid="live-progress">
                {liveStatus.text} · {loadSecs} s
              </p>
              {loadSecs >= 12 && liveStatus.step === 1 && <p class="small">Le service OpenStreetMap peut être lent selon la charge ; le délai maximal est de 60 s.</p>}
              <button type="button" data-testid="load-cancel" onClick={() => abortRef.current?.abort()} disabled={liveStatus.step >= 2}>
                Annuler
              </button>
            </div>
          </div>
        )}

        <div class="banners map-ui" aria-live="polite">
          {banners.map((b) => (
            <div key={b.id} class={`banner ${b.level}`} data-testid="banner">
              {b.text}
            </div>
          ))}
        </div>

        {(notice || mapStatus.state === 'loading' || (loadingWorld && !fatal && !preview)) && (
          <div class={`map-notice map-ui ${notice?.level ?? 'info'}`} role="status" data-testid="map-notice">
            <span>{notice ? notice.text : loadingWorld ? 'Préparation de la simulation…' : 'Chargement de la carte…'}</span>
            {notice && mapKind === 'schematic' && (
              <button type="button" onClick={switchMap} data-testid="retry-map">
                Réessayer la carte OSM
              </button>
            )}
            {notice && (
              <button type="button" class="ghost" aria-label="Fermer" onClick={() => setNotice(null)}>
                ✕
              </button>
            )}
          </div>
        )}

        <div class="map-controls map-ui">
          <div class="ctl-group" role="group" aria-label="Zoom">
            <button type="button" aria-label="Zoom avant" data-testid="zoom-in" onClick={() => adapterRef.current?.zoomBy(1)}>
              +
            </button>
            <button type="button" aria-label="Zoom arrière" data-testid="zoom-out" onClick={() => adapterRef.current?.zoomBy(-1)}>
              −
            </button>
            <button type="button" aria-label="Cadrer la zone de jeu" title="Cadrer la zone de jeu" data-testid="fit-zone" onClick={fitZone}>
              ⌖
            </button>
          </div>
          <div class="ctl-group zone" role="group" aria-label="Taille de la zone de jeu">
            <button type="button" aria-label="Réduire la zone" disabled={zoneLevel === 0} data-testid="zone-shrink" onClick={() => changeZone(zoneLevel - 1)}>
              ◂
            </button>
            <span data-testid="zone-size" title="Zone de jeu (largeur × hauteur)">
              {zone.halfWidth * 2}×{zone.halfHeight * 2} m
            </span>
            <button type="button" aria-label="Étendre la zone" disabled={zoneLevel === ZONE_LEVELS.length - 1} data-testid="zone-grow" onClick={() => changeZone(zoneLevel + 1)}>
              ▸
            </button>
          </div>
        </div>

        <div class="map-bottom map-ui">
          <button type="button" data-testid="switch-map" onClick={switchMap} title="Basculer entre la carte OSM et le fond schématique (la simulation redémarre)">
            Fond : {mapLabel}
          </button>
          {mapKind === 'osm' && (
            <button type="button" data-testid="toggle-aerial" aria-pressed={aerial} onClick={() => setAerial((v) => !v)} title="Basculer entre le plan et la vue aérienne (IGN, France)">
              {aerial ? 'Vue : aérienne (IGN)' : 'Vue : plan'}
            </button>
          )}
          <label class="check small">
            <input type="checkbox" checked={tactical} disabled={mapKind === 'schematic'} onChange={(e) => setTactical((e.target as HTMLInputElement).checked)} />
            Vue tactique
          </label>
          <span class="legend small" aria-label="Légende des états de rue">
            <i class="sw slowed" /> ralentie <i class="sw partial" /> obstruée <i class="sw blocked" /> bloquée
          </span>
        </div>
      </section>

      <aside class="side right">
        {ctrl && (
          <>
            <DetailPanel
              ctrl={ctrl}
              orderMode={orderMode}
              onOrderMode={setOrderMode}
              onCenter={centerOn}
              onClose={() => {
                ctrl.select(null);
                setRev((r) => r + 1);
              }}
            />
            <LogPanel events={ctrl.sim.journal.events} />
          </>
        )}
      </aside>
    </div>
  );
}
