// v0.21 route advice (player reports bmwbiobsokzf4, bmwbjlg2n93bp): a stop flown as a fuel stop or as a stopover, side
// by side; the commercial analyst's suggestions on a business case (how often, fares, campaign, aircraft), each a
// change to the plan; the network planner's view on the stop and the routes worth a study. All pure except setStop.

import { AIRPORTS, AIRPORT_BY_CODE } from '../../data/airports';
import type { RouteMarket } from '../../data/routes';
import { BAL } from '../core/balance';
import { distance } from '../core/geo';
import { etopsCap, typeOf } from '../core/perf';
import { DAY } from '../core/time';
import type { GameState } from '../core/types';
import { catalogueOf, chainProblem, customFacts, customMarket, routeBases } from './custom';
import { firstFlightOf, project, studyBase, type Projection } from './launch';
import { cabinFor, freqPerWeek, marketOfRoute, serviceHours } from './model';
import { crewAwayCost } from './pnl';
import type { FifthRights, Route, RouteModel, RoutePlan } from './types';

export type StopMode = 'stopover' | 'fuel' | 'nonstop';

const DAY_NAME = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const k$ = (v: number) => `${v < 0 ? '−' : ''}$${Math.abs(v) >= 1e6 ? `${(Math.abs(v) / 1e6).toFixed(1)}M` : `${Math.round(Math.abs(v) / 1000)}K`}`;
const city = (c: string) => AIRPORT_BY_CODE[c]?.city ?? c;

/** The single stop a market shares both ways (a stopover's, or one fuel stop), else null. */
export function sharedStop(m: Pick<RouteMarket, 'via' | 'viaBack' | 'stopover'>): string | null {
  if (m.stopover) return m.stopover.at;
  const via = m.via ?? [];
  const back = m.viaBack ?? [...via].reverse();
  return via.length === 1 && back.length === 1 && back[0] === via[0] ? via[0] : null;
}

/** The same city pair flown another way: nonstop, with a fuel stop at `at`, or with a stopover there. Pure. */
export function stopTwin(m: Pick<RouteMarket, 'from' | 'to'>, mode: StopMode, at?: string | null): RouteMarket | null {
  if (mode === 'nonstop') return catalogueOf(m.from, m.to) ?? customMarket({ from: m.from, to: m.to });
  if (!at) return null;
  return mode === 'stopover' ? customMarket({ from: m.from, to: m.to, stop: at }) : customMarket({ from: m.from, to: m.to, via: [at], viaBack: [at] });
}

/**
 * v0.21 at the business case: fly the studied pair nonstop, with a fuel stop or with a stopover instead (the player:
 * "the option to turn it into a stopover instead of just a fuel stop"). The study carries over: its estimate is
 * re-read for the new shape (a stopover adds the two legs' local travellers). Null when done, else why not.
 */
export function setStop(g: GameState, routeId: string, mode: StopMode, at?: string): string | null {
  const r = g.network?.routes[routeId];
  if (!r) return 'This route no longer exists.';
  if (r.status !== 'case') return 'The stop can only be changed at the business case.';
  const m = marketOfRoute(r);
  if (!m) return 'Unknown market.';
  const stop = at ?? sharedStop(m);
  const t = stopTwin(m, mode, stop);
  if (!t) return mode === 'nonstop' ? 'No market there.' : 'This route has no single stop to change.';
  if (t.closed) return t.closed;
  if (t.id === m.id) return null;
  const est = r.study?.est;
  // v0.22 the study's own estimate and market are kept: each re-reading scales from them, never from the last
  // rounded numbers (stopover, nonstop and back used to drift by a traveller a step).
  const ref = est && r.study ? (r.study.ref ??= { marketId: r.marketId, ...(r.custom ? { custom: structuredClone(r.custom) } : {}), model: r.model, est: { ...est } }) : undefined;
  r.marketId = t.id;
  if (t.custom) r.custom = structuredClone(t);
  else delete r.custom;
  if (!t.models.includes(r.model)) {
    r.model = t.model;
    delete r.partnerId;
  }
  delete r.plan;
  delete r.fifth;
  if (ref && r.study) {
    if (ref.marketId === r.marketId) {
      r.study.est = { ...ref.est };
      delete r.study.ref;
    } else {
      const asRef: Route = { ...r, marketId: ref.marketId, model: ref.model, custom: ref.custom };
      if (!ref.custom) delete asRef.custom;
      const b0 = studyBase(g, asRef);
      const k = b0 > 0 ? studyBase(g, r) / b0 : 0;
      if (k > 0) r.study.est = { p10: Math.max(1, Math.round(ref.est.p10 * k)), p50: Math.max(1, Math.round(ref.est.p50 * k)), p90: Math.max(1, Math.round(ref.est.p90 * k)) };
    }
  }
  g.network!.rev = (g.network!.rev ?? 0) + 1;
  return null;
}

/** One way of flying a pair, a year of it. */
export interface StopOption {
  mode: StopMode;
  label: string;
  /** Hours door to door, out. */
  hours: number;
  rev: number;
  cost: number;
  result: number;
  margin: number;
  lf: number;
  /** Passengers a flight by market (a stopover). */
  split?: NonNullable<Projection['split']>;
  /** Why this way cannot be flown by the type (range, runway). */
  cant?: string;
}

export interface StopCompare {
  at: string;
  typeId: string;
  /** Nonstop when the type reaches, else the fuel stop; then the stopover without B–C rights. */
  plain: StopOption;
  /** v0.22 the fuel stop at `at` when the type also reaches nonstop (a stop it does not need), else null: `plain` is it. */
  fuel: StopOption | null;
  stopover: StopOption;
  /** The stopover with full B–C rights (null when they are impossible). */
  withRights: StopOption | null;
  odds: { full: number; limited: number; why: string };
  pros: string[];
  cons: string[];
}

type View = Pick<Route, 'marketId' | 'model' | 'reputation'> & { custom?: RouteMarket; study?: Route['study']; fifth?: FifthRights };

const viewOf = (m: RouteMarket, r?: View): View => ({ ...(r ?? { reputation: 60 }), marketId: m.id, ...(m.custom ? { custom: m } : { custom: undefined }), model: r && m.models.includes(r.model) ? r.model : m.model });

function optionOf(g: GameState, m: RouteMarket, mode: StopMode, plan: RoutePlan, start: number, x: number, r?: View, fifth?: FifthRights): StopOption {
  const cant = chainProblem(m, plan.typeId);
  const v = viewOf(m, r);
  const p = cant ? null : project(g, v, { ...plan, model: v.model }, start, x, fifth ? { fifth } : {});
  let hours = 0;
  try { hours = serviceHours(m, plan.typeId, 'out'); } catch { hours = 0; }
  return {
    mode, label: mode === 'nonstop' ? 'Nonstop' : mode === 'fuel' ? 'Fuel stop only' : 'Stopover', hours: Math.round(hours * 10) / 10,
    rev: p?.rev ?? 0, cost: p?.cost ?? 0, result: p?.result ?? 0, margin: p && p.rev ? p.result / p.rev : 0, lf: p && p.seatSec ? p.paxSec / p.seatSec : 0,
    ...(p?.split ? { split: p.split } : {}), ...(cant ? { cant } : {}),
  };
}

/** A first plan for a market before any study: its usual weekly timetable on the type. */
function firstPlan(m: RouteMarket, typeId: string): RoutePlan {
  return { model: m.model, days: 1 << m.timetable.day, every: 1, out: m.timetable.out, back: m.timetable.back, nights: m.timetable.nights, typeId, layout: 'two-class', fares: 'market', marketing: 'normal' };
}

/**
 * v0.21 "Fuel stop only" and "Stopover" side by side (pure): a year of the pair flown plainly (nonstop when the type
 * reaches, else with the fuel stop) against the stopover at `at` without and with B–C rights, and the pros and cons in
 * plain words. Before a study: the model's first guess on the market's usual weekly timetable. On a studied route
 * (`r`, `plan`, `x`): the study's demand and the player's plan. Null when a piece has no market.
 */
export function stopoverCompare(g: GameState, from: string, to: string, at: string, typeId: string, on?: { r: View; plan: RoutePlan; x: number }): StopCompare | null {
  const sm = customMarket({ from, to, stop: at });
  if (!sm?.stopover) return null;
  const nonstop = stopTwin({ from, to }, 'nonstop');
  const fuel = stopTwin({ from, to }, 'fuel', at);
  if (!nonstop || !fuel) return null;
  const reach = !chainProblem(nonstop, typeId);
  const pm = reach ? nonstop : fuel;
  const plan = on?.plan ?? firstPlan(sm, typeId);
  const start = on ? firstFlightOf(g, on.r, plan) : g.now + 120 * DAY;
  const x = on?.x ?? 1;
  const plain = optionOf(g, pm, reach ? 'nonstop' : 'fuel', plan, start, x, on?.r);
  const fuelOpt = reach ? optionOf(g, fuel, 'fuel', plan, start, x, on?.r) : null;
  const stopover = optionOf(g, sm, 'stopover', plan, start, x, on?.r, 'none');
  const odds = sm.stopover.fifth;
  const can = odds.full + odds.limited > 0;
  const withRights = can ? optionOf(g, sm, 'stopover', plan, start, x, on?.r, 'full') : null;
  const B = city(at);
  const C = city(to);
  const A = city(from);
  const pros: string[] = [];
  const cons: string[] = [];
  const sp = stopover.split;
  if (sp && sp.ab >= 1) pros.push(`About ${Math.round(sp.ab)} ${A}–${B} passengers a flight fill seats the ${C} passengers leave empty.`);
  if (withRights?.split && withRights.split.bc >= 1) pros.push(`With rights, about ${Math.round(withRights.split.bc)} ${B}–${C} passengers a flight too (${Math.round((odds.full + odds.limited) * 100)} % chance of rights).`);
  if (!reach) pros.push(`The ${typeOf(typeId)?.short ?? 'aircraft'} must land at ${B} anyway.`);
  const dh = stopover.hours - plain.hours;
  if (dh >= 0.2) cons.push(`${dh.toFixed(1)} h longer door to door than ${reach ? 'nonstop' : 'a quick fuel stop'}: ${A}–${C} passengers prefer the faster flight.`);
  const plainPax = plain.lf * (sp?.seats ?? 0);
  if (sp && !plain.cant && plainPax - sp.thr >= 3) cons.push(`About ${Math.round(plainPax - sp.thr)} fewer ${A}–${C} passengers a flight: the stop puts some off.`);
  cons.push(`A full turn at ${B}: landing, handling, catering and a station there.`);
  if (!can) cons.push(odds.why);
  else if (odds.full < 0.5) cons.push(`${B}–${C} seats need fifth-freedom rights: often refused or capped.`);
  return { at, typeId, plain, fuel: fuelOpt, stopover, withRights, odds, pros: pros.slice(0, 3), cons: cons.slice(0, 4) };
}

// ---------- the analyst and the planner on a business case ----------

export interface Advice {
  key: 'freq' | 'fares' | 'campaign' | 'aircraft' | 'cabin' | 'nights' | 'stop';
  who: 'analyst' | 'planner';
  /** What to do, in a few words. */
  title: string;
  /** Why, with the number. */
  why: string;
  /** The likely year's gain (USD) against the plan as drafted. */
  gain: number;
  /** One tap: the plan's change … */
  patch?: Partial<RoutePlan>;
  /** … or the stop's (setStop). */
  stop?: { mode: StopMode; at?: string };
}

export interface CaseAdvice {
  analyst: { hired: boolean; name?: string };
  planner: { hired: boolean; name?: string };
  list: Advice[];
  /** Nothing to change: the plan is the best the advisers found. */
  fine: boolean;
}

const activeHead = (g: GameState, id: 'analyst' | 'netPlanner') => {
  const h = g.heads?.[id];
  return h?.hired && h.on ? h : null;
};

const bits = (mask: number) => { let n = 0; for (let i = 0; i < 7; i++) if (mask & (1 << i)) n++; return n; };

/**
 * v0.21 the commercial analyst (when hired) tries the plan's levers one at a time and names those that earn clearly
 * more in the likely year; the network planner (when hired) weighs the stop: nonstop, fuel stop or stopover. Pure.
 */
export function caseAdvice(g: GameState, routeId: string, draft: RoutePlan): CaseAdvice {
  const r = g.network?.routes[routeId];
  const an = activeHead(g, 'analyst');
  const pl = activeHead(g, 'netPlanner');
  const out: CaseAdvice = { analyst: { hired: !!an, ...(an ? { name: an.hired!.name } : {}) }, planner: { hired: !!pl, ...(pl ? { name: pl.hired!.name } : {}) }, list: [], fine: false };
  const est = r?.study?.est;
  const m = r ? marketOfRoute(r) : undefined;
  if (!r || !est || !m || !typeOf(draft.typeId) || (!an && !pl)) return out;
  const start = firstFlightOf(g, r, draft);
  const base = studyBase(g, r);
  const x = base ? est.p50 / base : 1;
  const view = { ...r, model: draft.model };
  const cur = project(g, view, draft, start, x);
  const floor = Math.max(15_000, Math.abs(cur.rev) * 0.01);
  const list: Advice[] = [];
  if (an) {
    const best = (key: Advice['key'], opts: { title: string; patch: Partial<RoutePlan>; extra?: number; why?: (gain: number, p: Projection) => string }[]) => {
      let top: Advice | null = null;
      for (const o of opts) {
        const plan = { ...draft, ...o.patch };
        if ('monthly' in o.patch && !o.patch.monthly) delete plan.monthly;
        if (chainProblem(m, plan.typeId)) continue;
        const p = project(g, view, plan, start, x);
        const gain = Math.round(p.result - cur.result - (o.extra ?? 0));
        if (gain > floor && (!top || gain > top.gain)) top = { key, who: 'analyst', title: o.title, why: o.why ? o.why(gain, p) : `About ${k$(gain)} more a year.`, gain, patch: o.patch };
      }
      if (top) list.push(top);
    };
    const lfWhy = (gain: number, p: Projection) => `About ${k$(gain)} more a year; flights ${Math.round((p.seatSec ? p.paxSec / p.seatSec : 0) * 100)} % full.`;
    // How often (a partner sets its own timetable).
    if (draft.model !== 'partner') {
      const f: { title: string; patch: Partial<RoutePlan>; why: typeof lfWhy }[] = [];
      if (draft.monthly) {
        f.push({ title: 'Fly every week', patch: { monthly: undefined, every: 1, days: 1 << draft.monthly.weekday }, why: lfWhy });
        f.push({ title: 'Fly every two weeks', patch: { monthly: undefined, every: 2, days: 1 << draft.monthly.weekday }, why: lfWhy });
      } else if (draft.every > 1) {
        f.push({ title: 'Fly every week', patch: { every: 1 }, why: lfWhy });
      } else {
        const n = bits(draft.days);
        for (let i = 0; i < 7; i++) {
          if (draft.days & (1 << i)) {
            if (n > 1) f.push({ title: `Drop the ${DAY_NAME[i]} flight`, patch: { days: draft.days & ~(1 << i) }, why: lfWhy });
          } else if (n < 7) f.push({ title: `Add a ${DAY_NAME[i]} flight (${n + 1} a week)`, patch: { days: draft.days | (1 << i) }, why: lfWhy });
        }
        if (n === 1) f.push({ title: 'Fly every two weeks', patch: { every: 2 }, why: lfWhy });
      }
      best('freq', f);
      best('fares', (['low', 'market', 'high'] as const).filter((v) => v !== draft.fares).map((v) => ({
        title: `${v === 'low' ? 'Low' : v === 'high' ? 'High' : 'Market'} fares`, patch: { fares: v },
        why: (gain: number, p: Projection) => `About ${k$(gain)} more a year: ${v === 'high' ? 'the flights fill anyway' : v === 'low' ? 'more seats filled' : 'a better balance'} (${Math.round((p.seatSec ? p.paxSec / p.seatSec : 0) * 100)} % full).`,
      })));
      const C = BAL.v019.launch.campaign.cost;
      best('campaign', (['low', 'normal', 'high'] as const).filter((v) => v !== draft.marketing).map((v) => ({
        title: `${v === 'low' ? 'Low' : v === 'high' ? 'High' : 'Normal'} campaign`, patch: { marketing: v }, extra: (C[v] ?? 0) - (C[draft.marketing] ?? 0),
        why: (gain: number) => `About ${k$(gain)} more in the first year after the campaign's own cost.`,
      })));
    }
    // Aircraft from our fleet, the cabin, a night there.
    const types = [...new Set(Object.values(g.fleet).filter((a) => a.status !== 'leasedOut').map((a) => a.typeId))].filter((t) => t !== draft.typeId);
    best('aircraft', types.map((t) => ({ title: `Use the ${typeOf(t)?.short ?? t}`, patch: { typeId: t }, why: lfWhy })));
    const lay = draft.layout === 'all-economy' ? 'two-class' : 'all-economy';
    if (cabinFor(draft.typeId, lay).label !== cabinFor(draft.typeId, draft.layout ?? 'two-class').label) {
      best('cabin', [{ title: lay === 'all-economy' ? 'All-economy cabin' : 'Business + economy cabin', patch: { layout: lay }, why: lfWhy }]);
    }
    const cab = cabinFor(draft.typeId, draft.layout ?? 'two-class');
    const away = crewAwayCost(g, m, draft.typeId, cab.total, draft.nights);
    if (draft.nights > 0 && !crewAwayCost(g, m, draft.typeId, cab.total, 0).longDay) best('nights', [{ title: 'Back the same day', patch: { nights: 0 }, why: (gain) => `About ${k$(gain)} more a year: no hotel nights for the crew.` }]);
    else if (draft.nights === 0 && away.longDay) best('nights', [{ title: 'One night there', patch: { nights: 1 }, why: (gain) => `About ${k$(gain)} more a year: no third pilot for a ${away.dutyH} h day.` }]);
  }
  // The stop: the planner's call; without one, the analyst still weighs a stop the route already has.
  if (draft.model !== 'partner') {
    const who: Advice['who'] = pl ? 'planner' : 'analyst';
    const at = sharedStop(m);
    const c = at ? stopoverCompare(g, m.from, m.to, at, draft.typeId, { r, plan: draft, x }) : null;
    if (c && at) {
      const odds = c.odds;
      const pAny = odds.full + odds.limited;
      // The stopover's expected year: no rights, full or (a capped grant) about a third of the way.
      const expect = c.withRights ? c.stopover.result + (c.withRights.result - c.stopover.result) * (odds.full + odds.limited * 0.35) : c.stopover.result;
      if (m.stopover) {
        const gain = Math.round(c.plain.result - (r.fifth !== undefined ? cur.result : expect));
        if (!c.plain.cant && gain > floor) list.push({ key: 'stop', who, title: c.plain.mode === 'nonstop' ? 'Fly it nonstop' : `Only refuel at ${city(at)}`, why: `About ${k$(gain)} more a year: the ${city(at)} seats do not pay for the turn there.`, gain, stop: { mode: c.plain.mode, at } });
      } else {
        // v0.22 a fuel stop the aircraft does not need: flying it nonstop saves the landing.
        const direct = c.fuel && !c.plain.cant ? Math.round(c.plain.result - cur.result) : 0;
        if (direct > floor) list.push({ key: 'stop', who, title: 'Fly it nonstop', why: `About ${k$(direct)} more a year: the ${typeOf(draft.typeId)?.short ?? 'aircraft'} reaches ${m.city} without landing at ${city(at)}.`, gain: direct, stop: { mode: 'nonstop' } });
        const sure = Math.round(c.stopover.result - cur.result);
        const hope = Math.round(expect - cur.result);
        if (!c.stopover.cant && sure > floor) list.push({ key: 'stop', who, title: `Sell seats at ${city(at)} (a stopover)`, why: `About ${k$(sure)} more a year even without ${city(at)}–${m.city} rights${c.withRights ? `; ${k$(c.withRights.result - cur.result)} with them (${Math.round(pAny * 100)} % chance)` : ''}.`, gain: sure, stop: { mode: 'stopover', at } });
        else if (!c.stopover.cant && hope > floor && c.withRights) list.push({ key: 'stop', who, title: `Try a stopover at ${city(at)}`, why: `A bet on the rights (${Math.round(pAny * 100)} % chance): ${k$(c.withRights.result - cur.result)} with them, ${k$(sure)} without.`, gain: hope, stop: { mode: 'stopover', at } });
      }
    } else if (pl && !at && !(m.via?.length) && r.status === 'case') {
      const b = bestStop(g, r, draft, x, cur.result);
      if (b && b.gain > floor) list.push({ key: 'stop', who: 'planner', title: `Add a stopover at ${city(b.at)}`, why: b.why, gain: b.gain, stop: { mode: 'stopover', at: b.at } });
    }
  }
  list.sort((a, b) => b.gain - a.gain);
  out.list = list.slice(0, 4);
  out.fine = !out.list.length;
  return out;
}

/** The big airports roughly on the way of a nonstop pair (a small detour, both legs real flights), biggest first. */
export function stopCandidates(from: string, to: string, n = 4): string[] {
  const d = distance(from, to);
  if (d < 2_500) return [];
  return AIRPORTS.filter((a) => !a.enroute && !a.ice && a.size >= 4 && a.code !== from && a.code !== to)
    .map((a) => ({ a, d1: distance(from, a.code), d2: distance(a.code, to) }))
    .filter((v) => v.d1 >= 800 && v.d2 >= 800 && v.d1 + v.d2 <= d * 1.12)
    .sort((p, q) => q.a.size - p.a.size || q.a.pop - p.a.pop || (p.a.code < q.a.code ? -1 : 1))
    .slice(0, n).map((v) => v.a.code);
}

/** The planner's best stopover on a nonstop route (the expected year against the plan's), or null. */
function bestStop(g: GameState, r: Route, draft: RoutePlan, x: number, cur: number): { at: string; gain: number; why: string } | null {
  const m = marketOfRoute(r);
  if (!m) return null;
  let top: { at: string; gain: number; why: string } | null = null;
  for (const at of stopCandidates(m.from, m.to)) {
    const c = stopoverCompare(g, m.from, m.to, at, draft.typeId, { r, plan: draft, x });
    if (!c || c.stopover.cant) continue;
    const odds = c.odds;
    const expect = c.withRights ? c.stopover.result + (c.withRights.result - c.stopover.result) * (odds.full + odds.limited * 0.35) : c.stopover.result;
    const gain = Math.round(expect - cur);
    const sure = Math.round(c.stopover.result - cur);
    if (!top || gain > top.gain) top = { at, gain, why: c.withRights ? `${k$(sure)} a year without ${city(at)}–${m.city} rights, ${k$(c.withRights.result - cur)} with them (${Math.round((odds.full + odds.limited) * 100)} % chance).` : `About ${k$(sure)} more a year from ${city(m.from)}–${city(at)} passengers.` };
  }
  return top;
}

// ---------- the planner's route ideas ----------

export interface RouteIdea {
  from: string;
  to: string;
  marketId: string;
  typeId: string;
  /** The model's first guess for a weekly flight (the study tells the real size). */
  result: number;
  margin: number;
  lf: number;
  /** v0.23.2 the guess's flights a week and how it is sold. */
  perWeek: number;
  model: RouteModel;
  why: string;
}

/** v0.23.2 flights a week the planner tries on a pair. */
const IDEA_FREQ = [1, 2, 3];

/** `n` departures a week from `day` (0 = Monday), spread through the week. */
function spreadDays(day: number, n: number): number {
  const steps = n >= 3 ? [0, 2, 4] : n === 2 ? [0, 3] : [0];
  return steps.reduce((mask, k) => mask | (1 << ((day + k) % 7)), 0);
}

const ideaCache = new Map<string, { list: RouteIdea[]; why: string | null }>();

/**
 * v0.21 the network planner's shortlist (hired and on, else empty): pairs from our bases nobody has researched whose
 * first guess earns a healthy margin on an aircraft of ours, best first. A guess from the airports and the ties, not
 * the hidden real size: the study tells. Pure; cached by bases, fleet types and month.
 */
export function routeIdeas(g: GameState): RouteIdea[] {
  return ideasOf(g).list;
}

/**
 * v0.23.2 why the planner's shortlist is empty, in one plain line (null when it has ideas or no planner is on):
 * no aircraft, nothing they can reach, or nothing that earns enough.
 */
export function routeIdeasNone(g: GameState): string | null {
  return ideasOf(g).why;
}

function ideasOf(g: GameState): { list: RouteIdea[]; why: string | null } {
  if (!activeHead(g, 'netPlanner')) return { list: [], why: null };
  const bases = routeBases(g);
  const types = [...new Set(Object.values(g.fleet).filter((a) => a.status !== 'leasedOut').map((a) => a.typeId))].sort();
  const taken = new Set(Object.values(g.network?.routes ?? {}).filter((r) => r.status !== 'closed').map((r) => { const m = marketOfRoute(r); return m ? `${m.from}-${m.to}` : ''; }));
  const key = `${bases.join()}|${types.join()}|${[...taken].sort().join()}|${Math.floor(g.now / (30 * DAY))}|${Math.round(g.market.fuelPrice / 25)}`;
  const hit = ideaCache.get(key);
  if (hit) return hit;
  const home = city(bases[0]);
  if (!types.length) {
    const res = { list: [], why: 'We have no aircraft of our own to fly a route.' };
    ideaCache.set(key, res);
    return res;
  }
  // v0.23.2 (player report: "the network planner doesn't suggest routes at all" on a new A320 airline) the pairs the
  // fleet cannot fly (range, runway, ETOPS) go before the shortlist is cut, not after: the longest pairs used to fill
  // it and a narrowbody start was left with none.
  const caps = types.map((t) => ({ t, cap: etopsCap(g.company.approvals, t) }));
  const pre: { from: string; to: string; score: number; fit: string[] }[] = [];
  for (const from of bases) {
    for (const a of AIRPORTS) {
      if (a.enroute || a.ice || a.code === from || taken.has(`${from}-${a.code}`) || catalogueOf(from, a.code)) continue;
      const f = customFacts(from, a.code);
      if (!f || f.km < 600 || f.od < 8_000) continue;
      const fit = caps.filter((c) => !chainProblem({ from, to: a.code }, c.t, c.cap)).map((c) => c.t);
      if (!fit.length) continue;
      // Well-travelled pairs first, longer ones a little ahead (the fares carry the distance).
      pre.push({ from, to: a.code, score: f.od * Math.sqrt(f.km), fit });
    }
  }
  pre.sort((p, q) => q.score - p.score || (p.to < q.to ? -1 : 1));
  const out: RouteIdea[] = [];
  for (const c of pre.slice(0, 120)) {
    const m = customMarket({ from: c.from, to: c.to });
    if (!m || m.closed) continue;
    let top: RouteIdea | null = null;
    for (const t of c.fit) {
      // A weekly flight, or two or three a week (short-haul fills more often); own sale or a tour operator's.
      for (const n of IDEA_FREQ) {
        for (const model of m.models.filter((x) => x !== 'partner')) {
          const plan = { ...firstPlan(m, t), model, days: spreadDays(m.timetable.day, n) };
          const p = project(g, { ...viewOf(m), model }, plan, g.now + 120 * DAY, 1);
          const margin = p.rev ? p.result / p.rev : 0;
          if (!top || p.result > top.result) {
            const rivals = m.competitors.filter((v) => v.stops === 0);
            const lf = p.seatSec ? p.paxSec / p.seatSec : 0;
            top = {
              from: c.from, to: c.to, marketId: m.id, typeId: t, result: Math.round(p.result), margin, lf, perWeek: n, model,
              why: `${rivals.length ? `${rivals.length} nonstop rival${rivals.length > 1 ? 's' : ''}` : 'Nobody flies it nonstop'}; ${n === 1 ? 'a weekly' : `${n} a week on the`} ${typeOf(t)?.short ?? t} about ${Math.round(lf * 100)} % full${model === 'tour' ? ', sold as holidays' : ''}.`,
            };
          }
        }
      }
    }
    if (top && top.margin >= 0.06 && top.result > 0) out.push(top);
  }
  out.sort((p, q) => q.result - p.result || (p.to < q.to ? -1 : 1));
  const list = out.slice(0, BAL.v019.planner.ideas);
  const fleet = types.map((t) => typeOf(t)?.short ?? t).join(' and ');
  const why = list.length ? null
    : !pre.length ? `Our ${fleet} cannot reach any well-travelled city from ${home} (range, runway or ETOPS).`
      : `No pair from ${home} earns a healthy margin on our ${fleet} at today's fuel price and fares.`;
  if (ideaCache.size > 20) ideaCache.clear();
  const res = { list, why };
  ideaCache.set(key, res);
  return res;
}

/** Departures a week of a plan (re-exported for the UI's words). */
export const planFreq = (p: Pick<RoutePlan, 'days' | 'every' | 'monthly'>): number => freqPerWeek(p);
