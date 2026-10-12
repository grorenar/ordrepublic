import { describe, expect, it } from 'vitest';
import { NavContext } from '../../src/nav/astar';
import { DEFAULT_NAV_PARAMS } from '../../src/nav/params';
import { EdgeClass } from '../../src/nav/graph';
import { gridGraph, nodePos } from './navHelpers';

const make = (width: number) => {
  // une seule rue : tout est piéton (le réseau routier n'existe pas)
  const graph = gridGraph({ cols: 4, rows: 1, spacing: 100, width, cls: EdgeClass.Pedestrian, noMotor: true });
  return { graph, nav: new NavContext(graph, DEFAULT_NAV_PARAMS) };
};

describe('véhicules sur voies piétonnes', () => {
  it('une voie piétonne assez large est empruntable par un véhicule', () => {
    const { graph, nav } = make(8);
    const r = nav.findRoute(nodePos(graph, 0), nodePos(graph, 3), 'vehicle');
    expect(r).not.toBeNull();
  });
  it('une voie piétonne trop étroite ne l’est pas', () => {
    const { graph, nav } = make(2.5);
    expect(nav.findRoute(nodePos(graph, 0), nodePos(graph, 3), 'vehicle')).toBeNull();
  });
});

describe('voie de bus en site propre', () => {
  const mk = (cls: number, width: number) => {
    const graph = gridGraph({ cols: 4, rows: 1, spacing: 100, width, cls: cls as never, noMotor: true });
    return { graph, nav: new NavContext(graph, DEFAULT_NAV_PARAMS) };
  };
  it('large : ouverte aux véhicules avec avertisseurs seulement, à vitesse d’artère (pas à 3 m/s)', () => {
    const { graph, nav } = mk(EdgeClass.Busway, 8);
    expect(nav.findRoute(nodePos(graph, 0), nodePos(graph, 3), 'vehicle')).toBeNull();
    expect(nav.findRoute(nodePos(graph, 0), nodePos(graph, 3), 'emergency')).not.toBeNull();
    expect(nav.vehicleSpeedOn(0)).toBe(DEFAULT_NAV_PARAMS.speedVehicleByClass[EdgeClass.Busway]);
    expect(nav.vehicleSpeedOn(0)).toBeGreaterThan(DEFAULT_NAV_PARAMS.vehicleFootwaySpeedMps * 1.5);
    // un chemin piéton large reste lent et ouvert à tout véhicule
    const f = mk(EdgeClass.Pedestrian, 8);
    expect(f.nav.vehicleSpeedOn(0)).toBe(DEFAULT_NAV_PARAMS.vehicleFootwaySpeedMps);
    expect(f.nav.findRoute(nodePos(f.graph, 0), nodePos(f.graph, 3), 'vehicle')).not.toBeNull();
  });
});
