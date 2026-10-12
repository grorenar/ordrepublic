import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { LocalFrame, zoomForBounds, type Bounds, type LngLat, type Vec2, type ViewState } from '../geo/mercator';
import { PRESET_CITIES } from '../geo/cities';
import { DEFAULT_ZOOM, MAP_PROVIDERS, type MapProviderId } from '../config/mapConfig';
import type { Settings } from '../config/settings';
import {
  ZONE_LEVELS,
  applyDemoEvent,
  blockedSegmentIds,
  computeStats,
  makeDemo,
  pruneBanners,
  pushLog,
  type DemoState,
} from '../demo/demoScenario';
import { MapLibreAdapter } from '../map/MapLibreAdapter';
import { SchematicAdapter } from '../map/SchematicAdapter';
import type { MapAdapter, MapStatus } from '../map/MapAdapter';
import { GameRenderer } from '../render/GameRenderer';
import type { City, EntityRef, StreetSegment } from '../state/types';
import { CitySearch } from './CitySearch';
import { DetailPanel, ForcesPanel, LogPanel, ObjectivesPanel, TopBar } from './panels';

export interface DebugFlags {
  debug: boolean;
  extraGroups: number;
  providerOverride?: MapProviderId;
}

interface Props {
  city: City;
  settings: Settings;
  debug: DebugFlags;
  onSettings: (s: Settings) => void;
  onExit: () => void;
}

type MapKind = 'maplibre' | 'schematic';
interface Notice {
  level: 'warn' | 'error';
  text: string;
}

function zoneBounds(frame: LocalFrame, zi: number): Bounds {
  const z = ZONE_LEVELS[zi] as (typeof ZONE_LEVELS)[number];
  const sw = frame.toLngLat({ x: -z.halfWidth, y: -z.halfHeight });
  const ne = frame.toLngLat({ x: z.halfWidth, y: z.halfHeight });
  return { west: sw.lng, south: sw.lat, east: ne.lng, north: ne.lat };
}

/** Zoom qui cadre la zone de jeu (avec marge) dans la vue courante de l'adaptateur. */
function zoomToFitZone(adapter: MapAdapter, frame: LocalFrame, zi: number, padding = 48): number {
  const v = adapter.getView();
  const z = zoomForBounds(zoneBounds(frame, zi), v.width, v.height, padding);
  return Math.max(12, Math.min(18, z));
}

function mergeSegments(prev: StreetSegment[], next: StreetSegment[]): StreetSegment[] {
  const m = new Map(prev.map((s) => [s.id, s]));
  for (const s of next) m.set(s.id, s);
  return [...m.values()];
}

export function GameScreen({ city: initialCity, settings, debug, onSettings, onExit }: Props) {
  const [city, setCity] = useState<City>(initialCity);
  const [mapKind, setMapKind] = useState<MapKind>(settings.preferSchematic ? 'schematic' : 'maplibre');
  const [mapStatus, setMapStatus] = useState<MapStatus>({ state: 'loading' });
  const [notice, setNotice] = useState<Notice | null>(null);
  const [zoneLevel, setZoneLevel] = useState(0);
  const [selection, setSelection] = useState<EntityRef | null>(null);
  const [segments, setSegments] = useState<StreetSegment[]>([]);
  const [tactical, setTactical] = useState(settings.tacticalLook);
  const [searchOpen, setSearchOpen] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const startRef = useRef(Date.now());
  const [demo, setDemo] = useState<DemoState>(() => makeDemo(initialCity, Date.now(), { extraGroups: debug.extraGroups }));

  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const adapterRef = useRef<MapAdapter | null>(null);
  const rendererRef = useRef<GameRenderer | null>(null);
  const cityRef = useRef(city);
  const zoneRef = useRef(zoneLevel);
  const lastViewRef = useRef<{ center: LngLat; zoom: number } | null>(null);
  const segTimer = useRef<number>(0);
  cityRef.current = city;
  zoneRef.current = zoneLevel;

  const provider: MapProviderId = debug.providerOverride ?? settings.provider;
  const frame = useMemo(() => new LocalFrame(city.center), [city]);
  const zone = ZONE_LEVELS[zoneLevel] as (typeof ZONE_LEVELS)[number];
  const blocked = useMemo(() => blockedSegmentIds(segments, demo.groups), [segments, demo.groups]);
  const stats = useMemo(() => computeStats(demo, segments, blocked), [demo, segments, blocked]);

  const log = useCallback((level: 'info' | 'warn' | 'alert', text: string) => {
    setDemo((d) => pushLog(d, Date.now(), level, text));
  }, []);

  // ---- segments de rues de la zone (recalculés après chaque stabilisation de la caméra)
  const refreshSegments = useCallback(() => {
    const adapter = adapterRef.current;
    if (!adapter) return;
    const c = cityRef.current;
    const z = ZONE_LEVELS[zoneRef.current] as (typeof ZONE_LEVELS)[number];
    const found = adapter.getStreetSegments(new LocalFrame(c.center), z);
    setSegments((prev) => (adapter.kind === 'schematic' ? found : mergeSegments(prev, found).filter((s) => s.points.every((p) => Math.abs(p.x) <= z.halfWidth && Math.abs(p.y) <= z.halfHeight))));
  }, []);
  const scheduleSegments = useCallback(
    (delay = 450) => {
      window.clearTimeout(segTimer.current);
      segTimer.current = window.setTimeout(refreshSegments, delay);
    },
    [refreshSegments],
  );

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
          : new MapLibreAdapter(host, {
              provider,
              customStyleUrl: settings.customStyleUrl,
              center: start.center,
              zoom: start.zoom,
              tactical,
            });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      setNotice({ level: 'error', text: `Carte indisponible (${reason}). Passage en mode schématique.` });
      log('alert', `Carte indisponible : ${reason}. Bascule en mode schématique.`);
      host.replaceChildren();
      if (mapKind !== 'schematic') setMapKind('schematic');
      return;
    }
    adapter.setScenarioOrigin(c.center);
    adapterRef.current = adapter;
    if (!lastViewRef.current) adapter.jumpTo(c.center, zoomToFitZone(adapter, new LocalFrame(c.center), zoneRef.current));
    setSegments([]);
    const offMove = adapter.onMove(() => {
      const v = adapter.getView();
      lastViewRef.current = { center: { lng: v.lng, lat: v.lat }, zoom: v.zoom };
      rendererRef.current?.draw(performance.now());
      if (adapter.kind === 'maplibre') scheduleSegments(700);
    });
    const offStatus = adapter.onStatus((s) => {
      setMapStatus(s);
      if (s.state === 'degraded') setNotice({ level: 'warn', text: s.reason });
      if (s.state === 'ready') {
        setNotice((n) => (n && n.level === 'warn' ? null : n));
        scheduleSegments(adapter.kind === 'schematic' ? 0 : 900);
      }
    });
    adapter.ready.catch((err: unknown) => {
      if (adapterRef.current !== adapter) return;
      const reason = err instanceof Error ? err.message : String(err);
      setNotice({ level: 'error', text: `${reason} Bascule automatique vers le mode schématique.` });
      log('alert', 'Service cartographique indisponible : bascule en mode schématique.');
      setMapKind('schematic');
    });
    return () => {
      window.clearTimeout(segTimer.current);
      offMove();
      offStatus();
      adapter.destroy();
      if (adapterRef.current === adapter) adapterRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapKind, provider, settings.customStyleUrl]);

  useEffect(() => adapterRef.current?.setTactical(tactical), [tactical, mapKind]);

  // ---- couche de rendu du jeu
  useEffect(() => {
    const canvas = canvasRef.current as HTMLCanvasElement;
    const fallback: ViewState = { lng: 0, lat: 0, zoom: 1, width: 1, height: 1 };
    const renderer = new GameRenderer(canvas, () => adapterRef.current?.getView() ?? fallback);
    rendererRef.current = renderer;
    renderer.start();
    return () => {
      renderer.stop();
      rendererRef.current = null;
    };
  }, []);

  useEffect(() => {
    rendererRef.current?.setSnapshot({
      origin: city.center,
      zone,
      units: demo.units,
      vehicles: demo.vehicles,
      groups: demo.groups,
      incidents: demo.incidents,
      segments,
      blockedSegmentIds: blocked,
      selection,
    });
  }, [city, zone, demo, segments, blocked, selection]);

  // ---- changement de ville : saut de caméra + régénération complète des pions
  const firstCity = useRef(true);
  useEffect(() => {
    if (firstCity.current) {
      firstCity.current = false;
      return;
    }
    const adapter = adapterRef.current;
    setSelection(null);
    setSegments([]);
    setDemo(makeDemo(city, Date.now(), { extraGroups: debug.extraGroups }));
    adapter?.setScenarioOrigin(city.center);
    if (adapter) adapter.jumpTo(city.center, zoomToFitZone(adapter, new LocalFrame(city.center), zoneRef.current));
    scheduleSegments(adapter?.kind === 'schematic' ? 0 : 1200);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [city]);

  useEffect(() => {
    setSegments([]);
    scheduleSegments(adapterRef.current?.kind === 'schematic' ? 0 : 300);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoneLevel]);

  // ---- horloge d'affichage, bandeaux, connexion réseau
  useEffect(() => {
    const id = window.setInterval(() => {
      const n = Date.now();
      setNowMs(n);
      setDemo((d) => pruneBanners(d, n));
    }, 500);
    const off = () => setNotice({ level: 'warn', text: 'Connexion Internet perdue : les tuiles non chargées resteront vides. Vous pouvez passer au fond schématique.' });
    const on = () => setNotice((n) => (n?.text.startsWith('Connexion Internet perdue') ? null : n));
    window.addEventListener('offline', off);
    window.addEventListener('online', on);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('offline', off);
      window.removeEventListener('online', on);
    };
  }, []);

  // ---- interactions pions (clic = sélection ; survol = surbrillance)
  useEffect(() => {
    const wrap = wrapRef.current as HTMLDivElement;
    let down: Vec2 | null = null;
    const local = (e: PointerEvent): Vec2 => {
      const r = wrap.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const onDown = (e: PointerEvent) => {
      if ((e.target as HTMLElement).closest('.map-ui')) return;
      down = local(e);
    };
    const onUp = (e: PointerEvent) => {
      if (!down) return;
      const p = local(e);
      const moved = Math.hypot(p.x - down.x, p.y - down.y);
      down = null;
      if (moved > 5 || (e.target as HTMLElement).closest('.map-ui')) return;
      setSelection(rendererRef.current?.hit(p) ?? null);
    };
    const onMove = (e: PointerEvent) => {
      if (e.buttons || (e.target as HTMLElement).closest('.map-ui')) {
        rendererRef.current?.setHover(null);
        wrap.classList.remove('hit-hover');
        return;
      }
      const h = rendererRef.current?.hit(local(e)) ?? null;
      rendererRef.current?.setHover(h ? h.id : null);
      wrap.classList.toggle('hit-hover', !!h);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelection(null);
    };
    wrap.addEventListener('pointerdown', onDown, true);
    wrap.addEventListener('pointerup', onUp, true);
    wrap.addEventListener('pointermove', onMove);
    window.addEventListener('keydown', onKey);
    return () => {
      wrap.removeEventListener('pointerdown', onDown, true);
      wrap.removeEventListener('pointerup', onUp, true);
      wrap.removeEventListener('pointermove', onMove);
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
      getView: () => adapterRef.current?.getView(),
      nativeProject: (m: Vec2) => adapterRef.current?.debugProject?.(frame.toLngLat(m)),
      targets: () => rendererRef.current?.getTargets(),
      stats: () => rendererRef.current?.getStats(),
      resetStats: () => rendererRef.current?.resetStats(),
      skip: (layers: string[]) => {
        const sk = rendererRef.current?.skip;
        sk?.clear();
        layers.forEach((l) => sk?.add(l));
      },
      entities: () => ({ units: demo.units, vehicles: demo.vehicles, groups: demo.groups, incidents: demo.incidents }),
      counters: () => stats,
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
    (ref: EntityRef, center = true) => {
      setSelection(ref);
      if (!center) return;
      const pos =
        ref.type === 'unit'
          ? demo.units.find((u) => u.id === ref.id)?.pos
          : ref.type === 'vehicle'
            ? demo.vehicles.find((v) => v.id === ref.id)?.pos
            : ref.type === 'group'
              ? demo.groups.find((g) => g.id === ref.id)?.pos
              : demo.incidents.find((i) => i.id === ref.id)?.pos;
      if (pos) centerOn(pos);
    },
    [demo, centerOn],
  );
  const changeZone = (next: number) => {
    setZoneLevel(next);
    const a = adapterRef.current;
    if (a) a.flyTo(city.center, zoomToFitZone(a, frame, next));
  };
  const fitZone = () => adapterRef.current?.fitBounds(zoneBounds(frame, zoneLevel), 90);
  const switchMap = () => {
    const next: MapKind = mapKind === 'maplibre' ? 'schematic' : 'maplibre';
    setNotice(null);
    setMapKind(next);
    onSettings({ ...settings, preferSchematic: next === 'schematic' });
  };
  const pickCity = (c: City) => {
    setCity(c);
    setSearchOpen(false);
  };

  const mapLabel =
    mapKind === 'schematic'
      ? 'Fond schématique (hors ligne)'
      : `Carte OSM — ${MAP_PROVIDERS[provider].label.split(' (')[0]}`;
  const elapsed = Math.max(0, Math.floor((nowMs - startRef.current) / 1000));

  return (
    <div class="game" data-testid="game" data-map-kind={mapKind} data-map-state={mapStatus.state}>
      <TopBar
        cityName={city.name}
        presetCities={PRESET_CITIES}
        cityId={city.id}
        onCity={pickCity}
        onToggleSearch={() => setSearchOpen((v) => !v)}
        onExit={onExit}
        stats={stats}
        elapsed={elapsed}
      />
      {searchOpen && (
        <div class="search-pop map-ui" data-testid="search-pop">
          <CitySearch geocoderUrl={settings.geocoderUrl} onPick={pickCity} compact />
        </div>
      )}
      <aside class="side left">
        <ForcesPanel
          units={demo.units}
          vehicles={demo.vehicles}
          groups={demo.groups}
          selection={selection}
          onSelect={(r) => select(r)}
        />
      </aside>

      <section class="map-area" ref={wrapRef} aria-label="Carte de la zone de jeu">
        <div class={`map-host ${tactical ? 'tactical' : ''}`} ref={hostRef} data-testid="map-host" />
        <canvas class="game-layer" ref={canvasRef} data-testid="game-layer" aria-hidden="true" />

        <div class="banners map-ui" aria-live="polite">
          {demo.banners.map((b) => (
            <div key={b.id} class={`banner ${b.level}`} data-testid="banner">
              {b.text}
            </div>
          ))}
        </div>

        {(notice || mapStatus.state === 'loading') && (
          <div class={`map-notice map-ui ${notice?.level ?? 'info'}`} role="status" data-testid="map-notice">
            <span>{notice ? notice.text : 'Chargement de la carte…'}</span>
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
            <button
              type="button"
              aria-label="Réduire la zone"
              disabled={zoneLevel === 0}
              data-testid="zone-shrink"
              onClick={() => {
                changeZone(zoneLevel - 1);
                log('info', `Zone de jeu réduite à ${ZONE_LEVELS[zoneLevel - 1]!.halfWidth * 2} × ${ZONE_LEVELS[zoneLevel - 1]!.halfHeight * 2} m.`);
              }}
            >
              ◂
            </button>
            <span data-testid="zone-size" title="Zone de jeu (largeur × hauteur)">
              {zone.halfWidth * 2}×{zone.halfHeight * 2} m
            </span>
            <button
              type="button"
              aria-label="Étendre la zone"
              disabled={zoneLevel === ZONE_LEVELS.length - 1}
              data-testid="zone-grow"
              onClick={() => {
                changeZone(zoneLevel + 1);
                log('info', `Zone de jeu étendue à ${ZONE_LEVELS[zoneLevel + 1]!.halfWidth * 2} × ${ZONE_LEVELS[zoneLevel + 1]!.halfHeight * 2} m.`);
              }}
            >
              ▸
            </button>
          </div>
        </div>

        <div class="map-bottom map-ui">
          <button type="button" class="primary" data-testid="demo-event" onClick={() => setDemo((d) => applyDemoEvent(d, Date.now(), zone))}>
            Déclencher un événement de démonstration
          </button>
          <button type="button" data-testid="switch-map" onClick={switchMap} title="Basculer entre la carte OSM et le fond schématique">
            Fond : {mapLabel}
          </button>
          <label class="check small">
            <input type="checkbox" checked={tactical} disabled={mapKind === 'schematic'} onChange={(e) => setTactical((e.target as HTMLInputElement).checked)} />
            Vue tactique
          </label>
        </div>
      </section>

      <aside class="side right">
        <DetailPanel selection={selection} demo={demo} onCenter={centerOn} onClose={() => setSelection(null)} />
        <ObjectivesPanel stats={stats} demo={demo} />
        <LogPanel entries={demo.log} startMs={startRef.current} />
      </aside>
    </div>
  );
}
