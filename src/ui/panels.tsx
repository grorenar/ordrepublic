import type { GameController } from '../game/controller';
import type { EntityRef } from '../game/selection';
import { sameRef } from '../game/selection';
import { FORCE_CODE, VEHICLE_LABEL } from '../render/GameRenderer';
import type { CrowdGroup, ForceKind, IncidentState, LogEvent, MoverEntity, Poi, PoiState, UnitStatus } from '../engine/types';
import type { SimSpeed } from '../engine/clock';
import { DECOR_KIND_LABEL, severityMeaning } from '../engine/incidents';
import type { City } from '../state/types';
import { clockText, dayPart } from '../game/daylight';
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
        <span class="clock" data-testid="sim-clock" title={`Heure du jeu (${dayPart(ctrl.clockSec)}) — temps de simulation écoulé : ${mmss(st.simTimeMs)}`}>
          {clockText(ctrl.clockSec)}
        </span>
        <small data-testid="day-part">{dayPart(ctrl.clockSec)}</small>
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
        <div class="counter" role="listitem" title={`Incidents fictifs : ${st.incidents.total} au total, ${st.incidents.resolved} terminés, ${st.incidents.fires} incendies ; ${st.incidents.damagedPois} commerces fictifs et ${st.incidents.damagedDecor} objets endommagés ; coût fictif cumulé ${st.incidents.costEur.toLocaleString('fr-FR')} €`}>
          <span class="label">Incidents</span>
          <strong data-testid="counter-incidents">{st.incidents.active}</strong>
          <small data-testid="counter-damage">{st.incidents.costEur.toLocaleString('fr-FR')} € fictifs</small>
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
      <h2>Incidents (fictifs)</h2>
      <ul class="list" data-testid="incident-list">
        {sim.incidents.active().map((i) => (
          <li key={i.id}>
            <button type="button" class={sel({ type: 'incident', id: i.id }) ? 'sel' : ''} onClick={() => onSelect({ type: 'incident', id: i.id }, false)} data-testid={`row-${i.id}`}>
              <span class="grow">{i.label}</span>
              <small>gravité {i.severity}</small>
            </button>
          </li>
        ))}
        {sim.incidents.active().length === 0 && <li class="muted small">Aucun incident en cours.</li>}
      </ul>
    </div>
  );
}

const INCIDENT_STATE_LABEL: Record<IncidentState, string> = { emerging: 'naissant', active: 'actif', escalating: 'en aggravation', contained: 'confiné', resolved: 'terminé', lingering: 'persistant (fumée, ruines)' };
const POI_STATE_LABEL: Record<PoiState, string> = { intact: 'intact', damaged: 'endommagé', burning: 'en feu', destroyed: 'détruit' };
const POI_KIND_LABEL: Record<Poi['kind'], string> = { commerce: 'Commerce', public: 'Établissement public', school: 'École', company: 'Entreprise', furniture: 'Mobilier', gathering: 'Espace de rassemblement' };

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
        <p class="muted">Cliquez sur une unité, un véhicule, un groupe, un incident ou un lieu (Maj+clic pour ajouter des unités). Clic droit sur la carte : ordre de déplacement.</p>
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
      rows = [['Type', VEHICLE_LABEL[v.vehicle]], ['Équipage', String(v.crew)], ['Avertisseurs', v.emergency ? 'activés (circulation rapide, sens interdits permis)' : 'coupés (circulation normale)'], ...moverRows(ctrl, v)];
      history = sim.journal.forSubject('vehicle', v.id).slice(-6).map((e) => ({ simTimeMs: e.simTimeMs, text: e.text, why: e.why.note }));
    }
  } else if (primary.type === 'incident') {
    const i = sim.incidents.get(primary.id);
    if (i) {
      title = i.label;
      rows = [
        ['État', INCIDENT_STATE_LABEL[i.state]],
        ['Gravité', `${i.severity} / 5 — ${severityMeaning(i.kind, i.severity)}`],
        ['Depuis', clockText(ctrl.dayStartSec + i.startedAtMs / 1000)],
        ['Coût fictif', `${Math.round(i.costEur).toLocaleString('fr-FR')} €`],
        ['Cible', `${DECOR_KIND_LABEL[sim.world.item(i.targetDecorId)?.kind ?? 'debris']} (objet de scénario fictif)`],
      ];
      if (i.parentId) rows.push(['Propagé depuis', `${sim.incidents.get(i.parentId)?.label ?? i.parentId}`]);
      if (i.childIds.length) rows.push(['Conséquences', i.childIds.map((c) => sim.incidents.get(c)?.label ?? c).join(' ; ')]);
      if (i.groupId) rows.push(['Groupe à l’origine', sim.group(i.groupId)?.label ?? i.groupId]);
      origin = `${i.cause.note} [${i.cause.kind}]`;
      history = i.history.slice(-8).map((h) => ({ simTimeMs: h.simTimeMs, text: h.text, why: h.why.note }));
    }
  } else if (primary.type === 'poi') {
    const p = sim.world.poi(primary.id);
    if (p) {
      title = p.name ?? POI_KIND_LABEL[p.kind];
      rows = [
        ['Nature', `${POI_KIND_LABEL[p.kind]}${p.category ? ` (${p.category})` : ''}`],
        ['Source', p.source === 'osm' ? 'OpenStreetMap (information géographique, jamais une cible)' : 'objet de scénario fictif'],
        ['État', POI_STATE_LABEL[p.state]],
        ['Dégâts', `${Math.round(p.damage)} / 100`],
      ];
      if (p.streetCategory) rows.push(['Rue', p.streetCategory]);
      if (p.incidentIds.length) rows.push(['Incidents', p.incidentIds.map((id) => sim.incidents.get(id)?.label ?? id).join(' ; ')]);
      history = p.incidentIds.flatMap((id) => sim.incidents.get(id)?.history ?? []).slice(-8).map((h) => ({ simTimeMs: h.simTimeMs, text: h.text, why: h.why.note }));
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
        {ctrl.selectedVehicles().length > 0 && (
          <button type="button" class={ctrl.selectedVehicles().every((e) => e.entity === 'vehicle' && e.emergency) ? 'primary' : ''} data-testid="lights-toggle" aria-pressed={ctrl.selectedVehicles().every((e) => e.entity === 'vehicle' && e.emergency)} onClick={() => ctrl.setLights(!ctrl.selectedVehicles().every((e) => e.entity === 'vehicle' && e.emergency))}>
            🚨 Avertisseurs
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
                <time>{clockText(ctrl.dayStartSec + h.simTimeMs / 1000)}</time> {h.text}
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

export function LogPanel({ events, dayStartSec }: { events: readonly LogEvent[]; dayStartSec: number }) {
  const shown = events.filter((e) => e.code !== 'unit.created').slice(-60).reverse();
  return (
    <div class="panel log" data-testid="log-panel">
      <h2>Journal</h2>
      <ol>
        {shown.map((e) => (
          <li key={e.id} class={e.level} data-code={e.code}>
            <time>{clockText(dayStartSec + e.simTimeMs / 1000)}</time> {e.text}
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
