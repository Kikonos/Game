// v0.7 lease returns (UPDATE-0.7.md §F6.6): 120 days before a lease ends the lessor asks (extend 12 months by
// default, 36, or return). A return is a ferry to the return site and a return check ending at the lease end; the
// return costs (check, half-life, cabin reinstatement, repaint) are posted when the check starts, the deposit comes
// back and the aircraft leaves the fleet when it ends.

import { floorRent } from '../../data/acmiTypes';
import { AIRPORT_BY_CODE } from '../../data/airports';
import { LESSOR_SITES } from '../../data/market';
import { BAL } from '../core/balance';
import { flightsOf, removeFlights, touchFlights } from '../core/entities';
import { cashOnly, post } from '../core/ledger';
import { pushDecision, pushMessage } from '../core/messages';
import { cardMeta, leaseReturnCard } from '../problems';
import { etopsCap, typeOf } from '../core/perf';
import { schedule } from '../core/queue';
import { DAY, fmtDate, fmtDay, fmtDayRange, fmtDayRel } from '../core/time';
import type { ActionResult, Aircraft, GameState, MaintenanceEvent, Minute } from '../core/types';
import { route, routeSpan, timeChain } from '../contracts/plan';
import { layoutName, reinstateCost } from './cabin';
import type { DeliveryLeg } from './delivery';
import { rentOver, settleDeparture } from './finance';
import { cCheckGross, cDueAt, checkCostOf, checkUsedAt, nextPlanned, scheduleCheck } from './maintenance';
import { maintWord, usd } from './util';
import { lockOf } from '../scenario/rules';
import { atomic } from '../crew/atomic';
import { extensionRentX } from '../leasing/terms';

export interface ReturnQuote { site: string; lines: { label: string; amount: number }[]; total: number; deposit: number; checkDays: number; ferry: DeliveryLeg[] }
export type LeaseChoice = 'extend12' | 'extend36' | 'return';

/** v0.7.2 handing a lease back early (UPDATE-0.7.2.md §6.2). */
export interface EarlyReturnQuote {
  ok: boolean; why: string | null;
  /** The return check ends (the lessor wants 30 days' notice). */
  end: Minute;
  fee: number;
  rentSaved: number; returnCosts: ReturnQuote; deposit: number;
  /** rentSaved + deposit − fee − returnCosts.total. */
  net: number;
  blockers: string[];
}

/**
 * v0.7.2 an early return ending at `end` (default: the first day after the 30-day notice with no signed work from the
 * ferry out on): the lessor's fee (max(3, half the months left) × rent), the rent saved, the return costs (as at the
 * lease end, priced for `end`) and the deposit back. Not with under 90 days left (the normal return). Pure.
 */
export function earlyReturnQuote(g: GameState, aircraftId: string, end?: Minute): EarlyReturnQuote {
  const ac = g.fleet[aircraftId];
  const E = BAL.v072.earlyReturn;
  const rq0: ReturnQuote = { site: '', lines: [], total: 0, deposit: 0, checkDays: 0, ferry: [] };
  const no = (why: string, e = end ?? g.now): EarlyReturnQuote => ({ ok: false, why, end: e, fee: 0, rentSaved: 0, returnCosts: rq0, deposit: 0, net: 0, blockers: [] });
  if (!ac || ac.ownership.kind !== 'dryLeaseIn') return no('Not a leased aircraft');
  // v0.15 a scenario's fleet is fixed.
  const lk = lockOf(g, 'fleet');
  if (lk) return no(lk);
  const own = ac.ownership;
  if (ac.status === 'delivering') return no(`${ac.reg} has not been delivered yet`);
  // v0.17.2 a return already booked (at the lease end, or early) can still be brought forward or moved until its check
  // starts: quoted as if it were not booked (its ferry and check are not work that keeps the aircraft busy).
  const booked = ac.returning ? g.maintenance[ac.returning.maintId] : undefined;
  if (booked?.status === 'inWork') return no('The return check is under way');
  const skipM = ac.returning?.maintId;
  const skipF = new Set(ac.returning?.ferryIds ?? []);
  const leaseEnd = ac.returning?.wasEnd ?? own.leaseEnd;
  if (leaseEnd - g.now < E.minLeftDays * DAY) return no(`Under ${E.minLeftDays} days left: use the normal return`);
  const w = wideOf(ac);
  const checkDays = BAL.leaseReturn.checkDays[w];
  const turn = typeOf(ac.typeId).turnMin;
  const site = own.returnSite ?? g.company.homeBase;
  const r = route(ac.typeId, g.company.homeBase, site, etopsCap(g.company.approvals, ac.typeId));
  const ferryMin = r && r.length ? routeSpan(r, ac.typeId) + 2 * turn : 0;
  const earliest = Math.ceil((g.now + E.noticeDays * DAY) / DAY) * DAY + 12 * 60;
  // Signed work that keeps it busy: legs (not soft positioning), checks, base programmes.
  const work: { end: Minute; what: string; contractId: string | null }[] = [];
  for (const f of flightsOf(g, ac.id)) if ((f.status === 'scheduled' || f.status === 'enroute') && f.kind !== 'positioning' && !skipF.has(f.id)) work.push({ end: f.eta ?? f.sta, what: `${f.no} ${f.from}–${f.to}`, contractId: f.contractId });
  for (const m of Object.values(g.maintenance)) if (m.aircraftId === ac.id && m.id !== skipM && (m.status === 'planned' || m.status === 'inWork')) work.push({ end: m.end, what: `${maintWord(m)} ${fmtDay(m.start)}`, contractId: null });
  for (const c of Object.values(g.contracts)) if ((c.status === 'signed' || c.status === 'active') && c.aircraftIds.includes(ac.id)) work.push({ end: c.pattern.kind === 'base' ? c.pattern.to : c.end, what: c.title, contractId: c.id });
  const busyEnd = Math.max(0, ...work.map((x) => x.end));
  const e = end ?? Math.max(earliest, Math.ceil((busyEnd + ferryMin + checkDays * DAY) / DAY) * DAY + 12 * 60);
  if (e < earliest - 60) return no(`The lessor wants ${E.noticeDays} days' notice: from ${fmtDay(earliest)}`, e);
  if (leaseEnd - e < E.minLeftDays * DAY) return no(`That leaves under ${E.minLeftDays} days of the lease: use the normal return`, e);
  const ferryOut = e - checkDays * DAY - ferryMin;
  const blockers: string[] = [];
  const byContract = new Map<string, number>();
  for (const f of flightsOf(g, ac.id)) {
    if (f.status !== 'scheduled' || f.kind === 'positioning' || skipF.has(f.id) || (f.eta ?? f.sta) <= ferryOut) continue;
    const k = f.contractId ?? '';
    byContract.set(k, (byContract.get(k) ?? 0) + 1);
  }
  for (const [k, n] of byContract) blockers.push(`${k ? g.contracts[k]?.title ?? 'A contract' : 'Other flights'}: ${n} leg${n > 1 ? 's' : ''} after ${fmtDay(ferryOut)}`);
  for (const c of Object.values(g.contracts)) {
    if ((c.status === 'signed' || c.status === 'active') && c.aircraftIds.includes(ac.id) && c.pattern.kind === 'base' && c.pattern.to > ferryOut && !byContract.has(c.id)) blockers.push(`${c.title}: runs to ${fmtDay(c.pattern.to)}`);
  }
  const rq = returnQuote(g, ac.id, e)!;
  const monthsLeft = (leaseEnd - e) / MONTH;
  const fee = Math.round((Math.max(E.feeMinMonths, E.feeShare * monthsLeft) * own.rentPerMonth) / 1000) * 1000;
  // v0.14.1 an agreed extension's rent counts from its start.
  const rentSaved = Math.round((rentOver(own, e, leaseEnd, MONTH)) / 1000) * 1000;
  const deposit = own.deposit ?? 0;
  const net = rentSaved + deposit - fee - rq.total;
  return { ok: !blockers.length, why: blockers.length ? blockers[0] : null, end: e, fee, rentSaved, returnCosts: rq, deposit, net, blockers };
}

/** v0.7.2 books the early return: the lease now ends at `end`; ferry to the return site and the return check; the fee is posted when the check starts. */
export function returnEarly(g: GameState, aircraftId: string, end: Minute): ActionResult {
  const q = earlyReturnQuote(g, aircraftId, end);
  if (!q.ok) return { ok: false, error: q.why ?? 'Cannot return it early' };
  const ac = g.fleet[aircraftId];
  if (ac.ownership.kind !== 'dryLeaseIn') return { ok: false, error: 'Not a leased aircraft' };
  // v0.17.2 a return already booked (the player chose 'return at the lease end', or an earlier date) is replaced: all
  // or nothing (a booking that fails puts the old one back).
  if (ac.returning) return atomic(g, 'returnEarly', (error): ActionResult => ({ ok: false, error }), () => {
    const u = unbook(g, ac);
    return u.ok ? bookEarly(g, ac, q) : u;
  }, (r) => !r.ok);
  return bookEarly(g, ac, q);
}

function bookEarly(g: GameState, ac: Aircraft, q: EarlyReturnQuote): ActionResult {
  if (ac.ownership.kind !== 'dryLeaseIn') return { ok: false, error: 'Not a leased aircraft' };
  const aircraftId = ac.id;
  const own = ac.ownership;
  const was = own.leaseEnd;
  own.leaseEnd = q.end;
  const r = bookLeaseReturn(g, ac);
  if (!r.ok) {
    own.leaseEnd = was;
    return r;
  }
  ac.returning!.earlyFee = q.fee;
  // v0.12.1 kept so a return check that falls through puts the lease back as it was (rent, notice, lease end).
  ac.returning!.wasEnd = was;
  own.noticeGiven = true;
  const dec = openDecision(g, aircraftId);
  if (dec) g.decisions.splice(g.decisions.indexOf(dec), 1);
  g.stats.earlyReturns = (g.stats.earlyReturns ?? 0) + 1;
  pushMessage(g, {
    tone: 'info', cat: 'company', title: `${ac.reg} goes back to ${lessorOf(ac)} early`,
    body: `The lease now ends ${fmtDay(q.end)} instead of ${fmtDay(was)}. Early-return fee ${usd(q.fee)} (paid when the return check starts); about ${usd(q.rentSaved)} of rent saved.`,
    ref: { kind: 'aircraft', id: ac.id },
  });
  return { ok: true, msg: `${ac.reg} returns ${fmtDay(q.end)} · fee ${usd(q.fee)}` };
}

export interface LeaseView {
  lessor: string; ends: Minute; daysLeft: number; rent: number; returnSite: string;
  options: { id: LeaseChoice; label: string; rent?: number; cost?: number; chips: string[] }[];
  returning: Aircraft['returning'] | null; decisionId: string | null;
}

const MONTH = 30.44 * DAY;
const wideOf = (ac: Aircraft) => (typeOf(ac.typeId).body === 'wide' ? 1 : 0);
const siteCity = (code: string) => LESSOR_SITES.find((s) => s.code === code)?.city ?? AIRPORT_BY_CODE[code]?.city ?? code;
const lessorOf = (ac: Aircraft) => (ac.ownership.kind === 'dryLeaseIn' ? ac.ownership.lessor.replace(' (used sale)', '') : '');

const indexOf = (g: GameState, ac: Aircraft) => (typeOf(ac.typeId).body === 'wide' ? g.market.wideIndex : g.market.narrowIndex);

/**
 * Rent for an extension: today's rent × the term factor × the market's move since the rent was set. v0.14.1 (M6) never
 * below the type's rent floor (an old A330-200 about $150K): a pre-v0.14 lease no longer extends forever under it.
 */
function extendedRent(g: GameState, ac: Aircraft, months: 12 | 36): number {
  if (ac.ownership.kind !== 'dryLeaseIn') return 0;
  // v0.17 (§E.6) extensions offered now follow the type's tightness (a tight A330 about +2 %, an easing A320ceo about
  // −0.5 %); an extension already agreed keeps its rent. The v0.16 market keeps the fixed 0.97 / 0.92.
  const x = extensionRentX(g, ac.typeId, months) ?? BAL.leaseReturn.extend[months];
  const raw = Math.round((ac.ownership.rentPerMonth * x * (indexOf(g, ac) / (ac.ownership.index ?? 1))) / 1000) * 1000;
  return floorRent(typeOf(ac.typeId), raw);
}

/**
 * v0.14.1 (M3) an agreed extension's rent takes over at its start (the old lease end): the rent before it is kept for
 * that month's bill (finance.ts rentOver). Daily and at 'lease.end'.
 */
export function applyRentStep(g: GameState, ac: Aircraft): void {
  if (ac.ownership.kind !== 'dryLeaseIn') return;
  const own = ac.ownership;
  const next = own.nextRent;
  if (!next || next.from > g.now) return;
  own.prevRent = { until: next.from, rent: own.rentPerMonth };
  own.rentPerMonth = next.rent;
  own.index = next.index;
  delete own.nextRent;
}

const pct = (a: number, b: number) => `${a <= b ? '−' : '+'}${Math.abs(Math.round((1 - a / b) * 100))}%`;

/**
 * Share of the C-check interval used at the lease end. v0.14.1 (M1) a C-check booked to end before then restarts the
 * clock (calendar share from its end). With none booked, the flight-hour and calendar shares at `at` (scheduled legs
 * counted): under 100 % it is the half-life share; from 100 % to the overdue tolerance the check is due and not done,
 * so it is ours to pay (`overdue`); past the tolerance the aircraft is grounded and the check forced before then, so
 * the clock has restarted (the share past 100 %, mod 1, as over a long lease). Was the calendar share mod 1 from
 * 100 %: an airframe handed back with its C-check due went back free.
 */
function usedC(g: GameState, ac: Aircraft, at: Minute, stop: Minute = at): { used: number; overdue: boolean } {
  const t = typeOf(ac.typeId);
  const interval = t.cCheckMonths * MONTH;
  const when = Math.max(at, g.now);
  const c = nextPlanned(g, ac.id, 'C');
  if (c && c.end <= when) return { used: Math.min(1, Math.max(0, ((when - c.end) / interval) % 1)), overdue: false };
  const u = checkUsedAt(g, ac, 'C', when).used;
  if (u < 1) return { used: Math.max(0, u), overdue: false };
  // v0.17.2 (player's CS-TCS) judged when it stops flying (`stop`: the return check's start): still inside the
  // tolerance then, nothing forced the check before the return, so it is due at the return and ours (it read past the
  // tolerance at the lease end, a week into the return check, and the return looked free of it).
  if (u <= 1 + BAL.overdueTolerance || checkUsedAt(g, ac, 'C', Math.max(stop, g.now)).used <= 1 + BAL.overdueTolerance) return { used: 1, overdue: true };
  return { used: Math.min(1, (u - 1) % 1), overdue: false };
}

/** The return: ferry to the return site, check, half-life, cabin back as delivered, white repaint; deposit back. Pure. */
export function returnQuote(g: GameState, aircraftId: string, at?: Minute): ReturnQuote | null {
  const ac = g.fleet[aircraftId];
  if (!ac || ac.ownership.kind !== 'dryLeaseIn') return null;
  const own = ac.ownership;
  // v0.7.2 `at`: an early return's end (default the lease end).
  const endAt = at ?? own.leaseEnd;
  const w = wideOf(ac);
  const L = BAL.leaseReturn;
  const site = own.returnSite ?? g.company.homeBase;
  // v0.17 (§I.2, §E.5) a short-term sublease goes back to the airline after a 1-day inspection, with no half-life,
  // cabin or paint charge; an old aircraft's lease ("as is, with the engines' green time") has a lighter check.
  if (own.spot) {
    const inspect = BAL.v017.terms.spotReturn.inspectCost[w];
    const r0 = route(ac.typeId, g.company.homeBase, site, etopsCap(g.company.approvals, ac.typeId));
    const s0 = endAt - DAY;
    const ferry0 = r0 && r0.length ? timeChain(r0, s0 - typeOf(ac.typeId).turnMin - routeSpan(r0, ac.typeId), ac.typeId).map((l, i, all) => ({ ...l, block: l.sta - l.std, nightStopAfter: i < all.length - 1 && all[i + 1].std - l.sta > 8 * 60 })) : [];
    return { site, lines: [{ label: 'Return inspection', amount: inspect }], total: inspect, deposit: own.deposit ?? 0, checkDays: 1, ferry: ferry0 };
  }
  const checkDays = L.checkDays[w];
  const share = own.halfLifeShare ?? L.halfLifeShare;
  const oldX = own.halfLifeShare !== undefined && own.halfLifeShare <= BAL.v017.terms.halfLife.old ? BAL.v017.terms.oldCheckX : 1;
  const lines: { label: string; amount: number }[] = [{ label: 'Return check', amount: Math.round((L.checkCost[w] * oldX) / 1000) * 1000 }];
  const booked = ac.returning ? g.maintenance[ac.returning.maintId] : undefined;
  const c = usedC(g, ac, endAt, at === undefined && booked?.status === 'planned' ? booked.start : endAt - checkDays * DAY);
  // v0.14.1 (M1) a C-check due and not done at the return is ours: the lessor has it done on our money (what it costs
  // us to do it, the reserves paying their share), in place of the half-life.
  if (c.overdue) lines.push({ label: 'C-check due before the return', amount: checkCostOf(ac, 'C') });
  const half = c.overdue ? 0 : Math.round((Math.max(0, c.used - 0.5) * cCheckGross(ac.typeId) * share) / 1000) * 1000;
  if (half > 0) lines.push({ label: 'Half-life compensation', amount: half });
  const cabin = reinstateCost(ac);
  if (cabin) lines.push({ label: `Cabin back to ${layoutName(own.deliveredLayout ?? ac.cabin.layout)}`, amount: cabin });
  if (ac.livery !== 'white' || ac.paintedFor) {
    const [lo, hi] = BAL.paint.full.cost[w];
    lines.push({ label: 'Strip and white repaint', amount: Math.round((((lo + hi) / 2) * L.repaintFactor) / 1000) * 1000 });
  }
  // v0.11 inside our ETOPS approval and the type's capability (the 60-minute rule without one).
  const r = route(ac.typeId, g.company.homeBase, site, etopsCap(g.company.approvals, ac.typeId));
  const start = endAt - checkDays * DAY;
  const ferry = r && r.length ? timeChain(r, start - typeOf(ac.typeId).turnMin - routeSpan(r, ac.typeId), ac.typeId).map((l, i, all) => ({ ...l, block: l.sta - l.std, nightStopAfter: i < all.length - 1 && all[i + 1].std - l.sta > 8 * 60 })) : [];
  return { site, lines, total: lines.reduce((s, l) => s + l.amount, 0), deposit: own.deposit ?? 0, checkDays, ferry };
}

const openDecision = (g: GameState, acId: string) => g.decisions.find((d) => d.kind === 'leaseEnd' && d.data?.aircraftId === acId);

/** The lease and its choices with live quotes (Fleet card, Lease modal). Pure. */
export function leaseView(g: GameState, aircraftId: string): LeaseView | null {
  const ac = g.fleet[aircraftId];
  if (!ac || ac.ownership.kind !== 'dryLeaseIn') return null;
  const own = ac.ownership;
  const q = returnQuote(g, aircraftId)!;
  const r12 = extendedRent(g, ac, 12);
  const r36 = extendedRent(g, ac, 36);
  const lessor = lessorOf(ac);
  // v0.17.2 with an early return booked, an extension still runs from the lease's own end (the early return is undone).
  const fullEnd = ac.returning?.wasEnd ?? own.leaseEnd;
  return {
    lessor, ends: own.leaseEnd, daysLeft: Math.max(0, Math.ceil((own.leaseEnd - g.now) / DAY)), rent: own.rentPerMonth, returnSite: q.site,
    options: [
      { id: 'extend12', label: 'Extend 12 months', rent: r12, chips: [`${usd(r12)}/month (${pct(r12, own.rentPerMonth)})`, `To ${fmtDate(fullEnd + 12 * MONTH)}`] },
      { id: 'extend36', label: 'Extend 36 months', rent: r36, chips: [`${usd(r36)}/month (${pct(r36, own.rentPerMonth)})`, `To ${fmtDate(fullEnd + 36 * MONTH)}`] },
      { id: 'return', label: `Return to ${lessor} at ${siteCity(q.site)}`, cost: q.total, chips: [`≈ ${usd(q.total)} return costs`, `Deposit ${usd(q.deposit)} back`] },
    ],
    returning: ac.returning ?? null, decisionId: openDecision(g, aircraftId)?.id ?? null,
  };
}

/** Undoes a booked return that has not started (its ferry and check go). */
function unbook(g: GameState, ac: Aircraft): ActionResult {
  const r = ac.returning;
  if (!r) return { ok: true };
  const m = g.maintenance[r.maintId];
  if (m && m.status === 'inWork') return { ok: false, error: 'The return check is under way' };
  if (m && m.status === 'planned') {
    // The player's cancelCheck refuses return checks (the lease choice owns them): undone here.
    m.status = 'cancelled';
    m.ev++;
    const ferries = (m.ferryIds ?? []).filter((id) => g.flights[id]?.status === 'scheduled');
    if (ferries.length) removeFlights(g, ferries);
  }
  dropReturn(ac);
  return { ok: true };
}

/**
 * v0.12.1 a booked return that is off (unbooked, or its check fell through): an early return's lease end goes back
 * to the original date (no fee, the rent runs again), and the lease-end choice comes round again in its notice
 * window. True when an early return was undone.
 */
function dropReturn(ac: Aircraft): boolean {
  const was = ac.returning?.wasEnd;
  delete ac.returning;
  if (ac.ownership.kind !== 'dryLeaseIn') return false;
  ac.ownership.noticeGiven = false;
  if (was === undefined || was <= ac.ownership.leaseEnd) return false;
  ac.ownership.leaseEnd = was;
  return true;
}

/** Extend 12 or 36 months, or book the return. Also the 'leaseEnd' decision's resolver. */
export function chooseLease(g: GameState, aircraftId: string, choice: LeaseChoice): ActionResult {
  const ac = g.fleet[aircraftId];
  if (!ac || ac.ownership.kind !== 'dryLeaseIn') return { ok: false, error: 'Not a leased aircraft' };
  const lk = lockOf(g, 'fleet');
  if (lk) return { ok: false, error: lk };
  const own = ac.ownership;
  const dec = openDecision(g, aircraftId);
  if (choice === 'return') {
    // v0.17.2 an early return booked goes back to the return at the lease end (no fee; the rent runs to the end).
    if (ac.returning && ac.returning.wasEnd !== undefined) {
      return atomic(g, 'chooseLease', (error): ActionResult => ({ ok: false, error }), () => {
        const u = unbook(g, ac);
        if (!u.ok) return u;
        const r = bookLeaseReturn(g, ac);
        if (r.ok && dec) g.decisions.splice(g.decisions.indexOf(dec), 1);
        return r;
      }, (r) => !r.ok);
    }
    if (ac.returning) return { ok: false, error: 'The return is already booked' };
    const r = bookLeaseReturn(g, ac);
    if (r.ok && dec) g.decisions.splice(g.decisions.indexOf(dec), 1);
    return r;
  }
  // v0.17 (§I.2) a short-term sublease cannot be extended: the airline needs it back for its season.
  if (own.spot) return { ok: false, error: `${own.spot.airline} needs ${ac.reg} back on ${fmtDay(own.leaseEnd)}` };
  const months = choice === 'extend36' ? 36 : 12;
  // v0.14.1 (M3) one agreed extension at a time: its rent starts at the old lease end.
  if (own.nextRent) return { ok: false, error: `Already extended to ${fmtDate(own.leaseEnd)}: ${usd(own.nextRent.rent)}/month from ${fmtDay(own.nextRent.from)}` };
  const u = unbook(g, ac);
  if (!u.ok) return u;
  const rent = extendedRent(g, ac, months);
  // v0.14.1 (M3) the new rent runs from the old lease end (was: at once, up to 120 days early); a lease already past its
  // end (rolling on at +10 %) takes it now.
  const from = Math.max(g.now, own.leaseEnd);
  own.leaseEnd = Math.round(own.leaseEnd + months * MONTH);
  own.nextRent = { from, rent, index: indexOf(g, ac) };
  applyRentStep(g, ac);
  own.noticeGiven = false;
  schedule(g, own.leaseEnd, 'lease.end', ac.id);
  g.stats.leaseExtensions = (g.stats.leaseExtensions ?? 0) + 1;
  if (dec) g.decisions.splice(g.decisions.indexOf(dec), 1);
  touchFlights(g);
  pushMessage(g, { tone: 'good', cat: 'company', title: `Lease extended: ${ac.reg}`, body: `${months} more months from ${lessorOf(ac)} at ${usd(rent)}/month${from > g.now ? ` from ${fmtDay(from)}` : ''}, to ${fmtDate(own.leaseEnd)}.`, ref: { kind: 'aircraft', id: ac.id } });
  return { ok: true, msg: `${ac.reg} leased to ${fmtDate(own.leaseEnd)} at ${usd(rent)}/month` };
}

/** Books the return: a return check at the return site ending at the lease end, with a ferry there before it. */
function bookLeaseReturn(g: GameState, ac: Aircraft): ActionResult {
  if (ac.ownership.kind !== 'dryLeaseIn') return { ok: false, error: 'Not a leased aircraft' };
  if (ac.status === 'delivering') return { ok: false, error: `${ac.reg} has not been delivered yet` };
  const q = returnQuote(g, ac.id)!;
  const end = ac.ownership.leaseEnd;
  const start = Math.max(end - q.checkDays * DAY, g.now + BAL.ferryLeadMin + (q.ferry.length ? q.ferry[q.ferry.length - 1].sta - q.ferry[0].std + 2 * typeOf(ac.typeId).turnMin : 60));
  const from = q.ferry.length ? Math.min(start, q.ferry[0].std) - typeOf(ac.typeId).turnMin : start;
  const clash = flightsOf(g, ac.id).filter((f) => (f.status === 'scheduled' || f.status === 'enroute') && f.kind !== 'positioning' && f.std < start + q.checkDays * DAY && (f.eta ?? f.sta) > from);
  if (clash.length) return { ok: false, error: `Clashes with ${clash.length} flight${clash.length > 1 ? 's' : ''} from ${fmtDay(clash[0].std)}: move them first` };
  const r = scheduleCheck(g, ac.id, 'return', start, q.site, { leaseReturn: { days: q.checkDays, cost: q.total } });
  if (!r.ok) return r;
  const m = g.maintenance[r.data!.maintId];
  ac.returning = { site: q.site, maintId: m.id, ferryIds: [...(m.ferryIds ?? [])], quote: q.total };
  const f0 = m.ferryIds?.length ? g.flights[m.ferryIds[0]] : undefined;
  pushMessage(g, {
    tone: 'info', cat: 'company', title: `Lease return booked: ${ac.reg}`,
    body: `${f0 ? `Return ferry ${fmtDay(f0.std)} · ` : ''}return check ${q.site} ${fmtDayRange(m.start, m.end)}. Return costs about ${usd(q.total)}; deposit ${usd(q.deposit)} back at the end.`,
    ref: { kind: 'aircraft', id: ac.id },
  });
  return { ok: true, msg: `${ac.reg} goes back to ${lessorOf(ac)} at ${siteCity(q.site)} on ${fmtDay(m.end)}` };
}

/** Daily: the 120-day notice (a decision, default extend 12 months); a return check that fell through is unbooked. */
export function dailyLeases(g: GameState): void {
  const L = BAL.leaseReturn;
  for (const ac of Object.values(g.fleet)) {
    if (ac.ownership.kind !== 'dryLeaseIn') continue;
    const own = ac.ownership;
    applyRentStep(g, ac);
    if (ac.returning) {
      const m = g.maintenance[ac.returning.maintId];
      if (!m || m.status === 'cancelled') {
        const early = dropReturn(ac);
        const body = early
          ? `The return check at ${siteCity(own.returnSite ?? g.company.homeBase)} fell through, so the early return is off: the lease runs to ${fmtDate(own.leaseEnd)} again at ${usd(own.rentPerMonth)}/month, with no early-return fee. Book the return again or extend.`
          : `The return check at ${siteCity(own.returnSite ?? g.company.homeBase)} fell through. Book the return again or extend; at the lease end it rolls on a month at +10%.`;
        pushMessage(g, { tone: 'warn', cat: 'company', title: `Lease return slipped: ${ac.reg}`, body, ref: { kind: 'aircraft', id: ac.id }, ...cardMeta(leaseReturnCard(g, ac.id)) });
      }
      continue;
    }
    // v0.17 (§I.2) a short-term sublease: no extension; its return is booked 21 days before the date (or we are told).
    if (own.spot) {
      if (own.noticeGiven || ac.status === 'delivering' || own.leaseEnd - g.now > 21 * DAY || own.leaseEnd <= g.now) continue;
      own.noticeGiven = true;
      const b = bookLeaseReturn(g, ac);
      if (!b.ok) pushMessage(g, { tone: 'warn', cat: 'company', title: `Book ${ac.reg}'s return to ${own.spot.airline}`, body: `It is due back at ${siteCity(own.spot.base)} on ${fmtDay(own.leaseEnd)}: ${b.error}. Late costs twice the rent.`, ref: { kind: 'aircraft', id: ac.id } });
      continue;
    }
    if (own.noticeGiven || ac.status === 'delivering' || own.leaseEnd - g.now > L.noticeDays * DAY) continue;
    own.noticeGiven = true;
    const v = leaseView(g, ac.id)!;
    const [e12, e36, ret] = v.options;
    pushDecision(g, {
      kind: 'leaseEnd', title: `Lease of ${ac.reg} ends ${fmtDayRel(own.leaseEnd, g.now)}`,
      body: `${v.lessor} offers 12 months at ${usd(e12.rent!)} (${pct(e12.rent!, own.rentPerMonth)}) or 36 months at ${usd(e36.rent!)} (${pct(e36.rent!, own.rentPerMonth)}). Returning costs about ${usd(ret.cost!)} at ${siteCity(v.returnSite)} (check, half-life, cabin, paint) and frees ${usd(own.deposit ?? 0)} deposit.`,
      options: v.options.map((o) => ({ id: o.id, label: o.label, desc: o.id === 'return' ? `Ferry to ${siteCity(v.returnSite)} and a ${BAL.leaseReturn.checkDays[wideOf(ac)]}-day return check ending ${fmtDay(own.leaseEnd)}.` : `Keep ${ac.reg} flying; the next notice comes 120 days before the new end.`, chips: o.chips, tone: o.id === 'return' ? 'warn' as const : 'good' as const })),
      defaultOption: 'extend12', expires: g.now + L.decisionDays * DAY, ref: { kind: 'aircraft', id: ac.id }, data: { aircraftId: ac.id },
    });
  }
}

/** Return check start: the return costs are posted (cat leaseReturn). */
export function onReturnStart(g: GameState, m: MaintenanceEvent): void {
  if (m.kind !== 'return') return;
  const ac = g.fleet[m.aircraftId];
  // Priced on the day the check starts (the aircraft's real condition), not the estimate at booking.
  const amt = (ac && returnQuote(g, ac.id)?.total) ?? ac?.returning?.quote ?? m.cost;
  if (ac?.returning) ac.returning.quote = amt;
  m.cost = amt;
  post(g, 'leaseReturn', -amt);
  // v0.7.2 an early return's fee to the lessor.
  if (ac?.returning?.earlyFee) post(g, 'leaseReturn', -ac.returning.earlyFee);
}

/** Return check end: deposit back, part-month costs settled, the aircraft leaves the fleet. */
export function onReturnEnd(g: GameState, m: MaintenanceEvent): void {
  if (m.kind !== 'return') return;
  const ac = g.fleet[m.aircraftId];
  if (!ac || ac.ownership.kind !== 'dryLeaseIn') return;
  const own = ac.ownership;
  const q = returnQuote(g, ac.id);
  if (own.deposit) cashOnly(g, own.deposit);
  // v0.17 an up-front reserves deposit comes back with the aircraft.
  if (own.reservesDeposit) cashOnly(g, own.reservesDeposit);
  settleDeparture(g, ac);
  delete g.fleet[ac.id];
  g.stats.leaseReturns = (g.stats.leaseReturns ?? 0) + 1;
  touchFlights(g);
  const parts = (q?.lines ?? []).map((l) => `${l.label.replace(/^Return check$/, 'check').replace(/^Half-life compensation$/, 'half-life').replace(/^C-check due before the return$/, 'the C-check that was due').replace(/^Strip and white repaint$/, 'repaint').replace(/^Cabin back to /, 'cabin back to ')} ${usd(l.amount)}`);
  pushMessage(g, {
    tone: 'info', cat: 'company', title: `${ac.reg} returned to ${lessorOf(ac)}`,
    body: `Redelivered at ${siteCity(m.at)} after a ${Math.round((m.end - m.start) / DAY)}-day return check. Return costs ${usd(ac.returning?.quote ?? m.cost)}${parts.length ? ` (${parts.join(', ')})` : ''}.${own.deposit ? ` Deposit ${usd(own.deposit)} refunded.` : ''}${ac.returning?.ferryIds.length ? ' The ferry crew deadheads home.' : ''}`,
  });
}

/** v0.17.2 a return this close after the C-check falls due weighs flying on, parking or an early return against the check. */
export const RETURN_NEAR = 183 * DAY;

/** v0.17.2 one way to handle a C-check that falls due before a lease return (CheckModal, 'Before the return'). */
export interface ReturnCheckWay {
  id: 'book' | 'fly' | 'park' | 'early';
  title: string;
  ok: boolean;
  /** What it costs us on top of the return check and the usual return items ($). */
  cost: number;
  /** Days it cannot fly that it otherwise could (0: none). */
  idle: number;
  /** One or two plain lines: what happens, and why not when it can't be done. */
  lines: string[];
}

export interface CheckBeforeReturn {
  lessor: string;
  site: string;
  /** The C-check falls due (100 %), and the end of the 10 % tolerance (grounded after). */
  due: Minute;
  groundedAt: Minute;
  /** The return: ferry out (it stops flying), check start and end (the lease end). */
  stop: Minute;
  start: Minute;
  end: Minute;
  /** What the lessor charges at the return for a C-check due and not done (our share, the reserves paying theirs). */
  atReturn: number;
  ways: ReturnCheckWay[];
  recommend: ReturnCheckWay['id'];
  /** The recommendation in one plain line. */
  why: string;
}

/**
 * v0.17.2 (player's CS-TCS: "What does this mean? Should I book the check or is it not worth it?") a leased aircraft
 * going back to its lessor whose C-check falls due before the return check starts: the real choices, with what each
 * costs and the flying it loses. The lessor's return conditions (UPDATE-0.7.md §F6.6, usedC): a C-check due and not
 * done at the return is done by the lessor on our money (our share: the reserves pay theirs); done before, the
 * aircraft goes back with the interval fresh and nothing more to pay. The ways:
 * - book the C-check at a hub in a free window (cost all in, days away);
 * - fly on the 10 % tolerance to the return, when it lasts that long (the C-check charged at the return);
 * - park it from the due date to the return ferry (the C-check charged at the return, days lost);
 * - ask the lessor to take it back early, before the due date (its fee, rent saved, the half-life charge), when the
 *   lease allows (30 days' notice, 90 days of the lease left).
 * Recommended: the cheapest counting each day lost at the rent it still costs, flying on the tolerance only when the
 * check cannot be booked (it leaves no slack: a late ferry or a delay grounds it). Null when none of this applies. Pure.
 */
export function checkBeforeReturn(g: GameState, aircraftId: string, hub?: { total: number; ok: boolean; awayDays: number; start: Minute; end: Minute; city: string; why: string | null }): CheckBeforeReturn | null {
  const ac = g.fleet[aircraftId];
  if (!ac || ac.ownership.kind !== 'dryLeaseIn' || !ac.returning) return null;
  const m = g.maintenance[ac.returning.maintId];
  if (!m || m.status !== 'planned' || nextPlanned(g, ac.id, 'C')) return null;
  const due = cDueAt(g, ac);
  // (A return months or years after the check falls due: the check is simply needed to keep flying.)
  if (due >= m.start || m.start - due > RETURN_NEAR) return null;
  const own = ac.ownership;
  const groundedAt = cDueAt(g, ac, 1 + BAL.overdueTolerance);
  const f0 = ac.returning.ferryIds.map((id) => g.flights[id]).find((f) => !!f && f.status === 'scheduled');
  const stop = Math.min(m.start, f0?.std ?? m.start);
  const atReturn = checkCostOf(ac, 'C');
  const perDay = own.rentPerMonth / MONTH * DAY;
  const days = (a: Minute, b: Minute) => Math.max(0, Math.round((b - a) / DAY));
  const lessor = lessorOf(ac);
  const site = siteCity(ac.returning.site);
  const ways: ReturnCheckWay[] = [];
  ways.push(hub
    ? {
      id: 'book', title: 'Book the C-check now', ok: hub.ok, cost: hub.total, idle: 0,
      lines: hub.ok
        ? [`${hub.city} ${fmtDayRange(hub.start, hub.end)}, in a gap with no flights (${Math.round(hub.awayDays)} days away). It then flies to the return and goes back with nothing more to pay for the check.`]
        : [hub.why ?? 'No hub window fits before it falls due.'],
    }
    : { id: 'book', title: 'Book the C-check now', ok: false, cost: 0, idle: 0, lines: ['No hub window fits before it falls due.'] });
  const fly = groundedAt >= stop;
  ways.push({
    id: 'fly', title: 'Fly on the tolerance to the return', ok: fly, cost: atReturn, idle: 0,
    lines: fly
      ? [`Past ${fmtDay(due)} it flies on the ${Math.round(BAL.overdueTolerance * 100)} % tolerance (grounded after ${fmtDay(groundedAt)}) up to the return on ${fmtDay(stop)}. ${lessor} then has the C-check done at the return on our money.`, 'No slack: a late ferry or a long delay grounds it.']
      : [`The tolerance runs out ${fmtDay(groundedAt)}, before the return on ${fmtDay(stop)}.`],
  });
  const idlePark = days(due, stop);
  ways.push({
    id: 'park', title: `Park it from ${fmtDay(due)}`, ok: true, cost: atReturn, idle: idlePark,
    lines: [`It stops flying when the check falls due and waits ${idlePark} days for the return ferry (rent runs on, about ${usd(Math.round((idlePark * perDay) / 1000) * 1000)}). ${lessor} has the C-check done at the return on our money.`],
  });
  // Brought forward to end before the C-check falls due (the lessor's minimum notice and lease left permitting).
  const eq = earlyReturnQuote(g, aircraftId, Math.floor(Math.min(due, (ac.returning.wasEnd ?? own.leaseEnd) - BAL.v072.earlyReturn.minLeftDays * DAY) / DAY) * DAY + 12 * 60);
  const lost = eq.ok ? days(eq.end - eq.returnCosts.checkDays * DAY, stop) : 0;
  ways.push({
    id: 'early', title: `Ask ${lessor} to take it back early`, ok: eq.ok, cost: eq.ok ? eq.fee + eq.returnCosts.total - eq.rentSaved - baseReturn(g, ac) : 0, idle: lost,
    lines: eq.ok
      ? [`Back by ${fmtDay(eq.end)}, before the check is due: fee ${usd(eq.fee)}, about ${usd(eq.rentSaved)} of rent saved, the half-life charge instead of the check. It stops flying ${lost} days sooner.`]
      : [`${lessor} won't: ${lower((eq.why ?? 'not possible').replace(/: use the normal return$/, '').replace(/^That leaves under/, 'it would leave under'))}.`],
  });
  const score = (w: ReturnCheckWay) => w.cost + w.idle * perDay;
  const firm = ways.filter((w) => w.ok && w.id !== 'fly');
  const best = firm.sort((a, b) => score(a) - score(b))[0];
  const rec = best?.id === 'park' && fly ? ways[1] : best ?? ways[2];
  const why = rec.id === 'book'
    ? `Book it: ${usd(rec.cost)} now${atReturn > rec.cost ? `, less than the ${usd(atReturn)} ${lessor} charges at the return,` : ''} and it keeps flying until it goes back.`
    : rec.id === 'fly'
      ? `No window to book it: fly on the tolerance and let ${lessor} do the check at the return (${usd(atReturn)}).`
      : rec.id === 'early'
        ? `Hand it back early: it costs less than doing the check or parking it.`
        : `Park it: the check costs more than the ${idlePark} days it would still fly.`;
  return { lessor, site, due, groundedAt, stop, start: m.start, end: m.end, atReturn, ways, recommend: rec.id, why };
}

const lower = (x: string) => (x ? x[0].toLowerCase() + x.slice(1) : x);

/** The return costs as booked now without a C-check line (the early way's cost counts only what it adds or saves). */
function baseReturn(g: GameState, ac: Aircraft): number {
  const q = returnQuote(g, ac.id);
  return q ? q.lines.filter((l) => l.label !== 'C-check due before the return').reduce((n, l) => n + l.amount, 0) : 0;
}
