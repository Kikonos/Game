// v0.19.4 "Widebody tenders": widebody RFPs and bids, leads that keep their body, work weighted by the fleet, the
// out-of-reach double-decker job's frequency, ETOPS 180 measured on the ETOPS fleet (with its programme and breakdown),
// and saves (older ones load: the record by aircraft starts at the load, live leads get a body).

import { describe, expect, it } from 'vitest';
import './commercial';
import { BAL } from './core/balance';
import { DAY, fromUTC } from './core/time';
import type { Aircraft, GameState } from './core/types';
import { newGame } from './contracts/testkit';
import { devAddType, devGrantApproval } from './dev';
import { newDirector, director } from './ops/director';
import { generateOffer, fleetCouldFly } from './contracts/offers';
import { bodyOfReq } from './contracts/shape';
import { fleetOutlook, reachOpen } from './contracts/fleetFit';
import { playerPrestige, PRESTIGE_GATE } from './contracts/prestige';
import {
  bidAircraft, bidQuote, dailyTenders, hajjTenderFor, issueTender, issueWideTender, placeBid, roundAt, tenderRow, wideTenderEligible, wideTenderWant,
} from './commercial/tenders';
import { dailySales, fairLead, leadsView, loadSales, pitchAirline, pitchTargets, pitchesView, workLead } from './commercial/sales';
import { com } from './commercial/state';
import { approvalReqs, aogChance, etopsRecord, joinRelProgramme, relFactors, relProgState } from './ops';
import { etopsCheckChance } from './ops/etopsRel';
import { noteDispatch, noteTechCancel, seedTechLog } from './core/techLog';
import { deserialize, serialize } from './save';
import { typeOf } from './core/perf';

/** A game at a date (the director re-drawn there, every day busy). */
function at(g: GameState, t: number): GameState {
  g.now = t;
  newDirector(g, 'normal');
  director(g).spells = [[g.now - DAY, g.now + 900 * DAY, 1]];
  return g;
}

/** A level-3 style airline: Widebody operations, ETOPS 120, two A330s besides the start narrowbodies, checks fresh. */
function wideGame(seed = 1, t = fromUTC(2027, 11, 5)): GameState {
  const g = at(newGame(seed), t);
  for (const id of ['widebody', 'etops120'] as const) devGrantApproval(g, id);
  devAddType(g, 'a332');
  devAddType(g, 'a333');
  for (const a of Object.values(g.fleet)) {
    a.maint.lastC = g.now;
    a.maint.lastA = g.now;
    a.maint.fhSinceA = 0;
    a.maint.fhSinceC = 0;
  }
  return g;
}

const wides = (g: GameState) => Object.values(g.fleet).filter((a) => typeOf(a.typeId).body === 'wide');
const narrows = (g: GameState) => Object.values(g.fleet).filter((a) => typeOf(a.typeId).body === 'narrow');

describe('widebody tenders', () => {
  it('come only with Widebody operations and a widebody of ours, one or more a round by level', () => {
    const g = at(newGame(1), fromUTC(2027, 11, 5));
    expect(wideTenderEligible(g)).toBe(false);
    expect(wideTenderWant(g)).toBe(0);
    devGrantApproval(g, 'widebody');
    expect(wideTenderEligible(g)).toBe(false);
    devAddType(g, 'a332');
    expect(wideTenderEligible(g)).toBe(true);
    expect(wideTenderWant(g)).toBeGreaterThanOrEqual(1);
    expect(BAL.v0194.tenders.wide[4]).toBeGreaterThan(BAL.v0194.tenders.wide[1]);
  });

  it('a summer long-haul RFP asks for a widebody: the fit list shows only widebodies, a narrowbody bid is refused, a widebody one goes', () => {
    const g = wideGame(1);
    const round = roundAt(g.now)!;
    let t = null;
    for (let i = 0; i < 6 && !t; i++) t = issueWideTender(g, { round, kind: 'summerLong' });
    expect(t).not.toBeNull();
    expect(t!.wide).toBe(true);
    expect(bodyOfReq(t!.ask.requirements)).toBe('wide');
    expect(g.offers[t!.ask.id]).toBeUndefined();
    const row = tenderRow(g, t!);
    expect(row.body).toBe('wide');
    expect(row.wanted).toMatch(/widebody/);
    const fits = bidAircraft(g, t!.id);
    expect(fits.length).toBe(wides(g).length);
    for (const f of fits) expect(typeOf(g.fleet[f.id].typeId).body).toBe('wide');
    const q = bidQuote(g, t!.id)!;
    expect(q.wide).toBe(true);
    const terms = { rate: q.budget, mgh: q.mgh, start: q.start, end: q.end, crew: 'ours' as const };
    const nb = narrows(g)[0];
    expect(placeBid(g, t!.id, { ...terms, aircraftId: nb.id })).toMatchObject({ ok: false, error: expect.stringMatching(/narrowbody: they want a widebody/) });
    const ok = fits.find((f) => f.level !== 'no');
    expect(ok).toBeDefined();
    expect(placeBid(g, t!.id, { ...terms, aircraftId: ok!.id }).ok).toBe(true);
    // A narrowbody RFP still refuses a widebody.
    let n = null;
    for (let i = 0; i < 8 && !n; i++) n = issueTender(g, { round });
    expect(n).not.toBeNull();
    expect(bidAircraft(g, n!.id).every((f) => typeOf(g.fleet[f.id].typeId).body === 'narrow')).toBe(true);
    const nq = bidQuote(g, n!.id)!;
    expect(placeBid(g, n!.id, { rate: nq.budget, mgh: nq.mgh, start: nq.start, end: nq.end, crew: 'ours', aircraftId: wides(g)[0].id })).toMatchObject({ ok: false, error: expect.stringMatching(/widebody: they want a narrowbody/) });
  });

  it('a Hajj RFP: real Hajj airlines, dates fixed by the calendar, seats sized to our widebodies', () => {
    const g = wideGame(2);
    const h = hajjTenderFor(g.now);
    expect(h).not.toBeNull();
    const round = roundAt(g.now)!;
    let t = null;
    for (let i = 0; i < 8 && !t; i++) t = issueWideTender(g, { round, kind: 'hajj' });
    expect(t).not.toBeNull();
    expect(t!.fixed).toBe(true);
    expect(t!.label).toBe(`Hajj ${h!.ah}`);
    expect(['Saudia', 'flynas', 'Garuda Indonesia', 'Biman Bangladesh Airlines', 'Pakistan International Airlines', 'Air Algérie']).toContain(g.clients[t!.clientId].name);
    expect(t!.ask.requirements.minSeats).toBeLessThanOrEqual(Math.max(...wides(g).map((a) => a.cabin.total)));
    expect(t!.ask.jumbo).toBeFalsy();
    const q = bidQuote(g, t!.id)!;
    expect(q.fixed).toBe(true);
    expect(q.startRange[0]).toBe(q.startRange[1]);
    const ac = wides(g)[0];
    expect(placeBid(g, t!.id, { rate: q.budget, mgh: q.mgh, start: q.start + 7 * DAY, end: q.end, crew: 'ours', aircraftId: ac.id })).toMatchObject({ ok: false, error: expect.stringMatching(/dates are fixed/) });
    expect(t!.resultAt).toBeLessThan(t!.ask.start);
  });

  it('the daily roll issues widebody RFPs in a round once eligible (and none without a widebody)', () => {
    const g = wideGame(3, fromUTC(2027, 10, 1));
    const plain = at(newGame(3), fromUTC(2027, 10, 1));
    for (let d = 0; d < 120; d++) {
      for (const x of [g, plain]) {
        x.now += DAY;
        director(x).spells = [[x.now - DAY, x.now + 900 * DAY, 1]];
        dailyTenders(x);
      }
    }
    const w = com(g).tenders.filter((t) => t.wide);
    expect(w.length).toBeGreaterThanOrEqual(1);
    expect(w.length).toBeLessThanOrEqual(wideTenderWant(g) + 1);
    expect(com(plain).tenders.some((t) => t.wide)).toBe(false);
    expect(com(g).tenders.some((t) => !t.wide)).toBe(true);
  });
});

describe('leads keep their body', () => {
  it('a lead records the body, seats and type it was quoted for, and its offer keeps the body', () => {
    let kept = 0;
    let wideLeads = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const g = wideGame(seed, fromUTC(2028, 3, 10));
      const cs = Object.values(g.clients).filter((c) => (c.kind === 'airline' || c.kind === 'tourOperator') && !c.rivalId).slice(0, 12);
      for (const c of cs) {
        const l = fairLead(g, c, `k${seed}:${c.id}`, 'ITB Berlin');
        if (!l) continue;
        expect(['narrow', 'wide']).toContain(l.body);
        expect(l.seats).toBeGreaterThan(0);
        if (l.body === 'wide') wideLeads++;
        expect(leadsView(g).find((x) => x.id === l.id)!.shown).toBe(l.body);
        if (workLead(g, l.id).ok) {
          for (let i = 0; i < 8 && l.stage === 'proposal'; i++) {
            g.now += DAY;
            dailySales(g);
          }
          if (l.stage === 'negotiation' && l.offerId) {
            expect(bodyOfReq(g.offers[l.offerId].requirements), `${c.name} ${l.title}`).toBe(l.body);
            kept++;
          }
        }
      }
    }
    expect(wideLeads).toBeGreaterThan(0);
    expect(kept).toBeGreaterThan(0);
  });

  it('a narrowbody fleet gets narrowbody leads only (the newcomer rules)', () => {
    const g = at(newGame(4), fromUTC(2028, 3, 10));
    for (const c of Object.values(g.clients).filter((x) => x.kind === 'airline').slice(0, 10)) {
      const l = fairLead(g, c, `n:${c.id}`, null);
      if (l) expect(l.body).toBe('narrow');
    }
  });

  it('a pitch carries the body we pitched, shown on its row', () => {
    const g = wideGame(5, fromUTC(2027, 10, 5));
    g.company.cash = 5e6;
    const t = pitchTargets(g).find((x) => x.bodies.includes('wide'));
    expect(t).toBeDefined();
    expect(pitchAirline(g, t!.client.id, 'wide').ok).toBe(true);
    expect(pitchesView(g)[0].shown).toBe('wide');
  });
});

describe('work tailored to the fleet', () => {
  it('the widebody share follows the fleet: delivering aircraft count inside the horizon, idle ones weigh more', () => {
    const g = wideGame(1);
    const o = fleetOutlook(g);
    expect(o.anyWide).toBe(true);
    expect(o.wideShare).toBeGreaterThan(0.2);
    expect(o.wideShare).toBeLessThan(0.8);
    // A widebody delivering in a year does not count yet; one in a month does.
    const w = wides(g)[1];
    w.status = 'delivering';
    w.delivery = { site: 'HKG', where: 'HKG', handover: g.now + 365 * DAY, ferryIds: [] } as Aircraft['delivery'];
    g.now += 60;
    expect(fleetOutlook(g).units.some((u) => u.id === w.id)).toBe(false);
    w.delivery!.handover = g.now + 30 * DAY;
    g.now += 60;
    expect(fleetOutlook(g).units.find((u) => u.id === w.id)?.from).toBeGreaterThan(g.now);
    const plain = newGame(1);
    expect(fleetOutlook(plain).wideShare).toBe(0);
  });

  it('a mixed fleet gets a real stream of widebody work, not all of it; a narrowbody fleet none but the ladder jobs', () => {
    const g = wideGame(2, fromUTC(2028, 1, 10));
    let wide = 0, narrow = 0;
    for (let i = 0; i < 120; i++) {
      const o = generateOffer(g, undefined, { ordinary: true });
      g.now += 4 * 60;
      if (!o) continue;
      if (bodyOfReq(o.requirements) === 'wide') wide++;
      else narrow++;
      delete g.offers[o.id];
    }
    const share = wide / Math.max(1, wide + narrow);
    expect(share).toBeGreaterThan(0.2);
    expect(share).toBeLessThan(0.8);
    const p = at(newGame(2), fromUTC(2028, 1, 10));
    let pw = 0, pn = 0;
    for (let i = 0; i < 120; i++) {
      const o = generateOffer(p, undefined, { ordinary: true });
      p.now += 4 * 60;
      if (!o) continue;
      expect(o.reach).toBeFalsy();
      if (bodyOfReq(o.requirements) === 'wide') pw++;
      else pn++;
      delete p.offers[o.id];
    }
    expect(pw / Math.max(1, pw + pn)).toBeLessThan(0.25);
  });
});

describe('the out-of-reach job (a taste of progression)', () => {
  it('a double-decker load at most once every reach.days, marked, unflyable by the fleet', () => {
    const g = wideGame(3, fromUTC(2028, 1, 10));
    const days = 240;
    const reach: number[] = [];
    for (let d = 0; d < days; d++) {
      for (let k = 0; k < 3; k++) {
        const o = generateOffer(g, undefined, { ordinary: true });
        if (!o) continue;
        if (o.reach) {
          reach.push(g.now);
          expect(o.requirements.minSeats).toBeGreaterThanOrEqual(BAL.v0194.reach.pax[0]);
          expect(o.requirements.families?.includes('A380')).toBe(true);
          expect(fleetCouldFly(g, o.id)).toBe(false);
          expect(o.blurb).toMatch(/double-decker/);
        }
        delete g.offers[o.id];
      }
      g.now += DAY;
    }
    expect(reach.length).toBeGreaterThanOrEqual(1);
    expect(reach.length).toBeLessThanOrEqual(Math.ceil(days / BAL.v0194.reach.days));
    for (let i = 1; i < reach.length; i++) expect(reach[i] - reach[i - 1]).toBeGreaterThanOrEqual(BAL.v0194.reach.days * DAY);
    expect(reachOpen(g) || g.now - (g.company.prestige?.reachAt ?? 0) < BAL.v0194.reach.days * DAY).toBe(true);
  });

  it('respects our prestige level: none at brochure work (level 1), offered from the charter market (level 2) up', () => {
    const was = PRESTIGE_GATE.on;
    PRESTIGE_GATE.on = true;
    try {
      const count = (level: 1 | 2): number => {
        const g = wideGame(3, fromUTC(2028, 1, 10));
        playerPrestige(g).level = level;
        let n = 0;
        for (let d = 0; d < 120; d++) {
          if (d === 0) expect(reachOpen(g)).toBe(level >= BAL.v0194.reach.minLevel);
          for (let k = 0; k < 3; k++) {
            const o = generateOffer(g, undefined, { ordinary: true });
            if (o?.reach) n++;
            if (o) delete g.offers[o.id];
          }
          g.now += DAY;
        }
        return n;
      };
      expect(count(1)).toBe(0);
      expect(count(2)).toBeGreaterThanOrEqual(1);
    } finally {
      PRESTIGE_GATE.on = was;
    }
  });
});

describe('ETOPS 180 on the ETOPS fleet', () => {
  /** Departures and failures on an aircraft over past days (the record by aircraft). */
  function fly(g: GameState, ac: Aircraft, perDay: number, failEvery: number, days: number, cause = 'Technical: APU'): void {
    const t0 = g.now;
    let n = 0;
    for (let d = days; d >= 1; d--) {
      g.now = t0 - d * DAY + 12 * 60;
      for (let k = 0; k < perDay; k++) {
        n++;
        const f = { id: `x${n}`, no: `T${n}`, kind: 'revenue', aircraftId: ac.id, std: g.now - 60, schedStd: g.now - 60, delay: 0, atd: g.now, from: 'LIS', to: 'MAD', status: 'scheduled' } as never as Parameters<typeof noteDispatch>[1];
        if (failEvery && n % failEvery === 0) {
          (f as { tech?: true }).tech = true;
          (f as { techAc?: string }).techAc = ac.id;
          (f as { techWhy?: string }).techWhy = cause;
          noteTechCancel(g, f, cause);
        } else noteDispatch(g, f);
      }
    }
    g.now = t0;
  }

  it('counts only the twins capable of ETOPS 180, needs a minimum of their departures, and the card row says so', () => {
    const g = wideGame(1);
    seedTechLog(g);
    g.stats.techAcSince = g.now - 400 * DAY;
    const [nb] = narrows(g);
    const tw = wides(g).find((a) => typeOf(a.typeId).etopsMax >= 180)!;
    // An unreliable narrowbody (90 %) and a good twin, but too few twin departures yet.
    fly(g, nb, 6, 10, 170);
    fly(g, tw, 0, 0, 1);
    let r = etopsRecord(g, 180, 180);
    expect(r.pct).toBeNull();
    let row = approvalReqs(g, 'etops180').find((x) => x.etops === 180)!;
    expect(row.ok).toBe(false);
    expect(row.label).toMatch(/not enough ETOPS flights/);
    fly(g, tw, 2, 0, 170);
    r = etopsRecord(g, 180, 180);
    expect(r.pct).toBe(100);
    expect(r.byAc.map((x) => x.id)).not.toContain(nb.id);
    row = approvalReqs(g, 'etops180').find((x) => x.etops === 180)!;
    expect(row.ok).toBe(true);
    expect(row.label).toMatch(/ETOPS fleet technical reliability 100%/);
  });

  it('a failing twin shows in the breakdown: by aircraft, by cause, the advice and the pace', () => {
    const g = wideGame(2);
    seedTechLog(g);
    g.stats.techAcSince = g.now - 400 * DAY;
    const tw = wides(g).find((a) => typeOf(a.typeId).etopsMax >= 180)!;
    fly(g, tw, 2, 25, 170, 'AOG');
    const r = etopsRecord(g, 180, 180);
    expect(r.pct).not.toBeNull();
    expect(r.pct!).toBeLessThan(98);
    expect(r.byAc[0].id).toBe(tw.id);
    expect(r.byAc[0].fails).toBe(r.fails);
    expect(r.causes.aog).toBe(r.fails);
    expect(r.advice.join(' ')).toMatch(/reliability programme/);
    expect(r.advice.join(' ')).toMatch(/AOGs cost the most/);
    expect(r.last30).not.toBeNull();
  });

  it('the reliability programme: billed monthly, fewer defects and AOGs on the twins, none likelier away from base', () => {
    const g = wideGame(3);
    const tw = wides(g).find((a) => typeOf(a.typeId).etopsMax >= 180)!;
    const nb = narrows(g)[0];
    const before = aogChance(g, tw, 'JFK');
    const cash = g.finance.current.lines.maintenance ?? 0;
    expect(joinRelProgramme(g).ok).toBe(true);
    expect(joinRelProgramme(g).ok).toBe(false);
    expect((g.finance.current.lines.maintenance ?? 0)).toBeLessThan(cash);
    expect(relProgState(g)).toBe('pending');
    g.now += (BAL.v0194.etops.programme.days + 1) * DAY;
    expect(relProgState(g)).toBe('active');
    expect(relFactors(g, tw).aog).toBeLessThan(1);
    // The ETOPS dispatch standard: only on a twin of the ETOPS fleet with ETOPS held, more with deferred defects, halved by the programme.
    tw.maint.deferred = 0;
    const clean = etopsCheckChance(g, tw);
    expect(clean).toBeCloseTo(BAL.v0194.etops.check.base * (1 + (new Date(Date.UTC(2000, 0, 1) + g.now * 60_000).getUTCFullYear() - tw.builtYear) / 10) * BAL.v0194.etops.check.progX, 6);
    expect(etopsCheckChance(g, nb)).toBe(0);
    tw.maint.deferred = 0.3;
    expect(etopsCheckChance(g, tw)).toBeCloseTo(clean * (1 + BAL.v0194.etops.check.deferredX * 0.3), 6);
    tw.maint.deferred = 0;
    const held = [...g.company.approvals];
    g.company.approvals = g.company.approvals.filter((a) => !a.startsWith('etops'));
    expect(etopsCheckChance(g, tw)).toBe(0);
    g.company.approvals = held;
    expect(relFactors(g, tw).noOutstation).toBe(true);
    expect(relFactors(g, nb)).toEqual({ delay: 1, aog: 1, noOutstation: false });
    expect(aogChance(g, tw, 'JFK')).toBeLessThan(before * 0.6);
  });
});

describe('saves', () => {
  it('a game with the new records round-trips; an older save starts the record by aircraft at the load and gives live leads a body', () => {
    const g = wideGame(4, fromUTC(2028, 3, 10));
    const c = Object.values(g.clients).find((x) => x.kind === 'airline' && !x.rivalId)!;
    const l = fairLead(g, c, 'save', null);
    expect(l).not.toBeNull();
    const h = deserialize(serialize(g));
    expect(h.stats.techAcSince).toBe(g.stats.techAcSince);
    expect(h.com!.leads![0].body).toBe(l!.body);
    // An older save: no record by aircraft, a lead without a body.
    const file = JSON.parse(serialize(g)) as { state: GameState };
    const old = file.state;
    delete old.stats.techAc;
    delete old.stats.techAcSince;
    delete old.stats.techFails;
    delete old.com!.leads![0].body;
    const o = deserialize(JSON.stringify(file));
    expect(o.stats.techAcSince).toBe(o.now);
    expect(o.stats.techAc).toEqual({});
    expect(['narrow', 'wide']).toContain(o.com!.leads![0].body);
    loadSales(o);
    expect(etopsRecord(o, 180, 180).pct).toBeNull();
  });
});

describe('invariants: ETOPS on the dispatched sector (seed 5, VB2040)', () => {
  it('a leg that diverted en route is checked on the sector it was dispatched for, not on the way to its alternate', async () => {
    const { createChecker } = await import('../../scripts/invariants');
    const { acceptOffer } = await import('./contracts/accept');
    const { legsOffer } = await import('./contracts/testkit');
    const { flightsOf } = await import('./core/entities');
    const g = newGame(5);
    const ac = narrows(g)[0];
    const r = acceptOffer(g, legsOffer(g, [['MTY', 'HAV', g.now + 2 * DAY]]).id, [ac.id]);
    expect(r.ok).toBe(true);
    const f = flightsOf(g, ac.id).find((x) => x.from === 'MTY' && x.to === 'HAV' && x.kind === 'revenue')!;
    expect(f).toBeDefined();
    const inv = createChecker();
    inv.observe(g);
    // It turned to Cancún en route (MTY–CUN in a straight line would be an ETOPS 120 sector for a twin).
    Object.assign(f, { status: 'done', atd: f.std, ata: f.sta, to: 'CUN', div: { to0: 'HAV', at: f.std + 60, eta0: f.sta, cause: 'technical' } });
    inv.observe(g);
    inv.finish(g);
    expect(inv.errors.filter((e: { code: string }) => e.code === 'etops')).toEqual([]);
    const inv2 = createChecker();
    inv2.observe(g);
    delete (f as { div?: unknown }).div;
    const f2 = { ...f, id: `${f.id}x` };
    g.flights[f2.id] = f2;
    inv2.observe(g);
    inv2.finish(g);
    expect(inv2.errors.some((e: { code: string; text: string }) => e.code === 'etops' && e.text.includes('MTY–CUN'))).toBe(true);
  });
});
