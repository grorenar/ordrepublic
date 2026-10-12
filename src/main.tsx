import { Component, render, type ComponentChildren } from 'preact';
import { App } from './app/App';
import './styles.css';

declare global {
  interface Window {
    __booted?: boolean;
    __bootFail?: (msg: string) => void;
  }
}

const describe = (e: unknown): string => (e instanceof Error ? `${e.name} : ${e.message}` : String(e));

/** Affiche l'erreur à l'écran (jamais de page blanche silencieuse). */
function fatal(msg: string): void {
  console.error('[Ordre Public] erreur fatale :', msg);
  if (window.__bootFail) window.__bootFail(msg);
}

/** Capture les erreurs de rendu des composants : message visible + bouton de rechargement. */
class ErrorBoundary extends Component<{ children: ComponentChildren }, { error: string | null }> {
  override state = { error: null as string | null };
  override componentDidCatch(e: unknown): void {
    console.error('[Ordre Public] erreur de rendu :', e);
    this.setState({ error: describe(e) });
  }
  override render() {
    if (this.state.error === null) return this.props.children;
    return (
      <div role="alert" data-testid="fatal-error" style={{ font: '15px system-ui, sans-serif', color: '#fecaca', background: '#450a0a', padding: '20px', margin: '24px', borderRadius: '8px', maxWidth: '760px' }}>
        <strong>Ordre Public a rencontré une erreur.</strong>
        <p style={{ whiteSpace: 'pre-wrap' }}>{this.state.error}</p>
        <p>Détail dans la console du navigateur (F12).</p>
        <button type="button" onClick={() => location.reload()}>
          Recharger
        </button>
      </div>
    );
  }
}

// Erreurs hors rendu (initialisation du moteur, de la carte, promesses rejetées)
window.addEventListener('unhandledrejection', (e) => fatal(`Erreur d’initialisation : ${describe(e.reason)}`));
window.addEventListener('error', (e) => {
  if (e.error) fatal(`Erreur JavaScript : ${describe(e.error)}`);
});

try {
  const host = document.getElementById('app') as HTMLElement;
  host.replaceChildren();
  render(
    <ErrorBoundary>
      <App />
    </ErrorBoundary>,
    host,
  );
  window.__booted = true;
} catch (e) {
  fatal(`Échec du démarrage : ${describe(e)}`);
}
