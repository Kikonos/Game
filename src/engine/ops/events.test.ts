// Events, decisions and their resolvers (B3). DESIGN.md §5.8, BUILD-PLAN B3 acceptance.

import { onFlightDep } from './flights';
import { describe, expect, it } from 'vitest';
import { BAL } from '../core/balance';
import { flightsOf } from '../core/entities';
import { pushDecision } from '../core/messages';
import { DAY, fromUTC } from '../core/time';
import type { Aircraft, Contract, Flight, GameState, Minute, Receivable, SimEvent } from '../core/types';
import { acceptOffer } from '../contracts';
import { addAircraft, hamBase, leased, legsOffer, newGame, owned, run } from '../contracts/testkit';
import { advanceTo } from '../sim';
import { aogDecision, canAsk, changeRequestFor, clientFeeFor, crewShortDecision, latePaymentDecision, onDecisionExpire, paceDecisions, permitDelayFor, rescueDecision, resolveDecision, seasonNudge } from './events';
import { cancelCost, planHold, windowLegs } from './flights';
import { startAog } from './maintenance';
import { isRevenue, stats, turnOf } from './util';

/** Advances with no auto-pause honoured (open decisions expire into their defaults). */
const skip = (g: GameState, t: Minute) => advanceTo(g, t, new Set());
const ev = (g: GameState, type: SimEvent['type'], id: string): SimEvent => ({ t: g.now, seq: 0, type, id, v: 0 });
const line = (g: GameState, cat: 'penalties' | 'subcharter' | 'interest' | 'otherRevenue') => g.finance.current.lines[cat] ?? 0;
const only = (g: GameState, kind: string) => {
  const d = g.decisions.filter((x) => x.kind === kind);
  expect(d).toHaveLength(1);
  return d[0];
};

/** A 30-day HAM season base on the leased A320, signed now and running for a day. */
function baseGame(seed = 21): { g: GameState; ac: Aircraft; c: Contract } {
  const g = newGame(seed);
  const ac = leased(g);
  const o = hamBase(g, g.now + 3 * DAY, 30);
  o.broker = undefined;
  const r = acceptOffer(g, o.id, [ac.id]);
  if (!r.ok) throw new Error(r.error);
  const c = g.contracts[r.data!.contractId];
  skip(g, c.start + DAY);
  g.decisions.length = 0;
  stats(g).askedAt = [];
  return { g, ac, c };
}

/** Advances to just before the aircraft's next revenue departure from where it stands, idle at the gate. */
function atGate(g: GameState, ac: Aircraft): Flight {
  for (let i = 0; i < 20; i++) {
    const f = flightsOf(g, ac.id).find((x) => x.status === 'scheduled' && isRevenue(x) && x.std > g.now + 5);
    if (!f) break;
    skip(g, f.std - 2);
    if (!ac.flightId && ac.status === 'available' && ac.at === f.from && f.status === 'scheduled') return f;
  }
  throw new Error('no departure at the gate');
}

/** An AOG on the next departure; the decision is open. */
function aog(seed = 21) {
  const { g, ac, c } = baseGame(seed);
  const f = atGate(g, ac);
  g.decisions.length = 0;
  startAog(g, ac, f);
  const m = g.maintenance[ac.maintId!];
  return { g, ac, c, f, m, d: only(g, 'aog') };
}

describe('AOG decision', () => {
  it('offers the five recovery options, defaults to the courier, and blocks departures until resolved', () => {
    const { g, ac, f, m, d } = aog();
    expect(d.options.map((o) => o.id)).toEqual(['courier', 'team', 'swap', 'subcharter', 'cancel']);
    expect(d.options.every((o) => o.label && o.desc)).toBe(true);
    expect(['courier', 'subcharter']).toContain(d.defaultOption);
    expect(d.expires).toBe(g.now + BAL.aogDecisionMin);
    expect(ac.status).toBe('aog');
    expect(m.kind).toBe('AOG');
    // Departure time passes with the decision open: the leg is held, nothing leaves.
    skip(g, f.std + 90);
    expect(g.decisions).toContain(d);
    expect(f.status).toBe('scheduled');
    expect(flightsOf(g, ac.id).some((x) => x.status === 'enroute')).toBe(false);
  });

  it('courier: legs held or cancelled as planHold plans', () => {
    const { g, ac, m, d } = aog();
    const plan = planHold(g, ac, m.at, m.end + 30);
    const res = resolveDecision(g, d.id, 'courier');
    expect(res.ok).toBe(true);
    expect(g.decisions).not.toContain(d);
    for (const { f, std } of plan.moves) expect(f.std).toBe(std);
    for (const f of plan.cancels) expect(f.status).toBe('cancelled');
    expect(plan.moves.length + plan.cancels.length).toBeGreaterThan(0);
    expect(flightsOf(g, ac.id).some((f) => f.status === 'enroute')).toBe(false);
  });

  it('team: the repair ends sooner and costs the team', () => {
    const { g, m, d } = aog();
    const end = m.end;
    const cost = m.cost;
    resolveDecision(g, d.id, 'team');
    expect(m.end).toBeLessThan(end);
    expect(m.end).toBe(Math.max(g.now + 30, Number(d.data!.teamEnd)));
    expect(m.cost).toBe(cost + Number(d.data!.teamCost));
  });

  it('sub-charter: a rival flies the legs, still under the contract; the cost is posted and the client notices (v0.7.2)', () => {
    const { g, ac, c, m, d } = aog();
    const win = windowLegs(g, ac, m.at, m.end + 30).filter(isRevenue);
    expect(win.length).toBeGreaterThan(0);
    const rel = g.company.reputation.reliable;
    const sub = line(g, 'subcharter');
    const n0 = stats(g).subchartered;
    resolveDecision(g, d.id, 'subcharter');
    for (const f of win) {
      expect(f.operatedBy).toBe(d.data!.rivalId);
      expect(f.contractId).toBe(c.id);
      expect(f.aircraftId).toBeNull();
    }
    expect(line(g, 'subcharter')).toBeLessThan(sub);
    expect(g.company.reputation.reliable).toBeLessThan(rel);
    expect(rel - g.company.reputation.reliable).toBeLessThanOrEqual(BAL.v072.sub.capPerClient);
    expect(stats(g).subchartered - n0).toBe(win.length);
  });

  it('cancel: compensation paid and reliability −3 or more', () => {
    const { g, ac, m, d } = aog();
    const win = windowLegs(g, ac, m.at, m.end + 30);
    const pen = cancelCost(g, win);
    const rel = g.company.reputation.reliable;
    const before = line(g, 'penalties');
    resolveDecision(g, d.id, 'cancel');
    expect(win.every((f) => f.status === 'cancelled')).toBe(true);
    expect(line(g, 'penalties')).toBe(before - pen);
    expect(g.company.reputation.reliable).toBeLessThanOrEqual(rel - 3);
  });

  it('swap: another A320 ferries in and takes the legs', () => {
    const { g, ac, m, d } = aog();
    const other = owned(g);
    const swap = d.options.find((o) => o.id === 'swap')!;
    expect(swap.tone).toBe('good');
    expect(swap.label).toContain(other.reg);
    const win = windowLegs(g, ac, m.at, m.end + 30).filter(isRevenue);
    const res = resolveDecision(g, d.id, 'swap');
    expect(res.ok).toBe(true);
    for (const f of win) expect(f.aircraftId).toBe(other.id);
    // The ferry to the AOG station comes first, and the legs keep turn minima.
    const legs = flightsOf(g, other.id).filter((f) => f.status === 'scheduled');
    expect(legs[0].to).toBe(m.at);
    for (let i = 1; i < legs.length; i++) expect(legs[i].std).toBeGreaterThanOrEqual(legs[i - 1].sta);
  });

  it('swap is unavailable (and refused) when no aircraft of the family is free', () => {
    const g0 = baseGame();
    owned(g0.g).status = 'maintenance';
    const f = atGate(g0.g, g0.ac);
    startAog(g0.g, g0.ac, f);
    const d = only(g0.g, 'aog');
    const swap = d.options.find((o) => o.id === 'swap')!;
    expect(swap.tone).toBe('bad');
    expect(resolveDecision(g0.g, d.id, 'swap').ok).toBe(false);
    expect(g0.g.decisions).toContain(d);
  });
});

describe('resolveDecision and expiry', () => {
  it('removes the decision and counts it; unknown ids and options are refused', () => {
    const { g, d } = aog();
    const n = stats(g).decisions;
    expect(resolveDecision(g, 'nope', 'courier').ok).toBe(false);
    expect(resolveDecision(g, d.id, 'nope').ok).toBe(false);
    expect(resolveDecision(g, d.id, 'courier').ok).toBe(true);
    expect(g.decisions).not.toContain(d);
    expect(stats(g).decisions).toBe(n + 1);
  });

  it('expiry applies the default, else the next workable option, and says so in the inbox', () => {
    const { g, d } = aog();
    owned(g).status = 'maintenance';
    d.defaultOption = 'swap';
    onDecisionExpire(g, ev(g, 'decision.expire', d.id));
    expect(g.decisions).not.toContain(d);
    expect(g.messages[0].title).toBe(`No answer: ${d.title}`);
    expect(g.messages[0].body).toContain('Wait for the part');
  });

  it('the queued expiry fires on its own', () => {
    const { g, d } = aog();
    skip(g, d.expires + 1);
    expect(g.decisions).not.toContain(d);
    expect(g.messages.some((m) => m.title === `No answer: ${d.title}`)).toBe(true);
  });
});

describe('crew short', () => {
  /** The next departure with its own duty pushed `over` minutes past the FDP limit (crew present). */
  function overrun(over: number) {
    const { g, ac } = baseGame();
    const f = atGate(g, ac);
    const duty = g.duties[f.dutyId!];
    expect(duty).toBeTruthy();
    duty.fdp = duty.maxFdp + over;
    duty.legality = 'illegal';
    duty.discretion = undefined;
    crewShortDecision(g, f, ac);
    return { g, ac, f, duty, d: only(g, 'crewShort') };
  }

  it('discretion is offered and the default when the overrun is 2 h or less', () => {
    const { g, f, duty, d } = overrun(60);
    // v0.9 round 4 (§T, §V): an over-FDP crew is out of hours: the decision says so, names the flight once and keeps the hurt as prose.
    expect(d.title).toBe(`Crew out of hours: ${f.no} ${f.from}–${f.to}`);
    expect(d.body).not.toContain(` for ${f.no}.`);
    expect(d.body).not.toMatch(/Yes:|Not much:/);
    // v0.7.1: the options are Crew Control's fixes (discretion first; delay and cancel always offered).
    expect(d.options.map((o) => o.id)).toContain('discretion');
    expect(d.options.map((o) => o.id)).toContain('delay');
    expect(d.options.map((o) => o.id)).toContain('cancel');
    expect(d.defaultOption).toBe('discretion');
    const crew = g.pairings[duty.pairingId].slots.map((s) => g.crew[s.crewId!]);
    const morale = crew.map((c) => c.morale);
    expect(resolveDecision(g, d.id, 'discretion').ok).toBe(true);
    expect(duty.discretion).toBeGreaterThanOrEqual(120);
    expect(duty.legality).not.toBe('illegal');
    expect(f.crewDecided).toBe(true);
    crew.forEach((c, i) => expect(c.morale).toBeCloseTo(Math.max(0, morale[i] - 3), 5));
  });

  it('v0.9 round 4: a day 2 min over on the clock at the gate decides at once, discretion is judged live, and the leg departs at the next attempt', () => {
    const { g, ac } = baseGame();
    const f = atGate(g, ac);
    const d = g.duties[f.dutyId!];
    expect(d.report).toBeLessThanOrEqual(g.now);
    // Held at the gate for crew (the schedule stands, only `delay` grew), 10 min into the wait: the day as it would run
    // from now is 2 min over a limit the planned day was 30 min under; the duty still carries the FDP written earlier.
    const last = g.flights[d.flightIds[d.flightIds.length - 1]];
    g.now = f.std + 120;
    f.delay = 120;
    f.crewHeld = true;
    f.heldAt = g.now - 10;
    d.maxFdp = g.now + (last.sta - f.std) - d.report - 2;
    d.plannedFdp = d.maxFdp - 30;
    d.fdp = d.maxFdp - 30;
    d.legality = 'illegal';
    onFlightDep(g, ev(g, 'flight.dep', f.id));
    // Posted at once (not after BAL.crewWaitMin, which would outgrow the allowance), with the live overrun.
    expect(f.status).toBe('scheduled');
    const dec = only(g, 'crewShort');
    const opt = dec.options.find((o) => o.id === 'discretion')!;
    expect(opt, dec.options.map((o) => o.id).join()).toBeTruthy();
    expect(opt.chips).toContain('FDP +2m');
    expect(dec.defaultOption).toBe('discretion');
    expect(resolveDecision(g, dec.id, 'discretion').ok).toBe(true);
    expect(g.duties[f.dutyId!].discretion ?? 0).toBeGreaterThanOrEqual(2);
    expect(g.duties[f.dutyId!].legality).not.toBe('illegal');
    // The queued attempt departs it: no 'Waiting for a rescue crew', no cancellation.
    onFlightDep(g, ev(g, 'flight.dep', f.id));
    expect(f.status).toBe('enroute');
    expect(f.delayReason).not.toMatch(/rescue crew|legal crew/);
  });

  it('no discretion beyond 2 h: wait for a legal crew, sub-charter or cancel', () => {
    const { g, f, d } = overrun(180);
    expect(d.options.map((o) => o.id)).not.toContain('discretion');
    expect(d.options.map((o) => o.id)).toContain('delay');
    expect(d.options.map((o) => o.id)).toContain('cancel');
    expect(['delay', 'subcharter']).toContain(d.defaultOption);
    const std = f.std;
    expect(resolveDecision(g, d.id, 'delay').ok).toBe(true);
    expect(f.crewDecided).toBe(true);
    expect(f.status === 'cancelled' || f.std > std).toBe(true);
  });

  it('cancel drops the trip with compensation', () => {
    const { g, f, d } = overrun(180);
    const before = line(g, 'penalties');
    resolveDecision(g, d.id, 'cancel');
    expect(f.status).toBe('cancelled');
    expect(line(g, 'penalties')).toBeLessThan(before);
  });
});

describe('pacing', () => {
  function receivable(g: GameState, amount = 400_000): Receivable {
    const cl = Object.values(g.clients)[0];
    const r: Receivable = { id: `r${g.finance.receivables.length + 900}`, clientId: cl.id, contractId: null, desc: 'Test invoice', amount, issued: g.now - 60 * DAY, due: g.now - 30 * DAY, payAt: g.now + 40 * DAY, paid: null, cat: 'charterRevenue' };
    g.finance.receivables.push(r);
    return r;
  }

  it('a third open optional decision is applied by operations with an inbox message', () => {
    const g = newGame(3);
    stats(g).askedAt = [];
    latePaymentDecision(g, receivable(g));
    latePaymentDecision(g, receivable(g));
    expect(g.decisions).toHaveLength(2);
    expect(canAsk(g)).toBe(false);
    latePaymentDecision(g, receivable(g));
    expect(g.decisions).toHaveLength(2);
    expect(g.messages[0].body).toContain('Operations chose: Wait');
  });

  it('at most two optional questions a week (one slot kept for AOG and rescue), which still always ask', () => {
    const g = newGame(3);
    stats(g).askedAt = [];
    latePaymentDecision(g, receivable(g));
    latePaymentDecision(g, receivable(g));
    for (const d of [...g.decisions]) resolveDecision(g, d.id, 'wait');
    latePaymentDecision(g, receivable(g));
    expect(g.decisions).toHaveLength(0);
    rescueDecision(g);
    expect(g.decisions.map((d) => d.kind)).toEqual(['rescue']);
    // A week later the budget is back.
    g.now += 7 * DAY + 1;
    expect(canAsk(g)).toBe(true);
  });

  it('decisions other modules post join the budget; over it, operations apply the default', () => {
    const g = newGame(3);
    stats(g).askedAt = [];
    const sick = () => pushDecision(g, { kind: 'sickCrew', title: 'Sick', body: 'Test.', options: [{ id: 'callIn', label: 'Call in a crew member', desc: '' }], defaultOption: 'callIn', expires: g.now + DAY, data: { flightId: 'none' } });
    sick();
    paceDecisions(g);
    expect(g.decisions).toHaveLength(1);
    expect(stats(g).askedAt).toHaveLength(1);
    sick();
    paceDecisions(g);
    expect(g.decisions).toHaveLength(2);
    sick();
    paceDecisions(g);
    expect(g.decisions).toHaveLength(2);
    expect(g.messages[0].body).toContain('Operations chose: Call in a crew member');
    // Seen once: settle passes don't count them again.
    paceDecisions(g);
    expect(stats(g).askedAt).toHaveLength(2);
  });
});

describe('late payment and rescue', () => {
  function late(seed = 3) {
    const g = newGame(seed);
    stats(g).askedAt = [];
    const cl = Object.values(g.clients).find((c) => c.kind === 'government') ?? Object.values(g.clients)[0];
    const r: Receivable = { id: 'r999', clientId: cl.id, contractId: null, desc: 'Evacuation flights', amount: 1_000_000, issued: g.now - 60 * DAY, due: g.now - 30 * DAY, payAt: g.now + 60 * DAY, paid: null, cat: 'charterRevenue' };
    g.finance.receivables.push(r);
    latePaymentDecision(g, r);
    return { g, r, cl, d: only(g, 'latePayment') };
  }

  it('offers wait (default), factor and threaten', () => {
    const { d } = late();
    // v0.8: waiving the interest is a favour (+3 relation).
    expect(d.options.map((o) => o.id)).toEqual(['wait', 'waive', 'factor', 'threaten']);
    expect(d.defaultOption).toBe('wait');
  });

  it('factoring pays the invoice now less 8%', () => {
    const { g, r, d } = late();
    const cash = g.company.cash;
    const interest = line(g, 'interest');
    resolveDecision(g, d.id, 'factor');
    const fee = Math.round(r.amount * BAL.factorDiscount);
    expect(g.company.cash).toBe(cash + r.amount - fee);
    expect(line(g, 'interest')).toBe(interest - fee);
    expect(r.paid).toBe(g.now);
    expect(r.factored).toBe(true);
  });

  it('threatening costs 20 relation and usually brings payment within a week', () => {
    let paidSoon = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const { g, r, cl, d } = late(seed);
      const rel = cl.relation;
      resolveDecision(g, d.id, 'threaten');
      expect(cl.relation).toBe(Math.max(-100, rel - 20));
      if (r.payAt <= g.now + 7 * DAY) paidSoon++;
    }
    expect(paidSoon).toBeGreaterThanOrEqual(9);
    expect(paidSoon).toBeLessThanOrEqual(19);
  });

  it('the rescue is always asked; accepting brings the cash in', () => {
    const g = newGame(3);
    stats(g).askedAt = [0, 0, 0].map(() => g.now);
    rescueDecision(g);
    const d = only(g, 'rescue');
    expect(d.defaultOption).toBe('accept');
    const cash = g.company.cash;
    resolveDecision(g, d.id, 'accept');
    expect(g.company.cash).toBe(cash + Number(d.data!.amount));
    expect(g.finance.rescues).toBe(1);
  });
});

describe('client change requests', () => {
  it('an extra rotation on a base programme adds two non-overlapping legs with free flight numbers', () => {
    let done = false;
    for (let seed = 21; seed < 31 && !done; seed++) {
      const { g, ac, c } = baseGame(seed);
      if (!changeRequestFor(g, c)) continue;
      const d = only(g, 'changeRequest');
      expect(d.options.map((o) => o.id)).toEqual(['accept', 'decline']);
      const before = new Set(Object.keys(g.flights));
      const res = resolveDecision(g, d.id, 'accept');
      expect(res.ok).toBe(true);
      const added = Object.values(g.flights).filter((f) => !before.has(f.id) && f.contractId === c.id && isRevenue(f));
      expect(added).toHaveLength(2);
      expect(added[0].to).toBe(added[1].from);
      expect(added[1].to).toBe(c.pattern.kind === 'base' ? c.pattern.base : '');
      // Numbers unused by any other flight; the pair sits in a gap with turn minima on both sides.
      for (const a of added) expect(Object.values(g.flights).filter((f) => f.no === a.no)).toHaveLength(1);
      const legs = flightsOf(g, ac.id).filter((f) => f.status === 'scheduled');
      for (let i = 1; i < legs.length; i++) {
        if (added.includes(legs[i]) || added.includes(legs[i - 1])) expect(legs[i].std - legs[i - 1].sta).toBeGreaterThanOrEqual(turnOf(ac));
      }
      done = true;
    }
    expect(done).toBe(true);
  });

  it('declining costs relation', () => {
    const { g, c } = baseGame(22);
    if (!changeRequestFor(g, c)) return;
    const d = only(g, 'changeRequest');
    const cl = g.clients[c.clientId];
    const rel = cl.relation;
    resolveDecision(g, d.id, 'decline');
    expect(cl.relation).toBe(rel + BAL.v08.rel.decline);
  });

  it('a later departure on a trip moves the leg and earns the change fee', () => {
    const g = newGame(8);
    const ac = leased(g);
    const t0 = g.now + 5 * DAY;
    const o = legsOffer(g, [['LIS', 'FNC', t0 + 10 * 60], ['FNC', 'LIS', t0 + 15 * 60]]);
    const r = acceptOffer(g, o.id, [ac.id]);
    if (!r.ok) throw new Error(r.error);
    const c = g.contracts[r.data!.contractId];
    stats(g).askedAt = [];
    expect(changeRequestFor(g, c)).toBe(true);
    const d = only(g, 'changeRequest');
    const f = g.flights[String(d.data!.flightId)];
    const std = f.std;
    const fee = Number(d.data!.fee);
    const rev = line(g, 'otherRevenue');
    resolveDecision(g, d.id, 'accept');
    expect(f.std).toBe(std + Number(d.data!.minutes));
    expect(line(g, 'otherRevenue')).toBe(rev + fee);
  });

  // v0.9 round 3 (tripMoveFerries' player save on another bot path): Jet2 moved a trip by a day, then asked for a later
  // departure; agreed, the recovery dropped both legs as "more than 24 h late" and paid the client compensation for its
  // own request. Lateness the client asked for is accepted lateness (lateOk), as a player's own delay is.
  it("a trip the client moved by a day and then later still is not dropped as late (the client's own lateness)", () => {
    const g = newGame(8);
    const ac = leased(g);
    const t0 = g.now + 4 * DAY;
    const o = legsOffer(g, [['LIS', 'FNC', t0 + 10 * 60], ['FNC', 'LIS', t0 + 15 * 60]]);
    const r = acceptOffer(g, o.id, [ac.id]);
    if (!r.ok) throw new Error(r.error);
    const c = g.contracts[r.data!.contractId];
    g.clients[c.clientId].level = 'known';
    stats(g).askedAt = [];
    expect(clientFeeFor(g, c)).toBe(true);
    const legs = Object.values(g.flights).filter((f) => f.contractId === c.id && isRevenue(f)).sort((a, b) => a.std - b.std);
    expect(legs[0].asked?.min).toBe(DAY);
    stats(g).askedAt = [];
    expect(changeRequestFor(g, c)).toBe(true);
    const d = only(g, 'changeRequest');
    const minutes = Number(d.data!.minutes);
    resolveDecision(g, d.id, 'accept');
    // v0.12.1 the client's moves are their schedule now (re-based: no penalty, not late), said on the leg.
    expect(legs[0].std - legs[0].schedStd!).toBe(0);
    expect(legs[0].asked).toEqual({ min: DAY + minutes, by: g.clients[c.clientId].name });
    run(g, legs[1].sta + 6 * 60);
    expect(legs.map((f) => f.status)).toEqual(['done', 'done']);
  });
});

describe('messages', () => {
  it('a permit delay moves the first leg of a trip 6–24 h', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const g = newGame(seed);
      const ac = leased(g);
      const t0 = g.now + 4 * DAY;
      const o = legsOffer(g, [['LIS', 'FNC', t0 + 9 * 60], ['FNC', 'LIS', t0 + 14 * 60]]);
      const r = acceptOffer(g, o.id, [ac.id]);
      if (!r.ok) throw new Error(r.error);
      const c = g.contracts[r.data!.contractId];
      const first = Object.values(g.flights).filter((f) => f.contractId === c.id && isRevenue(f)).sort((a, b) => a.std - b.std)[0];
      const std = first.std;
      expect(permitDelayFor(g, c)).toBe(first);
      const moved = first.std - std;
      expect(moved % 60).toBe(0);
      expect(moved).toBeGreaterThanOrEqual(6 * 60);
      expect(moved).toBeLessThanOrEqual(24 * 60);
      expect(g.messages[0].title).toBe(`Permit delay: ${first.no}`);
    }
  });

  it('season nudge on 1 Feb, 1 Mar and 1 Sep only, when an aircraft is idle two weeks ahead', () => {
    const g = newGame(2);
    g.now = fromUTC(2027, 2, 1, 0, 0);
    expect(seasonNudge(g)).toBe(true);
    expect(g.messages[0].title).toBe('Summer tenders are out');
    g.now = fromUTC(2027, 9, 1, 0, 0);
    expect(seasonNudge(g)).toBe(true);
    expect(g.messages[0].title).toBe('Winter tenders are out');
    g.now = fromUTC(2027, 4, 1, 0, 0);
    expect(seasonNudge(g)).toBe(false);
    g.now = fromUTC(2027, 2, 2, 0, 0);
    expect(seasonNudge(g)).toBe(false);
    for (const a of Object.values(g.fleet)) a.status = 'delivering';
    addAircraft(g, 'a320ceo').status = 'stored';
    g.now = fromUTC(2027, 3, 1, 0, 0);
    expect(seasonNudge(g)).toBe(false);
  });

  it('an AOG decision built directly still matches the departure path', () => {
    const { g, ac, f, m } = aog();
    g.decisions.length = 0;
    aogDecision(g, ac, f, m);
    expect(only(g, 'aog').data!.maintId).toBe(m.id);
  });
});
