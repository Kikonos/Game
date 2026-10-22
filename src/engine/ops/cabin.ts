// v0.7 cabin reconfiguration (UPDATE-0.7.md §F7): all-economy, two-class, three-class or VIP. A refit is booked
// like a check at a real MRO station that takes the body (a ferry when the aircraft is elsewhere), paid when the
// work starts; at the end the cabin changes and future duties are re-rostered for the new complement.

import type { CabinLayout, CabinPreset } from '../../data/acmiTypes';
import { AIRPORT_BY_CODE } from '../../data/airports';
import { cabinPresets } from '../../data/cabins';
import { MRO_STATIONS } from '../../data/market';
import { BAL } from '../core/balance';
import { flightsOf } from '../core/entities';
import { pushMessage } from '../core/messages';
import { cabinMinimum, typeOf } from '../core/perf';
import { DAY, fmtDate, fmtDay } from '../core/time';
import type { AcRest, ActionResult, Aircraft, Cabin, Flight, GameState, MaintenanceEvent, Minute, Requirements, RestRefitId } from '../core/types';
import { C_HUBS } from '../../data/mro';
import { schedule } from '../core/queue';
import { cabinInflightRest } from '../crew/rules';
import { jSeatsFor, longestDay, migrateRest, restText } from '../crew/restPlan';
import { retimeFlight } from '../core/entities';
import { route, routeMinutes, timeChain } from '../contracts/plan';
import { rerosterFrom } from '../crew';
import type { DeliveryLeg } from './delivery';
import { scheduleCheck } from './maintenance';
import { usd } from './util';

export interface RefitQuote {
  ok: boolean; why: string | null; cabin: Cabin; days: number; cost: number; start: Minute; end: Minute;
  station: string; ferryIn: DeliveryLeg[]; seatsFrom: number; seatsTo: number; cabinMinFrom: number; cabinMinTo: number;
  opens: string[]; closes: string[]; reinstateAtReturn: number | null; clashes: string[];
  /** Signed work still flying after the refit that the new cabin can't carry ("Troop rotation … needs 174+ seats (refit gives 168)"). */
  breaks: string[];
}

/** v0.7.2 a refit window at home base (earliest first). */
export interface RefitSlot { start: Minute; end: Minute; ok: boolean; why: string | null }

/** v0.7.2 the label refitSlots takes for fitting or removing crew rest seats; v0.7.3 also 'rest:<RestRefitId>'. */
export const REST_SEATS = 'restSeats';

const LAYOUT_NAME: Record<CabinLayout, string> = { 'all-economy': 'all-economy', 'two-class': 'two-class', 'three-class': 'three-class', vip: 'VIP' };
export const layoutName = (l: CabinLayout) => LAYOUT_NAME[l];

/** The type's cabin presets (all-economy, two-class, three-class where listed) plus a VIP preset. Pure. */
export function cabinOptions(typeId: string): CabinPreset[] {
  return cabinPresets(typeId);
}

export const cabinOf = (p: CabinPreset): Cabin => ({ j: p.j, w: p.w, y: p.y, total: p.j + p.w + p.y, label: p.label, layout: p.layout });

/** Days and cost of a refit to a layout (narrowbody / widebody table). */
export function refitTerms(typeId: string, layout: CabinLayout): { days: number; cost: number } | null {
  const t = BAL.refit[typeOf(typeId).body === 'wide' ? 'wb' : 'nb'][layout];
  return t ? { days: t[0], cost: t[1] } : null;
}

/** Where the aircraft is at t (its last arrival before t), else where it is now. */
function whereAt(g: GameState, ac: Aircraft, t: Minute): { at: string; free: Minute } {
  let at = ac.at;
  let free = g.now;
  if (ac.flightId) {
    const f = g.flights[ac.flightId];
    if (f) {
      at = f.to;
      free = f.eta ?? f.sta;
    }
  }
  for (const f of flightsOf(g, ac.id)) {
    if (f.status !== 'scheduled' || f.sta > t || f.sta < free) continue;
    at = f.to;
    free = f.sta;
  }
  return { at, free };
}

const stationsFor = (ac: Aircraft) => MRO_STATIONS.filter((s) => AIRPORT_BY_CODE[s.code] && (s.wide || typeOf(ac.typeId).body !== 'wide'));

/** v0.7.2 cabin work happens in our own hangar at home base ("{Company} hangar, {city}"). */
const homeHangar = (g: GameState) => `${g.company.name} hangar, ${AIRPORT_BY_CODE[g.company.homeBase]?.city ?? g.company.homeBase}`;

/** v0.7.2 where a refit can be done: the home base only (the ferry block from where the aircraft is). Pure. */
export function refitStations(g: GameState, aircraftId: string): { code: string; name: string; ferryBlock: number }[] {
  const ac = g.fleet[aircraftId];
  if (!ac) return [];
  const home = g.company.homeBase;
  const r = route(ac.typeId, ac.at, home);
  return r ? [{ code: home, name: homeHangar(g), ferryBlock: r.reduce((n, l) => n + l.block, 0) }] : [];
}

/** Work a cabin can bid for (the §F7.3 rules), for "opens / closes". */
function workOf(typeId: string, c: Pick<Cabin, 'j' | 'w' | 'total' | 'layout'>): string[] {
  const wide = typeOf(typeId).body === 'wide';
  const out: string[] = [];
  if (c.layout === 'vip') out.push('VIP and state work');
  if (c.layout !== 'all-economy' && c.j + c.w >= (wide ? 20 : 12)) out.push('premium sports');
  if (c.total >= (wide ? 300 : 174)) out.push(`troop rotations (${wide ? 300 : 174}+)`);
  if (c.layout === 'all-economy' && c.total >= (wide ? 300 : 180)) out.push(`pilgrimage (${wide ? 300 : 180}+)`);
  return out;
}

/** What it costs to put the cabin back as delivered at the lease return (null: owned or unchanged). */
export function reinstateCost(ac: Aircraft, layout: CabinLayout = ac.cabin.layout): number | null {
  if (ac.ownership.kind !== 'dryLeaseIn') return null;
  const back = ac.ownership.deliveredLayout ?? ac.cabin.layout;
  if (back === layout) return null;
  return refitTerms(ac.typeId, back)?.cost ?? null;
}

/** A refit of `aircraftId` to the preset `label` at `station` from `start`: days, cost, ferry in, clashes, what it opens. Pure. */
export function refitQuote(g: GameState, aircraftId: string, label: string, station: string, start: Minute): RefitQuote {
  const ac = g.fleet[aircraftId];
  const empty: Cabin = ac?.cabin ?? { j: 0, w: 0, y: 0, total: 0, label, layout: 'all-economy' };
  const base: RefitQuote = {
    ok: false, why: null, cabin: empty, days: 0, cost: 0, start, end: start, station, ferryIn: [], seatsFrom: empty.total, seatsTo: empty.total,
    cabinMinFrom: cabinMinimum(empty.total), cabinMinTo: cabinMinimum(empty.total), opens: [], closes: [], reinstateAtReturn: null, clashes: [], breaks: [],
  };
  if (!ac) return { ...base, why: 'Aircraft not found' };
  const preset = cabinOptions(ac.typeId).find((p) => p.label === label);
  if (!preset) return { ...base, why: `No ${label} layout for the ${typeOf(ac.typeId).short}` };
  const cabin = cabinOf(preset);
  const terms = refitTerms(ac.typeId, preset.layout);
  if (!terms) return { ...base, why: `No ${layoutName(preset.layout)} refit for the ${typeOf(ac.typeId).short}` };
  const end = start + terms.days * DAY;
  const fromW = workOf(ac.typeId, ac.cabin);
  const toW = workOf(ac.typeId, cabin);
  const q: RefitQuote = {
    ...base, cabin, days: terms.days, cost: terms.cost, end, seatsTo: cabin.total, cabinMinTo: cabinMinimum(cabin.total),
    opens: toW.filter((x) => !fromW.includes(x)), closes: fromW.filter((x) => !toW.includes(x)), reinstateAtReturn: reinstateCost(ac, preset.layout),
  };
  const why = (w: string) => ({ ...q, why: w });
  if (ac.cabin.label === label) return why(`Already ${label}`);
  return refitWindow(g, ac, q, station);
}

/** Station, lead, ferry in, clashes and signed work that must still fit (refits and crew rest seats). Pure. */
function refitWindow(g: GameState, ac: Aircraft, q: RefitQuote, station: string): RefitQuote {
  const { start, end, cabin } = q;
  const why = (w: string) => ({ ...q, why: w });
  // v0.7.2 cabin work at home base only (an older booking elsewhere still completes as booked).
  if (station !== g.company.homeBase || !AIRPORT_BY_CODE[station]) return why('Cabin work is done in our own hangar at home base');
  if (ac.status === 'delivering' || ac.status === 'stored' || ac.status === 'leasedOut' || ac.returning || ac.sale) return why(`${ac.reg} is not on the AOC for a refit`);
  if (start < g.now + BAL.refit.leadDays * DAY - 60) return why(`Hangar slots from ${fmtDay(g.now + BAL.refit.leadDays * DAY)}`);
  if (Object.values(g.maintenance).some((m) => m.aircraftId === ac.id && m.kind === 'refit' && (m.status === 'planned' || m.status === 'inWork'))) return why(`${ac.reg} already has a refit booked`);
  // The ferry in (when it is elsewhere), timed to land a turn before the slot.
  const loc = whereAt(g, ac, start - 1);
  const r = route(ac.typeId, loc.at, station);
  if (!r) return why(`No ferry route to ${station}`);
  const turn = typeOf(ac.typeId).turnMin;
  const ferryStart = start - turn - routeMinutes(r);
  q.ferryIn = r.length ? timeChain(r, ferryStart).map((l) => ({ ...l, block: l.sta - l.std, nightStopAfter: false })) : [];
  const busyFrom = r.length ? ferryStart - turn : start;
  for (const f of flightsOf(g, ac.id)) {
    if ((f.status === 'scheduled' || f.status === 'enroute') && f.kind !== 'positioning' && f.std < end + 30 && (f.eta ?? f.sta) > busyFrom - 30) q.clashes.push(`${f.no} ${f.from}–${f.to} ${fmtDay(f.std)}`);
  }
  for (const m of Object.values(g.maintenance)) {
    if (m.aircraftId === ac.id && (m.status === 'planned' || m.status === 'inWork') && m.start < end && m.end > busyFrom) q.clashes.push(`${m.kind === 'A' || m.kind === 'C' ? `${m.kind}-check` : m.kind} ${fmtDay(m.start)}`);
  }
  for (const c of Object.values(g.contracts)) {
    if ((c.status === 'signed' || c.status === 'active') && c.aircraftIds.includes(ac.id) && c.pattern.kind === 'base' && c.generatedUntil < c.pattern.to && c.pattern.to > busyFrom && Math.max(c.generatedUntil, c.pattern.from) < end) q.clashes.push(c.title);
  }
  // Signed work still flying after the refit must fit the new cabin (seats, layout, premium seats).
  for (const c of Object.values(g.contracts)) {
    if ((c.status !== 'signed' && c.status !== 'active') || !c.aircraftIds.includes(ac.id)) continue;
    const later = (c.pattern.kind === 'base' && c.pattern.to > end) || flightsOf(g, ac.id).some((f) => f.contractId === c.id && f.status === 'scheduled' && f.std >= end);
    if (!later) continue;
    const b = cabinBreak(cabin, c.requirements);
    if (b) q.breaks.push(`${c.title} ${b}`);
  }
  if (r.length && loc.free + turn > ferryStart) return why(`${ac.reg} can't reach ${station} by then`);
  if (q.breaks.length) return why(q.breaks.length > 1 ? `${q.breaks[0]}; ${q.breaks.length - 1} more signed contract${q.breaks.length > 2 ? 's' : ''} won't fit` : q.breaks[0]);
  if (q.clashes.length) return why(`Clashes with ${q.clashes.length > 1 ? `${q.clashes.length} commitments` : q.clashes[0]}${q.clashes.length > 1 ? ` from ${q.clashes[0]}` : ''}: move them first`);
  return { ...q, ok: true };
}

/** Station name for messages: our hangar at home base, else the MRO (older bookings). */
const stationName = (g: GameState, code: string) => {
  if (code === g.company.homeBase) return homeHangar(g);
  const st = MRO_STATIONS.find((s) => s.code === code);
  return st ? `${st.name}, ${st.city}` : (AIRPORT_BY_CODE[code]?.city ?? code);
};

/**
 * v0.7.2 the earliest refit windows at home base (n ≤ 6, earliest first) over the next 26 weeks: right away when the
 * aircraft is free, else after each commitment ends. `label` is a cabin preset, or REST_SEATS for crew rest seats
 * (fit when none are fitted, else remove). busyWhy names the commitment that pushes the first slot past today. Pure.
 */
export function refitSlots(g: GameState, aircraftId: string, label: string, n = 6, after = 0): { slots: RefitSlot[]; busyUntil: Minute | null; busyWhy: string | null } {
  const ac = g.fleet[aircraftId];
  const none = { slots: [], busyUntil: null, busyWhy: null };
  if (!ac) return none;
  const home = g.company.homeBase;
  // v0.7.3 'rest:<option>' a crew rest refit; REST_SEATS (v0.7.2) the recliners, fitted or removed.
  const hasRecliners = ac.rest?.fc?.kind === 'recliners' || ac.rest?.cc?.kind === 'recliners';
  const quote = (t: Minute) =>
    label.startsWith('rest:') ? restRefitQuote(g, aircraftId, label.slice(5) as RestRefitId, t) : label === REST_SEATS ? restSeatsQuote(g, aircraftId, !hasRecliners, t) : refitQuote(g, aircraftId, label, home, t);
  const turn = typeOf(ac.typeId).turnMin;
  const up = (t: Minute) => Math.ceil(t / 30) * 30;
  // v0.7.2.2 `after`: the earliest window from an idle gap's start (Schedule gap panel).
  const first = up(Math.max(g.now + 60, after));
  const horizon = Math.max(g.now, after) + 26 * 7 * DAY;
  // Candidates: now, after every leg or check ends (plus a ferry home), and each day at the same hour.
  const cand = new Set<Minute>([first]);
  for (const f of flightsOf(g, ac.id)) {
    if ((f.status !== 'scheduled' && f.status !== 'enroute') || f.sta > horizon) continue;
    const r = route(ac.typeId, f.to, home);
    cand.add(up((f.eta ?? f.sta) + turn + (r && r.length ? routeMinutes(r) + turn : 0)));
  }
  for (const m of Object.values(g.maintenance)) {
    if (m.aircraftId === ac.id && (m.status === 'planned' || m.status === 'inWork') && m.end < horizon) {
      const r = route(ac.typeId, m.at, home);
      cand.add(up(m.end + (r && r.length ? routeMinutes(r) + 2 * turn : 0)));
    }
  }
  for (let t = first + DAY; t < horizon; t += DAY) cand.add(t);
  const slots: RefitSlot[] = [];
  let firstWhy: string | null = null;
  // With no slot at all, the real blocker: signed work the new cabin can't serve, else a clash, else the first refusal
  // (an aircraft away from base is refused 'can't reach' early on, which hides the later reasons).
  let breakWhy: string | null = null;
  let clashWhy: string | null = null;
  for (const t of [...cand].filter((x) => x >= first && x < horizon).sort((a, b) => a - b)) {
    if (slots.length && t < slots[slots.length - 1].start + DAY / 2) continue;
    const q = quote(t);
    if (!q.days) return { ...none, busyWhy: q.why };
    if (q.ok) slots.push({ start: q.start, end: q.end, ok: true, why: null });
    else {
      if (t === first) firstWhy = q.why;
      if (q.breaks.length) breakWhy = `The new cabin won't serve signed work: ${q.breaks[0]}${q.breaks.length > 1 ? ` (and ${q.breaks.length - 1} more)` : ''}`;
      else if (q.clashes.length) clashWhy = `Clashes with ${q.clashes[q.clashes.length - 1]}: move it first`;
    }
    if (slots.length >= n) break;
  }
  if (!slots.length) return { slots, busyUntil: null, busyWhy: breakWhy ?? clashWhy ?? firstWhy };
  const busyUntil = slots[0].start > first + 12 * 60 ? slots[0].start : null;
  return { slots, busyUntil, busyWhy: busyUntil ? busyText(g, ac, slots[0].start) ?? firstWhy : null };
}

/** "Busy until 14 Nov: flies the TUI summer programme" (the last commitment before t). */
function busyText(g: GameState, ac: Aircraft, t: Minute): string | null {
  let last: { end: Minute; what: string } | null = null;
  for (const f of flightsOf(g, ac.id)) {
    if ((f.status !== 'scheduled' && f.status !== 'enroute') || f.kind === 'positioning' || f.std >= t) continue;
    const c = f.contractId ? g.contracts[f.contractId] : undefined;
    const end = f.eta ?? f.sta;
    if (!last || end > last.end) last = { end, what: c ? `flies ${c.title}` : `flies ${f.no} ${f.from}–${f.to}` };
  }
  for (const m of Object.values(g.maintenance)) {
    if (m.aircraftId !== ac.id || (m.status !== 'planned' && m.status !== 'inWork') || m.start >= t) continue;
    if (!last || m.end > last.end) last = { end: m.end, what: m.kind === 'A' || m.kind === 'C' ? `in its ${m.kind}-check` : m.kind === 'refit' ? 'in a refit' : `in the hangar (${m.kind})` };
  }
  return last ? `Busy until ${fmtDay(last.end)}: ${last.what}` : null;
}

/**
 * v0.7.2 fitting (or removing) crew rest seats. v0.7.3: a plain economy row is no rest facility; this wraps the crew
 * rest recliner refit ('recliners' / 'removeRecliners') until every caller uses restRefitQuote. Pure.
 */
export function restSeatsQuote(g: GameState, aircraftId: string, fit: boolean, start: Minute): RefitQuote {
  return restRefitQuote(g, aircraftId, fit ? 'recliners' : 'removeRecliners', start);
}

/** v0.7.2 books crew rest seats (fit or remove). v0.7.3: the recliner refit (bookRestRefit). */
export function bookRestSeats(g: GameState, aircraftId: string, fit: boolean, start: Minute): ActionResult<{ maintId: string }> {
  return bookRestRefit(g, aircraftId, fit ? 'recliners' : 'removeRecliners', start);
}

/** Books a refit: a 'refit' check at the station (ferry booked when elsewhere); paid at the start of the work. */
export function bookRefit(g: GameState, aircraftId: string, label: string, station: string, start: Minute): ActionResult<{ maintId: string }> {
  const q = refitQuote(g, aircraftId, label, station, start);
  if (!q.ok) return { ok: false, error: q.why ?? 'Cannot book this refit' };
  const ac = g.fleet[aircraftId];
  const r = scheduleCheck(g, aircraftId, 'refit', start, station, { refit: { cabin: q.cabin, days: q.days, cost: q.cost } });
  if (!r.ok) return r;
  pushMessage(g, {
    tone: 'info', cat: 'tech', title: `Refit booked: ${ac.reg} to ${q.cabin.label}`,
    body: `${stationName(g, station)}: ${fmtDay(start)}–${fmtDay(q.end)} (${q.days} days, ${usd(q.cost)}, paid when the work starts).${q.ferryIn.length ? ` Ferry in ${q.ferryIn[0].from}–${station} ${fmtDay(q.ferryIn[0].std)}.` : ''}${q.reinstateAtReturn ? ` The lessor wants it back as delivered: about ${usd(q.reinstateAtReturn)} at the lease return.` : ''}`,
    ref: { kind: 'maint', id: r.data!.maintId },
  });
  return { ok: true, msg: `Refit to ${q.cabin.label} at ${AIRPORT_BY_CODE[station]?.city ?? station} ${fmtDay(start)}–${fmtDay(q.end)}`, data: r.data };
}

/** 'maint.end' of a refit: the new cabin, re-rostered duties for the new complement, one message. */
export function onRefitEnd(g: GameState, m: MaintenanceEvent): void {
  if (m.kind !== 'refit' || !m.refit) return;
  const ac = g.fleet[m.aircraftId];
  if (!ac) return;
  // v0.7.3 crew rest refits (onRestFitEnd).
  if (m.restFit) return onRestFitEnd(g, m);
  // v0.7.2 crew rest seats: the cabin stays; the rest class changes (duties re-measured).
  if (m.refit.restSeats !== undefined) {
    const rest = (ac.crewRest ??= { bunks: false, seats: 0 });
    rest.seats = m.refit.restSeats;
    // v0.7.3 a v0.7.2 booking still in an old save: its seats become grandfathered recliners.
    ac.rest = migrateRest({ ...ac, rest: undefined });
    rerosterFrom(g, ac.id, g.now);
    pushMessage(g, {
      tone: 'good', cat: 'tech', title: `${ac.reg}: crew rest seats ${rest.seats ? 'fitted' : 'removed'}`,
      body: rest.seats
        ? `The last economy row (${rest.seats} seats) now has a curtain for resting crew (class 3 rest): long duties can carry an augmented crew. The seats still sell on flights that need no in-flight rest.`
        : `The last economy row is back in full sale. No crew rest on board: no augmented duties.`,
      ref: { kind: 'aircraft', id: ac.id },
    });
    return;
  }
  const was = ac.cabin;
  ac.cabin = { ...m.refit.cabin };
  g.stats.refits = (g.stats.refits ?? 0) + 1;
  rerosterFrom(g, ac.id, g.now);
  const fromW = workOf(ac.typeId, was);
  const toW = workOf(ac.typeId, ac.cabin);
  const opens = toW.filter((x) => !fromW.includes(x));
  const closes = fromW.filter((x) => !toW.includes(x));
  const minFrom = cabinMinimum(was.total);
  const minTo = cabinMinimum(ac.cabin.total);
  pushMessage(g, {
    tone: 'good', cat: 'tech', title: `${ac.reg} refitted: ${ac.cabin.label}${ac.cabin.layout === 'vip' ? ' VIP' : ''}`,
    body: `Out of the hangar (${stationName(g, m.at)}) after ${Math.round((m.end - m.start) / DAY)} days (${usd(m.cost)}). Cabin crew minimum ${minTo}${minTo !== minFrom ? ` (was ${minFrom})` : ''}.${opens.length ? ` It can now bid for ${opens.join(' and ')}.` : ''}${closes.length ? ` No longer: ${closes.join(', ')}.` : ''}`,
    ref: { kind: 'aircraft', id: ac.id },
  });
}

// ---------- the layout rules for offers and feasibility (§F7.3) ----------

/** Layouts the work accepts (layouts, else layout, else any). */
export const layoutsOf = (req: Pick<Requirements, 'layout' | 'layouts'>): CabinLayout[] | null => req.layouts ?? (req.layout ? [req.layout] : null);

/** Does a cabin meet the work's layout and premium-seat rules? */
export function cabinFits(c: Pick<Cabin, 'j' | 'w' | 'layout'>, req: Pick<Requirements, 'layout' | 'layouts' | 'minPremium'>): boolean {
  const ls = layoutsOf(req);
  return (!ls || ls.includes(c.layout)) && (!req.minPremium || c.j + c.w >= req.minPremium);
}

/** Why a cabin can't carry the work ("needs 174+ seats (refit gives 168)"), else null. Pure. */
export function cabinBreak(c: Cabin, req: Pick<Requirements, 'minSeats' | 'maxSeats' | 'layout' | 'layouts' | 'minPremium'>): string | null {
  if (c.total < req.minSeats) return `needs ${req.minSeats}+ seats (refit gives ${c.total})`;
  if (req.maxSeats && c.total > req.maxSeats) return `wants at most ${req.maxSeats} seats (refit gives ${c.total})`;
  const ls = layoutsOf(req);
  if (ls && !ls.includes(c.layout)) return `needs a ${ls.map(layoutName).join(' or ')} cabin (refit gives ${c.label})`;
  if (req.minPremium && c.j + c.w < req.minPremium) return `needs ${req.minPremium}+ premium seats (refit gives ${c.j + c.w})`;
  return null;
}

/** The cabin flying at `t`: today's, or the one a planned or running refit fits before then (with its end). Pure. */
export function cabinAt(g: GameState, ac: Aircraft, t: Minute): { cabin: Cabin; refitEnd: Minute | null } {
  let best: MaintenanceEvent | null = null;
  for (const m of Object.values(g.maintenance)) {
    if (m.aircraftId !== ac.id || m.kind !== 'refit' || !m.refit || (m.status !== 'planned' && m.status !== 'inWork') || m.end > t) continue;
    if (!best || m.end > best.end) best = m;
  }
  return best ? { cabin: best.refit!.cabin, refitEnd: best.end } : { cabin: ac.cabin, refitEnd: null };
}

/** The cheapest refit that meets the work's cabin rules, at the nearest shop to home: "Refit to 24J/90Y at Lisbon: 21 days, $1.2M". Pure. */
export function refitTip(g: GameState, ac: Aircraft, req: Pick<Requirements, 'layout' | 'layouts' | 'minPremium'>): { layout: CabinLayout; label: string; text: string } | null {
  let best: { p: CabinPreset; days: number; cost: number } | null = null;
  for (const p of cabinOptions(ac.typeId)) {
    if (p.label === ac.cabin.label || !cabinFits(p, req)) continue;
    const t = refitTerms(ac.typeId, p.layout);
    if (t && (!best || t.cost < best.cost)) best = { p, ...t };
  }
  if (!best) return null;
  const home = g.company.homeBase;
  const st = stationsFor(ac).map((s) => ({ s, b: route(ac.typeId, home, s.code) })).filter((x) => x.b).sort((a, b) => routeMinutes(a.b!) - routeMinutes(b.b!))[0]?.s;
  return { layout: best.p.layout, label: best.p.label, text: `Refit to ${best.p.label}${st ? ` at ${st.city}` : ''}: ${best.days} days, ${usd(best.cost)}` };
}

/** "after the refit 1 Jun". */
export const afterRefit = (end: Minute) => `after the refit ${fmtDate(end).replace(/ \d{4}$/, '')}`;

// ---------- v0.7.3 crew rest refits (UPDATE-0.7.3.md §2.10) ----------

export interface RestRefitOption {
  id: RestRefitId;
  label: string;
  side: 'fc' | 'cc' | 'both';
  cls: 1 | 2 | 3;
  /** Home base (refitSlots) or added to a C-check at an MRO hub. */
  where: 'home' | 'cCheck';
  /** Est.; cCheck: extra days on the check. */
  days: number;
  cost: number;
  /** Cabin seat change (−8). */
  seats: number;
  /** 'Opens: 16 h days with 3 pilots (was 15 h)'. */
  opens: string;
  ok: boolean;
  why: string | null;
}

const REFIT_LABEL: Record<RestRefitId, string> = {
  curtainJ: 'Curtain off business seats', recliners: 'Crew rest recliners', removeRecliners: 'Remove the crew rest recliners',
  ldmcr: 'Lower-deck crew rest module', fcrc: 'Flight crew rest compartment', overhead: 'Overhead crew rest',
};
const hmm = (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
const hrs = (m: number) => (m % 60 ? hmm(m) : `${m / 60} h`);
const presetOf = (ac: Aircraft) => cabinOptions(ac.typeId).find((p) => p.label === ac.cabin.label);

/** v0.7.3 the facilities and cabin after a crew rest refit (UPDATE-0.7.3.md §2.10). Pure. */
export function restAfterRefit(ac: Aircraft, id: RestRefitId): { rest: AcRest; cabin: Cabin } {
  const t = typeOf(ac.typeId);
  const R = t.rest;
  const now = ac.rest ?? migrateRest(ac);
  const rest: AcRest = { fc: now.fc ? { ...now.fc } : null, cc: now.cc ? { ...now.cc } : null };
  let cabin: Cabin = { ...ac.cabin };
  switch (id) {
    case 'curtainJ':
      rest.fc ??= jSeatsFor(ac.typeId, cabin.j, 'fc');
      rest.cc ??= jSeatsFor(ac.typeId, cabin.j, 'cc');
      break;
    case 'recliners': {
      const r = R.recliners;
      if (!r) break;
      const lost = r.rowsLost * t.yAbreast - r.places;
      cabin = { ...cabin, y: cabin.y - lost, total: cabin.total - lost };
      const fcEmpty = !rest.fc;
      if (fcEmpty) rest.fc = { cls: 3, kind: 'recliners', places: r.fc };
      if (!rest.cc) rest.cc = { cls: 3, kind: 'recliners', places: fcEmpty ? r.places - r.fc : r.places };
      break;
    }
    case 'removeRecliners': {
      if (rest.fc?.kind === 'recliners') rest.fc = null;
      if (rest.cc?.kind === 'recliners') rest.cc = null;
      const p = presetOf(ac);
      if (p) cabin = { ...cabin, j: p.j, w: p.w, y: p.y, total: p.j + p.w + p.y };
      break;
    }
    case 'ldmcr':
      rest.cc = { cls: 1, kind: 'ldmcr', places: R.ccrcKind === 'ldmcr' && R.ccrcPlaces ? R.ccrcPlaces : 7 };
      break;
    case 'fcrc':
      rest.fc = { cls: 1, kind: 'fcrc', places: 2 };
      break;
    case 'overhead':
      if (rest.fc?.cls !== 1) rest.fc = { cls: 1, kind: 'fcrc', places: 2 };
      if (rest.cc?.cls !== 1) rest.cc = { cls: 1, kind: 'ccrc', places: R.ccrcPlaces || 8 };
      break;
  }
  return { rest, cabin };
}

/** 'Opens: 16 h days with 3 pilots (was 15 h)' and the like: what a facility change does to the longest day. */
export function opensText(g: GameState, typeId: string, before: AcRest, after: AcRest): string {
  const b = longestDay(g, before, typeId);
  const a = longestDay(g, after, typeId);
  const parts: string[] = [];
  const b1 = b.aug1 ?? b.basic;
  const a1 = a.aug1 ?? a.basic;
  if (a1 > b1) parts.push(`${hrs(a1)} days with 3 pilots (was ${hrs(b1)})`);
  else if ((a.aug2Long ?? 0) > (b.aug2Long ?? b.basic)) parts.push(`${hrs(a.aug2Long!)} days with 4 pilots (was ${hrs(b.aug2Long ?? b.basic)})`);
  if (after.cc && (!before.cc || after.cc.cls < before.cc.cls)) {
    // Quoted at the longest 3-pilot day the refit opens (15 h while the pilots still have no rest).
    const day = a.aug1 ?? 15 * 60;
    const was = before.cc ? cabinInflightRest(day, before.cc.cls) : null;
    const now = cabinInflightRest(day, after.cc.cls);
    const where = after.cc.kind === 'jSeats' ? 'business seats' : after.cc.kind === 'recliners' ? 'recliners' : 'bunks';
    if (now !== null) parts.push(`cabin crew rest in ${where} (${hmm(now)}${was !== null && was !== now ? ` instead of ${hmm(was)}` : ''} on a ${hrs(day)} day)${after.fc ? '' : ' (the pilots still need a rest facility)'}`);
  }
  if (!parts.length && after.fc && (!before.fc || after.fc.cls < before.fc.cls)) parts.push(`pilots' ${after.fc.kind === 'fcrc' ? 'bunks' : 'rest'}${after.cc ? '' : ' (the cabin crew still need a rest facility)'}`);
  const freed = [before.fc, before.cc].filter((f) => f?.kind === 'jSeats' && ![after.fc, after.cc].includes(f)).reduce((n, f) => n + (f?.places ?? 0), 0);
  const kept = [after.fc, after.cc].filter((f) => f?.kind === 'jSeats').reduce((n, f) => n + (f?.places ?? 0), 0);
  const was = [before.fc, before.cc].filter((f) => f?.kind === 'jSeats').reduce((n, f) => n + (f?.places ?? 0), 0);
  if (freed && was > kept) parts.push(`${was - kept} business seats back on sale`);
  return parts.length ? `Opens: ${parts.join('; ')}` : 'Opens: nothing new for the longest day';
}

/** v0.7.3 the crew rest refits an aircraft can have (UPDATE-0.7.3.md §2.10), each with what it opens. Pure. */
export function restRefitOptions(g: GameState, aircraftId: string): RestRefitOption[] {
  const ac = g.fleet[aircraftId];
  if (!ac) return [];
  const t = typeOf(ac.typeId);
  const R = t.rest;
  const B = BAL.v073.restRefit;
  const rest = ac.rest ?? migrateRest(ac);
  const wide = t.body === 'wide';
  const out: RestRefitOption[] = [];
  const hub = !!C_HUBS[t.family]?.length;
  const add = (id: RestRefitId, side: RestRefitOption['side'], cls: 1 | 2 | 3, where: 'home' | 'cCheck', days: number, cost: number, why: string | null) => {
    const after = restAfterRefit(ac, id);
    out.push({
      id, label: REFIT_LABEL[id], side, cls, where, days, cost, seats: after.cabin.total - ac.cabin.total,
      opens: id === 'removeRecliners' ? `Opens: ${ac.cabin.total < after.cabin.total ? `${after.cabin.total - ac.cabin.total} seats back in sale; ` : ''}no in-flight rest where the recliners were` : opensText(g, ac.typeId, rest, after.rest),
      ok: !why, why,
    });
  };
  const empty = !rest.fc || !rest.cc;
  const side = (): RestRefitOption['side'] => (!rest.fc && !rest.cc ? 'both' : !rest.fc ? 'fc' : 'cc');
  if (wide && empty) add('curtainJ', side(), t.rest.jClass, 'home', B.curtainJ.days, B.curtainJ.cost, ac.cabin.j >= 4 ? null : 'Needs 4 or more business seats (a two-class cabin)');
  if (R.recliners && empty) {
    const nb = !wide;
    const c = nb ? B.reclinersNarrow : B.reclinersWide;
    add('recliners', side(), 3, 'home', c.days, c.cost, ac.cabin.y >= R.recliners.rowsLost * t.yAbreast + 30 ? null : 'Not enough economy rows');
  }
  if (rest.fc?.kind === 'recliners' || rest.cc?.kind === 'recliners') add('removeRecliners', rest.fc?.kind === 'recliners' && rest.cc?.kind === 'recliners' ? 'both' : rest.fc?.kind === 'recliners' ? 'fc' : 'cc', 3, 'home', B.removeRecliners.days, B.removeRecliners.cost, null);
  if (R.ldmcr && rest.cc?.cls !== 1) add('ldmcr', 'cc', 1, 'home', B.ldmcr.days, B.ldmcr.cost, null);
  if (R.mro === 'fcrc' && rest.fc?.cls !== 1) add('fcrc', 'fc', 1, 'cCheck', B.fcrc.addDays, B.fcrc.cost, hub ? null : 'No C-check hub for this type');
  if (R.mro === 'overhead' && (rest.fc?.cls !== 1 || rest.cc?.cls !== 1)) add('overhead', rest.fc?.cls !== 1 && rest.cc?.cls !== 1 ? 'both' : rest.fc?.cls !== 1 ? 'fc' : 'cc', 1, 'cCheck', B.overhead.addDays, B.overhead.cost, hub ? null : 'No C-check hub for this type');
  return out;
}

/** v0.7.3 a home-base crew rest refit from `start` (C-check add-ons: addRestToCCheck / bookCCheck restFit). Pure. */
export function restRefitQuote(g: GameState, aircraftId: string, id: RestRefitId, start: Minute): RefitQuote {
  const ac = g.fleet[aircraftId];
  const cabin: Cabin = ac?.cabin ?? { j: 0, w: 0, y: 0, total: 0, label: '', layout: 'all-economy' };
  const q: RefitQuote = {
    ok: false, why: null, cabin, days: 0, cost: 0, start, end: start, station: g.company.homeBase, ferryIn: [], seatsFrom: cabin.total, seatsTo: cabin.total,
    cabinMinFrom: cabinMinimum(cabin.total), cabinMinTo: cabinMinimum(cabin.total), opens: [], closes: [], reinstateAtReturn: null, clashes: [], breaks: [],
  };
  if (!ac) return { ...q, why: 'Aircraft not found' };
  const opt = restRefitOptions(g, aircraftId).find((o) => o.id === id);
  if (!opt) return { ...q, why: `${REFIT_LABEL[id]} is not offered for ${ac.reg}` };
  if (opt.where === 'cCheck') return { ...q, days: opt.days, cost: opt.cost, why: 'Fitted with a C-check at an MRO hub: book it from the C-check' };
  const after = restAfterRefit(ac, id);
  const full: RefitQuote = { ...q, cabin: after.cabin, days: opt.days, cost: opt.cost, end: start + opt.days * DAY, seatsTo: after.cabin.total, cabinMinTo: cabinMinimum(after.cabin.total), opens: [opt.opens.replace(/^Opens: /, '')] };
  if (!opt.ok) return { ...full, why: opt.why };
  return refitWindow(g, ac, full, g.company.homeBase);
}

/** v0.7.3 books a home-base crew rest refit (a short 'refit' at home base; the facilities change at the end). */
export function bookRestRefit(g: GameState, aircraftId: string, id: RestRefitId, start: Minute): ActionResult<{ maintId: string }> {
  const q = restRefitQuote(g, aircraftId, id, start);
  if (!q.ok) return { ok: false, error: q.why ?? 'Cannot book this work' };
  const ac = g.fleet[aircraftId];
  const r = scheduleCheck(g, aircraftId, 'refit', start, q.station, { refit: { cabin: q.cabin, days: q.days, cost: q.cost } });
  if (!r.ok) return r;
  const m = g.maintenance[r.data!.maintId];
  m.restFit = id;
  const what = REFIT_LABEL[id].toLowerCase().replace(/^curtain off/, 'curtained-off');
  pushMessage(g, {
    tone: 'info', cat: 'tech', title: `Crew rest refit booked: ${ac.reg}`,
    body: `${ac.reg} gets ${id === 'removeRecliners' ? 'its crew rest recliners removed' : `a ${what}`} at ${homeHangar(g)}, ${fmtDay(start)}–${fmtDay(q.end)} (${usd(q.cost)}, paid when the work starts). ${q.opens[0] ? `Opens: ${q.opens[0]}.` : ''}${q.ferryIn.length ? ` Ferry in ${q.ferryIn[0].from}–${q.station} ${fmtDay(q.ferryIn[0].std)}.` : ''}`,
    ref: { kind: 'maint', id: m.id },
  });
  return { ok: true, msg: `${REFIT_LABEL[id]} ${fmtDay(start)}–${fmtDay(q.end)}`, data: r.data };
}

/** v0.7.3 adds (or with null removes) a compartment refit on a booked hub C-check: the check grows by its days and cost; the ferry home moves. */
export function addRestToCCheck(g: GameState, maintId: string, id: 'fcrc' | 'overhead' | null): ActionResult {
  const m = g.maintenance[maintId];
  if (!m || m.kind !== 'C' || m.status !== 'planned') return { ok: false, error: 'No planned C-check' };
  const ac = g.fleet[m.aircraftId];
  if (!ac) return { ok: false, error: 'Aircraft not found' };
  const B = BAL.v073.restRefit;
  const cur = m.restFit === 'fcrc' || m.restFit === 'overhead' ? B[m.restFit] : null;
  if (id) {
    const opt = restRefitOptions(g, ac.id).find((o) => o.id === id);
    if (!opt || !opt.ok) return { ok: false, error: opt?.why ?? `${REFIT_LABEL[id]} is not offered for ${ac.reg}` };
  }
  const next = id ? B[id] : null;
  const days = (next?.addDays ?? 0) - (cur?.addDays ?? 0);
  // The longer check must not run into work after it.
  const end = m.end + days * DAY;
  const clash = flightsOf(g, ac.id).find((f) => (f.status === 'scheduled' || f.status === 'enroute') && f.kind !== 'positioning' && f.purpose !== 'check' && f.std < end + 6 * 60 && f.sta > m.end);
  if (days > 0 && clash) return { ok: false, error: `The longer check clashes with ${clash.no} ${fmtDay(clash.std)}` };
  m.end = end;
  m.cost += (next?.cost ?? 0) - (cur?.cost ?? 0);
  if (id) m.restFit = id;
  else delete m.restFit;
  m.ev++;
  schedule(g, m.start, 'maint.start', m.id, m.ev);
  retimeHomeLegs(g, m);
  rerosterFrom(g, ac.id, g.now);
  return { ok: true, msg: id ? `${REFIT_LABEL[id]} added to the C-check (+${next!.addDays} days, ${usd(next!.cost)})` : 'Crew rest refit taken off the C-check' };
}

/** The ferry home after a hub check, moved to leave BAL.v072.cHub.homeAfterMin after its (new) end. */
function retimeHomeLegs(g: GameState, m: MaintenanceEvent): void {
  const legs = (m.homeIds ?? []).map((fid) => g.flights[fid]).filter((f): f is Flight => f?.status === 'scheduled');
  if (!legs.length) return;
  const shift = m.end + BAL.v072.cHub.homeAfterMin - legs[0].std;
  if (!shift) return;
  for (const f of legs) retimeFlight(g, f, f.std + shift, f.sta + shift);
}

/** v0.7.3 the end of a crew rest refit (home refit or C-check add-on): the facilities (and cabin) change; one message. */
export function onRestFitEnd(g: GameState, m: MaintenanceEvent): void {
  if (!m.restFit) return;
  const ac = g.fleet[m.aircraftId];
  if (!ac) return;
  const before = ac.rest ?? migrateRest(ac);
  const after = restAfterRefit(ac, m.restFit);
  ac.rest = after.rest;
  if (m.kind === 'refit') ac.cabin = { ...(m.refit?.cabin ?? after.cabin) };
  g.stats.restRefits = (g.stats.restRefits ?? 0) + 1;
  rerosterFrom(g, ac.id, g.now);
  pushMessage(g, {
    tone: 'good', cat: 'tech', title: `${ac.reg}'s ${m.restFit === 'removeRecliners' ? 'crew rest recliners are removed' : `${REFIT_LABEL[m.restFit].toLowerCase()} is fitted`}`,
    body: `Pilots rest: ${restText(after.rest.fc, 'fc', ac.typeId)}. Cabin crew rest: ${restText(after.rest.cc, 'cc', ac.typeId)}. ${opensText(g, ac.typeId, before, after.rest)}.`,
    ref: { kind: 'aircraft', id: ac.id },
  });
}
