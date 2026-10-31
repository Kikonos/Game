// v0.14 (integration report, b744 seed 4): CS-TIF stranded at Manila in October. A crew-change job there lost its
// crew and was cancelled; the narrowbody's way to its airBaltic base at Riga is three ferry days (MNL–…–RIX, crew-change
// nights) and its crew must fly out from Europe. The move was re-planned every few hours (its later days fell in the
// next gaps and the first day read as a broken chain), planned 30 h out where a crew needed 42 h, held a day at a
// time, dropped with each Riga wave it missed and planned again: new legs each time, never crewed, "late change"
// alarms, the Riga flights cancelled one by one for two weeks (60 sub-charters, net −13.1%).

import { describe, expect, it } from 'vitest';
import { acceptOffer } from '.';
import { hamBase, legsOffer, newGame, owned } from './testkit';
import { isRerouted, route, timeChain } from './plan';
import { farOutstation, relinkPositioning, ticketLead } from './schedule';
import { BAL } from '../core/balance';
import { addFlight, flightsOf, removeFlights } from '../core/entities';
import { etopsCap } from '../core/perf';
import { DAY } from '../core/time';
import type { Flight, GameState } from '../core/types';
import { ticketBlock } from '../ops/commercial';
import { resolveDecision } from '../ops/events';
import { planRecovery } from '../ops/flights';
import { dailyHeads, hireHead, unlockHead } from '../ops/heads';
import { advanceTo } from '../sim';
import { createChecker } from '../../../scripts/invariants';

/** An A320 flown out to Manila on a charter, landed there 6 h ago (its crew gone home), a Hamburg base on it in 2 days. */
function strandedAtManila(seed = 44) {
  const g = newGame(seed);
  g.company.approvals.push('etops120');
  const ac = owned(g);
  const r = acceptOffer(g, legsOffer(g, [['LIS', 'MNL', g.now + DAY]]).id, [ac.id]);
  if (!r.ok) throw new Error(r.error);
  const trip = flightsOf(g, ac.id).filter((f) => f.contractId === r.data!.contractId);
  for (const f of trip) {
    if (f.kind === 'positioning') f.status = 'cancelled';
    else Object.assign(f, { status: 'done', atd: f.std, ata: f.sta });
  }
  ac.at = 'MNL';
  ac.flightId = null;
  g.contracts[r.data!.contractId].status = 'completed';
  g.now = trip.find((f) => f.to === 'MNL')!.sta + 6 * 60;
  const rb = acceptOffer(g, hamBase(g, g.now + 2 * DAY, 30, 2).id, [ac.id]);
  if (!rb.ok) throw new Error(rb.error);
  return { g, ac, baseId: rb.data!.contractId };
}

const outOf = (g: GameState, acId: string, at: string) => flightsOf(g, acId).filter((f) => f.status === 'scheduled' && f.from === at && (f.kind === 'positioning' || f.kind === 'ferry'));
const moveOf = (g: GameState, acId: string) => flightsOf(g, acId).filter((f) => f.status === 'scheduled' && (f.kind === 'positioning' || f.kind === 'ferry') && f.std < g.now + 6 * DAY).sort((a, b) => a.std - b.std);

/** The test fleet's narrowbody type. */
const T = owned(newGame(44)).typeId;

describe('v0.14 far outstations: the lead a crew flown out needs', () => {
  it('Manila is far from Lisbon (a 16 h ticket); Madeira is not', () => {
    const g = newGame(44);
    expect(farOutstation(g, 'MNL')).toBe(true);
    expect(farOutstation(g, 'FNC')).toBe(false);
    expect(farOutstation(g, 'LIS')).toBe(false);
  });

  it('the lead covers the wait for the flight out, the ticket, a rest as long as its duty and the report (42 h to Manila, was 30 h)', () => {
    const blk = ticketBlock('LIS', 'MNL');
    const duty = BAL.deadheadCheckIn + blk;
    expect(ticketLead(T, blk, true)).toBe(6 * 60 + duty + Math.max(14 * 60, duty) + 60);
    expect(ticketLead(T, blk, true)).toBeGreaterThan(40 * 60);
    // Near stations keep their lead: the same morning, or the day before with the minimum rest.
    expect(ticketLead(T, 120)).toBe(120 + 6 * 60);
    expect(ticketLead(T, 300)).toBe(300 + 14 * 60);
  });
});

describe('v0.14 crew-change days: a chain of sectors longer than a crew day flies as ferry days', () => {
  it('Manila–Lisbon empty (each sector within the day, together far over it) has night stops; revenue planning is unchanged', () => {
    const r = route(T, 'MNL', 'LIS', etopsCap(['etops120'], T), 11 * 60)!;
    expect(r.length).toBeGreaterThan(1);
    expect(isRerouted(r)).toBe(true);
    const legs = timeChain(r, 0, T);
    // Some leg leaves at least the 14 h night stop after the one before landed.
    expect(legs.some((l, i) => i > 0 && l.std - legs[i - 1].sta >= BAL.delivery.nightStop)).toBe(true);
    const rev = route(T, 'MNL', 'LIS', etopsCap(['etops120'], T));
    expect(rev && isRerouted(rev)).toBe(false);
  });
});

describe('v0.14 CS-TIF at Manila: one stable move home, crewable, and one card', () => {
  it('the move leaves when a crew flown out can be there, not before', () => {
    const { g, ac } = strandedAtManila();
    relinkPositioning(g, ac.id);
    const out = outOf(g, ac.id, 'MNL');
    expect(out).toHaveLength(1);
    expect(out[0].std - g.now).toBeGreaterThanOrEqual(ticketLead(ac.typeId, ticketBlock('LIS', 'MNL'), true) - 5);
  });

  it('a late ferry-day chain is kept across settles: its later days are part of it, never orphans planned anew', () => {
    const { g, ac } = strandedAtManila();
    relinkPositioning(g, ac.id);
    const first = moveOf(g, ac.id);
    expect(first.length).toBeGreaterThan(2);
    // It is late for the base: its last day lands after the first wave leaves, its first day before.
    const wave = flightsOf(g, ac.id).filter((f) => f.status === 'scheduled' && f.kind === 'revenue').sort((a, b) => a.std - b.std)[0];
    expect(first[first.length - 1].sta).toBeGreaterThan(wave.std);
    expect(first[0].sta).toBeLessThan(wave.std);
    const ids = first.map((f) => f.id).join(',');
    for (let i = 0; i < 12; i++) {
      g.now += 60;
      expect(relinkPositioning(g, ac.id)).toEqual([]);
      expect(moveOf(g, ac.id).map((f) => f.id).join(',')).toBe(ids);
    }
  });

  it('ONE card when it is planned: sub-charter (default), swap or cancel the legs it cannot reach; asked once', () => {
    const { g, ac, baseId } = strandedAtManila();
    relinkPositioning(g, ac.id);
    const cards = g.decisions.filter((d) => d.kind === 'farStranded');
    expect(cards).toHaveLength(1);
    const d = cards[0];
    const client = g.clients[g.contracts[baseId].clientId].name;
    expect(d.title).toBe(`${ac.reg} can't reach Hamburg for ${client} before ${d.title.split(' before ')[1].split(':')[0]}: sub-charter or swap aircraft`);
    expect(d.body).toMatch(/^CS-\w+ is at Manila with no crew, 16 h from home by airline\. A crew flies out and rests first: the ferry MNL–HAM leaves/);
    expect(d.options.map((o) => o.id)).toEqual(['subcharter', 'swap', 'cancel']);
    // Planned again (nothing changed): no second card.
    g.now += 60;
    relinkPositioning(g, ac.id);
    expect(g.decisions.filter((x) => x.kind === 'farStranded')).toHaveLength(1);
    const move = moveOf(g, ac.id);
    const arrive = move[move.length - 1].sta;
    const lost = flightsOf(g, ac.id).filter((f) => f.status === 'scheduled' && f.kind === 'revenue' && f.std < arrive + 45);
    expect(lost.length).toBeGreaterThan(0);
    expect(resolveDecision(g, d.id, 'subcharter').ok).toBe(true);
    expect(lost.every((f) => !!g.flights[f.id].operatedBy)).toBe(true);
    // The move itself goes on.
    expect(moveOf(g, ac.id).map((f) => f.id)).toEqual(move.map((f) => f.id));
  });

  it('recovery that drops a wave the far move cannot reach keeps the move (the next wave leaves from where it goes)', () => {
    const { g, ac } = strandedAtManila();
    relinkPositioning(g, ac.id);
    const move = moveOf(g, ac.id);
    // Held three days at Manila: the first waves at Hamburg are past their 6 h cap.
    const plan = planRecovery(g, ac, 'MNL', move[0].std + 3 * DAY, 0);
    expect(plan.cancels.length).toBeGreaterThan(0);
    expect(plan.cancels.every((f) => f.kind === 'revenue')).toBe(true);
    for (const f of move) expect(plan.moves.some((m) => m.f.id === f.id)).toBe(true);
  });

  it('played on for five days: the move out of Manila is never planned anew (no new legs, no re-plan loop warning)', () => {
    const { g, ac } = strandedAtManila(45);
    relinkPositioning(g, ac.id);
    const inv = createChecker();
    inv.observe(g);
    const seen = new Set(outOf(g, ac.id, 'MNL').map((f) => f.id));
    const made = new Set<string>();
    for (let h = 0; h < 5 * 24; h++) {
      advanceTo(g, g.now + 60, new Set());
      for (const d of [...g.decisions]) resolveDecision(g, d.id, d.defaultOption);
      inv.observe(g);
      for (const f of Object.values(g.flights)) if (f.aircraftId === ac.id && f.from === 'MNL' && f.kind === 'positioning' && f.status !== 'cancelled' && !seen.has(f.id)) made.add(f.id);
    }
    expect([...made]).toEqual([]);
    // It flew: the crew flown out took it.
    expect(flightsOf(g, ac.id).some((f) => [...seen].includes(f.id) && f.status === 'done')).toBe(true);
    expect(inv.warns.filter((w) => w.code === 'replan-loop')).toEqual([]);
  });
});

describe('v0.14 no crew for the far move: it waits for one flown out, keeps its legs', () => {
  it('every captain on leave for a week: held at the gate a ticket-and-rest at a time (never a day no ticket makes), never handed back to be planned anew', () => {
    const { g, ac } = strandedAtManila(45);
    relinkPositioning(g, ac.id);
    const move = moveOf(g, ac.id);
    for (const c of Object.values(g.crew)) if (c.role === 'CPT') c.blocks = [...(c.blocks ?? []), { from: g.now, to: g.now + 7 * DAY, why: 'leave' }];
    const lead = ticketLead(ac.typeId, ticketBlock('LIS', 'MNL'), true);
    let held = false;
    for (let h = 0; h < 7 * 24; h++) {
      advanceTo(g, g.now + 60, new Set());
      for (const d of [...g.decisions]) resolveDecision(g, d.id, d.defaultOption);
      const f = g.flights[move[0].id];
      // The same first leg throughout (never removed, never re-made with a new id).
      expect(f?.status).toBe('scheduled');
      if ((f.crewTries ?? 0) > 0 && !held) {
        held = true;
        // Held for when a crew flown out can be there.
        expect(f.std + f.delay - g.now).toBeGreaterThanOrEqual(lead - 60);
      }
    }
    expect(held).toBe(true);
    expect(outOf(g, ac.id, 'MNL').map((f) => f.id)).toEqual([move[0].id]);
  });
});

describe("v0.14 sibling loop: the fleet planner's 'position the day before' never re-plans the last day of a move under way", () => {
  it('a two-day move MAD–BCN, BCN–HAM landing just before a base starts: no proposal for BCN–HAM alone (before: one every other day, each a new move)', () => {
    const g = newGame(45);
    const ac = owned(g);
    for (const f of flightsOf(g, ac.id)) f.status = 'cancelled';
    const rb = acceptOffer(g, hamBase(g, g.now + 2 * DAY, 30, 2).id, [ac.id]);
    if (!rb.ok) throw new Error(rb.error);
    const k = rb.data!.contractId;
    for (const f of flightsOf(g, ac.id)) if (f.kind === 'positioning') f.status = 'cancelled';
    ac.at = 'MAD';
    const f0 = flightsOf(g, ac.id).filter((f) => f.kind === 'revenue' && f.status === 'scheduled').sort((a, b) => a.std - b.std)[0];
    addFlight(g, { no: 'AWL901', aircraftId: ac.id, contractId: k, kind: 'positioning', from: 'MAD', to: 'BCN', std: f0.std - 30 * 60, sta: f0.std - 29 * 60 });
    const last = addFlight(g, { no: 'AWL902', aircraftId: ac.id, contractId: k, kind: 'positioning', from: 'BCN', to: 'HAM', std: f0.std - 3 * 60, sta: f0.std - 60 });
    unlockHead(g, 'fleetPlanner');
    expect(hireHead(g, 'fleetPlanner', 2).ok).toBe(true);
    dailyHeads(g);
    expect(g.heads!.fleetPlanner.proposals.filter((p) => p.kind === 'position')).toEqual([]);
    expect(g.flights[last.id].status).toBe('scheduled');
    // A positioning leaving from where the aircraft is still gets its proposal.
    removeFlights(g, flightsOf(g, ac.id).filter((f) => f.kind === 'positioning' && f.status === 'scheduled').map((f) => f.id));
    ac.at = 'BCN';
    addFlight(g, { no: 'AWL903', aircraftId: ac.id, contractId: k, kind: 'positioning', from: 'BCN', to: 'HAM', std: f0.std - 3 * 60, sta: f0.std - 60 });
    g.heads!.fleetPlanner.proposals = [];
    dailyHeads(g);
    expect(g.heads!.fleetPlanner.proposals.filter((p) => p.kind === 'position').map((p) => p.text)).toEqual([expect.stringMatching(/^Position \S+ BCN–HAM the day before/)]);
  });
});

describe('v0.14 invariants: re-plan loop detector', () => {
  it('warns when one empty move is planned anew more than 3 times in 24 h, not for a weekly series', () => {
    const g = newGame(44);
    const ac = owned(g);
    const inv = createChecker();
    inv.observe(g);
    const t = g.now + 3 * DAY;
    let f: Flight | null = null;
    for (let i = 0; i < 4; i++) {
      if (f) removeFlights(g, [f.id]);
      f = addFlight(g, { no: `AWL9${i}`, aircraftId: ac.id, contractId: null, kind: 'positioning', from: 'LIS', to: 'MAD', std: t + i * 60, sta: t + i * 60 + 80 });
      g.now += 3 * 60;
      inv.observe(g);
    }
    const w = inv.warns.filter((x) => x.code === 'replan-loop');
    expect(w).toHaveLength(1);
    expect(w[0].text).toMatch(/empty leg LIS–MAD planned anew 4 times in 24 h/);
    // Weekly legs on one route are not copies of one move.
    const g2 = newGame(44);
    const ac2 = owned(g2);
    const inv2 = createChecker();
    inv2.observe(g2);
    for (let i = 0; i < 5; i++) addFlight(g2, { no: `AWL8${i}`, aircraftId: ac2.id, contractId: null, kind: 'positioning', from: 'LIS', to: 'MAD', std: g2.now + (i + 3) * 7 * DAY, sta: g2.now + (i + 3) * 7 * DAY + 80 });
    g2.now += 60;
    inv2.observe(g2);
    expect(inv2.warns.filter((x) => x.code === 'replan-loop')).toEqual([]);
  });
});
