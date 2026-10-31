// v0.12.1 (Round F, C6): a rested captain in Goma was refused for a trip from Goma ("In Goma: Lucía Torres is in
// Lisbon, not Goma"): the location issue belonged to a later trip, whose ticket out, bought from Goma, this trip made
// wrong. That ticket is now bought again from where the new trip leaves her (its cost counted), and a reason about a
// later trip's ticket never says where she is now.

import { describe, expect, it } from 'vitest';
import { acceptOffer } from '../contracts';
import { legsOffer, newGame } from '../contracts/testkit';
import { addDeadhead } from '../core/entities';
import { DAY } from '../core/time';
import type { GameState } from '../core/types';
import { advanceTo } from '../sim';
import { openDuties, planCrew } from './check';
import { placeCrew, recheckPairing } from './roster';
import { rootReason } from './reasons';
import { segsOf, touchCrew } from './timeline';

const contractOf = (r: ReturnType<typeof acceptOffer>) => (r.ok ? r.data!.contractId : '');

function setup(g: GameState) {
  const [a1, a2] = Object.values(g.fleet);
  const t0 = Math.ceil(g.now / DAY) * DAY;
  // q: a trip from Lisbon ten days on.
  const rq = acceptOffer(g, legsOffer(g, [['LIS', 'PMI', t0 + 10 * DAY + 8 * 60], ['PMI', 'LIS', t0 + 10 * DAY + 12 * 60]]).id, [a1.id]);
  // p: a one-way trip Hamburg–Lisbon tomorrow (the aircraft is at Hamburg).
  a2.at = 'HAM';
  const rp = acceptOffer(g, legsOffer(g, [['HAM', 'LIS', t0 + DAY + 10 * 60]]).id, [a2.id]);
  expect(rq.ok && rp.ok).toBe(true);
  advanceTo(g, g.now + 1, new Set());
  const legOf = (k: string) => Object.values(g.flights).find((f) => f.contractId === k && f.kind === 'revenue')!;
  const q = g.pairings[g.duties[legOf(contractOf(rq)).dutyId!].pairingId];
  const p = g.pairings[g.duties[legOf(contractOf(rp)).dutyId!].pairingId];
  // A captain left in Hamburg, rostered on neither, with q's ticket out bought from Hamburg.
  const c = Object.values(g.crew).find((x) => x.role === 'CPT' && x.status === 'available' && !p.slots.some((s) => s.crewId === x.id) && !q.slots.some((s) => s.crewId === x.id))!;
  c.loc = 'HAM';
  c.restUntil = g.now - 60;
  delete c.standby;
  // (No days off in the way: only the ticket is.)
  c.off = [];
  const qd = openDuties(g, q)[0];
  const seat = q.slots.findIndex((s) => s.role === 'CPT');
  q.slots[seat].crewId = c.id;
  const t = addDeadhead(g, { crewIds: [c.id], from: 'HAM', to: g.flights[qd.flightIds[0]].from === 'LIS' ? 'LIS' : g.flights[qd.flightIds[0]].from, std: qd.report - 5 * 60, sta: qd.report - 2 * 60, cost: 0 });
  qd.deadheadIds.push(t.id);
  touchCrew(g);
  return { c, p, q, t };
}

describe("a later trip's ticket out from where the crew are (C6)", () => {
  it('is re-bought from where the new trip leaves them instead of refusing them', () => {
    const g = newGame(21);
    const { c, p, q, t } = setup(g);
    const seat = p.slots.findIndex((s) => s.role === 'CPT');
    p.slots[seat].crewId = null;
    const plan = planCrew(g, c, p, segsOf(g, c, p.id));
    expect(plan.issues.filter((i) => i.code === 'location' && i.level === 'illegal')).toEqual([]);
    expect(plan.retick).toContain(q.id);
    // Nothing about where she is stands in the way.
    expect(plan.issues.some((i) => i.level === 'illegal' && i.code !== 'fdp')).toBe(false);
    placeCrew(g, p, seat, c);
    // The old ticket out of Hamburg is gone: q is re-ticketed from where p leaves her (Lisbon: none needed).
    expect(g.flights[t.id]?.crewIds.includes(c.id) ?? false).toBe(false);
    expect(p.slots[seat].crewId).toBe(c.id);
    expect(q.slots.some((s) => s.crewId === c.id)).toBe(true);
    expect(recheckPairing(g, q).illegal).not.toContain(c.id);
    expect(Object.values(g.flights).some((f) => f.kind === 'deadhead' && f.status === 'scheduled' && f.from === 'HAM' && f.crewIds.includes(c.id) && f.to !== 'LIS')).toBe(false);
  });

  it("the reason names the later trip's ticket, never 'in Lisbon, not Hamburg'", () => {
    const g = newGame(21);
    const { c, p, q, t } = setup(g);
    const qd = openDuties(g, q)[0];
    const r = rootReason(g, [{ code: 'location', level: 'illegal', text: 'At LIS, not HAM', dutyId: qd.id }], c, p);
    expect(r?.text).toMatch(/^their ticket out for \S+ on .+ leaves Hamburg$/);
    expect(r?.text).not.toMatch(/not Hamburg/);
    expect(t.from).toBe('HAM');
  });
});
