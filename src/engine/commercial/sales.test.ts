// v0.16 Sales (UPDATE-0.16.md §C): brokers (register, relation, leads on busy days, deals credited, monthly drift),
// pre-season pitches (window, quota, replies in 14–42 days, the three answers), regional sales managers (candidates,
// hire, pay, their leads, dismissal), tenders by level, and a save round trip of the pipeline.

import { describe, expect, it } from 'vitest';
import './index';
import { BAL } from '../core/balance';
import { takeCues } from '../core/cues';
import { DAY, fromUTC, monthKey, monthStart } from '../core/time';
import type { GameState } from '../core/types';
import { acceptOffer } from '../contracts/accept';
import { generateOffer } from '../contracts/offers';
import { clientPrestige, playerPrestige } from '../contracts/prestige';
import { newGame } from '../contracts/testkit';
import { director, newDirector } from '../ops/director';
import { deserialize, serialize } from '../save';
import {
  BROKER_VISIT, brokerFit, brokerLeadsPerMonth, brokerView, dailySales, fireSalesRep, hireSalesRep, leadsView, monthlySales, pitchAirline, pitchQuota, pitchTargets, pitchWindow, pitchesView,
  registerBroker, repCandidates, repRehireDays, salesBill, salesRepsView, visitBroker, workLead, workedCap,
} from './sales';
import { com } from './state';
import { dailyTenders } from './tenders';

const S = BAL.v016.sales;

/** Every day a busy one (the director's spells overridden): leads and answers come without waiting for a wave. */
function busy(g: GameState): void {
  director(g).spells = [[g.now - DAY, g.now + 900 * DAY, 1]];
}
function days(g: GameState, n: number): void {
  for (let i = 0; i < n; i++) {
    g.now += DAY;
    dailySales(g);
  }
}
/** A game at a date (the director re-drawn there), all days busy. */
function at(seed: number, t: number): GameState {
  const g = newGame(seed);
  g.now = t;
  g.started = t - 40 * DAY;
  newDirector(g, 'normal');
  busy(g);
  return g;
}

describe('brokers', () => {
  it('register once, free, relation 20; a visit buys +5 for $1,500, once a month', () => {
    const g = newGame(1);
    const cash = g.company.cash;
    expect(registerBroker(g, 'acs').ok).toBe(true);
    expect(g.company.cash).toBe(cash);
    expect(g.com!.brokers!.acs).toMatchObject({ relation: S.relation.register, deals: 0 });
    expect(registerBroker(g, 'acs').ok).toBe(false);
    expect(visitBroker(g, 'acc').ok).toBe(false);
    expect(visitBroker(g, 'acs').ok).toBe(true);
    expect(g.company.cash).toBe(cash - BROKER_VISIT.cost);
    expect(g.com!.brokers!.acs!.relation).toBe(S.relation.register + BROKER_VISIT.relation);
    expect(visitBroker(g, 'acs').ok).toBe(false);
    const v = brokerView(g);
    expect(v).toHaveLength(5);
    expect(v.find((b) => b.id === 'acs')!.canVisit).toBe(false);
    expect(v.find((b) => b.id === 'chapman')!.rel).toBeNull();
    expect(v.map((b) => b.commission)).toEqual([0.04, 0.05, 0.035, 0.045, 0.03]);
  });

  it('fit and leads a month: 0.35 a week × relation / 100 × fit', () => {
    const g = newGame(1);
    expect(brokerFit(g, 'acs')).toBe(1);
    expect(brokerFit(g, 'acc')).toBeGreaterThanOrEqual(0.4);
    expect(brokerLeadsPerMonth(g, 'acs', 100)).toBeCloseTo(0.35 * (365 / 12 / 7), 1);
    expect(brokerLeadsPerMonth(g, 'acs', 20)).toBeCloseTo(0.35 * 0.2 * (365 / 12 / 7), 1);
  });

  it('leads come on busy days, name a client at our level (one above at most) with a job, a value and a message', () => {
    const g = newGame(2);
    busy(g);
    registerBroker(g, 'acs');
    registerBroker(g, 'acc');
    g.com!.brokers!.acs!.relation = 100;
    g.com!.brokers!.acc!.relation = 100;
    g.now += 8 * DAY;
    takeCues();
    days(g, 60);
    const leads = leadsView(g);
    expect(leads.length).toBeGreaterThanOrEqual(2);
    const lvl = playerPrestige(g).level;
    for (const l of leads) {
      expect(['acs', 'acc']).toContain(l.brokerId);
      expect(clientPrestige(g.clients[l.clientId])).toBeLessThanOrEqual(lvl + 1);
      expect(l.value).toBeGreaterThan(0);
      expect(l.title).toBeTruthy();
      expect(l.why).toMatch(/^From (Air Charter Service|ACC Aviation)\./);
    }
    expect(g.messages.some((m) => /^Lead from (Air Charter Service|ACC Aviation): /.test(m.title) && m.ref?.kind === 'lead')).toBe(true);
    expect(takeCues()).toContain('message');
    // No offers were left on the market by the pricing drafts.
    expect(Object.values(g.offers).some((o) => o.leadId)).toBe(false);
  });

  it('a deal flown ≥ 90 % on time: +6 and a deal counted; a cancelled one −10; the floor is 10', () => {
    const g = newGame(3);
    registerBroker(g, 'acs');
    const ac = Object.values(g.fleet)[0];
    const client = Object.values(g.clients).find((c) => c.kind === 'tourOperator')!;
    const o = generateOffer(g, 'adhoc', { client: client.id, brokerId: 'acs', window: false, wide: false, paint: false, cabin: false, start: g.now + 20 * DAY })!;
    expect(o.brokerId).toBe('acs');
    expect(o.broker).toBe('Air Charter Service');
    const res = acceptOffer(g, o.id, [ac.id]);
    expect(res.ok).toBe(true);
    const c = g.contracts[res.data!.contractId];
    expect(c.brokerId).toBe('acs');
    c.status = 'completed';
    c.legsFlown = 10;
    c.legsOnTime = 10;
    dailySales(g);
    expect(g.com!.brokers!.acs).toMatchObject({ relation: 26, deals: 1 });
    expect(c.brokerDone).toBe(true);
    dailySales(g);
    expect(g.com!.brokers!.acs!.relation).toBe(26);
    c.status = 'cancelled';
    delete c.brokerDone;
    dailySales(g);
    expect(g.com!.brokers!.acs!.relation).toBe(16);
    g.com!.brokers!.acs!.relation = 12;
    delete c.brokerDone;
    dailySales(g);
    expect(g.com!.brokers!.acs!.relation).toBe(S.relation.floor);
  });

  it('drifts −1 a month with nothing flown through them, down to 10', () => {
    const g = newGame(1);
    registerBroker(g, 'acs');
    const rel = g.com!.brokers!.acs!;
    rel.since = g.now - 100 * DAY;
    rel.relation = 11;
    g.finance.current.month = monthKey(g.now);
    monthlySales(g);
    expect(rel.relation).toBe(10);
    monthlySales(g);
    expect(rel.relation).toBe(10);
    rel.relation = 40;
    rel.lastDeal = g.now;
    monthlySales(g);
    expect(rel.relation).toBe(40);
  });
});

describe('pitches', () => {
  it('summer cover is pitched October to February, winter cover April to August', () => {
    const g = newGame(1);
    g.now = fromUTC(2027, 11, 10);
    expect(pitchWindow(g)).toMatchObject({ season: 'S2028', label: 'summer 2028', kind: 'summer' });
    g.now = fromUTC(2028, 2, 3);
    expect(pitchWindow(g)?.season).toBe('S2028');
    g.now = fromUTC(2028, 6, 1);
    expect(pitchWindow(g)).toMatchObject({ season: 'W2028', label: 'winter 2028/29' });
    g.now = fromUTC(2028, 3, 15);
    expect(pitchWindow(g)).toBeNull();
    expect(pitchAirline(g, Object.values(g.clients)[0].id).ok).toBe(false);
  });

  it('targets are airlines at our level or one above; 4 a season; $1,500 each; answered in 14–42 days', () => {
    const g = at(4, fromUTC(2027, 11, 5));
    const lvl = playerPrestige(g).level;
    const ts = pitchTargets(g);
    expect(ts.length).toBeGreaterThan(4);
    for (const t of ts) expect(t.level).toBeLessThanOrEqual(lvl + 1);
    expect(pitchQuota(g)).toEqual({ used: 0, max: S.pitch.perSeason });
    const cash = g.company.cash;
    let n = 0;
    for (const t of ts) {
      const r = pitchAirline(g, t.client.id);
      if (!r.ok) {
        expect(r.error).toMatch(/4 pitches a season/);
        break;
      }
      n++;
    }
    expect(n).toBe(S.pitch.perSeason);
    expect(g.company.cash).toBe(cash - S.pitch.perSeason * S.pitch.cost);
    expect(pitchAirline(g, ts[0].client.id).ok).toBe(false);
    for (const p of com(g).pitches!) {
      const d = (p.replyAt - p.at) / DAY;
      expect(d).toBeGreaterThanOrEqual(S.pitch.replyDays[0]);
      expect(d).toBeLessThanOrEqual(S.pitch.replyDays[1]);
      expect(p.result).toBeUndefined();
    }
    expect(pitchesView(g)[0].status).toMatch(/^Answer about /);
  });

  it('answers: maybe (a proposal-stage lead), yes (a season-base offer 60–120 days before the season) or no, each with its message', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 20; seed++) {
      const g = at(seed, fromUTC(2027, 11, 5));
      const t = pitchTargets(g)[0];
      expect(pitchAirline(g, t.client.id).ok).toBe(true);
      const p = com(g).pitches![0];
      days(g, 43);
      expect(p.result).toBeDefined();
      seen.add(p.result!);
      if (p.result === 'maybe') {
        const l = com(g).leads!.find((x) => x.id === p.leadId)!;
        expect(l.source).toBe('pitch');
        expect(l.archetype).toBe('seasonBase');
        expect(['proposal', 'negotiation', 'lost']).toContain(l.stage);
        expect(g.messages.some((m) => m.title.startsWith(`${t.client.name}: maybe`))).toBe(true);
      } else if (p.result === 'offer') {
        expect(p.offerAt).toBeDefined();
        const start = fromUTC(2028, 5, 1);
        expect(p.offerAt!).toBeLessThanOrEqual(start + 45 * DAY - S.pitch.offerLead[0] * DAY);
        expect(g.messages.some((m) => m.title.startsWith(`${t.client.name}: yes`))).toBe(true);
        // The offer itself, when its day comes: a season base for that airline, carrying the lead.
        g.now = p.offerAt! - DAY;
        days(g, 2);
        const l = com(g).leads!.find((x) => x.id === p.leadId);
        if (l?.offerId) {
          const o = g.offers[l.offerId];
          expect(o.archetype).toBe('seasonBase');
          expect(o.clientId).toBe(t.client.id);
          expect(o.leadId).toBe(l.id);
          expect(o.start).toBeGreaterThanOrEqual(start);
          expect(o.firstRefusal).toBe(true);
        }
      } else {
        expect(g.messages.some((m) => m.title.startsWith(`${t.client.name}: no, thank you`))).toBe(true);
      }
    }
    expect(seen).toEqual(new Set(['maybe', 'offer', 'no']));
  });
});

describe('sales managers', () => {
  it('three candidates per market; one per market, up to 4; joins in 14 days; pay pro-rated; leads in their market', () => {
    const g = newGame(5);
    busy(g);
    const cands = repCandidates(g, 'seu');
    expect(cands).toHaveLength(3);
    expect(cands.map((c) => c.salary)).toEqual([4_500, 6_000, 8_100]);
    expect(repCandidates(g, 'nowhere')).toEqual([]);
    expect(hireSalesRep(g, 'seu', 1).ok).toBe(true);
    expect(hireSalesRep(g, 'seu', 0).ok).toBe(false);
    const rep = g.com!.reps![0];
    expect(rep.joins - rep.hired).toBe(S.reps.joinDays * DAY);
    expect(workedCap(g)).toBe(S.lead.workedBase);
    expect(salesRepsView(g)[0].status).toMatch(/^Joins /);
    // Pay from the day they join, pro-rated (the month-end bill reads the same number).
    const k = monthKey(rep.joins);
    const a = monthStart(k), b = monthStart(k + 1);
    expect(salesBill(g, k)).toBe(Math.round(6_000 * ((b - Math.max(a, rep.joins)) / (b - a))));
    expect(salesBill(g, k - 1)).toBe(rep.joins >= monthStart(k) ? 0 : salesBill(g, k - 1));
    for (const m of ['nwe', 'cee', 'me']) expect(hireSalesRep(g, m, 0).ok).toBe(true);
    expect(hireSalesRep(g, 'nam', 0).ok).toBe(false);
    g.now += 20 * DAY;
    expect(workedCap(g)).toBe(S.lead.workedBase + 4 * S.lead.workedPerRep);
    expect(pitchQuota(g).max).toBe(S.pitch.perSeason + 4 * S.reps.pitches);
    days(g, 90);
    const leads = leadsView(g).filter((l) => l.source === 'staff');
    expect(leads.length).toBeGreaterThanOrEqual(2);
    for (const l of leads) {
      const r = g.com!.reps!.find((x) => x.id === l.repId)!;
      expect(l.market).toBe(r.market);
    }
    // Each manager counts every lead found (closed ones leave the pipeline after a month).
    expect(g.com!.reps!.reduce((s, r) => s + r.leads, 0)).toBeGreaterThanOrEqual(leads.length);
  });

  it('a dismissal costs a month, empties the candidates and brings new ones after 30 days', () => {
    const g = newGame(6);
    hireSalesRep(g, 'seu', 2);
    const rep = g.com!.reps![0];
    const cash = g.company.cash;
    expect(fireSalesRep(g, rep.id).ok).toBe(true);
    expect(g.company.cash).toBe(cash - 8_100);
    expect(g.com!.reps).toEqual([]);
    expect(repCandidates(g, 'seu')).toEqual([]);
    expect(repRehireDays(g)).toBe(S.reps.rehireDays);
    g.now += S.reps.rehireDays * DAY;
    expect(repRehireDays(g)).toBe(0);
    expect(repCandidates(g, 'seu')).toHaveLength(3);
    expect(fireSalesRep(g, rep.id).ok).toBe(false);
  });
});

describe('tenders matter more', () => {
  it('a round issues more RFPs at a higher level (+1 at level 2, +2 at level 3 and up)', () => {
    const count = (level: 1 | 3) => {
      const g = at(7, fromUTC(2027, 11, 2));
      g.company.prestige = { level, visibility: 0, levelAt: {} };
      for (let i = 0; i < 100; i++) {
        g.now += DAY;
        dailyTenders(g);
      }
      return com(g).rounds?.S2028 ?? 0;
    };
    const base = count(1), high = count(3);
    expect(base).toBeLessThanOrEqual(7);
    expect(high).toBeLessThanOrEqual(9);
    expect(high).toBeGreaterThanOrEqual(base);
  });
});

describe('saves', () => {
  it('the pipeline, brokers, pitches and managers round-trip through a save', () => {
    const g = at(8, fromUTC(2027, 11, 5));
    registerBroker(g, 'acs');
    g.com!.brokers!.acs!.relation = 100;
    hireSalesRep(g, 'nwe', 1);
    pitchAirline(g, pitchTargets(g)[0].client.id);
    days(g, 40);
    const l = com(g).leads!.find((x) => x.stage === 'lead');
    if (l) workLead(g, l.id);
    const g2 = deserialize(serialize(g));
    expect(g2.com!.leads).toEqual(g.com!.leads);
    expect(g2.com!.brokers).toEqual(g.com!.brokers);
    expect(g2.com!.pitches).toEqual(g.com!.pitches);
    expect(g2.com!.reps).toEqual(g.com!.reps);
    expect(leadsView(g2).map((x) => x.stageName)).toEqual(leadsView(g).map((x) => x.stageName));
  });
});
