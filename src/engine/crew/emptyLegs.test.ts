// v0.19.5 (the player's BLU2266, Blue Airlines 8 Jan 2029): "The flight is in 8 days. What do you mean it has a crew
// shortage and the options are to cancel or subcharter? I know I have too much crew." BLU2266 BKK–BRU is an empty leg
// (positioning) into the Toronto charter BLU2264 BRU–YYZ. Under EASA ORO.CC.100 the cabin crew minimum follows the
// passengers aboard: an empty leg needs its flight crew only. Three causes stacked up:
//   1. the empty leg from away stayed in the charter's trip, so the whole cabin was flown out to Bangkok two days early
//      (a 14 h ticket on 15 Jan) to sit in the empty aircraft, through published days off nobody could lift, and the
//      empty leg itself read "Crew missing: PUR, CC" with two lower-deck rest groups planned for nobody;
//   2. six of the A330/340-rated pursers flew A320 tours while fourteen A320-only pursers sat at home;
//   3. a published day off could only be bought back from 72 h before the report, so eight days out Crew Control
//      offered BLU2264 only Cancel and Sub-charter.

import { describe, expect, it } from 'vitest';
import { acceptOffer } from '../contracts';
import { addAircraft, legsOffer, newGame } from '../contracts/testkit';
import { isPilot } from '../core/perf';
import { DAY } from '../core/time';
import type { GameState, Pairing } from '../core/types';
import { fixture } from '../fixtures/compatKit';
import { deserialize } from '../save';
import '../sim';
import { applyCrewFix, crewControl } from './control';
import { addCrew } from './fixtures';
import { restCabinN } from './restPlan';
import { autoRoster, flightCrewStatus, releaseCrew, removeCrew } from './roster';
import { dutyLegality } from './rosterActions';

const save = () => deserialize(fixture('v0194-blu2266'));
const byNo = (g: GameState, no: string) => Object.values(g.flights).find((f) => f.no === no && f.kind !== 'deadhead')!;
const tripOf = (g: GameState, no: string): Pairing => g.pairings[g.duties[byNo(g, no).dutyId!].pairingId];
const roles = (p: Pairing) => p.slots.filter((s) => !s.above).map((s) => s.role);

describe('v0.19.5 an empty leg needs its pilots only (BLU2266)', () => {
  it("the player's save: BLU2266 BKK–BRU flies with three pilots; BLU2264 BRU–YYZ has its whole crew, flown to Brussels", () => {
    const g = save();
    const empty = byNo(g, 'BLU2266');
    const job = byNo(g, 'BLU2264');
    expect(empty.kind).toBe('positioning');
    const p = tripOf(g, 'BLU2266');
    expect(roles(p)).toEqual(['CPT', 'FO', 'FO']);
    expect(p.slots.every((s) => s.crewId)).toBe(true);
    expect(flightCrewStatus(g, empty.id).missing).toEqual([]);
    // No cabin rest groups on an empty leg.
    expect(restCabinN(g, g.duties[empty.dutyId!])).toBe(0);
    expect(empty.crewIds.every((id) => isPilot(g.crew[id].role))).toBe(true);
    // The charter is a trip of its own: purser and cabin crew all seated, none flown out to Bangkok.
    const q = tripOf(g, 'BLU2264');
    expect(q.id).not.toBe(p.id);
    expect(flightCrewStatus(g, job.id).missing).toEqual([]);
    const cabin = q.slots.filter((s) => s.crewId && !isPilot(s.role)).map((s) => s.crewId!);
    expect(cabin.length).toBeGreaterThanOrEqual(10);
    expect(q.slots.some((s) => s.role === 'PUR' && s.crewId)).toBe(true);
    const tickets = Object.values(g.flights).filter((f) => f.kind === 'deadhead' && f.status === 'scheduled' && f.crewIds.some((id) => cabin.includes(id)) && f.std < job.std);
    expect(tickets.some((f) => f.to === 'BRU')).toBe(true);
    expect(tickets.some((f) => f.to === 'BKK')).toBe(false);
  });

  it('an empty leg from home before the passengers keeps its cabin crew aboard, but needs only its pilots (BLU2237 LIS–MAN)', () => {
    const g = save();
    const empty = byNo(g, 'BLU2237');
    const job = byNo(g, 'BLU2235');
    // From home the trip's cabin crew ride along with it (one trip, the same crew).
    expect(empty.from).toBe('LIS');
    expect(tripOf(g, 'BLU2237').id).toBe(tripOf(g, 'BLU2235').id);
    const p = tripOf(g, 'BLU2237');
    const cc = p.slots.find((s) => s.role === 'CC' && s.crewId && !s.above)!;
    releaseCrew(g, p, cc.crewId!, 'test');
    // The open cabin seat is the passenger leg's shortage, not the empty leg's.
    expect(flightCrewStatus(g, job.id).missing).toContain('CC');
    expect(flightCrewStatus(g, empty.id).missing).toEqual([]);
    expect(dutyLegality(g, empty.id).warnings.some((w) => w.code === 'missing')).toBe(false);
    expect(dutyLegality(g, job.id).warnings.some((w) => w.code === 'missing')).toBe(true);
  });

  it('a new trip: the empty leg from away into a charter is a pilots-only trip; the cabin crew go to the charter', () => {
    const g = newGame(41);
    g.company.approvals.push('widebody', 'etops120', 'etops180', 'augmented');
    addCrew(g, { CPT: 8, FO: 10, PUR: 5, CC: 40 }, 'A330/340');
    const ac = addAircraft(g, 'a332');
    const d0 = Math.floor(g.now / DAY) * DAY;
    // Lisbon to Bangkok one way, then Brussels to Toronto four days later: an empty BKK–BRU in between.
    for (const legs of [[['LIS', 'BKK', d0 + 3 * DAY + 9 * 60]], [['BRU', 'YYZ', d0 + 7 * DAY + 11 * 60]]] as [string, string, number][][]) {
      const o = legsOffer(g, legs, 200);
      o.broker = undefined;
      const r = acceptOffer(g, o.id, [ac.id]);
      if (!r.ok) throw new Error(r.error);
    }
    autoRoster(g);
    const fl = Object.values(g.flights).filter((f) => f.aircraftId === ac.id && f.status === 'scheduled');
    const pos = fl.find((f) => f.kind === 'positioning' && f.from === 'BKK')!;
    const job = fl.find((f) => f.kind === 'revenue' && f.from === 'BRU')!;
    expect(pos).toBeDefined();
    const p = g.pairings[g.duties[pos.dutyId!].pairingId];
    const q = g.pairings[g.duties[job.dutyId!].pairingId];
    expect(p.id).not.toBe(q.id);
    expect(roles(p).every(isPilot)).toBe(true);
    expect(roles(q).filter((r) => !isPilot(r)).length).toBeGreaterThan(4);
    expect(flightCrewStatus(g, job.id).missing).toEqual([]);
    const cabin = q.slots.filter((s) => s.crewId && !isPilot(s.role)).map((s) => s.crewId!);
    const out = Object.values(g.flights).filter((f) => f.kind === 'deadhead' && f.crewIds.some((id) => cabin.includes(id)) && f.std < job.std);
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((f) => f.to === 'BRU')).toBe(true);
  });
});

describe('v0.19.5 the planner keeps multi-rated crew for their scarcer type', () => {
  it('an A320 trip takes A320-only pursers before pursers rated on the A330 too', () => {
    const g = newGame(43);
    // (The dual-rated ones first: on equal terms the roster's own order would pick them.)
    const dual = addCrew(g, { PUR: 4 }, 'A320');
    const solo = addCrew(g, { PUR: 4 }, 'A320');
    for (const id of dual) g.crew[id].ratings = ['A320', 'A330/340'];
    addCrew(g, { CPT: 6, FO: 6, CC: 16 }, 'A320');
    const ac = Object.values(g.fleet).find((a) => a.typeId.startsWith('a32'))!;
    const d0 = Math.floor(g.now / DAY) * DAY;
    const o = legsOffer(g, [['LIS', 'FAO', d0 + 3 * DAY + 9 * 60], ['FAO', 'LIS', d0 + 3 * DAY + 12 * 60]], 150);
    o.broker = undefined;
    const r = acceptOffer(g, o.id, [ac.id]);
    if (!r.ok) throw new Error(r.error);
    autoRoster(g);
    const job = Object.values(g.flights).find((f) => f.contractId === r.data!.contractId && f.kind === 'revenue')!;
    const p = g.pairings[g.duties[job.dutyId!].pairingId];
    const pur = p.slots.find((s) => s.role === 'PUR')!.crewId!;
    expect(pur).toBeTruthy();
    expect(dual).not.toContain(pur);
    expect(solo).toContain(pur);
  });
});

describe('v0.19.5 a crew shortage eight days out offers more than Cancel and Sub-charter', () => {
  it("BLU2264 without its purser: ask a purser on a day off to work it, eight days ahead", () => {
    const g = save();
    const job = byNo(g, 'BLU2264');
    expect(job.std - g.now).toBeGreaterThan(8 * DAY);
    const p = tripOf(g, 'BLU2264');
    const pur = p.slots.find((s) => s.role === 'PUR' && s.crewId)!.crewId!;
    g.company.policies.autoRoster = false;
    removeCrew(g, pur, g.now, g.now + 40 * DAY, 'test');
    expect(flightCrewStatus(g, job.id).missing).toContain('PUR');
    const v = crewControl(g, job.id, { previews: true })!;
    const avail = v.solutions.filter((s) => s.available).map((s) => s.id);
    expect(avail).toContain('buyBack');
    expect(avail.some((id) => id !== 'cancel' && id !== 'subcharter')).toBe(true);
    expect(v.card?.why).toMatch(/Crew Control/);
    const res = applyCrewFix(g, job.id, 'buyBack');
    expect(res.ok).toBe(true);
    expect(flightCrewStatus(g, job.id).missing).not.toContain('PUR');
  });
});
