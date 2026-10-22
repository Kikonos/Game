// v0.7.4 Crew planning: crew sets per type family, the limiting role, seniors in junior seats, joiners, shared
// multi-type cabin crew counted once, and the round-up hire that completes the sets.

import { describe, expect, it } from 'vitest';
import { acceptOffer } from '../contracts';
import { devDryLease, devMixedCrew } from '../contracts/missions';
import { addAircraft, newGame, run } from '../contracts/testkit';
import { DAY } from '../core/time';
import type { GameState } from '../core/types';
import { addCrew } from './fixtures';
import { hireBatch, hireQuote } from './hr';
import { awayOnDryLease, completeSets, crewPlan, missingFor, roundTargets, roundUpQuote, roundUpRoles, setWords } from './sets';

/** Two A320s (180Y: 1 CPT + 1 FO + 1 PUR + 3 CC), no crew. */
const twoA320 = (): GameState => {
  const g = newGame(11);
  for (const id of Object.keys(g.crew)) delete g.crew[id];
  for (const ac of Object.values(g.fleet)) ac.cabin = { j: 0, w: 0, y: 180, total: 180, label: '180Y', layout: 'all-economy' };
  g.company.policies.extraCabin = 0;
  return g;
};
const a320 = (g: GameState) => crewPlan(g).find((p) => p.family === 'A320')!;

describe('set maths (pure)', () => {
  const set = { CPT: 1, FO: 1, PUR: 1, CC: 3 };
  it('complete sets: the scarcest role decides; pursers fill cabin crew seats, first officers relief pilot seats', () => {
    expect(completeSets(set, { CPT: 10, FO: 9, PUR: 10, CC: 30 })).toBe(9);
    expect(completeSets(set, { CPT: 10, FO: 10, PUR: 10, CC: 28 })).toBe(9);
    expect(completeSets(set, { CPT: 10, FO: 10, PUR: 12, CC: 28 })).toBe(10);
    expect(completeSets({ ...set, CRP: 1 }, { CPT: 5, FO: 10, PUR: 5, CC: 15 })).toBe(5);
    expect(completeSets(set, {})).toBe(0);
    expect(completeSets({}, { CPT: 3 })).toBe(0);
  });
  it('missing for a target: exactly the roles short, after the seniors spill down', () => {
    expect(missingFor(set, { CPT: 10, FO: 9, PUR: 10, CC: 28 }, 10).filter((m) => m.count)).toEqual([{ role: 'FO', count: 1 }, { role: 'CC', count: 2 }]);
    expect(missingFor(set, { CPT: 10, FO: 10, PUR: 11, CC: 28 }, 10).filter((m) => m.count)).toEqual([{ role: 'CC', count: 1 }]);
    // a mixed family: fractional crews per set round up per role
    expect(missingFor({ CPT: 1, FO: 1, PUR: 1, CC: 3.5 }, { CPT: 4, FO: 4, PUR: 4, CC: 10 }, 4).filter((m) => m.count)).toEqual([{ role: 'CC', count: 4 }]);
    expect(setWords(set)).toBe('1 CPT + 1 FO + 1 PUR + 3 CC');
  });
});

describe('crewPlan', () => {
  it('an A320 fleet: 2 aircraft × 5 sets = 10 needed; the verdict names the short roles; joiners count only "with joiners"', () => {
    const g = twoA320();
    const ids = addCrew(g, { CPT: 10, FO: 9, PUR: 10, CC: 28 });
    const p = a320(g);
    expect(p).toMatchObject({ aircraft: 2, setsPerAircraft: 5, setsNeeded: 10, setsComplete: 9, setsNow: 9, limiting: 'FO' });
    expect(p.types).toEqual([{ typeId: 'a320ceo', short: 'A320', aircraft: 2, set: { CPT: 1, FO: 1, PUR: 1, CC: 3 } }]);
    expect(p.verdict).toBe('A320 family: 2 aircraft · 5 sets each = 10 sets needed · you have 9 complete · short 1 FO, 2 CC');
    expect(p.roles.map((r) => [r.role, r.have, r.need, r.balance])).toEqual([['CPT', 10, 10, 0], ['FO', 9, 10, -1], ['PUR', 10, 10, 0], ['CC', 28, 30, -2]]);
    // a first officer still joining: complete with the joiners, one fewer working now
    g.crew[ids[10]].status = 'joining';
    const q = a320(g);
    expect(q.setsComplete).toBe(9);
    expect(q.setsNow).toBe(8);
    expect(q.roles.find((r) => r.role === 'FO')!.joining).toBe(1);
    // sick and on leave: still on the books (counted as have and as off now)
    g.crew[ids[1]].status = 'sick';
    expect(a320(g).roles.find((r) => r.role === 'CPT')!.away).toBe(1);
    // crew on notice are not counted
    g.crew[ids[2]].notice = { given: g.now, leaves: g.now + 30 * 1440, why: 'test' } as never;
    expect(a320(g).roles.find((r) => r.role === 'CPT')!.have).toBe(9);
  });

  it('round up: complete the 10 needed, or the next whole set count; the quote prices exactly those hires', () => {
    const g = twoA320();
    addCrew(g, { CPT: 10, FO: 9, PUR: 10, CC: 28 });
    const p = a320(g);
    expect(roundTargets(p)).toEqual({ complete: 10, next: 11 });
    expect(roundUpRoles(p, 10)).toEqual([{ role: 'FO', count: 1 }, { role: 'CC', count: 2 }]);
    expect(roundUpRoles(p, 11)).toEqual([{ role: 'CPT', count: 1 }, { role: 'FO', count: 2 }, { role: 'PUR', count: 1 }, { role: 'CC', count: 5 }]);
    const q = roundUpQuote(g, p, 10);
    expect(q.lines.map((l) => [l.req.role, l.req.count, l.req.families ?? null])).toEqual([['FO', 1, null], ['CC', 2, ['A320']]]);
    expect(q.cost).toBe(hireQuote(g, q.lines[0].req).cost + hireQuote(g, q.lines[1].req).cost);
    expect(q.payroll).toBeGreaterThan(0);
    // one confirm hires exactly those; the plan is complete with the joiners
    const r = hireBatch(g, q.lines.map((l) => l.req));
    if (!r.ok) throw new Error(r.error);
    expect(r.data!.crewIds.length).toBe(3);
    const after = a320(g);
    expect(after.setsComplete).toBe(10);
    expect(after.setsNow).toBe(9);
    expect(roundTargets(after).complete).toBeNull();
    expect(after.verdict).toBe('A320 family: 2 aircraft · 5 sets each = 10 sets needed · you have 10 complete');
    // all or nothing on cash
    g.company.cash = 0;
    expect(hireBatch(g, roundUpQuote(g, after, 11).lines.map((l) => l.req)).ok).toBe(false);
  });

  it('cabin crew on two fleet types are counted once, where the shortfall is larger, and shown as shared', () => {
    const g = twoA320();
    addCrew(g, { CPT: 10, FO: 10, PUR: 10, CC: 30 });
    addAircraft(g, 'a332');
    addCrew(g, { CPT: 5, FO: 5, PUR: 5, CC: 20 }, 'A330/340');
    // four cabin crew on both types: the A330 is short (25 needed), so they count there, once
    const both = addCrew(g, { CC: 4 }, 'A330/340');
    for (const id of both) g.crew[id].ratings = ['A330/340', 'A320'];
    const plans = crewPlan(g);
    const wide = plans.find((p) => p.family === 'A330/340')!;
    const nb = plans.find((p) => p.family === 'A320')!;
    expect(wide.roles.find((r) => r.role === 'CC')).toMatchObject({ have: 24, need: 25, shared: 4 });
    expect(nb.roles.find((r) => r.role === 'CC')).toMatchObject({ have: 30, shared: 0 });
    const total = plans.reduce((s, p) => s + (p.roles.find((r) => r.role === 'CC')?.have ?? 0), 0);
    expect(total).toBe(54);
    // the widebody set: its cabin crew follow its seats
    expect(wide.types[0].set.CC! + wide.types[0].set.PUR!).toBeGreaterThanOrEqual(6);
  });
});

// v0.8: sets count only our own crew (UPDATE-0.8.md §6, §7).
describe('crew sets with v0.8 work', () => {
  it("a mixed-crew contract: the client's cabin crew fly their seats for the share of the next 60 days it covers", () => {
    const g = twoA320();
    addCrew(g, { CPT: 10, FO: 10, PUR: 10, CC: 30 });
    const before = a320(g);
    expect(before).toMatchObject({ clientCabin: 0, dryLeased: 0 });
    expect(before.roles.find((r) => r.role === 'CC')!.need).toBe(30);
    expect(devMixedCrew(g)).not.toBe('');
    const k = Object.values(g.contracts).find((x) => x.requirements.clientCabin)!;
    const cc = k.requirements.clientCabin!;
    expect(cc).toMatchObject({ n: 3, of: 4, leads: false });
    const share = (Math.min(k.end, g.now + 60 * DAY) - Math.max(k.start, g.now)) / (60 * DAY);
    const p = a320(g);
    // 3 of the aircraft's 3 cabin crew seats are theirs while it runs; pilots and our purser stay ours.
    expect(p.roles.find((r) => r.role === 'CC')!.need).toBe(Math.ceil(30 - 3 * 5 * share - 1e-9));
    expect(p.roles.find((r) => r.role === 'PUR')!.need).toBe(10);
    expect(p.roles.find((r) => r.role === 'CPT')!.need).toBe(10);
    expect(p.clientCabin).toBe(Math.round(3 * 5 * share));
    expect(p.setsNeeded).toBe(10);
    // their senior leading: the purser seat is theirs too
    k.requirements.clientCabin = { ...cc, n: 4, leads: true };
    const q = a320(g);
    expect(q.roles.find((r) => r.role === 'PUR')!.need).toBe(Math.ceil(10 - 5 * share - 1e-9));
    // after the contract: full sets again
    run(g, k.end + DAY);
    expect(a320(g).roles.find((r) => r.role === 'CC')!.need).toBe(30);
  }, 120_000);

  it('an aircraft away on a dry lease needs no sets while the lessee has it', () => {
    const g = twoA320();
    addCrew(g, { CPT: 10, FO: 10, PUR: 10, CC: 30 });
    const id = devDryLease(g);
    expect(id).not.toBe('');
    const o = g.offers[id];
    const acId = o.dryFor ?? Object.keys(g.fleet)[0];
    const r = acceptOffer(g, id, [acId]);
    if (!r.ok) throw new Error(r.error);
    const k = g.contracts[r.data!.contractId];
    // signed, not yet gone: still ours to crew
    expect(awayOnDryLease(g, g.fleet[acId])).toBe(false);
    expect(a320(g)).toMatchObject({ aircraft: 2, setsNeeded: 10, dryLeased: 0 });
    // delivered: the lessee's crews fly it
    run(g, k.start + DAY);
    expect(k.dry?.leasedAt).toBeDefined();
    expect(g.fleet[acId].status).toBe('leasedOut');
    expect(a320(g)).toMatchObject({ aircraft: 1, setsNeeded: 5, dryLeased: 1 });
    expect(a320(g).roles.find((r) => r.role === 'CC')!.need).toBe(15);
  }, 120_000);
});
