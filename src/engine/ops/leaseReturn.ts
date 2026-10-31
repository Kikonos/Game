// v0.7 lease returns (UPDATE-0.7.md §F6.6): 120 days before a lease ends the lessor asks (extend 12 months by
// default, 36, or return). A return is a ferry to the return site and a return check ending at the lease end; the
// return costs (check, half-life, cabin reinstatement, repaint) are posted when the check starts, the deposit comes
// back and the aircraft leaves the fleet when it ends.

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
import { settleDeparture } from './finance';
import { cCheckGross, scheduleCheck } from './maintenance';
import { maintWord, usd } from './util';

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
  const own = ac.ownership;
  if (ac.status === 'delivering') return no(`${ac.reg} has not been delivered yet`);
  if (ac.returning) return no('The return is already booked');
  if (own.leaseEnd - g.now < E.minLeftDays * DAY) return no(`Under ${E.minLeftDays} days left: use the normal return`);
  const w = wideOf(ac);
  const checkDays = BAL.leaseReturn.checkDays[w];
  const turn = typeOf(ac.typeId).turnMin;
  const site = own.returnSite ?? g.company.homeBase;
  const r = route(ac.typeId, g.company.homeBase, site, etopsCap(g.company.approvals, ac.typeId));
  const ferryMin = r && r.length ? routeSpan(r, ac.typeId) + 2 * turn : 0;
  const earliest = Math.ceil((g.now + E.noticeDays * DAY) / DAY) * DAY + 12 * 60;
  // Signed work that keeps it busy: legs (not soft positioning), checks, base programmes.
  const work: { end: Minute; what: string; contractId: string | null }[] = [];
  for (const f of flightsOf(g, ac.id)) if ((f.status === 'scheduled' || f.status === 'enroute') && f.kind !== 'positioning') work.push({ end: f.eta ?? f.sta, what: `${f.no} ${f.from}–${f.to}`, contractId: f.contractId });
  for (const m of Object.values(g.maintenance)) if (m.aircraftId === ac.id && (m.status === 'planned' || m.status === 'inWork')) work.push({ end: m.end, what: `${maintWord(m)} ${fmtDay(m.start)}`, contractId: null });
  for (const c of Object.values(g.contracts)) if ((c.status === 'signed' || c.status === 'active') && c.aircraftIds.includes(ac.id)) work.push({ end: c.pattern.kind === 'base' ? c.pattern.to : c.end, what: c.title, contractId: c.id });
  const busyEnd = Math.max(0, ...work.map((x) => x.end));
  const e = end ?? Math.max(earliest, Math.ceil((busyEnd + ferryMin + checkDays * DAY) / DAY) * DAY + 12 * 60);
  if (e < earliest - 60) return no(`The lessor wants ${E.noticeDays} days' notice: from ${fmtDay(earliest)}`, e);
  if (own.leaseEnd - e < E.minLeftDays * DAY) return no(`That leaves under ${E.minLeftDays} days of the lease: use the normal return`, e);
  const ferryOut = e - checkDays * DAY - ferryMin;
  const blockers: string[] = [];
  const byContract = new Map<string, number>();
  for (const f of flightsOf(g, ac.id)) {
    if (f.status !== 'scheduled' || f.kind === 'positioning' || (f.eta ?? f.sta) <= ferryOut) continue;
    const k = f.contractId ?? '';
    byContract.set(k, (byContract.get(k) ?? 0) + 1);
  }
  for (const [k, n] of byContract) blockers.push(`${k ? g.contracts[k]?.title ?? 'A contract' : 'Other flights'}: ${n} leg${n > 1 ? 's' : ''} after ${fmtDay(ferryOut)}`);
  for (const c of Object.values(g.contracts)) {
    if ((c.status === 'signed' || c.status === 'active') && c.aircraftIds.includes(ac.id) && c.pattern.kind === 'base' && c.pattern.to > ferryOut && !byContract.has(c.id)) blockers.push(`${c.title}: runs to ${fmtDay(c.pattern.to)}`);
  }
  const rq = returnQuote(g, ac.id, e)!;
  const monthsLeft = (own.leaseEnd - e) / MONTH;
  const fee = Math.round((Math.max(E.feeMinMonths, E.feeShare * monthsLeft) * own.rentPerMonth) / 1000) * 1000;
  const rentSaved = Math.round((monthsLeft * own.rentPerMonth) / 1000) * 1000;
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

/** Rent for an extension: today's rent × the term factor × the market's move since the rent was set. */
function extendedRent(g: GameState, ac: Aircraft, months: 12 | 36): number {
  if (ac.ownership.kind !== 'dryLeaseIn') return 0;
  return Math.round((ac.ownership.rentPerMonth * BAL.leaseReturn.extend[months] * (indexOf(g, ac) / (ac.ownership.index ?? 1))) / 1000) * 1000;
}

const pct = (a: number, b: number) => `${a <= b ? '−' : '+'}${Math.abs(Math.round((1 - a / b) * 100))}%`;

/** Share of the C-check interval used at the lease end: the C-checks due before then reset it (calendar share mod 1);
 *  with none due first, the larger of today's flight-hour share and the calendar share. In [0, 1]. */
function usedC(g: GameState, ac: Aircraft, at: Minute): number {
  const t = typeOf(ac.typeId);
  const fhLimit = t.body === 'wide' ? BAL.cCheckFH.wide : BAL.cCheckFH.narrow;
  const cal = (Math.max(at, g.now) - ac.maint.lastC) / (t.cCheckMonths * MONTH);
  const frac = cal >= 1 ? cal % 1 : Math.max(ac.maint.fhSinceC / fhLimit, cal);
  return Math.min(1, Math.max(0, frac));
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
  const checkDays = L.checkDays[w];
  const lines: { label: string; amount: number }[] = [{ label: 'Return check', amount: L.checkCost[w] }];
  const half = Math.round((Math.max(0, usedC(g, ac, endAt) - 0.5) * cCheckGross(ac.typeId) * L.halfLifeShare) / 1000) * 1000;
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
  return {
    lessor, ends: own.leaseEnd, daysLeft: Math.max(0, Math.ceil((own.leaseEnd - g.now) / DAY)), rent: own.rentPerMonth, returnSite: q.site,
    options: [
      { id: 'extend12', label: 'Extend 12 months', rent: r12, chips: [`${usd(r12)}/month (${pct(r12, own.rentPerMonth)})`, `To ${fmtDate(own.leaseEnd + 12 * MONTH)}`] },
      { id: 'extend36', label: 'Extend 36 months', rent: r36, chips: [`${usd(r36)}/month (${pct(r36, own.rentPerMonth)})`, `To ${fmtDate(own.leaseEnd + 36 * MONTH)}`] },
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
  const own = ac.ownership;
  const dec = openDecision(g, aircraftId);
  if (choice === 'return') {
    if (ac.returning) return { ok: false, error: 'The return is already booked' };
    const r = bookLeaseReturn(g, ac);
    if (r.ok && dec) g.decisions.splice(g.decisions.indexOf(dec), 1);
    return r;
  }
  const months = choice === 'extend36' ? 36 : 12;
  const u = unbook(g, ac);
  if (!u.ok) return u;
  const rent = extendedRent(g, ac, months);
  own.leaseEnd = Math.round(own.leaseEnd + months * MONTH);
  own.rentPerMonth = rent;
  own.index = indexOf(g, ac);
  own.noticeGiven = false;
  schedule(g, own.leaseEnd, 'lease.end', ac.id);
  g.stats.leaseExtensions = (g.stats.leaseExtensions ?? 0) + 1;
  if (dec) g.decisions.splice(g.decisions.indexOf(dec), 1);
  touchFlights(g);
  pushMessage(g, { tone: 'good', cat: 'company', title: `Lease extended: ${ac.reg}`, body: `${months} more months from ${lessorOf(ac)} at ${usd(rent)}/month, to ${fmtDate(own.leaseEnd)}.`, ref: { kind: 'aircraft', id: ac.id } });
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
  settleDeparture(g, ac);
  delete g.fleet[ac.id];
  g.stats.leaseReturns = (g.stats.leaseReturns ?? 0) + 1;
  touchFlights(g);
  const parts = (q?.lines ?? []).map((l) => `${l.label.replace(/^Return check$/, 'check').replace(/^Half-life compensation$/, 'half-life').replace(/^Strip and white repaint$/, 'repaint').replace(/^Cabin back to /, 'cabin back to ')} ${usd(l.amount)}`);
  pushMessage(g, {
    tone: 'info', cat: 'company', title: `${ac.reg} returned to ${lessorOf(ac)}`,
    body: `Redelivered at ${siteCity(m.at)} after a ${Math.round((m.end - m.start) / DAY)}-day return check. Return costs ${usd(ac.returning?.quote ?? m.cost)}${parts.length ? ` (${parts.join(', ')})` : ''}.${own.deposit ? ` Deposit ${usd(own.deposit)} refunded.` : ''}${ac.returning?.ferryIds.length ? ' The ferry crew deadheads home.' : ''}`,
  });
}
