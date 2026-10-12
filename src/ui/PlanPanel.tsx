import type { ForceKind } from '../engine/types';
import type { OperationPlan } from '../scenarios/plan';

export type PlanTool = 'start' | 'end' | 'waypoint' | 'closure' | 'unit';

const TOOLS: Array<{ id: PlanTool; label: string; hint: string }> = [
  { id: 'start', label: 'Départ', hint: 'Cliquez sur la carte pour placer le point de départ.' },
  { id: 'end', label: 'Arrivée', hint: 'Cliquez sur la carte pour placer le point d’arrivée.' },
  { id: 'waypoint', label: 'Point de passage', hint: 'Cliquez pour ajouter un passage imposé (itinéraire forcé) ; cliquez sur un passage existant pour le retirer.' },
  { id: 'closure', label: 'Fermer / rouvrir un axe', hint: 'Cliquez sur une rue pour la fermer ; cliquez sur une fermeture pour la lever.' },
  { id: 'unit', label: 'Placer une unité', hint: 'Cliquez pour poser une unité ; cliquez sur une unité posée pour la retirer.' },
];

const FORCES: Array<[ForceKind, string]> = [
  ['crs', 'CRS (bouclier)'],
  ['police_nationale', 'Police nationale'],
  ['gendarmerie_mobile', 'Gendarmerie mobile'],
  ['unite_speciale', 'Unité spéciale'],
];

export const hhmm = (s: number): string => `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`;
const parseHhmm = (v: string): number | null => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(v);
  return m ? Math.min(86399, Number(m[1]) * 3600 + Number(m[2]) * 60) : null;
};

interface Props {
  plan: OperationPlan;
  tool: PlanTool | null;
  force: ForceKind;
  routeInfo: { lengthM: number } | { error: string } | null;
  error: string | null;
  onTool: (t: PlanTool | null) => void;
  onForce: (f: ForceKind) => void;
  onChange: (p: OperationPlan) => void;
  onLaunch: () => void;
  onCancel: () => void;
  onExport: () => void;
  onImport: (file: File) => void;
}

/** Panneau du mode planification (bac à sable) : définir la manifestation déclarée et le dispositif, puis lancer la simulation. */
export function PlanPanel({ plan, tool, force, routeInfo, error, onTool, onForce, onChange, onLaunch, onCancel, onExport, onImport }: Props) {
  const set = <K extends keyof OperationPlan>(k: K, v: OperationPlan[K]) => onChange({ ...plan, [k]: v });
  const hint = TOOLS.find((t) => t.id === tool)?.hint;
  const eta = routeInfo && 'lengthM' in routeInfo ? Math.round(routeInfo.lengthM / 1.0 / 60) : null;
  const lo = Math.round(plan.declaredSize * (1 - plan.uncertaintyPct / 100));
  const hi = Math.round(plan.declaredSize * (1 + plan.uncertaintyPct / 100));
  return (
    <div class="panel plan" data-testid="plan-panel">
      <h2>Planification (bac à sable)</h2>
      <p class="muted small">Préparez une manifestation « déclarée » et le dispositif, puis lancez la simulation. Tout est fictif.</p>
      <label class="field">
        Nom
        <input type="text" value={plan.name} maxLength={80} data-testid="plan-name" onInput={(e) => set('name', (e.target as HTMLInputElement).value)} />
      </label>
      <label class="field">
        Heure de départ
        <input type="time" value={hhmm(plan.departClockSec)} data-testid="plan-time" onInput={(e) => { const v = parseHhmm((e.target as HTMLInputElement).value); if (v !== null) set('departClockSec', v); }} />
      </label>
      <label class="field">
        Effectif déclaré
        <input type="number" min={1} max={200000} value={plan.declaredSize} data-testid="plan-size" onInput={(e) => set('declaredSize', Math.max(1, Math.min(200000, Number((e.target as HTMLInputElement).value) || 1)))} />
      </label>
      <label class="field">
        Incertitude (± %)
        <input type="number" min={0} max={90} value={plan.uncertaintyPct} data-testid="plan-uncertainty" onInput={(e) => set('uncertaintyPct', Math.max(0, Math.min(90, Number((e.target as HTMLInputElement).value) || 0)))} />
      </label>
      <p class="small" data-testid="plan-range">
        Effectif réel inconnu avant le départ : entre {lo} et {hi} personnes.
      </p>
      <label class="field">
        Maintien sur place à l’arrivée (min)
        <input type="number" min={0} max={240} value={plan.dwellMin} data-testid="plan-dwell" onInput={(e) => set('dwellMin', Math.max(0, Math.min(240, Number((e.target as HTMLInputElement).value) || 0)))} />
      </label>
      <div class="btn-row" role="group" aria-label="Outils de placement">
        {TOOLS.map((t) => (
          <button key={t.id} type="button" class={tool === t.id ? 'primary' : ''} aria-pressed={tool === t.id} data-testid={`plan-tool-${t.id}`} onClick={() => onTool(tool === t.id ? null : t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      {tool === 'unit' && (
        <label class="field">
          Type d’unité
          <select value={force} data-testid="plan-force" onChange={(e) => onForce((e.target as HTMLSelectElement).value as ForceKind)}>
            {FORCES.map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </label>
      )}
      {hint && <p class="small" data-testid="plan-hint">{hint}</p>}
      <ul class="small" data-testid="plan-summary">
        <li>Points de passage : {plan.waypoints.length}</li>
        <li>Axes fermés : {plan.closures.length}</li>
        <li>Unités : {plan.units.length}</li>
      </ul>
      {routeInfo && 'lengthM' in routeInfo && (
        <p class="small" data-testid="plan-route">
          Itinéraire prévu : {routeInfo.lengthM} m, environ {eta} min de marche.
        </p>
      )}
      {routeInfo && 'error' in routeInfo && (
        <p class="warn small" data-testid="plan-route-error">
          {routeInfo.error}
        </p>
      )}
      {error && (
        <p class="warn small" data-testid="plan-error">
          {error}
        </p>
      )}
      <div class="btn-row">
        <button type="button" class="primary" data-testid="plan-launch" onClick={onLaunch}>
          Lancer l’opération
        </button>
        <button type="button" data-testid="plan-cancel" onClick={onCancel}>
          Retour à la démonstration
        </button>
      </div>
      <div class="btn-row">
        <button type="button" data-testid="plan-export" onClick={onExport}>
          Exporter le plan
        </button>
        <label class="btn">
          Importer un plan
          <input type="file" accept="application/json,.json" class="visually-hidden" data-testid="plan-import" onChange={(e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) onImport(f); (e.target as HTMLInputElement).value = ''; }} />
        </label>
      </div>
    </div>
  );
}
