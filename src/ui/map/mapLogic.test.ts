import { describe, expect, it } from 'vitest';
import { AIRPORT_BY_CODE } from '../../data/airports';
import { flightsOf } from '../../engine/core/entities';
import { aircraftLive } from '../../engine/core/query';
import { fromUTC } from '../../engine/core/time';
import type { ContractOffer } from '../../engine/core/types';
import { demoFlights } from '../../engine/dev';
import { createGame } from '../../engine/newGame';
import { advanceTo } from '../../engine/sim';
import {
  chipInfo, commercialById, fitCodes, groupCommercial, headingDeg, isCommercialId, lerpAngle, mapAirports, offerPins, parkOffset, PARK_GAP, parseCommercialId, pickNearest, placeLabels,
  selectedLegs, sunElevation, sunPoint, terminator, TYPE_STROKE, upNext, upNextRows,
} from './mapLogic';
import { addDeadhead } from '../../engine/core/entities';
import { commercialFlightsBetween, ticketBlock } from '../../engine/ops';

const game = (seed = 7) => createGame({ name: 'Atlântica Wings', code: 'AW', livery: { primary: '#0b1f4d', secondary: '#f5c451', tail: 'sweep' }, base: 'LIS', seed });

describe('sun and terminator', () => {
  it('puts the subsolar point where the sun is', () => {
    // March equinox 2027 (20 Mar ~14:25 UTC): declination ~0, sun over ~37°W at 14:25 UTC.
    const [lon, lat] = sunPoint(fromUTC(2027, 3, 20, 14, 25));
    expect(Math.abs(lat)).toBeLessThan(0.3);
    expect(lon).toBeGreaterThan(-39);
    expect(lon).toBeLessThan(-34);
    // June solstice: declination +23.4°; local noon at Greenwich around 12:02 UTC.
    const s = sunPoint(fromUTC(2027, 6, 21, 12, 0));
    expect(s[1]).toBeGreaterThan(23.2);
    expect(s[1]).toBeLessThan(23.5);
    expect(Math.abs(s[0])).toBeLessThan(1);
    // December: southern summer.
    expect(sunPoint(fromUTC(2027, 12, 21, 0, 0))[1]).toBeLessThan(-23.2);
  });

  it('draws the terminator where the sun is on the horizon, night pole on the dark side', () => {
    for (const t of [fromUTC(2027, 3, 1, 6), fromUTC(2027, 6, 21, 18), fromUTC(2027, 9, 23, 3), fromUTC(2027, 12, 5, 12)]) {
      const sun = sunPoint(t);
      const { pts, northNight } = terminator(sun, 5, 89.9);
      expect(pts.length).toBe(73);
      expect(pts[0][0]).toBe(-180);
      expect(pts[pts.length - 1][0]).toBeCloseTo(180);
      for (const [lon, lat] of pts) if (Math.abs(lat) < 85) expect(Math.abs(sunElevation(sun, lon, lat))).toBeLessThan(0.01);
      // The night-side pole is in the dark; its opposite is lit.
      const nightLat = northNight ? 89 : -89;
      expect(sunElevation(sun, sun[0] + 180, nightLat)).toBeLessThan(0);
      expect(sunElevation(sun, sun[0], -nightLat)).toBeGreaterThan(0);
      // The point under the sun is lit, its antipode is dark.
      expect(sunElevation(sun, sun[0], sun[1])).toBeCloseTo(90, 3);
      expect(sunElevation(sun, sun[0] + 180, -sun[1])).toBeCloseTo(-90, 3);
    }
  });

  it('never divides by zero at an equinox', () => {
    const { pts } = terminator([10, 0], 10);
    for (const [, lat] of pts) expect(Number.isFinite(lat)).toBe(true);
  });

  it('glides: a game minute moves the terminator a quarter degree', () => {
    const t = fromUTC(2027, 3, 1, 9);
    expect(Math.abs(sunPoint(t + 1)[0] - sunPoint(t)[0])).toBeCloseTo(0.25, 2);
  });
});

describe('geometry helpers', () => {
  it('parks aircraft on distinct stands at least a glyph apart', () => {
    for (const n of [1, 2, 5, 10]) {
      const pts = Array.from({ length: n }, (_, i) => parkOffset(i, n));
      for (let i = 0; i < n; i++) {
        expect(pts[i][0]).toBeGreaterThanOrEqual(18); // right of the airport dot
        for (let j = i + 1; j < n; j++) expect(Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1])).toBeGreaterThanOrEqual(PARK_GAP);
      }
    }
    expect(parkOffset(0, 1)).toEqual([24, 0]);
  });

  it('heads along the screen vector, wrapping at the antimeridian', () => {
    expect(headingDeg([0, 0], [0, -1])).toBeCloseTo(0); // up
    expect(headingDeg([0, 0], [1, 0])).toBeCloseTo(90); // right
    expect(headingDeg([1990, 10], [5, 10], 2000)).toBeCloseTo(90); // eastbound across the edge
    expect(lerpAngle(350, 10, 0.5)).toBeCloseTo(360);
    expect(lerpAngle(10, 350, 1)).toBeCloseTo(-10);
  });

  it('picks the nearest item inside the radius', () => {
    const items = [{ x: 0, y: 0, item: 'a' }, { x: 10, y: 0, item: 'b' }];
    expect(pickNearest(items, 6, 0, 22)).toBe('b');
    expect(pickNearest(items, 4, 0, 22)).toBe('a');
    expect(pickNearest(items, 50, 0, 22)).toBeUndefined();
  });
});

describe('live positions', () => {
  it('flies the great circle to the arrival and lands exactly on the runway (no hover, no snap)', () => {
    const g = game();
    demoFlights(g, ['PMI'], 1);
    const ac = Object.values(g.fleet)[0];
    const f = flightsOf(g, ac.id)[0];
    advanceTo(g, f.std + 1);
    expect(ac.flightId).toBe(f.id);
    const on = f.eta!;
    const mid = aircraftLive(g, ac, (f.atd! + on) / 2);
    expect(mid.phase).toBe('airborne');
    expect(mid.progress).toBeCloseTo(0.5, 2);
    // Just before on-blocks the plane is at the runway, not short of it or hovering.
    const B = AIRPORT_BY_CODE[f.to];
    const before = aircraftLive(g, ac, on - 0.01);
    expect(Math.hypot(before.pos[0] - B.lon, before.pos[1] - B.lat)).toBeLessThan(0.05);
    const atOn = aircraftLive(g, ac, on);
    expect(atOn.progress).toBe(1);
    expect(atOn.pos[0]).toBeCloseTo(B.lon, 6);
    // After the arrival event it is parked at that same point.
    advanceTo(g, on);
    const after = aircraftLive(g, ac, on + 0.5);
    expect(after.phase).toBe('parked');
    expect(after.pos).toEqual([B.lon, B.lat]);
  });
});

describe('selection data', () => {
  it('lists the current leg then the next three for the selected aircraft', () => {
    const g = game();
    demoFlights(g, ['PMI', 'FAO'], 3);
    const ac = Object.values(g.fleet)[0];
    expect(selectedLegs(g, ac.id).map((l) => l.current)).toEqual([false, false, false]);
    const first = flightsOf(g, ac.id)[0];
    advanceTo(g, first.std + 1);
    const legs = selectedLegs(g, ac.id);
    expect(legs.length).toBe(4);
    expect(legs[0]).toMatchObject({ id: first.id, current: true, dashed: true, color: null }); // demo legs are ferries
    expect(legs.slice(1).every((l) => !l.current)).toBe(true);
    expect(selectedLegs(g, 'nope')).toEqual([]);
  });

  it('builds chips, up-next and the airports to draw', () => {
    const g = game();
    const [a, b] = Object.values(g.fleet);
    expect(chipInfo(g, a, g.now)).toEqual({ tone: 'idle', line: 'Idle at LIS', short: 'Idle LIS' });
    expect(upNext(g)).toEqual([]);
    demoFlights(g, ['PMI'], 2);
    expect(chipInfo(g, a, g.now).tone).toBe('good');
    expect(upNext(g, 3).length).toBe(3);
    // Legs already due drop out (the card refreshes between hourly emits).
    const first = upNext(g, 1)[0];
    expect(upNext(g, 3, first.std + first.delay).some((f) => f.id === first.id)).toBe(false);
    expect(chipInfo(g, a, g.now).short.length).toBeLessThanOrEqual(10);
    const aps = mapAirports(g);
    expect(aps.find((x) => x.code === 'LIS')).toMatchObject({ hub: true, label: true });
    expect(aps.find((x) => x.code === 'PMI')).toMatchObject({ hub: false, label: false });
    b.status = 'maintenance';
    expect(chipInfo(g, b, g.now)).toMatchObject({ tone: 'warn', line: 'Hangar LIS' });
    b.status = 'aog';
    expect(chipInfo(g, b, g.now).tone).toBe('bad');
  });

  it('groups open offers into pins, urgent first, and widens the fit to them', () => {
    const g = game();
    g.offers = {};
    const mk = (id: string, pin: string, urgency: ContractOffer['urgency'], status: ContractOffer['status'] = 'open') => {
      g.offers[id] = { id, pin, urgency, status } as ContractOffer;
    };
    mk('o1', 'HAM', 'normal');
    mk('o2', 'KBL', 'urgent');
    mk('o3', 'HAM', 'short');
    mk('o4', 'JED', 'normal', 'lost');
    mk('o5', 'XXX', 'normal');
    const pins = offerPins(g);
    expect(pins.map((p) => p.code)).toEqual(['KBL', 'HAM']);
    expect(pins[1].offers.length).toBe(2);
    expect(pins[0].urgent).toBe(true);
    const fit = fitCodes(g);
    expect(fit).toContain('LIS');
    expect(fit).toContain('HAM');
    expect(fit).toContain('CMN');
    expect(fit).not.toContain('JED');
    // A far pin (KBL, ~5,500 km from LIS) doesn't drag the default view across the world.
    expect(fit).not.toContain('KBL');
    // A fresh game at Riga frames its own neighbourhood: the Canaries anchor is dropped.
    g.company.homeBase = 'RIX';
    expect(fitCodes(g)).not.toContain('TFS');
    expect(fitCodes(g)).toContain('DUB');
  });

  it('places labels greedily in priority order', () => {
    const kept = placeLabels([
      { id: 'TFS', x: 0, y: 0, w: 22, h: 12 },
      { id: 'LPA', x: 12, y: 2, w: 22, h: 12 },
      { id: 'FUE', x: 40, y: 0, w: 22, h: 12 },
      { id: 'ACE', x: 44, y: 10, w: 22, h: 12 },
    ]);
    expect([...kept]).toEqual(['TFS', 'FUE']);
  });
});

describe('v0.5.2 flight types and airline legs', () => {
  it('styles every type: operating solid, empty legs dotted amber, deadheads thin grey dotted', () => {
    expect(TYPE_STROKE.operating.dash).toBe('');
    expect(TYPE_STROKE.positioning.dash).not.toBe('');
    expect(TYPE_STROKE.ferry.color).toBe(TYPE_STROKE.positioning.color);
    expect(TYPE_STROKE.deadhead.width).toBeLessThan(TYPE_STROKE.operating.width);
  });

  it('parses airline-leg selection ids', () => {
    expect(isCommercialId('f12:0')).toBe(true);
    expect(isCommercialId('f12')).toBe(false);
    expect(parseCommercialId('f1a:1')).toEqual({ ticketId: 'f1a', legIndex: 1 });
    expect(parseCommercialId('a3')).toBeNull();
  });

  it('one icon/row per airline flight, crew from every ticket on it; Up Next lists it as Deadhead', () => {
    const g = game();
    const crew = Object.keys(g.crew).slice(0, 3);
    const std = g.now + 120;
    const sta = std + ticketBlock('LIS', 'FRA');
    const a = addDeadhead(g, { crewIds: [crew[0]], from: 'LIS', to: 'FRA', std, sta, cost: 0 });
    addDeadhead(g, { crewIds: [crew[1], crew[2]], from: 'LIS', to: 'FRA', std, sta, cost: 0 });
    const legs = groupCommercial(commercialFlightsBetween(g, std, std + 10));
    expect(legs).toHaveLength(1);
    expect(legs[0].crewIds.sort()).toEqual([...crew].sort());
    const cf = commercialById(g, `${a.id}:0`)!;
    expect(cf.crewIds).toHaveLength(3);
    expect(cf.leg.no).toMatch(/^[A-Z0-9]{2} \d+$/);
    const rows = upNextRows(g, 4, g.now).filter((r) => r.type === 'deadhead');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ who: cf.leg.no, from: 'LIS', crew: 3, sel: { kind: 'flight', id: legs[0].id } });
    expect(commercialById(g, 'nope:0')).toBeNull();
  });
});
