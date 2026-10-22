import { describe, expect, it } from 'vitest';
import { AIRPORT_BY_CODE } from '../../data/airports';
import { flightsOf } from '../../engine/core/entities';
import { aircraftLive } from '../../engine/core/query';
import { fmtTime, fromUTC } from '../../engine/core/time';
import type { ContractOffer } from '../../engine/core/types';
import { demoFlights } from '../../engine/dev';
import { createGame } from '../../engine/newGame';
import { advanceTo } from '../../engine/sim';
import {
  awaitingDelivery, chipInfo, commercialById, deliveryTag, fitCodes, onMap, purposeChain, groupCommercial, headingDeg, isCommercialId, lerpAngle, mapAirports, offerPins, parkOffset, PARK_GAP, parseCommercialId, downSide, legLabelSide, pickNearest, placeLabels, regSlot, REG_DY,
  JET_PATH, selectedLegs, shortIndex, trackLabelAt, sunElevation, sunPoint, terminator, TYPE_STROKE, upNext, upNextRows,
} from './mapLogic';
import { addDeadhead } from '../../engine/core/entities';
import { acquireAircraft, commercialFlightsBetween, deliveryStatus, ticketBlock, ticketPurpose } from '../../engine/ops';
import { devGrantApproval } from '../../engine/ops/company';
import { devMarketOffer } from '../../engine/ops/market';
import { addCrew } from '../../engine/crew/fixtures';
import { DAY } from '../../engine/core/time';

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

describe('airline label side', () => {
  const W = 50;
  const H = 11;
  const east = Array.from({ length: 11 }, (_, i) => ({ x: i * 20, y: 0, ang: 90 })); // headingDeg: 90 = east
  const code = (x: number, y: number) => ({ id: '', x, y: y - 15, w: 28, h: 15 });
  it('rides across the track, below an east-west leg and right of a north-south one', () => {
    expect(downSide(90)).toBe(1);
    expect(downSide(270)).toBe(-1);
    const [x, y] = trackLabelAt(90, downSide(90), W, H);
    expect(Math.abs(x)).toBeLessThan(1e-9);
    expect(y).toBeGreaterThan(13);
    const [nx, ny] = trackLabelAt(0, downSide(0), W, H); // north
    expect(nx).toBeGreaterThan(13 + W / 2 - 1e-9);
    expect(Math.abs(ny)).toBeLessThan(1e-9);
  });
  it('keeps the leg\'s own airport codes clear and only changes side for a clearly better one', () => {
    expect(legLabelSide(east, W, H, [code(0, 0), code(200, 0)], 1)).toBe(1);
    expect(legLabelSide(east, W, H, [code(100, 40)], 1)).toBe(-1);
  });
  it('lifts our reg off an airport code just after take-off and puts it back once clear', () => {
    // LIS dot at (0, 0), its code drawn above it; our icon climbing north, 30 px above the dot.
    const lis = [{ id: '', x: 0, y: 0, w: 10, h: 10 }, { id: '', x: 0, y: -15, w: 28, h: 15 }];
    expect(regSlot(0, -30, 50, 11, lis, 0)).toBe(1);
    expect(regSlot(0, -30 - REG_DY * 3, 50, 11, lis, 1)).toBe(0);
    // Hysteresis: a sliver of overlap neither lifts it nor lets it back.
    const y = -15 - 7.5 - 5.5 - REG_DY + 1; // under box just 1 px into the code
    expect(regSlot(0, y, 50, 11, lis, 0)).toBe(0);
    expect(regSlot(0, y, 50, 11, lis, 1)).toBe(1);
    // Both sides taken: under, faded.
    const both = [...lis, { id: '', x: 0, y: -30 - REG_DY, w: 28, h: 15 }];
    expect(regSlot(0, -30, 50, 11, both, 0)).toBe(2);
  });
});

describe('v0.7 deliveries on the map', () => {
  /** Lisbon game, widebody approval and A330 pilots, an A330-200 signed for handover at Santiago. */
  function signed() {
    const g = game(7);
    devGrantApproval(g, 'widebody');
    addCrew(g, { CPT: 4, FO: 4 }, 'A330/340');
    g.company.cash = 60_000_000;
    const r = acquireAircraft(g, devMarketOffer(g, 'a332', { site: 'SCL' }));
    if (!r.ok) throw new Error(r.error);
    return { g, ac: g.fleet[r.data!.aircraftId] };
  }
  const run = (g: ReturnType<typeof game>, t: number) => { for (let i = 0; i < 10_000 && g.now < t; i++) advanceTo(g, t); };

  it('hides it before the handover, draws it at the site with a DELIVERY tag after, clears the tag at home', () => {
    const { g, ac } = signed();
    const dl = ac.delivery!;
    expect(ac.status).toBe('delivering');
    expect(onMap(ac)).toBe(false);
    expect(deliveryTag(ac)).toBe(false);
    expect(fitCodes(g)).not.toContain('SCL');
    expect(mapAirports(g).map((a) => a.code)).not.toContain('SCL');
    expect(chipInfo(g, ac, g.now).line).toMatch(/^Handover (SCL )?\d{1,2} [A-Z][a-z]{2}$/);
    // Selected (from the fleet strip), the arcs show the whole ferry chain home, dashed, night stops included.
    const legs = selectedLegs(g, ac.id, 1);
    expect(legs.map((l) => l.id)).toEqual(dl.ferryIds);
    expect(legs[0].from).toBe('SCL');
    expect(legs[legs.length - 1].to).toBe('LIS');
    expect(legs.every((l) => l.dashed && !l.current)).toBe(true);
    expect(purposeChain(g, g.flights[dl.ferryIds[1]]).map((f) => f.id)).toEqual(dl.ferryIds);
    // The delivery pilots' airline tickets (bought with the roster, the day before) say why they fly.
    run(g, ac.deliveredAt - DAY);
    expect(onMap(ac)).toBe(false);
    const ds = deliveryStatus(g, ac.id)!;
    expect(ds.ticketIds.length).toBeGreaterThan(0);
    expect(ticketPurpose(g, ds.ticketIds[0]).text).toMatch(new RegExp(`^Delivery crew for ${ac.reg} · ferry SCL–LIS`));

    run(g, ac.deliveredAt + 60);
    expect(onMap(ac)).toBe(true);
    expect(ac.at).toBe('SCL');
    expect(deliveryTag(ac)).toBe(true);
    expect(awaitingDelivery(g, 'SCL').map((a) => a.id)).toEqual([ac.id]);
    expect(awaitingDelivery(g, 'LIS')).toEqual([]);
    expect(chipInfo(g, ac, g.now).line).toMatch(/^Ferry home \d{1,2} [A-Z][a-z]{2}$/);
    expect(mapAirports(g).map((a) => a.code)).toContain('SCL');

    const first = g.flights[dl.ferryIds[0]];
    run(g, first.std + first.delay + 30);
    expect(ac.flightId).toBe(first.id);
    expect(deliveryTag(ac)).toBe(true);
    const cur = selectedLegs(g, ac.id, 1);
    expect(cur[0]).toMatchObject({ id: first.id, current: true, dashed: true });
    expect(cur.length).toBe(dl.ferryIds.length);
    expect(awaitingDelivery(g, 'SCL')).toEqual([]);

    run(g, ac.deliveredAt + 6 * DAY);
    expect(ac.at).toBe('LIS');
    expect(deliveryTag(ac)).toBe(false);
  }, 30_000);

  it('chips a refit and a lease return check', () => {
    const g = game();
    const ac = Object.values(g.fleet)[0];
    const end = g.now + 10 * DAY;
    g.maintenance.m1 = { id: 'm1', aircraftId: ac.id, kind: 'refit', at: 'HAM', start: g.now, end, cost: 0, status: 'inWork', planned: true, ev: 0 };
    ac.status = 'maintenance';
    ac.maintId = 'm1';
    expect(chipInfo(g, ac, g.now)).toMatchObject({ tone: 'warn', short: 'Refit HAM' });
    expect(chipInfo(g, ac, g.now).line.length).toBeLessThanOrEqual(17);
    g.maintenance.m1.kind = 'return';
    expect(chipInfo(g, ac, g.now).line).toMatch(/^Return → /);
  });
});

// ---------- v0.7.1 ----------

/** One out-and-back DUS–FNC (aircraft at DUS, crew at LIS) rostered, then its captain taken off `hoursBefore` the report. */
async function shortOfCaptain(hoursBefore: number, dest = 'FNC', othersOnLeave = false, seed = 5) {
  const { addFlight } = await import('../../engine/core/entities');
  const { blockMinutes } = await import('../../engine/core/perf');
  const { buildDuties } = await import('../../engine/crew/duties');
  const { fixtureContract, fixtureGame } = await import('../../engine/crew/fixtures');
  const { autoRoster, releaseCrew, setFlightsCrew } = await import('../../engine/crew/roster');
  const { escalateShortages } = await import('../../engine/crew');
  const g = fixtureGame(seed);
  const acId = Object.keys(g.fleet)[0];
  const ac = g.fleet[acId];
  ac.at = 'DUS';
  const std = Math.floor(g.now / DAY) * DAY + 2 * DAY + 17 * 60;
  const b = blockMinutes(ac.typeId, 'DUS', dest);
  const k = fixtureContract(g, { pattern: { kind: 'legs', legs: [] }, aircraftIds: [acId], start: std - DAY, end: std + 2 * DAY, product: { kind: 'charter', price: 120_000, depositPct: 0.3, balanceDaysBefore: 7, fuelEscalation: false }, penalties: { cancelScale: [], perDelay: 2_500, perCancelledLeg: 15_000 } });
  const f1 = addFlight(g, { no: 'AW816', aircraftId: acId, contractId: k.id, kind: 'revenue', from: 'DUS', to: dest, std, sta: std + b, pax: 170 });
  const f2 = addFlight(g, { no: 'AW817', aircraftId: acId, contractId: k.id, kind: 'revenue', from: dest, to: 'DUS', std: std + b + 50, sta: std + 2 * b + 50, pax: 160 });
  buildDuties(g, acId, g.now, g.now + 5 * DAY);
  addCrew(g, { CPT: 2, FO: 2, PUR: 1, CC: 3 });
  autoRoster(g);
  const d = g.duties[g.flights[f1.id].dutyId!];
  const p = g.pairings[d.pairingId];
  const was = p.slots.find((s) => s.role === 'CPT' && s.crewId)!.crewId!;
  releaseCrew(g, p, was);
  setFlightsCrew(g, p);
  g.now = d.report - hoursBefore * 60;
  // Only the released captain (at base) is free: the jet is the way to get a captain to DUS in time.
  if (othersOnLeave) for (const c of Object.values(g.crew)) if (c.role === 'CPT' && c.id !== was) { c.blocks = [{ from: g.now - DAY, to: g.now + 10 * DAY, why: 'leave' }]; c.status = 'leave'; }
  escalateShortages(g);
  return { g, flightId: f1.id, backId: f2.id, acId, was };
}

describe('v0.7.1 crew shortages and private jets on the map', () => {
  it('indexes the ladder list, tones the chip and chips the Up Next row', async () => {
    const { g, flightId: id, backId, acId } = await shortOfCaptain(10);
    const f = g.flights[id];
    expect(f.crewAlert).toBe('red');
    const ix = shortIndex(g);
    const row = ix.byFlight.get(id)!;
    expect(row).toMatchObject({ flightId: id, aircraftId: acId, stage: 'red', std: f.std });
    expect(ix.byAircraft.get(acId)!.flightId).toBe(id);
    const ac = g.fleet[acId];
    const ci = chipInfo(g, ac, g.now, row);
    expect(ci.tone).toBe('bad');
    expect(ci.line).toBe(`CREW SHORT ${fmtTime(f.std)}`);
    expect(ci.line.length).toBeLessThanOrEqual(17);
    expect(ci.short.length).toBeLessThanOrEqual(10);
    expect(chipInfo(g, ac, g.now, { ...row, stage: 'amber' }).tone).toBe('warn');
    expect(chipInfo(g, ac, g.now).line).not.toMatch(/CREW/);
    const rows = upNextRows(g, 8);
    expect(rows.find((r) => r.id === id)?.alert).toBe('red');
    // The return leg shares the duty (short too); the airline legs carry no chip.
    expect(rows.find((r) => r.id === backId)?.alert).toBeTruthy();
    expect(rows.filter((r) => r.id !== id && r.id !== backId).every((r) => !r.alert)).toBe(true);
    // Two days out it is amber.
    const amber = await shortOfCaptain(40);
    expect(shortIndex(amber.g).byFlight.get(amber.flightId)?.stage).toBe('amber');
  });

  it('rows a chartered private jet by its type, flagged jet, with our crew aboard', async () => {
    const { charterJet, crewControl } = await import('../../engine/crew');
    const { g, flightId: id, was } = await shortOfCaptain(6, 'LHR', true);
    const view = crewControl(g, id, { previews: false });
    expect(view?.solutions.find((s) => s.id === 'jet')?.available).toBe(true);
    const r = charterJet(g, id, [was], 'midsize');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const t = g.flights[r.data!.ticketIds[0]];
    expect(t.charter).toBeTruthy();
    const cfs = commercialFlightsBetween(g, t.std - 1, t.sta + 1).filter((c) => c.ticketId === t.id);
    expect(cfs.length).toBe(1);
    expect(cfs[0].leg).toMatchObject({ jet: true, no: t.charter!.model, airline: t.charter!.operator });
    const row = upNextRows(g, 12, t.std - 1).find((x) => x.id === cfs[0].id);
    expect(row).toMatchObject({ jet: true, who: t.charter!.model, type: 'deadhead', crew: t.crewIds.length });
    expect(commercialById(g, cfs[0].id)?.leg.jet).toBe(true);
    // The flight is crewed now: no banner.
    expect(shortIndex(g).byFlight.has(id)).toBe(false);
    expect(JET_PATH.startsWith('M12 1.2')).toBe(true);
  });
});

describe('v0.7.2 hotel dots and C-check ferries', () => {
  it('keeps a crew station dot while anyone is still there; drops it when the last one leaves', async () => {
    const { touchCrewState } = await import('../../engine/crew/timeline');
    const g = game();
    const ids = addCrew(g, { CPT: 1, CC: 1 });
    const codes = () => mapAirports(g).map((a) => a.code);
    expect(codes()).not.toContain('FUE');
    for (const id of ids) Object.assign(g.crew[id], { loc: 'FUE', status: 'resting' });
    touchCrewState(g);
    expect(mapAirports(g).find((a) => a.code === 'FUE')).toEqual({ code: 'FUE', hub: false, label: false });
    // One flies home: the other keeps the dot.
    g.crew[ids[0]].loc = 'LIS';
    touchCrewState(g);
    expect(codes()).toContain('FUE');
    g.crew[ids[1]].loc = 'LIS';
    touchCrewState(g);
    expect(codes()).not.toContain('FUE');
  });

  it('a C-check ferry chain is the ferry out or the ferry home, labelled', async () => {
    const { newGame, owned } = await import('../../engine/contracts/testkit');
    const { bookCCheck, cCheckSlots } = await import('../../engine/ops/cHub');
    const { PURPOSE_LABEL } = await import('./mapLogic');
    const g = newGame(3);
    const ac = owned(g);
    const r = bookCCheck(g, ac.id, 'SOF', cCheckSlots(g, ac.id, 'SOF', 1)[0] + 3 * DAY);
    if (!r.ok) throw new Error(r.error);
    const m = g.maintenance[r.data!.maintId];
    const out = m.ferryIds!;
    const home = m.homeIds!;
    expect(purposeChain(g, g.flights[out[out.length - 1]]).map((f) => f.id)).toEqual(out);
    expect(purposeChain(g, g.flights[home[0]]).map((f) => f.id)).toEqual(home);
    expect(PURPOSE_LABEL[g.flights[home[0]].purpose!]).toBe('C-check ferry');
  });
});
