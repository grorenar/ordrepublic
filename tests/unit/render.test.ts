import { describe, expect, it } from 'vitest';
import { buildCrowdLayout, toneThresholds } from '../../src/render/crowd';
import { crowdDotCount, hitTest, lodForZoom, type HitTarget } from '../../src/render/lod';
import type { CrowdGroup } from '../../src/state/types';

const group: CrowdGroup = { id: 'G', label: 'g', pos: { x: 0, y: 0 }, size: 600, tension: 50, disposition: 'restless', seed: 3 };

describe('niveaux de détail', () => {
  it('agrège la foule à faible zoom et détaille progressivement', () => {
    expect(lodForZoom(13).aggregateCrowd).toBe(true);
    expect(crowdDotCount(group, lodForZoom(13))).toBe(0);
    const mid = crowdDotCount(group, lodForZoom(15.2));
    const hi = crowdDotCount(group, lodForZoom(17));
    expect(mid).toBeGreaterThan(0);
    expect(hi).toBeGreaterThan(mid);
    expect(hi).toBeLessThanOrEqual(450);
  });

  it('boucliers en formation seulement à fort zoom', () => {
    expect(lodForZoom(15).shieldFormation).toBe(false);
    expect(lodForZoom(16.2).shieldFormation).toBe(true);
  });
});

describe('disposition de la foule', () => {
  it('est déterministe pour une graine donnée et reste dans le disque', () => {
    const a = buildCrowdLayout(120, 7);
    const b = buildCrowdLayout(120, 7);
    expect(Array.from(a.rx)).toEqual(Array.from(b.rx));
    expect(Array.from(buildCrowdLayout(120, 8).rx)).not.toEqual(Array.from(a.rx));
    for (let i = 0; i < a.count; i++) expect(Math.hypot(a.rx[i]!, a.ry[i]!)).toBeLessThan(1.2);
  });

  it('plus la tension monte, plus la part de points rouges augmente', () => {
    expect(toneThresholds(10).red).toBe(0);
    expect(toneThresholds(90).red).toBeGreaterThan(toneThresholds(60).red);
    const t = toneThresholds(100);
    expect(t.red + t.amber).toBeLessThanOrEqual(1);
  });
});

describe('sélection au clic', () => {
  const targets: HitTarget[] = [
    { ref: { type: 'group', id: 'G-1' }, x: 100, y: 100, r: 60, z: 0 },
    { ref: { type: 'unit', id: 'U-1' }, x: 110, y: 100, r: 14, z: 2 },
  ];
  it('privilégie le pion devant la foule qui le recouvre', () => {
    expect(hitTest(targets, { x: 112, y: 101 })).toEqual({ type: 'unit', id: 'U-1' });
  });
  it('sélectionne la foule ailleurs, et rien en dehors', () => {
    expect(hitTest(targets, { x: 60, y: 100 })).toEqual({ type: 'group', id: 'G-1' });
    expect(hitTest(targets, { x: 400, y: 400 })).toBeNull();
  });
});
