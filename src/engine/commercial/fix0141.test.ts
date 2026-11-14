// v0.14.1 fix round (hunt 2, the commercial lane): leads that never lapsed, tenders awarded after the job's start,
// airlines in administration still asking for work, the Mixed crew cut, a fair in our home city, the offer card's WHY
// and fix, the way home from a closed airport, a won tender countered upward, and the small ones (L1–L6, UI-4/8/11/12,
// the crisis suspects). Each test fails on 7896a46.

import { describe, expect, it } from 'vitest';
import { FAIR_BY_ID } from '../../data/fairs';
import { BAL } from '../core/balance';
import { createGame } from '../newGame';
import { DAY, fmtDay, fromUTC, toLocal } from '../core/time';
import type { GameState } from '../core/types';
import { closeOffer, counterOffer, jobDays } from '../contracts/accept';
import { legsRoute } from '../contracts/call';
import { generateOffer, loadStuckOffers, onOfferExpire, onOfferSpawn } from '../contracts/offers';
import { favourChip, standing } from '../contracts/relations';
import { rollRivalBid } from '../contracts/rivals';
import { hamBase, legsOffer, newGame, run } from '../contracts/testkit';
import { marketOutlook } from '../ops/market';
import { newDirector } from '../ops/director';
import { offerFitCard } from '../problems/commercial';
import { clientCrisisCard, CRISIS, startCrisis } from './crises';
import { clientByName, com } from './state';
import { bidQuote, dailyTenders, decideTender, earliestBidStart, issueTender, offerWithBid, placeBid, roundAt, TENDER, tenderBoard } from './tenders';
import { bookTrip, dailyTrips, travelLegs, tripQuote } from './trips';
import './index';

const at = (g: GameState, t: number): GameState => {
  g.now = t;
  newDirector(g, 'normal');
  return g;
};
const expiresQueued = (g: GameState, id: string) => g.queue.filter((e) => e.type === 'offer.expire' && e.id === id).map((e) => e.t);
const checksDone = (g: GameState) => {
  for (const a of Object.values(g.fleet)) {
    a.maint.lastC = g.now;
    a.maint.lastA = g.now;
    a.maint.fhSinceA = 0;
  }
};

describe('COMM-H1 a lead offer lapses at its (longer) expiry', () => {
  it('makeLead queues the new expiry and drops the call; leads seen over several visits all have it', () => {
    let leads = 0;
    let offerLeads = 0;
    let extended = 0;
    for (let seed = 1; seed <= 8 && leads < 6; seed++) {
      const g = newGame(seed);
      const clients = Object.values(g.clients).filter((c) => !c.rivalId && c.base !== 'LIS' && (c.kind === 'airline' || c.kind === 'tourOperator'));
      for (const c of clients.slice(0, 8)) {
        c.met = g.now;
        const r = bookTrip(g, 'ceo', { clientId: c.id });
        if (!r.ok) continue;
        const t = com(g).trips.find((x) => x.id === r.data!.tripId)!;
        t.status = 'away';
        t.back = { ...t.back, sta: g.now };
        dailyTrips(g);
        for (const l of t.leads ?? []) {
          // v0.16 a visit's lead goes into the pipeline (commercial/sales.ts); the offer path stays for a client it cannot draft for.
          if (l.kind === 'lead') {
            expect(com(g).leads!.find((x) => x.id === l.leadId)?.stage).toBe('lead');
            leads++;
            continue;
          }
          if (!l.offerId) continue;
          const o = g.offers[l.offerId];
          leads++;
          offerLeads++;
          expect(o.call).toBeUndefined();
          const q = expiresQueued(g, o.id);
          expect(q).toContain(o.expires);
          if (q.some((x) => x < o.expires)) extended++;
        }
      }
    }
    expect(leads).toBeGreaterThan(0);
    if (offerLeads) expect(extended).toBeGreaterThan(0);
  }, 60_000);

  it("an 'offer.expire' that fires before a moved expiry waits for it; the offer then lapses", () => {
    const g = newGame(3);
    const o = generateOffer(g, 'adhoc', { wide: false, window: false })!;
    const first = o.expires;
    o.expires = first + 2 * DAY;
    g.now = first;
    onOfferExpire(g, { t: first, seq: 0, type: 'offer.expire', id: o.id, v: 0 });
    expect(o.status).toBe('open');
    expect(expiresQueued(g, o.id)).toContain(o.expires);
    run(g, o.expires + 60);
    expect(o.status).not.toBe('open');
  });

  it('load: an open offer past its expiry with nothing queued lapses; one still running gets its expiry queued', () => {
    const g = newGame(4);
    const a = generateOffer(g, 'adhoc', { wide: false, window: false })!;
    const b = generateOffer(g, 'tourSeries', { wide: false, window: false })!;
    g.queue = g.queue.filter((e) => e.type !== 'offer.expire');
    g.now = a.expires + DAY;
    b.expires = g.now + 3 * DAY;
    loadStuckOffers(g);
    expect(a.status).toBe('expired');
    expect(b.status).toBe('open');
    expect(expiresQueued(g, b.id)).toEqual([b.expires]);
  });
});

describe('COMM-H2 tenders are awarded before the job starts', () => {
  it('late in either round: a week to bid, a week to decide, and the award the lead time before the earliest start a bid may ask', () => {
    let n = 0;
    for (const day of [fromUTC(2028, 2, 10), fromUTC(2028, 2, 20), fromUTC(2028, 2, 28), fromUTC(2027, 8, 20), fromUTC(2027, 8, 31)]) {
      for (const seed of [3, 4, 5]) {
        const g = at(newGame(seed), day);
        for (let i = 0; i < 6; i++) {
          const t = issueTender(g, { round: roundAt(g.now)! });
          if (!t) continue;
          n++;
          expect(t.deadline - t.issued).toBeGreaterThanOrEqual(TENDER.minDays * DAY);
          expect(t.resultAt - t.deadline).toBeGreaterThanOrEqual(TENDER.minDays * DAY);
          expect(t.resultAt + (TENDER.quietWait + TENDER.awardLead) * DAY).toBeLessThanOrEqual(t.ask.start + TENDER.startShift[0] * DAY);
          expect(earliestBidStart(t)).toBe(t.ask.start + TENDER.startShift[0] * DAY);
        }
      }
    }
    expect(n).toBeGreaterThan(20);
  });

  it('an award that comes too late for our start (an older save) moves the start on; a lapse then costs no relation', () => {
    const g = at(newGame(9), fromUTC(2027, 11, 10));
    checksDone(g);
    let t = null as ReturnType<typeof issueTender>;
    for (let i = 0; i < 10 && !t; i++) t = issueTender(g);
    const q = bidQuote(g, t!.id)!;
    const ac = q.aircraft.find((a) => a.level !== 'no')!;
    expect(placeBid(g, t!.id, { rate: q.budget, mgh: q.mgh, aircraftId: ac.id, crew: 'ours', start: q.start, end: q.end }).ok).toBe(true);
    // The award comes two days after our start; the tail we bid has gone.
    g.now = t!.bid!.start + 2 * DAY;
    t!.rivals = [];
    t!.status = 'closed';
    t!.bid!.aircraftId = 'gone';
    decideTender(g, t!);
    expect(t!.status).toBe('won');
    expect(t!.result!.late).toBe(true);
    const o = g.offers[t!.result!.offerId!];
    expect(o.start).toBeGreaterThanOrEqual(g.now + 3 * DAY);
    expect(o.expires).toBeLessThan(o.start);
    expect(g.messages.some((m) => m.title.startsWith('Tender won') && /decided late/.test(m.body))).toBe(true);
    const rel = g.clients[t!.clientId].relation;
    closeOffer(g, o, 'expired');
    dailyTenders(g);
    expect(t!.result!.why).toMatch(/not signed/);
    expect(g.clients[t!.clientId].relation).toBe(rel);
  });
});

describe('COMM-M1 an airline in administration asks for nothing', () => {
  it('no tender, no offer by name, never met at a fair', () => {
    const g = createGame({ name: 'Debug Air', code: 'DB', livery: { primary: '#0b1f4d', secondary: '#f5c451', tail: 'sweep' }, base: 'LIS', seed: 5, start: fromUTC(2027, 11, 20) });
    const sun = clientByName(g, 'Sunclass Airlines')!;
    expect(startCrisis(g, 'bankruptcy', sun.id)).toBeTruthy();
    expect(sun.ceased).toBeDefined();
    const condor = clientByName(g, 'Condor')!;
    condor.ceased = g.now;
    expect(issueTender(g, { clientId: condor.id })).toBeNull();
    for (let i = 0; i < 40; i++) expect(issueTender(g)?.clientId).not.toBe(condor.id);
    expect(generateOffer(g, 'seasonBase', { client: condor.id, wide: false, window: false })).toBeNull();
    let met = 0;
    for (let i = 0; i < 25; i++) {
      const r = bookTrip(g, 'ceo', { fairId: 'itb' });
      if (!r.ok) throw new Error(r.error);
      const t = com(g).trips.find((y) => y.id === r.data!.tripId)!;
      t.status = 'away';
      t.back = { ...t.back, sta: g.now };
      dailyTrips(g);
      met += (t.met ?? []).filter((id) => id === sun.id || id === condor.id).length;
    }
    expect(met).toBe(0);
    expect(tripQuote(g, 'ceo', { clientId: condor.id }).ok).toBe(false);
  }, 60_000);
});

describe('COMM-M2 the crew choice of a bid', () => {
  it("the ask carries no client cabin; 'ours' flies all our crew; 'mixed' takes the cut the form shows", () => {
    let mixedSeen = 0;
    for (const seed of [1, 2, 3, 4]) {
      const g = at(newGame(seed), fromUTC(2027, 11, 20));
      for (let i = 0; i < 10; i++) {
        const t = issueTender(g);
        if (!t) continue;
        expect(t.ask.requirements.clientCabin).toBeUndefined();
        const bid = { rate: 4000, mgh: 200, start: t.ask.start, end: t.ask.end };
        const ours = offerWithBid(t, { ...bid, crew: 'ours' }, 'a320ceo', 180);
        expect(ours.requirements.clientCabin).toBeUndefined();
        expect(ours.product.kind === 'wet' && ours.product.ratePerBH).toBe(4000);
        const mixed = offerWithBid(t, { ...bid, crew: 'mixed' }, 'a320ceo', 180);
        const n = mixed.requirements.clientCabin?.n ?? 0;
        if (n) mixedSeen++;
        expect(mixed.product.kind === 'wet' && mixed.product.ratePerBH).toBe(4000 - BAL.v08.mixedCrew.perCabinBH * n);
      }
    }
    expect(mixedSeen).toBeGreaterThan(0);
  });
});

describe('COMM-M3 a fair (or a client) in our home city', () => {
  it('is attended without flights: the pass and local costs; done with meetings and presence', () => {
    const g = newGame(31);
    const q = tripQuote(g, 'ceo', { fairId: 'waf' });
    expect(FAIR_BY_ID.waf.at).toBe('LIS');
    expect(q.ok).toBe(true);
    expect(q.local).toBe(true);
    expect(q.tickets + q.hotel).toBe(0);
    expect(q.total).toBe(q.pass + q.perDiem);
    expect(q.perDiem).toBeGreaterThan(0);
    const r = bookTrip(g, 'ceo', { fairId: 'waf' });
    expect(r.ok).toBe(true);
    const t = com(g).trips[0];
    expect(t.local).toBe(true);
    expect(travelLegs(g, t.out.std - DAY, t.back.sta + DAY)).toEqual([]);
    g.now = t.back.sta + 60;
    dailyTrips(g);
    expect(t.status).toBe('done');
    expect(t.met!.length).toBeGreaterThan(0);
    // A client based here can be visited too.
    const g2 = newGame(32);
    const tap = Object.values(g2.clients).find((c) => c.base === 'LIS' && c.kind === 'airline' && !c.rivalId)!;
    tap.met = g2.now;
    const v = tripQuote(g2, 'ceo', { clientId: tap.id });
    expect(v.ok).toBe(true);
    expect(v.local).toBe(true);
  });
});

describe('COMM-M4 the offer card names the real problem and its fix', () => {
  it('crew that cannot get there in time is not a hire; a positioning WHY names the first departure once; a check due is booked', () => {
    // Crew: the aircraft is at Frankfurt, the job leaves in 4 h, nobody of ours is there.
    const g = newGame(7);
    checksDone(g);
    for (const a of Object.values(g.fleet)) a.at = 'FRA';
    const o = legsOffer(g, [['FRA', 'LIS', g.now + 4 * 60]]);
    const c = offerFitCard(g, o.id)!;
    expect(c.why).not.toMatch(/hires take weeks/);
    expect(c.actions.map((a) => a.id)).not.toContain('hire');
    // Positioning: from Frankfurt to a Lisbon departure soon; the job's pin is Boa Vista.
    const p = legsOffer(g, [['LIS', 'BVC', g.now + 2 * 60]]);
    const pc = offerFitCard(g, p.id)!;
    expect(pc.why).toMatch(/can't get to Lisbon in time/);
    expect(pc.why).not.toMatch(/Boa Vista/);
    expect(pc.why.match(/in time/gi)).toHaveLength(1);
    // Maintenance: an A-check due before the job.
    const g2 = newGame(7);
    checksDone(g2);
    for (const a of Object.values(g2.fleet)) a.maint.lastA = g2.now - 115 * DAY;
    const m = legsOffer(g2, [['LIS', 'FAO', g2.now + 20 * DAY], ['FAO', 'LIS', g2.now + 20 * DAY + 180]]);
    const mc = offerFitCard(g2, m.id)!;
    expect(mc.why).toMatch(/A-check due/);
    expect(mc.actions[0]).toMatchObject({ id: 'planCheck', label: 'Book A-check', open: { modal: 'check' } });
  });
});

describe('COMM-M5 the way home from a closed airport', () => {
  it('is rebooked after the closure, with the extra nights and a note', () => {
    const g = newGame(11);
    expect(bookTrip(g, 'ceo', { fairId: 'itb' }).ok).toBe(true);
    const t = com(g).trips[0];
    const back0 = t.back.std;
    const hotel0 = t.cost.hotel;
    run(g, t.start + 60);
    expect(t.status).toBe('away');
    const until = g.now + 6 * DAY;
    g.world!.events.push({ id: 'weX', kind: 'disaster', tpl: 'x', title: 'Berlin airport closed', body: '', country: 'DE', at: 'BER', start: g.now, end: until, airportClosedUntil: until, offerIds: [], flightsHit: 0, ev: 0, workLeft: [] } as never);
    run(g, back0 + 60);
    expect(t.status).toBe('away');
    expect(t.back.std).toBeGreaterThanOrEqual(until);
    expect(t.cost.hotel).toBeGreaterThan(hotel0);
    expect(g.messages.some((m) => /stuck in Berlin/.test(m.title))).toBe(true);
    expect(travelLegs(g, back0, back0 + 120).some((x) => x.tripId === t.id)).toBe(false);
  }, 60_000);
});

describe('COMM-M6 a won tender is signed at our bid', () => {
  it('no counter on its offer', () => {
    const g = at(newGame(9), fromUTC(2027, 11, 10));
    checksDone(g);
    let t = null as ReturnType<typeof issueTender>;
    for (let i = 0; i < 10 && !t; i++) t = issueTender(g);
    const q = bidQuote(g, t!.id)!;
    const ac = q.aircraft.find((a) => a.level !== 'no')!;
    placeBid(g, t!.id, { rate: Math.round(q.budget * 0.97), mgh: q.mgh, aircraftId: ac.id, crew: 'ours', start: q.start, end: q.end });
    t!.rivals = [];
    t!.status = 'closed';
    t!.bid!.aircraftId = 'gone';
    decideTender(g, t!);
    const o = g.offers[t!.result!.offerId!];
    const r = counterOffer(g, o.id, Math.round(t!.bid!.rate * 1.15), [ac.id]);
    expect(r.ok).toBe(false);
    expect(o.status).toBe('open');
  });
});

describe('COMM-L1/L3/L6 trips and withdrawn tenders', () => {
  it('a closure before departure refunds the seats too, and the trip shows what was paid', () => {
    const g = newGame(28);
    bookTrip(g, 'ceo', { fairId: 'routesEurope' });
    const t = com(g).trips[0];
    const cash = g.company.cash;
    const paid = t.cost.tickets + t.cost.pass;
    g.world!.events.push({ id: 'weY', kind: 'disaster', tpl: 'x', title: 'Antalya closed', body: '', country: 'TR', at: 'AYT', start: g.now, end: t.back.sta + 30 * DAY, airportClosedUntil: t.back.sta + 30 * DAY, offerIds: [], flightsHit: 0, ev: 0, workLeft: [] } as never);
    dailyTrips(g);
    expect(t.status).toBe('cancelled');
    expect(g.company.cash - cash).toBe(paid);
    expect(t.cost).toEqual({ tickets: 0, pass: 0, hotel: 0, perDiem: 0 });
  });

  it('a tender withdrawn with our bid is in the results and the news says so', () => {
    const g = at(newGame(9), fromUTC(2027, 11, 10));
    checksDone(g);
    let t = null as ReturnType<typeof issueTender>;
    for (let i = 0; i < 10 && !t; i++) t = issueTender(g);
    const q = bidQuote(g, t!.id)!;
    placeBid(g, t!.id, { rate: q.budget, mgh: q.mgh, aircraftId: q.aircraft.find((a) => a.level !== 'no')!.id, crew: 'ours', start: q.start, end: q.end });
    const cl = g.clients[t!.clientId];
    for (const x of Object.values(g.contracts)) if (x.clientId === cl.id) x.status = 'completed';
    expect(startCrisis(g, 'bankruptcy', cl.id)).toBeTruthy();
    expect(t!.status).toBe('withdrawn');
    expect(tenderBoard(g).results.map((x) => x.id)).toContain(t!.id);
    expect(g.messages.some((m) => m.title.includes('administration') && /withdrawn, with our bid/.test(m.body))).toBe(true);
  });
});

describe('COMM-L2 / UI-11 the favour chip', () => {
  it('relation past the bar names the jobs still missing', () => {
    const g = newGame(5);
    const c = Object.values(g.clients).find((x) => !x.rivalId)!;
    c.jobs = 1;
    c.level = 'known';
    c.relation = 40;
    const chip = favourChip(g, c.id, 4);
    expect(chip).not.toMatch(/\d+\/\d+ to Trusted/);
    expect(chip).toMatch(/more jobs? to Trusted/);
    c.relation = 10;
    expect(favourChip(g, c.id, 2)).toMatch(/12\/30 to Trusted/);
  });
});

describe('COMM-L4 no ordinary offer in a quiet spell', () => {
  it('a spawn that lands on a quiet day makes nothing and queues the next', () => {
    const g = newGame(6);
    const d = g.director!;
    d.spells = [[g.now - DAY, g.now + 10 * DAY, 0]] as never;
    const n = Object.keys(g.offers).length;
    const q = g.queue.filter((e) => e.type === 'offer.spawn').length;
    onOfferSpawn(g, { t: g.now, seq: 0, type: 'offer.spawn', id: '', v: 0 });
    expect(Object.keys(g.offers).length).toBe(n);
    expect(g.queue.filter((e) => e.type === 'offer.spawn').length).toBe(q + 1);
  });
});

describe('COMM-L5 the pace a Newcomer is promised', () => {
  it('about 1–2 ordinary offers a week, and the outlook counts the season', () => {
    const g = newGame(7, 'LIS', true);
    expect(BAL.marketOffers.perWeek[0]).toBeLessThanOrEqual(1.2);
    g.now = fromUTC(2027, 4, 10);
    const t1 = marketOutlook(g).offersText;
    g.now = fromUTC(2027, 1, 10);
    const t2 = marketOutlook(g).offersText;
    // April (1.2) and January (0.7) differ.
    expect(t1).not.toBe(t2);
    expect(t1).toMatch(/urgent calls, repeat work and leads come on top/);
  });
});

describe('h-comm suspects: crises', () => {
  it('one request per airline in a crisis; a client is not hit again for months; a paid claim reads paid', () => {
    let pairs = 0;
    let made = 0;
    for (const seed of [1, 3, 4, 6, 8]) {
      for (const kind of ['strike', 'grounding'] as const) {
        const g = newGame(seed);
        const x = startCrisis(g, kind);
        if (!x) continue;
        made++;
        const e = g.world!.events.find((v) => v.id === x.eventId)!;
        const by = new Map<string, number>();
        for (const id of e.offerIds) by.set(g.offers[id].clientId, (by.get(g.offers[id].clientId) ?? 0) + 1);
        pairs += [...by.values()].filter((v) => v > 1).length;
        // The same client: not within clientGap days of its end.
        g.now = x.end + 10 * DAY;
        expect(startCrisis(g, kind, x.clientId)).toBeNull();
        g.now = x.end + (CRISIS.clientGap + 1) * DAY;
        newDirector(g, 'normal');
      }
    }
    expect(made).toBeGreaterThan(4);
    expect(pairs).toBe(0);
    // The claim.
    const g = newGame(2);
    const cl = Object.values(g.clients).find((c) => c.kind === 'airline' && !c.rivalId && c.name === 'Condor')!;
    g.finance.receivables.push({ id: 'rx', clientId: cl.id, contractId: null, desc: 'Test', amount: 100_000, issued: g.now, due: g.now + 30 * DAY, payAt: g.now + 30 * DAY, paid: null, cat: 'acmiRevenue' } as never);
    const x = startCrisis(g, 'bankruptcy', cl.id)!;
    expect(x.claim).toBeDefined();
    expect(clientCrisisCard(g, x.eventId)!.hurt.text).toMatch(/may pay back/);
    x.claim!.paid = x.claim!.payAt;
    const card = clientCrisisCard(g, x.eventId)!;
    expect(card.hurt.text).toMatch(/paid back/);
    expect(card.hurt.text).not.toMatch(/may pay back/);
  });

  it('a rival never takes a call while it is ringing', () => {
    const g = newGame(13);
    let calls = 0;
    for (let i = 0; i < 60; i++) {
      const o = generateOffer(g, 'aogCover', { wide: false, window: false, start: g.now + 20 * 60 });
      if (!o) continue;
      if (o.call) {
        o.rivalBid = undefined;
        rollRivalBid(g, o);
        const b = o.rivalBid as { at: number } | undefined;
        if (b) {
          calls++;
          expect(b.at).toBeGreaterThanOrEqual(o.expires);
        }
      }
      delete g.offers[o.id];
    }
    expect(calls).toBeGreaterThan(0);
  });
});

describe('UI-4 / UI-8 / UI-12 wording', () => {
  it("a base programme's days are the base's local days", () => {
    const g = newGame(5);
    const o = hamBase(g, fromUTC(2027, 6, 1), 60);
    const [a, b] = jobDays(o);
    expect(a).toBe(fmtDay(toLocal('HAM', o.start)));
    expect(b).toBe(fmtDay(toLocal('HAM', o.end - 1)));
    expect(a).toBe('1 Jun');
  });

  it("separate flights read 'MGQ–LIS ×3', a chain stays a chain", () => {
    expect(legsRoute([{ from: 'MGQ', to: 'LIS' }, { from: 'MGQ', to: 'LIS' }, { from: 'MGQ', to: 'LIS' }])).toBe('MGQ–LIS ×3');
    expect(legsRoute([{ from: 'LIS', to: 'FAO' }, { from: 'FAO', to: 'LIS' }])).toBe('LIS–FAO–LIS');
    expect(legsRoute([{ from: 'ADD', to: 'LIS' }, { from: 'MGQ', to: 'LIS' }])).toBe('ADD–LIS, MGQ–LIS');
  });

  it("'one more day' to the next standing, never '1 days'", () => {
    const g = newGame(5, 'LIS', true);
    g.started = g.now - (BAL.v08.standing.est.days - 1) * DAY;
    expect(standing(g).next).not.toMatch(/\b1 days\b/);
    expect(standing(g).next).toMatch(/one more day/);
  });
});
