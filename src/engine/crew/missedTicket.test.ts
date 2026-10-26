// v0.10.1 BLU511 (player save, 16 Aug 2027): an FO taken off one trip kept the ticket out to her next one, bought from
// where the first trip would have left her (Düsseldorf). She was in Lisbon, so she never boarded it, but the roster still
// read her as landed at the next trip's departure (Antalya): the flight sheet said "Crew legal", the re-roster kept her
// in the seat and the gate, which reads where she really is, held the leg for 34 h of 'Waiting for a rescue crew'.

import { describe, expect, it } from 'vitest';
import { acceptOffer } from '../contracts';
import { hamBase, leased, newGame, run } from '../contracts/testkit';
import { touchTickets } from '../core/entities';
import { DAY } from '../core/time';
import type { Flight, GameState, Pairing } from '../core/types';
import { problemAt } from '../problems';
import { deserialize, serialize } from '../save';
import { advanceTo } from '../sim';
import { planCrew } from './check';
import { flightCrewStatus } from './roster';
import { segsOf, touchCrew } from './timeline';

/** A Hamburg base (crews fly out from Lisbon on airline tickets); the day before the second tour's ticket out. */
function scenario(): { g: GameState; p: Pairing; fo: string; ticket: Flight; f0: Flight } {
  const g = newGame(21);
  const ac = leased(g);
  const o = hamBase(g, g.now + 3 * DAY, 30);
  o.broker = undefined;
  const r = acceptOffer(g, o.id, [ac.id]);
  if (!r.ok) throw new Error(r.error);
  advanceTo(g, g.contracts[r.data!.contractId].start - DAY, new Set());
  // The first planned trip whose FO flies out alone on an airline ticket.
  for (const p of Object.values(g.pairings)) {
    const d = g.duties[p.dutyIds[0]];
    const fo = p.slots.find((s) => s.role === 'FO')?.crewId;
    const ticket = d.deadheadIds.map((id) => g.flights[id]).find((t) => t && t.kind === 'deadhead' && t.status === 'scheduled' && t.crewIds.length === 1 && t.crewIds[0] === fo);
    if (p.status === 'planned' && fo && ticket) return { g, p, fo, ticket, f0: g.flights[d.flightIds[0]] };
  }
  throw new Error('no trip with a ticket out');
}

describe('v0.10.1 a ticket out the crew member never boards', () => {
  it('the roster sees a ticket out of an airport the crew member will not be at, and re-plans her before the trip', () => {
    const { g, p, fo, ticket, f0 } = scenario();
    const c = g.crew[fo];
    expect(c.loc).toBe('LIS');
    // The stale ticket: out of Düsseldorf, where a trip she was taken off would have left her.
    ticket.from = 'DUS';
    touchTickets(g);
    touchCrew(g);
    const plan = planCrew(g, c, p, segsOf(g, c, p.id), true);
    expect(plan.level).toBe('illegal');
    expect(plan.issues.map((i) => i.text)).toContain(`At LIS, not DUS for the ticket to ${f0.from}`);
    // Played on: the trip's first leg leaves with everyone really at its departure; no rescue-crew holds.
    run(g, f0.std + 6 * 60);
    expect(f0.status).not.toBe('scheduled');
    expect(f0.delayReason ?? '').not.toMatch(/rescue crew/);
    expect(f0.crewTries ?? 0).toBeLessThanOrEqual(2);
    // She flew out on a ticket from Lisbon, or someone else took the seat.
    if (f0.crewIds.includes(fo)) expect(Object.values(g.flights).some((t) => t.kind === 'deadhead' && t.status === 'done' && t.from === 'LIS' && t.to === f0.from && t.crewIds.includes(fo))).toBe(true);
  });

  it('a save from before the fix (flown ticket still listing her, the gate waiting on her): repaired on load, raised at once, never a rescue-crew loop', () => {
    const { g, p, fo, ticket, f0 } = scenario();
    // Up to the trip's first departure, played normally; then the 0.10 state: she never flew the ticket (still in
    // Lisbon) but it still lists her, and the gate already holds the leg on a decision to wait for her.
    run(g, f0.std - 30);
    expect(ticket.status).toBe('done');
    const c = g.crew[fo];
    c.loc = 'LIS';
    if (!ticket.crewIds.includes(fo)) ticket.crewIds.push(fo);
    expect(p.slots.some((s) => s.crewId === fo)).toBe(true);
    f0.crewHeld = true;
    f0.heldAt = g.now - 60;
    f0.crewDecided = true;
    f0.crewTries = 7;
    const h = deserialize(serialize(g));
    const t2 = h.flights[ticket.id];
    const f = h.flights[f0.id];
    expect(t2.crewIds).not.toContain(fo);
    expect(f.crewDecided).toBeUndefined();
    expect(f.crewTries).toBeUndefined();
    // The flight sheet: illegal, with where she is (not "Crew legal").
    expect(flightCrewStatus(h, f.id).level).toBe('illegal');
    const card = problemAt(h, { kind: 'flight', id: f.id });
    expect(card?.why).toMatch(/^FO .+ is in Lisbon, not Hamburg\.$/);
    run(h, f.std + 12 * 60);
    expect(f.delayReason ?? '').not.toMatch(/rescue crew/);
    expect(f.crewTries ?? 0).toBeLessThanOrEqual(2);
    if (f.status === 'enroute' || f.status === 'done') expect(f.crewIds).not.toContain(fo);
  });

  it('at the gate, a crew member not at the departure airport comes off at once (refilled, or the crew-short decision), never a 6-hour push', () => {
    const { g, fo, ticket, f0 } = scenario();
    run(g, f0.std - 30);
    const c = g.crew[fo];
    c.loc = 'LIS';
    if (!ticket.crewIds.includes(fo)) ticket.crewIds.push(fo);
    f0.crewHeld = true;
    f0.heldAt = g.now - 60;
    f0.crewDecided = true;
    f0.crewTries = 1;
    run(g, f0.std + 90);
    expect(f0.delayReason ?? '').not.toMatch(/rescue crew/);
    const d = g.duties[f0.dutyId!];
    expect(g.pairings[d.pairingId]?.slots.some((s) => s.crewId === fo) ?? false).toBe(false);
    // Refilled at the gate and away within the hour, or the player is asked now.
    if (f0.status !== 'scheduled') expect(f0.atd!).toBeLessThan(f0.std + 60);
    else expect(g.decisions.some((x) => x.kind === 'crewShort' && x.ref?.id === f0.id) || g.messages.some((m) => m.ref?.id === f0.id && /Crew short/.test(m.title))).toBe(true);
  });
});
