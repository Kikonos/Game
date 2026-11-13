// v0.19 "Scheduled routes" (docs/UPDATE-0.19.md §K): the Network area's pure view helpers (no React). The words the
// player reads about a route: its name and model, the status chip, the timetable in words, loads, trends and money.

import { AIRPORT_BY_CODE, AIRPORTS, type Airport } from '../../../data/airports';
import { countryName } from '../../../data/countries';
import { ROUTE_MARKETS, type RouteMarket } from '../../../data/routes';
import { typeOf } from '../../../engine/core/perf';
import { DAY, fmtDay, fmtTime, localMinuteOfDay, monthKey, toDate } from '../../../engine/core/time';
import type { GameState, Minute, MonthKey } from '../../../engine/core/types';
import { monthsWords } from '../../../engine/network/model';
import type { LaunchStageId, Rotation, Route, RoutePnl, RouteSeries, SectorLoad } from '../../../engine/network/types';

export const MARKET_BY_ID: Record<string, RouteMarket> = Object.fromEntries(ROUTE_MARKETS.map((m) => [m.id, m]));

/** The market of a route: its own (a custom route, v0.19.2) or the catalogue's. */
export const marketOf = (r: Pick<Route, 'marketId'> & { custom?: RouteMarket }): RouteMarket | undefined => r.custom ?? MARKET_BY_ID[r.marketId];

/** 'Lisbon – Bissau' */
export function routeName(r: Pick<Route, 'marketId'> & { custom?: RouteMarket }): string {
  const m = marketOf(r);
  if (!m) return r.marketId;
  return `${AIRPORT_BY_CODE[m.from]?.city ?? m.from} – ${m.city ?? AIRPORT_BY_CODE[m.to]?.city ?? m.to}`;
}

/** 'LIS–OXB', or with the fuel stops 'LIS–DXB–DIL'. */
export function routeCode(m: RouteMarket | undefined, back = false): string {
  if (!m) return '';
  const via = (back ? m.viaBack : m.via) ?? [];
  return back ? [m.to, ...via, m.from].join('–') : [m.from, ...via, m.to].join('–');
}

/** 'Own brand' · 'For STP Airways' · '<Company> Holidays'. */
export function modelLabel(g: GameState, r: Pick<Route, 'model' | 'partnerId' | 'marketId'> & { custom?: RouteMarket }): string {
  if (r.model === 'own') return 'Own brand';
  if (r.model === 'partner') {
    const name = (r.partnerId && g.clients[r.partnerId]?.name) || marketOf(r)?.partner?.name || 'a partner';
    return `For ${name}`;
  }
  return `${g.company.name} Holidays`;
}

export const MODEL_HINT: Record<Route['model'], string> = {
  own: 'We sell the seats: tickets, cargo and extras are ours, and so is the risk.',
  partner: 'The partner sells the seats and pays us a fee per block hour, plus a share above 70 % full.',
  tour: 'Our tour operator sells blocks to groups months ahead and the rest seat-only.',
};

export const STAGE_LABEL: Record<LaunchStageId, string> = {
  study: 'Market study',
  case: 'Business case',
  rights: 'Traffic rights and permits',
  slots: 'Slots',
  brand: 'Brand and partner',
  distribution: 'Distribution',
  filing: 'Timetable filed, on sale',
  marketing: 'Launch campaign',
  stations: 'Station contracts',
  familiarisation: 'Crew familiarisation',
  inaugural: 'First flight',
};

const STAGE_HINT: Record<LaunchStageId, string> = {
  study: 'A consultant sizes the market: traffic data, the diaspora, rivals, government and NGO travel.',
  case: 'Your decision: go, change the plan, or shelve it.',
  rights: 'Designation, the foreign operator permit and any stop-over permits.',
  slots: 'Take-off and landing times at coordinated airports.',
  brand: 'Our own code, the partner\'s terms, or the tour operator\'s licence.',
  distribution: 'Booking systems, travel agents (BSP), the website and a call centre.',
  filing: 'The timetable goes out and tickets go on sale.',
  marketing: 'Diaspora radio and press, churches and associations, agents, launch fares.',
  stations: 'Handling, catering and fuel at each airport, and a station manager.',
  familiarisation: 'Captains are briefed on the new airports before they fly there.',
  inaugural: 'Water salute, press and guests.',
};

/** v0.23.2 who mostly travels on a market: families with officials and aid workers (Lisbon's Africa), families, holidaymakers, business. */
export type MarketKind = 'aid' | 'family' | 'holiday' | 'business';

export function marketKind(m?: Pick<RouteMarket, 'segments'>): MarketKind {
  const s = m?.segments ?? {};
  const aid = (s.gov ?? 0) + (s.ngo ?? 0) + (s.teachers ?? 0);
  const fam = (s.vfr ?? 0) + (s.students ?? 0) + aid;
  const hol = s.tourism ?? 0;
  const biz = s.biz ?? 0;
  if (hol > fam && hol >= biz) return 'holiday';
  if (biz > fam) return 'business';
  return aid >= 0.08 || !m ? 'aid' : 'family';
}

/** v0.23.2 the study and the campaign in the market's own words (they used to name the diaspora, churches and NGOs on every route). */
const KIND_HINT: Record<Exclude<MarketKind, 'aid'>, { full: string; study: string; marketing: string }> = {
  family: {
    full: 'Booking data and interviews with the diaspora associations and travel agents.',
    study: 'A consultant sizes the market: traffic data, the diaspora, rivals and travel agents.',
    marketing: 'Diaspora radio and press, associations, agents, launch fares.',
  },
  holiday: {
    full: 'Booking data and interviews with tour operators, hotels and travel agents.',
    study: 'A consultant sizes the market: traffic data, rivals, tour operators and hotels.',
    marketing: 'Tour operators and travel agents, online ads, launch fares.',
  },
  business: {
    full: 'Booking data and interviews with companies and their travel agents.',
    study: 'A consultant sizes the market: traffic data, rivals, companies and their travel agents.',
    marketing: 'Press and online ads, company deals, agents, launch fares.',
  },
};

const DEPTH_HINT: Record<'desk' | 'full' | 'survey', string> = {
  desk: 'Published traffic data and rivals\' timetables. Cheap and quick, but it can be well off.',
  full: 'Booking data, the diaspora associations, government and NGO interviews.',
  survey: 'The full study plus a passenger survey: the closest estimate.',
};

/** What a launch stage is, for this market. */
export function stageHint(id: LaunchStageId, m?: Pick<RouteMarket, 'segments'>): string {
  const k = marketKind(m);
  if (k !== 'aid' && (id === 'study' || id === 'marketing')) return KIND_HINT[k][id];
  return STAGE_HINT[id];
}

/** What a study depth looks at, for this market. */
export function depthHint(d: 'desk' | 'full' | 'survey', m?: Pick<RouteMarket, 'segments'>): string {
  const k = marketKind(m);
  return d === 'full' && k !== 'aid' ? KIND_HINT[k].full : DEPTH_HINT[d];
}

export type Tone = 'good' | 'warn' | 'bad' | 'info' | 'off';

/** The status chip (Study · Business case · Launching (stage x of 11) · On sale · Operating · Suspended · Closed). */
export function statusChip(r: Route): { label: string; tone: Tone } {
  switch (r.status) {
    case 'study': return { label: 'Study', tone: 'info' };
    case 'case': return { label: 'Your decision', tone: 'warn' };
    case 'launching': {
      const n = r.stages.filter((s) => s.state === 'done').length;
      const late = r.stages.some((s) => s.state === 'delayed' || s.state === 'failed');
      return { label: `Launching · ${Math.min(11, n + 1)} of 11`, tone: late ? 'warn' : 'info' };
    }
    case 'onSale': return { label: 'On sale', tone: 'info' };
    case 'operating': return { label: 'Operating', tone: 'good' };
    case 'suspended': return { label: 'Suspended', tone: 'warn' };
    default: return { label: 'Closed', tone: 'off' };
  }
}

export const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const NTH = ['', 'first', 'second', 'third', 'fourth'];

/** The weekdays (0 = Monday) of a series' bitmask. */
export function daysOf(mask: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < 7; i++) if (mask & (1 << i)) out.push(i);
  return out;
}

/** 'Weekly, Fri' · 'Twice weekly, Wed · Fri' · 'Every 2 weeks, Sat' · 'Monthly, first Fri' · 'Daily'. */
export function seriesWords(s: Pick<RouteSeries, 'days' | 'every' | 'monthly' | 'months'>): string {
  // v0.23.2 a seasonal series names its months ("Weekly, Sat, Oct–Apr").
  const base = patternWords(s);
  return s.months !== undefined && (s.months & 4095) !== 4095 ? `${base}, ${monthsWords(s.months)}` : base;
}

function patternWords(s: Pick<RouteSeries, 'days' | 'every' | 'monthly'>): string {
  if (s.monthly) {
    const nth = s.monthly.nth === -1 ? 'last' : NTH[s.monthly.nth] ?? `${s.monthly.nth}th`;
    return `Monthly, ${nth} ${DAY_SHORT[s.monthly.weekday] ?? ''}`.trim();
  }
  const d = daysOf(s.days);
  const names = d.map((x) => DAY_SHORT[x]).join(' · ');
  if (!d.length) return 'No days set';
  if (d.length === 7 && s.every <= 1) return 'Daily';
  if (s.every > 1) return `Every ${s.every} weeks, ${names}`;
  if (d.length === 1) return `Weekly, ${names}`;
  if (d.length === 2) return `Twice weekly, ${names}`;
  return `${d.length} a week, ${names}`;
}

/** The series running at `t` (else the next one to start, else the last). */
export function seriesAt(r: Route, t: Minute): RouteSeries | undefined {
  const s = [...r.series].sort((a, b) => a.from - b.from);
  return s.find((x) => x.from <= t && t < x.to) ?? s.find((x) => x.from > t) ?? s.at(-1);
}

/** The route's timetable in words, the series running now (and any others as '+1 more'). */
export function timetableWords(r: Route, t: Minute): string {
  const now = r.series.filter((x) => x.to > t);
  if (!now.length) return r.series.length ? 'Timetable ended' : 'No timetable yet';
  const main = seriesAt(r, t)!;
  const more = new Set(now.map((x) => seriesWords(x))).size - 1;
  return `${seriesWords(main)}${more > 0 ? ` +${more} more` : ''}`;
}

/** Rotations still to fly (planned or with flights), in departure order. */
export function upcoming(r: Route, now: Minute): Rotation[] {
  return r.rotations.filter((x) => (x.status === 'planned' || x.status === 'flights') && lastArr(x, now) >= now).sort((a, b) => a.dep - b.dep);
}

/** Flown (or cancelled) rotations, newest first. */
export function history(r: Route): Rotation[] {
  return r.rotations.filter((x) => x.status === 'flown' || x.status === 'cancelled').sort((a, b) => b.dep - a.dep);
}

/** A rotation's end estimate (its last sector's flight arrival when known, else departure + 1 day). */
function lastArr(rot: Rotation, now: Minute): Minute {
  return Math.max(rot.dep + DAY, now - 1);
}

export interface Load {
  bookedJ: number;
  bookedY: number;
  capJ: number;
  capY: number;
  /** 0–1 booked (or flown) against seats. */
  lf: number;
}

/** Seats and passengers of a sector: flown once it has flown, booked before. */
export function sectorLoad(s: SectorLoad): Load {
  const flown = s.flownY !== undefined || s.flownJ !== undefined;
  const j = flown ? s.flownJ ?? 0 : s.bookedJ;
  const y = flown ? s.flownY ?? 0 : s.bookedY;
  const cap = s.capJ + s.capY;
  return { bookedJ: j, bookedY: y, capJ: s.capJ, capY: s.capY, lf: cap > 0 ? (j + y) / cap : 0 };
}

/** The rotation's busiest sector load (the figure the list shows for the next departure). */
export function rotationLoad(rot: Rotation): Load {
  const loads = rot.sectors.map(sectorLoad);
  if (!loads.length) return { bookedJ: 0, bookedY: 0, capJ: 0, capY: 0, lf: 0 };
  return loads.reduce((a, b) => (b.lf > a.lf ? b : a));
}

/** 'Tonnes or kg': '3.8 t' · '640 kg'. */
export function kg(n: number): string {
  if (!n) return '0 kg';
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)} t` : `${Math.round(n)} kg`;
}

/** 'J 9/16 · Y 214/251 · 85 %' (no J part when the cabin has none). */
export function seatsLine(l: Load): string {
  const parts = [];
  if (l.capJ > 0 || l.bookedJ > 0) parts.push(`J ${l.bookedJ}/${l.capJ}`);
  parts.push(`Y ${l.bookedY}/${l.capY}`);
  parts.push(`${Math.round(l.lf * 100)} %`);
  return parts.join(' · ');
}

/** 'cargo 3.8 t (live animals 0.6 t) · mail 0.3 t' or '' with no cargo. */
export function cargoLine(s: Pick<SectorLoad, 'cargoKg' | 'aviKg' | 'mailKg'>): string {
  if (!s.cargoKg) return '';
  const avi = s.aviKg ? ` (live animals ${kg(s.aviKg)})` : '';
  const mail = s.mailKg ? ` · mail ${kg(s.mailKg)}` : '';
  return `cargo ${kg(s.cargoKg)}${avi}${mail}`;
}

export function lfTone(lf: number): 'good' | 'warn' | 'bad' {
  return lf >= 0.7 ? 'good' : lf >= 0.5 ? 'warn' : 'bad';
}

/** §I reputation words: Poor < 40 · Mixed 40–55 · Good 55–75 · Very good > 75. */
export function repWord(rep: number): { word: string; tone: Tone } {
  if (rep < 40) return { word: 'Poor', tone: 'bad' };
  if (rep < 55) return { word: 'Mixed', tone: 'warn' };
  if (rep <= 75) return { word: 'Good', tone: 'good' };
  return { word: 'Very good', tone: 'good' };
}

const EMPTY_PNL: RoutePnl = { rev: 0, tickets: 0, cargo: 0, ancillary: 0, direct: 0, acTime: 0, result: 0, pax: 0, seats: 0, bh: 0, sectors: 0, onTime: 0, cargoKg: 0, launch: 0 };

/** The month keys from `n` months back up to the current one, oldest first. */
export function monthsBack(now: Minute, n: number): MonthKey[] {
  const k = monthKey(now);
  return Array.from({ length: n }, (_, i) => k - (n - 1 - i));
}

/** Sums of a route's months (missing months are zero). */
export function pnlSum(r: Pick<Route, 'pnl'>, keys: MonthKey[]): RoutePnl {
  const out = { ...EMPTY_PNL };
  for (const k of keys) {
    const p = r.pnl[k];
    if (!p) continue;
    for (const f of Object.keys(EMPTY_PNL) as (keyof RoutePnl)[]) out[f] = (out[f] ?? 0) + (p[f] ?? 0);
    // v0.21 passengers on every sector (the load factor's top); a month from before v0.21 counted them once.
    out.paxSec = (out.paxSec ?? 0) + (p.paxSec ?? p.pax);
  }
  return out;
}

/** The last three closed months and the three before (for the trend arrows); the running month is left out. */
export function lastQuarters(r: Pick<Route, 'pnl'>, now: Minute): { cur: RoutePnl; prev: RoutePnl; months: number } {
  const k = monthKey(now);
  const cur = [k - 3, k - 2, k - 1];
  const prev = [k - 6, k - 5, k - 4];
  const months = cur.filter((x) => r.pnl[x]?.sectors).length;
  return { cur: pnlSum(r, cur), prev: pnlSum(r, prev), months };
}

/** Load factor, yield (ticket revenue a passenger) and margin of a sum. */
export function ratios(p: RoutePnl): { lf: number; yieldPax: number; margin: number } {
  return {
    lf: p.seats > 0 ? (p.paxSec ?? p.pax) / p.seats : 0,
    yieldPax: p.pax > 0 ? p.tickets / p.pax : 0,
    margin: p.rev > 0 ? p.result / p.rev : 0,
  };
}

/** A trend between two values: −1, 0 or +1 and the change as a share (null when there is nothing to compare). */
export function trend(cur: number, prev: number, flat = 0.03): { dir: -1 | 0 | 1; change: number | null } {
  if (!prev && !cur) return { dir: 0, change: null };
  if (!prev) return { dir: cur > 0 ? 1 : cur < 0 ? -1 : 0, change: null };
  const change = (cur - prev) / Math.abs(prev);
  return { dir: Math.abs(change) < flat ? 0 : change > 0 ? 1 : -1, change };
}

/** The 12-month result bars (oldest first), with launch spend apart. */
export function monthBars(r: Pick<Route, 'pnl'>, now: Minute, n = 12): { keys: MonthKey[]; result: number[]; launch: number[] } {
  const keys = monthsBack(now, n);
  return { keys, result: keys.map((k) => Math.round(r.pnl[k]?.result ?? 0)), launch: keys.map((k) => Math.round(r.pnl[k]?.launch ?? 0)) };
}

/** Launch spend so far (all months). */
export function launchSpend(r: Pick<Route, 'pnl' | 'stages'>): number {
  const fromPnl = Object.values(r.pnl).reduce((a, p) => a + (p.launch ?? 0), 0);
  const fromStages = r.stages.reduce((a, s) => a + (s.cost ?? 0), 0);
  return Math.max(fromPnl, fromStages);
}

/** 'Fri 14 Nov 06:40 UTC · 06:40 LIS'. */
export function depWords(t: Minute, ap: string): string {
  const d = toDate(t);
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()];
  const local = fmtTime(t, ap);
  const utc = fmtTime(t);
  return local === utc ? `${wd} ${fmtDay(t)} ${utc} UTC` : `${wd} ${fmtDay(t)} ${utc} UTC · ${local} ${ap}`;
}

/** Minutes after local midnight → '06:40'. */
export function hhmm(min: number): string {
  const m = ((Math.round(min) % DAY) + DAY) % DAY;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** The local departure minute of the first sector of a rotation (at the route's origin). */
export function localDep(rot: Rotation, ap: string): number {
  return localMinuteOfDay(ap, rot.dep);
}

/** Network totals for the list header: routes operating, the last three months' result, ticket cash held. */
export function networkTotals(g: GameState): { operating: number; launching: number; result: number; unearned: number; months: number } {
  const routes = Object.values(g.network?.routes ?? {}).filter((r) => r.status !== 'closed');
  let result = 0, unearned = 0, months = 0;
  for (const r of routes) {
    const q = lastQuarters(r, g.now);
    result += q.cur.result;
    months = Math.max(months, q.months);
    unearned += r.unearned ?? 0;
  }
  return {
    operating: routes.filter((r) => r.status === 'operating').length,
    launching: routes.filter((r) => r.status === 'study' || r.status === 'case' || r.status === 'launching' || r.status === 'onSale').length,
    result: Math.round(result),
    unearned: Math.round(unearned),
    months,
  };
}

/** Markets the player can't start now: running or launching already, or greyed out (the reason). */
export function marketBlock(g: GameState, m: RouteMarket): string | null {
  if (m.closed) return m.closed;
  const r = Object.values(g.network?.routes ?? {}).find((x) => x.marketId === m.id && x.status !== 'closed');
  if (!r) return null;
  return r.status === 'operating' ? 'You fly it already' : 'You are launching it';
}

/** The rotation's sector chain 'LIS–OXB–LIS'. */
export function chainOf(rot: Rotation): string {
  if (!rot.sectors.length) return '';
  return [rot.sectors[0].from, ...rot.sectors.map((s) => s.to)].join('–');
}

/** Rotation result once flown (sum of sector results), or null. */
export function rotationResult(rot: Rotation): number | null {
  if (!rot.sectors.some((s) => s.rev !== undefined)) return null;
  return Math.round(rot.sectors.reduce((a, s) => a + (s.rev ?? 0) - (s.cost ?? 0), 0));
}

/** The route contracts don't count among ACMI contracts (counts, filters, the Active list's main rows). */
export const isRouteContract = (c: { archetype: string; sched?: unknown }): boolean => c.archetype === 'scheduled' || !!c.sched;

export const LAYOUT_WORD: Record<string, string> = { 'all-economy': 'all economy', 'two-class': 'business and economy', 'three-class': 'three classes', vip: 'VIP' };

/** '767-300ER · business and economy' for a series (its pinned aircraft's cabin when pinned). */
export function seriesAircraft(g: GameState, s: Pick<RouteSeries, 'typeId' | 'layout' | 'tail'>): string {
  const ac = s.tail ? g.fleet[s.tail] : undefined;
  let name = s.typeId;
  try {
    name = typeOf(s.typeId).name;
  } catch {
    /* unknown type id: the id */
  }
  return ac ? `${name} ${ac.cabin.label}` : `${name} · ${LAYOUT_WORD[s.layout] ?? s.layout}`;
}

/** IATA season code 'S27' / 'W27' → 'summer 2027' / 'winter 2027–28'. */
export function seasonWord(code: string): string {
  const m = /^([SW])(\d{2})$/.exec(code);
  if (!m) return code;
  const y = 2000 + Number(m[2]);
  return m[1] === 'S' ? `summer ${y}` : `winter ${y}–${String(y + 1).slice(2)}`;
}

// ---------- v0.19.2 the route builder ----------

/** Airports matching a search (code, city, airport name, country), best first; never fuel-stop fields. Pure. */
export function searchAirports(q: string, exclude: string[] = [], limit = 8): Airport[] {
  const s = q.trim().toLowerCase();
  if (s.length < 2) return [];
  const scored: [number, Airport][] = [];
  for (const a of AIRPORTS) {
    if (a.enroute || a.ice || exclude.includes(a.code)) continue;
    const code = a.code.toLowerCase();
    const city = a.city.toLowerCase();
    const country = countryName(a.country).toLowerCase();
    let sc = 0;
    if (code === s) sc = 100;
    else if (city === s) sc = 90;
    else if (city.startsWith(s)) sc = 70;
    else if (a.name.toLowerCase().startsWith(s)) sc = 55;
    else if (country.startsWith(s)) sc = 40;
    else if (city.includes(s) || a.name.toLowerCase().includes(s)) sc = 30;
    else if (country.includes(s)) sc = 20;
    if (sc) scored.push([sc + a.size, a]);
  }
  return scored.sort((x, y) => y[0] - x[0] || (x[1].code < y[1].code ? -1 : 1)).slice(0, limit).map((x) => x[1]);
}

/** Traffic rights in plain words. */
export function rightsWord(hard: number): string {
  if (hard <= 0) return 'Open skies: nothing to wait for';
  if (hard <= 0.1) return 'Open: a filing, a few weeks';
  if (hard <= 0.3) return 'Bilateral: a permit, two to four months';
  if (hard <= 0.5) return 'Hard: a permit, four to six months, may be refused';
  return 'Very hard: few permits for a newcomer';
}

/**
 * v0.22 which column of the stop comparison the route really flies: the stopover; else, when the aircraft also reaches
 * nonstop, the fuel stop it lands at anyway ('fuel': "Nonstop" is another choice, not the one made); else the plain
 * way (the fuel stop it needs). Pure.
 */
export function stopChosen(cmp: { fuel: unknown | null }, stopover: boolean): 'stopover' | 'plain' | 'fuel' {
  return stopover ? 'stopover' : cmp.fuel ? 'fuel' : 'plain';
}
