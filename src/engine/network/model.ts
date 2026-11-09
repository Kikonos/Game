// v0.19 scheduled routes: the shared pure model (UPDATE-0.19.md §B, §D, §E, §F). Markets, cabins, the timetable's
// sector chain and times, the season, fares and the demand a departure can expect. Sales, the business case and the
// recommendation all read these, so the study, the case and what actually sells agree.

import { cabinPresets } from '../../data/cabins';
import type { CabinLayout } from '../../data/acmiTypes';
import { ROUTE_MARKETS, routeStation, type RouteMarket } from '../../data/routes';
import { BAL } from '../core/balance';
import { blockMinutes, typeOf } from '../core/perf';
import { DAY, fromUTC, localMinuteOfDay, localOffset, toDate } from '../core/time';
import type { GameState, Minute } from '../core/types';
import type { FareLevel, MarketingLevel, Route, RouteModel, RouteSeries, Segment } from './types';

export const MARKET_BY_ID: Record<string, RouteMarket> = Object.fromEntries(ROUTE_MARKETS.map((m) => [m.id, m]));
/** The market of a route: its own (a custom route, v0.19.2) or the catalogue's. */
export const marketOfRoute = (r: Pick<Route, 'marketId'> & { custom?: RouteMarket }): RouteMarket | undefined => r.custom ?? MARKET_BY_ID[r.marketId];
export { routeStation };

export type Dir = 'out' | 'back';

/** The seats a type and layout offer (the type's preset for that layout; else its first). */
export function cabinFor(typeId: string, layout: CabinLayout): { j: number; y: number; total: number; label: string } {
  const list = cabinPresets(typeId).filter((p) => p.layout !== 'vip');
  const p = list.find((x) => x.layout === layout) ?? list[0];
  if (!p) return { j: 0, y: 150, total: 150, label: '150Y' };
  return { j: p.j + p.w, y: p.y, total: p.j + p.w + p.y, label: p.label };
}

/** The sector chain of a direction: ['LIS','DXB','DIL'] out, ['DIL','KUL','DXB','LIS'] back. */
export function chainOf(m: RouteMarket, dir: Dir): string[] {
  return dir === 'out' ? [m.from, ...(m.via ?? []), m.to] : [m.to, ...(m.viaBack ?? []), m.from];
}

/** UTC minute of a local wall-clock time `localMin` on the local calendar day that contains `dayT` at `ap`. */
export function localToUtc(ap: string, dayT: Minute, localMin: number): Minute {
  const off = localOffset(ap, dayT);
  const localDay = Math.floor((dayT + off) / DAY) * DAY;
  const guess = localDay + localMin - off;
  // DST changes on that day: use the offset at the guessed time.
  return localDay + localMin - localOffset(ap, guess);
}

export interface SectorTime {
  from: string;
  to: string;
  std: Minute;
  sta: Minute;
  dir: Dir;
  /** A fuel stop sector (no traffic rights at the stop). */
  tech: boolean;
}

/** Ground time at a fuel stop for a type. */
export const techStopMin = (typeId: string): number => (typeOf(typeId)?.maxSeats ?? 0) > 300 ? BAL.v019.ops.techStopBig : BAL.v019.ops.techStop;

/**
 * §D.1 one rotation's sectors from its first departure: out chain with fuel stops (turn at each), the night-stop or
 * turn at the destination, then the back chain from the series' local back time (never before a legal turn).
 */
export function rotationTimes(m: RouteMarket, s: Pick<RouteSeries, 'back' | 'nights' | 'typeId'>, dep: Minute): SectorTime[] {
  const out: SectorTime[] = [];
  const t = typeOf(s.typeId);
  const turn = t?.turnMin ?? 60;
  const tech = techStopMin(s.typeId);
  let at = dep;
  const oc = chainOf(m, 'out');
  for (let i = 1; i < oc.length; i++) {
    const blk = blockMinutes(s.typeId, oc[i - 1], oc[i]);
    out.push({ from: oc[i - 1], to: oc[i], std: at, sta: at + blk, dir: 'out', tech: i < oc.length - 1 });
    at = at + blk + tech;
  }
  const arr = out[out.length - 1].sta;
  const ready = arr + turn;
  // Back from the destination at the local back time, `nights` local days after the arrival day (a day turn: the
  // same day, or the first back time after a legal turn).
  const back = Math.max(ready, localToUtc(m.to, arr + s.nights * DAY, s.back));
  at = back;
  const bc = chainOf(m, 'back');
  for (let i = 1; i < bc.length; i++) {
    const blk = blockMinutes(s.typeId, bc[i - 1], bc[i]);
    out.push({ from: bc[i - 1], to: bc[i], std: at, sta: at + blk, dir: 'back', tech: i < bc.length - 1 });
    at = at + blk + tech;
  }
  return out;
}

/** 0–11 month of a time. */
export const monthOf = (t: Minute): number => toDate(t).getUTCMonth();

/** The season index of a month and direction (§E.1). */
export function seasonX(m: RouteMarket, month: number, dir: Dir): number {
  const D = BAL.v019.demand;
  const out = m.season ?? D.season;
  const back = m.seasonBack ?? (m.season ? m.season : D.seasonBack);
  return (dir === 'out' ? out : back)[month] ?? 1;
}

/** §E.4 base one-way fare (net, USD) for a class in a month: off-peak floor to peak by the season index, × the level. */
export function baseFare(m: RouteMarket, cls: 'J' | 'Y', month: number, dir: Dir, level: FareLevel = 'market'): number {
  const [lo, hi] = cls === 'J' ? m.fareJ : m.fareY;
  const s = m.season ?? BAL.v019.demand.season;
  const min = Math.min(...s);
  const max = Math.max(...s);
  const x = max > min ? (seasonX(m, month, dir) - min) / (max - min) : 0.5;
  const f = lo + (hi - lo) * Math.max(0, Math.min(1, x));
  return Math.round(f * (BAL.v019.fares.scale ?? 1) * (BAL.v019.fares.marketX[m.id] ?? 1) * (1 + (BAL.v019.fares.level[level] ?? 0)));
}

/** Share of a market's travellers who want business class. */
export function jWant(m: RouteMarket): number {
  let w = 0;
  for (const [seg, share] of Object.entries(m.segments) as [Segment, number][]) w += share * (BAL.v019.demand.wantsJ[seg] ?? 0);
  return w;
}

/** Years since the game start (the market grows). */
const yearsIn = (g: GameState, t: Minute): number => Math.max(0, (t - g.started) / (365 * DAY));

/** §E.1 travellers a week one way on the whole market (all carriers) at `t`. */
export function weeklyMarket(g: GameState, m: RouteMarket, t: Minute, dir: Dir, truth = 1): number {
  const D = BAL.v019.demand;
  const share = dir === 'out' ? m.outShare : 1 - m.outShare;
  return (m.odPerYear * share * seasonX(m, monthOf(t), dir) / 52) * truth * Math.pow(1 + m.growth, yearsIn(g, t)) * D.scale;
}

export interface ShareInput {
  freqPerWeek: number;
  fares: FareLevel;
  awareness: number;
  reputation: number;
  /** Hours door to door of our flight (fuel stops included). */
  hours: number;
  /** Rival fare cut in force (0–1). */
  rivalCut?: number;
}

/** §E.2 our share of the market's travellers (logit against the rivals; their seats cap what they take). */
export function shareOf(m: RouteMarket, x: ShareInput): number {
  const B = BAL.v019.demand.beta;
  const ours = -B.fare * (1 + (BAL.v019.fares.level[x.fares] ?? 0)) + B.nonstop * 1 + B.freq * Math.log(Math.max(0.25, x.freqPerWeek)) + B.rep * ((x.reputation - 60) / 40) + B.mkt * x.awareness;
  let sum = Math.exp(ours);
  for (const c of m.competitors) {
    const u = -B.fare * c.fareX * (1 - (x.rivalCut ?? 0)) + B.nonstop * (c.stops === 0 ? 1 : 0) + B.freq * Math.log(Math.max(0.25, c.perWeek)) - B.hours * Math.max(0, c.hours - x.hours);
    sum += Math.exp(u);
  }
  const logit = Math.exp(ours) / sum;
  if (!m.custom) return logit;
  // v0.19.2 a custom market against busy rivals: a newcomer's share follows its share of the departures (one-stop
  // itineraries count a little), so one weekly flight never takes a fifth of a trunk route.
  let rivalF = 0;
  for (const c of m.competitors) rivalF += c.stops === 0 ? c.perWeek : 0.15 * c.perWeek;
  const f = Math.max(0.25, x.freqPerWeek);
  return Math.min(logit, 1.6 * (f / (f + rivalF)));
}

/** Hours door to door of our service in a direction (block + stops). */
export function serviceHours(m: RouteMarket, typeId: string, dir: Dir): number {
  const c = chainOf(m, dir);
  let min = 0;
  for (let i = 1; i < c.length; i++) min += blockMinutes(typeId, c[i - 1], c[i]);
  min += (c.length - 2) * techStopMin(typeId);
  return min / 60;
}

export interface DemandInput extends ShareInput {
  truth: number;
  /** Demand multiplier of the departure's weekday and time (the study's dayX × timeX). */
  slotX: number;
  /** Launch ramp and dents (§E.5, §H.3). */
  rampX: number;
  jDent?: number;
}

/**
 * Expected final passengers of one departure in a direction, by class wish: J (who want business) and Y, before the
 * cabin caps them. Market × our share ÷ our departures that week, × the fare level's demand, the slot and the ramp.
 */
export function departureDemand(g: GameState, m: RouteMarket, t: Minute, dir: Dir, x: DemandInput): { j: number; y: number } {
  const F = BAL.v019.fares;
  const weekly = weeklyMarket(g, m, t, dir, x.truth);
  const perDep = (weekly * shareOf(m, x)) / Math.max(0.25, x.freqPerWeek);
  const n = perDep * (F.levelDemand[x.fares] ?? 1) * x.slotX * x.rampX;
  const jw = jWant(m);
  return { j: n * jw * (x.jDent ?? 1), y: n * (1 - jw) };
}

/** §E.4 the demand of a departure weekday (0 = Monday) and local time (the study's dayX and timeX). */
export function slotX(weekday: number, localMin: number): number {
  const S = BAL.v019.study;
  const d = S.dayX[((weekday % 7) + 7) % 7] ?? 1;
  let tx = 1;
  for (const [at, v] of S.timeX) if (localMin >= at) tx = v;
  return d * tx;
}

/** Minutes after local midnight at an airport. */
export const localMinute = (ap: string, t: Minute): number => localMinuteOfDay(ap, t);

/** Weekday (0 = Monday) of a time at an airport's local calendar. */
export function localWeekday(ap: string, t: Minute): number {
  const d = toDate(t + localOffset(ap, t));
  return (d.getUTCDay() + 6) % 7;
}

/** Departures a week of a series (monthly ≈ 12/52; every N weeks: days ÷ N). */
export function freqPerWeek(s: Pick<RouteSeries, 'days' | 'every' | 'monthly'>): number {
  if (s.monthly) return 12 / 52;
  let n = 0;
  for (let i = 0; i < 7; i++) if (s.days & (1 << i)) n++;
  return n / Math.max(1, s.every);
}

/** The IATA season code of a time: summer from the last Sunday of March, winter from the last Sunday of October. */
export function seasonCode(t: Minute): { code: string; from: Minute; to: Minute } {
  const y = toDate(t).getUTCFullYear();
  const lastSun = (yr: number, month: number) => {
    const end = fromUTC(yr, month + 1, 1) - DAY;
    const wd = toDate(end).getUTCDay();
    return end - wd * DAY;
  };
  const sS = lastSun(y, 3);
  const sW = lastSun(y, 10);
  if (t >= sS && t < sW) return { code: `S${String(y).slice(2)}`, from: sS, to: sW };
  if (t >= sW) return { code: `W${String(y).slice(2)}`, from: sW, to: lastSun(y + 1, 3) };
  return { code: `W${String(y - 1).slice(2)}`, from: lastSun(y - 1, 10), to: sS };
}

/** Fare words for messages. */
export const usd = (n: number): string => `$${Math.round(n).toLocaleString('en-US')}`;

/** Default marketing and fares for a new plan. */
export const DEFAULT_PLAN: { fares: FareLevel; marketing: MarketingLevel } = { fares: 'market', marketing: 'normal' };

/** The model words. */
export const MODEL_WORD: Record<RouteModel, string> = { own: 'own brand', partner: 'for a partner', tour: 'holiday charter series' };
