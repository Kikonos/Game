// v0.22.1 an empty leg waits for its crew (the player: "when ferrying back home, sometimes it doesn't have pilots, and
// it gives me the option to cancel or subcharter with reliability and relation costs, which doesn't make sense because
// it's just a ferry flight home … it can always be delayed until pilots get there"). Pinned here:
// 1. a free empty leg (a move home, nothing with passengers in its unit) short of pilots is no alarm: not on the short
//    list, its card says it hurts nothing, the ladder re-times it to the first departure the roster can crew, quietly
//    (no chime, no pause), and Crew Control offers nothing with a penalty;
// 2. it is a problem only by what the aircraft would miss: a check it must be at; then the card names that, and the
//    wait is not taken past it;
// 3. a ferry with a purpose (to a check) keeps its alarm: it has a slot to make.

import { describe, expect, it } from 'vitest';
import { addFlight, retimeFlight } from '../core/entities';
import { clearPause, takePause } from '../core/pause';
import { blockMinutes } from '../core/perf';
import { DAY } from '../core/time';
import type { Flight, GameState, MaintenanceEvent } from '../core/types';
import { relinkPositioning } from '../contracts/schedule';
import { advanceTo, settle } from '../sim';
import { crewControl, crewShortCard, escalateShortages, flightCrewStatus, shortFlights } from '.';
import { emptyLegTie, freeEmptyLeg, isEmptyLeg, waitForCrew } from './control';
import { fixtureContract, fixtureGame } from './fixtures';
import { autoRoster, releaseCrew, setFlightsCrew } from './roster';
import { rollingRoster } from '../../test/rolling';

rollingRoster();

/**
 * A charter Düsseldorf–Funchal and back; the aircraft then moves home to Lisbon (the schedule's own empty leg), a day
 * later. Three hours before that leg its two pilots fall sick at Düsseldorf and every other pilot but one captain and
 * one first officer (in Lisbon) is on leave: nobody can be there for the departure.
 */
function ferryHome(): { g: GameState; ferry: Flight; std: number } {
  const g = fixtureGame(5);
  const acId = Object.keys(g.fleet)[0];
  for (const id of Object.keys(g.fleet)) if (id !== acId) delete g.fleet[id];
  const ac = g.fleet[acId];
  ac.at = 'DUS';
  const std = Math.floor(g.now / DAY) * DAY + 2 * DAY + 9 * 60;
  const b = blockMinutes(ac.typeId, 'DUS', 'FNC');
  const k = fixtureContract(g, { pattern: { kind: 'legs', legs: [] }, aircraftIds: [acId], start: std - DAY, end: std + DAY, product: { kind: 'charter', price: 120_000, depositPct: 0.3, balanceDaysBefore: 7, fuelEscalation: false } as never, penalties: { cancelScale: [], perDelay: 3000, perCancelledLeg: 15_000 } });
  const out = addFlight(g, { no: 'AW816', aircraftId: acId, contractId: k.id, kind: 'revenue', from: 'DUS', to: 'FNC', std, sta: std + b, pax: 170 });
  const back = addFlight(g, { no: 'AW817', aircraftId: acId, contractId: k.id, kind: 'revenue', from: 'FNC', to: 'DUS', std: std + b + 50, sta: std + 2 * b + 50, pax: 160 });
  const [home] = relinkPositioning(g, acId);
  autoRoster(g);
  // The move home a day later: a trip of its own.
  retimeFlight(g, home, home.std + 20 * 60, home.sta + 20 * 60);
  settle(g);
  const ferry = g.flights[home.id];
  const p0 = g.pairings[g.duties[ferry.dutyId!].pairingId];
  const flying = new Set([...out.crewIds, ...back.crewIds, ...p0.slots.map((s) => s.crewId ?? '')]);
  const spare = Object.values(g.crew).filter((c) => !flying.has(c.id));
  const free = new Set([spare.find((c) => c.role === 'CPT')!.id, spare.find((c) => c.role === 'FO')!.id]);
  advanceTo(g, ferry.std - 3 * 60, new Set());
  const p = () => g.pairings[g.duties[g.flights[ferry.id].dutyId!].pairingId];
  for (const s of [...p().slots]) {
    const c = s.crewId ? g.crew[s.crewId] : undefined;
    if (!c || (c.role !== 'CPT' && c.role !== 'FO')) continue;
    c.blocks = [...(c.blocks ?? []), { from: g.now, to: g.now + 5 * DAY, why: 'sick' }];
    releaseCrew(g, p(), c.id, 'Sick');
  }
  for (const c of Object.values(g.crew)) if ((c.role === 'CPT' || c.role === 'FO') && !free.has(c.id) && !c.blocks?.some((x) => x.why === 'sick')) c.blocks = [...(c.blocks ?? []), { from: g.now, to: g.now + 10 * DAY, why: 'leave' }];
  setFlightsCrew(g, p());
  settle(g);
  clearPause();
  return { g, ferry: g.flights[ferry.id], std: g.flights[ferry.id].std };
}

describe('v0.22.1 an empty leg waits for its crew', () => {
  it('a move home short of pilots is no alarm: off the short list, its card hurts nothing, nothing with a penalty offered', () => {
    const { g, ferry } = ferryHome();
    expect(ferry.kind).toBe('positioning');
    expect(isEmptyLeg(ferry)).toBe(true);
    expect(freeEmptyLeg(g, ferry)).toBe(true);
    expect(emptyLegTie(g, ferry)).toBeNull();
    expect(flightCrewStatus(g, ferry.id).level).toBe('missing');
    // Not among the crew-short flights (the strip, the map and the badge read this list): nothing waits on it.
    expect(shortFlights(g)).toEqual([]);
    const card = crewShortCard(g, ferry.id)!;
    expect(card.what).toMatch(/has no pilots/);
    expect(card.severity).toBe('amber');
    expect(card.hurt.level).toBe('none');
    expect(card.hurt.money).toBe(0);
    expect(card.hurt.text).toMatch(/empty flight, no penalty, the aircraft waits for pilots, parking only/);
    const v = crewControl(g, ferry.id, { previews: false })!;
    const sub = v.solutions.find((s) => s.id === 'subcharter')!;
    const cancel = v.solutions.find((s) => s.id === 'cancel')!;
    expect(sub.available).toBe(false);
    expect(cancel.cost).toBe(0);
    expect(cancel.chips.join(' ')).toMatch(/No client/);
    expect(cancel.chips.join(' ')).not.toMatch(/Reliability/);
    expect(v.solutions.find((s) => s.id === 'delay')!.available).toBe(true);
  });

  it('the ladder re-times it to the first departure its pilots can make, quietly: no alarm, no pause, one Inbox line', () => {
    const { g, ferry, std } = ferryHome();
    const n = g.messages.length;
    const cash = g.company.cash;
    escalateShortages(g, { reroster: true });
    expect(takePause()).toBeNull();
    const f = g.flights[ferry.id];
    expect(f.status).toBe('scheduled');
    expect(f.std).toBeGreaterThan(std);
    expect(f.std - std).toBeLessThanOrEqual(2 * DAY);
    expect(f.crewAlert).toBeUndefined();
    expect(flightCrewStatus(g, f.id).level).not.toBe('missing');
    const pilots = f.crewIds.map((id) => g.crew[id]).filter((c) => c.role === 'CPT' || c.role === 'FO');
    expect(pilots.map((c) => c.role).sort()).toEqual(['CPT', 'FO']);
    // They fly in from Lisbon on a ticket that lands before the new report.
    const tickets = Object.values(g.flights).filter((t) => t.kind === 'deadhead' && t.status === 'scheduled' && t.to === 'DUS' && pilots.every((c) => t.crewIds.includes(c.id)));
    expect(tickets.length).toBe(1);
    expect(tickets[0].sta).toBeLessThan(f.std);
    const fresh = g.messages.slice(0, g.messages.length - n);
    const line = fresh.find((m) => /waits for its pilots/.test(m.title))!;
    expect(line.tone).toBe('info');
    expect(line.body).toMatch(/The empty leg Düsseldorf–Lisbon was missing 1 captain and 1 first officer/);
    expect(line.body).toMatch(/the aircraft is parked until then\. Nothing after it is late\./);
    // No crew alarm of any stage, and no penalty or sub-charter booked.
    expect(fresh.some((m) => /CREW SHORTAGE|has no pilots|Heads-up/.test(m.title))).toBe(false);
    expect(g.finance.current.lines.penalties ?? 0).toBe(0);
    expect(g.finance.current.lines.subcharter ?? 0).toBe(0);
    expect(cash - g.company.cash).toBeLessThan(5_000);
    expect(g.stats.emptyWaits).toBe(1);
    // It flies at its new time.
    advanceTo(g, f.sta + 60, new Set());
    expect(g.flights[ferry.id].status).toBe('done');
    expect(g.fleet[ferry.aircraftId!].at).toBe('LIS');
  }, 60_000);

  it('it is a problem only by what the aircraft would miss: a check at Lisbon it cannot reach by waiting', () => {
    const { g, ferry } = ferryHome();
    // A C-check at Lisbon that starts four hours after the leg lands: the pilots' first possible departure is too late.
    const m: MaintenanceEvent = { id: 'mxT', aircraftId: ferry.aircraftId!, kind: 'C', at: 'LIS', start: ferry.sta + 4 * 60, end: ferry.sta + 4 * 60 + 10 * DAY, cost: 0, status: 'planned', planned: true, ev: 0 };
    g.maintenance[m.id] = m;
    const tie = emptyLegTie(g, ferry)!;
    expect(tie.at).toBe(m.start);
    expect(tie.what).toMatch(/the C-check at Lisbon/);
    expect(tie.latest).toBeLessThanOrEqual(m.start - ferry.block);
    // On the short list now, by the time that is at stake, and red: the check is hours away.
    const short = shortFlights(g);
    expect(short.map((s) => s.flightId)).toEqual([ferry.id]);
    expect(short[0].stage).toBe('red');
    const card = crewShortCard(g, ferry.id)!;
    expect(card.severity).toBe('red');
    expect(card.hurt.text).toMatch(/would miss the C-check at Lisbon on .* unless it leaves by/);
    // The wait is not taken past it.
    expect(waitForCrew(g, g.flights[ferry.id])).toBe(false);
    expect(g.flights[ferry.id].std).toBe(ferry.std);
  });

  it('a ferry with a purpose (to a check) is never made to wait: it has a slot to make', () => {
    const { g, ferry } = ferryHome();
    g.flights[ferry.id].purpose = 'check';
    expect(freeEmptyLeg(g, g.flights[ferry.id])).toBe(false);
    expect(waitForCrew(g, g.flights[ferry.id])).toBe(false);
    expect(shortFlights(g).map((s) => s.flightId)).toEqual([ferry.id]);
  });
});
