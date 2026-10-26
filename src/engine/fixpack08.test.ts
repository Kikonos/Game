// v0.8 fix pack unit tests: the body check (2), the refit status words (5), the Boeing 747-400 in every system (6) and
// the What's new popup (9). Seats and impossible days (1, 3) are swept in contracts/fixpack.test.ts; the jet (4) in
// crew/control.test.ts; Hire and Planning (8) in crew/sets.test.ts.

import { describe, expect, it } from 'vitest';
import { ACMI_TYPES } from '../data/acmiTypes';
import { cabinPresets } from '../data/cabins';
import { C_HUBS } from '../data/mro';
import { CURRENT, unseenEntries, WHATS_NEW } from '../data/whatsNew';
import { feasibility } from './contracts';
import { crewCanFly, generateOffer } from './contracts/offers';
import { programmeOf } from './contracts/plan';
import { isWideJob, referenceType } from './contracts/pricing';
import { addAircraft, newGame } from './contracts/testkit';
import { complement, etopsNeeded, planSector, typeOf } from './core/perf';
import { DAY, fromUTC, yearOf } from './core/time';
import type { GameState, MaintenanceEvent } from './core/types';
import { hireQuote, ratedMarket } from './crew/hr';
import { rollRestFor } from './crew/restPlan';
import { devAddType } from './dev';
import { aogChance } from './ops/maintenance';
import { cCheckOptions } from './ops/cHub';
import { aircraftGate } from './ops/company';
import { devMarketOffer, eligibleTypes } from './ops/market';
import { offerFitCard } from './problems';
import { quoteTripMove } from './ops/tripMove';
import { capFirst, hangarWord, offerCrewLine, reqChips } from '../ui/screens/screenLogic';
import { clientless, jobName } from './contracts/flavor';

/** An Established company with a widebody approval (the 747 and the 767 / A330 rung). */
const wideGame = (seed = 3): GameState => {
  const g = newGame(seed);
  g.company.approvals.push('widebody');
  return g;
};

describe('v0.8 fix pack: body check (item 2)', () => {
  it('a widebody base on an A320: a red body line, no green type line, no refit offered; a widebody passes the line', () => {
    const g = wideGame();
    const o = generateOffer(g, 'seasonBase', { wide: true, window: false, paint: false, cabin: false, start: g.now + 120 * DAY })!;
    expect(o).toBeTruthy();
    expect(o.requirements.body).toBe('wide');
    const a320 = Object.values(g.fleet)[0];
    const r = feasibility(g, o.id, a320.id);
    const body = r.checks.find((c) => c.id === 'body')!;
    expect(body).toMatchObject({ level: 'no', label: `The client wants a widebody; ${a320.reg} is an A320` });
    expect(r.checks.some((c) => c.id === 'family' && c.level === 'ok')).toBe(false);
    expect(r.checks.find((c) => c.id === 'layout')?.action).toBeUndefined();
    expect(r.level).toBe('no');
    // The aircraft can't fly it: no crew count on its row.
    expect(offerCrewLine(r, false).text).toBe('Crew not checked');
    const wb = addAircraft(g, 'a333');
    const rw = feasibility(g, o.id, wb.id);
    expect(rw.checks.find((c) => c.id === 'body')).toBeUndefined();
    expect(rw.checks.find((c) => c.id === 'family')).toMatchObject({ level: 'ok', label: 'Airbus A330-300' });
    // The card names the client once and says why in plain words, with the Market as the fix.
    const card = offerFitCard(g, o.id);
    if (card && card.why.startsWith('The client wants')) expect(card.actions[0].label).toBe('Market');
  });

  it("an aircraft that can't fly the job shows 'Crew not checked', never a crew count", () => {
    const crew = { setsNeeded: 5, setsAvailable: 10, byRole: { CPT: { need: 5, free: 10, short: 0 } }, firstShort: null };
    expect(offerCrewLine({ crew, checks: [] }, false).text).toBe('Crew OK (10/5 sets)');
    expect(offerCrewLine({ crew, checks: [{ id: 'body', level: 'no', label: 'The client wants a widebody; CS-TWJ is an A320' }] }, false).text).toBe('Crew not checked');
    expect(offerCrewLine({ crew, checks: [{ id: 'seats', level: 'no', label: '168 seats: the client needs 170 (170 passengers)' }] }, false).text).toBe('Crew not checked');
    expect(offerCrewLine({ crew: { setsNeeded: 0, setsAvailable: 0, byRole: {}, firstShort: null }, checks: [] }, false).text).toBe('Crew not checked');
    expect(offerCrewLine({ crew, checks: [{ id: 'availability', level: 'no', label: 'Busy' }] }, false).text).toBe('Crew OK (10/5 sets)');
  });

  it('referenceType and isWideJob respect the body asked for; the chip says it; trip moves refuse the wrong body', () => {
    const sectors: [string, string][] = [['LIS', 'FNC'], ['FNC', 'LIS']];
    expect(typeOf(referenceType({ minSeats: 150 }, sectors)!).body).toBe('narrow');
    expect(typeOf(referenceType({ minSeats: 150, body: 'wide' }, sectors)!).body).toBe('wide');
    expect(isWideJob({ minSeats: 150, body: 'wide' })).toBe(true);
    expect(isWideJob({ minSeats: 236 })).toBe(true);
    expect(isWideJob({ minSeats: 230 })).toBe(false);
    const req = { minSeats: 280, body: 'wide', longestSectorNm: 900, minRunwayM: 3000, etops: 0, approvals: [], extraCabin: 0 } as const;
    expect(reqChips({ ...req, approvals: [] }).map((c) => c.label)).toContain('Widebody');
    expect(reqChips({ ...req, approvals: [], body: 'narrow' }).map((c) => c.label)).toContain('Narrowbody');
    expect(typeof quoteTripMove).toBe('function');
  });

  it("job names never repeat the client: 'Winter sun to Corfu for Corendon', \"Azul Brazilian Airlines' São Paulo base\"", () => {
    expect(jobName('Corendon', 'Winter sun to Corfu for Corendon')).toBe('Winter sun to Corfu for Corendon');
    expect(jobName('Azul Brazilian Airlines', 'São Paulo wet lease for Azul Brazilian Airlines')).toBe('São Paulo wet lease for Azul Brazilian Airlines');
    // v0.9 (§V.2): the client first, once.
    expect(jobName('Azul Brazilian Airlines', 'São Paulo base')).toBe('Azul Brazilian Airlines · São Paulo base');
    expect(jobName('Portuguese Ministry of National Defence', 'Troop rotation to Bangui')).toBe('Portuguese Ministry of National Defence · Troop rotation to Bangui');
    // Titles never carry the client.
    expect(clientless('Winter sun to Corfu for Corendon', 'Corendon Airlines')).toBe('Winter sun to Corfu');
    expect(clientless("TUI's summer wet lease, Lisbon", 'TUI Deutschland')).toBe('Summer wet lease, Lisbon');
    expect(clientless('TUI summer programme Lisbon–Faro', 'TUI Deutschland')).toBe('Summer programme Lisbon–Faro');
    expect(clientless('Troop rotation to Bangui', 'Portuguese Ministry of National Defence')).toBe('Troop rotation to Bangui');
  });
});

describe("v0.8 fix pack: 'in refit', not 'in check' (item 5)", () => {
  const ev = (kind: MaintenanceEvent['kind']) => ({ maintenance: { m1: { kind } as MaintenanceEvent } });
  it('the hangar word follows the work: refit, paint shop, lease return, repair, else check', () => {
    expect(hangarWord(ev('refit'), { id: 'a', maintId: 'm1' })).toBe('in refit');
    expect(capFirst(hangarWord(ev('refit'), { id: 'a', maintId: 'm1' }))).toBe('In refit');
    expect(hangarWord(ev('paint'), { id: 'a', maintId: 'm1' })).toBe('in the paint shop');
    expect(hangarWord(ev('return'), { id: 'a', maintId: 'm1' })).toBe('lease return');
    expect(hangarWord(ev('AOG'), { id: 'a', maintId: 'm1' })).toBe('in repair');
    expect(hangarWord(ev('C'), { id: 'a', maintId: 'm1' })).toBe('in check');
    expect(hangarWord({ maintenance: {} }, { id: 'a', maintId: null })).toBe('in check');
  });
});

describe('v0.8 fix pack: the Boeing 747-400 is back (item 6)', () => {
  const T = ACMI_TYPES.b744;
  it('real data: about 7,000 nm, 500Y Hajj cabin, four engines without ETOPS limits, built until 2009, thirsty, 2 pursers, AOG-prone', () => {
    expect(T.available).toBe(true);
    expect(T.rangeNm).toBeGreaterThanOrEqual(6800);
    expect(T.rangeNm).toBeLessThanOrEqual(7300);
    expect(T.cabins.map((c) => c.label)).toEqual(['24J/426Y', '500Y']);
    expect(T.engines).toBe(4);
    expect(etopsNeeded('b744', 'LIS', 'GRU')).toBe(0);
    expect(T.lastYear).toBe(2009);
    expect(T.fuelTBH).toBeGreaterThan(ACMI_TYPES.b77w.fuelTBH);
    expect(T.rentMonth).toBeLessThan(ACMI_TYPES.a333.rentMonth);
    expect(complement('b744', 500).filter((r) => r === 'PUR')).toHaveLength(2);
    expect(cabinPresets('b744').some((c) => c.layout === 'vip')).toBe(true);
    // Lisbon–São Paulo (4,300 nm) nonstop, Lisbon–Singapore (6,400 nm) too.
    expect(planSector('b744', 'LIS', 'GRU').techStops).toEqual([]);
    expect(planSector('b744', 'LIS', 'SIN').techStops).toEqual([]);
  });

  it('market: offered once Widebody operations is held or pending, old frames (1996–2008) at a cheap lease, handed over at an ex-operator hub or a lessor site', () => {
    const g = newGame(5);
    expect(eligibleTypes(g).find((x) => x.t.id === 'b744')?.teaser ?? true).toBe(true);
    g.company.approvals.push('widebody');
    const e = eligibleTypes(g).find((x) => x.t.id === 'b744')!;
    expect(e.teaser).toBe(false);
    expect(e.w).toBeGreaterThan(0);
    expect(aircraftGate(g, 'b744').ok).toBe(true);
    for (let i = 0; i < 12; i++) {
      const id = devMarketOffer(g, 'b744', { kind: i % 3 ? 'dryLeaseIn' : 'buy' });
      const o = g.market.aircraft.find((x) => x.id === id)!;
      expect(o.typeId).toBe('b744');
      expect(o.builtYear).toBeGreaterThanOrEqual(1996);
      expect(o.builtYear).toBeLessThanOrEqual(2009);
      if (o.kind === 'dryLeaseIn') expect(o.rentPerMonth).toBeLessThan(T.rentMonth);
      else expect(o.price).toBeLessThan(T.valueUsed);
      // v0.7.4: bunks always as a pair (pilots and cabin crew together, or neither).
      expect(!!o.rest?.fc === !!o.rest?.cc).toBe(true);
      expect(yearOf(g.now) - o.builtYear).toBeGreaterThanOrEqual(18);
    }
    // Over many airframes about 90 % have bunks, always paired.
    let bunks = 0;
    for (let i = 0; i < 300; i++) {
      const r = rollRestFor(`x${i}`, 'b744', 24);
      expect(!!r.fc === !!r.cc).toBe(true);
      if (r.fc?.cls === 1) bunks++;
    }
    expect(bunks / 300).toBeGreaterThan(0.8);
  });

  it('crew and maintenance: B747 pilots hired from the rated pool, C-check at Turkish Technic Istanbul, higher AOG odds than a 767 of the same age', () => {
    const g = wideGame(6);
    expect(ratedMarket(g, 'B747', 'CPT')).toBeTruthy();
    expect(hireQuote(g, { role: 'CPT', family: 'B747', base: 'LIS', count: 2 }).cost).toBeGreaterThan(0);
    expect(C_HUBS.B747.map((h) => h.code)).toEqual(['IST']);
    const id = devAddType(g, 'b744', 1);
    const ac = g.fleet[id];
    expect(ac.cabin.label).toBe('500Y');
    expect(Object.values(g.crew).filter((c) => c.ratings.includes('B747')).length).toBeGreaterThan(20);
    expect(cCheckOptions(g, id).map((o) => o.hub.code)).toEqual(['IST']);
    const b763 = addAircraft(g, 'b763');
    b763.builtYear = ac.builtYear;
    b763.maint.deferred = ac.maint.deferred;
    expect(aogChance(g, ac, 'LIS')).toBeGreaterThan(aogChance(g, b763, 'LIS'));
  });

  it('offers and pricing: a 500-seat Hajj prices on the 747 and it flies it; troop and UN work fits it; a long day on it stays legal', () => {
    const g = wideGame(4);
    g.company.standing = 1;
    g.company.approvals.push('augmented');
    expect(referenceType({ minSeats: 500, layouts: ['all-economy'] }, [['CGK', 'JED'], ['JED', 'CGK']])).toBe('b744');
    expect(referenceType({ minSeats: 460 }, [['LIS', 'GRU']])).toBe('b744');
    const id = devAddType(g, 'b744', 1);
    // A 500-pilgrim Hajj airlift (the tender window simulated).
    let hajj = null;
    const save = g.now;
    for (let i = 0; i < 300 && !hajj; i++) {
      g.now = fromUTC(2028, 1, 10) + (i % 60) * DAY;
      g.rng = (i * 7919 + 13) >>> 0;
      const o = generateOffer(g, 'hajj', { wide: true, window: false, paint: false, cabin: false });
      if (o && o.requirements.minSeats === 500) hajj = o;
      else if (o) delete g.offers[o.id];
    }
    g.now = save;
    expect(hajj).toBeTruthy();
    if (hajj) {
      const r = feasibility(g, hajj.id, id);
      expect(r.checks.find((c) => c.id === 'seats')?.level).toBe('ok');
      expect(r.checks.find((c) => c.id === 'etops')?.label).toBe('Four engines: no ETOPS limits');
      const sectors = hajj.pattern.kind === 'legs' ? hajj.pattern.legs.map((l) => [l.from, l.to] as [string, string]) : [];
      const ref = referenceType(hajj.requirements, sectors)!;
      expect(ref).toBe('b744');
      expect(crewCanFly(g, ref, programmeOf(hajj, ref).chains)).toBe(true);
    }
    // A troop rotation for 270 fits its seats.
    const troop = generateOffer(g, 'troopRotation', { wide: true, window: false, paint: false, cabin: false });
    expect(troop).toBeTruthy();
    expect(feasibility(g, troop!.id, id).checks.find((c) => c.id === 'seats')?.level).toBe('ok');
  });

  it('rivals fly it (Air Atlanta Icelandic); the dev scene adds one with its crew', () => {
    const g = newGame(2);
    expect(g.rivals.some((r) => r.fleet.some((f) => f.typeId === 'b744' && f.count > 0))).toBe(true);
    expect(devAddType(g, 'b744')).not.toBe('');
  });
});

describe("v0.8 fix pack: What's new after an update (item 9)", () => {
  it('a player jumping from v0.7.3 sees v0.8 and v0.7.4, newest first; up to date sees none; a new player the newest', () => {
    expect(unseenEntries('v0.7.3').map((e) => e.version)).toEqual(['v0.10.1', 'v0.10', 'v0.9.1', 'v0.9', 'v0.8', 'v0.7.4']);
    expect(unseenEntries('v0.7.4').map((e) => e.version)).toEqual(['v0.10.1', 'v0.10', 'v0.9.1', 'v0.9', 'v0.8']);
    // v0.10: a v0.9 player sees the tuning and the fleet art notes.
    expect(unseenEntries('v0.9').map((e) => e.version)).toEqual(['v0.10.1', 'v0.10', 'v0.9.1']);
    expect(unseenEntries(CURRENT.version)).toEqual([]);
    expect(unseenEntries('')).toEqual([CURRENT]);
    expect(unseenEntries('v0.7.2.1').map((e) => e.version)).toEqual(['v0.10.1', 'v0.10', 'v0.9.1', 'v0.9', 'v0.8', 'v0.7.4', 'v0.7.3', 'v0.7.2.2']);
    expect(WHATS_NEW[0]).toBe(CURRENT);
  });
  it("the v0.8 entry has a short Fixes part in plain words, the 747-400 among them", () => {
    const f = WHATS_NEW.find((e) => e.version === 'v0.8')!.fixes ?? [];
    expect(f.length).toBeGreaterThanOrEqual(5);
    expect(f.length).toBeLessThanOrEqual(8);
    expect(f.join(' ')).toMatch(/747-400/);
    expect(f.join(' ')).toMatch(/in refit/);
    for (const x of f) expect(x.length).toBeLessThan(140);
  });
});
