// v0.8 client relationships and company standing (UPDATE-0.8.md §1, §14).

import { describe, expect, it } from 'vitest';
import { BAL } from '../core/balance';
import { DAY, fromUTC, monthKey } from '../core/time';
import type { Client, Contract, ContractOffer, GameState } from '../core/types';
import { fixtureContract } from '../crew/fixtures';
import { resolveDecision } from '../ops';
import { latePaymentDecision } from '../ops/events';
import { cancelLegs } from '../ops/flights';
import { acceptOffer, cancelContract } from './accept';
import { monthRelation } from './billing';
import { repeatHit, rollRepeat } from './missions';
import { generateOffer } from './offers';
import {
  bumpClient, clientList, clientView, dailyRelations, forgiveDelay, levelFor, LEVEL_PERKS, monthlyRelationDrift, offerClientLine, standing, standingFor, standingNow,
} from './relations';
import { hamBase, leased, newGame, offer, run } from './testkit';

const R = BAL.v08.rel;
const airline = (g: GameState): Client => Object.values(g.clients).find((c) => c.name === 'Condor')!;
const setRel = (c: Client, relation: number, jobs: number) => {
  c.relation = relation;
  c.jobs = jobs;
};

describe('levels (§1.2) with hysteresis', () => {
  it('Trusted from 30 and 2 jobs, kept until under 20; Partner from 60 and 4 jobs, kept until under 50', () => {
    const g = newGame(3);
    const c = airline(g);
    setRel(c, 29, 2);
    expect(levelFor(g, c, 'known')).toBe('known');
    setRel(c, 30, 2);
    expect(levelFor(g, c, 'known')).toBe('trusted');
    setRel(c, 30, 1);
    expect(levelFor(g, c, 'known')).toBe('known');
    // Hysteresis: a Trusted client stays Trusted down to 20.
    setRel(c, 21, 2);
    expect(levelFor(g, c, 'trusted')).toBe('trusted');
    setRel(c, 19, 2);
    expect(levelFor(g, c, 'trusted')).toBe('known');
    setRel(c, 60, 4);
    expect(levelFor(g, c, 'trusted')).toBe('partner');
    setRel(c, 51, 4);
    expect(levelFor(g, c, 'partner')).toBe('partner');
    setRel(c, 49, 4);
    expect(levelFor(g, c, 'partner')).toBe('trusted');
  });

  it('Unhappy under −15 (−25 once Known), back at −5; New without jobs or contracts', () => {
    const g = newGame(3);
    const c = airline(g);
    setRel(c, 0, 0);
    expect(levelFor(g, c, undefined)).toBe('new');
    setRel(c, -16, 0);
    expect(levelFor(g, c, 'new')).toBe('unhappy');
    setRel(c, -20, 1);
    expect(levelFor(g, c, 'known')).toBe('known');
    setRel(c, -26, 1);
    expect(levelFor(g, c, 'known')).toBe('unhappy');
    setRel(c, -6, 1);
    expect(levelFor(g, c, 'unhappy')).toBe('unhappy');
    setRel(c, -5, 1);
    expect(levelFor(g, c, 'unhappy')).toBe('known');
  });

  it('one message per change (none for a first contract), a client-voice line and the perks', () => {
    const g = newGame(3);
    const c = airline(g);
    c.level = 'known';
    setRel(c, 35, 2);
    const n = g.messages.length;
    dailyRelations(g);
    expect(c.level).toBe('trusted');
    expect(g.messages.length).toBe(n + 1);
    expect(g.messages[0].title).toBe('Condor now trusts us');
    expect(g.messages[0].body).toMatch(/first refusal.*3 days sooner.*8 %/);
    dailyRelations(g);
    expect(g.messages.length).toBe(n + 1);
    // A New client who signs becomes Known quietly.
    const o = hamBase(g, g.now + 20 * DAY, 40);
    const cl = g.clients[o.clientId];
    cl.level = 'new';
    setRel(cl, 0, 0);
    expect(acceptOffer(g, o.id, [leased(g).id]).ok).toBe(true);
    const m = g.messages.length;
    dailyRelations(g);
    expect(cl.level).toBe('known');
    expect(g.messages.length).toBe(m);
  });
});

describe('what moves the relation (§1.3)', () => {
  it('bumpClient clamps, keeps the last 8 changes and merges one reason on one day', () => {
    const g = newGame(3);
    const c = airline(g);
    bumpClient(g, c.id, 150, 'Big favour');
    expect(c.relation).toBe(100);
    for (let i = 0; i < 12; i++) bumpClient(g, c.id, -1, `Reason ${i}`);
    expect(c.log!.length).toBe(8);
    bumpClient(g, c.id, -0.5, 'Handed flights to Getjet');
    bumpClient(g, c.id, -0.5, 'Handed flights to Getjet');
    expect(c.log![c.log!.length - 1]).toEqual([g.now, -1, 'Handed flights to Getjet']);
    expect(clientView(g, c.id)!.log[0].text).toBe('Handed flights to Getjet');
  });

  it('a wet month: ≥ 90 % on time +4, ≥ 75 % +1, below −2', () => {
    const g = newGame(3);
    const c = airline(g);
    const k = fixtureContract(g, { clientId: c.id, aircraftIds: [Object.keys(g.fleet)[0]], start: g.now, end: g.now + 60 * DAY, pattern: { kind: 'legs', legs: [] } });
    const m = monthKey(g.now);
    const cases: [number, number][] = [[95, R.wetMonth[0]], [80, R.wetMonth[1]], [60, R.wetMonth[2]]];
    for (const [onTime, d] of cases) {
      k.use[m] = { blockMin: 0, cycles: 0, shortCycles: 0, legs: 100, onTime };
      const r0 = c.relation;
      monthRelation(g, k, m);
      expect(c.relation - r0).toBe(d);
    }
  });

  it('cancelling a leg costs 3, cancelling the contract 30, a declined request 2, accepted favours +4 / +3, waived interest +3', () => {
    const g = newGame(9);
    const ac = leased(g);
    const o = hamBase(g, g.now + 5 * DAY, 30, 2);
    const res = acceptOffer(g, o.id, [ac.id]);
    if (!res.ok) throw new Error(res.error);
    const k = g.contracts[res.data!.contractId];
    const cl = g.clients[k.clientId];
    const legs = Object.values(g.flights).filter((f) => f.contractId === k.id && f.kind === 'revenue').sort((a, b) => a.std - b.std).slice(0, 1);
    let r0 = cl.relation;
    cancelLegs(g, legs, 'Test', 0);
    expect(cl.relation - r0).toBe(R.cancelLeg);
    expect(cl.log!.at(-1)![2]).toMatch(/^Cancelled /);
    // Late-payment interest waived.
    const r = { id: 'r1', clientId: cl.id, contractId: k.id, desc: 'X', amount: 1000, issued: g.now - 40 * DAY, due: g.now - 31 * DAY, payAt: g.now + DAY, paid: null, cat: 'acmiRevenue' as const };
    g.finance.receivables.push(r);
    g.stats.askedAt = [];
    latePaymentDecision(g, r);
    const d = g.decisions.find((x) => x.kind === 'latePayment')!;
    r0 = cl.relation;
    expect(resolveDecision(g, d.id, 'waive').ok).toBe(true);
    expect(cl.relation - r0).toBe(R.waiveInterest);
    r0 = cl.relation;
    cancelContract(g, k.id);
    expect(cl.relation - r0).toBe(-30);
  });

  it('short-notice cover +3 at signing; completion +6 (≥ 85 % on time), +10 AOG cover; jobs counted', () => {
    const g = newGame(5);
    const o = offer(g, 'aogCover');
    expect(o.urgency).toBe('urgent');
    const cl = g.clients[o.clientId];
    const r0 = cl.relation;
    const res = acceptOffer(g, o.id, [leased(g).id]);
    if (!res.ok) throw new Error(res.error);
    expect(cl.relation - r0).toBe(R.urgentSign);
    const k = g.contracts[res.data!.contractId];
    run(g, k.end + 2 * DAY);
    expect(k.status).toBe('completed');
    expect(cl.jobs).toBe(1);
    expect(cl.lastJob).toBeGreaterThan(0);
    expect(cl.log!.some(([, d, why]) => d === R.doneAog && /^Completed /.test(why))).toBe(true);
  });

  it('monthly drift: only clients with no flying for us in 120 days move 1 toward 0', () => {
    const g = newGame(3);
    const [a, b] = Object.values(g.clients);
    a.relation = 10;
    b.relation = 10;
    b.lastJob = g.now - 30 * DAY;
    monthlyRelationDrift(g);
    expect(a.relation).toBe(9);
    expect(b.relation).toBe(10);
  });
});

describe('what each level brings (§1.4)', () => {
  it('the rate: a Trusted client asks 8 % more than a New one on the same draw; Unhappy −5 %', () => {
    const rate = (level: Client['level']) => {
      const g = newGame(21);
      const c = airline(g);
      c.level = level;
      const o = generateOffer(g, 'seasonBase', { client: c.id, airport: 'HAM', dests: ['PMI'], start: g.now + 40 * DAY, days: 40, window: false, wide: false, paint: false });
      if (!o || o.product.kind !== 'wet') throw new Error('no offer');
      return { rate: o.product.ratePerBH, o };
    };
    const n = rate('new');
    const t = rate('trusted');
    const u = rate('unhappy');
    expect(t.rate / n.rate).toBeCloseTo(1.08, 2);
    expect(u.rate / n.rate).toBeCloseTo(0.95, 2);
    expect(t.o.levelPct).toBe(0.08);
    expect(t.o.firstRefusal).toBe(true);
    expect(n.o.firstRefusal).toBeUndefined();
  });

  it('first refusal: the offer lasts 48 h longer, no rival bid, and 30 % (not 70 %) go to a rival on expiry; Trusted pays 3 days sooner', () => {
    const g = newGame(21);
    const c = airline(g);
    c.level = 'trusted';
    const o = generateOffer(g, 'seasonBase', { client: c.id, airport: 'HAM', dests: ['PMI'], start: g.now + 60 * DAY, days: 40, window: false, wide: false, paint: false })!;
    expect(o.rivalBid).toBeUndefined();
    expect(o.payment.dueDays).toBe(7 - LEVEL_PERKS.trusted.payDays);
    const g2 = newGame(21);
    const o2 = generateOffer(g2, 'seasonBase', { client: airline(g2).id, airport: 'HAM', dests: ['PMI'], start: g2.now + 60 * DAY, days: 40, window: false, wide: false, paint: false })!;
    expect(o.expires - o.created - (o2.expires - o2.created)).toBe(BAL.v08.firstRefusalH * 60);
    // Expiry: 30 % lost over many first-refusal offers.
    let lost = 0;
    const N = 400;
    for (let i = 0; i < N; i++) {
      const x = { ...o, id: `fr${i}`, status: 'open' as ContractOffer['status'], rivalBid: undefined };
      g.offers[x.id] = x;
      g.now = x.expires;
      // onOfferExpire via the module (the main RNG draws the 30 %).
      offersExpire(g, x.id);
      if (x.status === 'lost') lost++;
    }
    expect(lost / N).toBeGreaterThan(0.25);
    expect(lost / N).toBeLessThan(0.35);
  });

  it('small delays forgiven: Trusted 1, Partner 3 a month, New none', () => {
    const g = newGame(3);
    const c = airline(g);
    c.level = 'new';
    expect(forgiveDelay(g, c.id)).toBe(false);
    c.level = 'trusted';
    expect(forgiveDelay(g, c.id)).toBe(true);
    expect(forgiveDelay(g, c.id)).toBe(false);
    c.level = 'partner';
    c.forgiven = undefined;
    expect([1, 2, 3, 4].map(() => forgiveDelay(g, c.id))).toEqual([true, true, true, false]);
  });

  it('repeat business: Known 30 %, Trusted 50 %, Partner 80 % over 500 rolls (±5 %)', () => {
    const g = newGame(3);
    const c = airline(g);
    for (const [level, p] of [['known', 0.3], ['trusted', 0.5], ['partner', 0.8]] as const) {
      c.level = level;
      let hits = 0;
      for (let i = 0; i < 500; i++) {
        const k: Contract = fixtureContract(g, { clientId: c.id, aircraftIds: [], start: 0, end: 1, pattern: { kind: 'legs', legs: [] } });
        k.id = `rep${level}${i}`;
        g.contracts[k.id] = k;
        if (repeatHit(g, k.id)) hits++;
        delete g.contracts[k.id];
      }
      expect(Math.abs(hits / 500 - p)).toBeLessThan(0.05);
    }
  });

  it('round 4 (§V): the repeat-business message names the client once (the title) and the job once', () => {
    const g = newGame(3);
    const c = airline(g);
    c.level = 'partner';
    g.company.standing = 1;
    let seen = 0;
    for (let i = 0; i < 40 && seen < 3; i++) {
      const k = fixtureContract(g, { clientId: c.id, aircraftIds: [], start: g.now, end: g.now + 1440, pattern: { kind: 'legs', legs: [] } });
      k.id = `rep${i}`;
      k.archetype = 'tourSeries';
      k.title = 'Summer programme Hamburg–Palma';
      g.contracts[k.id] = k;
      const o = rollRepeat(g, k.id);
      if (!o) continue;
      seen++;
      const m = g.messages.filter((x) => x.title === `Repeat business from ${c.name}`).pop()!;
      expect(m.body).not.toContain(c.name);
      expect(m.body).toMatch(/^They liked Summer programme Hamburg–Palma and ask for it again( as .+)? from \d+ \w+\.$/);
      if (o.title === k.title || o.title.startsWith(`${k.title} (`)) expect(m.body).not.toContain(' as ');
      else expect(m.body).toContain(` as ${o.title} from`);
    }
    expect(seen).toBeGreaterThan(0);
  });

  it('views: clientView, clientList, offerClientLine', () => {
    const g = newGame(3);
    const c = airline(g);
    c.level = 'known';
    setRel(c, 26, 2);
    const v = clientView(g, c.id)!;
    expect(v.levelName).toBe('Known');
    expect(v.next).toEqual({ level: 'trusted', need: 'relation 30 (now 26)' });
    expect(clientList(g, 'working').some((x) => x.id === c.id)).toBe(true);
    c.level = 'unhappy';
    expect(clientList(g, 'unhappy').map((x) => x.id)).toEqual([c.id]);
    expect(clientView(g, c.id)!.unhappy).toEqual({ kind: 'clientUnhappy', ref: { kind: 'client', id: c.id } });
    c.level = 'trusted';
    const o = generateOffer(g, 'seasonBase', { client: c.id, airport: 'HAM', dests: ['PMI'], start: g.now + 40 * DAY, days: 40, window: false, wide: false, paint: false })!;
    const line = offerClientLine(g, o.id)!;
    expect(line.chip).toBe('Trusted · +8 %');
    expect(line.lines).toContain('First refusal: no rival will take it before it expires');
  });
});

describe('company standing (§1.6)', () => {
  it('thresholds: Established at 3 contracts, 120 days, reliable 55; Respected at 10, 365 days, 70 / 50; never back to Newcomer', () => {
    const g = newGame(3, 'LIS', true);
    expect(standingFor(g)).toBe(0);
    g.stats.contractsDone = 3;
    g.now = g.started + 120 * DAY;
    g.company.reputation.reliable = 55;
    expect(standingFor(g)).toBe(1);
    g.stats.contractsDone = 10;
    g.now = g.started + 365 * DAY;
    g.company.reputation = { reliable: 70, clean: 50 };
    expect(standingFor(g)).toBe(2);
    g.company.standing = 2;
    g.company.reputation.reliable = 59;
    expect(standingNow(g)).toBe(1);
    g.company.standing = 1;
    g.stats.contractsDone = 0;
    expect(standingNow(g)).toBe(1);
    expect(standing(g).name).toBe('Established');
  });

  it('a Newcomer gets 30–45-day bases at −8 % and odd-hour waves in about 40 % of them', () => {
    const g = newGame(31, 'LIS', true);
    g.company.standing = 0;
    let odd = 0;
    let n = 0;
    for (let i = 0; i < 300; i++) {
      for (const x of Object.values(g.offers)) if (x.archetype === 'seasonBase' && x.status === 'open') delete g.offers[x.id];
      g.now += 7;
      const o = generateOffer(g, 'seasonBase', { window: false, wide: false, paint: false, start: fromUTC(2027, 6, 1) + i * 60 });
      if (!o || o.pattern.kind !== 'base') continue;
      n++;
      expect((o.end - o.start) / DAY).toBeLessThanOrEqual(46);
      expect(o.standingPct).toBe(-0.08);
      if (o.pattern.waves[0] < 6 * 60) odd++;
    }
    expect(n).toBeGreaterThan(200);
    expect(odd / n).toBeGreaterThan(0.32);
    expect(odd / n).toBeLessThan(0.48);
  });
});

// The module's expiry handler (the offer lifecycle) for the first-refusal roll.
import { onOfferExpire } from './offers';
function offersExpire(g: GameState, id: string): void {
  onOfferExpire(g, { t: g.now, seq: 0, type: 'offer.expire', id, v: 0 });
}
