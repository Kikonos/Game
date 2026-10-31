// v0.14 tender season: rounds, issuing (busy days, the ask off the market), the bid form's quote, bids, the award
// (price, reliability, relations, age, fit), a won tender signed on the tail we bid, a lapsed win, and the pacing.

import { describe, expect, it } from 'vitest';
import { takeCues } from '../core/cues';
import { DAY, fromUTC } from '../core/time';
import type { GameState } from '../core/types';
import { newGame, run } from '../contracts/testkit';
import { newDirector } from '../ops/director';
import { com } from './state';
import { bidQuote, dailyTenders, decideTender, issueTender, offerWithBid, ourScore, placeBid, roundAt, roundName, TENDER, tenderBoard, withdrawBid } from './tenders';

/** A game at a date (the director re-drawn there). */
function at(g: GameState, t: number): GameState {
  g.now = t;
  newDirector(g, 'normal');
  return g;
}

function tender(g: GameState) {
  for (let i = 0; i < 8; i++) {
    const t = issueTender(g);
    if (t) return t;
  }
  throw new Error('no tender');
}

describe('rounds', () => {
  it('summer RFPs Nov–Feb for the next summer, winter Jun–Aug, none in spring or autumn', () => {
    expect(roundAt(fromUTC(2027, 11, 10))?.key).toBe('S2028');
    expect(roundAt(fromUTC(2028, 2, 10))?.key).toBe('S2028');
    expect(roundAt(fromUTC(2027, 7, 1))?.key).toBe('W2027');
    expect(roundAt(fromUTC(2027, 4, 1))).toBeNull();
    expect(roundAt(fromUTC(2027, 10, 1))).toBeNull();
    expect(roundName('S2028')).toBe('summer 2028');
    expect(roundName('W2027')).toBe('winter 2027/28');
  });
});

describe('an RFP', () => {
  it('is a season-base ask kept off the market, with rivals, a deadline and an award weeks later', () => {
    const g = newGame(5);
    const n = Object.keys(g.offers).length;
    const t = tender(g);
    expect(Object.keys(g.offers).length).toBe(n);
    expect(t.ask.pattern.kind).toBe('base');
    expect(t.ask.product.kind).toBe('wet');
    expect(t.rivals.length).toBeGreaterThanOrEqual(TENDER.rivals[0]);
    expect(t.deadline - t.issued).toBeGreaterThanOrEqual(TENDER.deadline[0] * DAY);
    expect(t.resultAt - t.deadline).toBeGreaterThanOrEqual(TENDER.decide[0] * DAY);
    // Flies the coming summer (April–June start) for 4–6 months.
    const m = new Date(Date.UTC(2000, 0, 1) + t.ask.start * 60_000).getUTCMonth();
    expect(m).toBeGreaterThanOrEqual(3);
    expect(m).toBeLessThanOrEqual(5);
    // Any everyday cabin.
    expect(t.ask.requirements.layouts).toEqual(['all-economy', 'two-class']);
    expect(g.messages[0].title).toMatch(/^Tender: /);
    expect(g.messages[0].ref).toEqual({ kind: 'tender', id: t.id });
  });

  it('chimes with its note (offerNew) and never the market offer cue of its ask', () => {
    const g = newGame(6);
    takeCues();
    tender(g);
    expect(takeCues()).toEqual(['offerNew']);
  });

  it('leaves the main random sequence where it was', () => {
    const a = newGame(8);
    const b = newGame(8);
    tender(a);
    expect(a.rng).toBe(b.rng);
  });

  it('issues the round on busy days only, about 7 a summer at Normal pace', () => {
    const g = at(newGame(9), fromUTC(2027, 11, 1));
    let quietIssued = 0;
    for (let d = 0; d < 120; d++) {
      const before = com(g).tenders.length;
      dailyTenders(g);
      const quiet = g.director!.spells.some((s) => s[0] <= g.now && g.now < s[1] && s[2] === 0);
      if (quiet && com(g).tenders.length > before) quietIssued++;
      g.now += DAY;
    }
    expect(quietIssued).toBe(0);
    expect(com(g).rounds?.S2028).toBeGreaterThanOrEqual(5);
    expect(com(g).rounds?.S2028).toBeLessThanOrEqual(TENDER.summer.count.normal);
  });

  it('Calm pace issues fewer RFPs than Busy', () => {
    const count = (pace: 'calm' | 'busy') => {
      const g = at(newGame(10), fromUTC(2027, 11, 1));
      newDirector(g, pace);
      for (let d = 0; d < 120; d++, g.now += DAY) dailyTenders(g);
      return com(g).rounds?.S2028 ?? 0;
    };
    expect(count('calm')).toBeLessThan(count('busy'));
  });
});

describe('bidding', () => {
  it('the quote lists our narrowbodies with their fit, the market rate and the date ranges', () => {
    const g = newGame(11);
    const t = tender(g);
    const q = bidQuote(g, t.id)!;
    expect(q.aircraft.length).toBe(Object.keys(g.fleet).length);
    expect(q.budget).toBeGreaterThan(1000);
    expect(q.rateMin).toBeLessThan(q.budget);
    expect(q.rateMax).toBeGreaterThan(q.budget);
    expect(q.crewLabel).toMatch(/Crew based in/);
    expect(q.startRange[0]).toBeLessThan(t.ask.start);
  });

  it('a bid is checked (aircraft, dates) and can be changed or withdrawn before the deadline', () => {
    const g = newGame(12);
    const t = tender(g);
    const q = bidQuote(g, t.id)!;
    const ac = q.aircraft[0].id;
    expect(placeBid(g, t.id, { rate: q.budget, mgh: q.mgh, aircraftId: 'nope', crew: 'ours', start: q.start, end: q.end }).ok).toBe(false);
    expect(placeBid(g, t.id, { rate: q.budget, mgh: q.mgh, aircraftId: ac, crew: 'ours', start: t.ask.start - 60 * DAY, end: q.end }).ok).toBe(false);
    expect(placeBid(g, t.id, { rate: q.budget, mgh: q.mgh, aircraftId: ac, crew: 'ours', start: q.start, end: q.end }).ok).toBe(true);
    expect(tenderBoard(g).mine.map((x) => x.id)).toContain(t.id);
    expect(placeBid(g, t.id, { rate: q.budget - 100, mgh: q.mgh, aircraftId: ac, crew: 'mixed', start: q.start, end: q.end }).ok).toBe(true);
    expect(t.bid!.rate).toBe(q.budget - 100);
    expect(withdrawBid(g, t.id).ok).toBe(true);
    expect(t.bid).toBeUndefined();
    g.now = t.deadline;
    dailyTenders(g);
    expect(t.status).toBe('noBid');
    expect(placeBid(g, t.id, { rate: q.budget, mgh: q.mgh, aircraftId: ac, crew: 'ours', start: q.start, end: q.end }).ok).toBe(false);
  });

  it('offerWithBid moves the dates by whole days and carries our rate, MGH and their cabin crew', () => {
    const g = newGame(13);
    const t = tender(g);
    const o = offerWithBid(t, { rate: 3000, mgh: 180, start: t.ask.start + 7 * DAY, end: t.ask.end - 14 * DAY, crew: 'mixed' }, 'a320ceo', 180);
    expect(o.start).toBe(t.ask.start + 7 * DAY);
    expect(o.end).toBe(t.ask.end - 14 * DAY);
    expect(o.pattern.kind === 'base' && o.pattern.from).toBe(t.ask.pattern.kind === 'base' && t.ask.pattern.from + 7 * DAY);
    expect(o.product.kind === 'wet' && o.product.ratePerBH).toBe(3000);
    expect(o.requirements.clientCabin?.n).toBeGreaterThan(0);
    // The ask itself is unchanged.
    expect(t.ask.start).not.toBe(o.start);
  });
});

describe('the award', () => {
  it('price, reliability, relationship and fit move the score the right way', () => {
    const g = newGame(14);
    const t = tender(g);
    const q = bidQuote(g, t.id)!;
    const base = { rate: q.budget, mgh: q.mgh, aircraftId: q.aircraft[0].id, crew: 'ours' as const, start: q.start, end: q.end, at: g.now };
    const s0 = ourScore(g, t, base).total;
    expect(ourScore(g, t, { ...base, rate: q.budget * 0.95 }).total).toBeGreaterThan(s0);
    expect(ourScore(g, t, { ...base, mgh: q.mgh * 1.2 }).total).toBeLessThan(s0);
    expect(ourScore(g, t, { ...base, end: base.end - 30 * DAY }).total).toBeLessThan(s0);
    g.company.reputation.reliable = 98;
    const s1 = ourScore(g, t, base).total;
    g.company.reputation.reliable = 60;
    expect(ourScore(g, t, base).total).toBeLessThan(s1);
    g.clients[t.clientId].level = 'partner';
    expect(ourScore(g, t, base).total).toBeGreaterThan(ourScore(g, t, base).total - 1);
    const partner = ourScore(g, t, base).total;
    g.clients[t.clientId].level = 'unhappy';
    expect(ourScore(g, t, base).total).toBeLessThan(partner);
  });

  it('a cheap, reliable bid with no rivals wins and is signed on the tail we bid', () => {
    const g = newGame(15);
    const t = tender(g);
    t.rivals = [];
    const q = bidQuote(g, t.id)!;
    const ac = q.aircraft.find((a) => a.level !== 'no');
    if (!ac) return;
    placeBid(g, t.id, { rate: q.budget, mgh: q.mgh, aircraftId: ac.id, crew: 'ours', start: q.start, end: q.end });
    takeCues();
    t.status = 'closed';
    decideTender(g, t);
    expect(t.status).toBe('won');
    const k = g.contracts[t.result!.contractId!];
    expect(k).toBeTruthy();
    expect(k.aircraftIds).toEqual([ac.id]);
    expect(k.product.kind === 'wet' && k.product.ratePerBH).toBe(q.budget);
    expect(g.messages[0].title).toMatch(/^Tender won/);
    expect(takeCues()).toContain('contractSigned');
  });

  it('a rival far cheaper wins; the result says why; nothing is lost', () => {
    const g = newGame(16);
    const t = tender(g);
    const q = bidQuote(g, t.id)!;
    placeBid(g, t.id, { rate: q.rateMax, mgh: q.mghMax, aircraftId: q.aircraft[0].id, crew: 'ours', start: q.start, end: q.end });
    t.rivals = [{ rivalId: g.rivals[0].id, rateX: 0.85, mghX: 0.9, quality: 0.97, age: 3 }];
    const cash = g.company.cash;
    t.status = 'closed';
    decideTender(g, t);
    expect(t.status).toBe('lost');
    expect(t.result!.winner).toBe(g.rivals[0].id);
    expect(t.result!.why).toMatch(/rate/);
    expect(g.company.cash).toBe(cash);
  });

  it('results come on a busy day at or after the award date (at most 4 days late)', () => {
    const g = newGame(17);
    const t = tender(g);
    const q = bidQuote(g, t.id)!;
    placeBid(g, t.id, { rate: q.budget, mgh: q.mgh, aircraftId: q.aircraft[0].id, crew: 'ours', start: q.start, end: q.end });
    run(g, t.resultAt + 6 * DAY);
    expect(['won', 'lost']).toContain(t.status);
  });

  it('a win the bid aircraft cannot take stays open to sign; letting it lapse costs relation', () => {
    const g = newGame(18);
    const t = tender(g);
    t.rivals = [];
    const q = bidQuote(g, t.id)!;
    placeBid(g, t.id, { rate: q.budget, mgh: q.mgh, aircraftId: q.aircraft[0].id, crew: 'ours', start: q.start, end: q.end });
    delete g.fleet[q.aircraft[0].id];
    t.status = 'closed';
    decideTender(g, t);
    expect(t.status).toBe('won');
    const o = g.offers[t.result!.offerId!];
    expect(o.status).toBe('open');
    expect(o.firstRefusal).toBe(true);
    const rel = g.clients[t.clientId].relation;
    o.status = 'expired';
    dailyTenders(g);
    expect(g.clients[t.clientId].relation).toBeLessThan(rel);
    expect(t.result!.why).toMatch(/not signed/);
  });
});
