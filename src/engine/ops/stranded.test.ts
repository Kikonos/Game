// v0.12.1 round E: CS-TTL stranded at Port Sudan for a month after an evacuation (the player's save, 18 Nov 2027).
// (a) a closure that leaves an airport open (Port Sudan) or an aircraft leaving on the permit that let it in is not held;
// it routes around the zone. (b) a stranded aircraft gets one way home at once; Ana does not propose it again.
// (c) no out-and-back around a ferry home; the load repair heals the save. (d) an evacuation waits for a legal crew
// rather than cancelling, and a cancel takes the empty leg in with it. (e) a wait that would drop another job's legs
// asks first (sub-charter, swap or cancel).

import { describe, expect, it } from 'vitest';
import { TPL_BY_ID, WORLD_EVENT_TPLS } from '../../data/worldEvents';
import { ZONE_BY_ID } from '../../data/worldZones';
import { acceptOffer } from '../contracts';
import { relinkPositioning } from '../contracts/schedule';
import { hamBase, legsOffer, newGame, owned } from '../contracts/testkit';
import { addFlight, cancelFlight, flightsOf } from '../core/entities';
import { DAY } from '../core/time';
import type { GameState } from '../core/types';
import { deserialize } from '../save';
import { fixture } from '../fixtures/compatKit';
import { feedersOf } from '../crew/control';
import { crewControl } from '../crew';
import { buildDuties } from '../crew/duties';
import { addCrew, fixtureContract, fixtureGame } from '../crew/fixtures';
import { autoRoster, releaseCrew, setFlightsCrew } from '../crew/roster';
import { blockMinutes } from '../core/perf';
import { advanceTo } from '../sim';
import { resolveDecision } from './events';
import { lateCap } from './flights';
import { acceptProposal, moveOutPlanned, unlockHead, hireHead } from './heads';
import { closedAirport, closedAtDeparture, closedUntil, closureHits, healStranded, inZone, permitOf, startEvent, strandedLegs, worldEvent } from './world';

/** A signed trip of these legs on this aircraft (ETOPS held so routing never blocks it); its revenue flights. */
function trip(g: GameState, acId: string, legs: [string, string, number][], seats = 150) {
  if (!g.company.approvals.includes('etops120')) g.company.approvals.push('etops120');
  const o = legsOffer(g, legs, seats);
  const r = acceptOffer(g, o.id, [acId]);
  if (!r.ok) throw new Error(r.error);
  const c = g.contracts[r.data!.contractId];
  return { c, fl: Object.values(g.flights).filter((f) => f.contractId === c.id && f.kind === 'revenue').sort((a, b) => a.std - b.std) };
}

/** Marks a leg flown (the aircraft on the ground at its destination). */
function flown(g: GameState, id: string): void {
  const f = g.flights[id];
  f.status = 'done';
  f.atd = f.std;
  f.ata = f.sta;
  const ac = g.fleet[f.aircraftId!];
  ac.at = f.to;
  ac.flightId = null;
}

describe('(a) closures: an airport the event leaves open, the permit out, the detour', () => {
  it('Sudan closed to overflights: Port Sudan stays open (its legs route around, half the detour), Khartoum is closed', () => {
    const g = newGame(41);
    const t = g.now + 3 * DAY;
    const ac = owned(g);
    const { fl } = trip(g, ac.id, [['CAI', 'PZU', t], ['PZU', 'CAI', t + 5 * 60]]);
    const e = startEvent(g, { ...TPL_BY_ID.warSudan, closeP: 1 });
    expect(e.closed).toBe(true);
    expect(closedAirport(g, 'PZU')).toBeNull();
    expect(closedAirport(g, 'KRT')?.id).toBe(e.id);
    for (const f of fl) expect(f.closedBy).toBeUndefined();
    // Out of Port Sudan the great circle to Cairo crosses Sudan: rerouted once, half the zone's 40 min.
    expect(fl[1].detour).toBe(ZONE_BY_ID.sudan.detourMin / 2);
    expect(closureHits(g, e).held).toEqual([]);
    expect(worldEvent(g, e.id)!.effects.some((x) => /^Port Sudan stays open/.test(x))).toBe(true);
  });

  it('sibling templates: only an airport the text keeps open is open (Tel Aviv while Lebanon closes); every other closing template keeps its airports closed', () => {
    const g = newGame(42);
    const e = startEvent(g, { ...TPL_BY_ID.warLebanon, closeP: 1 });
    expect(closedAirport(g, 'TLV')).toBeNull();
    expect(closedAirport(g, 'BEY')?.id).toBe(e.id);
    for (const t of WORLD_EVENT_TPLS) {
      for (const code of t.openAirports ?? []) expect(t.zoneId && inZone(ZONE_BY_ID[t.zoneId], code)).toBe(true);
      // The open airport is never the one the event closes (airportDays).
      if (t.openAirports) expect(t.airportDays).toBeUndefined();
    }
    expect(WORLD_EVENT_TPLS.filter((t) => t.openAirports).map((t) => t.id).sort()).toEqual(['warLebanon', 'warSudan']);
  });

  it('the permit that flew an aircraft into a closed zone (an evacuation) lets its empty leg out; another aircraft there waits', () => {
    const g = newGame(43);
    const t = g.now + 2 * DAY;
    const ac = owned(g);
    const { c, fl } = trip(g, ac.id, [['MLA', 'MJI', t], ['MJI', 'MLA', t + 4 * 60]]);
    const e = startEvent(g, { ...TPL_BY_ID.warLibya, closeP: 1 });
    c.eventId = e.id;
    // v0.12.1 permits are for rescue work (evacuation, repatriation, relief, medical).
    c.archetype = 'evacuation';
    flown(g, fl[0].id);
    cancelFlight(g, fl[1]);
    const out = addFlight(g, { no: 'BLU9001', aircraftId: ac.id, contractId: null, kind: 'positioning', from: 'MJI', to: 'MLA', std: fl[0].sta + 3 * 60, sta: fl[0].sta + 4 * 60 });
    expect(permitOf(g, out)).toBe(e.id);
    expect(closedAtDeparture(g, out)).toBeNull();
    // Without the event's work before it, the same leg waits for the reopening.
    c.eventId = undefined;
    expect(permitOf(g, out)).toBeUndefined();
    expect(closedAtDeparture(g, out)?.id).toBe(e.id);
  });
});

describe('(b) stranded: one way home at once, no repeated proposal', () => {
  it("the rest of a finished job cancelled at an outstation: the schedule plans the way home; Ana's ferry-home is not proposed, and accepting an old one doubles nothing", () => {
    const g = newGame(44);
    const t = g.now + DAY;
    const ac = owned(g);
    const { c, fl } = trip(g, ac.id, [['LIS', 'FNC', t], ['FNC', 'LIS', t + 4 * 60]]);
    flown(g, fl[0].id);
    cancelFlight(g, fl[1], 'Crew shortage');
    c.status = 'completed';
    for (const f of flightsOf(g, ac.id)) if (f.kind === 'positioning' && f.status === 'scheduled') f.status = 'cancelled';
    relinkPositioning(g, ac.id);
    const home = flightsOf(g, ac.id).filter((f) => f.status === 'scheduled' && f.from === 'FNC');
    expect(home.map((f) => `${f.from}-${f.to}`)).toEqual(['FNC-LIS']);
    expect(home[0].std - g.now).toBeLessThan(2 * DAY);
    expect(moveOutPlanned(g, ac)).toBe(true);
    // A ferry-home proposal from before the plan: accepting it keeps the one way home.
    unlockHead(g, 'fleetPlanner');
    expect(hireHead(g, 'fleetPlanner', 2).ok).toBe(true);
    const h = g.heads!.fleetPlanner;
    h.proposals.push({ id: 'pp1', kind: 'ferryHome', text: 'Ferry home', cost: 48_000, data: { aircraftId: ac.id, at: 'FNC', to: 'LIS' }, t: g.now, expires: g.now + DAY } as never);
    const r = acceptProposal(g, 'fleetPlanner', 'pp1');
    expect(r.ok).toBe(true);
    expect(flightsOf(g, ac.id).filter((f) => f.status === 'scheduled' && f.from === 'FNC')).toHaveLength(1);
  });
});

describe('(c) no out-and-back around a ferry home; the load repair', () => {
  it('a ferry home planned weeks out from where the aircraft waits gets no hop home and back before it', () => {
    const g = newGame(45);
    const ac = owned(g);
    for (const f of flightsOf(g, ac.id)) f.status = 'cancelled';
    ac.at = 'FNC';
    const t = g.now + 20 * DAY;
    addFlight(g, { no: 'BLU9002', aircraftId: ac.id, contractId: null, kind: 'ferry', from: 'FNC', to: 'LIS', std: t, sta: t + 105 });
    relinkPositioning(g, ac.id);
    const legs = flightsOf(g, ac.id).filter((f) => f.status === 'scheduled');
    expect(legs.map((f) => `${f.kind} ${f.from}-${f.to}`)).toEqual(['ferry FNC-LIS']);
  });

  it('healStranded drops an orphan out-and-back of no job and releases legs a closure no longer holds', () => {
    const g = newGame(46);
    const ac = owned(g);
    for (const f of flightsOf(g, ac.id)) f.status = 'cancelled';
    ac.at = 'FNC';
    const t = g.now + 10 * DAY;
    const a = addFlight(g, { no: 'BLU9003', aircraftId: ac.id, contractId: null, kind: 'positioning', from: 'FNC', to: 'LIS', std: t, sta: t + 105 });
    const b = addFlight(g, { no: 'BLU9004', aircraftId: ac.id, contractId: null, kind: 'positioning', from: 'LIS', to: 'FNC', std: t + 4 * 60, sta: t + 6 * 60 });
    addFlight(g, { no: 'BLU9005', aircraftId: ac.id, contractId: null, kind: 'ferry', from: 'FNC', to: 'LIS', std: t + 8 * 60, sta: t + 10 * 60 });
    expect(healStranded(g)).toEqual([ac.id]);
    expect(g.flights[a.id]).toBeUndefined();
    expect(g.flights[b.id]).toBeUndefined();
    expect(flightsOf(g, ac.id).filter((f) => f.status === 'scheduled').map((f) => f.no)).toEqual(['BLU9005']);
  });

  it("the player's save (18 Nov 2027): CS-TTL leaves Port Sudan within two days, once, no LIS–PZU; refits re-priced; Ana's proposal withdrawn", () => {
    const g = deserialize(fixture('v0121-pzu'));
    const ac = Object.values(g.fleet).find((a) => a.reg === 'CS-TTL')!;
    const out = flightsOf(g, ac.id).filter((f) => f.status === 'scheduled' && f.from === 'PZU');
    expect(out).toHaveLength(1);
    expect(out[0].to).toBe('LIS');
    expect(out[0].std - g.now).toBeLessThan(2 * DAY);
    expect(flightsOf(g, ac.id).some((f) => f.status === 'scheduled' && f.to === 'PZU')).toBe(false);
    expect(['BLU1649', 'BLU1653', 'BLU1654'].some((no) => Object.values(g.flights).some((f) => f.no === no && f.status === 'scheduled'))).toBe(false);
    expect(g.heads!.fleetPlanner.proposals.filter((p) => p.kind === 'ferryHome')).toEqual([]);
    // The refit in work came forward and was refunded; the planned one re-priced (seats × price + engineering).
    const tvp = Object.values(g.maintenance).find((m) => m.kind === 'refit' && m.status === 'inWork')!;
    expect(tvp.cost).toBe(840_000);
    expect(tvp.end - tvp.start).toBe(9 * DAY);
    const trf = Object.values(g.maintenance).find((m) => m.kind === 'refit' && m.status === 'planned')!;
    expect(trf).toMatchObject({ cost: 960_000 });
    expect(trf.end - trf.start).toBe(10 * DAY);
    expect(g.messages.some((m) => m.title === 'CS-TVP refit re-priced: $760K refunded')).toBe(true);
    // A second load changes nothing (idempotent).
    const cash = g.company.cash;
    advanceTo(g, g.now + 3 * DAY, new Set());
    const left = Object.values(g.flights).find((f) => f.id === out[0].id);
    expect(left?.status).toBe('done');
    expect(left?.detour).toBe(20);
    expect(g.company.cash).not.toBe(cash);
  });
});

describe('(d) an evacuation waits for a legal crew; a cancel takes the empty leg in with it', () => {
  it('missions get a day more before recovery drops them as late', () => {
    const g = newGame(47);
    const ac = owned(g);
    const t = g.now + 3 * DAY;
    const { c, fl } = trip(g, ac.id, [['LIS', 'FNC', t], ['FNC', 'LIS', t + 4 * 60]]);
    expect(lateCap(g, fl[0])).toBe(24 * 60);
    c.archetype = 'evacuation';
    expect(lateCap(g, fl[0])).toBe(48 * 60);
    c.archetype = 'repatriation';
    expect(lateCap(g, fl[0])).toBe(48 * 60);
  });

  it("cancelling the evacuees' leg out also cancels the empty leg flying in to fetch them (the aircraft is not left there)", () => {
    const g = newGame(48);
    const ac = owned(g);
    const t = g.now + 3 * DAY;
    const { fl } = trip(g, ac.id, [['LIS', 'FNC', t], ['FNC', 'LIS', t + 4 * 60]]);
    fl[0].pax = 0;
    expect(feedersOf(g, fl[1].id).map((f) => f.id)).toEqual([fl[0].id]);
    // A leg with passengers is never a feeder.
    fl[0].pax = 120;
    expect(feedersOf(g, fl[1].id)).toEqual([]);
  });
});

describe('(d) Crew Control: an evacuation waits for a legal crew', () => {
  /** A crew-short out-and-back DUS–FNC (crew at LIS): a delay crews it; cancelling costs nothing on paper. */
  function evacShort(archetype: 'adhoc' | 'evacuation') {
    const g = fixtureGame(5);
    const acId = Object.keys(g.fleet)[0];
    g.fleet[acId].at = 'DUS';
    const std = Math.floor(g.now / DAY) * DAY + 2 * DAY + 17 * 60;
    const b = blockMinutes(g.fleet[acId].typeId, 'DUS', 'FNC');
    const k = fixtureContract(g, { archetype, pattern: { kind: 'legs', legs: [] }, aircraftIds: [acId], start: std - DAY, end: std + 2 * DAY, product: { kind: 'charter', price: 120_000, depositPct: 0.3, balanceDaysBefore: 7, fuelEscalation: false }, penalties: { cancelScale: [], perDelay: 0, perCancelledLeg: 0 } });
    const f1 = addFlight(g, { no: 'AW816', aircraftId: acId, contractId: k.id, kind: 'revenue', from: 'DUS', to: 'FNC', std, sta: std + b, pax: 0 });
    addFlight(g, { no: 'AW817', aircraftId: acId, contractId: k.id, kind: 'revenue', from: 'FNC', to: 'DUS', std: std + b + 50, sta: std + 2 * b + 50, pax: 0 });
    buildDuties(g, acId, g.now, g.now + 5 * DAY);
    addCrew(g, { CPT: 2, FO: 2, PUR: 1, CC: 3 });
    autoRoster(g);
    const d = g.duties[g.flights[f1.id].dutyId!];
    const p = g.pairings[d.pairingId];
    const was = p.slots.find((x) => x.role === 'CPT' && x.crewId)!.crewId!;
    releaseCrew(g, p, was);
    setFlightsCrew(g, p);
    g.now = d.report - 60;
    for (const c of Object.values(g.crew)) if (c.role === 'CPT' && c.id !== was) { c.blocks = [{ from: g.now - DAY, to: g.now + 10 * DAY, why: 'leave' }]; c.status = 'leave'; }
    return crewControl(g, f1.id)!;
  }

  it('cancel never outranks a delay that gets a legal crew within a day on an evacuation (an ad hoc charter may)', () => {
    const rank = (v: ReturnType<typeof crewControl>, id: string) => v!.solutions.find((x) => x.id === id)!.rank;
    const adhoc = evacShort('adhoc');
    const evac = evacShort('evacuation');
    expect(evac.solutions.find((x) => x.id === 'delay')!.available).toBe(true);
    expect(rank(evac, 'delay')).toBeLessThan(rank(evac, 'cancel'));
    // The same flight as an ad hoc charter with nothing to pay on cancelling: cancelling ranks first there (unchanged).
    expect(rank(adhoc, 'cancel')).toBeLessThan(rank(adhoc, 'delay'));
  });
});

describe('(e) a wait that strands an aircraft another job needs asks first', () => {
  it('held at a closed airport while a base programme elsewhere starts: one card (sub-charter, swap, cancel), nothing dropped before the answer', () => {
    const g = newGame(49);
    const ac = owned(g);
    const t = g.now + 2 * DAY;
    // The aircraft waits at Erbil (Iraq closed for days), a Hamburg programme on it two days later.
    const { fl } = trip(g, ac.id, [['LIS', 'EBL', t]]);
    flown(g, fl[0].id);
    const o = hamBase(g, t + 2 * DAY, 30, 2);
    const r = acceptOffer(g, o.id, [ac.id]);
    if (!r.ok) throw new Error(r.error);
    const e = startEvent(g, { ...TPL_BY_ID.warIraq, closeP: 1, days: [8, 8] });
    expect(closedAirport(g, 'EBL')?.id).toBe(e.id);
    // The closure dropped the planned positioning out (force majeure); the schedule plans it again at once, v0.12.1
    // (review) after the reopening (never out of a closed airport), and asks then about the job it can't reach.
    relinkPositioning(g, ac.id);
    const pos = flightsOf(g, ac.id).find((f) => f.status === 'scheduled' && f.from === 'EBL');
    expect(pos).toBeDefined();
    expect(pos!.std).toBeGreaterThanOrEqual(closedUntil(e) + 3 * 60);
    for (let i = 0; i < 6 * 24 && !g.decisions.some((x) => x.kind === 'stranded'); i++) advanceTo(g, g.now + 60, new Set());
    const d = g.decisions.find((x) => x.kind === 'stranded');
    expect(typeof d?.data?.from).toBe('number');
    const held = flightsOf(g, ac.id).find((f) => f.status === 'scheduled' && f.from === 'EBL')!;
    const lost = strandedLegs(g, held, e.end + 3 * 60, e, Number(d!.data!.from));
    expect(lost.length).toBeGreaterThan(0);
    expect(d?.title).toBe(`${ac.reg} can't reach Hamburg for ${g.clients[g.contracts[r.data!.contractId].clientId].name}: sub-charter or swap aircraft`);
    expect(d!.options.map((x) => x.id)).toEqual(['subcharter', 'swap', 'cancel']);
    // Nothing was dropped while it waits for the answer.
    expect(lost.every((f) => g.flights[f.id].status === 'scheduled')).toBe(true);
    const res = resolveDecision(g, d!.id, 'subcharter');
    expect(res.ok).toBe(true);
    expect(lost.every((f) => g.flights[f.id].operatedBy)).toBe(true);
  });
});
