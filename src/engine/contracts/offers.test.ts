// Offer generation, pricing bands and the offer lifecycle (B1).

import { describe, expect, it } from 'vitest';
import { ACMI_TYPES } from '../../data/acmiTypes';
import { AIRPORT_BY_CODE } from '../../data/airports';
import { BAL } from '../core/balance';
import { takePause } from '../core/pause';
import { planSector, TECH_STOP_MIN, typeOf } from '../core/perf';
import { DAY, START, fromUTC, localMinuteOfDay, toDate } from '../core/time';
import type { Archetype, ContractOffer, GameState } from '../core/types';
import { acceptOffer, counterOffer, declineOffer, feasibilityAll, generateOffer, priceProduct, productValue, rateMultiplier } from '.';
import { onOfferExpire, onOfferReply } from './offers';
import { computeWaves, programmeOf } from './plan';
import { referenceType } from './pricing';
import { newGame, offer, run } from './testkit';

const ARCHETYPES: Archetype[] = ['seasonBase', 'aogCover', 'adhoc', 'sports', 'repatriation', 'tourSeries', 'troopRotation'];

function checkValid(g: GameState, o: ContractOffer) {
  const p = o.pattern;
  expect(o.start).toBeLessThan(o.end);
  expect(o.created).toBe(g.now);
  expect(o.expires).toBeGreaterThan(o.created);
  expect(o.expires).toBeLessThanOrEqual(o.start);
  if (o.urgency !== 'urgent') expect(o.expires - o.created).toBeGreaterThanOrEqual(2 * DAY);
  expect(g.clients[o.clientId]).toBeTruthy();
  expect(AIRPORT_BY_CODE[o.pin]).toBeTruthy();
  expect(o.estBH).toBeGreaterThan(0);
  expect(o.estValue).toBeGreaterThan(0);
  expect(o.floor).toBeGreaterThanOrEqual(BAL.counterFloor[0]);
  expect(o.floor).toBeLessThanOrEqual(BAL.counterFloor[1]);
  expect(o.requirements.longestSectorNm).toBeGreaterThan(0);
  expect(o.requirements.minRunwayM).toBeGreaterThan(0);
  expect(o.title.length).toBeGreaterThan(5);
  expect(o.blurb).not.toMatch(/undefined|NaN/);
  const sectors: [string, string][] = p.kind === 'base' ? p.dests.flatMap((d) => [[p.base, d], [d, p.base]] as [string, string][]) : p.legs.map((l) => [l.from, l.to]);
  for (const [a, b] of sectors) {
    expect(AIRPORT_BY_CODE[a], a).toBeTruthy();
    expect(AIRPORT_BY_CODE[b], b).toBeTruthy();
    expect(a).not.toBe(b);
  }
  // Flyable on the reference type: within range or split by fuel stops; turn minima hold after planning.
  const ref = referenceType(o.requirements, sectors, p.kind === 'base')!;
  expect(ref).toBeTruthy();
  for (const [a, b] of sectors) expect(planSector(ref, a, b).ok).toBe(true);
  const prog = programmeOf(o, ref);
  expect(prog.ok).toBe(true);
  const turn = typeOf(ref).turnMin;
  for (const t of prog.trips) for (let i = 1; i < t.legs.length; i++) {
    expect(t.legs[i].from).toBe(t.legs[i - 1].to);
    // Fuel stops (on a revenue sector or inside an empty chain) use the shorter tech-stop ground time.
    const stop = t.legs[i].kind === 'techstop' || (t.legs[i].kind === 'positioning' && t.legs[i - 1].kind === 'positioning');
    expect(t.legs[i].std - t.legs[i - 1].sta).toBeGreaterThanOrEqual(stop ? TECH_STOP_MIN : turn);
  }
  if (p.kind === 'base') {
    expect(p.maintEvery).toBe(7);
    expect(p.waves[0]).toBe(360);
    for (let i = 1; i < p.waves.length; i++) expect(p.waves[i]).toBeGreaterThan(p.waves[i - 1]);
    expect(p.waves[p.waves.length - 1]).toBeLessThanOrEqual(21 * 60);
    expect(p.targetBH).toBeGreaterThan(0);
    expect(o.product.kind).toBe('wet');
  } else {
    for (let i = 1; i < p.legs.length; i++) expect(p.legs[i].dep).toBeGreaterThanOrEqual(p.legs[i - 1].dep);
    expect(o.product.kind).toBe('charter');
  }
}

describe('offer generation', () => {
  for (const a of ARCHETYPES) {
    it(`${a}: valid offers across 200 seeds`, () => {
      const g = newGame(1);
      let made = 0;
      for (let seed = 0; seed < 200; seed++) {
        g.rng = (seed * 7919 + 13) >>> 0;
        g.offers = {};
        const o = generateOffer(g, a, { window: false });
        if (!o) continue;
        made++;
        expect(o.archetype).toBe(a);
        checkValid(g, o);
      }
      expect(made).toBeGreaterThanOrEqual(190);
    });
  }

  it('opens with an urgent AOG cover, an ad hoc in 3–5 days and an April season base', () => {
    const g = newGame(2);
    const os = Object.values(g.offers);
    expect(os.map((o) => o.archetype).sort()).toEqual(['adhoc', 'aogCover', 'seasonBase']);
    const aog = os.find((o) => o.archetype === 'aogCover')!;
    expect(aog.urgency).toBe('urgent');
    expect(aog.start - g.now).toBeLessThan(DAY + 6 * 60);
    const adhoc = os.find((o) => o.archetype === 'adhoc')!;
    expect(adhoc.start - g.now).toBeGreaterThanOrEqual(3 * DAY - DAY);
    expect(adhoc.start - g.now).toBeLessThanOrEqual(5 * DAY + DAY);
    const base = os.find((o) => o.archetype === 'seasonBase')!;
    expect(toDate(base.start).getUTCMonth()).toBe(3);
    for (const o of os) expect(feasibilityAll(g, o.id)[0].level).not.toBe('no');
  });

  it('season-base waves come from the route (HAM–PMI 06:00 / 12:30 / 19:00) and are stored in UTC', () => {
    const g = newGame(3);
    const o = offer(g, 'seasonBase', { airport: 'HAM', dests: ['PMI'], waves: 3, start: fromUTC(2027, 5, 1), days: 30 });
    expect(o.pattern.kind === 'base' && o.pattern.waves).toEqual(computeWaves('HAM', ['PMI'], 'a320ceo', 3));
    expect(o.pattern.kind === 'base' && localMinuteOfDay('HAM', o.pattern.from)).toBe(0);
  });

  it('urgent offers we can fly pause the clock and post a message', () => {
    const g = newGame(4);
    g.offers = {};
    takePause();
    const o = generateOffer(g, 'aogCover', { wide: false, window: false, airport: 'DUS', start: g.now + 14 * 60 })!;
    expect(o.urgency).toBe('urgent');
    expect(takePause()).toBe('urgentOffer');
    expect(g.messages[0].ref).toEqual({ kind: 'offer', id: o.id });
  });

  it('one open request per client and archetype', () => {
    const g = newGame(5);
    g.offers = {};
    const a = offer(g, 'seasonBase', { airport: 'HAM' });
    const b = generateOffer(g, 'seasonBase', { wide: false, window: false, client: a.clientId, airport: 'HAM' });
    expect(b === null || b.clientId !== a.clientId).toBe(true);
  });
});

describe('offer flow (acceptance: 30/60 days from a new game)', () => {
  it('12–25 offers in 30 days, ≥ 70% fit the A320s, season bases, urgent and gap-fit offers turn up', () => {
    let total = 0;
    let fit = 0;
    for (const seed of [11, 12]) {
      const g = newGame(seed);
      const t0 = g.now;
      const seen = new Map<string, { o: ContractOffer; fit: boolean }>();
      for (let h = 1; h <= 60 * 24; h++) {
        run(g, t0 + h * 60);
        for (const o of Object.values(g.offers)) if (!seen.has(o.id)) seen.set(o.id, { o: { ...o }, fit: feasibilityAll(g, o.id).some((r) => r.level !== 'no') });
      }
      const later = [...seen.values()].filter((x) => x.o.created > t0);
      const in30 = later.filter((x) => x.o.created <= t0 + 30 * DAY);
      expect(in30.length).toBeGreaterThanOrEqual(12);
      expect(in30.length).toBeLessThanOrEqual(25);
      total += in30.length;
      fit += in30.filter((x) => x.fit).length;
      expect(later.some((x) => x.o.archetype === 'seasonBase')).toBe(true);
      expect(later.some((x) => x.o.urgency === 'urgent')).toBe(true);
      expect(later.filter((x) => x.o.hook).length / later.length).toBeGreaterThanOrEqual(0.4);
      // Every archetype except the rare ones shows up within two months.
      const kinds = new Set(later.map((x) => x.o.archetype));
      expect(kinds.size).toBeGreaterThanOrEqual(5);
    }
    expect(fit / total).toBeGreaterThanOrEqual(0.7);
  });

  it('gap-fit offers land in a real idle window when the fleet is busy', () => {
    const g = newGame(13);
    const [a, b] = Object.values(g.fleet);
    // Aircraft a busy for 40 days from day 3; b busy from day 20.
    const o1 = offer(g, 'seasonBase', { airport: 'HAM', start: g.now + 3 * DAY, days: 40 });
    expect(acceptOffer(g, o1.id, [a.id]).ok).toBe(true);
    const o2 = offer(g, 'seasonBase', { airport: 'DUS', start: g.now + 20 * DAY, days: 40 });
    expect(acceptOffer(g, o2.id, [b.id]).ok).toBe(true);
    let hooked = 0;
    let ok = 0;
    for (let i = 0; i < 40; i++) {
      g.offers = Object.fromEntries(Object.entries(g.offers).filter(([, x]) => x.status !== 'open'));
      const o = generateOffer(g, 'adhoc', { wide: false });
      if (!o?.hook) continue;
      hooked++;
      if (feasibilityAll(g, o.id).some((r) => r.level !== 'no')) ok++;
    }
    expect(hooked).toBeGreaterThan(5);
    expect(ok / hooked).toBeGreaterThanOrEqual(0.8);
  });
});

describe('pricing', () => {
  it('A320 wet rates stay in the $3,200–4,800/BH band', () => {
    const g = newGame(6);
    for (let seed = 0; seed < 120; seed++) {
      g.rng = seed * 31 + 7;
      g.offers = {};
      const o = generateOffer(g, 'seasonBase', { wide: false, window: false, airport: 'HAM' });
      if (!o || o.product.kind !== 'wet') continue;
      expect(o.product.ratePerBH).toBeGreaterThanOrEqual(3200);
      expect(o.product.ratePerBH).toBeLessThanOrEqual(4800);
      expect(o.product.mghPerMonth).toBe(BAL.mgh.narrow);
      expect(o.product.excessRate).toBe(0.95);
    }
  });

  it('charter prices land at 2–3.5× the ACMI rate per block hour flown (incl. empty legs)', () => {
    const g = newGame(7);
    const R = ACMI_TYPES.a320ceo.rateBH;
    // Typical one-off round trips (2–12 BH incl. positioning, 2–4 departures, a few nights away).
    for (const [bh, deps, nights] of [[4, 2, 0], [6, 4, 18], [9, 4, 24], [12, 6, 30]]) {
      const p = priceProduct(g, { archetype: 'adhoc', typeId: 'a320ceo', estBH: bh, start: fromUTC(2027, 5, 10), end: fromUTC(2027, 5, 14), lead: 20 * DAY, departures: deps, revDepartures: 2, roomNights: nights, crewDays: nights + 6 });
      expect(p.kind).toBe('charter');
      if (p.kind !== 'charter') continue;
      const perBH = p.price / bh / R;
      expect(perBH).toBeGreaterThanOrEqual(2);
      expect(perBH).toBeLessThanOrEqual(3.5);
      expect(p.depositPct).toBe(BAL.charterDeposit);
      expect(p.balanceDaysBefore).toBeGreaterThanOrEqual(7);
      expect(p.balanceDaysBefore).toBeLessThanOrEqual(14);
    }
  });

  it('season, lead and archetype premiums', () => {
    const g = newGame(8);
    const jul = fromUTC(2027, 7, 10);
    const feb = fromUTC(2027, 2, 10);
    expect(rateMultiplier(g, 'a320ceo', jul, 30 * DAY).season).toBe(BAL.premium.peakSummer);
    expect(rateMultiplier(g, 'a320ceo', feb, 30 * DAY).season).toBe(BAL.premium.winter);
    expect(rateMultiplier(g, 'a320ceo', fromUTC(2027, 12, 20), 30 * DAY).season).toBe(0);
    expect(rateMultiplier(g, 'a320ceo', jul, 24 * 60).lead).toBe(BAL.premium.urgent);
    expect(rateMultiplier(g, 'a320ceo', jul, 5 * DAY).lead).toBe(BAL.premium.short);
    // No old-type discount on market rates: the reference type is mainstream (A340-300 only as a last resort).
    expect(rateMultiplier(g, 'a343', jul, 30 * DAY).type).toBe(0);
    expect(referenceType({ minSeats: 260, layout: 'two-class' }, [['LIS', 'GRU']])).not.toBe('a343');
    const base = { typeId: 'a320ceo', estBH: 10, start: jul, end: jul + 5 * DAY, lead: 30 * DAY };
    const wet = priceProduct(g, { ...base, archetype: 'seasonBase' });
    const aog = priceProduct(g, { ...base, archetype: 'aogCover' });
    expect(wet.kind === 'wet' && aog.kind === 'wet' && aog.ratePerBH / wet.ratePerBH).toBeCloseTo(1.5, 1);
    const gov = priceProduct(g, { ...base, archetype: 'repatriation', government: true });
    expect(gov.kind === 'charter' && gov.depositPct).toBe(0);
  });

  it('productValue: MGH floor, excess at 95%, charter price as is', () => {
    const wet = { kind: 'wet' as const, ratePerBH: 4000, mghPerMonth: 200, excessRate: 0.95, cycleFee: 900, positioningBillable: true };
    const s = fromUTC(2027, 5, 1);
    const e = fromUTC(2027, 6, 1);
    expect(productValue(wet, 150, s, e)).toBe(800_000);
    expect(productValue(wet, 260, s, e)).toBe(800_000 + 60 * 0.95 * 4000);
    expect(productValue({ kind: 'charter', price: 123_000, depositPct: 0.3, balanceDaysBefore: 7, fuelEscalation: false }, 9, s, e)).toBe(123_000);
  });
});

describe('offer lifecycle', () => {
  it('expired offers go to a named rival, stay 14 days in the missed list, then drop', () => {
    const g = newGame(9);
    const o = offer(g, 'adhoc');
    g.now = o.expires;
    onOfferExpire(g, { t: o.expires, seq: 0, type: 'offer.expire', id: o.id, v: 0 });
    expect(['lost', 'expired']).toContain(o.status);
    if (o.status === 'lost') expect(g.rivals.map((r) => r.name)).toContain(o.lostTo);
    run(g, o.expires + 16 * DAY);
    expect(g.offers[o.id]).toBeUndefined();
  });

  it('declining closes the offer', () => {
    const g = newGame(10);
    const o = offer(g, 'adhoc');
    expect(declineOffer(g, o.id).ok).toBe(true);
    expect(o.status).toBe('declined');
    expect(acceptOffer(g, o.id, [Object.keys(g.fleet)[0]]).ok).toBe(false);
  });

  it('a counter at the asking price is accepted and signs on the chosen aircraft', () => {
    const g = newGame(11);
    const o = offer(g, 'adhoc');
    const id = feasibilityAll(g, o.id)[0].aircraftId;
    const price = o.product.kind === 'charter' ? o.product.price : 0;
    expect(counterOffer(g, o.id, price, [id]).ok).toBe(true);
    expect(o.status).toBe('countered');
    expect(o.counter!.replyAt - g.now).toBeGreaterThanOrEqual(60);
    expect(counterOffer(g, o.id, price, [id]).ok).toBe(false);
    g.now = Math.min(o.counter!.replyAt, o.expires - 1);
    onOfferReply(g, { t: g.now, seq: 0, type: 'offer.reply', id: o.id, v: 0 });
    expect(o.counter!.result).toBe('accepted');
    expect(o.status).toBe('accepted');
    expect(Object.values(g.contracts).some((c) => c.offerId === o.id && c.aircraftIds[0] === id)).toBe(true);
  });

  it('a counter above the walk-away floor is refused and the asking price stands', () => {
    const g = newGame(12);
    const o = offer(g, 'adhoc');
    const id = feasibilityAll(g, o.id)[0].aircraftId;
    const price = o.product.kind === 'charter' ? o.product.price : 0;
    expect(counterOffer(g, o.id, Math.round(price * (o.floor + 0.05)), [id]).ok).toBe(true);
    g.now = Math.min(o.counter!.replyAt, o.expires - 1);
    onOfferReply(g, { t: g.now, seq: 0, type: 'offer.reply', id: o.id, v: 0 });
    // v0.5.2: refused (asking stands) or met halfway (midpoint on the table); either way the offer reopens.
    expect(['refused', 'halfway']).toContain(o.counter!.result);
    expect(o.status).toBe('open');
    expect(o.product.kind === 'charter' && o.product.price).toBe(o.counter!.result === 'refused' ? price : o.counter!.offer);
  });

  it('the new game starts on 1 March 2027', () => {
    expect(toDate(START).toISOString().slice(0, 10)).toBe('2027-03-01');
  });
});
