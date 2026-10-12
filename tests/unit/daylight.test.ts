import { describe, expect, it } from 'vitest';
import { AUTUMN_DAYLIGHT, clockText, darkness, dayPart } from '../../src/game/daylight';

const h = (hh: number, mm = 0) => hh * 3600 + mm * 60;

describe('cycle jour/nuit', () => {
  it('plein jour l’après-midi, nuit noire tard, progressif au crépuscule', () => {
    expect(darkness(h(14))).toBe(0);
    expect(darkness(h(18, 30))).toBeCloseTo(0, 6);
    expect(darkness(h(19, 0))).toBeGreaterThan(0.3);
    expect(darkness(h(19, 0))).toBeLessThan(0.8);
    expect(darkness(h(19, 30))).toBeCloseTo(1, 6);
    expect(darkness(h(23))).toBe(1);
    expect(darkness(h(3))).toBe(1);
    expect(darkness(h(7, 50))).toBeCloseTo(0, 6);
  });
  it('monotone du coucher du soleil à la nuit', () => {
    let prev = -1;
    for (let t = AUTUMN_DAYLIGHT.sunsetSec; t <= AUTUMN_DAYLIGHT.sunsetSec + 3000; t += 60) {
      const d = darkness(t);
      expect(d).toBeGreaterThanOrEqual(prev);
      prev = d;
    }
  });
  it('parties de la journée et affichage de l’heure (24 h, passage de minuit)', () => {
    expect(dayPart(h(12))).toBe('jour');
    expect(dayPart(h(19))).toBe('crépuscule');
    expect(dayPart(h(22))).toBe('nuit');
    expect(clockText(h(17, 30))).toBe('17:30:00');
    expect(clockText(h(23, 59) + 59 + 120)).toBe('00:01:59');
    expect(clockText(86400 + 61)).toBe('00:01:01');
  });
});
