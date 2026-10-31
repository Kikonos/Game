// Feasibility checks per aircraft (B1). DESIGN.md §5.1.5.

import { describe, expect, it } from 'vitest';
import { etopsNeeded, planSector, typeOf } from '../core/perf';
import { DAY } from '../core/time';
import type { CheckId, FeasibilityReport } from '.';
import { acceptOffer, feasibility, feasibilityAll } from '.';
import { A_CHECK_DAYS } from './plan';
import { TPL_BY_ID } from '../../data/worldEvents';
import { startEvent } from '../ops/world';
import { addAircraft, hamBase, leased, legsOffer, newGame, offer, owned } from './testkit';

const check = (r: FeasibilityReport, id: CheckId) => r.checks.find((c) => c.id === id)!;

describe('feasibility', () => {
  it('runs all checks and explains each in a label', () => {
    const g = newGame(21);
    const o = hamBase(g, g.now + 20 * DAY, 45);
    const r = feasibility(g, o.id, leased(g).id);
    const ids = r.checks.map((c) => c.id).sort();
    expect(ids).toEqual(['approvals', 'availability', 'crew', 'etops', 'family', 'layout', 'lease', 'maintenance', 'positioning', 'range', 'rest', 'runway', 'seats']);
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

  it('rest: long duties need the augmented approval and in-flight rest on the aircraft (v0.7.3)', () => {
    const g = newGame(30);
    // v0.12.1 an A350 Lisbon–Jakarta nonstop (a 15:45 day). The 777's Lisbon–Hong Kong now stops midway at Tashkent,
    // where a fresh crew can take over, so it no longer needs the augmented crew this test is about.
    const wb = addAircraft(g, 'a359');
    g.company.approvals.push('etops120', 'etops180');
    const o = legsOffer(g, [['LIS', 'CGK', g.now + 8 * DAY]], 250);
    const r = check(feasibility(g, o.id, wb.id), 'rest');
    expect(r.level).toBe('no');
    expect(r.label).toMatch(/augmented/);
    g.company.approvals.push('augmented');
    const ok = check(feasibility(g, o.id, wb.id), 'rest');
    expect(ok.level).toBe('ok');
    expect(ok.label).toMatch(/^Bunks → 3 pilots, \d+ h limit ✓/);
    // business seats (class 2): 15 h with 3 pilots (+1 h on one long sector), 2 + 5 seats blocked on the long leg
    wb.rest = { fc: { cls: 2, kind: 'jSeats', places: 2 }, cc: { cls: 2, kind: 'jSeats', places: 5 } };
    const j = check(feasibility(g, o.id, wb.id), 'rest');
    expect(j.label).toMatch(/^Business seats \(class 2\) → 3 pilots, 16 h limit ✓ · 7 business seats blocked on the long legs/);
    expect(check(feasibility(g, o.id, wb.id), 'restSeats').label).toMatch(/7 seats blocked/);
    // v0.7.4 nothing fitted: the business seats of its cabin are always there (class 2), the same day
    wb.rest = { fc: null, cc: null };
    expect(check(feasibility(g, o.id, wb.id), 'rest').label).toMatch(/^Business seats \(class 2\) → 3 pilots, 16 h limit ✓/);
    // all economy: curtained economy seats (class 3): a 4th pilot, or no when even that is too short; recliners as the fix
    wb.cabin = { j: 0, w: 0, y: 400, total: 400, label: '400Y', layout: 'all-economy' };
    const y = check(feasibility(g, o.id, wb.id), 'rest');
    expect(y.level).not.toBe('ok');
    expect(y.label).toMatch(/conomy seats/);
    if (y.level === 'no') expect(y.action).toEqual({ kind: 'restRefit', option: 'recliners' });
    wb.cabin = { j: 30, w: 24, y: 239, total: 293, label: '30J/24W/239Y', layout: 'three-class' };
    // ULR work needs class 1 for both pilots and cabin crew (C6)
    o.requirements.approvals.push('ulr');
    wb.rest = { fc: { cls: 1, kind: 'fcrc', places: 2 }, cc: { cls: 2, kind: 'jSeats', places: 5 } };
    const ulr = check(feasibility(g, o.id, wb.id), 'rest');
    expect(ulr.level).toBe('no');
    expect(ulr.label).toMatch(/^ULR needs bunks for pilots and cabin crew \(class 1\)/);
    wb.rest = { fc: { cls: 1, kind: 'fcrc', places: 2 }, cc: { cls: 1, kind: 'ccrc', places: 8 } };
    expect(check(feasibility(g, o.id, wb.id), 'rest').level).toBe('ok');
  });

  it('rest: the real Table 2 limit for the report time (C7)', () => {
    const g = newGame(33);
    const ac = owned(g);
    // A 06:00 LIS report (05:00 UTC in winter… the offer dates decide): 2 sectors well inside 13:00 → ok, "2 pilots".
    const o = legsOffer(g, [['LIS', 'FAO', g.now + 5 * DAY + 7 * 60], ['FAO', 'LIS', g.now + 5 * DAY + 9 * 60]], 150);
    const r = check(feasibility(g, o.id, ac.id), 'rest');
    expect(r.level).toBe('ok');
    expect(r.label).toMatch(/^Longest day \d+:\d\d of \d+:\d\d \(2 pilots\)/);
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

  it('v0.7 quick reports: same level and margin; crew sized only while nothing says no', () => {
    const g = newGame(32);
    const ac = leased(g);
    const ok = hamBase(g, g.now + 20 * DAY, 45);
    const big = legsOffer(g, [['LIS', 'FAO', g.now + 5 * DAY]], 400);
    for (const o of [ok, big]) {
      const full = feasibility(g, o.id, ac.id);
      const quick = feasibility(g, o.id, ac.id, { quick: true });
      expect(quick.level).toBe(full.level);
      expect(quick.estMargin).toBe(full.estMargin);
      if (full.level === 'no') expect(quick.crew.setsNeeded).toBe(0);
      else expect(quick.crew).toEqual(full.crew);
    }
    expect(feasibility(g, big.id, ac.id).level).toBe('no');
  });
});

describe('crew reach (v0.7 fix round 2)', () => {
  it('a short-notice job flown in from far: no crew can be there legally, so crew is no (the roster would hold it)', () => {
    // Seed 246 (v0.8 fix round 1; was 201): AOG cover at Sofia from early the same day, the aircraft at Lisbon.
    const g = newGame(246);
    const o = offer(g, 'aogCover');
    const ac = Object.keys(g.fleet)[0];
    const c = check(feasibility(g, o.id, ac), 'crew');
    expect(c.level).toBe('no');
    expect(c.label).toMatch(/^No crew can be at [A-Z]{3} for the first departure .*: the positioning crew would be on duty 13h/);
    // The same job with a day's notice: a crew flies out on an airline and rests first.
    o.start += DAY;
    if (o.pattern.kind === 'base') o.pattern.from += DAY;
    o.end += DAY;
    expect(check(feasibility(g, o.id, ac), 'crew').level).not.toBe('no');
  });
});

describe('short-notice crew reach (v0.9.1)', () => {
  it('a job in 6 hours from a far station where the aircraft already is, with no crew there: the crew line says so in plain words', () => {
    const g = newGame(32);
    const ac = leased(g);
    ac.at = 'DXB';
    const o = legsOffer(g, [['DXB', 'MCT', g.now + 6 * 60]], 150);
    const c = check(feasibility(g, o.id, ac.id), 'crew');
    expect(c.level).toBe('warn');
    expect(c.label).toMatch(/^No crew can reach Dubai before the .* report$/);
    // A crew already there (of the family) can fly it: no such line.
    const cm = Object.values(g.crew).find((x) => x.ratings.includes(typeOf(ac.typeId).family) && x.role === 'CPT')!;
    cm.loc = 'DXB';
    expect(check(feasibility(g, o.id, ac.id), 'crew').label).not.toMatch(/^No crew can reach/);
    // With three days' notice a crew flies out on an airline and rests first.
    cm.loc = g.company.homeBase;
    const later = legsOffer(g, [['DXB', 'MCT', g.now + 3 * DAY]], 150);
    expect(check(feasibility(g, later.id, ac.id), 'crew').label).not.toMatch(/^No crew can reach/);
  });
});

describe('v0.12.1 empty legs and world closures', () => {
  it("an ash closure at the aircraft's station: a job elsewhere inside it is 'no' and can't be signed; after it reopens, ok", () => {
    const g = newGame(21);
    const ac = owned(g);
    // Ash closes Lisbon (the aircraft's station) for 6 days.
    const e = startEvent(g, { ...TPL_BY_ID.ashEtna, id: 'ashTest', at: ac.at, zoneId: undefined, closeP: 0, airportDays: [6, 6], days: [6, 6] });
    expect(e.airportClosedUntil).toBe(g.now + 6 * DAY);
    const soon = legsOffer(g, [['HAM', 'PMI', g.now + DAY], ['PMI', 'HAM', g.now + DAY + 6 * 60]]);
    const r = feasibility(g, soon.id, ac.id);
    expect(r.positionIn[0]?.from).toBe(ac.at);
    const pos = r.checks.filter((c) => c.id === 'positioning');
    expect(pos.map((c) => c.level)).toEqual(['no']);
    expect(pos[0].label).toContain(`${ac.reg} can't leave`);
    expect(acceptOffer(g, soon.id, [ac.id]).ok).toBe(false);
    const later = legsOffer(g, [['HAM', 'PMI', g.now + 9 * DAY], ['PMI', 'HAM', g.now + 9 * DAY + 6 * 60]]);
    const r2 = feasibility(g, later.id, ac.id);
    expect(r2.checks.filter((c) => c.id === 'positioning').map((c) => c.level)).toEqual(['ok']);
  });
});
