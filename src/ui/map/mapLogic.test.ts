import { describe, expect, it } from 'vitest';
import { AIRPORT_BY_CODE } from '../../data/airports';
import { flightsOf } from '../../engine/core/entities';
import { aircraftLive } from '../../engine/core/query';
import { fmtTime, fromUTC } from '../../engine/core/time';
import type { ContractOffer, GameState } from '../../engine/core/types';
import { demoFlights, devRestPlan } from '../../engine/dev';
import { LIMIT_NAME, restNow, restPlanForFlight } from '../../engine/crew';
import { createGame } from '../../engine/newGame';
import { advanceTo } from '../../engine/sim';
import {
  awaitingDelivery, chipInfo, commercialById, deliveryTag, fitCodes, onMap, purposeChain, groupCommercial, headingDeg, isCommercialId, lerpAngle, mapAirports, offerPins, parkOffset, PARK_GAP, PARK_PER_ROW, regMark, standOffsets, parseCommercialId, downSide, legLabelSide, pickNearest, placeLabels, regSlot, REG_DY,
  JET_PATH, restChip, restingLine, restSeatNoun, selectedLegs, shortIndex, trackLabelAt, sunElevation, sunPoint, terminator, TYPE_STROKE, upNext, upNextRows,
  EVENT_PIN_GAP, leasedOut, mapLivery, placeEventPins, ringLabelAt, ringPath,
  ALERT_BANNER, ALERT_CHIP, hotelCount, OOH_SHORT, oohLine, parseSlipId, placeSlipMarks, SLIP_MARK_GAP, slipArcs, slipLine, slipSelId, slipWindow,
} from './mapLogic';
import { projection } from './mapData';
import { WORLD_ZONES } from '../../data/worldZones';
import { devWorldEvent } from '../../engine/dev';
import { worldEventPins, worldZones } from '../../engine/ops';
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

  it('v0.14 lays stands out to scale: no two aircraft (or their regs) overlap, a 747 takes a wider stand', () => {
    const a320 = { w: 21, h: 22.6 };
    const b744 = { w: 38.6, h: 42.4 };
    const a388 = { w: 47.9, h: 43.6 };
    const lab = 12;
    for (const sizes of [[a320], [a320, b744], [b744, a320, a388, a320, a320, b744, a320], Array.from({ length: 23 }, (_, i) => [a320, b744, a388][i % 3])]) {
      const pts = standOffsets(sizes, lab);
      expect(pts).toHaveLength(sizes.length);
      const box = (i: number) => ({ x: pts[i][0], y: pts[i][1] + lab / 2, w: sizes[i].w, h: sizes[i].h + lab });
      for (let i = 0; i < pts.length; i++) {
        expect(pts[i][0] - sizes[i].w / 2).toBeGreaterThanOrEqual(12); // right of the airport dot
        for (let j = i + 1; j < pts.length; j++) expect(boxOverlapPx(box(i), box(j))).toBe(0);
      }
      // rows of PARK_PER_ROW
      const rows = new Set(pts.map((p) => p[1].toFixed(2)));
      expect(rows.size).toBe(Math.ceil(sizes.length / PARK_PER_ROW));
    }
    // the stand after a 747 sits further right than the one after an A320
    expect(standOffsets([b744, a320], lab)[1][0]).toBeGreaterThan(standOffsets([a320, a320], lab)[1][0] + 15);
    // one row: centred near the dot's height
    expect(Math.abs(standOffsets([a320], lab)[0][1])).toBeLessThanOrEqual(lab);
  });

  it('v0.14 shows our tail mark without the shared registry prefix', () => {
    expect(regMark('CS-TTL', 'CS-')).toBe('TTL');
    expect(regMark('N801BH', 'N')).toBe('801BH');
    expect(regMark('D-AXYZ', 'CS-')).toBe('D-AXYZ');
    expect(regMark('CS-', 'CS-')).toBe('CS-');
    expect(regMark('EI-ABC', '')).toBe('EI-ABC');
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

  it('v0.12.1 D10 a crew alert for a flight on another day names the day', () => {
    const g = game();
    const a = Object.values(g.fleet)[0];
    const row = (std: number, kind: 'short' | 'hours') => ({ flightId: 'f', aircraftId: a.id, stage: 'amber' as const, hoursLeft: 30, std, kind });
    const today = chipInfo(g, a, g.now, row(g.now + 60, 'short'));
    expect(today.line).toBe(`CREW SHORT ${fmtTime(g.now + 60)}`);
    const later = g.now + 30 * 60;
    const c = chipInfo(g, a, g.now, row(later, 'short'));
    expect(c.line).toMatch(/^CREW (Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d\d:\d\d$/);
    expect(c.line.length).toBeLessThanOrEqual(18);
    expect(c.short.length).toBeLessThanOrEqual(10);
    expect(chipInfo(g, a, g.now, row(later, 'hours')).line).toMatch(/^HRS (Mon|Tue|Wed|Thu|Fri|Sat|Sun) /);
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
  escalateShortages(g, { freeFix: false });
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

describe('v0.7.3 crew rest on the aircraft panel', () => {
  it('names both sides in the chip, nothing without rest', () => {
    expect(restChip({ fc: { cls: 1, kind: 'fcrc', places: 2 }, cc: { cls: 2, kind: 'jSeats', places: 4 } })).toBe('Rest: pilots bunks · cabin crew business seats');
    expect(restChip({ fc: { cls: 1, kind: 'fcrc', places: 2 }, cc: null })).toBe('Rest: pilots bunks · cabin crew none');
    expect(restChip({ fc: null, cc: { cls: 1, kind: 'ldmcr', places: 7 } })).toBe('Rest: pilots none · cabin crew lower-deck module');
    expect(restChip({ fc: { cls: 2, kind: 'jSeats', places: 2 }, cc: { cls: 2, kind: 'jSeats', places: 5 } })).toBe('Rest: pilots & cabin crew business seats');
    expect(restChip({ fc: { cls: 1, kind: 'fcrc', places: 2 }, cc: { cls: 1, kind: 'ccrc', places: 8 } })).toBe('Rest: pilots & cabin crew bunks');
    expect(restChip({ fc: null, cc: null })).toBeNull();
    expect(restSeatNoun({ fc: null, cc: { cls: 2, kind: 'jSeats', places: 4 } })).toBe('business seats');
    expect(restSeatNoun({ fc: null, cc: { cls: 3, kind: 'recliners', places: 3 } })).toBe('seats');
  });

  it('writes one calm resting line: pilots by name, a cabin crew group by count', () => {
    expect(restingLine([])).toBeNull();
    const t = fromUTC(2027, 3, 1, 14, 20);
    expect(restingLine([{ names: ['Capt. Silva'], where: 'fcrc', until: t }])).toBe(`Resting: Capt. Silva (bunk) until ${fmtTime(t)} UTC`);
    expect(restingLine([{ names: ['Ana Reis', 'Rui Melo', 'Eva Lobo', 'Inês Sá'], where: 'ldmcr', until: t }])).toBe(`Resting: 4 cabin crew (lower deck) until ${fmtTime(t)} UTC`);
    expect(restingLine([{ names: ['FO Costa'], where: 'jSeats', until: t }, { names: ['Ana Reis'], where: 'jSeats', until: t + 30 }]))
      .toBe(`Resting: FO Costa (business seat) until ${fmtTime(t)} · Ana Reis (business seat) until ${fmtTime(t + 30)} UTC`);
  });

  it('finds someone resting mid-cruise on an augmented long-haul, and the line is pure', () => {
    const g = game(11);
    const id = devRestPlan(g);
    expect(id).not.toBe('');
    const plan = restPlanForFlight(g, id);
    expect(plan?.ok).toBe(true);
    const f = g.flights[id];
    const acId = f.aircraftId!;
    // Off blocks first (a random delay at the gate moves the rest plan with it), then into the first pilot rest.
    advanceTo(g, f.std, new Set());
    for (let i = 0; i < 48 && f.status === 'scheduled'; i++) advanceTo(g, g.now + 15, new Set());
    expect(f.status).toBe('enroute');
    const turn = restPlanForFlight(g, id)!.pilots.find((x) => x.flightId === id)!;
    advanceTo(g, Math.max(g.now, turn.start + 5), new Set());
    expect(g.fleet[acId].flightId).toBe(id);
    const a = restingLine(restNow(g, acId, g.now));
    expect(a).toMatch(/^Resting: .*\((bunk|business seat)\) until \d\d:\d\d.* UTC$/);
    expect(restingLine(restNow(g, acId, g.now))).toBe(a);
  });
});

describe('v0.8 world zones, event pins and leased aircraft', () => {
  const proj = projection(0);

  it('projects a zone ring as one closed path and labels it inside its shape', () => {
    const sudan = WORLD_ZONES.find((z) => z.id === 'sudan')!;
    const d = ringPath(sudan.ring, proj);
    expect(d.startsWith('M')).toBe(true);
    expect(d.endsWith('Z')).toBe(true);
    expect(d.split('L').length).toBe(sudan.ring.length);
    const at = ringLabelAt(sudan.ring, proj)!;
    const pts = sudan.ring.map((p) => proj(p)!);
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    expect(at.x).toBeGreaterThan(Math.min(...xs));
    expect(at.x).toBeLessThan(Math.max(...xs));
    expect(at.y).toBeGreaterThan(Math.min(...ys));
    expect(at.y).toBeLessThan(Math.max(...ys));
    expect(at.w).toBeCloseTo(Math.max(...xs) - Math.min(...xs), 5);
    // Khartoum lies inside, near the label; winding order does not matter.
    const krt = proj([32.55, 15.6])!;
    expect(Math.hypot(at.x - krt[0], at.y - krt[1])).toBeLessThan(at.w / 3);
    const back = ringLabelAt([...sudan.ring].reverse(), proj)!;
    expect(back.x).toBeCloseTo(at.x, 6);
    expect(ringLabelAt([[0, 0], [1, 1]], proj)).toBeNull();
    expect(ringPath([], proj)).toBe('');
  });

  it('every zone ring projects and labels on the ops map', () => {
    for (const z of WORLD_ZONES) {
      expect(ringPath(z.ring, proj), z.id).not.toBe('');
      expect(ringLabelAt(z.ring, proj), z.id).not.toBeNull();
    }
  });

  it('places event pins on the spot, or up-left of a marked airport or offer diamond, stepping left at one airport', () => {
    const pins = [
      { eventId: 'e1', at: 'NIM', kind: 'coup' as const, title: 'Coup' },
      { eventId: 'e2', at: 'LIS', kind: 'strike' as const, title: 'Strike' },
      { eventId: 'e3', at: 'LIS', kind: 'ash' as const, title: 'Ash' },
      { eventId: 'e4', at: 'PZU', kind: 'war' as const, title: 'War' },
    ];
    const out = placeEventPins(pins, new Set(['LIS']), new Set(['PZU']));
    expect(out.map((p) => p.off)).toEqual([[0, 0], [-22, -20], [-22 - EVENT_PIN_GAP, -20], [-22, -20]]);
    expect(out[0]).toMatchObject({ eventId: 'e1', at: 'NIM', kind: 'coup' });
    // Clear of the offer diamond (left, r 8.5) and the airport code (above): at least a finger apart from the dot.
    expect(Math.hypot(...out[1].off)).toBeGreaterThan(22);
  });

  it('a started world event gives a zone the map can draw and a pin at a known airport', () => {
    const g = game(5);
    const id = devWorldEvent(g, 'war');
    expect(id).not.toBe('');
    const pins = worldEventPins(g);
    const pin = pins.find((p) => p.eventId === id)!;
    expect(AIRPORT_BY_CODE[pin.at]).toBeDefined();
    const zones = worldZones(g);
    expect(worldZones(g)).toBe(zones);
    for (const z of zones) expect(ringPath(z.ring, proj)).not.toBe('');
  });

  it('chips a leased-out aircraft as leased at the lessee base', () => {
    const g = game();
    const ac = Object.values(g.fleet)[0];
    ac.status = 'leasedOut';
    ac.at = 'LAD';
    expect(leasedOut(ac)).toBe(true);
    const ci = chipInfo(g, ac, g.now);
    expect(ci.tone).toBe('idle');
    expect(ci.line).toBe('Leased LAD');
    expect(ci.short).toBe('Leased LAD');
    expect(onMap(ac)).toBe(true);
    expect(mapAirports(g).some((a) => a.code === 'LAD')).toBe(true);
  });
});

describe('v0.8 lessee paint', () => {
  it('draws a dry-leased aircraft in the lessee colours while painted for the lease', () => {
    const g = game();
    const ac = Object.values(g.fleet)[0];
    const cl = Object.values(g.clients)[0];
    const base = mapLivery(g, ac);
    expect(base.source).not.toBe('client');
    g.contracts.cx = { id: 'cx', clientId: cl.id, dry: { paint: 'full' } } as unknown as GameState['contracts'][string];
    ac.paintedFor = 'cx';
    const lv = mapLivery(g, ac);
    expect(lv.source).toBe('client');
    expect(lv.clientName).toBe(cl.name);
    delete ac.paintedFor;
    expect(mapLivery(g, ac).source).toBe(base.source);
  });
});

describe('v0.9 crew out of hours, hotel standby and crew changes on the map', () => {
  it('words a crew member out of hours apart from a shortage (the engine decides the kind)', async () => {
    const { addFlight } = await import('../../engine/core/entities');
    const { blockMinutes } = await import('../../engine/core/perf');
    const { buildDuties } = await import('../../engine/crew/duties');
    const { fixtureGame } = await import('../../engine/crew/fixtures');
    const { autoRoster } = await import('../../engine/crew/roster');
    const { outOfHours } = await import('../../engine/crew');
    const { devCrewHours } = await import('../../engine/dev');
    const g = fixtureGame(9);
    const acId = Object.keys(g.fleet)[0];
    const ac = g.fleet[acId];
    const std = Math.floor(g.now / DAY) * DAY + 2 * DAY + 9 * 60;
    const b = blockMinutes(ac.typeId, ac.at, 'FAO');
    addFlight(g, { no: 'AW900', aircraftId: acId, contractId: null, kind: 'revenue', from: ac.at, to: 'FAO', std, sta: std + b, pax: 150 });
    addFlight(g, { no: 'AW901', aircraftId: acId, contractId: null, kind: 'revenue', from: 'FAO', to: ac.at, std: std + b + 50, sta: std + 2 * b + 50, pax: 150 });
    buildDuties(g, acId, g.now, g.now + 5 * DAY);
    addCrew(g, { CPT: 2, FO: 2, PUR: 1, CC: 3 });
    autoRoster(g);
    g.now = std - 7 * 60;
    const id = devCrewHours(g);
    expect(id).not.toBe('');
    const row = shortIndex(g).byFlight.get(id)!;
    expect(row.kind).toBe('hours');
    const ci = chipInfo(g, ac, g.now, row);
    expect(ci.line).toBe(`OUT OF HRS ${fmtTime(g.flights[id].std)}`);
    expect(ci.line.length).toBeLessThanOrEqual(17);
    expect(ci.short.length).toBeLessThanOrEqual(10);
    expect(chipInfo(g, ac, g.now, { ...row, kind: 'short' }).line).toMatch(/^CREW SHORT /);
    expect(upNextRows(g, 6).find((r) => r.id === id)).toMatchObject({ alert: row.stage, alertKind: 'hours' });
    const ooh = outOfHours(g, id);
    expect(ooh.length).toBeGreaterThan(0);
    expect(oohLine(ooh)).toBe(`Crew out of hours · ${ooh[0].name} (${OOH_SHORT[ooh[0].limit]})${ooh.length > 1 ? ` and ${ooh.length - 1} other${ooh.length > 2 ? 's' : ''}` : ''}`);
    expect(ALERT_BANNER.hours).toBe('CREW OUT OF HOURS');
    expect(ALERT_CHIP.short).toBe('CREW SHORT');
  });

  it('names the limit in a few words and counts more than one person', () => {
    // v0.9 round 4 (§V): the one name per limit everywhere (LIMIT_NAME), the map tag included.
    expect(oohLine([{ name: 'Ana Silva', limit: 'block28d' }])).toBe('Crew out of hours · Ana Silva (28-day flying)');
    expect(oohLine([{ name: 'Ana Silva', limit: 'fdp' }, { name: 'Rui Costa', limit: 'fdp' }])).toBe('Crew out of hours · Ana Silva (day length (FDP)) and 1 other');
    expect(OOH_SHORT).toBe(LIMIT_NAME);
    expect(oohLine([])).toBe('Crew out of hours');
    for (const w of Object.values(OOH_SHORT)) expect(w.length).toBeLessThanOrEqual(16);
  });

  it('counts the hotel by pilots and cabin crew', () => {
    const list = [{ role: 'CPT' }, { role: 'FO' }, { role: 'PUR' }, { role: 'CC' }, { role: 'CC' }] as const;
    expect(hotelCount([...list])).toBe('2 pilots · 3 cabin crew');
    expect(hotelCount([{ role: 'CRP' }])).toBe('1 pilot');
  });

  it('places crew-change marks down-left of the airport dot, clear of the code, stands, offer pin and event pins', () => {
    const marks = placeSlipMarks([{ flightId: 'f1', at: 'IST' }, { flightId: 'f2', at: 'IST' }, { flightId: 'f3', at: 'OTP' }]);
    expect(marks.map((m) => m.id)).toEqual(['slip:f1', 'slip:f2', 'slip:f3']);
    expect(marks[0].off).toEqual([-20, 20]);
    expect(marks[1].off).toEqual([-20 - SLIP_MARK_GAP, 20]);
    expect(marks[2].off).toEqual([-20, 20]);
    // The things already drawn around an airport (screen px from its dot): code above, stands right, the offer diamond
    // left, event pins up-left. A mark (r 10) keeps clear of all of them, and two marks keep clear of each other.
    const disc = (o: [number, number]) => ({ id: '', x: o[0], y: o[1], w: 20, h: 20 });
    const taken = [
      { id: 'dot', x: 0, y: 0, w: 10, h: 10 }, { id: 'code', x: 0, y: -15, w: 28, h: 15 },
      ...[0, 1, 2].map((i) => disc(parkOffset(i, 3))), disc([-20, 0]), disc(placeEventPins([{ eventId: 'e', at: 'IST', kind: 'strike', title: '' }], new Set(['IST']), new Set())[0].off),
    ];
    for (const m of marks.slice(0, 2)) for (const b of taken) expect(boxOverlapPx(disc(m.off), b)).toBe(0);
    expect(boxOverlapPx(disc(marks[0].off), disc(marks[1].off))).toBe(0);
    expect(slipSelId('f7z')).toBe('slip:f7z');
    expect(parseSlipId('slip:f7z')).toBe('f7z');
    expect(parseSlipId('f7z:0')).toBeNull();
    expect(isCommercialId(slipSelId('f12'))).toBe(false);
    expect(parseCommercialId(slipSelId('f7z'))).toBeNull();
    const [a, b] = slipWindow(1000 * DAY);
    expect(a).toBeLessThan(1000 * DAY);
    expect(b).toBeGreaterThan(1000 * DAY + 3 * DAY);
  });

  it('draws the slip crew legs and words the crew change of a signed, rostered slip', async () => {
    const { acceptOffer } = await import('../../engine/contracts');
    const { devAddType, devSlipOffer } = await import('../../engine/dev');
    const { autoRoster, slipsOfAircraft } = await import('../../engine/crew');
    const { fixtureGame } = await import('../../engine/crew/fixtures');
    const g = fixtureGame(53);
    const id = devSlipOffer(g, 'MAD-SIN');
    expect(id).not.toBe('');
    const acId = Object.values(g.fleet).find((a) => a.typeId === 'a332')?.id ?? devAddType(g, 'a332');
    g.company.approvals.push('etops120', 'etops180');
    g.company.cash = 50_000_000;
    expect(acceptOffer(g, id, [acId]).ok).toBe(true);
    autoRoster(g, { aircraftIds: [acId], to: g.now + 20 * DAY });
    const views = slipsOfAircraft(g, acId, g.now, g.now + 30 * DAY);
    expect(views.length).toBe(1);
    const v = views[0];
    const marks = placeSlipMarks(views);
    expect(marks[0]).toMatchObject({ at: v.at, flightId: v.flightId });
    const arcs = slipArcs(g, views);
    // The fresh crew's airline legs end at the stop; the first crew's start there.
    const ins = arcs.filter((x) => x.dir === 'in');
    const outs = arcs.filter((x) => x.dir === 'out');
    expect(ins.length).toBeGreaterThan(0);
    expect(ins[ins.length - 1].to).toBe(v.at);
    if (outs.length) expect(outs[0].from).toBe(v.at);
    for (const x of arcs) expect(AIRPORT_BY_CODE[x.from] && AIRPORT_BY_CODE[x.to]).toBeTruthy();
    const line = slipLine(g, v);
    expect(line).toMatch(new RegExp(`^Crew change at ${v.atName} · fresh crew from .+ on .+ \\(lands \\d\\d:\\d\\d UTC, rests \\d+ h\\) · the first crew flies home`));
    expect(line).not.toMatch(/ on DH\b/);
    expect(slipLine(g, v, false)).toMatch(/^Fresh crew from /);
  });
});

/** Overlap area (px²) of two centred boxes. */
function boxOverlapPx(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): number {
  const ox = Math.min(a.x + a.w / 2, b.x + b.w / 2) - Math.max(a.x - a.w / 2, b.x - b.w / 2);
  const oy = Math.min(a.y + a.h / 2, b.y + b.h / 2) - Math.max(a.y - a.h / 2, b.y - b.h / 2);
  return Math.max(0, ox) * Math.max(0, oy);
}
