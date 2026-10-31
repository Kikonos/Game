// Maintenance: check status, booking, auto-planning into maintenance nights, notice drops, warnings (B3). DESIGN.md §5.6.

import { afterEach, describe, expect, it } from 'vitest';
import { BAL } from '../core/balance';
import { addFlight, flightsOf } from '../core/entities';
import { blockMinutes, typeOf } from '../core/perf';
import { DAY, localMinuteOfDay } from '../core/time';
import type { Aircraft, Contract, Flight, GameState, LedgerCat, Minute } from '../core/types';
import { acceptOffer } from '../contracts';
import { hamBase, leased, legsOffer, newGame, owned } from '../contracts/testkit';
import { demoFlights } from '../dev';
import { advanceTo } from '../sim';
import { moveMaint } from './maintMove';
import { resolveDecision } from '.';
import { cancelCheck, checkCostOf, checkStatus, groundGaps, isGrounded, onMaintEnd, onMaintStart, planA, planChecks, scheduleCheck } from './maintenance';

type Knobs = 'delayChance' | 'techDelayChance' | 'aogBase';
const bal = BAL as unknown as Record<Knobs, number>;
const saved = { delayChance: BAL.delayChance, techDelayChance: BAL.techDelayChance, aogBase: BAL.aogBase };
const calm = () => Object.assign(bal, { delayChance: 0, techDelayChance: 0, aogBase: 0 });
afterEach(() => Object.assign(bal, saved));

const skip = (g: GameState, t: Minute) => advanceTo(g, t, new Set());
const line = (g: GameState, cat: LedgerCat) => [g.finance.current, ...g.finance.history].reduce((s, st) => s + (st.lines[cat] ?? 0), 0);
const live = (g: GameState, ac: Aircraft) => flightsOf(g, ac.id).filter((f) => f.status === 'scheduled');
const isRev = (f: Flight) => f.kind === 'revenue' || f.kind === 'techstop';
const aFH = (ac: Aircraft) => typeOf(ac.typeId).aCheckFH;

function sign(g: GameState, offerId: string, ac: Aircraft): Contract {
  const r = acceptOffer(g, offerId, [ac.id]);
  if (!r.ok) throw new Error(r.error);
  return g.contracts[r.data!.contractId];
}

/** Plays `days` with decision defaults, collecting every leg cancelled along the way (flights are pruned later). */
function play(g: GameState, days: number, seen = new Map<string, Flight>()) {
  const end = g.now + days * DAY;
  while (g.now < end && !g.gameOver) {
    advanceTo(g, Math.min(end, g.now + 6 * 60), new Set(['decision', 'aog']));
    for (const d of [...g.decisions]) resolveDecision(g, d.id, d.defaultOption);
    for (const f of Object.values(g.flights)) if (f.status === 'cancelled' && !seen.has(f.id)) seen.set(f.id, { ...f });
  }
  return seen;
}

describe('check status', () => {
  it('reads the A and C intervals from the counters; the A-check falls due by the calendar without flying', () => {
    const g = newGame(3);
    const ac = owned(g);
    const st = checkStatus(g, ac);
    expect(st.aUsed).toBeCloseTo(Math.max(ac.maint.fhSinceA / aFH(ac), (g.now - ac.maint.lastA) / (BAL.aCheckDays * DAY)), 9);
    expect(st.aHoursLeft).toBe(Math.round(aFH(ac) - ac.maint.fhSinceA));
    expect(st.aDue).toBe(ac.maint.lastA + BAL.aCheckDays * DAY);
    expect(st.cDue).toBeGreaterThan(g.now);
    expect(st.grounded).toBe(false);
    expect(st.nextA).toBeNull();
    expect(st.risk).toBeGreaterThan(0);
  });

  it('extrapolates the FH limit over the planned legs: due at the leg that would cross it', () => {
    calm();
    const g = newGame(3);
    const ac = owned(g);
    ac.maint.fhSinceA = aFH(ac) - 5;
    demoFlights(g, ['PMI'], 3);
    let fh = ac.maint.fhSinceA;
    const cross = live(g, ac).find((f) => (fh += (f.block - 20) / 60) >= aFH(ac))!;
    expect(checkStatus(g, ac).aDue).toBe(cross.std);
  });

  it('grounds an aircraft past the 10% tolerance, by hours or by the calendar', () => {
    const g = newGame(3);
    const ac = owned(g);
    ac.maint.fhSinceA = aFH(ac) * (1 + BAL.overdueTolerance) - 1;
    expect(isGrounded(g, ac)).toBe(false);
    ac.maint.fhSinceA = aFH(ac) * (1 + BAL.overdueTolerance) + 1;
    expect(isGrounded(g, ac)).toBe(true);
    expect(checkStatus(g, ac).grounded).toBe(true);
    ac.maint.fhSinceA = 0;
    ac.maint.lastA = g.now - Math.ceil(BAL.aCheckDays * (1 + BAL.overdueTolerance) + 1) * DAY;
    expect(isGrounded(g, ac)).toBe(true);
  });

  it('a grounded aircraft keeps revenue legs on the ground and gets its check forced at the daily run', () => {
    calm();
    const g = newGame(4);
    const ac = owned(g);
    const t = g.now + 6 * 60;
    sign(g, legsOffer(g, [['LIS', 'FAO', t], ['FAO', 'LIS', t + 3 * 60]]).id, ac);
    const legs = live(g, ac).filter(isRev);
    ac.maint.fhSinceA = aFH(ac) * 1.2;
    skip(g, t + 1);
    for (const f of legs) expect(f).toMatchObject({ status: 'cancelled', delayReason: 'Aircraft grounded: check overdue' });
    // The daily run books the overdue check at once (the planner's first slot, or a forced one).
    skip(g, g.now + DAY);
    const st = checkStatus(g, ac);
    expect(st.nextA).toBeTruthy();
    expect(g.maintenance[st.nextA!].start).toBeLessThan(g.now + DAY);
  });
});

describe('booking checks', () => {
  it('books into a free slot, refuses clashes, bad airports and doubles; a done check resets the counters', () => {
    calm();
    const g = newGame(5);
    const ac = owned(g);
    demoFlights(g, ['FAO'], 1);
    const [out, back] = live(g, ac);
    expect(scheduleCheck(g, ac.id, 'A', out.std, 'LIS').ok).toBe(false);
    expect(scheduleCheck(g, ac.id, 'C', back.sta + 60, 'FAO').ok).toBe(false);
    expect(scheduleCheck(g, ac.id, 'A', back.sta + 60, 'FAO').ok).toBe(false); // small airport, no base there
    const r = scheduleCheck(g, ac.id, 'A', back.sta + 60, 'LIS');
    expect(r.ok).toBe(true);
    expect(scheduleCheck(g, ac.id, 'A', back.sta + 2 * DAY, 'LIS').ok).toBe(false);
    const m = g.maintenance[r.ok ? r.data!.maintId : ''];
    expect(m).toMatchObject({ kind: 'A', at: 'LIS', status: 'planned', cost: BAL.checkCost.A[0] });
    expect(m.end - m.start).toBe(typeOf(ac.typeId).aCheckHours * 60);
    expect(checkStatus(g, ac).nextA).toBe(m.id);
    const checks0 = line(g, 'checks');
    skip(g, m.start + 1);
    expect(ac).toMatchObject({ status: 'maintenance', maintId: m.id });
    const deferred = ac.maint.deferred;
    skip(g, m.end + 1);
    expect(m.status).toBe('done');
    expect(ac).toMatchObject({ status: 'available', maintId: null });
    expect(ac.maint).toMatchObject({ fhSinceA: 0, lastA: m.end });
    expect(ac.maint.deferred).toBeCloseTo(deferred * 0.3, 9);
    expect(line(g, 'checks')).toBe(checks0 - m.cost);
  });

  it('cancels a planned check (and its ferry) but not one in work', () => {
    calm();
    const g = newGame(5);
    const ac = owned(g);
    const r = scheduleCheck(g, ac.id, 'A', g.now + 2 * DAY, 'MAD');
    expect(r.ok).toBe(true);
    const m = g.maintenance[r.ok ? r.data!.maintId : ''];
    expect(m.ferryIds?.length).toBeGreaterThan(0);
    const ferry = g.flights[m.ferryIds![0]];
    expect(ferry).toMatchObject({ kind: 'ferry', from: 'LIS', to: 'MAD' });
    expect(ferry.sta).toBeLessThanOrEqual(m.start);
    expect(cancelCheck(g, m.id).ok).toBe(true);
    expect(m.status).toBe('cancelled');
    expect(g.flights[ferry.id]).toBeUndefined();
    const r2 = scheduleCheck(g, ac.id, 'A', g.now + 60, 'LIS');
    const m2 = g.maintenance[r2.ok ? r2.data!.maintId : ''];
    skip(g, m2.start + 1);
    expect(cancelCheck(g, m2.id).ok).toBe(false);
  });

  it('drops wet base legs only with dropLegs and at least 12 h notice: no compensation, relation −1 a leg', () => {
    calm();
    const g = newGame(6);
    const ac = leased(g);
    const c = sign(g, hamBase(g, g.now + 2 * DAY, 30, 3).id, ac);
    skip(g, c.start + 3 * DAY);
    const outs = live(g, ac).filter((f) => isRev(f) && f.from === 'HAM');
    const soon = outs.find((f) => f.std > g.now + 60 && f.std < g.now + BAL.maintNotice - 60)!;
    const later = outs.find((f) => f.std > g.now + BAL.maintNotice + 60)!;
    const back = live(g, ac).find((f) => f.from === later.to && f.std > later.std)!;
    const start = later.std - 30;
    // Without dropLegs every clash is refused; inside the notice window even with it.
    expect(scheduleCheck(g, ac.id, 'A', start, 'HAM').ok).toBe(false);
    expect(scheduleCheck(g, ac.id, 'A', soon.std - 30, 'HAM', { dropLegs: true }).ok).toBe(false);
    const rel0 = g.clients[c.clientId].relation;
    const pen0 = line(g, 'penalties');
    const cancelled0 = g.stats.cancelled;
    const r = scheduleCheck(g, ac.id, 'A', start, 'HAM', { dropLegs: true, auto: true });
    expect(r.ok ? '' : r.error).toBe('');
    expect(r.ok).toBe(true);
    expect(later).toMatchObject({ status: 'cancelled', delayReason: 'A-check' });
    expect(back.status).toBe('cancelled');
    expect(g.clients[c.clientId].relation).toBe(rel0 - 2);
    expect(line(g, 'penalties')).toBe(pen0);
    expect(g.stats.cancelled).toBe(cancelled0);
    expect(soon.status).toBe('scheduled');
  });
});

describe('auto-planning', () => {
  it('books the A-check into a maintenance night of a 90-day HAM base on the owned A320: no revenue leg lost', () => {
    calm();
    const g = newGame(7);
    const ac = owned(g);
    const due0 = checkStatus(g, ac).aDue;
    const c = sign(g, hamBase(g, g.now + 3 * DAY, 90, 3).id, ac);
    const seen = play(g, 95);
    const checks = Object.values(g.maintenance).filter((m) => m.aircraftId === ac.id && m.kind === 'A');
    expect(checks.length).toBeGreaterThanOrEqual(1);
    const m = checks.sort((a, b) => a.start - b.start)[0];
    expect(m.status).toBe('done');
    expect(m.at).toBe('HAM');
    expect(m.end).toBeLessThanOrEqual(due0);
    expect(ac.maint.lastA).toBeGreaterThan(c.start);
    // In a maintenance night: the base had no wave planned over the check, and nothing was dropped for it.
    expect([...seen.values()].filter((f) => /check/.test(f.delayReason ?? ''))).toEqual([]);
    expect(g.messages.some((x) => x.title === `A-check booked: ${ac.reg}` && /Planned automatically/.test(x.body))).toBe(true);
    expect(isGrounded(g, ac)).toBe(false);
  }, 30_000);

  it('with no gap before it falls due, drops one base wave with notice (no compensation)', () => {
    calm();
    const g = newGame(8);
    const ac = leased(g);
    // A dense base (every wave flown): the only long nights are the weekly maintenance nights.
    const o = hamBase(g, g.now + 2 * DAY, 30, 3);
    if (o.pattern.kind === 'base') o.pattern.targetBH = 100_000;
    const c = sign(g, o.id, ac);
    skip(g, c.start + 3 * DAY + 60);
    ac.maint.lastA = g.now - (BAL.aCheckDays - 2.5) * DAY;
    const due = checkStatus(g, ac).aDue;
    const need = typeOf(ac.typeId).aCheckHours * 60 + 60;
    expect(groundGaps(g, ac, g.now + 30, due).filter((x) => x.to - x.from >= need)).toEqual([]);
    const pen0 = line(g, 'penalties');
    planChecks(g);
    const st = checkStatus(g, ac);
    expect(st.nextA).toBeTruthy();
    const m = g.maintenance[st.nextA!];
    expect(m.at).toBe('HAM');
    expect(m.start).toBeGreaterThanOrEqual(g.now + BAL.maintNotice);
    expect(m.end).toBeLessThanOrEqual(due);
    const dropped = flightsOf(g, ac.id).filter((f) => f.status === 'cancelled' && f.delayReason === 'A-check');
    expect(dropped.map((f) => [f.from, f.to])).toEqual([['HAM', 'PMI'], ['PMI', 'HAM']]);
    expect(line(g, 'penalties')).toBe(pen0);
    for (const f of live(g, ac)) expect(f.sta <= m.start || f.std >= m.end).toBe(true);
  });

  it('ferries home for a check when the aircraft idles at a small outstation', () => {
    calm();
    const g = newGame(9);
    const ac = owned(g);
    const t = g.now + 3 * 60;
    addFlight(g, { no: 'AWL900', aircraftId: ac.id, contractId: null, kind: 'ferry', from: 'LIS', to: 'FNC', std: t, sta: t + blockMinutes(ac.typeId, 'LIS', 'FNC') });
    skip(g, t + 6 * 60);
    expect(ac.at).toBe('FNC');
    ac.maint.lastA = g.now - (BAL.aCheckDays - 5) * DAY;
    planChecks(g);
    const st = checkStatus(g, ac);
    expect(st.nextA).toBeTruthy();
    const m = g.maintenance[st.nextA!];
    expect(m.at).toBe('LIS');
    const ferry = (m.ferryIds ?? []).map((id) => g.flights[id]);
    expect(ferry[0]).toMatchObject({ kind: 'ferry', from: 'FNC', to: 'LIS' });
    expect(ferry[ferry.length - 1].sta).toBeLessThanOrEqual(m.start);
    // Far enough ahead for a crew to position for the ferry.
    expect(ferry[0].std).toBeGreaterThanOrEqual(g.now + BAL.ferryLeadMin);
  });

  it('warns about the C-check at 90, 60 and 30 days, once each; it is never auto-booked', () => {
    calm();
    const g = newGame(10);
    const ac = owned(g);
    const months = typeOf(ac.typeId).cCheckMonths;
    // Due in 95 days.
    ac.maint.lastC = Math.round(g.now + 95 * DAY - months * 30.44 * DAY);
    ac.maint.fhSinceC = 0;
    const warns = () => g.messages.filter((m) => m.title.startsWith('C-check due in') && m.ref?.id === ac.id);
    skip(g, g.now + 70 * DAY);
    expect(warns().map((m) => m.tone)).toEqual(['bad', 'warn', 'warn']);
    expect(checkStatus(g, ac).nextC).toBeNull();
    // Already inside 30 days: one message, not three.
    const g2 = newGame(10);
    const b = owned(g2);
    b.maint.lastC = Math.round(g2.now + 20 * DAY - months * 30.44 * DAY);
    b.maint.fhSinceC = 0;
    skip(g2, g2.now + 3 * DAY);
    expect(g2.messages.filter((m) => m.title.startsWith('C-check due in') && m.ref?.id === b.id)).toHaveLength(1);
  });
});

describe('maintenance windows of a base', () => {
  it('base patterns leave maintenance nights long enough for an A-check at the station', () => {
    calm();
    const g = newGame(11);
    const ac = owned(g);
    const c = sign(g, hamBase(g, g.now + 2 * DAY, 30, 3).id, ac);
    const need = typeOf(ac.typeId).aCheckHours * 60 + 60;
    const legs = live(g, ac).filter((f) => f.contractId === c.id && f.std < c.start + 14 * DAY);
    let nights = 0;
    for (let i = 1; i < legs.length; i++) if (legs[i - 1].to === 'HAM' && legs[i].std - legs[i - 1].sta >= need && localMinuteOfDay('HAM', legs[i].std) < 12 * 60) nights++;
    expect(nights).toBeGreaterThanOrEqual(1);
  });
});

describe('v0.9 round 4 (audit): heavy check on time, line-station A-checks', () => {
  it('"Heavy check, on time" is judged at induction: a C-check inducted 10 days before the calendar limit and lasting 3 weeks counts; one inducted late does not', () => {
    const run = (daysBefore: number) => {
      const g = newGame(3);
      const ac = owned(g);
      for (const m of Object.values(g.maintenance)) if (m.aircraftId === ac.id) m.status = 'cancelled';
      ac.maint.lastC = g.now - typeOf(ac.typeId).cCheckMonths * 30.44 * DAY + daysBefore * DAY;
      ac.maint.fhSinceC = 0;
      const st = checkStatus(g, ac);
      const start = g.now + 60;
      g.maintenance.cx = { id: 'cx', aircraftId: ac.id, kind: 'C', at: ac.at, start, end: start + 21 * DAY, cost: 1, status: 'planned', planned: true, ev: 0 };
      g.now = start;
      onMaintStart(g, { t: g.now, type: 'maint.start', id: 'cx', v: 0, seq: 0 });
      expect(g.maintenance.cx.status).toBe('inWork');
      expect(g.maintenance.cx.onTime).toBe(daysBefore > 0);
      g.now = start + 21 * DAY;
      expect(checkStatus(g, ac).cUsed).toBeGreaterThan(1);
      onMaintEnd(g, { t: g.now, type: 'maint.end', id: 'cx', v: g.maintenance.cx.ev, seq: 0 });
      expect(g.maintenance.cx.status).toBe('done');
      return [st.cUsed <= 1, g.stats.v09?.cOnTime ?? 0] as const;
    };
    expect(run(10)).toEqual([true, 1]);
    expect(run(-2)).toEqual([false, 0]);
  });

  it('planA books a line A-check away from home at +20 % (BAL.v09.heads.maint.outstation)', () => {
    const g = newGame(3);
    const ac = owned(g);
    for (const f of Object.values(g.flights)) if (f.aircraftId === ac.id) f.status = 'cancelled';
    for (const m of Object.values(g.maintenance)) if (m.aircraftId === ac.id) m.status = 'cancelled';
    // Parked at a big airport (size ≥ 4: a line station), the next flight from there in four days.
    ac.at = 'MAD';
    const b = blockMinutes(ac.typeId, 'MAD', 'LIS');
    addFlight(g, { no: 'AW1', aircraftId: ac.id, contractId: null, kind: 'revenue', from: 'MAD', to: 'LIS', std: g.now + 4 * DAY, sta: g.now + 4 * DAY + b, pax: 100 });
    expect(planA(g, ac, g.now + 3 * DAY, true)).toBe(true);
    const m = Object.values(g.maintenance).find((x) => x.aircraftId === ac.id && x.kind === 'A' && x.status === 'planned')!;
    expect(m.at).toBe('MAD');
    expect(m.cost).toBe(Math.round(checkCostOf(ac, 'A') * (1 + BAL.v09.heads.maint.outstation)));
    const h = newGame(3);
    const ah = owned(h);
    for (const m2 of Object.values(h.maintenance)) if (m2.aircraftId === ah.id) m2.status = 'cancelled';
    expect(planA(h, ah, h.now + 3 * DAY, true)).toBe(true);
    const mh = Object.values(h.maintenance).find((x) => x.aircraftId === ah.id && x.kind === 'A' && x.status === 'planned')!;
    expect(mh.at).toBe(h.company.homeBase);
    expect(mh.cost).toBe(checkCostOf(ah, 'A'));
  });
});

describe('v0.12.1 the outstation A-check premium on every booking', () => {
  it('an A-check booked at a major airport away from base costs +20 %; moving it keeps the price; at base it does not', () => {
    const g = newGame(23);
    const ac = owned(g);
    ac.at = 'MAD';
    const away = scheduleCheck(g, ac.id, 'A', g.now + 3 * DAY, 'MAD');
    if (!away.ok) throw new Error(away.error);
    const m = g.maintenance[away.data!.maintId];
    const base = Math.round(BAL.checkCost.A[0]);
    expect(m.cost).toBe(Math.round(base * (1 + BAL.v09.heads.maint.outstation)));
    const mv = moveMaint(g, m.id, m.start + DAY);
    if (!mv.ok) throw new Error(mv.error);
    expect(g.maintenance[mv.data!.maintId].cost).toBe(m.cost);
    expect(checkCostOf(ac, 'A', g.company.homeBase, g.company.homeBase)).toBe(base);
  });
});
