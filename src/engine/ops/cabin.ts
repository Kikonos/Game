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
import type { ActionResult, Aircraft, Cabin, GameState, MaintenanceEvent, Minute, Requirements } from '../core/types';
import { route, routeMinutes, timeChain } from '../contracts/plan';
import { rerosterFrom } from '../crew';
import type { DeliveryLeg } from './delivery';
import { scheduleCheck } from './maintenance';
import { usd } from './util';

export interface RefitQuote {
  ok: boolean; why: string | null; cabin: Cabin; days: number; cost: number; start: Minute; end: Minute;
  station: string; ferryIn: DeliveryLeg[]; seatsFrom: number; seatsTo: number; cabinMinFrom: number; cabinMinTo: number;
  opens: string[]; closes: string[]; reinstateAtReturn: number | null; clashes: string[];
}

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

/** Shops that can take this aircraft's body, nearest first by ferry block from where it is. Pure. */
export function refitStations(g: GameState, aircraftId: string): { code: string; name: string; ferryBlock: number }[] {
  const ac = g.fleet[aircraftId];
  if (!ac) return [];
  return stationsFor(ac)
    .map((s) => {
      const r = route(ac.typeId, ac.at, s.code);
      return { code: s.code, name: `${s.name}, ${s.city}`, ferryBlock: r ? r.reduce((n, l) => n + l.block, 0) : Infinity };
    })
    .filter((s) => Number.isFinite(s.ferryBlock))
    .sort((a, b) => a.ferryBlock - b.ferryBlock || (a.code < b.code ? -1 : 1));
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
    cabinMinFrom: cabinMinimum(empty.total), cabinMinTo: cabinMinimum(empty.total), opens: [], closes: [], reinstateAtReturn: null, clashes: [],
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
  const st = MRO_STATIONS.find((s) => s.code === station);
  const why = (w: string) => ({ ...q, why: w });
  if (ac.cabin.label === label) return why(`Already ${label}`);
  if (!st || !AIRPORT_BY_CODE[station]) return why('Not a refit station');
  if (!st.wide && typeOf(ac.typeId).body === 'wide') return why(`${st.name} at ${st.city} takes narrowbodies only`);
  if (ac.status === 'delivering' || ac.status === 'stored' || ac.status === 'leasedOut' || ac.returning) return why(`${ac.reg} is not on the AOC for a refit`);
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
  if (r.length && loc.free + turn > ferryStart) return why(`${ac.reg} can't reach ${station} by then`);
  if (q.clashes.length) return why(`Clashes with ${q.clashes.length > 1 ? `${q.clashes.length} commitments` : q.clashes[0]}${q.clashes.length > 1 ? ` from ${q.clashes[0]}` : ''}: move them first`);
  return { ...q, ok: true };
}

/** Books a refit: a 'refit' check at the station (ferry booked when elsewhere); paid at the start of the work. */
export function bookRefit(g: GameState, aircraftId: string, label: string, station: string, start: Minute): ActionResult<{ maintId: string }> {
  const q = refitQuote(g, aircraftId, label, station, start);
  if (!q.ok) return { ok: false, error: q.why ?? 'Cannot book this refit' };
  const ac = g.fleet[aircraftId];
  const r = scheduleCheck(g, aircraftId, 'refit', start, station, { refit: { cabin: q.cabin, days: q.days, cost: q.cost } });
  if (!r.ok) return r;
  const st = MRO_STATIONS.find((s) => s.code === station)!;
  pushMessage(g, {
    tone: 'info', cat: 'tech', title: `Refit booked: ${ac.reg} to ${q.cabin.label}`,
    body: `${st.name}, ${st.city}: ${fmtDay(start)}–${fmtDay(q.end)} (${q.days} days, ${usd(q.cost)}, paid when the work starts).${q.ferryIn.length ? ` Ferry in ${q.ferryIn[0].from}–${station} ${fmtDay(q.ferryIn[0].std)}.` : ''}${q.reinstateAtReturn ? ` The lessor wants it back as delivered: about ${usd(q.reinstateAtReturn)} at the lease return.` : ''}`,
    ref: { kind: 'maint', id: r.data!.maintId },
  });
  return { ok: true, msg: `Refit to ${q.cabin.label} at ${st.city} ${fmtDay(start)}–${fmtDay(q.end)}`, data: r.data };
}

/** 'maint.end' of a refit: the new cabin, re-rostered duties for the new complement, one message. */
export function onRefitEnd(g: GameState, m: MaintenanceEvent): void {
  if (m.kind !== 'refit' || !m.refit) return;
  const ac = g.fleet[m.aircraftId];
  if (!ac) return;
  const was = ac.cabin;
  ac.cabin = { ...m.refit.cabin };
  g.stats.refits = (g.stats.refits ?? 0) + 1;
  rerosterFrom(g, ac.id, g.now);
  const st = MRO_STATIONS.find((s) => s.code === m.at);
  const fromW = workOf(ac.typeId, was);
  const toW = workOf(ac.typeId, ac.cabin);
  const opens = toW.filter((x) => !fromW.includes(x));
  const closes = fromW.filter((x) => !toW.includes(x));
  const minFrom = cabinMinimum(was.total);
  const minTo = cabinMinimum(ac.cabin.total);
  pushMessage(g, {
    tone: 'good', cat: 'tech', title: `${ac.reg} refitted: ${ac.cabin.label}${ac.cabin.layout === 'vip' ? ' VIP' : ''}`,
    body: `Out of the ${st?.name ?? 'cabin'} hangar at ${st?.city ?? m.at} after ${Math.round((m.end - m.start) / DAY)} days (${usd(m.cost)}). Cabin crew minimum ${minTo}${minTo !== minFrom ? ` (was ${minFrom})` : ''}.${opens.length ? ` It can now bid for ${opens.join(' and ')}.` : ''}${closes.length ? ` No longer: ${closes.join(', ')}.` : ''}`,
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
