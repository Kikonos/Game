// Cross-module plumbing the builders rely on: pauses, deadheads, reassign/sub-charter, change marks,
// pure read APIs and compact saves (DESIGN.md §3.3, §4.1–4.2, §7.2).

import { describe, expect, it } from 'vitest';
import { acceptOffer, cancelCost, cancelPenalty, contractProgress, counterView, feasibility, feasibilityAll, generateOffer, marketFit, paintQuote, paintWindow, productValue } from '../contracts';
import {
  checkAssignment, classOf, conversionClasses, conversionEarliest, conversionPlan, crewAvailability, crewCalendar, crewControl, crewExtraFor, crewExtraQuote, crewGauges, crewIssuesFor, crewStatusView, crewWindows,
  daysOffInMonth, dropTargets, dutyCandidates, dutyCrew, dutyLegality, flightCrewStatus, hireQuote, jetQuote, moraleOf, moraleSummary, policyPreview, rosterBoard, rosterOf, shortFlights, staffing,
} from '../crew';
import { demoFlights, devGrantApproval, devMarketOffer } from '../dev';
import { addCrew } from '../crew/fixtures';
import { createGame } from '../newGame';
import {
  aogChance, APPROVALS, approvalBlocker, cashForecast, checkStatus, commercialFlightsAirborne, commercialFlightsBetween, commercialItinerary, fixedCosts, flightType, GOALS,
  groundGaps, liveryOf, monthProfit, paintStatus, rotationOf, subcharterable, subcharterQuote,
  acquireAircraft, aircraftGate, approvalReqs, bookRefit, cabinOptions, deliveryQuote, deliveryStatus, ladder, leaseView, marketView, refitQuote, refitStations, returnQuote, ticketPurpose,
  problemAt, problemFor, problems,
} from '../ops';
import { deserialize, serialize } from '../save';
import { advanceTo } from '../sim';
import { addDeadhead, flightsOf, reassignFlights, retimeFlight, subcharterFlights, takeFlightChanges } from './entities';
import { inboxCounts } from './messages';
import { requestPause, takePause } from './pause';
import { compactQueue } from './queue';
import { DAY, monthKey } from './time';
import type { Archetype, GameState } from './types';

const newGame = (seed = 11): GameState =>
  createGame({ name: 'Atlântica Wings', code: 'AW', livery: { primary: '#0b1f4d', secondary: '#f5c451', tail: 'sweep' }, base: 'LIS', seed });

describe('auto-pause', () => {
  it('keeps every reason and returns the highest honoured one', () => {
    requestPause('monthEnd');
    requestPause('crewShortage');
    expect(takePause(new Set(['crewShortage', 'aog']))).toBe('crewShortage');
    requestPause('monthEnd');
    expect(takePause(new Set(['aog']))).toBeNull();
    // dropped, not leaked into the next event
    expect(takePause()).toBeNull();
  });

  it('advanceTo stops only on honoured reasons', () => {
    const g = newGame();
    const target = g.now + 40 * DAY;
    const res = advanceTo(g, target, new Set(['aog']));
    expect(res.pause).toBeNull();
    expect(g.now).toBe(target);
  });
});

describe('flight helpers', () => {
  it('deadheads arrive without an aircraft and are marked done', () => {
    const g = newGame();
    const crewIds = Object.keys(g.crew).slice(0, 3);
    const f = addDeadhead(g, { crewIds, from: 'LIS', to: 'HAM', std: g.now + 60, sta: g.now + 260, cost: 750 });
    expect(g.queue.filter((e) => e.id === f.id).map((e) => e.type)).toEqual(['flight.arr']);
    advanceTo(g, g.now + 300);
    expect(g.flights[f.id].status).toBe('done');
  });

  it('reassigns and sub-charters flights, marking the aircraft for crew re-sync', () => {
    const g = newGame();
    demoFlights(g, undefined, 2);
    const [a, b] = Object.keys(g.fleet);
    const fa = flightsOf(g, a).filter((f) => f.status === 'scheduled');
    takeFlightChanges(g);
    reassignFlights(g, [fa[0].id], b);
    expect(g.flights[fa[0].id].aircraftId).toBe(b);
    expect(flightsOf(g, b).some((f) => f.id === fa[0].id)).toBe(true);
    const ch = takeFlightChanges(g);
    expect([...ch.keys()].sort()).toEqual([a, b].sort());
    subcharterFlights(g, [fa[1].id], 'rival1');
    expect(g.flights[fa[1].id].aircraftId).toBeNull();
    expect(g.flights[fa[1].id].operatedBy).toBe('rival1');
    retimeFlight(g, fa[2], fa[2].std + 30, fa[2].sta + 30);
    expect(takeFlightChanges(g).get(a)).toBeDefined();
    advanceTo(g, g.flights[fa[1].id].sta + 1, new Set());
    expect(g.flights[fa[1].id].status).toBe('done');
  });
});

describe('determinism of read APIs', () => {
  it('reads and quotes never touch state or the RNG', () => {
    const g = newGame();
    demoFlights(g, undefined, 3);
    for (const a of ['seasonBase', 'adhoc', 'repatriation'] as Archetype[]) generateOffer(g, a);
    // v0.5.1: an offer with client paint (feasibility with and without it, the quote, the paint-shop slot).
    generateOffer(g, 'seasonBase', { wide: false, window: false, start: g.now + 40 * DAY, paint: { kind: 'full', required: false } });
    // B1: a signed contract so contractProgress has something to read.
    const first = Object.values(g.offers).find((o) => feasibilityAll(g, o.id)[0]?.level !== 'no');
    if (first) acceptOffer(g, first.id, [feasibilityAll(g, first.id)[0].aircraftId]);
    // v0.7: a widebody signed abroad (delivery ferry, deadheads), a refit booked, a lease near its end.
    g.company.cash += 20_000_000;
    devGrantApproval(g, 'widebody');
    addCrew(g, { CPT: 2, FO: 2 }, 'A330/340');
    acquireAircraft(g, devMarketOffer(g, 'a332', { site: 'SNN' }));
    devMarketOffer(g, 'b763', { site: 'SCL' });
    const nb = Object.values(g.fleet).find((a) => a.typeId === 'a320ceo')!;
    bookRefit(g, nb.id, '24J/90Y', 'LIS', g.now + 20 * DAY);
    advanceTo(g, g.now + 2 * DAY);
    const before = JSON.stringify(g);
    const t = g.now;
    for (let i = 0; i < 20; i++) {
      for (const o of Object.values(g.offers)) {
        feasibilityAll(g, o.id);
        marketFit(g, o.id);
        for (const id of Object.keys(g.fleet)) {
          feasibility(g, o.id, id);
          feasibility(g, o.id, id, { paint: false });
          if (o.paint) paintWindow(g, id, o.paint, o.start);
        }
        productValue(o.product, o.estBH, o.start, o.end);
        paintQuote(o, true);
        paintQuote(o, false);
      }
      for (const c of Object.values(g.contracts)) contractProgress(g, c.id);
      for (const ac of Object.values(g.fleet)) {
        checkStatus(g, ac);
        aogChance(g, ac, ac.at);
        liveryOf(g, ac);
        paintStatus(g, ac.id);
        paintWindow(g, ac.id, { days: 2 }, t + 30 * DAY, t + DAY);
      }
      for (const f of Object.values(g.flights)) {
        flightCrewStatus(g, f.id);
        flightType(g, f);
        commercialItinerary(g, f);
      }
      for (const c of Object.values(g.crew).slice(0, 10)) {
        crewWindows(g, c, t);
        rosterOf(g, c.id, t, t + 14 * DAY);
        // v0.5.2: crew card strip and header.
        crewCalendar(g, c.id, t - DAY, t + 14 * DAY);
        crewStatusView(g, c.id);
      }
      for (const o of Object.values(g.offers)) counterView(g, o.id);
      commercialFlightsBetween(g, t - DAY, t + 3 * DAY);
      for (let k = 0; k < 48; k++) commercialFlightsAirborne(g, t + k * 60);
      // Engine-lane screen reads: manual roster, sub-charter quotes, fleet gaps, finance, company, inbox.
      for (const d of Object.values(g.duties).slice(0, 6)) {
        dutyCrew(g, d.id);
        dutyLegality(g, d.id);
        crewIssuesFor(g, d);
        if (i === 0) for (const r of ['CPT', 'CC'] as const) dutyCandidates(g, d.id, r);
        const someone = Object.keys(g.crew)[0];
        checkAssignment(g, someone, d.id);
      }
      for (const c of Object.values(g.contracts)) {
        cancelPenalty(g, c.id);
        cancelCost(g, c.id);
        const legs = subcharterable(g, c.id);
        if (legs[0]) subcharterQuote(g, rotationOf(g, legs[0].id).map((f) => f.id));
      }
      for (const ac of Object.values(g.fleet)) groundGaps(g, ac, t, t + 30 * DAY);
      for (const c of Object.values(g.crew).slice(0, 3)) daysOffInMonth(g, c, t, t + 30 * DAY);
      fixedCosts(g, monthKey(t));
      monthProfit(g.finance.current);
      for (const gd of GOALS) gd.progress(g);
      for (const a of APPROVALS) approvalBlocker(g, a.id);
      inboxCounts(g);
      crewAvailability(g, 'A320', 'a320ceo', t, t + 30 * DAY, 200);
      // v0.6: roster board, conversion plans, morale, extra crew.
      const ids = Object.keys(g.crew);
      rosterBoard(g, t, t + 31 * DAY, ids.slice(0, 20));
      for (const d of Object.values(g.duties).slice(0, 2)) {
        const p = g.pairings[d.pairingId];
        const holder = p?.slots.find((x) => x.crewId)?.crewId;
        if (holder) for (const scope of ['duty', 'trip'] as const) dropTargets(g, d.id, holder, scope);
      }
      conversionPlan(g, { crewIds: ids.slice(0, 12), family: 'A330/340', start: conversionEarliest(g) });
      conversionClasses(g);
      classOf(g, ids[0]);
      moraleOf(g, ids[0]);
      moraleSummary(g);
      policyPreview(g, { perDiemPct: 120, hotelTier: 5, rotationWeeks: 4 });
      for (const ac of Object.keys(g.fleet)) {
        crewExtraFor(g, ac, null);
        crewExtraQuote(g, ac, { cabin: 2, pilot: 1 });
      }
      hireQuote(g, { role: 'FO', family: 'A320', base: 'LIS', count: 2 });
      staffing(g);
      cashForecast(g, 90);
      // v0.7: market, delivery, lease, cabin and ladder reads.
      marketView(g);
      for (const ac of Object.values(g.fleet)) {
        deliveryStatus(g, ac.id);
        returnQuote(g, ac.id);
        leaseView(g, ac.id);
        aircraftGate(g, ac.typeId);
        cabinOptions(ac.typeId);
        refitStations(g, ac.id);
        for (const p of cabinOptions(ac.typeId)) refitQuote(g, ac.id, p.label, 'HAM', t + 10 * DAY);
      }
      deliveryQuote(g, 'a320ceo', 'CGK', t + 30 * DAY);
      for (const f of Object.values(g.flights)) if (f.kind === 'deadhead') ticketPurpose(g, f.id);
      ladder(g);
      for (const a of APPROVALS) approvalReqs(g, a.id);
      // v0.7.1: Crew Control, jets, gauges, the ladder list and every problem card (previews run on copies).
      shortFlights(g);
      const some = Object.values(g.flights).filter((f) => f.status === 'scheduled' && f.aircraftId).slice(0, 2);
      for (const f of some) crewControl(g, f.id);
      jetQuote(g, 'LIS', 'DUS', 4, t);
      for (const c of Object.values(g.crew).slice(0, 3)) crewGauges(g, c.id);
      problems(g);
      for (const f of some) problemAt(g, { kind: 'flight', id: f.id });
      for (const ac of Object.keys(g.fleet)) problemAt(g, { kind: 'aircraft', id: ac });
      problemFor(g, { kind: 'cashLow', ref: { kind: 'cash', id: 'cash' } });
      for (const o of Object.values(g.offers)) problemFor(g, { kind: 'offerFit', ref: { kind: 'offer', id: o.id } });
    }
    expect(JSON.stringify(g)).toBe(before);
  });
});

describe('saves', () => {
  it('drop stale queue events and still round-trip', () => {
    const g = newGame();
    demoFlights(g, undefined, 2);
    const f = flightsOf(g, Object.keys(g.fleet)[0])[0];
    retimeFlight(g, f, f.std + 20, f.sta + 20);
    const loaded = deserialize(serialize(g));
    expect(loaded.queue.length).toBe(compactQueue(g).length);
    expect(loaded.queue.length).toBeLessThan(g.queue.length);
    expect(loaded.queue.filter((e) => e.id === f.id)).toHaveLength(1);
  });
});
