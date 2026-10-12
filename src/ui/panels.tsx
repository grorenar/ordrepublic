import type { GameController } from '../game/controller';
import type { EntityRef } from '../game/selection';
import { sameRef } from '../game/selection';
import { FORCE_CODE, VEHICLE_LABEL } from '../render/GameRenderer';
import type { CrowdGroup, ForceKind, LogEvent, MoverEntity, UnitStatus } from '../engine/types';
import type { SimSpeed } from '../engine/clock';
import type { City } from '../state/types';
import type { Vec2 } from '../geo/mercator';

export const mmss = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

const STATUS_LABEL: Record<UnitStatus, string> = {
  idle: 'En position',
  moving: 'En déplacement',
  waiting: 'En attente (itinéraire bloqué)',
  engaged: 'Engagée',
  in_difficulty: 'En difficulté',
  unavailable: 'Indisponible',
};
const FORCE_LABEL: Record<ForceKind, string> = {
  crs: 'Compagnie / section CRS (fictive)',
  police_nationale: 'Unité de police nationale (fictive)',
  gendarmerie_mobile: 'Escadron de gendarmerie mobile (fictif)',
  unite_speciale: 'Unité spécialisée (fictive)',
};
const PHASE_LABEL: Record<CrowdGroup['phase'], string> = {
  forming: 'Formation',
  moving: 'En marche',
  waiting: 'En attente (aucun itinéraire)',
  settled: 'Installé',
  dispersing: 'Dispersion',
  dispersed: 'Dispersé',
};
const KIND_LABEL: Record<CrowdGroup['kind'], string> = {
  march: 'Cortège',
  static: 'Rassemblement statique',
  secondary: 'Groupe secondaire',
};
const kmh = (mps: number) => `${(mps * 3.6).toFixed(1)} km/h (${mps.toFixed(2)} m/s)`;

const SPEEDS: Array<{ v: SimSpeed; label: string }> = [
  { v: 0, label: '⏸' },
  { v: 0.5, label: '0,5×' },
  { v: 1, label: '1×' },
  { v: 3, label: '3×' },
  { v: 6, label: '6×' },
];

interface TopBarProps {
  ctrl: GameController;
  cityName: string;
  cityId: string;
  presetCities: readonly City[];
  onCity: (c: City) => void;
  onToggleSearch: () => void;
  onExit: () => void;
  onSpeed: (s: SimSpeed) => void;
}

export function TopBar({ ctrl, cityName, cityId, presetCities, onCity, onToggleSearch, onExit, onSpeed }: TopBarProps) {
  const st = ctrl.stats();
  const known = presetCities.some((c) => c.id === cityId);
  const s = st.streets;
  return (
    <header class="topbar">
      <div class="brand">
        <button type="button" class="ghost" onClick={onExit} data-testid="exit">
          ← Accueil
        </button>
        <strong>ORDRE PUBLIC</strong>
        <span class="chip demo">SIMULATION · scénario fictif</span>
      </div>
      <div class="situation" data-testid="situation">
        <span>{cityName}</span>
        <span class="clock" data-testid="sim-clock" title="Temps de simulation écoulé">
          {mmss(st.simTimeMs)}
        </span>
        <div class="speeds" role="group" aria-label="Vitesse de simulation">
          {SPEEDS.map((o) => (
            <button
              key={o.v}
              type="button"
              class={ctrl.speed === o.v ? 'on' : ''}
              aria-pressed={ctrl.speed === o.v}
              data-testid={`speed-${o.v}`}
              onClick={() => onSpeed(o.v)}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>
      <div class="counters" role="list">
        <div
          class="counter"
          role="listitem"
          title={`Rues de la zone : ${s.blocked} bloquées (dont ${s.scenarioClosed} fermées par le scénario), ${s.partial} partiellement obstruées, ${s.slowed} ralenties, sur ${s.total}`}
        >
          <span class="label">Rues bloquées</span>
          <strong data-testid="counter-blocked">
            {s.blocked}/{s.total}
          </strong>
          <small data-testid="counter-streets-detail">
            {s.partial} part. · {s.slowed} ral.
          </small>
        </div>
        <div class="counter" role="listitem">
          <span class="label">Forces</span>
          <strong data-testid="counter-forces">{st.forces}</strong>
        </div>
        <div class="counter" role="listitem">
          <span class="label">Manifestants</span>
          <strong data-testid="counter-crowd">{st.people}</strong>
        </div>
        <div class="counter" role="listitem">
          <span class="label">Véhicules</span>
          <strong data-testid="counter-vehicles">{st.vehicles}</strong>
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

interface ListProps {
  ctrl: GameController;
  onSelect: (r: EntityRef, additive: boolean) => void;
}

export function ForcesPanel({ ctrl, onSelect }: ListProps) {
  const sim = ctrl.sim;
  const sel = (r: EntityRef) => ctrl.isSelected(r);
  return (
    <div class="panel" data-testid="forces-panel">
      <h2>Unités</h2>
      <ul class="list">
        {sim.units.map((u) => (
          <li key={u.id}>
            <button
              type="button"
              class={sel({ type: 'unit', id: u.id }) ? 'sel' : ''}
              onClick={(e) => onSelect({ type: 'unit', id: u.id }, e.shiftKey)}
              data-testid={`row-${u.id}`}
            >
              <span class={`badge ${u.force}`}>
                {FORCE_CODE[u.force]} {u.num}
              </span>
              <span class="grow">{STATUS_LABEL[u.status]}</span>
              <small>{u.headcount}</small>
            </button>
          </li>
        ))}
      </ul>
      <h2>Véhicules et secours</h2>
      <ul class="list">
        {sim.vehicles.map((v) => (
          <li key={v.id}>
            <button
              type="button"
              class={sel({ type: 'vehicle', id: v.id }) ? 'sel' : ''}
              onClick={(e) => onSelect({ type: 'vehicle', id: v.id }, e.shiftKey)}
              data-testid={`row-${v.id}`}
            >
              <span class="badge vehicle">{v.id}</span>
              <span class="grow">{v.callsign}</span>
              <small>{STATUS_LABEL[v.status].split(' (')[0]}</small>
            </button>
          </li>
        ))}
      </ul>
      <h2>Groupes de manifestants</h2>
      <ul class="list">
        {sim.groups.map((g) => (
          <li key={g.id}>
            <button type="button" class={sel({ type: 'group', id: g.id }) ? 'sel' : ''} onClick={() => onSelect({ type: 'group', id: g.id }, false)} data-testid={`row-${g.id}`}>
              <span class="badge group">{g.id}</span>
              <span class="grow">{g.label}</span>
              <small>{sim.size(g)}</small>
            </button>
          </li>
        ))}
        {sim.groups.length === 0 && <li class="muted small">Aucun groupe présent.</li>}
      </ul>
    </div>
  );
}

interface DetailProps {
  ctrl: GameController;
  orderMode: boolean;
  onOrderMode: (on: boolean) => void;
  onCenter: (pos: Vec2) => void;
  onClose: () => void;
}

function Rows({ rows }: { rows: Array<[string, string]> }) {
  return (
    <dl>
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function moverRows(c: GameController, e: MoverEntity): Array<[string, string]> {
  const rows: Array<[string, string]> = [['Statut', STATUS_LABEL[e.status]], ['Vitesse réelle', kmh(e.speedMps)]];
  if (e.order && e.route) {
    rows.push(['Destination', 'point désigné par le joueur']);
    rows.push(['Distance restante', `${Math.max(0, Math.round(e.route.length - e.routeS))} m`]);
  } else rows.push(['Ordre', 'aucun']);
  void c;
  return rows;
}

export function DetailPanel({ ctrl, orderMode, onOrderMode, onCenter, onClose }: DetailProps) {
  const sim = ctrl.sim;
  const primary = ctrl.primary;
  if (!primary) {
    return (
      <div class="panel" data-testid="detail-panel">
        <h2>Sélection</h2>
        <p class="muted">Cliquez sur une unité, un véhicule ou un groupe (Maj+clic pour en ajouter). Clic droit sur la carte : ordre de déplacement.</p>
      </div>
    );
  }
  let title = '';
  let rows: Array<[string, string]> = [];
  let history: Array<{ simTimeMs: number; text: string; why: string }> = [];
  let origin = '';
  const pos = ctrl.positionOf(primary);
  const movers = ctrl.selectedMovers();
  if (primary.type === 'unit') {
    const u = sim.entity(primary.id);
    if (u && u.entity === 'unit') {
      title = movers.length > 1 ? `${movers.length} éléments sélectionnés` : u.callsign;
      rows = [['Type', FORCE_LABEL[u.force]], ['Effectif', `${u.headcount} agents`], ...moverRows(ctrl, u)];
      history = sim.journal.forSubject('unit', u.id).slice(-6).map((e) => ({ simTimeMs: e.simTimeMs, text: e.text, why: e.why.note }));
    }
  } else if (primary.type === 'vehicle') {
    const v = sim.entity(primary.id);
    if (v && v.entity === 'vehicle') {
      title = movers.length > 1 ? `${movers.length} éléments sélectionnés` : v.callsign;
      rows = [['Type', VEHICLE_LABEL[v.vehicle]], ['Équipage', String(v.crew)], ...moverRows(ctrl, v)];
      history = sim.journal.forSubject('vehicle', v.id).slice(-6).map((e) => ({ simTimeMs: e.simTimeMs, text: e.text, why: e.why.note }));
    }
  } else {
    const g = sim.group(primary.id);
    if (g) {
      title = g.label;
      const dest = g.plan.destination;
      rows = [
        ['Type', KIND_LABEL[g.kind]],
        ['Phase', PHASE_LABEL[g.phase]],
        ['Effectif', `${sim.size(g)} personnes`],
        ['Vitesse réelle', kmh(g.speedMps)],
        ['Raison de la vitesse', g.speedCause],
        ['Tension', `${Math.round(g.tension)} / 100`],
        ['Niveau de simulation', `N${g.level}${g.blocks ? ' (par blocs)' : ''}`],
      ];
      if (dest) rows.push(['Destination', dest.label]);
      if (g.route && g.route.length > 0) rows.push(['Avancement', `${Math.round((100 * Math.max(0, g.sCentre)) / g.route.length)} %`]);
      origin = `${g.origin.note} [${g.origin.kind}]`;
      history = sim.explain(g.id).slice(-8).map((h) => ({ simTimeMs: h.simTimeMs, text: h.text, why: h.why.note }));
      if (primary.type === 'group' && primary.member !== undefined) rows.push(['Individu', `n° ${primary.member}`]);
    }
  }
  const canOrder = movers.length > 0;
  const results = ctrl.lastOrders;
  return (
    <div class="panel selected" data-testid="detail-panel">
      <h2>
        Sélection
        <button type="button" class="ghost" onClick={onClose} aria-label="Désélectionner">
          ✕
        </button>
      </h2>
      <h3 data-testid="detail-title">{title}</h3>
      <Rows rows={rows} />
      {origin && (
        <p class="small" data-testid="detail-origin">
          <strong>Pourquoi ce groupe existe : </strong>
          {origin}
        </p>
      )}
      <div class="btn-row">
        {pos && (
          <button type="button" onClick={() => onCenter(pos)} data-testid="center-selection">
            Centrer la carte
          </button>
        )}
        {canOrder && (
          <>
            <button type="button" class={orderMode ? 'primary' : ''} aria-pressed={orderMode} onClick={() => onOrderMode(!orderMode)} data-testid="order-move">
              {orderMode ? 'Cliquez la destination…' : 'Aller ici'}
            </button>
            <button type="button" onClick={() => ctrl.cancelOrders()} data-testid="order-cancel">
              Annuler l’ordre
            </button>
          </>
        )}
      </div>
      {canOrder && results.some((r) => !r.ok) && (
        <p class="warn small" data-testid="order-refused">
          {results.filter((r) => !r.ok).map((r) => `${r.id} : ${r.reason ?? 'ordre refusé'}`).join(' · ')}
        </p>
      )}
      {history.length > 0 && (
        <details class="why">
          <summary>Historique et causes</summary>
          <ol class="small" data-testid="detail-history">
            {history.map((h, i) => (
              <li key={i}>
                <time>{mmss(h.simTimeMs)}</time> {h.text}
                <br />
                <em>Pourquoi : {h.why}</em>
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}

export function LogPanel({ events }: { events: readonly LogEvent[] }) {
  const shown = events.filter((e) => e.code !== 'unit.created').slice(-60).reverse();
  return (
    <div class="panel log" data-testid="log-panel">
      <h2>Journal</h2>
      <ol>
        {shown.map((e) => (
          <li key={e.id} class={e.level} data-code={e.code}>
            <time>{mmss(e.simTimeMs)}</time> {e.text}
            <details class="why">
              <summary>Pourquoi ?</summary>
              <span class="small">
                {e.why.note} <em>[{e.why.kind}]</em>
              </span>
            </details>
          </li>
        ))}
        {shown.length === 0 && <li class="muted">Rien à signaler pour l’instant.</li>}
      </ol>
    </div>
  );
}

export { sameRef };
