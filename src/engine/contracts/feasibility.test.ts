// Feasibility checks per aircraft (B1). DESIGN.md §5.1.5.

import { describe, expect, it } from 'vitest';
import { etopsNeeded, planSector, typeOf } from '../core/perf';
import { DAY } from '../core/time';
import type { CheckId, FeasibilityReport } from '.';
import { acceptOffer, feasibility, feasibilityAll } from '.';
import { A_CHECK_DAYS } from './plan';
import { addAircraft, hamBase, leased, legsOffer, newGame, offer, owned } from './testkit';

const check = (r: FeasibilityReport, id: CheckId) => r.checks.find((c) => c.id === id)!;

describe('feasibility', () => {
  it('runs all checks and explains each in a label', () => {
    const g = newGame(21);
    const o = hamBase(g, g.now + 20 * DAY, 45);
    const r = feasibility(g, o.id, leased(g).id);
    const ids = r.checks.map((c) => c.id).sort();
    expect(ids).toEqual(['approvals', 'availability', 'crew', 'etops', 'family', 'layout', 'lease', 'maintenance', 'positioning', 'range', 'runway', 'seats']);
    for (const c of r.checks) expect(c.label.length).toBeGreaterThan(5);
    expect(r.level).not.toBe('no');
    expect(r.positionIn[0]).toMatchObject({ from: 'LIS', to: 'HAM' });
    expect(r.estRevenue).toBeGreaterThan(0);
    expect(r.estMargin).toBe(r.estRevenue - r.estCost);
  });

  it('seats, layout and family', () => {
    const g = newGame(22);
    const ac = owned(g);
    const o = legsOffer(g, [['LIS', 'FAO', g.now + 5 * DAY]], 200);
    expect(check(feasibility(g, o.id, ac.id), 'seats').level).toBe('no');
    o.requirements.minSeats = 150;
    o.requirements.layout = 'two-class';
    expect(check(feasibility(g, o.id, ac.id), 'layout').level).toBe('no');
    o.requirements.layout = undefined;
    o.requirements.families = ['B737'];
    const fam = check(feasibility(g, o.id, ac.id), 'family');
    expect(fam.level).toBe('no');
    expect(fam.label).toMatch(/B737/);
  });

  it('range: direct, fuel stop (warn), none allowed (no), beyond reach (no)', () => {
    const g = newGame(23);
    const ac = owned(g);
    expect(check(feasibility(g, legsOffer(g, [['LIS', 'FAO', g.now + 5 * DAY]]).id, ac.id), 'range').level).toBe('ok');
    const kbl = legsOffer(g, [['KBL', 'LIS', g.now + 5 * DAY]]);
    const r = feasibility(g, kbl.id, ac.id);
    expect(check(r, 'range').level).toBe('warn');
    expect(check(r, 'range').label).toMatch(/Fuel stop at/);
    expect(r.techStops.length).toBe(1);
    kbl.requirements.noTechStops = true;
    expect(check(feasibility(g, kbl.id, ac.id), 'range').level).toBe('no');
    const syd = legsOffer(g, [['LIS', 'SYD', g.now + 5 * DAY]]);
    const far = check(feasibility(g, syd.id, ac.id), 'range');
    expect(far.level).toBe('no');
    expect(far.label).toMatch(/beyond/);
  });

  it('runway: a 777 is prohibited at Dili, a 767 payload-limited', () => {
    const g = newGame(24);
    const b772 = addAircraft(g, 'b772');
    const b763 = addAircraft(g, 'b763');
    const o = legsOffer(g, [['DIL', 'LIS', g.now + 6 * DAY]], 200);
    const r7 = feasibility(g, o.id, b772.id);
    expect(check(r7, 'runway').level).toBe('no');
    expect(check(r7, 'runway').label).toMatch(/DIL runway 1850 m/);
    expect(r7.level).toBe('no');
    expect(check(feasibility(g, o.id, b763.id), 'runway').level).toBe('warn');
  });

  it('ETOPS: needs the approval and the type certification', () => {
    const g = newGame(25);
    const wb = addAircraft(g, 'b763');
    const o = legsOffer(g, [['LIS', 'JFK', g.now + 6 * DAY]], 200);
    const need = Math.max(...planSector('b763', 'LIS', 'JFK').legs.map((l) => etopsNeeded('b763', l.from, l.to)));
    expect(need).toBeGreaterThan(0);
    const without = check(feasibility(g, o.id, wb.id), 'etops');
    expect(without.level).toBe('no');
    expect(without.label).toMatch(/ETOPS/);
    g.company.approvals.push('etops120', 'etops180');
    expect(check(feasibility(g, o.id, wb.id), 'etops').level).toBe(need <= 180 ? 'ok' : 'no');
    // The A320 is certified to 120 at most.
    expect(['no', 'ok']).toContain(check(feasibility(g, o.id, owned(g).id), 'etops').level);
  });

  it('a conflict on the same aircraft is a no, with the conflicting flights listed', () => {
    const g = newGame(26);
    const ac = owned(g);
    const a = legsOffer(g, [['LIS', 'PMI', g.now + 5 * DAY], ['PMI', 'LIS', g.now + 5 * DAY + 6 * 60]]);
    expect(acceptOffer(g, a.id, [ac.id]).ok).toBe(true);
    const b = legsOffer(g, [['LIS', 'FAO', g.now + 5 * DAY + 2 * 60]]);
    const r = feasibility(g, b.id, ac.id);
    expect(check(r, 'availability').level).toBe('no');
    expect(check(r, 'availability').label).toMatch(/^Busy/);
    expect(r.conflicts.flights.length).toBeGreaterThan(0);
    expect(acceptOffer(g, b.id, [ac.id]).ok).toBe(false);
    // The other aircraft is free.
    expect(feasibility(g, b.id, leased(g).id).level).not.toBe('no');
    expect(feasibilityAll(g, b.id)[0].aircraftId).toBe(leased(g).id);
  });

  it('positioning: A320 LIS→KBL with one fuel stop in time; too late is a no', () => {
    const g = newGame(27);
    const ac = owned(g);
    const ok = legsOffer(g, [['KBL', 'LIS', g.now + 40 * 60]]);
    const r = feasibility(g, ok.id, ac.id);
    expect(r.positionIn).toHaveLength(2);
    expect(r.positionIn[0].from).toBe('LIS');
    expect(r.positionIn[1].to).toBe('KBL');
    expect(r.positionIn[1].sta + typeOf(ac.typeId).turnMin).toBeLessThanOrEqual(g.now + 40 * 60);
    expect(check(r, 'positioning').level).toBe('ok');
    expect(check(r, 'positioning').label).toMatch(/LIS→\w{3}→KBL/);
    const late = legsOffer(g, [['KBL', 'LIS', g.now + 6 * 60]]);
    const r2 = feasibility(g, late.id, ac.id);
    expect(check(r2, 'positioning').level).toBe('no');
    expect(check(r2, 'positioning').label).toMatch(/Can't get there in time/);
  });

  it('maintenance: C-check inside the job is a no; an A-check fits a maintenance night on a base', () => {
    const g = newGame(28);
    const ac = owned(g);
    const o = hamBase(g, g.now + 20 * DAY, 60);
    ac.maint.lastA = g.now - (A_CHECK_DAYS - 40) * DAY;
    const r = check(feasibility(g, o.id, ac.id), 'maintenance');
    expect(r.level).toBe('ok');
    expect(r.label).toMatch(/maintenance night at HAM/);
    // A legs job spanning the due date with no gap: warn.
    const l = legsOffer(g, [['LIS', 'KBL', g.now + 39 * DAY], ['KBL', 'LIS', g.now + 40.5 * DAY]]);
    ac.maint.lastA = g.now - (A_CHECK_DAYS - 40) * DAY;
    expect(check(feasibility(g, l.id, ac.id), 'maintenance').level).toBe('warn');
    const t = typeOf(ac.typeId);
    ac.maint.lastC = g.now - Math.round(t.cCheckMonths * 30.44 - 30) * DAY;
    const c = check(feasibility(g, o.id, ac.id), 'maintenance');
    expect(c.level).toBe('no');
    expect(c.label).toMatch(/C-check/);
  });

  it('lease ending before the job is a no', () => {
    const g = newGame(29);
    const ac = leased(g);
    if (ac.ownership.kind !== 'dryLeaseIn') throw new Error('fixture');
    ac.ownership.leaseEnd = g.now + 30 * DAY;
    const o = hamBase(g, g.now + 20 * DAY, 45);
    expect(check(feasibility(g, o.id, ac.id), 'lease').level).toBe('no');
  });

  it('crew: long duties need the augmented approval', () => {
    const g = newGame(30);
    const wb = addAircraft(g, 'b772');
    g.company.approvals.push('etops120', 'etops180');
    const o = legsOffer(g, [['LIS', 'HKG', g.now + 8 * DAY]], 250);
    const r = check(feasibility(g, o.id, wb.id), 'crew');
    expect(r.level).toBe('no');
    expect(r.label).toMatch(/augmented/);
    g.company.approvals.push('augmented');
    expect(check(feasibility(g, o.id, wb.id), 'crew').level).not.toBe('no');
  });

  it('reports are pure and feasibilityAll is best first', () => {
    const g = newGame(31);
    const o = offer(g, 'adhoc');
    const before = JSON.stringify(g);
    const all = feasibilityAll(g, o.id);
    expect(JSON.stringify(g)).toBe(before);
    const rank = { ok: 0, warn: 1, no: 2 };
    for (let i = 1; i < all.length; i++) expect(rank[all[i].level]).toBeGreaterThanOrEqual(rank[all[i - 1].level]);
  });
});
