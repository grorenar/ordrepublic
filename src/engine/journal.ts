import type { Cause, HistoryEntry, LogEvent } from './types';

/** Journal de simulation borné, avec numérotation stable. */
export class Journal {
  readonly events: LogEvent[] = [];
  private nextId = 1;
  constructor(private readonly max = 5000) {}

  add(e: Omit<LogEvent, 'id'>): LogEvent {
    const ev = { ...e, id: this.nextId++ };
    this.events.push(ev);
    if (this.events.length > this.max) this.events.splice(0, this.events.length - this.max);
    return ev;
  }

  byCode(code: string): LogEvent[] {
    return this.events.filter((e) => e.code === code);
  }

  /** Événements d'un sujet, du plus ancien au plus récent. */
  forSubject(type: string, id: string): LogEvent[] {
    return this.events.filter((e) => e.subject?.type === type && e.subject.id === id);
  }

  get count(): number {
    return this.nextId - 1;
  }
}

export function pushHistory(history: HistoryEntry[], h: HistoryEntry, max = 60): void {
  history.push(h);
  if (history.length > max) history.splice(0, history.length - max);
}

export function causeText(c: Cause): string {
  return `${c.note} [${c.kind}:${c.refId}]`;
}
