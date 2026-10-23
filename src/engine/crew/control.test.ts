// v0.7.1 Crew Control (UPDATE-0.7.1.md §17): the view, previews without side effects, each of the nine fixes, the
// private-jet quote and charter, the warning ladder and crewReadyAt on the real timetable.

import { describe, expect, it } from 'vitest';
import { BAL } from '../core/balance';
import { addFlight } from '../core/entities';
import { blockMinutes, reportMinutes } from '../core/perf';
import { clearPause, takePause } from '../core/pause';
import { DAY } from '../core/time';
import type { Duty, GameState, Pairing } from '../core/types';
import { crewReadyAt } from '../ops/events';
import { commercialItinerary } from '../ops/commercial';
import { ticketPurpose } from '../ops/delivery';
import { deserialize, serialize } from '../save';
import { applyCrewFix, charterJet, crewCalendar, crewControl, crewGauges, escalateShortages, flightCrewStatus, jetQuote, shortFlights } from '.';
import { planCrew } from './check';
import { buildDuties } from './duties';
import { addCrew, fixtureContract, fixtureGame } from './fixtures';
import { autoRoster, releaseCrew, setFlightsCrew } from './roster';
import { dhBlock, OUT_CONNECT, outTicket, segsOf, touchCrew } from './timeline';

/** One out-and-back from `dep` (aircraft parked there) two days out at 17:00 UTC; crew at base (LIS). */
function trip(dep: string, dest: string, hhmm = 17 * 60, seed = 5): { g: GameState; d: Duty; p: Pairing; crew: string[]; flightId: string; acId: string } {
  const g = fixtureGame(seed);
  const acId = Object.keys(g.fleet)[0];
  const ac = g.fleet[acId];
  ac.at = dep;
  const std = Math.floor(g.now / DAY) * DAY + 2 * DAY + hhmm;
  const b = blockMinutes(ac.typeId, dep, dest);
  const k = fixtureContract(g, { pattern: { kind: 'legs', legs: [] }, aircraftIds: [acId], start: std - DAY, end: std + 2 * DAY, product: { kind: 'charter', price: 120_000, depositPct: 0.3, balanceDaysBefore: 7, fuelEscalation: false }, penalties: { cancelScale: [], perDelay: 2_500, perCancelledLeg: 15_000 } });
  const f1 = addFlight(g, { no: 'AW816', aircraftId: acId, contractId: k.id, kind: 'revenue', from: dep, to: dest, std, sta: std + b, pax: 170 });
  addFlight(g, { no: 'AW817', aircraftId: acId, contractId: k.id, kind: 'revenue', from: dest, to: dep, std: std + b + 50, sta: std + 2 * b + 50, pax: 160 });
  const d = buildDuties(g, acId, g.now, g.now + 5 * DAY)[0];
  const crew = addCrew(g, { CPT: 2, FO: 2, PUR: 1, CC: 3 });
  return { g, d, p: g.pairings[d.pairingId], crew, flightId: f1.id, acId };
}

/** Rosters the trip, then takes its captain off: exactly one CPT seat missing. */
/** The flight's duty and pairing as they stand now (autoRoster's planAircraft rebuilds the open pairings). */
function live(g: GameState, flightId: string): { d: Duty; p: Pairing } {
  const d = g.duties[g.flights[flightId].dutyId!];
  return { d, p: g.pairings[d.pairingId] };
}

function shortOfCaptain(dep = 'DUS', dest = 'FNC', hoursBefore = 40, seed = 5) {
  const t = trip(dep, dest, 17 * 60, seed);
  const { g } = t;
  autoRoster(g);
  const { d, p } = live(g, t.flightId);
  const cpt = p.slots.find((s) => s.role === 'CPT' && s.crewId)!;
  const was = cpt.crewId!;
  releaseCrew(g, p, was);
  setFlightsCrew(g, p);
  g.now = d.report - hoursBefore * 60;
  return { ...t, d, p, was };
}

describe('Crew Control view', () => {
  it('lists nine solutions, the missing seat and a card whose WHY reads the place template 2 h before report', () => {
    const { g, flightId, was } = shortOfCaptain('DUS', 'FNC', 2);
    // Everyone else who could take the seat is on leave; the released captain is at LIS (free, but can't reach DUS).
    for (const c of Object.values(g.crew)) if (c.role === 'CPT' && c.id !== was) { c.blocks = [{ from: g.now - DAY, to: g.now + 10 * DAY, why: 'leave' }]; c.status = 'leave'; }
    const v = crewControl(g, flightId)!;
    expect(v).not.toBeNull();
    expect(v.solutions).toHaveLength(9);
    expect(new Set(v.solutions.map((s) => s.id)).size).toBe(9);
    expect(v.solutions.map((s) => s.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(v.missing).toEqual([{ role: 'CPT', n: 1 }]);
    expect(v.stage).toBe('red');
    expect(v.card.what).toBe('AW816 is missing 1 captain');
    expect(v.card.why).toMatch(/^Your free captains are in Lisbon and the earliest they can land in Düsseldorf is .+ after the latest/);
    expect(v.card.visuals.reach).toBeDefined();
    expect(v.card.visuals.reach!.gapMin).toBeGreaterThan(0);
    expect(v.card.visuals.minimap?.to).toBe('DUS');
    expect(v.card.hurt.pax).toBe(330);
    expect(v.card.hurt.money).toBeGreaterThanOrEqual(30_000);
    expect(v.card.actions[0].id).toBe('crewControl');
    for (const s of v.solutions) if (!s.available) expect(s.why).toBeTruthy();
  });

  it('WHY reads the rest template when the only free captain is still resting at the departure airport', () => {
    const { g, flightId, d, was } = shortOfCaptain('DUS', 'FNC', 10);
    for (const c of Object.values(g.crew)) if (c.role === 'CPT' && c.id !== was) { c.blocks = [{ from: g.now - DAY, to: g.now + 10 * DAY, why: 'leave' }]; c.status = 'leave'; }
    const c = g.crew[was];
    c.loc = 'DUS';
    c.status = 'resting';
    c.restUntil = d.report + 2 * 60;
    c.log.push({ start: d.report - 14 * 60, end: d.report - 8 * 60, fdp: 6 * 60, block: 300, sectors: 2, augmented: false, disruptive: false });
    const v = crewControl(g, flightId)!;
    expect(v.card.why).toMatch(/is the nearest free captain, but their rest at Düsseldorf ends at .+, after the .+ report\.$/);
    expect(v.card.visuals.gauges?.some((x) => x.id === 'rest')).toBe(true);
    expect(v.card.terms).toContain('rest');
  });

  it('WHY reads the busy template when every captain is on another trip', () => {
    const { g, flightId, was, d } = shortOfCaptain('DUS', 'FNC', 10);
    // The released captain holds a trip on the second aircraft that overlaps this duty; the rest are on leave.
    for (const c of Object.values(g.crew)) if (c.role === 'CPT' && c.id !== was) { c.blocks = [{ from: g.now - DAY, to: g.now + 10 * DAY, why: 'leave' }]; c.status = 'leave'; }
    const b = Object.keys(g.fleet)[1];
    g.fleet[b].at = 'LIS';
    const std = d.report - 60;
    addFlight(g, { no: 'AW900', aircraftId: b, contractId: null, kind: 'revenue', from: 'LIS', to: 'LHR', std, sta: std + 170 });
    addFlight(g, { no: 'AW901', aircraftId: b, contractId: null, kind: 'revenue', from: 'LHR', to: 'LIS', std: std + 230, sta: std + 400 });
    const q = buildDuties(g, b, g.now, g.now + 5 * DAY)[0];
    const qp = g.pairings[q.pairingId];
    qp.slots.find((s) => s.role === 'CPT')!.crewId = was;
    setFlightsCrew(g, qp);
    touchCrew(g);
    const v = crewControl(g, flightId)!;
    expect(v.card.why).toMatch(/^Every rated captain is busy on another trip \(.+ on AW900 to London until .+\)\.$/);
  });
});

describe('previews and apply', () => {
  it('auto-fix: the preview equals the result of applying it, and g is unchanged by 20 previews', () => {
    const { g, flightId } = shortOfCaptain('DUS', 'FNC', 40);
    const before = JSON.stringify(g);
    const rng = g.rng;
    let v = crewControl(g, flightId)!;
    for (let i = 0; i < 19; i++) v = crewControl(g, flightId)!;
    expect(JSON.stringify(g)).toBe(before);
    expect(g.rng).toBe(rng);
    const auto = v.solutions.find((s) => s.id === 'autoFix')!;
    expect(auto.available).toBe(true);
    expect(auto.preview.after.level).toBe('ok');
    expect(auto.preview.changes[0]).toMatch(/takes the captain seat/);
    const r = applyCrewFix(g, flightId, 'autoFix');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data!.changes).toEqual(auto.preview.changes);
    expect(r.data!.after).toBeNull();
    expect(flightCrewStatus(g, flightId).level).toBe('ok');
    expect(g.stats.crewFixes?.autoFix).toBe(1);
    expect(g.messages[0].title).toMatch(/^AW816 crewed: Auto-fix/);
  });

  it('fly someone in: legal-after candidates with itineraries; apply assigns and buys the ticket', () => {
    const { g, flightId, d } = shortOfCaptain('DUS', 'FNC', 40);
    const v = crewControl(g, flightId)!;
    const s = v.solutions.find((x) => x.id === 'deadhead')!;
    expect(s.available).toBe(true);
    expect(s.options!.length).toBeGreaterThan(0);
    for (const o of s.options!) {
      expect(o.level).not.toBe('illegal');
      expect(o.sub).toMatch(/^Deadhead LIS \d\d:\d\d → DUS \d\d:\d\d UTC/);
      expect(o.arrives).toBeLessThanOrEqual(d.report - OUT_CONNECT);
    }
    // The preview's cost is the real one (ticket out and the ticket home after the trip).
    expect(s.cost).toBeGreaterThanOrEqual(s.options![0].cost);
    const pick = s.options![1] ?? s.options![0];
    const r = applyCrewFix(g, flightId, 'deadhead', { crewIds: [pick.id] });
    expect(r.ok).toBe(true);
    const p = g.pairings[d.pairingId];
    expect(p.slots.some((x) => x.crewId === pick.id && x.role === 'CPT')).toBe(true);
    const ticket = Object.values(g.flights).find((f) => f.kind === 'deadhead' && f.crewIds.includes(pick.id) && f.to === 'DUS');
    expect(ticket).toBeDefined();
    expect(g.duties[d.id].deadheadIds).toContain(ticket!.id);
  });

  it('call in: someone free at the airport, overtime posted to salaries and morale −4', () => {
    const { g, flightId, crew } = shortOfCaptain('DUS', 'FNC', 10);
    const c = g.crew[crew[0]];
    c.loc = 'DUS';
    c.status = 'off';
    c.off = []; // v0.9: a rest day, not a planned day off (that one costs −6: dayPlan.test.ts)
    const v = crewControl(g, flightId)!;
    const s = v.solutions.find((x) => x.id === 'callIn')!;
    expect(s.available).toBe(true);
    expect(s.options!.map((o) => o.id)).toContain(c.id);
    const ot = Math.round((BAL.crewControl.callInPay * c.salary) / 21);
    const sal = g.finance.current.lines.salaries ?? 0;
    const morale = c.morale;
    const r = applyCrewFix(g, flightId, 'callIn', { crewIds: [c.id] });
    expect(r.ok).toBe(true);
    expect((g.finance.current.lines.salaries ?? 0) - sal).toBe(-ot);
    expect(c.morale).toBeCloseTo(Math.max(0, morale + BAL.crewControl.callInMorale), 5);
    expect(flightCrewStatus(g, flightId).level).not.toBe('missing');
  });

  it("commander's discretion: only after report, with every seat filled, over by ≤ 2 h and unused", () => {
    const t = trip('DUS', 'FNC');
    const { g, flightId } = t;
    autoRoster(g);
    const { d } = live(g, flightId);
    g.now = d.report - 10 * 60;
    expect(crewControl(g, flightId)).not.toBeNull();
    let v = crewControl(g, flightId)!;
    expect(v.stage).toBe('ok');
    expect(v.solutions.find((s) => s.id === 'discretion')!.available).toBe(false);
    d.fdp = d.maxFdp + 60;
    d.legality = 'illegal';
    v = crewControl(g, flightId)!;
    // v0.9 §T a day over its limit is crew out of hours (everyone aboard), with its own card.
    expect(v.card.what).toMatch(/\(captain\) and \d+ others out of hours for AW816$/);
    expect(v.card.why).toMatch(/^The day would run \d+:\d\d.*the limit is \d+:\d\d\.$/);
    // v0.7.3 ORO.FTL.205(f): only for the unforeseen, at or after report: never for a planned day.
    const before = v.solutions.find((x) => x.id === 'discretion')!;
    expect(before.available).toBe(false);
    expect(before.why).toMatch(/^Only after the crew has reported/);
    expect(applyCrewFix(g, flightId, 'discretion').ok).toBe(false);
    g.now = d.report + 10;
    v = crewControl(g, flightId)!;
    const s = v.solutions.find((x) => x.id === 'discretion')!;
    expect(s.available).toBe(true);
    expect(s.rank).toBe(1);
    expect(applyCrewFix(g, flightId, 'discretion').ok).toBe(true);
    expect(d.discretion).toBe(120);
    expect(crewControl(g, flightId)!.solutions.find((x) => x.id === 'discretion')!.why).toMatch(/Already used/);
    d.fdp = d.maxFdp + d.discretion! + 150;
    d.legality = 'illegal';
    expect(crewControl(g, flightId)!.solutions.find((x) => x.id === 'discretion')!.available).toBe(false);
  });

  it('swap crews: takes the captain of a trip on the other aircraft and reports what that flight then needs', () => {
    const { g, flightId, d, was } = shortOfCaptain('DUS', 'FNC', 30);
    for (const c of Object.values(g.crew)) if (c.role === 'CPT' && c.id !== was) { c.blocks = [{ from: g.now - DAY, to: g.now + 10 * DAY, why: 'leave' }]; c.status = 'leave'; }
    const b = Object.keys(g.fleet)[1];
    g.fleet[b].at = 'DUS';
    const std = d.report + 20 * 60;
    addFlight(g, { no: 'AW900', aircraftId: b, contractId: null, kind: 'revenue', from: 'DUS', to: 'LHR', std, sta: std + 90 });
    addFlight(g, { no: 'AW901', aircraftId: b, contractId: null, kind: 'revenue', from: 'LHR', to: 'DUS', std: std + 150, sta: std + 240 });
    const q = buildDuties(g, b, g.now, g.now + 5 * DAY)[0];
    const qp = g.pairings[q.pairingId];
    qp.slots.find((s) => s.role === 'CPT')!.crewId = was;
    g.crew[was].loc = 'DUS';
    setFlightsCrew(g, qp);
    const v = crewControl(g, flightId)!;
    const s = v.solutions.find((x) => x.id === 'swap')!;
    expect(s.available).toBe(true);
    expect(s.options![0].id).toBe(qp.id);
    expect(s.confirm).toBe(true);
    expect(s.preview.changes.some((c) => /AW900 then needs 1 captain/.test(c))).toBe(true);
    expect(applyCrewFix(g, flightId, 'swap').ok).toBe(false);
    const r = applyCrewFix(g, flightId, 'swap', { confirmed: true, optionId: qp.id });
    expect(r.ok).toBe(true);
    expect(g.pairings[d.pairingId].slots.some((x) => x.crewId === was && x.role === 'CPT')).toBe(true);
    expect(qp.slots.some((x) => x.crewId === was)).toBe(false);
  });

  it('delay: the flight leaves when a crew can take it; sub-charter and cancel delegate and post', () => {
    const { g, flightId, was, acId } = shortOfCaptain('DUS', 'FNC', 2);
    for (const c of Object.values(g.crew)) if (c.role === 'CPT' && c.id !== was) { c.blocks = [{ from: g.now - DAY, to: g.now + 10 * DAY, why: 'leave' }]; c.status = 'leave'; }
    const v = crewControl(g, flightId)!;
    const delay = v.solutions.find((x) => x.id === 'delay')!;
    expect(delay.available).toBe(true);
    expect(delay.newDeparture).toBeGreaterThan(g.flights[flightId].std);
    expect(delay.confirm).toBe(true);
    // The delay is the roster's own answer: the preview ends crewed, with the ticket that lands the captain.
    expect(delay.preview.after.level).toBe('ok');
    expect(delay.preview.changes[0]).toMatch(/^AW816 leaves .+ \(\+\d+h \d\dm\)$/);
    expect(delay.preview.changes.some((c) => /takes the captain seat \(deadhead/.test(c))).toBe(true);
    expect(delay.rank).toBe(1);
    // Only the return leg is still far enough out for a rival to position: handing that one over would not crew
    // this flight, so the row is off (v0.7.1 fix 7).
    const sub = v.solutions.find((x) => x.id === 'subcharter')!;
    expect(sub.available).toBe(false);
    expect(sub.why).toMatch(/Too close to departure/);
    const cancel = v.solutions.find((x) => x.id === 'cancel')!;
    expect(cancel.available).toBe(true);
    expect(cancel.cost).toBe(30_000);
    expect(cancel.chips).toContain('2 revenue legs');
    expect(cancel.preview.after.level).toBe('cancelled');
    expect(cancel.preview.changes[0]).toBe('2 revenue legs cancelled, $30K compensation, reliability −3');
    // Ripple lines carry no flight number (the panel adds it once); the consequences do not repeat them.
    for (const l of cancel.preview.ripple) expect(l.text).toBe('cancelled');
    expect(cancel.consequences.some((c) => /cancelled/.test(c))).toBe(false);
    const pen = g.finance.current.lines.penalties ?? 0;
    const n = g.messages.length;
    const r = applyCrewFix(g, flightId, 'cancel', { confirmed: true });
    expect(r.ok).toBe(true);
    expect(g.flights[flightId].status).toBe('cancelled');
    expect((g.finance.current.lines.penalties ?? 0) - pen).toBe(-30_000);
    expect(g.stats.crewFixes?.cancel).toBe(1);
    expect(g.fleet[acId]).toBeDefined();
    // One message for the event.
    expect(g.messages.length - n).toBe(1);
    expect(g.messages[0].title).toBe('AW816 cancelled with 1 more: crew shortage');
    expect(g.messages[0].tone).toBe('bad');
  });

  it('delay: never offered when it would leave the seats empty; the departure equals what the roster then accepts', () => {
    const { g, flightId, was } = shortOfCaptain('DUS', 'FNC', 1);
    for (const c of Object.values(g.crew)) if (c.role === 'CPT' && c.id !== was) { c.blocks = [{ from: g.now - DAY, to: g.now + 10 * DAY, why: 'leave' }]; c.status = 'leave'; }
    const v = crewControl(g, flightId)!;
    const delay = v.solutions.find((x) => x.id === 'delay')!;
    expect(delay.available).toBe(true);
    expect(delay.preview.after.level).toBe('ok');
    expect(delay.newDeparture).toBeGreaterThan(g.flights[flightId].std);
    const r = applyCrewFix(g, flightId, 'delay', { confirmed: true });
    expect(r.ok).toBe(true);
    expect(g.flights[flightId].std).toBe(delay.newDeparture);
    expect(flightCrewStatus(g, flightId).level).not.toBe('missing');
    if (r.ok) expect(r.data!.changes).toEqual(delay.preview.changes);
    // Nobody at all within two days: the row says so instead of 'use Auto-fix'.
    const t = shortOfCaptain('DUS', 'FNC', 1);
    for (const c of Object.values(t.g.crew)) if (c.role === 'CPT') { c.blocks = [{ from: t.g.now - DAY, to: t.g.now + 10 * DAY, why: 'leave' }]; c.status = 'leave'; }
    const none = crewControl(t.g, t.flightId)!.solutions.find((x) => x.id === 'delay')!;
    expect(none.available).toBe(false);
    expect(none.why).toMatch(/Nobody can take it even two days later|No legal crew within two days/);
    expect(crewControl(t.g, t.flightId)!.solutions.find((x) => x.id === 'autoFix')!.available).toBe(false);
  });

  it('sub-charter preview: the flight is then flown by the rival (level subchartered), one message on apply', () => {
    const { g, flightId, was } = shortOfCaptain('DUS', 'FNC', 30);
    for (const c of Object.values(g.crew)) if (c.role === 'CPT' && c.id !== was) { c.blocks = [{ from: g.now - DAY, to: g.now + 10 * DAY, why: 'leave' }]; c.status = 'leave'; }
    const v = crewControl(g, flightId)!;
    const sub = v.solutions.find((x) => x.id === 'subcharter')!;
    expect(sub.available).toBe(true);
    expect(sub.preview.after.level).toBe('subchartered');
    expect(sub.preview.changes[0]).toMatch(/flies 2 legs/);
    const n = g.messages.length;
    expect(applyCrewFix(g, flightId, 'subcharter', { confirmed: true }).ok).toBe(true);
    expect(g.flights[flightId].operatedBy).toBeTruthy();
    expect(g.messages.length - n).toBe(1);
  });

  it('delay applied: the flight is retimed to the crew-ready time and crewed', () => {
    const { g, flightId, was } = shortOfCaptain('DUS', 'FNC', 3);
    for (const c of Object.values(g.crew)) if (c.role === 'CPT' && c.id !== was) { c.blocks = [{ from: g.now - DAY, to: g.now + 10 * DAY, why: 'leave' }]; c.status = 'leave'; }
    const std = g.flights[flightId].std;
    const r = applyCrewFix(g, flightId, 'delay', { confirmed: true });
    expect(r.ok).toBe(true);
    expect(g.flights[flightId].std).toBeGreaterThan(std);
    expect(flightCrewStatus(g, flightId).level).not.toBe('missing');
  });
});

describe('private jets', () => {
  it('quotes: LIS→DUS midsize ≈ $25K, LIS→JED heavy ≈ $50–70K, two jets for 9 crew on a light jet', () => {
    const g = fixtureGame();
    const q = jetQuote(g, 'LIS', 'DUS', 4, g.now);
    expect(q.cls).toBe('light');
    const m = jetQuote(g, 'LIS', 'DUS', 7, g.now);
    expect(m.cls).toBe('midsize');
    expect(m.cost).toBeGreaterThan(20_000);
    expect(m.cost).toBeLessThan(30_000);
    expect(m.wheelsUp).toBeGreaterThanOrEqual(g.now + BAL.crewControl.jet.fboLeadMin);
    expect(m.wheelsUp % 15).toBe(0);
    expect(m.arrives - m.wheelsUp).toBe(m.block);
    expect(m.fuelStop).toBeNull();
    expect(m.text).toMatch(/· LIS→DUS/);
    const h = jetQuote(g, 'LIS', 'JED', 10, g.now);
    expect(h.cls).toBe('heavy');
    expect(h.fuelStop).toBeNull();
    expect(h.cost).toBeGreaterThan(45_000);
    expect(h.cost).toBeLessThan(75_000);
    const two = jetQuote(g, 'LIS', 'DUS', 9, g.now, 'light');
    expect(two.jets).toBe(2);
    expect(two.cost).toBe(2 * jetQuote(g, 'LIS', 'DUS', 6, g.now, 'light').cost);
    // Pure: the same quote twice.
    expect(jetQuote(g, 'LIS', 'DUS', 7, g.now)).toEqual(m);
  });

  it('charterJet: a charter deadhead the crew are legal after, cost to crewJet, one jet leg, purpose and calendar', () => {
    const { g, flightId, d, was } = shortOfCaptain('DUS', 'LHR', 8);
    for (const c of Object.values(g.crew)) if (c.role === 'CPT' && c.id !== was) { c.blocks = [{ from: g.now - DAY, to: g.now + 10 * DAY, why: 'leave' }]; c.status = 'leave'; }
    const v = crewControl(g, flightId)!;
    const jet = v.solutions.find((x) => x.id === 'jet')!;
    // v0.8 fix pack: the airline ticket gets the captain there in time too, and cheaper: no jet row, one muted line.
    expect(v.solutions.find((x) => x.id === 'deadhead')!.available).toBe(true);
    expect(jet.available).toBe(false);
    expect(jet.dominated).toBe(true);
    expect(jet.why).toMatch(/^A jet would (land after .+|leave no sooner than .+) \(\S+ vs \S+\): not offered$/);
    expect(jet.newDeparture).toBeNull();
    expect(jet.rank).toBe(v.solutions.length);
    // Asked for on its own (the bot's ladder, applyCrewFix), it is still quoted: it lands before the report, no delay.
    const only = crewControl(g, flightId, { only: ['jet'] })!.solutions[0];
    expect(only.available, only.why).toBe(true);
    expect(only.cost).toBeGreaterThan(10_000);
    expect(only.newDeparture).toBeNull();
    // A long duty: the ride would make the day too long. Jet + a night's rest would leave no sooner than an airline
    // ticket with the same rest, so the row points at Delay (which ends crewed the next morning).
    const long = shortOfCaptain('DUS', 'FNC', 6);
    for (const c of Object.values(long.g.crew)) if (c.role === 'CPT' && c.id !== long.was) { c.blocks = [{ from: long.g.now - DAY, to: long.g.now + 10 * DAY, why: 'leave' }]; c.status = 'leave'; }
    const lv = crewControl(long.g, long.flightId)!;
    const lj = lv.solutions.find((x) => x.id === 'jet')!;
    expect(lj.available).toBe(false);
    expect(lj.why).toMatch(/use Delay until crew arrives/);
    expect(lj.chips).toEqual([]);
    const ld = lv.solutions.find((x) => x.id === 'delay')!;
    expect(ld.available, ld.why).toBe(true);
    expect(ld.preview.after.level).toBe('ok');
    expect(ld.newDeparture! - long.g.flights[long.flightId].std).toBeGreaterThan(3 * 60);
    expect(only.options!.map((o) => o.id)).toContain('light');
    expect(only.chips.some((c) => /^lands /.test(c))).toBe(true);
    const r = charterJet(g, flightId, [was], 'midsize');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const t = g.flights[r.data!.ticketIds[0]];
    expect(t.kind).toBe('deadhead');
    expect(t.no).toBe('PJ');
    expect(t.charter?.cls).toBe('midsize');
    expect(t.charter?.operator).toBeTruthy();
    expect(t.crewIds).toEqual([was]);
    // Called directly (no delay first): the ride lands before the report and is the crew member's ride out.
    expect(t.sta).toBeLessThanOrEqual(d.report);
    expect(g.finance.current.lines.crewJet).toBe(-r.data!.cost);
    expect(g.stats.jets).toBe(1);
    expect(g.stats.jetSpend).toBe(r.data!.cost);
    expect(d.deadheadIds).toContain(t.id);
    const p = g.pairings[d.pairingId];
    expect(p.slots.some((s) => s.crewId === was && s.role === 'CPT')).toBe(true);
    const c = g.crew[was];
    const plan = planCrew(g, c, p, segsOf(g, c, p.id), true);
    expect(plan.issues.filter((i) => i.level === 'illegal')).toEqual([]);
    expect(plan.out && (plan.out as { id?: string }).id).toBe(t.id);
    // The ride is positioning inside the FDP with the FBO's 30 min check-in.
    const seg = plan.segs.find((s) => s.kind === 'duty')!;
    expect(seg.start).toBe(t.std - BAL.crewControl.jet.checkInMin);
    const legs = commercialItinerary(g, t);
    expect(legs).toHaveLength(1);
    expect(legs[0].jet).toBe(true);
    expect(legs[0].airline).toBe(t.charter!.operator);
    expect(legs[0].no).toBe(t.charter!.model);
    expect(ticketPurpose(g, t.id).text).toMatch(/^Private jet for AW816 · /);
    const cal = crewCalendar(g, was, g.now, d.release);
    const block = cal.find((b) => b.kind === 'deadhead')!;
    expect(block.label).toBe('Private jet');
    expect(block.detail).toMatch(/chartered for AW816/);
    expect(flightCrewStatus(g, flightId).level).not.toBe('missing');
  });

  it('applyCrewFix jet: a jet is chartered whenever the fix is applied (never an airline ticket under the jet label)', () => {
    // DUS: a ticket from Lisbon lands the captain before any jet (v0.8 fix pack: so Crew Control offers no jet, one
    // muted line naming the airline flight); applied all the same (the bot's ladder), it delays the flight for the jet
    // and charters it (the preview's price is what is paid).
    const a = shortOfCaptain('DUS', 'LHR', 1);
    for (const c of Object.values(a.g.crew)) if (c.role === 'CPT' && c.id !== a.was) { c.blocks = [{ from: a.g.now - DAY, to: a.g.now + 10 * DAY, why: 'leave' }]; c.status = 'leave'; }
    const av = crewControl(a.g, a.flightId)!;
    const hidden = av.solutions.find((x) => x.id === 'jet')!;
    expect(hidden.dominated).toBe(true);
    expect(hidden.why).toMatch(/^A jet would land after [A-Z0-9]{2} ?\d+ \(\d\d:\d\d vs \d\d:\d\d\): not offered$/);
    expect(av.solutions.find((x) => x.id === 'delay')!.available).toBe(true);
    const aj = crewControl(a.g, a.flightId, { only: ['jet'] })!.solutions[0];
    expect(aj.available, aj.why).toBe(true);
    expect(aj.preview.after.level).toBe('ok');
    expect(aj.preview.changes.some((c) => /private jet/.test(c))).toBe(true);
    const ar = applyCrewFix(a.g, a.flightId, 'jet', { confirmed: true });
    expect(ar.ok).toBe(true);
    expect(Object.values(a.g.flights).some((f) => f.kind === 'deadhead' && f.charter && f.crewIds.includes(a.was))).toBe(true);
    expect(a.g.finance.current.lines.crewJet).toBe(-aj.cost);
    expect(a.g.stats.jets).toBe(1);
    // FNC: the airline day would run too long (a night's rest first); the jet's short ride gets the captain there today.
    const { g, flightId, was, d } = shortOfCaptain('FNC', 'LHR', 2);
    for (const c of Object.values(g.crew)) if (c.role === 'CPT' && c.id !== was) { c.blocks = [{ from: g.now - DAY, to: g.now + 10 * DAY, why: 'leave' }]; c.status = 'leave'; }
    const v = crewControl(g, flightId)!;
    const jet = v.solutions.find((x) => x.id === 'jet')!;
    expect(jet.available, jet.why).toBe(true);
    expect(jet.newDeparture).toBeGreaterThan(d.report);
    expect(jet.rank).toBe(1);
    const std = g.flights[flightId].std;
    const jets = g.stats.jets ?? 0;
    const r = applyCrewFix(g, flightId, 'jet', { confirmed: true, optionId: 'light' });
    expect(r.ok).toBe(true);
    expect(g.flights[flightId].std).toBeGreaterThan(std);
    expect(flightCrewStatus(g, flightId).level).not.toBe('missing');
    const ride = Object.values(g.flights).find((f) => f.kind === 'deadhead' && f.crewIds.includes(was))!;
    expect(ride.charter).toBeDefined();
    expect(g.stats.jets).toBe(jets + 1);
    expect(g.stats.crewFixes?.jet).toBe(1);
    expect(g.finance.current.lines.crewJet).toBeLessThan(0);
    expect(g.messages[0].title).toMatch(/^AW816 crewed: Charter a private jet/);
  });
});

describe('gauges', () => {
  it('give FDP, rest and the cumulative windows per crew member with tones', () => {
    const { g, flightId } = trip('DUS', 'FNC');
    autoRoster(g);
    const { d, p } = live(g, flightId);
    const id = p.slots.find((s) => s.crewId)!.crewId!;
    const gs = crewGauges(g, id, d.id);
    expect(gs.map((x) => x.id)).toEqual(expect.arrayContaining(['fdp', 'duty7d', 'block28d', 'blockYear']));
    const fdp = gs.find((x) => x.id === 'fdp')!;
    expect(fdp.text).toMatch(/^\d+:\d\d of \d+:\d\d$/);
    expect(['good', 'warn', 'bad']).toContain(fdp.tone);
    expect(fdp.by).toBe(d.report);
    for (const x of gs) expect(x.crewId).toBe(id);
  });
});

describe('the warning ladder', () => {
  it('amber at ≤ 48 h with a message and no pause; red at ≤ 12 h with a pause; marks saved; a fixed flight leaves the list', () => {
    const { g, flightId, d, was } = shortOfCaptain('DUS', 'LHR', 40);
    // The ladder re-rosters the aircraft before warning: with another captain free the shortage would just be fixed.
    for (const c of Object.values(g.crew)) if (c.role === 'CPT' && c.id !== was) { c.blocks = [{ from: g.now - DAY, to: g.now + 10 * DAY, why: 'leave' }]; c.status = 'leave'; }
    g.crew[was].blocks = [{ from: g.now - DAY, to: g.now + 10 * DAY, why: 'leave' }];
    g.crew[was].status = 'leave';
    clearPause();
    const n = g.messages.length;
    escalateShortages(g);
    expect(g.flights[flightId].crewAlert).toBe('amber');
    expect(shortFlights(g).map((x) => x.stage)).toEqual(['amber', 'amber']);
    expect(takePause()).toBeNull();
    const amber = g.messages.slice(0, g.messages.length - n);
    expect(amber).toHaveLength(1);
    expect(amber[0].tone).toBe('warn');
    expect(amber[0].problem).toEqual({ kind: 'crewShort', ref: { kind: 'flight', id: flightId } });
    expect(amber[0].hurt?.pax).toBe(330);
    // Both legs of the duty are marked at once (one event), counted once.
    expect(g.flights[g.duties[d.id].flightIds[1]].crewAlert).toBe('amber');
    expect(g.stats.crewAmber).toBe(1);
    // Still short at 11 h: red, one bad message with the sound topic, the pause.
    g.now = d.report - 10 * 60;
    escalateShortages(g);
    expect(g.flights[flightId].crewAlert).toBe('red');
    expect(takePause()).toBe('crewShortage');
    const red = g.messages[0];
    expect(red.tone).toBe('bad');
    expect(red.topic).toBe('crewRed');
    expect(red.title).toMatch(/^CREW SHORTAGE: AW816 in 1[01] h$/);
    expect(amber[0].hurt?.pax).toBe(330);
    expect(g.stats.crewRed).toBe(1);
    // Never repeated.
    const m = g.messages.length;
    escalateShortages(g);
    expect(g.messages.length).toBe(m);
    expect(takePause()).toBeNull();
    // The mark survives a save; a crewWarned-only save loads as amber.
    const h = deserialize(serialize(g));
    expect(h.flights[flightId].crewAlert).toBe('red');
    const file = JSON.parse(serialize(g)) as { state: GameState };
    delete file.state.flights[flightId].crewAlert;
    file.state.flights[flightId].crewWarned = true;
    expect(deserialize(JSON.stringify(file)).flights[flightId].crewAlert).toBe('amber');
    // Fixed: off the list (the mark stays so it never re-warns).
    g.crew[was].blocks = [];
    g.crew[was].status = 'available';
    expect(applyCrewFix(g, flightId, 'autoFix').ok).toBe(true);
    expect(shortFlights(g)).toEqual([]);
    expect(g.flights[flightId].crewAlert).toBe('red');
  });
});

describe('the warning ladder: a tour', () => {
  it('a short sibling duty further out takes its own stage, so it gets its own red and pause at 12 h', () => {
    const t = trip('DUS', 'FNC', 17 * 60, 5);
    const { g, acId } = t;
    const ac = g.fleet[acId];
    const k = g.contracts[g.flights[t.flightId].contractId!];
    const std2 = g.flights[t.flightId].std + DAY;
    const b = blockMinutes(ac.typeId, 'DUS', 'FNC');
    const f3 = addFlight(g, { no: 'AW818', aircraftId: acId, contractId: k.id, kind: 'revenue', from: 'DUS', to: 'FNC', std: std2, sta: std2 + b, pax: 170 });
    addFlight(g, { no: 'AW819', aircraftId: acId, contractId: k.id, kind: 'revenue', from: 'FNC', to: 'DUS', std: std2 + b + 50, sta: std2 + 2 * b + 50, pax: 160 });
    buildDuties(g, acId, g.now, g.now + 5 * DAY);
    autoRoster(g);
    const { d, p } = live(g, t.flightId);
    const d2 = g.duties[g.flights[f3.id].dutyId!];
    expect(d2.pairingId).toBe(p.id); // one tour, two duties
    const was = p.slots.find((x) => x.role === 'CPT' && x.crewId)!.crewId!;
    releaseCrew(g, p, was);
    setFlightsCrew(g, p);
    for (const c of Object.values(g.crew)) if (c.role === 'CPT') { c.blocks = [{ from: g.now - DAY, to: g.now + 10 * DAY, why: 'leave' }]; c.status = 'leave'; }
    g.now = d.report - 10 * 60;
    clearPause();
    escalateShortages(g);
    expect(g.flights[t.flightId].crewAlert).toBe('red');
    expect(takePause()).toBe('crewShortage');
    expect(g.flights[f3.id].crewAlert).toBe('amber'); // the next day's duty is not red yet
    // The first duty departs short (gate); the second reaches 12 h still short: its own red, message and pause.
    g.now = d2.report - 10 * 60;
    const n = g.messages.length;
    escalateShortages(g);
    expect(g.flights[f3.id].crewAlert).toBe('red');
    expect(g.messages.length).toBe(n + 1);
    expect(g.messages[0].title).toMatch(/^CREW SHORTAGE: AW818/);
    expect(takePause()).toBe('crewShortage');
  });
});

describe('crewReadyAt on the real timetable', () => {
  it('equals the ticket arrival + connection + report for a reachable origin, and the earliest arrival when not; never before now + 60', () => {
    const { g, flightId, d, p, acId, was } = shortOfCaptain('DUS', 'FNC', 40);
    for (const c of Object.values(g.crew)) if (c.role === 'CPT' && c.id !== was) { c.blocks = [{ from: g.now - DAY, to: g.now + 10 * DAY, why: 'leave' }]; c.status = 'leave'; }
    const f = g.flights[flightId];
    const ac = g.fleet[acId];
    const report = reportMinutes(ac.typeId).report;
    const o = outTicket(g, p, d, 'LIS', g.now);
    expect(o.why).toBeNull();
    const t = crewReadyAt(g, f, ac);
    expect(t).toBe(Math.max(g.now + 60, Math.ceil((o.plan.sta + OUT_CONNECT + report) / 5) * 5));
    expect(t).toBeLessThanOrEqual(f.std);
    // Two hours before report: no ticket fits, the earliest arrival wins and the flight has to wait.
    g.now = d.report - 2 * 60;
    const o2 = outTicket(g, p, d, 'LIS', g.now);
    expect(o2.why).not.toBeNull();
    const first = Math.ceil((g.now + BAL.deadheadCheckIn) / 60) * 60;
    const t2 = crewReadyAt(g, f, ac);
    expect(t2).toBeGreaterThanOrEqual(first + dhBlock('LIS', 'DUS') + OUT_CONNECT + report);
    expect(t2).toBeGreaterThan(f.std);
    expect(t2).toBeGreaterThanOrEqual(g.now + 60);
  });
});
