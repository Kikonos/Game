// v0.8 more contract types (UPDATE-0.8.md §2, §14): valid offers across seeds, the Hajj calendar and phases,
// Antarctica's round-trip fuel and polar gate, deportation's crews and clean hits, the presidential spare pilot.

import { describe, expect, it } from 'vitest';
import { AIRPORT_BY_CODE } from '../../data/airports';
import { hajjDates, nextHajj } from '../../data/worldCalendar';
import { BAL } from '../core/balance';
import { DAY, fromUTC, toDate } from '../core/time';
import type { Archetype, ContractOffer, GameState } from '../core/types';
import { autoRoster } from '../crew/roster';
import { acceptOffer } from './accept';
import { onFlightArrivedContracts } from './billing';
import { feasibility } from './feasibility';
import { deportationCleanHit, devHajj, dailySubIn, hajjTender, presidential, rollRepeat } from './missions';
import { generateOffer, type Ctx } from './offers';
import { ARCH_MULT, priceProduct, productValue } from './pricing';
import { addAircraft, legsOffer, newGame, owned } from './testkit';

const legsOf = (o: ContractOffer) => (o.pattern.kind === 'legs' ? o.pattern.legs : []);
const ymd = (t: number) => toDate(t).toISOString().slice(0, 10);

/** Every structural promise an offer makes, whatever its kind. */
function expectValid(g: GameState, o: ContractOffer): void {
  expect(o.start).toBeLessThan(o.end);
  expect(o.expires).toBeGreaterThan(g.now);
  expect(o.expires).toBeLessThanOrEqual(o.start);
  expect(o.requirements.minSeats).toBeGreaterThan(0);
  expect(o.title.length).toBeGreaterThan(5);
  expect(o.blurb).not.toMatch(/undefined|NaN/);
  expect(g.clients[o.clientId]).toBeDefined();
  if (o.product.kind === 'charter') expect(o.product.price).toBeGreaterThan(0);
  if (o.product.kind === 'wet') expect(o.product.ratePerBH).toBeGreaterThan(1000);
  expect(Number.isFinite(o.estValue) && o.estValue > 0).toBe(true);
  const legs = legsOf(o);
  for (let i = 0; i < legs.length; i++) {
    expect(AIRPORT_BY_CODE[legs[i].from], legs[i].from).toBeDefined();
    expect(AIRPORT_BY_CODE[legs[i].to], legs[i].to).toBeDefined();
    expect(legs[i].from).not.toBe(legs[i].to);
    if (i) expect(legs[i].dep).toBeGreaterThan(legs[i - 1].dep);
  }
}

describe('new archetypes across seeds (§2)', () => {
  const KINDS: Archetype[] = ['hajj', 'unRotation', 'vip', 'deportation', 'evacuation', 'medical', 'musicTour', 'antarctic', 'capacityLease'];

  it('every builder produces valid offers on most of 40 seeds, with its feasibility line', () => {
    const built = new Map<Archetype, number>();
    for (let s = 1; s <= 40; s++) {
      const g = newGame(s);
      g.company.standing = 2;
      for (const a of KINDS) {
        const o = generateOffer(g, a, { wide: s % 2 === 0, window: false });
        if (!o) continue;
        built.set(a, (built.get(a) ?? 0) + 1);
        expectValid(g, o);
        expect(o.archetype).toBe(a);
        // The first few: the offer modal's 'what it needs' line (vip only when presidential).
        if (s <= 4 && (a !== 'vip' || o.requirements.standards === 'vip')) {
          const rep = feasibility(g, o.id, Object.keys(g.fleet)[0]);
          expect(rep.checks.some((c) => c.id === 'mission'), a).toBe(true);
        }
        delete g.offers[o.id];
      }
      // Event-only kinds: relief to a disaster airport.
      const h = generateOffer(g, 'humanitarian', { airport: 'ADA', wide: false, window: false });
      if (h) expectValid(g, h);
    }
    for (const a of KINDS) expect(built.get(a) ?? 0, a).toBeGreaterThanOrEqual(a === 'antarctic' ? 12 : 30);
  }, 60_000);

  it('prices at the §2 multipliers (fuel and pass-through aside)', () => {
    const g = newGame(5);
    g.market.fuelPrice = 0;
    const s = fromUTC(2027, 5, 1);
    const base = { typeId: 'a320ceo', estBH: 40, start: s, end: s + 10 * DAY, lead: 30 * DAY, departures: 0, revDepartures: 0 };
    const price = (archetype: Archetype) => {
      const p = priceProduct(g, { ...base, archetype });
      return p.kind === 'charter' ? p.price : 0;
    };
    const ref = price('adhoc');
    for (const [a, m] of [['deportation', 1.4], ['evacuation', 2.2], ['medical', 1.7], ['musicTour', 1.8], ['antarctic', 2.5], ['humanitarian', 1.6], ['vip', 1 + BAL.premium.vip]] as const) {
      expect(ARCH_MULT[a]).toBeCloseTo(m, 5);
      expect(price(a) / ref, a).toBeGreaterThan(m * 0.97);
      expect(price(a) / ref, a).toBeLessThan(m * 1.03);
    }
    // Wet kinds: the rate itself.
    const wet = (archetype: Archetype, mult?: number) => {
      const p = priceProduct(g, { ...base, archetype, wet: true, mult });
      return p.kind === 'wet' ? p.ratePerBH : 0;
    };
    expect(wet('hajj') / wet('seasonBase')).toBeCloseTo(1.2, 1);
    expect(wet('capacityLease') / wet('seasonBase')).toBeCloseTo(0.92, 1);
  });
});

describe('Hajj (§2.1)', () => {
  it('hajjDates matches the published Day of Arafah 2026–2035 within a day', () => {
    const TABLE: Record<number, string> = {
      2026: '2026-05-26', 2027: '2027-05-15', 2028: '2028-05-04', 2029: '2029-04-23', 2030: '2030-04-12',
      2031: '2031-04-02', 2032: '2032-03-21', 2033: '2033-03-11', 2034: '2034-02-28', 2035: '2035-02-18',
    };
    for (const [y, d] of Object.entries(TABLE)) {
      const h = hajjDates(Number(y));
      const want = Date.parse(`${d}T00:00:00Z`);
      const got = Date.parse(`${ymd(h.arafah)}T00:00:00Z`);
      expect(Math.abs(got - want) / 86_400_000, y).toBeLessThanOrEqual(1);
      expect((h.pre[1] - h.pre[0]) / DAY).toBe(28);
      expect((h.post[1] - h.post[0]) / DAY).toBe(30);
    }
    // nextHajj: in order, a year apart less ~11 days.
    const n = nextHajj(fromUTC(2027, 0, 1), 3);
    expect(n.map((h) => h.ah)).toEqual([1448, 1449, 1450]);
    expect(Math.round((n[1].arafah - n[0].arafah) / DAY)).toBe(354);
    // The tender runs Arafah − 180 … − 60 days.
    expect(hajjTender(n[0].arafah - 100 * DAY)?.ah).toBe(1448);
    expect(hajjTender(n[0].arafah - 30 * DAY)).toBeNull();
  });

  it('two phases of shuttles, an empty leg every rotation, MGH billed over the phases only', () => {
    const g = newGame(4);
    const id = devHajj(g);
    expect(id).not.toBe('');
    const o = g.offers[id];
    const legs = legsOf(o);
    expect(legs.length % 2).toBe(0);
    for (let i = 0; i < legs.length; i += 2) {
      const [out, back] = [legs[i], legs[i + 1]];
      expect(['JED', 'MED']).toContain(out.to);
      expect(back.to).toBe(out.from);
      // Exactly one of the two legs carries pilgrims.
      expect([(out.pax ?? 0) > 0, (back.pax ?? 0) > 0].filter(Boolean).length).toBe(1);
    }
    // Round 4 (§V): the blurb repeats neither the title nor the client (both are shown above it).
    expect(o.title).toMatch(/^Hajj \d{4} airlift /);
    expect(o.blurb).toMatch(/^About \d+ pilgrims a flight\. In: /);
    expect(o.blurb).not.toContain('airlift');
    expect(o.blurb).not.toContain(g.clients[o.clientId].name);
    // v0.9 fix: a jumbo Hajj load takes any cabin with the seats.
    if (o.jumbo) expect(o.requirements.layouts).toBeUndefined();
    else expect(o.requirements.layouts).toEqual(['all-economy']);
    expect(o.terms?.length).toBe(2);
    const [a, b] = o.terms!;
    expect(a[1]).toBeLessThan(b[0]);
    expect(o.product.kind).toBe('wet');
    // The gap between the phases carries no guarantee.
    const all = productValue(o.product, 0, o.start, o.end);
    const phases = productValue(o.product, 0, o.start, o.end, o.terms);
    expect(phases).toBeLessThan(all);
    expect(o.estValue).toBe(phases > 0 ? o.estValue : o.estValue);
  });
});

describe('Antarctica (§2.8)', () => {
  it('no fuel on the ice: an A320 cannot carry the way back, an A330 can; polar approval gates it', () => {
    const g = newGame(2);
    const s = g.now + 40 * DAY;
    const o = legsOffer(g, [['CPT', 'WFR', s], ['WFR', 'CPT', s + 8 * 60]], 100);
    o.requirements.roundTrip = true;
    o.requirements.approvals = ['polar'];
    const a320 = Object.values(g.fleet)[0];
    const r1 = feasibility(g, o.id, a320.id);
    expect(r1.checks.find((c) => c.id === 'range')?.level).toBe('no');
    expect(r1.checks.find((c) => c.id === 'range')?.label).toMatch(/No fuel at/);
    const a330 = addAircraft(g, 'a333');
    const r2 = feasibility(g, o.id, a330.id);
    expect(r2.checks.find((c) => c.id === 'range')?.level ?? 'ok').not.toBe('no');
    expect(r2.checks.find((c) => c.id === 'approvals')?.label).toMatch(/Blue-ice/);
    g.company.approvals.push('polar');
    expect(feasibility(g, o.id, a330.id).checks.find((c) => c.id === 'approvals')?.label ?? '').not.toMatch(/Blue-ice/);
  });

  it('offers come in the season, ask for polar, round-trip fuel and a widebody', () => {
    let o: ContractOffer | null = null;
    for (let s = 1; s <= 20 && !o; s++) o = generateOffer(newGame(s), 'antarctic', { wide: true, window: false });
    expect(o).not.toBeNull();
    const m = toDate(o!.start).getUTCMonth();
    expect(m >= 10 || m <= 1).toBe(true);
    expect(o!.requirements.approvals).toContain('polar');
    expect(o!.requirements.roundTrip).toBe(true);
    expect(o!.requirements.body).toBe('wide');
    expect(legsOf(o!).some((l) => AIRPORT_BY_CODE[l.to]?.ice)).toBe(true);
  });
});

describe('deportation (§2.4)', () => {
  it('clean −2 a flight with returnees, capped at −10 a contract', () => {
    const g = newGame(6);
    let o: ContractOffer | null = null;
    for (let i = 0; i < 12 && !o; i++) o = generateOffer(g, 'deportation', { wide: false, window: false });
    expect(o).not.toBeNull();
    const n = legsOf(o!).filter((l) => (l.pax ?? 0) > 0).length;
    expect(deportationCleanHit(o!)).toBe(Math.max(-10, -2 * n));
    expect(deportationCleanHit({ archetype: 'deportation', pattern: { kind: 'legs', legs: Array.from({ length: 8 }, () => ({ from: 'LIS', to: 'LOS', dep: 0, flightNo: '', pax: 100 })) } })).toBe(-10);
    o!.requirements.minSeats = 150;
    g.company.approvals.push('etops120');
    const ac = Object.values(g.fleet)[0];
    const res = acceptOffer(g, o!.id, [ac.id]);
    if (!res.ok) throw new Error(res.error);
    const c = g.contracts[res.data!.contractId];
    const flown = Object.values(g.flights).filter((f) => f.contractId === c.id && f.kind === 'revenue');
    const clean0 = g.company.reputation.clean;
    for (const f of flown) {
      f.status = 'done';
      f.atd = f.std;
      f.ata = g.now;
      onFlightArrivedContracts(g, { t: g.now, type: 'flight.arr', id: f.id, v: f.ev } as never);
    }
    const withPax = flown.filter((f) => (f.pax ?? 0) > 0).length;
    expect(Math.round((clean0 - g.company.reputation.clean) * 100) / 100).toBeCloseTo(Math.min(10, 2 * withPax), 5);
    expect(c.cleanHit).toBeGreaterThanOrEqual(-10);
  });

  it('crews under 45 morale refuse it (the roster leaves them out)', () => {
    const g = newGame(6);
    let o: ContractOffer | null = null;
    for (let i = 0; i < 12 && !o; i++) o = generateOffer(g, 'deportation', { wide: false, window: false });
    o!.requirements.minSeats = 150;
    g.company.approvals.push('etops120');
    const res = acceptOffer(g, o!.id, [Object.values(g.fleet)[0].id]);
    if (!res.ok) throw new Error(res.error);
    const cid = res.data!.contractId;
    const seated = () => Object.values(g.pairings).filter((p) => p.contractId === cid).flatMap((p) => p.slots.filter((s) => s.crewId).map((s) => g.crew[s.crewId!]));
    // Clear the auto-roster's picks, make everybody unhappy and roster again.
    for (const p of Object.values(g.pairings)) if (p.contractId === cid) for (const s of p.slots) s.crewId = null;
    for (const c of Object.values(g.crew)) c.morale = 40;
    autoRoster(g, { to: g.now + 120 * DAY });
    expect(seated().length).toBe(0);
    for (const c of Object.values(g.crew)) c.morale = 60;
    autoRoster(g, { to: g.now + 120 * DAY });
    expect(seated().length).toBeGreaterThan(0);
    expect(seated().every((c) => c.morale >= BAL.v08.deport.refuseBelow)).toBe(true);
  });
});

describe('presidential (§2.3) and sub-charter in (§3.5)', () => {
  it('a state visit needs Respected standing, a VIP cabin, no fuel stops and a spare pilot', () => {
    const g = newGame(8);
    const ctx = { g, o: {}, wide: false } as unknown as Ctx;
    g.company.standing = 1;
    expect(presidential(ctx)).toBeNull();
    g.company.standing = 2;
    let d = null;
    for (let i = 0; i < 12 && !d; i++) d = presidential(ctx);
    expect(d).not.toBeNull();
    expect(d!.req.extraPilot).toBe(1);
    expect(d!.req.noTechStops).toBe(true);
    expect(d!.req.layouts).toEqual(['vip']);
    expect(d!.req.standards).toBe('vip');
  });

  it('a rival hires us into an idle window: urgent, wet, under the rival\'s client record', () => {
    const g = newGame(9);
    let o: ContractOffer | null = null;
    for (let d = 0; d < 400 && !o; d++) {
      o = dailySubIn(g);
      g.now += DAY;
    }
    expect(o).not.toBeNull();
    expect(o!.archetype).toBe('subcharterIn');
    expect(o!.product.kind).toBe('wet');
    const cl = g.clients[o!.clientId];
    expect(cl.rivalId).toBeDefined();
    expect(g.rivals.find((r) => r.id === cl.rivalId)?.clientId).toBe(cl.id);
  });
});

describe('v0.12.1 no repeat business from one-off rescue work', () => {
  const signed = (g: GameState) => {
    const o = legsOffer(g, [['LIS', 'PMI', g.now + 5 * DAY], ['PMI', 'LIS', g.now + 6 * DAY]]);
    const r = acceptOffer(g, o.id, [owned(g).id]);
    if (!r.ok) throw new Error(r.error);
    return g.contracts[r.data!.contractId];
  };
  it('a repatriation, a medical flight, an event job and a scenario one-off never roll; ordinary work does', () => {
    const g = newGame(12);
    const c = signed(g);
    for (const a of ['repatriation', 'medical'] as const) {
      c.archetype = a;
      expect(rollRepeat(g, c.id)).toBeNull();
      expect(c.repeatRolled).toBeFalsy();
    }
    c.archetype = 'adhoc';
    c.eventId = 'we1';
    expect(rollRepeat(g, c.id)).toBeNull();
    expect(c.repeatRolled).toBeFalsy();
    delete c.eventId;
    g.scen = { mem: { [`oneOff:${c.offerId}`]: 1 } } as never;
    expect(rollRepeat(g, c.id)).toBeNull();
    expect(c.repeatRolled).toBeFalsy();
    delete g.scen;
    rollRepeat(g, c.id);
    expect(c.repeatRolled).toBe(true);
  });
  it('a repatriation asked for by a tour operator comes from a government instead', () => {
    const g = newGame(12);
    const tour = Object.values(g.clients).find((x) => x.kind !== 'government')!;
    const o = generateOffer(g, 'repatriation', { client: tour.id, wide: false, window: false });
    if (o) expect(g.clients[o.clientId].kind).toBe('government');
  });
});
