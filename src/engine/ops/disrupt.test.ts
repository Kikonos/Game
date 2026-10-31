// v0.12.1 Round F (lane A): diversions, the onward card and the planners around them (ops/disrupt.ts).

import { describe, expect, it } from 'vitest';
import { acceptOffer, relinkPositioning } from '../contracts';
import { onwardPending } from '../contracts/plan';
import { hamBase, leased, legsOffer, newGame, owned } from '../contracts/testkit';
import { flightsOf } from '../core/entities';
import { DAY, localMinuteOfDay } from '../core/time';
import type { Aircraft, Flight, GameState } from '../core/types';
import { advanceTo } from '../sim';
import { flightCrewStatus } from '../crew';
import { curfewOk } from '../core/curfew';
import { devDisruption, flowUnit } from './disrupt';
import { inspect } from './ramp';
import { resolveDecision } from './index';
import { isRevenue, turnOf } from './util';

const skip = (g: GameState, t: number) => advanceTo(g, t, new Set());
const line = (g: GameState, cat: string) => (g.finance.current.lines as Record<string, number>)[cat] ?? 0;
const scheduled = (g: GameState, ac: Aircraft) => flightsOf(g, ac.id).filter((f) => f.status === 'scheduled').sort((a, b) => a.std - b.std);

/** A charter LIS–FUE–LIS three days out on the leased A320, signed. */
function charter(seed = 6): { g: GameState; ac: Aircraft; legs: Flight[] } {
  const g = newGame(seed);
  const ac = leased(g);
  const t0 = Math.floor(g.now / DAY) * DAY + 3 * DAY;
  const o = legsOffer(g, [['LIS', 'FUE', t0 + 9 * 60], ['FUE', 'LIS', t0 + 13 * 60]], 150);
  o.broker = undefined;
  const r = acceptOffer(g, o.id, [ac.id]);
  if (!r.ok) throw new Error(r.error);
  return { g, ac, legs: flightsOf(g, ac.id).filter((f) => f.contractId === r.data!.contractId && isRevenue(f)) };
}

/** Advances (answering cards with their defaults) until the leg is airborne. */
function airborne(g: GameState, f: Flight, after = 20): void {
  for (let i = 0; i < 400 && f.status === 'scheduled' && !f.operatedBy; i++) {
    skip(g, Math.min(f.std + f.delay + 5, g.now + 60));
    for (const d of [...g.decisions]) resolveDecision(g, d.id, d.defaultOption);
    g.decisions.length = 0;
  }
  expect(f.status).toBe("enroute");
  g.decisions.length = 0;
  skip(g, g.now + after);
}

/** Diverts the airborne leg to its first alternate (forced card), lands it there; returns the onward card. */
function divertAndLand(g: GameState, f: Flight, kind: 'diversion' | 'technical' = 'diversion', pick?: (ids: string[]) => string) {
  expect(devDisruption(g, kind, f.id)).toBe(true);
  const d = g.decisions.find((x) => x.kind === 'diversion')!;
  const alts = d.options.filter((o) => o.id.startsWith('alt:')).map((o) => o.id);
  const opt = pick ? pick(alts) : alts[0];
  expect(resolveDecision(g, d.id, opt).ok).toBe(true);
  return { alt: opt.slice(4) };
}

const emptyFrom = (g: GameState, ac: Aircraft, at: string) => scheduled(g, ac).filter((x) => x.kind === 'positioning' && x.from === at);

describe('A1: no empty legs planned while a diversion is open', () => {
  it('relink waits while the leg turns for the alternate and while the onward card is open; fly on keeps the card time', () => {
    const { g, ac, legs } = charter(6);
    const f = legs[0];
    airborne(g, f);
    const { alt } = divertAndLand(g, f);
    expect(onwardPending(g, ac.id)).toBe(true);
    expect(relinkPositioning(g, ac.id)).toEqual([]);
    expect(emptyFrom(g, ac, alt)).toEqual([]);
    skip(g, (f.eta ?? f.sta) + 1);
    const on = g.decisions.find((x) => x.kind === 'divertOnward')!;
    expect(on).toBeDefined();
    expect(onwardPending(g, ac.id)).toBe(true);
    // Settles in between plan nothing out of the alternate.
    for (let i = 0; i < 3; i++) relinkPositioning(g, ac.id);
    expect(emptyFrom(g, ac, alt)).toEqual([]);
    // v0.12.1 the card is answered before the crew's duty ends at release.
    const d = g.duties[f.dutyId!];
    if (d) expect(on.expires).toBeLessThanOrEqual(d.release - 5);
    const fly = on.options.find((o) => o.id === 'flyOn');
    if (!fly) return;
    const flyAt = Number(on.data!.flyAt);
    expect(resolveDecision(g, on.id, 'flyOn').ok).toBe(true);
    expect(onwardPending(g, ac.id)).toBe(false);
    const x = g.flights[f.contOf!];
    expect(Math.abs(x.std - flyAt)).toBeLessThanOrEqual(5);
    // "Same crew, within their day" is what happens.
    if (fly.chips?.includes('Same crew, within their day')) {
      expect(x.dutyId).toBe(f.dutyId);
      expect(flightCrewStatus(g, x.id, { live: false }).level).not.toBe('missing');
    }
    // Relinked again and again: never two copies of an empty leg.
    for (let i = 0; i < 4; i++) {
      skip(g, g.now + 30);
      relinkPositioning(g, ac.id);
    }
    const pos = scheduled(g, ac).filter((y) => y.kind === 'positioning');
    for (const a of pos) expect(pos.filter((b) => b !== a && b.from === a.from && b.to === a.to && Math.abs(b.std - a.std) <= turnOf(ac)).length).toBe(0);
  });

  it('coached passengers: exactly one empty leg takes the aircraft on, planned after the decision', () => {
    const { g, ac, legs } = charter(6);
    const f = legs[0];
    airborne(g, f);
    const { alt } = divertAndLand(g, f);
    skip(g, (f.eta ?? f.sta) + 1);
    const on = g.decisions.find((x) => x.kind === 'divertOnward')!;
    if (!on.options.some((o) => o.id === 'bus')) return;
    expect(resolveDecision(g, on.id, 'bus').ok).toBe(true);
    expect(f.div?.settled).toBe(true);
    for (let i = 0; i < 3; i++) relinkPositioning(g, ac.id);
    const out = emptyFrom(g, ac, alt);
    expect(out.length).toBe(1);
    expect(out[0].to).toBe('FUE');
  });
});

describe('A2: a technical diversion back to the departure airport keeps the return leg', () => {
  it('the wave out returns to base: the return is flown late behind the onward leg, never cancelled or flown empty', () => {
    const g = newGame(11);
    const ac = owned(g);
    const r = acceptOffer(g, hamBase(g, g.now + 2 * DAY, 30, 3).id, [ac.id]);
    if (!r.ok) throw new Error(r.error);
    const c = g.contracts[r.data!.contractId];
    const p = c.pattern;
    advanceTo(g, (p.kind === 'base' ? p.from : g.now) + 2 * DAY, new Set());
    g.decisions.length = 0;
    // The first wave out our own crew flies (a crew shortage may hand one to a rival).
    let out: Flight | undefined;
    for (let k = 0; k < 6 && !out; k++) {
      const f = scheduled(g, ac).find((y) => y.from === 'HAM' && y.to === 'PMI' && y.contractId === c.id && y.std > g.now + 60 && !y.operatedBy)!;
      for (let i = 0; i < 400 && f.status === 'scheduled' && !f.operatedBy; i++) {
        skip(g, Math.min(f.std + f.delay + 5, g.now + 60));
        g.decisions.length = 0;
      }
      if (f.status === 'enroute') out = f;
    }
    if (!out) throw new Error('no wave flown');
    const ret = scheduled(g, ac).find((y) => y.from === 'PMI' && y.to === 'HAM' && y.std > out!.std)!;
    skip(g, g.now + 10);
    const pen0 = line(g, 'penalties');
    const { alt } = divertAndLand(g, out, 'technical', (ids) => ids.find((id) => id === 'alt:HAM') ?? ids[0]);
    if (alt !== 'HAM') return;
    skip(g, (out.eta ?? out.sta) + 1);
    // The inspection names the fault the crew wrote up.
    const mx = Object.values(g.maintenance).find((m) => m.aircraftId === ac.id && !m.planned && m.status === 'inWork')!;
    expect(mx.cause).toMatch(/^Inspection after (a |an )/);
    expect(mx.cause).not.toMatch(/: done|congestion|technical problem in flight/);
    // Answered here, or by operations at once (the pacing budget): the passengers fly on either way.
    const on = g.decisions.find((x) => x.kind === 'divertOnward');
    if (on) expect(resolveDecision(g, on.id, on.options.some((o) => o.id === 'flyOn') ? 'flyOn' : 'hotel').ok).toBe(true);
    expect(out.div?.settled).toBe(true);
    if (!out.contOf) return;
    const x = g.flights[out.contOf!];
    expect(x.from).toBe('HAM');
    expect(x.to).toBe('PMI');
    // The wave's own return brings the aircraft and its passengers home: late, kept (a later wave may be dropped).
    expect(ret.status).toBe('scheduled');
    expect(ret.std).toBeGreaterThanOrEqual(x.sta + turnOf(ac));
    // No empty PMI–HAM or HAM–PMI, and every leg leaves from where the one before landed.
    for (let i = 0; i < 3; i++) relinkPositioning(g, ac.id);
    const legs = scheduled(g, ac);
    expect(legs.filter((y) => y.kind === 'positioning' && ((y.from === 'PMI' && y.to === 'HAM') || (y.from === 'HAM' && y.to === 'PMI')))).toEqual([]);
    for (let i = 1; i < legs.length; i++) expect(legs[i].from).toBe(legs[i - 1].to);
    // Compensation only for a later wave dropped for lateness, never for the diverted one's own return.
    const lost = flightsOf(g, ac.id).filter((y) => y.status === 'cancelled' && y.contractId === c.id && isRevenue(y));
    expect(lost).not.toContain(ret);
    expect(line(g, 'penalties') - pen0).toBe(-lost.length * c.penalties.perCancelledLeg);
  });
});

describe('A4: one cabin crew short is for the sector in hand (ORO.CC.205(c))', () => {
  it('the seat is required again once the leg lands: the next leg never flies short with a full load', () => {
    const g = newGame(9);
    const ac = leased(g);
    const t0 = Math.floor(g.now / DAY) * DAY + 3 * DAY;
    const o = legsOffer(g, [['LIS', 'FUE', t0 + 9 * 60], ['FUE', 'TFS', t0 + DAY + 9 * 60], ['TFS', 'LIS', t0 + DAY + 11 * 60]], 150);
    o.broker = undefined;
    const r = acceptOffer(g, o.id, [ac.id]);
    if (!r.ok) throw new Error(r.error);
    const [, mid, back] = flightsOf(g, ac.id).filter((f) => f.contractId === r.data!.contractId && isRevenue(f));
    skip(g, mid.std - 4 * 60);
    g.decisions.length = 0;
    const d0 = g.duties[mid.dutyId!];
    expect(d0 && d0.report > g.now).toBe(true);
    expect(back.dutyId).toBe(mid.dutyId);
    const p = g.pairings[d0.pairingId];
    const cc = p.slots.filter((s) => s.role === 'CC' && s.crewId && !s.above);
    expect(cc.length).toBeGreaterThan(0);
    for (const s of p.slots) if (s !== cc[0] && s.crewId && g.crew[s.crewId]) g.crew[s.crewId].status = 'onDuty';
    expect(devDisruption(g, 'sickAway', mid.id)).toBe(true);
    for (const s of p.slots) if (s.crewId && g.crew[s.crewId]?.status === 'onDuty') g.crew[s.crewId].status = 'resting';
    const d = g.decisions.find((x) => x.kind === 'sickAway')!;
    const opt = d.options.find((x) => x.id === 'minCrew')!;
    expect(opt.desc).toMatch(/ORO\.CC\.205\(c\)/);
    expect(resolveDecision(g, d.id, 'minCrew').ok).toBe(true);
    expect(mid.reducedCabin).toBe(1);
    const short = () => p.slots.filter((s) => s.role === 'CC' && s.above && !s.crewId).length;
    const flipped = short();
    expect(flipped).toBeGreaterThan(0);
    for (let i = 0; i < 100 && mid.status !== 'done'; i++) {
      skip(g, g.now + 30);
      g.decisions.length = 0;
    }
    expect(mid.status).toBe('done');
    // Landed: the empty seat is a required one again (filled, or still open for crew control: never "above").
    expect(short()).toBe(flipped - 1);
    expect(back.reducedCabin).toBeUndefined();
  });
});

describe('A12–A14, EV-S06: card texts and times', () => {
  it('a longer route is flown: the leg block grows by the extra minutes (A13); the slot names who gives it (EV-S06)', () => {
    const { g, legs } = charter(5);
    const f = legs[0];
    skip(g, f.std - 1);
    g.decisions.length = 0;
    expect(devDisruption(g, 'ctot', f.id)).toBe(true);
    const d = g.decisions.find((x) => x.kind === 'ctot')!;
    expect(d.body).toMatch(/Eurocontrol/);
    const block0 = f.block;
    expect(resolveDecision(g, d.id, 'reroute').ok).toBe(true);
    expect(f.block).toBe(block0 + Number(d.data!.extraBlock));
    expect(f.sta - f.std).toBe(f.block);
    expect(flowUnit('LIS')).toBe('Eurocontrol');
    expect(flowUnit('IST')).toBe('Eurocontrol');
    expect(flowUnit('RUH')).toBe('Air traffic control');
    expect(flowUnit('DEL')).toBe('Air traffic control');
  });

  it('bird strike: no "wait for the morning shift" in the day shift; at night the shift is the coming 06:00 local (A14)', () => {
    const { g, ac, legs } = charter(8);
    const f = legs[0];
    airborne(g, f);
    skip(g, (f.eta ?? f.sta) + 1);
    g.decisions.length = 0;
    ac.status = 'available';
    const card = () => {
      g.decisions.length = 0;
      expect(devDisruption(g, 'birdStrike', f.id)).toBe(true);
      return g.decisions.find((x) => x.kind === 'birdStrike')!;
    };
    const day = card();
    const local = localMinuteOfDay('FUE', g.now);
    if (local >= 6 * 60 && local < 20 * 60) expect(day.options.some((o) => o.id === 'wait')).toBe(false);
    // 01:00 at Fuerteventura: the morning shift is today, a few hours off, not tomorrow.
    g.now = Math.floor(g.now / DAY) * DAY + DAY + 60;
    const night = card();
    const w = night.options.find((o) => o.id === 'wait');
    if (!night.data!.own) expect(w).toBeDefined();
    if (w) {
      const morning = Number(night.data!.morning);
      expect(morning - g.now).toBeLessThan(8 * 60);
      expect(localMinuteOfDay('FUE', morning)).toBe(6 * 60);
      expect(w.chips?.some((c) => / local \(.* UTC\)/.test(c))).toBe(true);
    }
  });
});

describe('A7: a curfew diversion repositions after the curfew, on a rested crew', () => {
  it('the empty leg to the curfew airport lands after it opens and leaves once a crew has rested', () => {
    const g = newGame(4);
    const ac = leased(g);
    const t0 = Math.floor(g.now / DAY) * DAY + 3 * DAY;
    const o = legsOffer(g, [['LIS', 'DUS', t0 + 20 * 60 + 30], ['DUS', 'LIS', t0 + DAY + 5 * 60 + 15]], 150);
    o.broker = undefined;
    const r = acceptOffer(g, o.id, [ac.id]);
    if (!r.ok) throw new Error(r.error);
    const [f] = flightsOf(g, ac.id).filter((x) => x.contractId === r.data!.contractId && isRevenue(x));
    skip(g, f.std - 1);
    g.decisions.length = 0;
    expect(devDisruption(g, 'curfew', f.id)).toBe(true);
    const d = g.decisions.find((x) => x.kind === 'curfew')!;
    if (!d.options.some((x) => x.id === 'divert')) return;
    expect(d.options.find((x) => x.id === 'divert')!.chips).toContain('Morning flight may be late');
    expect(resolveDecision(g, d.id, 'divert').ok).toBe(true);
    const alt = f.to;
    expect(alt).not.toBe('DUS');
    for (let i = 0; i < 3; i++) relinkPositioning(g, ac.id);
    const check = () => {
      const rep = scheduled(g, ac).filter((x) => x.kind === 'positioning' && x.from === alt && x.to === 'DUS');
      expect(rep.length).toBe(1);
      expect(curfewOk('DUS', rep[0].sta)).toBe(true);
      expect(curfewOk(alt, rep[0].std)).toBe(true);
      // Their crew landed late at night: the leg leaves no sooner than after their minimum rest or a crew flown in.
      expect(rep[0].std - (f.ata ?? f.sta)).toBeGreaterThanOrEqual(6 * 60);
      return rep[0];
    };
    check();
    // Landed at the alternate: still clean after the relinks that follow.
    for (let i = 0; i < 100 && f.status !== 'done'; i++) skip(g, g.now + 30);
    g.decisions.length = 0;
    for (let i = 0; i < 3; i++) relinkPositioning(g, ac.id);
    const kept = check();
    // The same leg, hour after hour: never planned again as the clock moves (one crew alarm at most, not one an hour).
    for (let i = 0; i < 6; i++) {
      skip(g, g.now + 30);
      g.decisions.length = 0;
      if (kept.status !== 'scheduled') break;
      expect(scheduled(g, ac).filter((x) => x.kind === 'positioning' && x.from === alt).map((x) => x.id)).toEqual([kept.id]);
    }
  });
});

describe('unclear items settled: S-HOTEL, EV-S05', () => {
  it('a diversion hotel over 00:00 UTC is one room a night (the nightly run books it), none here on a wet lease', () => {
    const { g, legs } = charter(6);
    const f = legs[0];
    airborne(g, f);
    divertAndLand(g, f);
    skip(g, (f.eta ?? f.sta) + 1);
    const on = g.decisions.find((x) => x.kind === 'divertOnward')!;
    const morning = Number(on.data!.morning);
    const overMidnight = Math.floor(morning / DAY) > Math.floor(g.now / DAY);
    const h0 = line(g, 'hotels');
    expect(resolveDecision(g, on.id, 'hotel').ok).toBe(true);
    // Over midnight UTC: not booked here, dailyCrewCosts books their night away; a day rest is booked here.
    if (overMidnight) expect(line(g, 'hotels')).toBe(h0);
    else expect(line(g, 'hotels')).toBeLessThan(h0);
    // On a wet lease the client pays crew hotels: none booked here.
    const w = charter(7);
    const k = w.g.contracts[w.legs[0].contractId!];
    (k as { product: unknown }).product = { kind: 'wet', ratePerBH: 3000, mghPerMonth: 0, excessRate: 3000, cycleFee: 0, positioningBillable: true };
    airborne(w.g, w.legs[0]);
    divertAndLand(w.g, w.legs[0]);
    skip(w.g, (w.legs[0].eta ?? w.legs[0].sta) + 1);
    const on2 = w.g.decisions.find((x) => x.kind === 'divertOnward');
    if (!on2) return;
    const h1 = line(w.g, 'hotels');
    expect(resolveDecision(w.g, on2.id, 'hotel').ok).toBe(true);
    expect(line(w.g, 'hotels')).toBe(h1);
  });

  it('a ramp finding on an aircraft already in line maintenance keeps it there until it is put right', () => {
    const g = newGame(14);
    const ac = leased(g);
    ac.builtYear = new Date(g.now * 60_000 + Date.UTC(2000, 0, 1)).getUTCFullYear() - 26;
    ac.maint.deferred = 0.6;
    // An inspection after a diversion, ending in an hour.
    const end = g.now + 60;
    g.maintenance.mxd = { id: 'mxd', aircraftId: ac.id, kind: 'line', at: 'FRA', start: g.now, end, cost: 0, status: 'inWork', planned: false, cause: 'Inspection after a hydraulic system warning', ev: 0 };
    ac.status = 'maintenance';
    ac.maintId = 'mxd';
    ac.at = 'FRA';
    for (let i = 0; i < 200; i++) {
      const r = inspect(g, ac, 'FRA', 'SACA', `held:${i}`);
      if (r.action === '3b' || r.action === '3c') {
        expect(g.maintenance.mxd.end).toBeGreaterThanOrEqual(g.now + r.fixMin);
        return;
      }
    }
    throw new Error('no class 3 finding in 200 inspections');
  });
});
