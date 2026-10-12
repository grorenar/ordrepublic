/**
 * Horloge de simulation à pas fixe, indépendante de la fréquence d'affichage.
 * Vitesses : 0 (pause), 0,5, 1, 3, 6. Aucun accès à l'horloge murale : l'hôte fournit les delta réels.
 */
export type SimSpeed = 0 | 0.5 | 1 | 3 | 6;

export class SimClock {
  speed: SimSpeed = 1;
  private acc = 0;
  /** Nombre maximal de pas par appel (garde-fou contre la spirale de rattrapage). */
  readonly maxTicksPerAdvance: number;
  /** Plafond de temps réel pris en compte par appel (ms) : onglet masqué, point d'arrêt… */
  readonly maxRealDeltaMs: number;
  /** Temps réel « perdu » à cause des plafonds (diagnostic). */
  droppedMs = 0;

  constructor(
    readonly tickMs = 100,
    opts: { maxTicksPerAdvance?: number; maxRealDeltaMs?: number } = {},
  ) {
    this.maxTicksPerAdvance = opts.maxTicksPerAdvance ?? 8;
    this.maxRealDeltaMs = opts.maxRealDeltaMs ?? 250;
  }

  get paused(): boolean {
    return this.speed === 0;
  }

  setSpeed(s: SimSpeed): void {
    // la reprise ne rejoue jamais le temps écoulé en pause
    if (this.speed === 0 && s !== 0) this.acc = 0;
    this.speed = s;
  }

  /** Avance l'horloge de `realDeltaMs` ; retourne le nombre de ticks de simulation à exécuter. */
  advance(realDeltaMs: number): number {
    if (this.speed === 0) return 0;
    const dt = Math.min(Math.max(0, realDeltaMs), this.maxRealDeltaMs);
    this.droppedMs += Math.max(0, realDeltaMs) - dt;
    this.acc += dt * this.speed;
    let ticks = Math.floor(this.acc / this.tickMs);
    if (ticks > this.maxTicksPerAdvance) {
      this.droppedMs += (ticks - this.maxTicksPerAdvance) * this.tickMs;
      ticks = this.maxTicksPerAdvance;
      this.acc = 0;
    } else this.acc -= ticks * this.tickMs;
    return ticks;
  }

  /** Fraction du tick courant écoulée (0..1) : sert à interpoler le rendu entre deux états. */
  get alpha(): number {
    return this.speed === 0 ? 1 : Math.min(1, this.acc / this.tickMs);
  }

  reset(): void {
    this.acc = 0;
    this.droppedMs = 0;
  }
}
