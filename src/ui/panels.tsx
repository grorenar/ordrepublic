import { ZONE_LEVELS, groupRadius, type DemoState, type DemoStats } from '../demo/demoScenario';
import type { City, CrowdGroup, EntityRef, ForceUnit, LogEntry, Vehicle } from '../state/types';
import type { Vec2 } from '../geo/mercator';

const mmss = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

const VEHICLE_LABEL: Record<Vehicle['kind'], string> = {
  van: 'Transport CRS',
  police_car: 'Véhicule de police',
  water_cannon: "Lanceur d'eau",
  ambulance: 'Ambulance',
  fire_truck: 'Sapeurs-pompiers',
};
const DISPOSITION_LABEL: Record<CrowdGroup['disposition'], string> = {
  peaceful: 'Pacifique',
  restless: 'Agité',
  hostile: 'Violent',
};

function tensionLabel(t: number): { label: string; cls: string } {
  if (t >= 65) return { label: 'Tension élevée', cls: 'hot' };
  if (t >= 35) return { label: 'Tension modérée', cls: 'warm' };
  return { label: 'Situation calme', cls: 'calm' };
}

interface TopBarProps {
  cityName: string;
  cityId: string;
  presetCities: readonly City[];
  onCity: (c: City) => void;
  onToggleSearch: () => void;
  onExit: () => void;
  stats: DemoStats;
  elapsed: number;
}

export function TopBar({ cityName, cityId, presetCities, onCity, onToggleSearch, onExit, stats, elapsed }: TopBarProps) {
  const tl = tensionLabel(stats.tension);
  const known = presetCities.some((c) => c.id === cityId);
  return (
    <header class="topbar">
      <div class="brand">
        <button type="button" class="ghost" onClick={onExit} data-testid="exit">
          ← Accueil
        </button>
        <strong>ORDRE PUBLIC</strong>
        <span class="chip demo">DÉMONSTRATION · données fictives</span>
      </div>
      <div class={`situation ${tl.cls}`} data-testid="situation">
        <span class="dot" />
        <span>
          {tl.label} — {cityName}
        </span>
        <span class="clock" title="Temps écoulé depuis le début de la démonstration">
          {mmss(elapsed)}
        </span>
      </div>
      <div class="counters" role="list">
        <div class="counter" role="listitem" title="Segments de rue recouverts par un groupe / segments connus de la zone (état simulé, pas de trafic réel)">
          <span class="label">Rues bloquées</span>
          <strong data-testid="counter-blocked">
            {stats.blocked}/{stats.totalSegments}
          </strong>
        </div>
        <div class="counter" role="listitem">
          <span class="label">Forces</span>
          <strong data-testid="counter-forces">{stats.headcountForces}</strong>
        </div>
        <div class="counter" role="listitem">
          <span class="label">Manifestants</span>
          <strong data-testid="counter-crowd">{stats.headcountCrowd}</strong>
        </div>
        <div class="counter" role="listitem">
          <span class="label">Véhicules</span>
          <strong>{stats.vehicles}</strong>
        </div>
        <div class="counter" role="listitem">
          <span class="label">Incidents</span>
          <strong data-testid="counter-incidents">{stats.activeIncidents}</strong>
        </div>
        <div class="counter tension" role="listitem">
          <span class="label">Tension</span>
          <div class="meter" aria-label={`Tension ${stats.tension} sur 100`}>
            <i style={{ width: `${stats.tension}%` }} class={tl.cls} />
          </div>
          <strong data-testid="counter-tension">{stats.tension}</strong>
        </div>
      </div>
      <div class="citybar">
        <label class="visually-hidden" for="city-select">
          Ville
        </label>
        <select
          id="city-select"
          data-testid="city-select"
          value={known ? cityId : '__custom'}
          onChange={(e) => {
            const c = presetCities.find((p) => p.id === (e.target as HTMLSelectElement).value);
            if (c) onCity(c);
          }}
        >
          {presetCities.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
          {!known && <option value="__custom">{cityName}</option>}
        </select>
        <button type="button" onClick={onToggleSearch} data-testid="search-toggle" aria-label="Rechercher une autre ville">
          🔍 Autre ville
        </button>
      </div>
    </header>
  );
}

interface ForcesProps {
  units: ForceUnit[];
  vehicles: Vehicle[];
  groups: CrowdGroup[];
  selection: EntityRef | null;
  onSelect: (r: EntityRef) => void;
}

export function ForcesPanel({ units, vehicles, groups, selection, onSelect }: ForcesProps) {
  const is = (t: EntityRef['type'], id: string) => selection?.type === t && selection.id === id;
  return (
    <div class="panel" data-testid="forces-panel">
      <h2>Unités</h2>
      <ul class="list">
        {units.map((u) => (
          <li key={u.id}>
            <button type="button" class={is('unit', u.id) ? 'sel' : ''} onClick={() => onSelect({ type: 'unit', id: u.id })} data-testid={`row-${u.id}`}>
              <span class={`badge ${u.kind}`}>{u.kind === 'crs' ? 'CRS' : 'POL'} {u.num}</span>
              <span class="grow">{u.callsign}</span>
              <small>{u.headcount}</small>
            </button>
          </li>
        ))}
      </ul>
      <h2>Véhicules et secours</h2>
      <ul class="list">
        {vehicles.map((v) => (
          <li key={v.id}>
            <button type="button" class={is('vehicle', v.id) ? 'sel' : ''} onClick={() => onSelect({ type: 'vehicle', id: v.id })}>
              <span class={`badge ${v.kind}`}>{v.id}</span>
              <span class="grow">{v.callsign}</span>
            </button>
          </li>
        ))}
      </ul>
      <h2>Groupes de manifestants</h2>
      <ul class="list">
        {groups.slice(0, 8).map((g) => (
          <li key={g.id}>
            <button type="button" class={is('group', g.id) ? 'sel' : ''} onClick={() => onSelect({ type: 'group', id: g.id })}>
              <span class={`badge g-${g.disposition}`}>{g.id}</span>
              <span class="grow">{g.label}</span>
              <small>{g.size}</small>
            </button>
          </li>
        ))}
        {groups.length > 8 && <li class="more">+ {groups.length - 8} autres groupes (banc d’essai)</li>}
      </ul>
    </div>
  );
}

interface DetailProps {
  selection: EntityRef | null;
  demo: DemoState;
  onCenter: (pos: Vec2) => void;
  onClose: () => void;
}

export function DetailPanel({ selection, demo, onCenter, onClose }: DetailProps) {
  if (!selection) {
    return (
      <div class="panel" data-testid="detail-panel">
        <h2>Sélection</h2>
        <p class="muted">Cliquez sur un pion de la carte ou une ligne de la liste pour consulter ses informations.</p>
      </div>
    );
  }
  let title = '';
  let rows: Array<[string, string]> = [];
  let pos: Vec2 | undefined;
  if (selection.type === 'unit') {
    const u = demo.units.find((x) => x.id === selection.id);
    if (u) {
      title = u.callsign;
      pos = u.pos;
      rows = [
        ['Type', u.kind === 'crs' ? 'Compagnie / section CRS (fictive)' : 'Unité de police (fictive)'],
        ['Effectif', `${u.headcount} agents`],
        ['Fatigue', `${Math.round(u.fatigue * 100)} %`],
        ['Statut', u.status],
      ];
    }
  } else if (selection.type === 'vehicle') {
    const v = demo.vehicles.find((x) => x.id === selection.id);
    if (v) {
      title = v.callsign;
      pos = v.pos;
      rows = [
        ['Type', VEHICLE_LABEL[v.kind]],
        ['Équipage', String(v.crew)],
        ['Statut', v.status],
      ];
    }
  } else if (selection.type === 'group') {
    const g = demo.groups.find((x) => x.id === selection.id);
    if (g) {
      title = g.label;
      pos = g.pos;
      rows = [
        ['Effectif', `${g.size} personnes`],
        ['Comportement', DISPOSITION_LABEL[g.disposition]],
        ['Tension', `${g.tension} / 100`],
        ['Emprise', `≈ ${Math.round(groupRadius(g) * 2)} m`],
      ];
    }
  } else {
    const i = demo.incidents.find((x) => x.id === selection.id);
    if (i) {
      title = i.label;
      pos = i.pos;
      rows = [
        ['Gravité', `${i.severity} / 5`],
        ['Depuis', `${Math.max(0, Math.round((Date.now() - i.startedAtMs) / 1000))} s`],
      ];
    }
  }
  return (
    <div class="panel selected" data-testid="detail-panel">
      <h2>
        Sélection
        <button type="button" class="ghost" onClick={onClose} aria-label="Désélectionner">
          ✕
        </button>
      </h2>
      <h3 data-testid="detail-title">{title}</h3>
      <dl>
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      {pos && (
        <button type="button" onClick={() => onCenter(pos as Vec2)} data-testid="center-selection">
          Centrer la carte
        </button>
      )}
      <p class="muted small">Les ordres seront disponibles dans une phase ultérieure.</p>
    </div>
  );
}

export function ObjectivesPanel({ stats, demo }: { stats: DemoStats; demo: DemoState }) {
  const worst = demo.incidents.reduce((m, i) => Math.max(m, i.severity), 0);
  const objs = [
    { label: 'Tension générale inférieure à 60', ok: stats.tension < 60 },
    { label: 'Aucun incident de gravité 4 ou plus', ok: worst < 4 },
    { label: 'Moins de 40 % des rues de la zone bloquées', ok: stats.totalSegments === 0 || stats.blocked / stats.totalSegments < 0.4 },
  ];
  return (
    <div class="panel" data-testid="objectives-panel">
      <h2>Objectifs (aperçu)</h2>
      <ul class="objectives">
        {objs.map((o) => (
          <li key={o.label} class={o.ok ? 'ok' : 'ko'}>
            <span aria-hidden="true">{o.ok ? '✔' : '✖'}</span> {o.label}
            <span class="visually-hidden">{o.ok ? ' (atteint)' : ' (menacé)'}</span>
          </li>
        ))}
      </ul>
      <p class="muted small">Évalués en direct sur l’état de la démonstration ; le système d’objectifs complet viendra en phase 6.</p>
    </div>
  );
}

export function LogPanel({ entries, startMs }: { entries: LogEntry[]; startMs: number }) {
  return (
    <div class="panel log" data-testid="log-panel">
      <h2>Journal</h2>
      <ol>
        {entries.slice(0, 40).map((e) => (
          <li key={e.id} class={e.level}>
            <time>{mmss(Math.max(0, Math.floor((e.atMs - startMs) / 1000)))}</time> {e.text}
          </li>
        ))}
      </ol>
    </div>
  );
}

export { ZONE_LEVELS };
