// v0.8 dry lease out (UPDATE-0.8.md §6): the client leases the aircraft only. Our pilots ferry it to the lessee's
// base and deadhead home; the lessee flies it in its own colours with its crews and does the line and A-checks;
// rent is invoiced monthly in advance and reserves monthly in arrears on the hours flown (leaseIncome); at the end
// our pilots fetch it, a return inspection follows (damage risk), the deposit comes back. Views are pure.

import { AIRPORT_BY_CODE } from '../../data/airports';
import { BAL } from '../core/balance';
import { addFlight, nextId, ownFlightNo, removeFlights, retimeFlight, touchStatus } from '../core/entities';
import { accrue, cashOnly, invoice, post } from '../core/ledger';
import { pushMessage } from '../core/messages';
import { etopsCap, typeOf } from '../core/perf';
import { requestPause } from '../core/pause';
import { schedule } from '../core/queue';
import { chance, int, next, range, type RngHolder } from '../core/rng';
import { DAY, fmtDay, fmtMonth, monthKey, monthStart, fmtDayRange } from '../core/time';
import { hash } from '../core/util';
import type { ActionResult, Aircraft, Contract, ContractOffer, Flight, GameState, Minute, SimEvent } from '../core/types';
import type { CheckLevel, FeasibilityCheck, FeasibilityReport } from '../contracts/feasibility';
import { chainBackward, chainForward, isRerouted, route } from '../contracts/plan';
import { bumpClient, noteJobDone, statsV08 } from '../contracts/relations';
import { autoRoster } from '../crew';
import { checkStatus } from './maintenance';
import { ratedPilots } from './company';
import { usd } from './util';

export interface DryLeaseView {
  contractId: string; aircraftId: string; lessee: string; site: string; phase: 'signed' | 'delivering' | 'leased' | 'returning' | 'done';
  out: [Minute, Minute]; lease: [Minute, Minute]; back: [Minute, Minute]; rent: number; reservesPerFH: number; fhSoFar: number; fhExpected: number;
  income: number; deposit: number; late: number; damage: string | null; cCheck: string;
}

const D = () => BAL.v08.dry;
const city = (code: string) => AIRPORT_BY_CODE[code]?.city ?? code;
const MONTH = 30.44 * DAY;
const side = (g: GameState, key: string): RngHolder => ({ rng: hash(`${g.seed}:dry:${key}`) | 0 });
const isDry = (c: Contract | undefined): c is Contract & { dry: NonNullable<Contract['dry']> } => !!c?.dry && c.product.kind === 'dry';
const live = (c: Contract) => c.status === 'signed' || c.status === 'active';

/** The lessor's sub-lease consent fee for this airframe (leased in only; owned: none). Pure. */
export function consentFor(ac: Aircraft): number {
  if (ac.ownership.kind !== 'dryLeaseIn') return 0;
  return typeOf(ac.typeId).body === 'wide' ? D().consent.wide : D().consent.narrow;
}

/** Span of a list of flights [first std, last sta] (fallback when none). */
function spanOf(g: GameState, ids: string[], fallback: [Minute, Minute]): [Minute, Minute] {
  const fs = ids.map((id) => g.flights[id]).filter((f): f is Flight => !!f && f.status !== 'cancelled');
  if (!fs.length) return fallback;
  return [Math.min(...fs.map((f) => f.std)), Math.max(...fs.map((f) => f.sta))];
}

/** When the C-check falls due against a lease ending at `end`, with the lessee flying fhPerMonth. Pure. */
export function cCheckDue(g: GameState, ac: Aircraft, start: Minute, fhPerMonth: number): Minute {
  const st = checkStatus(g, ac);
  const byFh = start + (Math.max(0, st.cHoursLeft) / Math.max(1, fhPerMonth)) * MONTH;
  return Math.min(st.cDue, byFh);
}

/** The C-check line: when it falls due against the lease. Pure. */
export function cCheckLine(g: GameState, c: Contract): string {
  const ac = g.fleet[c.aircraftIds[0]];
  if (!ac || !c.dry) return '';
  const due = cCheckDue(g, ac, Math.max(g.now, c.start), c.dry.fhPerMonth);
  const end = (c.dry.leaseEnd ?? c.end) + (c.dry.late ?? 0) * DAY;
  return due > end + 30 * DAY ? `C-check due ${fmtMonth(monthKey(due))}, after the return` : `C-check due ${fmtMonth(monthKey(due))}, during the lease: book it before`;
}

/** One dry lease for the offer/contract sheets, the fleet card and the schedule. Pure. */
export function dryLeaseView(g: GameState, contractId: string): DryLeaseView | null {
  const c = g.contracts[contractId];
  if (!isDry(c) || c.product.kind !== 'dry') return null;
  const d = c.dry;
  const leaseEnd = (d.leaseEnd ?? c.end) + (d.late ?? 0) * DAY;
  const out = spanOf(g, d.outIds, [c.start - DAY, c.start]);
  const back = spanOf(g, d.backIds, [leaseEnd + DAY, leaseEnd + 2 * DAY]);
  const phase: DryLeaseView['phase'] = c.status === 'completed' || c.status === 'cancelled' ? 'done'
    : d.returnedAt !== undefined || (d.leasedAt !== undefined && g.now >= leaseEnd) ? 'returning'
    : d.leasedAt !== undefined ? 'leased'
    : g.now >= out[0] ? 'delivering' : 'signed';
  const months = Math.max(0, (leaseEnd - c.start) / MONTH);
  let income = 0;
  for (const r of g.finance.receivables) if (r.contractId === c.id && r.cat === 'leaseIncome') income += r.amount;
  return {
    contractId: c.id, aircraftId: c.aircraftIds[0], lessee: g.clients[c.clientId]?.name ?? 'Lessee', site: d.site, phase,
    out, lease: [d.leasedAt ?? c.start, leaseEnd], back, rent: c.product.rentPerMonth, reservesPerFH: c.product.reservesPerFH,
    fhSoFar: Math.round(d.fh), fhExpected: Math.round(d.fhPerMonth * months),
    income: Math.max(income, Math.round(c.invoiced ?? 0)), deposit: d.deposit, late: d.late ?? 0,
    damage: d.damage ? `${d.damage.what ?? 'Damage'}: ${d.damage.days} days, ${usd(d.damage.cost)} (${Math.round(D().lesseeShare * 100)} % theirs)` : null,
    cCheck: cCheckLine(g, c),
  };
}

/** The live dry lease of an aircraft (signed, delivering, leased or returning). Pure. */
export function dryLeaseOf(g: GameState, aircraftId: string): DryLeaseView | null {
  for (const c of Object.values(g.contracts)) if (isDry(c) && live(c) && c.aircraftIds.includes(aircraftId)) return dryLeaseView(g, c.id);
  return null;
}

/** 'Leased to TAAG until 14 Mar · 412 FH flown by them at Luanda' (fleet card / map panel). Pure. */
export function leasedText(g: GameState, aircraftId: string): string | null {
  const v = dryLeaseOf(g, aircraftId);
  if (!v || (v.phase !== 'leased' && v.phase !== 'returning')) return null;
  return `Leased to ${v.lessee} until ${fmtDay(v.lease[1])} · ${v.fhSoFar.toLocaleString('en-US')} FH flown by them at ${city(v.site)}`;
}

// ---------- planning ----------

interface FerryLeg { from: string; to: string; std: Minute; sta: Minute }

/** Ferry legs from → to arriving by `arriveBy` (latest), or leaving at `leave` (earliest). Pure. */
function ferryLegs(typeId: string, from: string, to: string, opts: { arriveBy?: Minute; leave?: Minute }, cap = Infinity): FerryLeg[] | null {
  if (from === to) return [];
  const r = route(typeId, from, to, cap);
  if (!r) return null;
  // v0.11 the long way round an ETOPS limit flies as ferry days (night stops).
  if (isRerouted(r)) return opts.leave !== undefined ? chainForward(typeId, from, to, Math.ceil(opts.leave / 15) * 15, cap) : chainBackward(typeId, from, to, -Infinity, opts.arriveBy!, cap);
  const turn = typeOf(typeId).turnMin;
  const total = r.reduce((s, l) => s + l.block, 0) + turn * (r.length - 1);
  let t = opts.leave ?? (opts.arriveBy! - total);
  t = Math.ceil(t / 15) * 15;
  return r.map((l) => {
    const leg = { from: l.from, to: l.to, std: t, sta: t + l.block };
    t = leg.sta + turn;
    return leg;
  });
}

/** Where the aircraft will be at t (the last commitment's arrival before t), else where it is. Pure. */
function whereAt(g: GameState, ac: Aircraft, t: Minute): string {
  let at = ac.at;
  let last = -Infinity;
  for (const f of Object.values(g.flights)) {
    if (f.aircraftId !== ac.id || f.status === 'cancelled' || f.sta > t || f.sta < last) continue;
    last = f.sta;
    at = f.to;
  }
  return at;
}

/** The plan of a dry lease on an aircraft: ferry out (arrives a day before), lease, ferry back after a day's inspection. Pure. */
export function dryPlan(g: GameState, o: Pick<ContractOffer, 'start' | 'end' | 'dry'>, ac: Aircraft): { out: FerryLeg[]; back: FerryLeg[]; from: string } | null {
  const site = o.dry?.site;
  if (!site) return null;
  // v0.12.1 the ferry leaves from where the aircraft is when it departs (a leg landing after start − 3 days counts):
  // planned once from 3 days before, then again from the place at that ferry's own departure.
  const cap = etopsCap(g.company.approvals, ac.typeId);
  let from = whereAt(g, ac, o.start - 3 * DAY);
  let out = ferryLegs(ac.typeId, from, site, { arriveBy: o.start - DAY }, cap);
  for (let i = 0; i < 2 && out?.length; i++) {
    const at = whereAt(g, ac, out[0].std - typeOf(ac.typeId).turnMin);
    if (at === from) break;
    from = at;
    out = at === site ? [] : ferryLegs(ac.typeId, from, site, { arriveBy: o.start - DAY }, cap);
  }
  const back = ferryLegs(ac.typeId, site, g.company.homeBase, { leave: o.end + DAY + 8 * 60 }, cap);
  if (!out || !back) return null;
  return { out, back, from };
}

// ---------- feasibility (contracts/feasibility.ts calls this for dry offers) ----------

/** Dry lease checks (§6.2): free for [ferry out … ferry back + 2 days], C-check not inside, lease term, pilots, money. Pure. */
export function dryFeasibility(g: GameState, o: ContractOffer, ac: Aircraft, rep: FeasibilityReport, add: (id: FeasibilityCheck['id'], level: CheckLevel, label: string, detail?: string) => void): FeasibilityReport {
  const t = typeOf(ac.typeId);
  const d = o.dry!;
  const fam = o.requirements.families?.[0];
  if (fam && t.family !== fam) add('family', 'no', `${g.clients[o.clientId]?.name ?? 'The lessee'} wants ${/^[AEIOU8]/.test(fam) ? 'an' : 'a'} ${fam}-family aircraft`);
  else add('family', 'ok', t.name);
  const plan = dryPlan(g, o, ac);
  if (!plan) {
    add('positioning', 'no', `No ferry route to ${city(d.site)}`);
    return rep;
  }
  rep.positionIn = plan.out.map((l) => ({ ...l }));
  rep.positionOut = plan.back.map((l) => ({ ...l }));
  const from = plan.out[0]?.std ?? o.start - DAY;
  const to = (plan.back[plan.back.length - 1]?.sta ?? o.end + 2 * DAY) + 2 * DAY;
  if (from < g.now + 12 * 60) add('availability', 'no', 'Too late to ferry it out before the start');
  const busy = Object.values(g.flights).filter((f) => f.aircraftId === ac.id && f.status === 'scheduled' && f.kind !== 'positioning' && f.std < to && f.sta > from).sort((a, b) => a.std - b.std);
  const mx = Object.values(g.maintenance).filter((m) => m.aircraftId === ac.id && (m.status === 'planned' || m.status === 'inWork') && m.start < to && m.end > from);
  const other = Object.values(g.contracts).find((c) => live(c) && c.dry && c.aircraftIds.includes(ac.id));
  // v0.8 fix pack: a signed base programme whose later weeks are not rolled out as flights yet holds the aircraft too
  // (a bot year signed a Zagreb wet lease and then a dry lease of the same A320 over it: 190 legs cancelled).
  const base = Object.values(g.contracts).find((c) => live(c) && !c.dry && c.pattern.kind === 'base' && c.aircraftIds.includes(ac.id) && c.pattern.from < to && c.pattern.to > from);
  if (other) add('availability', 'no', `Already leased out: ${other.title}`);
  else if (base) add('availability', 'no', `Busy: ${base.title} (${fmtDayRange(base.start, base.end)})`, 'The aircraft must be free from the ferry out to two days after it is back.');
  else if (busy.length) add('availability', 'no', `Busy: ${busy[0].no} ${busy[0].from}–${busy[0].to} ${fmtDay(busy[0].std)}${busy.length > 1 ? ` and ${busy.length - 1} more` : ''}`, 'The aircraft must be free from the ferry out to two days after it is back.');
  else if (mx.length) add('availability', 'no', `${mx[0].kind}-check at ${mx[0].at} ${fmtDay(mx[0].start)} falls inside`);
  else add('availability', 'ok', `Free ${fmtDay(from)} – ${fmtDay(to)}`);
  // The C-check stays ours: not due before the return + 30 days.
  const due = cCheckDue(g, ac, o.start, d.fhPerMonth);
  if (due < o.end + 30 * DAY) rep.checks.push({ id: 'dryLease', level: 'no', label: `C-check due ${fmtMonth(monthKey(due))}, during the lease: book it before`, detail: 'The lessee flies about ' + d.fhPerMonth + ' FH a month on our airframe.', action: { kind: 'cCheck', aircraftId: ac.id } });
  else add('maintenance', 'ok', `C-check due ${fmtMonth(monthKey(due))}, after the return`);
  if (rep.checks.some((c) => c.level === 'no' && c.id === 'dryLease')) rep.level = 'no';
  if (ac.ownership.kind === 'dryLeaseIn') {
    if (ac.ownership.leaseEnd < o.end + 30 * DAY) add('lease', 'no', `Our own lease ends ${fmtDay(ac.ownership.leaseEnd)}, too soon after the return`);
    else add('lease', 'ok', `Leased in: the lessor consents for ${usd(consentFor(ac))}`);
  } else add('lease', 'ok', 'Owned');
  if (ac.sale || ac.returning) add('lease', 'no', ac.sale ? `Sold to ${ac.sale.buyer}` : 'Going back to its lessor');
  const pilots = ratedPilots(g, [t.family]);
  if (pilots.CPT < 1 || pilots.FO < 1) add('crew', 'no', `No ${t.short}-rated pilots to ferry it out and back`);
  else add('crew', 'ok', 'Two of our pilots ferry it out and fetch it back; no crew during the lease');
  const months = Math.max(1, Math.round((o.end - o.start) / MONTH));
  add('dryLease', 'ok', `Dry lease: they fly it with their crews${d.paint ? ' in their colours' : ''}; about ${(d.fhPerMonth * months).toLocaleString('en-US')} FH on our airframe`);
  // Money: rent and reserves in; the two ferries, the consent fee and the wear the reserves pay for (their hours
  // bring our checks and life-limited parts closer: the reserves are set aside for them, not profit) out.
  const p = o.product.kind === 'dry' ? o.product : null;
  const ferryBH = [...plan.out, ...plan.back].reduce((s, l) => s + (l.sta - l.std), 0) / 60;
  const ferryCost = ferryBH * (t.fuelTBH * g.market.fuelPrice + t.maintBH) + (plan.out.length + plan.back.length) * BAL.airportFees[t.body === 'wide' ? 1 : 0];
  const span = (o.end - o.start) / MONTH;
  const wear = p ? p.reservesPerFH * d.fhPerMonth * span : 0;
  rep.estBH = Math.round(ferryBH * 10) / 10;
  rep.estRevenue = p ? Math.round((p.rentPerMonth + p.reservesPerFH * d.fhPerMonth) * span) : 0;
  rep.estCost = Math.round(ferryCost + consentFor(ac) + wear);
  rep.estMargin = rep.estRevenue - rep.estCost;
  return rep;
}

// ---------- signing and the lease's life ----------

/** Signs a dry lease on the aircraft (accept.ts calls this): deposit in, consent fee out, both ferries planned. */
export function signDryLease(g: GameState, c: Contract, o: ContractOffer): ActionResult {
  const ac = g.fleet[c.aircraftIds[0]];
  const d = o.dry!;
  const plan = ac ? dryPlan(g, o, ac) : null;
  if (!ac || !plan) return { ok: false, error: 'No ferry route' };
  const mk = (l: FerryLeg): Flight => {
    const f = addFlight(g, { no: ownFlightNo(g), aircraftId: ac.id, contractId: c.id, kind: 'ferry', from: l.from, to: l.to, std: l.std, sta: l.sta });
    f.purpose = 'lease';
    return f;
  };
  const out = plan.out.map(mk);
  const back = plan.back.map(mk);
  // The consent fee follows the airframe picked (the offer's figure was an estimate on the one it was made for).
  const consent = consentFor(ac);
  c.dry = { site: d.site, fhPerMonth: d.fhPerMonth, deposit: d.deposit, outIds: out.map((f) => f.id), backIds: back.map((f) => f.id), fh: 0, leaseEnd: c.end, consent, ...(d.paint ? { paint: d.paint } : {}) };
  c.generatedUntil = c.end;
  cashOnly(g, d.deposit);
  if (consent) post(g, 'rent', -consent);
  const arr = out.length ? out[out.length - 1].sta : c.start - DAY;
  schedule(g, Math.max(g.now + 1, arr + 5), 'lease.out', c.id);
  statsV08(g).dryLeases++;
  autoRoster(g, { aircraftIds: [ac.id] });
  return { ok: true };
}

/** 'lease.out': the delivery ferry has landed at the lessee's base (else look again in an hour): the lease starts. */
export function onLeaseOut(g: GameState, ev: SimEvent): void {
  const c = g.contracts[ev.id];
  if (!isDry(c) || !live(c) || c.dry.leasedAt !== undefined) return;
  const ac = g.fleet[c.aircraftIds[0]];
  if (!ac) return;
  const pending = c.dry.outIds.map((id) => g.flights[id]).filter((f) => f && f.status !== 'done' && f.status !== 'cancelled');
  if (pending.length || ac.flightId) {
    schedule(g, g.now + 60, 'lease.out', c.id);
    return;
  }
  const d = c.dry;
  d.leasedAt = g.now;
  d.rentMonth = monthKey(g.now);
  ac.status = 'leasedOut';
  ac.at = d.site;
  if (d.paint) ac.paintedFor = c.id;
  touchStatus(g, ac.id);
  if (c.status === 'signed') c.status = 'active';
  // First rent: the rest of this month, in advance.
  billRent(g, c, g.now, monthStart(monthKey(g.now) + 1));
  const lessee = g.clients[c.clientId]?.name ?? 'the lessee';
  const end = (d.leaseEnd ?? c.end) + (d.late ?? 0) * DAY;
  pushMessage(g, {
    tone: 'good', cat: 'commercial', title: `${ac.reg} delivered to ${lessee} in ${city(d.site)}`,
    body: `Our pilots fly home on an airline. Rent ${usd(c.product.kind === 'dry' ? c.product.rentPerMonth : 0)} a month from today; she comes back on ${fmtDay(end)}.`,
    ref: { kind: 'contract', id: c.id },
  });
  schedule(g, end, 'lease.back', c.id);
}

/** Rent for [from, to) of the lease (pro-rata to whole days), invoiced in advance to leaseIncome. */
function billRent(g: GameState, c: Contract, from: Minute, to: Minute, mult = 1, what = 'Rent'): void {
  if (c.product.kind !== 'dry' || to <= from) return;
  const amount = Math.round((c.product.rentPerMonth * mult * (to - from)) / MONTH);
  if (amount <= 0) return;
  invoice(g, { clientId: c.clientId, contractId: c.id, desc: `${what}: ${c.title} (${fmtDay(from)} – ${fmtDay(to - 1)})`, amount, cat: 'leaseIncome', dueDays: c.payment.dueDays });
  c.invoiced = (c.invoiced ?? 0) + amount;
}

/** Reserves on the hours flown since the last bill (in arrears). */
function billReserves(g: GameState, c: Contract): void {
  if (!c.dry || c.product.kind !== 'dry') return;
  const fh = c.dry.fh - (c.dry.fhBilled ?? 0);
  if (fh < 1) return;
  const amount = Math.round(fh * c.product.reservesPerFH);
  invoice(g, { clientId: c.clientId, contractId: c.id, desc: `Reserves ${Math.round(fh)} FH × $${c.product.reservesPerFH}: ${c.title}`, amount, cat: 'leaseIncome', dueDays: c.payment.dueDays });
  c.invoiced = (c.invoiced ?? 0) + amount;
  c.dry.fhBilled = (c.dry.fhBilled ?? 0) + fh;
}

/**
 * Daily: the lessee's hours accrue on our airframe (± 15 % by month; their A-checks reset the counter at no cost
 * to us; our reserves to our own lessor keep running on a leased-in airframe); on a new month the reserves of the
 * last one and this month's rent are invoiced.
 */
export function dailyDryLeases(g: GameState): void {
  for (const c of Object.values(g.contracts)) {
    if (!isDry(c) || !live(c) || c.dry.leasedAt === undefined || c.dry.returnedAt !== undefined) continue;
    const ac = g.fleet[c.aircraftIds[0]];
    if (!ac) continue;
    const d = c.dry;
    const k = monthKey(g.now);
    const r = side(g, `fh:${c.id}:${k}`);
    const fh = (d.fhPerMonth / 30.44) * (0.85 + 0.3 * next(r));
    const wide = typeOf(ac.typeId).body === 'wide';
    d.fh += fh;
    ac.hours += fh;
    ac.cycles += Math.round((fh / D().hPerCycle[wide ? 'wide' : 'narrow']) * 100) / 100;
    ac.maint.fhSinceA += fh;
    ac.maint.fhSinceC += fh;
    if (ac.maint.fhSinceA >= typeOf(ac.typeId).aCheckFH * 0.95) {
      ac.maint.fhSinceA = 0;
      ac.maint.lastA = g.now;
    }
    if (ac.ownership.kind === 'dryLeaseIn' && ac.ownership.reservesPerFH) post(g, 'reserves', -Math.round(fh * ac.ownership.reservesPerFH));
    if (d.rentMonth !== k) {
      d.rentMonth = k;
      statsV08(g).dryMonths++;
      billReserves(g, c);
      // Up to the agreed end only: late days are billed as holdover (onLeaseBack).
      billRent(g, c, monthStart(k), Math.min(d.leaseEnd ?? c.end, monthStart(k + 1)));
    }
  }
}

/**
 * 'lease.back': the lease ends. 15 % of lessees are late (3–20 days: holdover rent at 150 %, the ferry home moves,
 * a card when our own flights need her). Otherwise reserves are billed, the aircraft is ours again at the site and
 * the return ferry (planned at signing) brings her home for the inspection.
 */
export function onLeaseBack(g: GameState, ev: SimEvent): void {
  const c = g.contracts[ev.id];
  if (!isDry(c) || !live(c) || c.dry.returnedAt !== undefined || c.dry.leasedAt === undefined) return;
  const ac = g.fleet[c.aircraftIds[0]];
  if (!ac) return;
  const d = c.dry;
  const end = (d.leaseEnd ?? c.end) + (d.late ?? 0) * DAY;
  if (g.now < end) return;
  if (d.late === undefined) {
    const r = side(g, `late:${c.id}`);
    d.late = chance(r, D().late) ? int(r, D().lateDays[0], D().lateDays[1]) : 0;
    if (d.late) {
      const back = end + d.late * DAY;
      for (const id of d.backIds) {
        const f = g.flights[id];
        if (f && f.status === 'scheduled') retimeFlight(g, f, f.std + d.late * DAY, f.sta + d.late * DAY);
      }
      billRent(g, c, end, back, D().holdover, 'Holdover rent 150 %');
      const lessee = g.clients[c.clientId]?.name ?? 'The lessee';
      const clash = Object.values(g.flights).some((f) => f.aircraftId === ac.id && f.contractId !== c.id && f.status === 'scheduled' && f.std < back + 2 * DAY);
      pushMessage(g, {
        tone: 'warn', cat: 'commercial', title: `${lessee} returns ${ac.reg} ${d.late} days late`,
        body: `Their replacement ${typeOf(ac.typeId).short} is late. They pay 150 % rent for each extra day; the ferry home moves to ${fmtDay(back + DAY)}.`,
        ref: { kind: 'contract', id: c.id }, problem: { kind: 'leaseLate', ref: { kind: 'contract', id: c.id } },
      });
      if (clash) requestPause('decision');
      schedule(g, back, 'lease.back', c.id);
      return;
    }
  }
  billReserves(g, c);
  d.returnedAt = g.now;
  ac.status = 'available';
  ac.at = d.site;
  touchStatus(g, ac.id);
}

/**
 * The return ferry has landed home (ops flight.arr hook): a return inspection (2 days, plus a damage repair in 8 %
 * of returns: the lessee pays 70 %), the deposit back less their share, our colours back, the contract completed.
 */
export function onLeaseFerryHome(g: GameState, f: Flight): void {
  const c = f.contractId ? g.contracts[f.contractId] : undefined;
  if (!isDry(c) || !live(c) || f.purpose !== 'lease' || !c.dry.backIds.includes(f.id)) return;
  if (c.dry.backIds.some((id) => g.flights[id] && g.flights[id].status !== 'done' && g.flights[id].status !== 'cancelled')) return;
  const ac = g.fleet[c.aircraftIds[0]];
  if (!ac) return;
  const d = c.dry;
  const r = side(g, `dmg:${c.id}`);
  const dmg = chance(r, D().damage);
  const what = dmg ? ['Hard landing', 'Tail scrape', 'Ground damage'][int(r, 0, 2)] : '';
  const days = D().inspectionDays + (dmg ? int(r, D().damageDays[0], D().damageDays[1]) : 0);
  const cost = dmg ? Math.round(range(r, D().damageCost[0], D().damageCost[1]) / 1000) * 1000 : 0;
  const id = nextId(g, 'mx');
  g.maintenance[id] = {
    id, aircraftId: ac.id, kind: 'line', at: g.company.homeBase, start: g.now, end: g.now + days * DAY, cost, status: 'planned', planned: true,
    cause: dmg ? `Return inspection: ${what.toLowerCase()} repair` : 'Return inspection after the dry lease', ev: 0,
  };
  schedule(g, g.now, 'maint.start', id, 0);
  schedule(g, g.now + days * DAY, 'maint.end', id, 0);
  const share = Math.round(cost * D().lesseeShare);
  const kept = Math.min(d.deposit, share);
  cashOnly(g, -(d.deposit - kept));
  if (kept) accrue(g, 'otherRevenue', kept);
  if (share > kept) invoice(g, { clientId: c.clientId, contractId: c.id, desc: `Damage repair ${Math.round(D().lesseeShare * 100)} %: ${c.title}`, amount: share - kept, cat: 'otherRevenue', dueDays: 45 });
  const lessee = g.clients[c.clientId]?.name ?? 'the lessee';
  if (dmg) {
    d.damage = { cost, days, maintId: id, what };
    pushMessage(g, {
      tone: 'warn', cat: 'tech', title: `Return inspection: ${ac.reg} has a ${what.toLowerCase()} finding`,
      body: `${days} days in the hangar, ${usd(cost)}; ${lessee} pays ${Math.round(D().lesseeShare * 100)} % under the lease.`,
      ref: { kind: 'contract', id: c.id }, problem: { kind: 'leaseDamage', ref: { kind: 'contract', id: c.id } },
    });
  }
  if (ac.paintedFor === c.id) delete ac.paintedFor;
  completeDry(g, c);
}

/** Completes a dry lease: relation (on time +6, late returns their fault: no effect), job counted, message. */
function completeDry(g: GameState, c: Contract): void {
  if (c.dry?.recalled !== undefined) {
    c.status = 'cancelled';
    const ac = g.fleet[c.aircraftIds[0]];
    pushMessage(g, { tone: 'info', cat: 'commercial', title: `${ac?.reg ?? 'The aircraft'} is home from ${g.clients[c.clientId]?.name ?? 'the lessee'}`, body: `The recalled lease is closed; the deposit is back with them. ${Math.round(c.dry.fh).toLocaleString('en-US')} FH flown by them on our airframe.`, ref: { kind: 'contract', id: c.id } });
    return;
  }
  c.status = 'completed';
  g.stats.contractsDone++;
  noteJobDone(g, c.clientId);
  bumpClient(g, c.clientId, BAL.v08.rel.done, `Leased them ${c.title.replace(/^Dry lease: /, 'a ')}`);
  const fh = Math.round(c.dry?.fh ?? 0);
  pushMessage(g, { tone: 'good', cat: 'commercial', title: `Completed: ${c.title}`, body: `${fh.toLocaleString('en-US')} FH flown by ${g.clients[c.clientId]?.name ?? 'the lessee'} on our airframe; the deposit is back.`, ref: { kind: 'contract', id: c.id } });
}

/** Early-recall terms of a delivered dry lease: back in 2 days, one month's rent to the lessee, the unused prepaid rent refunded. Pure. */
export function recallTerms(g: GameState, c: Contract): { at: Minute; penalty: number; refund: number } | null {
  if (!isDry(c) || !live(c) || c.dry.leasedAt === undefined || c.dry.returnedAt !== undefined || c.product.kind !== 'dry') return null;
  const at = Math.ceil((g.now + 2 * DAY) / 60) * 60;
  const end = c.dry.leaseEnd ?? c.end;
  if (at >= end) return null;
  // Rent is billed a month ahead to the month end (or the agreed end).
  const billedTo = Math.min(end, monthStart(monthKey(g.now) + 1));
  const refund = Math.max(0, Math.round((c.product.rentPerMonth * (billedTo - at)) / MONTH));
  return { at, penalty: Math.round(c.product.rentPerMonth), refund };
}

/**
 * Recalls a delivered dry lease (accept.ts cancelContract after delivery): the lessee hands her back in 2 days, the
 * return ferries move up and bring her home (the deposit comes back as usual); one month's rent compensates them.
 */
export function recallDry(g: GameState, c: Contract): ActionResult<{ penalty: number; refund: number }> {
  const t = recallTerms(g, c);
  if (!t || !isDry(c)) return { ok: false, error: c.dry?.returnedAt !== undefined ? 'She is already on her way home' : 'The lease ends within two days anyway' };
  const d = c.dry;
  const plan = ferryLegs(g.fleet[c.aircraftIds[0]]?.typeId ?? 'a320ceo', d.site, g.company.homeBase, { leave: t.at + DAY + 8 * 60 }, etopsCap(g.company.approvals, g.fleet[c.aircraftIds[0]]?.typeId ?? 'a320ceo'));
  const back = d.backIds.map((id) => g.flights[id]).filter((f): f is Flight => !!f && f.status === 'scheduled').sort((a, b) => a.std - b.std);
  if (plan && back.length === plan.length) back.forEach((f, i) => retimeFlight(g, f, plan[i].std, plan[i].sta));
  else if (back.length) {
    const dt = t.at + DAY + 8 * 60 - back[0].std;
    for (const f of back) retimeFlight(g, f, f.std + dt, f.sta + dt);
  }
  d.recalled = g.now;
  d.leaseEnd = t.at;
  d.late = 0;
  c.cancelledAt = g.now;
  if (t.refund) post(g, 'leaseIncome', -t.refund);
  if (t.penalty) post(g, 'penalties', -t.penalty);
  schedule(g, t.at, 'lease.back', c.id);
  // Pilots for the moved ferries.
  autoRoster(g, { aircraftIds: c.aircraftIds });
  return { ok: true, data: { penalty: t.penalty, refund: t.refund } };
}

/** Cancels a dry lease before delivery (accept.ts cancelContract): the ferries go, the deposit is refunded. */
export function cancelDry(g: GameState, c: Contract): void {
  if (!c.dry) return;
  removeFlights(g, [...c.dry.outIds, ...c.dry.backIds].filter((id) => g.flights[id]?.status === 'scheduled'));
  if (c.dry.leasedAt === undefined) cashOnly(g, -c.dry.deposit);
}

/** The anchor a dry lease puts on its aircraft between the ferries (plan.ts anchorsOf). Pure. */
export function dryAnchor(g: GameState, aircraftId: string): { from: string; to: string; std: Minute; sta: Minute; contractId: string } | null {
  for (const c of Object.values(g.contracts)) {
    if (!isDry(c) || !live(c) || !c.aircraftIds.includes(aircraftId) || c.dry.returnedAt !== undefined) continue;
    const out = spanOf(g, c.dry.outIds, [c.start - DAY, c.start - DAY]);
    const back = spanOf(g, c.dry.backIds, [c.end + DAY, c.end + DAY]);
    const std = Math.max(g.now, out[1]);
    if (back[0] <= std) continue;
    return { from: c.dry.site, to: c.dry.site, std, sta: back[0], contractId: c.id };
  }
  return null;
}
