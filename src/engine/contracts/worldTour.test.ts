// v0.12.1 world tours (contracts/missions.ts worldTour): a tour operator's round-the-world journey by private jet on one
// widebody with one crew, 3–6 months ahead (Les Voyages de TMR's 'Tour du monde en avion privé' the signature). The
// itinerary from real routes, when it appears, the price, the aircraft held, the one augmented crew with its spares,
// a closed stop, the remote-stop events, the empty-leg planner's crew day, and a whole tour played.

import { describe, expect, it } from 'vitest';
import { AIRPORT_BY_CODE } from '../../data/airports';
import { WORLD_EVENT_TPLS } from '../../data/worldEvents';
import { BAL } from '../core/balance';
import { typeOf } from '../core/perf';
import { DAY } from '../core/time';
import type { ContractOffer, Flight, GameState, LegTemplate } from '../core/types';
import { devAddType } from '../dev';
import { pairingSeats } from '../crew/duties';
import { changeRequestFor, resolveDecision } from '../ops/events';
import { lateCap } from '../ops/flights';
import { startEvent } from '../ops/world';
import { problemFor } from '../problems';
import { deserialize, serialize } from '../save';
import { breathe } from '../../test/breathe';
import { acceptOffer } from './accept';
import { feasibility } from './feasibility';
import { dailyWorldTour, devWorldTour, tourCrew, tourReady, tourRecovery, tourStops, WORLD_TOURS } from './missions';
import { anchorsOf, planLegs, route } from './plan';
import { tourBizPct } from './pricing';
import { emptyDay, relinkPositioning } from './schedule';
import { idleWindows } from './offers';
import { newGame, run } from './testkit';

/** Signs the offer on the aircraft; its contract id. */
function signed(g: GameState, offerId: string, acId: string): string {
  const r = acceptOffer(g, offerId, [acId]);
  if (!r.ok) throw new Error(r.error);
  return r.data!.contractId;
}

const legsOf = (o: { pattern: ContractOffer['pattern'] }): LegTemplate[] => (o.pattern.kind === 'legs' ? [...o.pattern.legs].sort((a, b) => a.dep - b.dep) : []);

/** A company that qualifies: an A330-300 with its crew (and Widebody operations, augmented crews), ETOPS 180, Respected. */
function tourGame(seed = 7, type = 'a333'): { g: GameState; acId: string } {
  const g = newGame(seed, 'LIS');
  const acId = devAddType(g, type);
  g.company.approvals.push('etops120', 'etops180');
  g.company.standing = 2;
  return { g, acId };
}

describe('v0.12.1 world tours: the itinerary', () => {
  it('a real route from a European gateway: 7–10 stops of 2–3 nights, 18–24 days, round trip, every leg direct on an A330', () => {
    for (const seed of [3, 7, 11, 13, 17]) {
      const { g } = tourGame(seed);
      const id = devWorldTour(g);
      expect(id, `seed ${seed}`).not.toBe('');
      const o = g.offers[id];
      const legs = legsOf(o);
      const tpl = WORLD_TOURS.find((t) => t.client === g.clients[o.clientId].name)!;
      expect(tpl).toBeDefined();
      expect(legs[0].from).toBe(tpl.gateway);
      expect(legs[legs.length - 1].to).toBe(tpl.gateway);
      const stops = tourStops(legs);
      expect(stops.length).toBeGreaterThanOrEqual(7);
      expect(stops.length).toBeLessThanOrEqual(10);
      for (const s of stops) {
        expect(s.nights).toBeGreaterThanOrEqual(2);
        expect(s.nights).toBeLessThanOrEqual(3);
        // Each stop one of the template's own choices: a real tour, not random scatter.
        expect(tpl.stops.some((x) => x.at.includes(s.code))).toBe(true);
        expect(AIRPORT_BY_CODE[s.code].narrow).toBeUndefined();
      }
      for (let i = 1; i < legs.length; i++) expect(legs[i].from).toBe(legs[i - 1].to);
      const days = Math.round((o.end - o.start) / DAY);
      expect(days).toBeGreaterThanOrEqual(17);
      expect(days).toBeLessThanOrEqual(25);
      expect(planLegs({ kind: 'legs', legs }, 'a333').techStops).toEqual([]);
      // The tour holds its aircraft; any widebody with business seats; augmented work's extras; presidential delay standards.
      expect(o.pattern.kind === 'legs' && o.pattern.hold).toBe(true);
      expect(o.requirements.body).toBe('wide');
      expect(o.requirements.layouts).toEqual(['two-class', 'three-class', 'vip']);
      expect(o.requirements.extraCabin).toBeGreaterThanOrEqual(2);
      expect(o.requirements.extraCabin).toBeLessThanOrEqual(4);
      expect(o.requirements.standards).toBe('vip');
      expect(o.requirements.etops).toBe(180);
      // Offered 3–6 months ahead (curfew moves aside), and never a word of 'undefined' in the blurb.
      expect(o.start - g.now).toBeGreaterThanOrEqual(89 * DAY);
      expect(o.start - g.now).toBeLessThanOrEqual(181 * DAY);
      expect(o.blurb).not.toMatch(/undefined|NaN/);
      expect(o.blurb).toMatch(/One aircraft and one crew/);
    }
  });

  it("TMR's tour is Paris's: Rio, Iguaçu, Easter Island, Tahiti, Australia, Angkor, Ha Long Bay and Samarkand, either way round", () => {
    const tmr = WORLD_TOURS.find((t) => t.client === 'Les Voyages de TMR')!;
    expect(tmr.gateway).toBe('CDG');
    expect(tmr.stops.filter((s) => s.opt === undefined).map((s) => s.at[0])).toEqual(['GIG', 'IGU', 'IPC', 'PPT', 'SYD', 'SAI', 'VDO', 'SKD']);
    const seen = new Set<string>();
    for (const seed of [3, 7, 13, 17, 19, 23]) {
      const { g } = tourGame(seed);
      const o = g.offers[devWorldTour(g, 'Les Voyages de TMR')];
      expect(g.clients[o.clientId].name).toBe('Les Voyages de TMR');
      seen.add(legsOf(o)[0].to === 'GIG' || legsOf(o)[0].to === 'LIM' ? 'west' : 'east');
    }
    expect(seen.size).toBe(2);
  });

  it('every stretch of the tour holds the crew’s 36 h recovery inside 168 h (ORO.FTL.235(d)): a third night where it is due', () => {
    for (const seed of [3, 7, 11, 13]) {
      const { g } = tourGame(seed);
      const o = g.offers[devWorldTour(g)];
      expect(tourRecovery(legsOf(o), g.company.homeBase)).toBe(-1);
    }
    // A leg every 30 h: no 36 h rest anywhere, the recovery falls due and the stop before it is the one to stretch.
    const legs: LegTemplate[] = [];
    const pts = ['CDG', 'GIG', 'IGU', 'IPC', 'PPT', 'SYD', 'SAI', 'VDO', 'SKD', 'CDG'];
    let t = 20_000 * DAY + 9 * 60;
    for (let i = 0; i + 1 < pts.length; i++, t += 30 * 60) legs.push({ from: pts[i], to: pts[i + 1], dep: t, flightNo: '' });
    expect(tourRecovery(legs, 'LIS')).toBeGreaterThanOrEqual(0);
  });
});

describe('v0.12.1 world tours: when they appear', () => {
  it('late game only: a widebody with business seats, ETOPS 180 (or four engines) and Established or better', () => {
    const g = newGame(7, 'LIS');
    expect(tourReady(g)).toBe(false);
    const acId = devAddType(g, 'a333');
    expect(tourReady(g)).toBe(false);
    g.company.approvals.push('etops120', 'etops180');
    g.company.standing = 0;
    expect(tourReady(g)).toBe(false);
    g.company.standing = 1;
    expect(tourReady(g)).toBe(true);
    // A 747 needs no ETOPS for the Pacific.
    g.company.approvals = g.company.approvals.filter((a) => a !== 'etops180');
    expect(tourReady(g)).toBe(false);
    devAddType(g, 'b744');
    expect(tourReady(g)).toBe(true);
    g.company.approvals.push('etops180');
    for (const a of Object.values(g.fleet)) if (a.typeId === 'b744') delete g.fleet[a.id];
    // An all-economy widebody alone has no business seats for the guests.
    g.fleet[acId].cabin = { ...g.fleet[acId].cabin, j: 0, layout: 'all-economy' };
    expect(tourReady(g)).toBe(false);
  });

  it('rare: about 1–3 a year once Respected, on its own side stream, never two at once', () => {
    const { g } = tourGame(7);
    const rng = g.rng;
    let n = 0;
    const start = g.now;
    for (let d = 0; d < 365 * 3; d++) {
      g.now = start + d * DAY;
      const o = dailyWorldTour(g);
      if (!o) continue;
      n++;
      expect(o.archetype).toBe('worldTour');
      // An open tour offer stops the next one.
      expect(dailyWorldTour(g)).toBeNull();
      delete g.offers[o.id];
    }
    expect(n / 3).toBeGreaterThanOrEqual(1);
    expect(n / 3).toBeLessThanOrEqual(4);
    // A company that does not qualify draws nothing from the main stream.
    const h = newGame(7, 'LIS');
    const r0 = h.rng;
    for (let d = 0; d < 365; d++) {
      h.now += DAY;
      expect(dailyWorldTour(h)).toBeNull();
    }
    expect(h.rng).toBe(r0);
    expect(rng).toBeDefined();
  });

  it('the TMR client is added only when one of its tours is offered (a game without one keeps its client list)', () => {
    const g = newGame(7, 'LIS');
    const names = Object.values(g.clients).map((c) => c.name);
    expect(names).not.toContain('Les Voyages de TMR');
    const { g: h } = tourGame(7);
    devWorldTour(h, 'Les Voyages de TMR');
    const tmr = Object.values(h.clients).find((c) => c.name === 'Les Voyages de TMR');
    expect(tmr?.base).toBe('CDG');
    expect(tmr?.kind).toBe('tourOperator');
  });
});

describe('v0.12.1 world tours: the approval gate (approvals checked at departure)', () => {
  it('a twin needs ETOPS 180 held, or granted before the first leg: a grant due later, or stuck, is a no', () => {
    const { g, acId } = tourGame(3);
    const o = g.offers[devWorldTour(g)];
    const etops = () => feasibility(g, o.id, acId).checks.find((c) => c.id === 'etops')!;
    expect(etops().level).toBe('ok');
    // Only ETOPS 120 held: a Pacific crossing is out.
    g.company.approvals = g.company.approvals.filter((a) => a !== 'etops180');
    expect(etops().level).toBe('no');
    // ETOPS 180 pending, due before the positioning leaves: a warning (the gate grounds the tour if it slips).
    const p = { id: 'etops180' as const, started: g.now - 100 * DAY, done: g.now + 30 * DAY, cost: 350_000 };
    g.company.pendingApprovals.push(p);
    expect(etops().level).toBe('warn');
    expect(etops().label).toMatch(/pending, due .* \(before the tour leaves\)/);
    // Due after the tour has left: no.
    p.done = o.start + DAY;
    expect(etops().level).toBe('no');
    // Stuck at the authority: no.
    p.done = g.now + 30 * DAY;
    Object.assign(p, { waiting: 'Needs a clean record' });
    expect(etops().level).toBe('no');
    expect(acceptOffer(g, o.id, [acId]).ok).toBe(false);
  });

  it('a four-engined 747 needs no ETOPS for the tour', () => {
    const { g, acId } = tourGame(3, 'b744');
    g.company.approvals = g.company.approvals.filter((a) => a !== 'etops180' && a !== 'etops120');
    const o = g.offers[devWorldTour(g)];
    expect(feasibility(g, o.id, acId).checks.find((c) => c.id === 'etops')!.level).toBe('ok');
  });
});

describe('v0.12.1 world tours: money', () => {
  it('clearly profitable flown well: priced on the days held, the positioning, five-star catering; more business seats pay more', () => {
    const { g, acId } = tourGame(3);
    const o = g.offers[devWorldTour(g)];
    expect(o.product.kind).toBe('charter');
    const r = feasibility(g, o.id, acId);
    expect(r.level).not.toBe('no');
    // Fixed costs of the aircraft over the tour (lease, insurance, its overhead share) still leave a fat margin.
    const ac = g.fleet[acId];
    const days = (o.end - o.start) / DAY + 2;
    const fixed = ((typeOf(ac.typeId).rentMonth + typeOf(ac.typeId).insuranceMonth + BAL.overheadPerAircraft) * days) / 30.44;
    expect((r.estMargin - fixed) / r.estRevenue).toBeGreaterThan(0.3);
    // The positioning LIS–CDG–LIS is in the quote; the catering is the tour's.
    expect(r.positionIn.map((l) => `${l.from}-${l.to}`)).toEqual(['LIS-CDG']);
    // An A330-300's 24 J: +3 %; a 777-300ER's 42 J: +10 %; capped at 12 %.
    expect(tourBizPct('worldTour', 24)).toBeCloseTo(0.032, 3);
    expect(tourBizPct('worldTour', 42)).toBeCloseTo(0.104, 3);
    expect(tourBizPct('worldTour', 67)).toBe(BAL.v0121.tour.bizMax);
    expect(tourBizPct('adhoc', 42)).toBe(0);
    const price = o.product.kind === 'charter' ? o.product.price : 0;
    const k = g.contracts[signed(g, o.id, acId)];
    expect(k.product.kind === 'charter' && k.product.price).toBe(Math.round((price * (1 + tourBizPct('worldTour', ac.cabin.j))) / 1000) * 1000);
    // Delays over 30 min are noticed (presidential standards), and the client never asks to move a leg.
    expect(k.requirements.standards).toBe('vip');
    expect(changeRequestFor(g, k)).toBe(false);
  });
});

describe('v0.12.1 world tours: the aircraft is held', () => {
  it('one trip; no hop home, no other work and no idle window between its legs; legs wait up to 3 days, not 1', () => {
    const { g, acId } = tourGame(7);
    const o = g.offers[devWorldTour(g)];
    expect(planLegs(o.pattern as Extract<ContractOffer['pattern'], { kind: 'legs' }>, 'a333').trips).toHaveLength(1);
    const k = g.contracts[signed(g, o.id, acId)];
    const legs = Object.values(g.flights).filter((f) => f.contractId === k.id && f.kind === 'revenue').sort((a, b) => a.std - b.std);
    // One 'base' anchor spans the tour; no idle window opens inside it.
    expect(anchorsOf(g, acId).some((a) => a.kind === 'base' && a.contractId === k.id && a.std <= legs[0].std && a.sta >= legs[legs.length - 1].sta)).toBe(true);
    for (const w of idleWindows(g).filter((x) => x.aircraftId === acId)) expect(w.to <= legs[0].std || w.from >= legs[legs.length - 1].sta).toBe(true);
    relinkPositioning(g, acId);
    const empty = Object.values(g.flights).filter((f) => f.aircraftId === acId && f.kind === 'positioning' && f.std > legs[0].std && f.std < legs[legs.length - 1].sta);
    expect(empty).toEqual([]);
    expect(lateCap(g, legs[1])).toBe(3 * BAL.tripHoldMax);
  });

  it('the A-check falling due mid-tour fits at a stop with a contractor (a major airport), or the card says to book it before', () => {
    const { g, acId } = tourGame(3);
    const o = g.offers[devWorldTour(g)];
    const ac = g.fleet[acId];
    // Due a third of the way round: about 40 FH left.
    ac.maint.fhSinceA = typeOf(ac.typeId).aCheckFH - 25;
    const m = feasibility(g, o.id, acId).checks.find((c) => c.id === 'maintenance')!;
    expect(m.label).toMatch(/A-check due .*(during the tour|in the middle of the tour|before the job starts)/);
    if (/during the tour/.test(m.label)) expect(m.level).toBe('ok');
    else expect(m.level).toBe('warn');
  });
});

describe('v0.12.1 world tours: one crew', () => {
  it('one pairing for the whole tour: 3 pilots at least, the service crew as spares above the minimum', () => {
    const { g, acId } = tourGame(3);
    const o = g.offers[devWorldTour(g)];
    const crew = tourCrew(g, o.id, acId)!;
    expect(crew.pilots).toBeGreaterThanOrEqual(3);
    expect(crew.extra).toBe(o.requirements.extraCabin);
    const k = g.contracts[signed(g, o.id, acId)];
    const ps = Object.values(g.pairings).filter((p) => p.contractId === k.id && p.dutyIds.some((d) => g.duties[d]?.flightIds.some((f) => g.flights[f]?.kind === 'revenue')));
    expect(ps).toHaveLength(1);
    const p = ps[0];
    const revenue = Object.values(g.flights).filter((f) => f.contractId === k.id && f.kind === 'revenue');
    expect(revenue.every((f) => p.dutyIds.includes(f.dutyId ?? ''))).toBe(true);
    const seats = pairingSeats(g, p);
    expect(seats.filter((s) => s.role === 'CPT' || s.role === 'FO' || s.role === 'CRP').length).toBeGreaterThanOrEqual(3);
    // The client's service crew ride above the legal minimum: a sick one never grounds the tour.
    expect(seats.filter((s) => s.above && (s.role === 'CC' || s.role === 'PUR')).length).toBeGreaterThanOrEqual(o.requirements.extraCabin);
    // One of them a second purser: a sick purser far from home is covered on board.
    expect(seats.filter((s) => s.above && s.role === 'PUR')).toHaveLength(1);
  });

  it('a whole tour played: the same crew on every leg, every duty legal, the aircraft home and the price earned', async () => {
    const { g, acId } = tourGame(3);
    const home = g.company.homeBase;
    const o = g.offers[devWorldTour(g)];
    const k = g.contracts[signed(g, o.id, acId)];
    const price = k.product.kind === 'charter' ? k.product.price : 0;
    const seen = new Map<string, { crew: string[]; legal: boolean }>();
    const look = () => {
      for (const f of Object.values(g.flights) as Flight[]) {
        if (f.contractId !== k.id || f.kind !== 'revenue' || f.status === 'scheduled' || seen.has(f.id)) continue;
        const d = f.dutyId ? g.duties[f.dutyId] : undefined;
        seen.set(f.id, { crew: [...f.crewIds].sort(), legal: !!d && d.legality !== 'illegal' });
      }
    };
    for (let t = g.now; t < k.end + 3 * DAY; t += 6 * 60) {
      run(g, t);
      look();
      await breathe();
    }
    run(g, k.end + 3 * DAY);
    const legs = legsOf(k);
    expect(seen.size).toBe(legs.length);
    const flown = [...seen.values()];
    expect(flown.every((x) => x.legal)).toBe(true);
    const first = flown[0].crew;
    expect(first.length).toBeGreaterThanOrEqual(3 + 8);
    // The same people all the way round (a sick crew member's stand-in flown in at most once or twice).
    const all = new Set(flown.flatMap((x) => x.crew));
    expect(all.size).toBeLessThanOrEqual(first.length + 2);
    const pilots = (ids: string[]) => ids.filter((id) => g.crew[id] && ['CPT', 'FO', 'CRP'].includes(g.crew[id].role));
    for (const x of flown) expect(pilots(x.crew)).toEqual(pilots(first));
    expect(k.status).toBe('completed');
    expect(k.legsFlown).toBe(legs.length);
    expect(g.fleet[acId].at).toBe(home);
    expect(Math.round(k.accrued ?? 0)).toBe(Math.round(price));
    expect(g.stats.v09?.tourDone).toBe(1);
  }, 120_000);
});

describe('v0.12.1 world tours: a stop closed', () => {
  /**
   * A signed tour run to two days before its fifth leg (or the first leg into a stop that can be skipped), and a 5-day
   * closure of that leg's destination.
   */
  function closed(seed: number, skippable = false): { g: GameState; contractId: string; legIn: Flight } | null {
    const { g, acId } = tourGame(seed);
    const o = g.offers[devWorldTour(g)];
    const res = acceptOffer(g, o.id, [acId]);
    if (!res.ok) throw new Error(res.error);
    const contractId = res.data!.contractId;
    const legs = Object.values(g.flights).filter((f) => f.contractId === contractId && f.kind === 'revenue').sort((a, b) => a.std - b.std);
    const i = skippable ? legs.findIndex((f, j) => j > 0 && j + 1 < legs.length && planLegs({ kind: 'legs', legs: [{ from: f.from, to: legs[j + 1].to, dep: 0, flightNo: '' }] }, 'a333').techStops.length === 0 && planLegs({ kind: 'legs', legs: [{ from: f.from, to: legs[j + 1].to, dep: 0, flightNo: '' }] }, 'a333').ok) : 4;
    if (i < 0) return null;
    const legIn = legs[i];
    run(g, legIn.std - 2 * DAY);
    startEvent(g, { id: 'testClose', kind: 'disaster', at: legIn.to, country: AIRPORT_BY_CODE[legIn.to].country, airportDays: [5, 5], days: [5, 5], work: [], title: `Storm at ${legIn.to}`, body: 'Closed until {until}.' });
    return { g, contractId, legIn };
  }

  it('the card: another stop on the same dates, the same crew; told in four lines; the tour keeps its price', () => {
    const { g, contractId, legIn } = closed(3)!;
    const d = g.decisions.find((x) => x.kind === 'tourStop')!;
    expect(d).toBeDefined();
    expect(d.options.map((o) => o.id)).toContain('alternate');
    expect(d.options.map((o) => o.id)).toContain('wait');
    const card = problemFor(g, { kind: 'disruption', ref: d.ref! })!;
    expect(card.what).toMatch(/is closed: the tour can't land there/);
    expect(card.why).toMatch(/until about/);
    expect(card.hurt.text).toMatch(/force majeure, the client pays the full tour/);
    expect(card.details.length).toBeGreaterThanOrEqual(2);
    const crew = [...legIn.crewIds];
    const alt = String(d.data!.alt);
    expect(resolveDecision(g, d.id, 'alternate').ok).toBe(true);
    expect(legIn.to).toBe(alt);
    expect(legIn.crewIds).toEqual(crew);
    const c = g.contracts[contractId];
    run(g, c.end + 3 * DAY);
    expect(c.status).toBe('completed');
    expect(c.legsFlown).toBe(legsOf(c).length);
    expect(Math.round(c.accrued ?? 0)).toBe(c.product.kind === 'charter' ? c.product.price : -1);
  }, 60_000);

  it('skip it: stay longer at the stop before, or go straight on (one leg prev–next); or the whole tour waits, nights kept', () => {
    // A stop that can be skipped (the leg either side direct): the two skip options.
    for (const seed of [7, 13, 3, 11]) {
      const x = closed(seed, true);
      if (!x) continue;
      const { g, legIn } = x;
      const d = g.decisions.find((y) => y.kind === 'tourStop');
      if (!d || !d.options.some((o) => o.id === 'stayPrev')) continue;
      expect(d.options.map((o) => o.id)).toContain('goOn');
      const out = g.flights[String(d.data!.outId)];
      const [prev, next, std] = [legIn.from, out.to, out.std];
      expect(resolveDecision(g, d.id, 'stayPrev').ok).toBe(true);
      expect([legIn.from, legIn.to, legIn.std]).toEqual([prev, next, std]);
      expect(g.flights[out.id]).toBeUndefined();
      return;
    }
    throw new Error('no seed with a skippable stop');
  }, 60_000);

  it('the wait moves every later leg by the same days: each stop keeps its nights', () => {
    const { g, legIn } = closed(7)!;
    const d = g.decisions.find((x) => x.kind === 'tourStop')!;
    const later = Object.values(g.flights).filter((f) => f.contractId === legIn.contractId && f.kind === 'revenue' && f.std >= legIn.std).sort((a, b) => a.std - b.std);
    const gaps = later.slice(1).map((f, i) => f.std - later[i].std);
    expect(resolveDecision(g, d.id, 'wait').ok).toBe(true);
    const after = later.slice(1).map((f, i) => f.std - later[i].std);
    expect(after).toEqual(gaps);
    expect(legIn.std).toBeGreaterThan(g.now + DAY);
  });

  it('the remote stops’ own events (a cyclone at Papeete…) come only while a tour of ours is due there', () => {
    const ours = WORLD_EVENT_TPLS.filter((t) => t.ours);
    expect(ours.map((t) => t.at).sort()).toEqual(['CNS', 'IPC', 'KTM', 'LIM', 'PPT', 'VDO']);
    for (const t of ours) expect(t.airportDays).toBeDefined();
  });
});

describe('v0.12.1 the empty-move planner keeps to one crew’s day', () => {
  it('two pilots 11:00 of block, three with augmented crews and rest on board (14:30 in bunks)', () => {
    const g = newGame(30, 'LIS');
    const a = devAddType(g, 'b744');
    expect(emptyDay(g, a)).toBe(14.5 * 60);
    g.company.approvals = g.company.approvals.filter((x) => x !== 'augmented');
    expect(emptyDay(g, a)).toBe(11 * 60);
    // LIS–SGN (12:55 of block on a 747): split at a crew-change stop, each day within it; whole with the day unset.
    const r = route('b744', 'LIS', 'SGN', Infinity, 11 * 60)!;
    expect(r.length).toBeGreaterThanOrEqual(2);
    expect(r.every((l) => l.block <= 11 * 60)).toBe(true);
    expect(route('b744', 'LIS', 'SGN')!.length).toBe(1);
  });
});

describe('v0.12.1 world tours: saves', () => {
  it('a signed tour saves and loads (its hold flag, the TMR client), and plays on the same', () => {
    const { g, acId } = tourGame(3);
    const o = g.offers[devWorldTour(g)];
    const res = acceptOffer(g, o.id, [acId]);
    const k = res.ok ? res.data!.contractId : '';
    const h = deserialize(serialize(g));
    expect(h.contracts[k].pattern.kind === 'legs' && h.contracts[k].pattern.hold).toBe(true);
    expect(Object.values(h.clients).some((c) => c.name === 'Les Voyages de TMR')).toBe(true);
    run(g, g.now + 5 * DAY);
    run(h, h.now + 5 * DAY);
    expect(h.rng).toBe(g.rng);
    expect(Object.keys(h.flights).sort()).toEqual(Object.keys(g.flights).sort());
  }, 60_000);
});
