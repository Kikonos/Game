// v0.19 the route launch (UPDATE-0.19.md §C; additions 3 a). Eleven stages in game time: the market study, the
// business case (the player's Go / change / shelve, with the study's recommended timetable and the consequences of any
// deviation), then rights, slots, brand, distribution, filing (sales open), the campaign, station contracts, crew
// briefings and the first flight. Each stage has a cost, a duration and setbacks rolled on the network's side stream.

import { AIRPORT_BY_CODE } from '../../data/airports';
import { routeStation, type RouteMarket } from '../../data/routes';
import { chainProblem, CUSTOM_STUDY_EXTRA, customMarket, customTruth, parseCustomId, routeBases } from './custom';
import { BAL } from '../core/balance';
import { cashOnly, post } from '../core/ledger';
import { blockMinutes, typeOf } from '../core/perf';
import { chance, gaussian, int } from '../core/rng';
import { requestPause } from '../core/pause';
import { DAY, fmtDay, fmtTime, monthKey } from '../core/time';
import type { CabinLayout } from '../../data/acmiTypes';
import type { Client, GameState, LedgerCat, Minute } from '../core/types';
import { costTotal, passThrough, routeMonthCosts, sectorCost } from './costs';
import { baseFare, cabinFor, chainOf, seasonCode, seasonX, departureDemand, freqPerWeek, localMonth, localToUtc, MARKET_BY_ID, marketOfRoute, paxKgOf, cargoDepX, planMonths, seasonMonths, serviceHours, slotX, usd, weeklyMarket, type Dir } from './model';
import { pushRouteNote } from './notes';
import { checkAchievements } from '../ops/achievements';
import { acmiNetBH, aircraftCostBH, crewAwayCost, crewCostBH } from './pnl';
import { bcCapOf, fifthOf, gateBC, legMarkets, shareSeats } from './stopover';
import { payloadMax } from './sales';
import { netSide } from './side';
import { cancelRotation, fileRotations } from './timetable';
import { LAUNCH_STAGES, type FifthRights, type LaunchStage, type LaunchStageId, type Route, type RouteModel, type RoutePlan, type StudyDepth } from './types';

export type CaseDecision = 'go' | 'change' | 'shelve';

const L = () => BAL.v019.launch;
const ensureNet = (g: GameState) => (g.network ??= { routes: {}, stats: { launched: 0, rotations: 0, pax: 0, swaps: 0, subs: 0, moves: 0, cancels: 0, downgrades: 0 } });
const touch = (g: GameState) => { if (g.network) g.network.rev = (g.network.rev ?? 0) + 1; };

/** Books launch spend: the ledger line and the route's month (launch spend is kept apart from the result). */
function spend(g: GameState, r: Route, cat: LedgerCat, amount: number, stage?: LaunchStageId): void {
  const a = Math.round(amount);
  if (!a) return;
  post(g, cat, -a);
  const p = (r.pnl[monthKeyOf(g.now)] ??= { rev: 0, tickets: 0, cargo: 0, ancillary: 0, direct: 0, acTime: 0, result: 0, pax: 0, seats: 0, bh: 0, sectors: 0, onTime: 0, cargoKg: 0, launch: 0, paxSec: 0 });
  p.launch += a;
  if (stage) {
    const s = r.stages.find((x) => x.id === stage);
    if (s) s.cost += a;
  }
}

const monthKeyOf = (t: Minute) => monthKey(t);

const stage = (r: Route, id: LaunchStageId): LaunchStage => {
  let s = r.stages.find((x) => x.id === id);
  if (!s) {
    s = { id, state: 'todo', cost: 0 };
    r.stages.push(s);
  }
  return s;
};

/** Rolls a stage's days in [lo, hi] on the route's own side stream. */


/** A deterministic client id for a partner (no shift of other ids). */
function partnerClient(g: GameState, m: RouteMarket): string | undefined {
  if (!m.partner) return undefined;
  const id = `cn${m.partner.code}`;
  if (!g.clients[id]) {
    const c: Client = {
      id, name: m.partner.name, kind: 'airline', country: m.partner.country, base: m.to, payReliability: 0.85, lateDays: [5, 25], cleanSensitivity: 0.3,
      relation: 10, jobs: 0, firstJob: null, lastJob: null, log: [], level: 'new', prestige: 1, stars: 1,
    };
    g.clients[id] = c;
  }
  return id;
}

/** The market of an id: the catalogue's, or (v0.19.2) a custom one built from its id's draft. */
export function marketById(marketId: string): RouteMarket | undefined {
  if (MARKET_BY_ID[marketId]) return MARKET_BY_ID[marketId];
  const d = parseCustomId(marketId);
  return d ? customMarket(d) ?? undefined : undefined;
}

/** Why a market can't start a study now (null: it can). */
export function studyBlock(g: GameState, marketId: string): string | null {
  if (!BAL.v019.on) return 'Not available.';
  const m = marketById(marketId);
  if (!m) return 'Unknown market.';
  if (m.closed) return m.closed;
  // v0.19.2 the same city pair counts once, whatever its fuel stops.
  const r = Object.values(g.network?.routes ?? {}).find((x) => x.status !== 'closed' && (x.marketId === marketId || (marketOfRoute(x)?.from === m.from && marketOfRoute(x)?.to === m.to)));
  if (r) return r.status === 'operating' ? 'You fly it already.' : r.status === 'suspended' ? 'It is suspended: resume it on its route page.' : 'You are launching it already.';
  if (g.gameOver) return 'The company has failed.';
  // A route leaves from one of our bases (an airline based at Malta opens no Lisbon market); a study bought before
  // that rule stays good.
  if (!routeBases(g).includes(m.from) && !validStudyFor(g, marketId)) return `We have no base at ${AIRPORT_BY_CODE[m.from]?.city ?? m.from}.`;
  return null;
}

/** §C stage 1: opens a route record and starts its market study. The new route id, or the reason it can't start. */
export function startStudy(g: GameState, marketId: string, depth: StudyDepth, model?: RouteModel): { routeId?: string; why?: string } {
  const why = studyBlock(g, marketId);
  if (why) return { why };
  const m = marketById(marketId)!;
  const N = ensureNet(g);
  N.ownClientId ??= 'own';
  const md: RouteModel = model && m.models.includes(model) ? model : m.model;
  // A shelved study of the same market, still good: reopened straight at the business case (v0.21: the same record).
  const shelved = validStudyFor(g, marketId);
  if (shelved) {
    reopenStudy(g, shelved.id);
    return { routeId: shelved.id };
  }
  const id = `rt${Object.keys(N.routes).length + 1}`;
  const flightNo = 351 + 2 * Object.keys(N.routes).length;
  const cfg = L().study[depth];
  const r: Route = {
    id, marketId, model: md, flightNo, status: 'study', opened: g.now,
    stages: LAUNCH_STAGES.map((s) => ({ id: s, state: 'todo', cost: 0 })),
    series: [], rotations: [], fares: { level: 'market' }, marketing: 'normal', awareness: BAL.v019.demand.awareness.start,
    reputation: Math.min(BAL.v019.rep.start, g.company.reputation.reliable), unearned: 0, pnl: {}, contractIds: [],
  };
  if (md === 'partner') r.partnerId = partnerClient(g, m);
  // v0.19.2 a custom route keeps its market as it was built (a later model change never moves its study).
  if (m.custom) r.custom = structuredClone(m);
  N.routes[id] = r;
  N.stats.launched++;
  const h = netSide(g, `study:${id}`);
  // v0.19.2 a custom pair: the game's own real size for it (fixed per pair, customTruth) and the study's usual noise.
  const truth = m.custom
    ? Math.max(0.3, Math.min(3, customTruth(g, m) * (1 + gaussian(h) * cfg.sigma)))
    : Math.max(0.45, Math.min(1.6, 1 + gaussian(h) * cfg.sigma));
  r.study = { depth, start: g.now, truth };
  const st = stage(r, 'study');
  st.state = 'running';
  st.start = g.now;
  st.due = g.now + int(h, cfg.days[0], cfg.days[1]) * DAY;
  spend(g, r, 'marketing', cfg.cost, 'study');
  pushRouteNote(g, r, 'info', `Market study ordered: ${m.city}`, `${depth === 'desk' ? 'A desk study' : depth === 'full' ? 'A full study' : 'A full study with a survey'}, ${usd(cfg.cost)}. Results by ${fmtDay(st.due)}.`, null, 'silent');
  touch(g);
  return { routeId: id };
}

// ---------- v0.21 studies: where they are and how long they stay good ----------

/** A shelved study of a market still good (its business case can be reopened for free), newest first. Pure. */
export function validStudyFor(g: GameState, marketId: string): Route | undefined {
  return Object.values(g.network?.routes ?? {})
    .filter((x) => x.marketId === marketId && x.status === 'closed' && !!x.study?.est && (x.study.validUntil ?? 0) > g.now && x.stages.find((s) => s.id === 'case')?.state === 'failed')
    .sort((a, b) => b.opened - a.opened || (a.id < b.id ? 1 : -1))[0];
}

/** Reopens a shelved, still-good study at its business case (no new study, no cost). Null when done, else why not. */
export function reopenStudy(g: GameState, routeId: string): string | null {
  const r = g.network?.routes[routeId];
  if (!r) return 'This study no longer exists.';
  if (r.status === 'case') return null;
  if (r.status !== 'closed' || !r.study?.est) return 'This study is not shelved.';
  if ((r.study.validUntil ?? 0) <= g.now) return 'This study has run out: order a new one.';
  const other = Object.values(g.network!.routes).find((x) => x.id !== r.id && x.status !== 'closed' && x.marketId === r.marketId);
  if (other) return other.status === 'operating' ? 'You fly it already.' : 'You are launching it already.';
  r.status = 'case';
  delete r.closed;
  const cs = stage(r, 'case');
  cs.state = 'waiting';
  cs.start = g.now;
  delete cs.setback;
  delete r.told?.caseRemind;
  touch(g);
  return null;
}

export type StudyState = 'running' | 'waiting' | 'shelved' | 'launched' | 'expired' | 'stopped';

/** One study as the Network › Studies list shows it. */
export interface StudyRow {
  routeId: string;
  marketId: string;
  state: StudyState;
  depth: StudyDepth;
  /** Results due (running) or done. */
  due?: Minute;
  done?: Minute;
  validUntil?: Minute;
  est?: { p10: number; p50: number; p90: number };
}

/**
 * v0.21 every market study (player bmwbir591j4cw: "where can I find my shelved studies?"): under way, waiting for the
 * business case, shelved and still good, used for a launch, or run out. Newest first; run-out ones a year back. Pure.
 */
export function studyList(g: GameState): StudyRow[] {
  const out: StudyRow[] = [];
  for (const r of Object.values(g.network?.routes ?? {})) {
    const st = r.study;
    if (!st) continue;
    const cs = r.stages.find((s) => s.id === 'case');
    const valid = (st.validUntil ?? 0) > g.now;
    let state: StudyState;
    if (r.status === 'study') state = 'running';
    else if (r.status === 'case') state = 'waiting';
    else if (r.status === 'closed' && cs?.state === 'failed' && st.est) state = valid ? 'shelved' : 'expired';
    else if (r.status === 'closed') state = st.est && !valid ? 'expired' : 'stopped';
    else state = 'launched';
    if (state === 'expired' && (st.validUntil ?? 0) < g.now - 365 * DAY) continue;
    if (state === 'stopped' && (r.closed ?? 0) < g.now - 365 * DAY) continue;
    // A study reopened later on a newer record replaces its older copy (pre-v0.21 saves kept both).
    out.push({
      routeId: r.id, marketId: r.marketId, state, depth: st.depth, ...(r.stages.find((s) => s.id === 'study')?.due !== undefined ? { due: r.stages.find((s) => s.id === 'study')!.due } : {}),
      ...(st.done !== undefined ? { done: st.done } : {}), ...(st.validUntil !== undefined ? { validUntil: st.validUntil } : {}), ...(st.est ? { est: { ...st.est } } : {}),
    });
  }
  const rank: Record<StudyState, number> = { waiting: 0, running: 1, shelved: 2, launched: 3, stopped: 4, expired: 5 };
  return out.sort((a, b) => rank[a.state] - rank[b.state] || (b.done ?? b.due ?? 0) - (a.done ?? a.due ?? 0) || (a.routeId < b.routeId ? -1 : 1));
}

// ---------- the projection behind the study, the recommendation and the business case ----------

/** v0.21 where a plan's money comes from and goes (12 months, USD): the business case's waterfall. */
export interface MoneyParts {
  tickets: number;
  cargo: number;
  extras: number;
  /** A partner's fee and the costs it reimburses (partner model). */
  fee: number;
  /** Of `fee`: the flying costs a partner repays at cost (fuel, airports, handling, catering, navigation). No profit in them. */
  passed: number;
  fuel: number;
  /** Landing and passenger charges, ground handling, air navigation. */
  airport: number;
  /** Catering and passenger services. */
  service: number;
  /** Ticket selling: agents' commission, booking systems, card fees. */
  sales: number;
  /** An allowance for the year's bad days: delays and passenger compensation, a sub-charter, a rival's fare cut. */
  disruption: number;
  maint: number;
  /** The month's fixed costs: the station, marketing, the sales office. */
  overheads: number;
  /** Aircraft lease and insurance for its hours. */
  aircraft: number;
  /** Crew pay for the hours, nights away and an extra pilot on long days. */
  crew: number;
}

export interface Projection {
  months: { rev: number; cost: number; result: number; pax: number; seats: number }[];
  rev: number;
  cost: number;
  result: number;
  /** Passengers boarded (a through passenger once). */
  pax: number;
  /** v0.23.1 of them, in business class (a cabin change prices their downgrades). */
  paxJ: number;
  seats: number;
  /** v0.21 passengers and seats counted on every sector (the load factor). */
  paxSec: number;
  seatSec: number;
  bh: number;
  sectors: number;
  /** Off-peak and peak loads of a known route (no launch ramp), by the market's own season. */
  lfOff: number;
  lfPeak: number;
  /** v0.25 the share of the peak months' travellers a known route turns away for want of seats. */
  spillPeak: number;
  /** v0.25 seats a flight can sell when the payload (runway, range) caps it below the cabin. */
  sellSeats?: number;
  spill: number;
  /** v0.21 the money by kind, the rotations flown and (a stopover) the average passengers a flight by market. */
  parts: MoneyParts;
  rotations: number;
  /** Passengers a flight (both directions averaged): through, A–B locals, B–C locals; the seats. */
  split?: { thr: number; ab: number; bc: number; seats: number };
}

export const NO_PARTS: MoneyParts = { tickets: 0, cargo: 0, extras: 0, fee: 0, passed: 0, fuel: 0, airport: 0, service: 0, sales: 0, disruption: 0, maint: 0, overheads: 0, aircraft: 0, crew: 0 };

/** The plan's series (dates from `from`). */
export function planSeries(p: RoutePlan, from: Minute, id = '', months: number | null = null): import('./types').RouteSeries {
  return { id, days: p.days, every: p.every, monthly: p.monthly, out: p.out, back: p.back, nights: p.nights, typeId: p.typeId, layout: p.layout ?? 'two-class', from, to: from + 365 * DAY, roll: true, ...(months ? { months } : {}) };
}

/**
 * 12 months of a plan at a demand multiple (the study's P10/P50/P90), from `start`. Pure. A stopover route's three
 * markets share the seats (`fifth`: the B–C rights assumed; default the route's own, else none).
 */
export function project(g: GameState, r: Pick<Route, 'marketId' | 'model' | 'tanker' | 'noCaterer' | 'study' | 'reputation' | 'partnerFeeBH'> & { custom?: RouteMarket; fifth?: FifthRights }, p: RoutePlan, start: Minute, demandX: number, opt: { fifth?: FifthRights; mature?: boolean } = {}): Projection {
  const m = marketOfRoute(r)!;
  const t = typeOf(p.typeId);
  const cab = cabinFor(p.typeId, p.layout ?? 'two-class');
  const freq = freqPerWeek(p);
  const deps = (freq * 52) / 12;
  const outDay = p.monthly ? p.monthly.weekday : lowestDay(p.days);
  const months: Projection['months'] = [];
  const parts: MoneyParts = { ...NO_PARTS };
  const fifth = opt.fifth ?? fifthOf(r);
  const tag = !!m.stopover;
  let bh = 0;
  let sectors = 0;
  let spill = 0;
  let paxSec = 0;
  let seatSec = 0;
  let paxJ = 0;
  let offLf = 0, offN = 0, peakLf = 0, peakN = 0, peakWant = 0, peakSpill = 0;
  // v0.25 peak and off-peak by the market's own season (the three busiest months, the six quietest), not a fixed
  // calendar: a winter-sun route peaks in winter.
  const sIdx = Array.from({ length: 12 }, (_, mo) => (seasonX(m, mo, 'out') + seasonX(m, mo, 'back')) / 2);
  const byS = sIdx.map((v, mo) => [v, mo] as [number, number]).sort((a, b) => b[0] - a[0] || a[1] - b[1]).map((x) => x[1]);
  const peakMonths = new Set(byS.slice(0, 3));
  const offMonths = new Set(byS.slice(6));
  let sp = { thr: 0, ab: 0, bc: 0, n: 0 };
  const blockOf = (dir: Dir) => chainOf(m, dir).slice(1).reduce((a, to, i) => a + blockMinutes(p.typeId, chainOf(m, dir)[i], to), 0);
  const blockOut = blockOf('out');
  const blockBack = blockOf('back');
  const secOut = chainOf(m, 'out').length - 1;
  const secBack = chainOf(m, 'back').length - 1;
  /** Seats a sector can sell: the cabin within its payload. */
  const secCap = (a: string, b: string) => {
    const paxMax = Math.floor(payloadMax(p.typeId, a, b) * 0.92 / paxKgOf(m));
    const j = Math.min(cab.j, paxMax);
    return { j, y: Math.max(0, Math.min(cab.y, paxMax - j)) };
  };
  const capPax = (dir: Dir) => {
    const c = chainOf(m, dir);
    let x = Infinity;
    for (let i = 1; i < c.length; i++) x = Math.min(x, Math.floor(payloadMax(p.typeId, c[i - 1], c[i]) * 0.92 / paxKgOf(m)));
    return x;
  };
  const capOut = Math.min(cab.total, capPax('out'));
  const capBack = Math.min(cab.total, capPax('back'));
  // v0.25 the aircraft time the route P&L will charge: our own aircraft of the type (an owned one costs its insurance,
  // a leased one its rent too), the list rent only when we have none (the case used list rent on owned jets).
  const acAir = fleetAcCostBH(g, p.typeId);
  const acCrew = crewCostBH(p.typeId, cab.total);
  const away = crewAwayCost(g, m, p.typeId, cab.total, p.nights);
  const monthly = routeMonthCosts({ ...(r as Route), status: 'operating', marketing: p.marketing } as Route);
  const fixed = Object.values(monthly).reduce((a, x) => a + (x ?? 0), 0);
  // r3-fix the open fare bucket's mix (Saver / Classic) applies to a tour series too: sales charge the bucket times the
  // tour operators' cut (sales.fareOf), so the case did not count the buckets and ran about a fifth too rich.
  const fareMix = BAL.v019.fares.caseBucket * (r.model === 'tour' ? 1 - BAL.v019.sales.anchors.share * BAL.v019.sales.anchors.fareCut : 1);
  // v0.23.2 a seasonal plan: the months out of season have no flights; the station is kept at half cost, no campaign.
  const flown = planMonths(m, p);
  const resting = flown ? Object.values(routeMonthCosts({ ...(r as Route), status: 'operating', marketing: p.marketing } as Route, true)).reduce((a, x) => a + (x ?? 0), 0) : 0;
  let monthsFlown = 0;
  for (let i = 0; i < 12; i++) {
    const at = start + i * 30.4 * DAY;
    let rev = 0, cost = 0, pax = 0, seats = 0;
    if (flown && !(flown & (1 << new Date(Date.UTC(2000, 0, 1) + at * 60_000).getUTCMonth()))) {
      parts.overheads += resting;
      months.push({ rev: 0, cost: Math.round(resting), result: -Math.round(resting), pax: 0, seats: 0 });
      continue;
    }
    monthsFlown++;
    for (const dir of ['out', 'back'] as Dir[]) {
      const x = {
        freqPerWeek: freq, fares: p.fares, awareness: BAL.v019.demand.awareness.campaign[p.marketing] ?? 0.55, reputation: r.reputation ?? 60,
        hours: serviceHours(m, p.typeId, dir), truth: demandX, slotX: slotX(outDay, p.out), rampX: opt.mature ? 1 : caseRamp(i),
      };
      const d = departureDemand(g, m, at, dir, tag ? { ...x, stop: true } : x);
      const month = new Date(Date.UTC(2000, 0, 1) + at * 60_000).getUTCMonth();
      const c0 = chainOf(m, dir);
      const blks = c0.slice(1).map((to, k) => Math.max(1, blockMinutes(p.typeId, c0[k], to)));
      const blkSum = blks.reduce((a, v) => a + v, 0);
      const fY = (mk: RouteMarket) => baseFareOf(mk, 'Y', month, dir, p.fares) * fareMix;
      const fJ = (mk: RouteMarket) => baseFareOf(mk, 'J', month, dir, p.fares);
      // Passengers on each sector and the ticket money each sector earns.
      let depSpill = 0;
      let secPax: { j: number; y: number }[];
      let secSold: number[];
      let boarded: number;
      let boardedJ: number;
      let tickets: number;
      const legs = tag ? legMarkets(m, dir) : null;
      if (legs && c0.length === 3) {
        const leg = (mk: RouteMarket, a: string, b: string, bc: boolean) => {
          const v = departureDemand(g, mk, at, dir, { ...x, hours: blockMinutes(p.typeId, a, b) / 60 });
          return bc ? gateBC(fifth, v) : v;
        };
        const l1 = leg(legs.first, c0[0], c0[1], !legs.bcSecond);
        const l2 = leg(legs.second, c0[1], c0[2], legs.bcSecond);
        const k1 = secCap(c0[0], c0[1]);
        const k2 = secCap(c0[1], c0[2]);
        const bcSeats = legs.bcSecond ? k2.j + k2.y : k1.j + k1.y;
        const a = shareSeats(d, l1, l2, k1, k2, legs.bcSecond, bcCapOf(fifth, bcSeats));
        spill += a.spill * deps;
        depSpill = a.spill;
        const tT = r.model === 'partner' ? 0 : a.thr.j * fJ(m) + a.thr.y * fY(m);
        const t1 = r.model === 'partner' ? 0 : a.l1.j * fJ(legs.first) + a.l1.y * fY(legs.first);
        const t2 = r.model === 'partner' ? 0 : a.l2.j * fJ(legs.second) + a.l2.y * fY(legs.second);
        tickets = tT + t1 + t2;
        secPax = [{ j: a.thr.j + a.l1.j, y: a.thr.y + a.l1.y }, { j: a.thr.j + a.l2.j, y: a.thr.y + a.l2.y }];
        secSold = [(tT * blks[0]) / blkSum + t1, (tT * blks[1]) / blkSum + t2];
        boarded = a.thr.j + a.thr.y + a.l1.j + a.l1.y + a.l2.j + a.l2.y;
        boardedJ = a.thr.j + a.l1.j + a.l2.j;
        // Out the first sector's locals are A–B travellers; back they are B–C (C–B): keep A–B and B–C apart.
        const ab = legs.bcSecond ? a.l1 : a.l2;
        const bc = legs.bcSecond ? a.l2 : a.l1;
        sp = { thr: sp.thr + a.thr.j + a.thr.y, ab: sp.ab + ab.j + ab.y, bc: sp.bc + bc.j + bc.y, n: sp.n + 1 };
      } else {
        const capT = dir === 'out' ? capOut : capBack;
        const jWant = cab.j ? d.j : 0;
        const yWant = d.y + (cab.j ? 0 : d.j * BAL.v019.demand.jToY);
        const j = Math.min(cab.j, jWant);
        const y = Math.min(Math.max(0, capT - j), cab.y, yWant + Math.max(0, jWant - cab.j) * BAL.v019.demand.jToY);
        spill += Math.max(0, jWant + yWant - j - y) * deps;
        depSpill = Math.max(0, jWant + yWant - j - y);
        tickets = r.model === 'partner' ? 0 : j * fJ(m) + y * fY(m);
        secPax = blks.map(() => ({ j, y }));
        secSold = blks.map((b) => (tickets * b) / blkSum);
        boarded = j + y;
        boardedJ = j;
      }
      const blk = dir === 'out' ? blockOut : blockBack;
      let pass = 0;
      if (r.model === 'partner') for (let k2 = 1; k2 < c0.length; k2++) pass += passThrough(sectorCost(g, r, c0[k2 - 1], c0[k2], p.typeId, null, { j: 0, y: 0, cargoKg: 0, sold: 0 }));
      // The partner's fee: a block-hour price, the flying costs at cost, and (as revenue.partnerFee) a share of the
      // tickets above 70 % full on each sector.
      const PF = BAL.v019.fares.partner;
      const above = r.model === 'partner' ? secPax.reduce((a, q) => a + Math.max(0, q.j + q.y - Math.ceil(cab.total * PF.shareAbove)), 0) * baseFareOf(m, 'Y', month, 'out', p.fares) * PF.share : 0;
      const fee = r.model === 'partner' ? (r.partnerFeeBH ?? (t?.rateBH ?? 5_000) * PF.feeOfRate) * (blk / 60) + pass + above : 0;
      const onBoard = Math.max(...secPax.map((q) => q.j + q.y));
      const cargoKg = Math.min((dir === 'out' ? m.cargo.south + (m.cargo.mail ?? 0) + (m.cargo.ngo ?? 0) + (m.cargo.avi ?? 0) : routeStation(m.to).euCargo ? m.cargo.north + (m.cargo.perish ?? 0) : 0) * cargoDepX(freq), Math.max(0, payloadMax(p.typeId, m.from, m.to) - onBoard * paxKgOf(m)));
      const cargo = cargoKg * (dir === 'out' ? 2.1 : 1.6) * (r.model === 'partner' ? BAL.v019.fares.partner.cargoShare : 1);
      const anc = r.model === 'partner' ? 0 : boarded * m.ancillary;
      rev += (tickets + fee + cargo + anc) * deps;
      // v0.21 the bad days of a year (we carry them on our own tickets; a partner carries its own).
      const bad = r.model === 'partner' ? 0 : (tickets + cargo + anc) * BAL.v019.pnl.caseDisruption;
      cost += bad * deps;
      parts.disruption += bad * deps;
      parts.tickets += tickets * deps;
      parts.fee += fee * deps;
      parts.passed += pass * deps;
      parts.cargo += cargo * deps;
      parts.extras += anc * deps;
      for (let k = 1; k < c0.length; k++) {
        const q = secPax[k - 1];
        const sc = sectorCost(g, r, c0[k - 1], c0[k], p.typeId, null, { j: q.j, y: q.y, cargoKg, sold: secSold[k - 1] });
        cost += costTotal(sc) * deps;
        parts.fuel += sc.fuel * deps;
        parts.airport += (sc.fees + sc.handling + sc.navCharges) * deps;
        parts.service += (sc.catering + sc.paxServices) * deps;
        parts.sales += sc.distribution * deps;
        parts.maint += (sc.maint + sc.reserves) * deps;
        paxSec += (q.j + q.y) * deps;
        seatSec += cab.total * deps;
      }
      pax += boarded * deps;
      paxJ += boardedJ * deps;
      seats += cab.total * deps;
      const lf = secPax.reduce((a, q) => a + q.j + q.y, 0) / Math.max(1, cab.total * secPax.length);
      // v0.25 the loads of a known route (the launch ramp taken out: demand is linear in it), so the study's words
      // describe the route, not its first months.
      const ramp = Math.max(0.05, x.rampX);
      const cap = Math.min(cab.total, dir === 'out' ? capOut : capBack);
      const lfM = Math.min(cap / Math.max(1, cab.total), lf / ramp);
      if (offMonths.has(month)) { offLf += lfM; offN++; }
      if (peakMonths.has(month)) {
        peakLf += lfM;
        peakN++;
        const want = (boarded + depSpill) / ramp;
        peakWant += want;
        peakSpill += Math.max(0, want - cap);
      }
      bh += (blk / 60) * deps;
      sectors += (dir === 'out' ? secOut : secBack) * deps;
    }
    const hrs = ((blockOut + blockBack) / 60) * deps;
    const crew = hrs * acCrew + (away.hotel + away.extraPilot) * deps;
    cost += fixed + hrs * acAir + crew;
    parts.overheads += fixed;
    parts.aircraft += hrs * acAir;
    parts.crew += crew;
    months.push({ rev: Math.round(rev), cost: Math.round(cost), result: Math.round(rev - cost), pax: Math.round(pax), seats: Math.round(seats) });
  }
  const sum = (k: 'rev' | 'cost' | 'result' | 'pax' | 'seats') => months.reduce((a, x) => a + x[k], 0);
  for (const k of Object.keys(parts) as (keyof MoneyParts)[]) parts[k] = Math.round(parts[k]);
  return {
    months, rev: sum('rev'), cost: sum('cost'), result: sum('result'), pax: sum('pax'), paxJ: Math.round(paxJ), seats: sum('seats'), paxSec, seatSec, bh, sectors,
    lfOff: offN ? offLf / offN : 0, lfPeak: peakN ? peakLf / peakN : 0, spillPeak: peakWant > 0 ? peakSpill / peakWant : 0, ...(Math.min(capOut, capBack) < cab.total ? { sellSeats: Math.min(capOut, capBack) } : {}), spill, parts, rotations: Math.round(deps * monthsFlown),
    ...(tag && sp.n ? { split: { thr: sp.thr / sp.n, ab: sp.ab / sp.n, bc: sp.bc / sp.n, seats: cab.total } } : {}),
  };
}

const baseFareOf = baseFare;

/**
 * r3-bal the launch ramp the case expects in its month `i` (the middle of the month on demand.ramp2, as sales.rampOf),
 * with the late-sales dent: tickets usually go on sale under 12 weeks before the first flight (filing).
 */
function caseRamp(i: number): number {
  const R = BAL.v019.demand.ramp2;
  const w = (i + 0.5) * (30.4 / 7);
  return w >= R.weeks ? 1 : (R.from + (1 - R.from) * w / R.weeks) * BAL.v019.demand.ramp.late;
}

/** v0.25 our aircraft of a type that can fly for us (not leased out), by id. Pure. */
export function fleetOfType(g: GameState, typeId: string): GameState['fleet'][string][] {
  return Object.values(g.fleet).filter((a) => a.typeId === typeId && a.status !== 'leasedOut').sort((a, b) => (a.id < b.id ? -1 : 1));
}

/**
 * v0.25 the cabin our aircraft of a type fly (the most common one; null when we have none): a case or an idea is priced
 * on the seats we really have (an all-economy A320 fleet sells no business seats). Pure.
 */
export function fleetLayout(g: GameState, typeId: string): CabinLayout | null {
  const n = new Map<CabinLayout, number>();
  for (const a of fleetOfType(g, typeId)) {
    const l = (a.cabin.layout as CabinLayout | undefined) ?? (a.cabin.j + a.cabin.w > 0 ? 'two-class' : 'all-economy');
    const k: CabinLayout = l === 'vip' || l === 'three-class' ? 'two-class' : l;
    n.set(k, (n.get(k) ?? 0) + 1);
  }
  let best: CabinLayout | null = null;
  for (const [k, v] of n) if (!best || v > (n.get(best) ?? 0)) best = k;
  return best;
}

/**
 * v0.25 the aircraft time a block hour the route P&L will charge for a type: the average over our own aircraft of it
 * (an owned one costs its insurance only, a leased one its rent too), else the type's list rent. Pure.
 */
export function fleetAcCostBH(g: GameState, typeId: string): number {
  const own = fleetOfType(g, typeId);
  if (!own.length) return aircraftCostBH(g, null, typeId);
  return own.reduce((a, ac) => a + aircraftCostBH(g, ac.id, typeId), 0) / own.length;
}

/** v0.25 the business case's warnings about the aircraft: a type we don't have, business seats our aircraft lack. Pure. */
export function fleetWarnings(g: GameState, p: Pick<RoutePlan, 'typeId' | 'layout'>): string[] {
  const own = fleetOfType(g, p.typeId);
  const name = typeOf(p.typeId)?.short ?? p.typeId;
  if (!own.length) return [`We have no ${name}: these figures need one in the fleet before the first flight.`];
  if (cabinFor(p.typeId, p.layout ?? 'two-class').j > 0 && own.every((a) => a.cabin.j + a.cabin.w === 0)) return [`Our ${name} has no business seats: business passengers would be moved to economy on the day.`];
  return [];
}

function lowestDay(mask: number): number {
  for (let i = 0; i < 7; i++) if (mask & (1 << i)) return i;
  return 4;
}

/** The estimated launch cost of a plan (stages not yet paid). */
export function launchCost(g: GameState, r: Pick<Route, 'model' | 'marketId' | 'stages'>, p: RoutePlan): number {
  const m = marketOfRoute(r)!;
  const C = L();
  const paid = r.stages.reduce((a, s) => a + s.cost, 0);
  const md = p.model;
  const stops = new Set([...(m.via ?? []), ...(m.viaBack ?? [])]);
  // v0.21 a stopover: its own station (a share of an outstation's set-up) and the fifth-freedom application.
  const tag = m.stopover ? 1 : 0;
  const rights = C.rights[md].cost + (stops.size - tag) * C.rights.techStop.cost + tag * (BAL.v019.stop.fifthCost + Math.round((m.rightsHard ?? 0) * 20_000));
  const brand = C.brand[md].cost;
  const dist = md === 'partner' ? 0 : C.distribution.cost * (g.network?.distribution ? C.distribution.laterX : 1);
  const camp = md === 'partner' ? 0 : C.campaign.cost[p.marketing] ?? 0;
  const stations = C.stations.outstation + (stops.size - tag) * C.stations.techStop + tag * Math.round(C.stations.outstation * BAL.v019.stop.setupX);
  const fam = captainsFor(g, p.typeId) * (C.familiarisation[routeStation(m.to).cat] ?? 0);
  return Math.round(paid + rights + brand + dist + camp + stations + fam + C.inaugural);
}

/** Captains who would need the airport briefing (the type's captains, at least 6). */
function captainsFor(g: GameState, typeId: string): number {
  const fam = typeOf(typeId)?.family;
  const n = Object.values(g.crew).filter((c) => c.role === 'CPT' && (!fam || (c.ratings ?? []).includes(fam))).length;
  return Math.max(6, Math.min(30, n));
}

export interface BusinessCase {
  p10: CaseBand;
  p50: CaseBand;
  p90: CaseBand;
  breakEvenLf: number;
  paybackWeeks: number | null;
  launchCost: number;
  acmi: number;
  notes: string[];
  firstFlight?: Minute;
  /** v0.21 the likely year's money by kind (the waterfall), rotations a year, off-peak and peak loads. */
  parts?: MoneyParts;
  rotations?: number;
  lfOff?: number;
  lfPeak?: number;
  /** v0.21 what the same block hours would earn on ACMI after aircraft and crew (the route's result is after both). */
  acmiResult?: number;
  /** v0.21 a long day (a third pilot), nights away. */
  crew?: { longDay: boolean; dutyH: number; nights: number; awayPerRotation: number };
  /** v0.21 a stopover route: passengers a flight by market, the rights assumed and their odds, the year with full rights and as a plain fuel stop. */
  stop?: { at: string; split: NonNullable<Projection['split']>; fifth: FifthRights; decided: boolean; odds: { full: number; limited: number; why: string }; withRights: number | null; fuelOnly: number | null };
  /** v0.21 a route with a fuel stop: the year as a stopover there (no B–C rights, and with them). */
  asStop?: { at: string; none: number; full: number; odds: { full: number; limited: number; why: string } } | null;
  verdict?: Verdict;
  /** v0.25 the aircraft the plan needs and we lack: a type we don't have, business seats our aircraft don't have. */
  fleetWarn?: string[];
}
export interface CaseBand { paxPerSector: number; lf: number; rev: number; cost: number; result: number; margin: number }

const bandOf = (x: Projection): CaseBand => ({
  paxPerSector: x.sectors ? Math.round(x.paxSec / Math.max(1, x.sectors)) : 0,
  lf: x.seatSec ? x.paxSec / x.seatSec : 0, rev: Math.round(x.rev), cost: Math.round(x.cost), result: Math.round(x.result),
  // v0.21 a partner repays the flying costs at cost: the margin is on what we earn ourselves (the fee, our cargo share).
  margin: x.rev - x.parts.passed > 0 ? x.result / (x.rev - x.parts.passed) : 0,
});

/** v0.21 the business case's plain verdict and the two or three things that drive it. */
export interface Verdict { word: 'Worth it' | 'Marginal' | 'Not worth it'; tone: 'good' | 'warn' | 'bad'; reasons: string[] }

const k$ = (v: number) => `${v < 0 ? '−' : ''}$${Math.abs(v) >= 1e6 ? `${(Math.abs(v) / 1e6).toFixed(1)}M` : `${Math.round(Math.abs(v) / 1000)}K`}`;

/**
 * v0.21 Worth it / Marginal / Not worth it (player bmwbjlg2n93bp: "I need more indications whether it's worth it"):
 * the likely margin after aircraft and crew, how the year pays back the launch, the weak year's loss, how full the
 * flights must be, ACMI for the same hours, a stopover's rights. Pure.
 */
export function caseVerdict(c: Pick<BusinessCase, 'p10' | 'p50' | 'p90' | 'breakEvenLf' | 'paybackWeeks' | 'launchCost'> & Partial<BusinessCase>): Verdict {
  const m = c.p50.margin;
  const months = c.paybackWeeks !== null ? c.paybackWeeks / 4.35 : null;
  const word: Verdict['word'] = c.p50.result <= 0 || m < 0.03 ? 'Not worth it' : m >= 0.08 && months !== null && months <= 24 && c.p10.result > -c.launchCost ? 'Worth it' : 'Marginal';
  const out: [number, string][] = [];
  const lf = c.p50.lf;
  out.push([word === 'Worth it' ? 3 : 2, c.p50.result > 0 ? `Likely ${k$(c.p50.result)} a year after aircraft and crew: a ${Math.round(m * 100)} % margin.` : `Likely to lose ${k$(-c.p50.result)} a year after aircraft and crew.`]);
  const cushion = lf - c.breakEvenLf;
  if (c.breakEvenLf >= 1) out.push([5, 'Even full flights would not cover the costs (break-even above 100 % full).']);
  else if (cushion < 0) out.push([4, `Flights about ${Math.round(lf * 100)} % full, but it needs ${Math.round(c.breakEvenLf * 100)} % to break even: too many empty seats.`]);
  else out.push([cushion < 0.08 ? 3 : 1, `Flights about ${Math.round(lf * 100)} % full; it breaks even at ${Math.round(c.breakEvenLf * 100)} %${cushion < 0.08 ? ': little room for a bad month' : ''}.`]);
  if (months !== null) out.push([months <= 12 ? 2 : months <= 24 ? 1 : 3, `Pays back the ${k$(c.launchCost)} launch in about ${Math.max(1, Math.round(months))} months.`]);
  else out.push([1, `Never pays back the ${k$(c.launchCost)} launch.`]);
  if (c.p10.result < 0 && c.p50.result > 0) out.push([c.p10.result < -c.launchCost ? 3 : 2, `In a weak year (1 in 10 is worse) it loses ${k$(-c.p10.result)}.`]);
  if (c.acmiResult !== undefined && c.acmiResult > c.p50.result && c.acmiResult > 0) out.push([2, `ACMI work for the same hours would earn about ${k$(c.acmiResult)}, if there is some.`]);
  if (c.stop && !c.stop.decided && c.stop.withRights !== null && c.stop.withRights - c.p50.result > 50_000) out.push([3, `With rights to sell ${c.stop.at} onward seats (${Math.round((c.stop.odds.full + c.stop.odds.limited) * 100)} % chance) it would be ${k$(c.stop.withRights)}.`]);
  if (c.crew?.longDay) out.push([1, `A ${c.crew.dutyH} h day: a third pilot flies along (in the costs).`]);
  out.sort((a, b) => b[0] - a[0]);
  return { word, tone: word === 'Worth it' ? 'good' : word === 'Marginal' ? 'warn' : 'bad', reasons: out.slice(0, 3).map((x) => x[1]) };
}

/**
 * The first flight a Go today plans (r3-fix: the stages' usual length by model, launch.caseLeadWeeks; the filing + 8
 * weeks of sales moves it later when the stages run long).
 */
export function firstFlightOf(g: GameState, r: Pick<Route, 'marketId'>, p: RoutePlan): Minute {
  const m = marketOfRoute(r)!;
  const weeks = L().caseLeadWeeks[p.model] ?? L().caseLeadWeeks.own;
  return firstFromDate(m, p, g.now + weeks * 7 * DAY);
}

/**
 * v0.21 a route with one fuel stop both ways, as a stopover there instead (pure): the likely year with no B–C rights
 * and with full ones, at the study's demand. Null when it has no single shared stop, or the stop has no market.
 */
export function stopoverAlternative(g: GameState, r: Pick<Route, 'marketId' | 'model' | 'reputation' | 'study'> & { custom?: RouteMarket }, p: RoutePlan, start: Minute, x: number): BusinessCase['asStop'] {
  const m = marketOfRoute(r);
  const via = m?.via ?? [];
  const back = m?.viaBack ?? [...via].reverse();
  if (!m || via.length !== 1 || back.length !== 1 || back[0] !== via[0]) return null;
  const sm = customMarket({ from: m.from, to: m.to, stop: via[0] });
  if (!sm?.stopover || sm.closed || chainProblem(sm, p.typeId)) return null;
  const v = { ...r, marketId: sm.id, custom: sm, model: 'own' as RouteModel };
  const plan = { ...p, model: 'own' as RouteModel };
  const none = project(g, v, plan, start, x, { fifth: 'none' }).result;
  const full = sm.stopover.fifth.full + sm.stopover.fifth.limited > 0 ? project(g, v, plan, start, x, { fifth: 'full' }).result : none;
  return { at: via[0], none, full, odds: sm.stopover.fifth };
}

/** §C the first 12 months of a plan at P10 / P50 / P90 (pure): loads, money, break-even, payback, ACMI alternative. */
export function businessCase(g: GameState, routeId: string, draft: RoutePlan): BusinessCase | null {
  const r = g.network?.routes[routeId];
  const est = r?.study?.est;
  if (!r || !est || !marketOfRoute(r) || !typeOf(draft.typeId)) return null;
  const start = firstFlightOf(g, r, draft);
  // The study's view of the truth: its own estimate against its base (the hidden truth is not used here).
  const base = studyBase(g, r);
  const x50 = base ? est.p50 / base : 1;
  const view = { ...r, model: draft.model };
  const P = [est.p10 / Math.max(1, est.p50), 1, est.p90 / Math.max(1, est.p50)].map((k) => project(g, view, draft, start, x50 * k));
  const mid = P[1];
  const cost = launchCost(g, { ...r, model: draft.model }, draft);
  const perMonth = mid.result / 12;
  // v0.21 the load factor counts passengers on every sector they sit on (a stopover's locals fly one of two).
  const breakEvenLf = mid.rev > 0 && mid.seatSec > 0 ? Math.min(1.5, (mid.cost / mid.rev) * (mid.paxSec / mid.seatSec)) : 1;
  const acmi = Math.round(mid.bh * acmiNetBH(g, draft.typeId));
  const notes = deviationNotes(g, r, draft, start, x50);
  const m = marketOfRoute(r)!;
  const cab = cabinFor(draft.typeId, draft.layout ?? 'two-class');
  const away = crewAwayCost(g, m, draft.typeId, cab.total, draft.nights);
  const acmiResult = Math.round(mid.bh * (acmiNetBH(g, draft.typeId) - fleetAcCostBH(g, draft.typeId) - crewCostBH(draft.typeId, cab.total)));
  let stop: BusinessCase['stop'];
  if (m.stopover && mid.split) {
    const decided = r.fifth !== undefined;
    const withRights = decided || m.stopover.fifth.full + m.stopover.fifth.limited <= 0 ? null : project(g, view, draft, start, x50, { fifth: 'full' }).result;
    const fm = customMarket({ from: m.from, to: m.to, via: [m.stopover.at], viaBack: [m.stopover.at] });
    const fuelOnly = fm ? project(g, { ...view, marketId: fm.id, custom: fm }, draft, start, x50).result : null;
    stop = { at: m.stopover.at, split: mid.split, fifth: fifthOf(r), decided, odds: m.stopover.fifth, withRights, fuelOnly };
  }
  const asStop = !m.stopover && r.model !== 'partner' ? stopoverAlternative(g, r, draft, start, x50) : null;
  const band = { p10: bandOf(P[0]), p50: bandOf(mid), p90: bandOf(P[2]) };
  const paybackWeeks = perMonth > 0 ? Math.round((cost / perMonth) * 4.35) : null;
  const crew = { longDay: away.longDay, dutyH: away.dutyH, nights: draft.nights, awayPerRotation: away.hotel + away.extraPilot };
  const verdict = caseVerdict({ ...band, breakEvenLf, paybackWeeks, launchCost: cost, acmiResult, crew, ...(stop ? { stop } : {}) });
  return {
    ...band, breakEvenLf, paybackWeeks,
    launchCost: cost, acmi, notes, firstFlight: start, parts: mid.parts, rotations: mid.rotations, lfOff: mid.lfOff, lfPeak: mid.lfPeak,
    acmiResult, crew, ...(stop ? { stop } : {}), asStop, verdict, fleetWarn: fleetWarnings(g, draft),
  };
}

/**
 * v0.23.1 the study's view of a route's demand as a multiple of its base (the business case's P50; 1 without a study).
 * The hidden truth is not used. Pure.
 */
export function businessCaseX(g: GameState, r: Route): number {
  const est = r.study?.est;
  if (!est) return 1;
  const base = studyBase(g, r);
  return base ? est.p50 / base : 1;
}

/**
 * The demand the study measures against (passengers a week both ways at the recommended plan, truth 1): the one fixed
 * when the study was done (v0.25), else as it reads today.
 */
export function studyBase(g: GameState, r: Route): number {
  return r.study?.base ?? studyBaseNow(g, r);
}

/** The study's base as it reads today (the study's day, a stop changed at the case, an older save's repair). */
export function studyBaseNow(g: GameState, r: Route): number {
  const m = marketOfRoute(r)!;
  const rec = searchPlan(g, r, 1);
  if (!rec) return 0;
  return weeklyBoth(g, m, r, rec.plan, 1);
}

function weeklyBoth(g: GameState, m: RouteMarket, r: Route, p: RoutePlan, x: number): number {
  let n = 0;
  for (const dir of ['out', 'back'] as Dir[]) {
    let sum = 0;
    const legs = legMarkets(m, dir);
    const c = chainOf(m, dir);
    for (let mo = 0; mo < 12; mo++) {
      const at = g.now + mo * 30.4 * DAY;
      const q = { freqPerWeek: freqPerWeek(p), fares: p.fares, awareness: 0.55, reputation: r.reputation, hours: serviceHours(m, p.typeId, dir), truth: x, slotX: 1, rampX: 1 };
      const d = departureDemand(g, m, at, dir, legs ? { ...q, stop: true } : q);
      sum += (d.j + d.y) * freqPerWeek(p);
      // v0.21 a stopover: the study sizes the two legs' local travellers too (B–C as if it could be sold).
      if (legs && c.length === 3) {
        for (const [leg, a, b] of [[legs.first, c[0], c[1]], [legs.second, c[1], c[2]]] as [RouteMarket, string, string][]) {
          const l = departureDemand(g, leg, at, dir, { ...q, hours: blockMinutes(p.typeId, a, b) / 60 });
          sum += (l.j + l.y) * freqPerWeek(p);
        }
      }
    }
    n += sum / 12;
  }
  return n;
}

/** The plans the study tries (frequency × day × time × gauge), best fully costed P50 result first. */
function searchPlan(g: GameState, r: Route, x: number): { plan: RoutePlan; result: number; why: string[]; gauge: 'narrow' | 'mid' | 'big' } | null {
  const m = marketOfRoute(r);
  if (!m) return null;
  const S = BAL.v019.study;
  const thin = m.timetable.pattern === 'monthly' || m.odPerYear < 15_000;
  const pats: { days: number; every: number; monthly?: { nth: number; weekday: number } }[] = [];
  // A partner sets its own frequency (it carries the load risk): its usual timetable.
  const bestDays = [...S.dayX.map((v, i) => [v, i] as [number, number])].sort((a, b) => b[0] - a[0]).map((z) => z[1]);
  if (r.model === 'partner') pats.push(m.timetable.pattern === 'monthly' ? { days: 1 << m.timetable.day, every: 1, monthly: { nth: 1, weekday: m.timetable.day } } : { days: 1 << m.timetable.day, every: 1 });
  else if (thin) {
    pats.push({ days: 1 << m.timetable.day, every: 1, monthly: { nth: 1, weekday: m.timetable.day } });
    for (const e of S.thinEvery) pats.push({ days: 1 << m.timetable.day, every: e });
  } else {
    pats.push({ days: 1 << m.timetable.day, every: 1 });
    pats.push({ days: 1 << bestDays[0], every: 1 });
    pats.push({ days: (1 << bestDays[0]) | (1 << 2), every: 1 });
    pats.push({ days: (1 << 0) | (1 << 2) | (1 << 4), every: 1 });
    // r3-bal four a week and daily too (a trunk market's loads ran at 98–100 % because the study stopped at three).
    if (S.freqs.includes(4)) pats.push({ days: (1 << 0) | (1 << 2) | (1 << 4) | (1 << 6), every: 1 });
    if (S.freqs.includes(7)) pats.push({ days: 127, every: 1 });
  }
  // A type that cannot fly the chain (range, runway) is skipped.
  const canFly = (typeId: string) => {
    const c = [...chainOf(m, 'out'), ...chainOf(m, 'back').slice(1)];
    for (let i = 1; i < c.length; i++) if (payloadMax(typeId, c[i - 1], c[i]) <= 0 || blockMinutes(typeId, c[i - 1], c[i]) <= 0) return false;
    // v0.19.2 nor one whose runway or full-payload range rules a sector out (payloadMax never reaches zero past the range).
    return !chainProblem(m, typeId);
  };
  const gaugeOf = (typeId: string): 'narrow' | 'mid' | 'big' => {
    for (const [gk, ids] of Object.entries(S.gauges) as ['narrow' | 'mid' | 'big', string[]][]) if (ids.includes(typeId)) return gk;
    return typeOf(typeId)?.body !== 'wide' ? 'narrow' : cabinFor(typeId, 'two-class').total >= 300 ? 'big' : 'mid';
  };
  // v0.25 our own types first, in the cabin we fly them (the case was priced on an A321neo with business seats for an
  // all-economy A320 airline); the catalogue's gauges only when none of ours can fly it.
  const ownTypes = [...new Set(Object.values(g.fleet).filter((a) => a.status !== 'leasedOut').map((a) => a.typeId))].sort().filter(canFly);
  const gauges: ['narrow' | 'mid' | 'big', string][] = ownTypes.map((t) => [gaugeOf(t), t]);
  if (!gauges.length) {
    for (const [gk, ids] of Object.entries(S.gauges) as ['narrow' | 'mid' | 'big', string[]][]) {
      const have = ids.find((id) => typeOf(id) && canFly(id));
      if (have) gauges.push([gk, have]);
    }
  }
  let best: { plan: RoutePlan; result: number; why: string[]; gauge: 'narrow' | 'mid' | 'big' } | null = null;
  const times = [m.timetable.out, ...S.times.filter((t) => Math.abs(t - m.timetable.out) > 90)];
  for (const pat of pats) for (const [gk, typeId] of gauges) {
    const layout = fleetLayout(g, typeId) ?? 'two-class';
    // One aircraft flies the series: its rotations must fit the week (block, stops, the turn, nights away).
    const rotH = serviceHours(m, typeId, 'out') + serviceHours(m, typeId, 'back') + (typeOf(typeId)?.turnMin ?? 60) / 60 + m.timetable.nights * 24;
    if (freqPerWeek(pat) > 3 && rotH * freqPerWeek(pat) > 7 * S.maxDayH) continue;
    for (const out of times.slice(0, 2)) {
      const plan: RoutePlan = { model: r.model, days: pat.days, every: pat.every, monthly: pat.monthly, out, back: m.timetable.back, nights: m.timetable.nights, typeId, layout, fares: 'market', marketing: 'normal' };
      const pr = project(g, r, plan, g.now + 120 * DAY, x);
      if (!best || pr.result > best.result) {
        const why = [
          `${Math.round(weeklyMarket(g, m, g.now, 'out') + weeklyMarket(g, m, g.now, 'back'))} travellers a week on the market; our flights would be about ${Math.round(pr.lfOff * 100)} % full off-peak and ${Math.round(pr.lfPeak * 100)} % at peak.`,
          gaugeWords(gk, typeId, pr),
          pat.monthly ? 'A thin market: monthly flights fill.' : `${freqPerWeek(pat) <= 1 ? 'Weekly' : `${freqPerWeek(pat)} a week`} keeps the loads up.`,
        ];
        best = { plan, result: pr.result, why, gauge: gk };
      }
    }
  }
  return best;
}

/** v0.25 the study's sentence on the aircraft's size, from what it carries at peak and off-peak (no contradiction). */
function gaugeWords(gk: 'narrow' | 'mid' | 'big', typeId: string, pr: Projection): string {
  const t = typeOf(typeId)?.short;
  const what = t ? `${/^[AEIOU]/i.test(t) ? 'An' : 'A'} ${t}` : gk === 'narrow' ? 'A narrowbody' : gk === 'big' ? 'A big widebody' : 'A mid-size widebody';
  if (pr.spillPeak >= 0.05) return `${what}${pr.sellSeats !== undefined ? ` can sell only ${pr.sellSeats} seats here (payload), so it` : ''} turns away about ${Math.round(pr.spillPeak * 100)} % of the travellers at peak.`;
  if (pr.lfOff < 0.6) return `${what} carries the peaks; off-peak it flies part empty.`;
  return `${what} fits: full enough off-peak, with room at peak.`;
}

/** UPDATE-0.19 additions 3 (a): the study's recommended timetable and its demand range by month (null before results). */
export function recommendation(g: GameState, routeId: string): {
  freq: number; days: number; every?: number; monthly?: { nth: number; weekday: number }; out: number; back: number; nights: number;
  gauge: 'narrow' | 'mid' | 'big'; typeId: string; layout: CabinLayout; types: string[]; model: RouteModel; why: string[]; months: { p10: number; p50: number; p90: number }[];
} | null {
  const r = g.network?.routes[routeId];
  const est = r?.study?.est;
  if (!r || !est) return null;
  const base = studyBase(g, r);
  const x = base ? est.p50 / base : 1;
  const best = searchPlan(g, r, x);
  const m = marketOfRoute(r);
  if (!best || !m) return null;
  const months = Array.from({ length: 12 }, (_, mo) => {
    let n = 0;
    for (const dir of ['out', 'back'] as Dir[]) n += weeklyMarket(g, m, monthStartOf(g, mo), dir) ;
    const sh = est.p50 / Math.max(1, (weeklyMarket(g, m, g.now, 'out') + weeklyMarket(g, m, g.now, 'back')));
    const p50 = n * sh;
    return { p10: Math.round(p50 * (est.p10 / est.p50)), p50: Math.round(p50), p90: Math.round(p50 * (est.p90 / est.p50)) };
  });
  return {
    freq: freqPerWeek(best.plan), days: best.plan.days, every: best.plan.every, monthly: best.plan.monthly, out: best.plan.out, back: best.plan.back, nights: best.plan.nights,
    gauge: best.gauge, typeId: best.plan.typeId, layout: best.plan.layout ?? 'two-class', types: BAL.v019.study.gauges[best.gauge], model: r.model, why: best.why, months,
  };
}

function monthStartOf(g: GameState, month: number): Minute {
  const y = new Date(Date.UTC(2000, 0, 1) + g.now * 60_000).getUTCFullYear();
  return Math.round((Date.UTC(y, month, 15) - Date.UTC(2000, 0, 1)) / 60_000);
}

/** The recommended plan as a draft for the business case. */
export function caseDraft(g: GameState, routeId: string): RoutePlan | null {
  const r = g.network?.routes[routeId];
  if (!r) return null;
  if (r.plan) return { ...r.plan };
  const rec = recommendation(g, routeId);
  if (!rec) return null;
  // v0.23.2 a market with a dead season is planned for its season (winter sun from the Baltics, summer to the islands).
  const m = marketOfRoute(r);
  return {
    model: r.model, days: rec.days, every: rec.every ?? 1, monthly: rec.monthly, out: rec.out, back: rec.back, nights: rec.nights, typeId: rec.typeId, layout: rec.layout, fares: 'market', marketing: 'normal',
    ...(m && seasonMonths(m) ? { season: true as const } : {}),
  };
}

/** What a draft's deviations from the recommendation do (plain words, pure). */
function deviationNotes(g: GameState, r: Route, d: RoutePlan, start: Minute, x: number): string[] {
  const rec = caseDraft(g, r.id);
  if (!rec) return [];
  const out: string[] = [];
  const a = project(g, r, rec, start, x);
  const b = project(g, r, d, start, x);
  if (freqPerWeek(d) !== freqPerWeek(rec) || !!d.monthly !== !!rec.monthly) out.push(`${freqPerWeek(d) > freqPerWeek(rec) ? 'More flights' : 'Fewer flights'}: off-peak load ${Math.round(a.lfOff * 100)} % → ${Math.round(b.lfOff * 100)} %.`);
  if (d.days !== rec.days && !d.monthly) {
    const dx = slotX(lowestDay(d.days), d.out) / Math.max(0.01, slotX(lowestDay(rec.days), rec.out)) - 1;
    if (Math.abs(dx) >= 0.02) out.push(`${['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][lowestDay(d.days)]}: ${dx > 0 ? '+' : '−'}${Math.round(Math.abs(dx) * 100)} % demand against the recommended day.`);
  }
  if (Math.abs(d.out - rec.out) >= 60) {
    const dx = slotX(lowestDay(d.days), d.out) / Math.max(0.01, slotX(lowestDay(d.days), rec.out)) - 1;
    if (Math.abs(dx) >= 0.01) out.push(`Leaving at ${hh(d.out)}: ${dx > 0 ? '+' : '−'}${Math.round(Math.abs(dx) * 100)} % demand.`);
  }
  const cd = cabinFor(d.typeId, d.layout ?? 'two-class');
  const cr = cabinFor(rec.typeId, rec.layout ?? 'two-class');
  if (!cd.j && cr.j) out.push(`All economy: most government and business travellers go elsewhere (revenue ${Math.round(((b.rev - a.rev) / Math.max(1, a.rev)) * 100)} %).`);
  if (cd.total < cr.total && b.spill > a.spill * 1.2) out.push(`${typeOf(d.typeId) ? `${/^[AEIOU]/i.test(typeOf(d.typeId)!.short) ? 'An' : 'A'} ${typeOf(d.typeId)!.short}` : 'A smaller type'} turns away about ${Math.round((b.spill / Math.max(1, b.pax + b.spill)) * 100)} % of the demand at peak.`);
  if (cd.total > cr.total * 1.15) out.push(`A bigger aircraft: off-peak load ${Math.round(a.lfOff * 100)} % → ${Math.round(b.lfOff * 100)} %.`);
  if (d.fares !== rec.fares) out.push(d.fares === 'low' ? 'Low fares fill more seats for less money a seat.' : 'High fares earn more a seat; fewer people book.');
  if (Math.round(b.result) !== Math.round(a.result) && out.length) out.push(`Against the recommendation: ${b.result >= a.result ? '+' : '−'}${usd(Math.abs(b.result - a.result))} a year.`);
  return out;
}
const hh = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/** §C stage 2: the player's answer to the business case. Null when done, else the reason. */
export function decideCase(g: GameState, routeId: string, decision: CaseDecision, draft?: RoutePlan): string | null {
  const r = g.network?.routes[routeId];
  if (!r) return 'This route no longer exists.';
  if (r.status !== 'case') return 'The business case is not waiting for an answer.';
  const m = marketOfRoute(r)!;
  if (decision === 'change') return null;
  if (decision === 'shelve') {
    r.status = 'closed';
    r.closed = g.now;
    // v0.21 a study stays good 12 months from its results (shelving never stretches it; a study from before v0.21 kept its date).
    if (r.study) r.study.validUntil ??= (r.study.done ?? g.now) + L().validDays * DAY;
    stage(r, 'case').state = 'failed';
    stage(r, 'case').setback = 'Shelved';
    touch(g);
    return null;
  }
  const p = draft ?? caseDraft(g, routeId);
  if (!p || !typeOf(p.typeId)) return 'Choose an aircraft type.';
  // v0.19.2 a type that cannot fly a sector (runway, range) cannot be filed.
  const cant = chainProblem(m, p.typeId);
  if (cant) return cant;
  if (!p.monthly && !(p.days & 127)) return 'Pick at least one day.';
  r.plan = { ...p };
  r.model = m.models.includes(p.model) ? p.model : r.model;
  if (r.model === 'partner') {
    r.partnerId ??= partnerClient(g, m);
    r.partnerFeeBH = Math.round((typeOf(p.typeId)?.rateBH ?? 5_000) * BAL.v019.fares.partner.feeOfRate);
  }
  r.fares.level = p.fares;
  r.marketing = p.marketing;
  r.status = 'launching';
  r.ramp2 = true;
  const cs = stage(r, 'case');
  cs.state = 'done';
  cs.due = g.now;
  // Stages 3, 4, 5 and 9 start together.
  startStage(g, r, 'rights');
  startStage(g, r, 'slots');
  startStage(g, r, 'brand');
  startStage(g, r, 'stations');
  const first = firstFlightOf(g, r, p);
  r.firstFlight = first;
  r.series = [planSeries(p, first - 12 * 60, `${r.id}s1`, planMonths(m, p))];
  pushRouteNote(g, r, 'good', `Launch under way: ${m.city}`, `Permits, slots, the brand and the airport contracts start now. First flight planned ${fmtDay(first)}.`, null);
  touch(g);
  return null;
}

function startStage(g: GameState, r: Route, id: LaunchStageId): void {
  const s = stage(r, id);
  if (s.state !== 'todo') return;
  const m = marketOfRoute(r)!;
  const C = L();
  const h = netSide(g, `stage:${r.id}:${id}`);
  s.state = 'running';
  s.start = g.now;
  const stops = new Set([...(m.via ?? []), ...(m.viaBack ?? [])]);
  let d = 7;
  switch (id) {
    case 'rights': {
      const R = C.rights[r.model];
      // v0.19.2 a custom market's rights regime: a hard one takes longer, costs more and is refused more often.
      const hard = m.rightsHard ?? 0;
      d = Math.round(int(h, R.days[0], R.days[1]) * (1 + hard));
      spend(g, r, 'routeSetup', R.cost + stops.size * C.rights.techStop.cost + Math.round(hard * 20_000), id);
      if (chance(h, C.rights.refused * (m.risk?.coup ? 2 : 1) + hard * 0.12)) {
        s.state = 'failed';
        s.setback = `${m.country} refused the permit.`;
        r.status = 'closed';
        r.closed = g.now;
        pushRouteNote(g, r, 'bad', `Permit refused: ${m.city}`, `${m.country} turned the application down. The money spent is gone; you can try again later with a new study.`, null);
        return;
      }
      if (chance(h, C.rights.delay.p + hard * 0.3)) {
        const extra = int(h, C.rights.delay.days[0], C.rights.delay.days[1]);
        d += extra;
        s.setback = `The ${m.country} permit is delayed: ${Math.round(extra / 7)} more weeks.`;
        s.state = 'delayed';
      } else if (chance(h, C.rights.papers.p)) {
        d += C.rights.papers.days;
        spend(g, r, 'routeSetup', C.rights.papers.cost, id);
        s.setback = 'More documents asked: two more weeks.';
        s.state = 'delayed';
      }
      // v0.21 a stopover: the fifth-freedom answer for the B–C seats (its own side stream: the A–C rolls stay as they were).
      if (m.stopover) {
        const so = m.stopover;
        const f = netSide(g, `fifth:${r.id}`);
        spend(g, r, 'routeSetup', BAL.v019.stop.fifthCost, id);
        const u = chance(f, so.fifth.full) ? 'full' : chance(f, so.fifth.limited / Math.max(0.01, 1 - so.fifth.full)) ? 'limited' : 'none';
        r.fifth = u;
        if (so.fifth.full > 0 && so.fifth.full < 1) d += int(f, BAL.v019.stop.fifthDays[0], BAL.v019.stop.fifthDays[1]);
        const B = AIRPORT_BY_CODE[so.at]?.city ?? so.at;
        const C2 = AIRPORT_BY_CODE[m.to]?.city ?? m.to;
        const word = u === 'full' ? `${B}–${C2} rights granted: we may sell seats between them.` : u === 'limited' ? `${B}–${C2} rights granted with a cap: up to ${Math.round(BAL.v019.stop.limitedShare * 100)} % of the seats.` : so.fifth.full + so.fifth.limited <= 0 ? `${B}–${C2} cannot be sold (no rights possible): ${B} is a stop for our own passengers only.` : `${B}–${C2} rights refused: ${B} is a stop for our own passengers only.`;
        s.setback = s.setback ? `${s.setback} ${word}` : word;
        pushRouteNote(g, r, u === 'none' ? 'warn' : 'good', `${m.city}: stopover rights at ${B}`, word, null, 'silent');
      }
      break;
    }
    case 'slots': {
      d = int(h, C.slots.days[0], C.slots.days[1]);
      const out = r.plan?.out ?? m.timetable.out;
      const bank = (out >= 360 && out < 600) || (out >= 1_020 && out < 1_260);
      if (r.model !== 'tour' && chance(h, bank ? C.slots.peakBank : C.slots.offPeak)) {
        const shift = int(h, C.slots.shift[0], C.slots.shift[1]) * (chance(h, 0.5) ? 1 : -1);
        const at = Math.round((out + shift) / 5) * 5;
        s.setback = `${AIRPORT_BY_CODE[m.from]?.city ?? m.from} offers ${hh((at + 1_440) % 1_440)} instead of ${hh(out)}.`;
        (s as LaunchStage & { offer?: number }).offer = shift;
      }
      break;
    }
    case 'brand': {
      const B = C.brand[r.model];
      d = int(h, B.days[0], B.days[1]);
      spend(g, r, 'routeSetup', B.cost, id);
      if (r.model === 'partner' && chance(h, C.brand.partner.betterFee)) {
        r.partnerFeeBH = Math.round((r.partnerFeeBH ?? 0) * (1 - C.brand.partner.feeUp));
        s.setback = `${m.partner?.name ?? 'The partner'} asked for better terms: our fee is ${Math.round(C.brand.partner.feeUp * 100)} % lower.`;
      }
      break;
    }
    case 'distribution': {
      if (r.model === 'partner') {
        s.state = 'done';
        s.due = g.now;
        return;
      }
      d = int(h, C.distribution.days[0], C.distribution.days[1]);
      const N = g.network!;
      spend(g, r, 'distribution', C.distribution.cost * (N.distribution ? C.distribution.laterX : 1), id);
      if (!N.bspHold && !N.distribution) {
        cashOnly(g, -C.distribution.bspHold);
        N.bspHold = { amount: C.distribution.bspHold, until: g.now + C.distribution.bspMonths * 30 * DAY };
        s.setback = `The BSP asks a bank guarantee: ${usd(C.distribution.bspHold)} held for a year.`;
      }
      break;
    }
    case 'stations': {
      d = int(h, C.stations.days[0], C.stations.days[1]);
      const tag = m.stopover ? 1 : 0;
      spend(g, r, 'routeSetup', C.stations.outstation + (stops.size - tag) * C.stations.techStop + tag * Math.round(C.stations.outstation * BAL.v019.stop.setupX), id);
      const nc = [m.to, ...stops].filter((x) => !routeStation(x).caterer);
      if (nc.length) {
        r.noCaterer = nc;
        s.setback = `No caterer up to standard at ${nc.join(', ')}: meals for the way back are loaded in ${AIRPORT_BY_CODE[m.from]?.city ?? m.from}.`;
      }
      break;
    }
    case 'marketing': {
      if (r.model === 'partner') {
        s.state = 'done';
        s.due = g.now;
        return;
      }
      spend(g, r, 'marketing', C.campaign.cost[r.marketing] ?? 0, id);
      d = Math.max(7, Math.round(((r.firstFlight ?? g.now) - g.now) / DAY) - 3);
      if (r.model === 'own' && chance(h, C.campaign.rival)) {
        const days = int(h, BAL.v019.demand.rivalCut.days[0], BAL.v019.demand.rivalCut.days[1]);
        r.rivalCut = { x: BAL.v019.demand.rivalCut.fare, until: g.now + days * DAY };
        const rv = rivalOf(m);
        s.setback = `${rv.who} ${rv.plural ? 'cut their' : 'cut its'} fares${rv.via ? ` via ${rv.via}` : ''} ${Math.round(BAL.v019.demand.rivalCut.fare * 100)} % for ${Math.round(days / 30)} months.`;
        pushRouteNote(g, r, 'warn', `${rv.who} ${rv.plural ? 'react' : 'reacts'} to our ${m.city} launch`, s.setback, null);
      }
      break;
    }
    case 'familiarisation': {
      const cat = routeStation(m.to).cat;
      spend(g, r, 'training', captainsFor(g, r.plan?.typeId ?? 'b763') * (C.familiarisation[cat] ?? 0), id);
      d = cat === 'C' ? 21 : 10;
      break;
    }
    case 'inaugural': {
      d = 0;
      break;
    }
    default:
      d = 7;
  }
  s.due = g.now + d * DAY;
}

/**
 * v0.25 the rival that answers a launch: the nonstop one, else the first one-stop one by its hub ('Turkish Airlines'
 * via Istanbul), else the airlines connecting there. Pure.
 */
export function rivalOf(m: Pick<RouteMarket, 'competitors'>): { who: string; via?: string; plural?: true } {
  const ns = m.competitors.find((c) => c.stops === 0);
  if (ns) return { who: ns.name };
  const one = m.competitors.find((c) => c.stops >= 1);
  if (!one) return { who: 'A rival' };
  const k = one.name.indexOf(' via ');
  const via = one.via ? AIRPORT_BY_CODE[one.via]?.city ?? one.via : k > 0 ? one.name.slice(k + 5) : undefined;
  if (k > 0 && /^connections$/i.test(one.name.slice(0, k))) return { who: 'The airlines connecting', ...(via ? { via } : {}), plural: true };
  return { who: k > 0 ? one.name.slice(0, k) : one.name, ...(via ? { via } : {}) };
}

/** The study's accuracy (± share at one sigma-ish) at a depth; a custom pair adds CUSTOM_STUDY_EXTRA. */
export function studyAccuracy(depth: StudyDepth, custom: boolean, g?: GameState): number {
  return (L().study[depth].accuracy + (custom ? CUSTOM_STUDY_EXTRA[depth] : 0)) * (g ? plannerStudyX(g) : 1);
}

/** v0.21 a network planner on the team reads a study better: its spread shrinks with the planner's skill. */
export function plannerStudyX(g: GameState): number {
  const h = g.heads?.netPlanner;
  return h?.hired && h.on ? 1 - BAL.v019.planner.studyGain * h.hired.skill : 1;
}

/** Daily: moves the route's launch stages along (durations, costs, setbacks), opens sales, reminds of decisions. */
export function stepLaunch(g: GameState, r: Route): void {
  const m = marketOfRoute(r);
  if (!m) return;
  const C = L();
  if (r.status === 'study') {
    const st = stage(r, 'study');
    if (st.due !== undefined && g.now >= st.due && r.study) {
      st.state = 'done';
      const base = studyBaseNow(g, r);
      r.study.base = base;
      // v0.19.2 an unresearched (custom) pair: a little less accurate at every depth.
      const acc = studyAccuracy(r.study.depth, !!m.custom, g);
      const err = 1 + gaussian(netSide(g, `studyErr:${r.id}`)) * acc * 0.6;
      const p50 = Math.max(10, Math.round(base * r.study.truth * err));
      r.study.est = { p10: Math.max(1, Math.round(p50 * (1 - 1.28 * acc))), p50, p90: Math.round(p50 * (1 + 1.28 * acc)) };
      r.study.done = g.now;
      r.study.validUntil = g.now + C.validDays * DAY;
      r.status = 'case';
      const cs = stage(r, 'case');
      cs.state = 'waiting';
      cs.start = g.now;
      pushRouteNote(g, r, 'warn', `Study done: ${m.city}`, `About ${p50.toLocaleString('en-US')} travellers a week both ways could fly with us (${r.study.est.p10.toLocaleString('en-US')}–${r.study.est.p90.toLocaleString('en-US')}). The business case waits for your answer.`, null, 'routeStudy');
      // v0.23.1 a pop-up and the clock stops (Settings › Pause for network news; report bmwdo5trhi3sl).
      requestPause('network');
      // v0.22 the first finished study earns the network planner at once (the daily check ran before this handler: the
      // business case's "Hire a network planner" led to a head still locked until the next day).
      checkAchievements(g, { ids: ['firstStudy'] });
    }
    return;
  }
  if (r.status === 'case') {
    const cs = stage(r, 'case');
    if (cs.start !== undefined && g.now - cs.start >= C.remindDays * DAY) pushRouteNote(g, r, 'info', `${m.city}: the business case still waits`, 'Go, change the plan or shelve it (the study stays good for a year).', 'caseRemind');
    return;
  }
  if (r.status !== 'launching' && r.status !== 'onSale') return;
  const S = (id: LaunchStageId) => stage(r, id);
  for (const s of r.stages) {
    if ((s.state === 'running' || s.state === 'delayed') && s.due !== undefined && g.now >= s.due) {
      s.state = 'done';
      // v0.25 the campaign's note says what it reached (the rival's cut was told when it came).
      if (s.id === 'marketing') pushRouteNote(g, r, 'info', `${m.city}: ${STAGE_WORD[s.id]} done`, `About ${Math.round(r.awareness * 100)} % of travellers on the route now know we fly it.`, `done:${s.id}`, 'silent');
      else if (s.setback && s.id !== 'slots') pushRouteNote(g, r, 'info', `${m.city}: ${STAGE_WORD[s.id]} done`, s.setback, `done:${s.id}`, 'silent');
    }
  }
  // Slots: an offer 1–3 h off waits for the player (taken as given after 14 days).
  const sl = S('slots') as LaunchStage & { offer?: number };
  if (sl.state === 'done' && sl.offer !== undefined) {
    sl.state = 'waiting';
    pushRouteNote(g, r, 'warn', `${m.city}: slot offered`, `${sl.setback} Accept it, or ask again (another 1–3 weeks).`, `slot:${sl.start}`);
  }
  if (sl.state === 'waiting' && sl.due !== undefined && g.now - sl.due >= C.autoAcceptDays * DAY) answerSlot(g, r.id, true);
  // Distribution after the brand (own brand and tour operator).
  if (S('brand').state === 'done' && S('distribution').state === 'todo') startStage(g, r, 'distribution');
  // Filing when rights, slots and distribution are in: sales open.
  const ready = S('rights').state === 'done' && S('slots').state === 'done' && S('distribution').state === 'done';
  if (ready && S('filing').state === 'todo') {
    const f = S('filing');
    f.state = 'done';
    f.start = g.now;
    f.due = g.now;
    g.network!.distribution ??= g.now;
    // The first flight: the planned date, or 8 weeks of sales from now if the stages ran late.
    const p = r.plan;
    const earliest = g.now + C.filing.minDays * DAY;
    if (p && (r.firstFlight ?? 0) < earliest) {
      r.firstFlight = firstFromDate(m, p, earliest);
      r.series = [planSeries(p, r.firstFlight - 12 * 60, r.series[0]?.id ?? `${r.id}s1`, planMonths(m, p))];
    }
    r.status = 'onSale';
    r.slots = { held: 0, flown: 0, season: seasonCode(r.firstFlight ?? g.now).code };
    fileRotations(g, r);
    r.slots.held = r.rotations.filter((x) => x.dep < (r.firstFlight ?? g.now) + 210 * DAY).length;
    startStage(g, r, 'marketing');
    startStage(g, r, 'familiarisation');
    pushRouteNote(g, r, 'good', `${m.city}: tickets on sale`, `The timetable is filed and sales are open. First flight ${r.firstFlight ? `${fmtDay(r.firstFlight)} ${fmtTime(r.firstFlight)} UTC` : 'soon'}.`, null, 'routeLaunched');
    requestPause('network');
  }
  // Awareness: the campaign lifts it towards its level, marketing keeps it, it fades with time.
  const A = BAL.v019.demand.awareness;
  const target = r.status === 'onSale' && S('marketing').state !== 'todo' ? A.campaign[r.marketing] ?? 0.55 : A.start;
  if (r.awareness < target) r.awareness = Math.min(target, r.awareness + (target - A.start) / 60);
}

/** Operating routes: awareness kept by the monthly marketing, fading without (daily). */
export function stepAwareness(r: Route): void {
  const A = BAL.v019.demand.awareness;
  const fade = Math.pow(0.5, 1 / A.halfLife);
  const keep = (A.perMonth[r.marketing] ?? 0.08) / 30;
  r.awareness = Math.max(0.05, Math.min(0.95, r.awareness * fade + keep));
}

/** The first departure on the plan's day on or after `from`; a seasonal plan (v0.23.2) waits for its season. */
function firstFromDate(m: RouteMarket, p: RoutePlan, from: Minute): Minute {
  const months = planMonths(m, p);
  for (let d = 0; d < (months ? 320 : 60); d++) {
    const at = localToUtc(m.from, from + d * DAY, p.out);
    if (months && !(months & (1 << localMonth(m.from, at)))) continue;
    const dt = new Date(Date.UTC(2000, 0, 1) + at * 60_000);
    const wd = (dt.getUTCDay() + 6) % 7;
    if (p.monthly ? wd === p.monthly.weekday && dt.getUTCDate() <= 7 : p.days & (1 << wd)) return at;
  }
  return localToUtc(m.from, from, p.out);
}

const STAGE_WORD: Record<LaunchStageId, string> = {
  study: 'market study', case: 'business case', rights: 'traffic rights and permits', slots: 'slots', brand: 'brand and partner', distribution: 'distribution',
  filing: 'timetable filing', marketing: 'launch campaign', stations: 'station contracts', familiarisation: 'crew briefings', inaugural: 'first flight',
};

/** §C stage 4: the slot offered 1–3 h off the asked time: accept (the timetable moves) or ask again. */
export function answerSlot(g: GameState, routeId: string, accept: boolean): string | null {
  const r = g.network?.routes[routeId];
  const s = r?.stages.find((x) => x.id === 'slots') as (LaunchStage & { offer?: number }) | undefined;
  if (!r || !s || s.state !== 'waiting') return 'No slot offer is waiting.';
  if (accept) {
    const shift = s.offer ?? 0;
    if (r.plan) r.plan.out = (r.plan.out + shift + 1_440) % 1_440;
    for (const x of r.series) x.out = (x.out + shift + 1_440) % 1_440;
    delete s.offer;
    s.state = 'done';
    s.setback = `Slot accepted: leaves ${hh(r.plan?.out ?? 0)} local.`;
  } else {
    delete s.offer;
    s.state = 'running';
    s.setback = 'Asked again.';
    s.due = g.now + int(netSide(g, `slot:${r.id}:${g.now}`), BAL.v019.launch.slots.days[0], BAL.v019.launch.slots.days[1]) * DAY;
  }
  touch(g);
  return null;
}

/** Stops a launch (or closes a route): money spent stays spent; tickets sold are refunded. Null when done. */
export function stopLaunch(g: GameState, routeId: string): string | null {
  const r = g.network?.routes[routeId];
  if (!r || r.status === 'closed') return 'This route is already closed.';
  for (const rot of [...r.rotations]) if (rot.status === 'planned' || rot.status === 'flights') cancelRotation(g, rot.id, 'Route closed');
  r.status = 'closed';
  r.closed = g.now;
  for (const c of r.contractIds) if (g.contracts[c] && g.contracts[c].status === 'active') g.contracts[c].status = 'completed';
  touch(g);
  return null;
}

/** The inaugural: called when the route's first sector leaves. */
export function inaugural(g: GameState, r: Route): void {
  const s = stage(r, 'inaugural');
  if (s.state === 'done') return;
  s.state = 'done';
  s.start = g.now;
  s.due = g.now;
  spend(g, r, 'marketing', L().inaugural, 'inaugural');
  for (const x of r.stages) if (x.state === 'running' || x.state === 'delayed') x.state = 'done';
  const m = marketOfRoute(r);
  pushRouteNote(g, r, 'good', `First flight to ${m?.city ?? r.marketId}`, 'A water salute at the gate, the press and guests on board.', 'inaugural');
}

/**
 * Dev and bots: a route straight to operating (study done, Go on the recommended plan, every stage done, on sale
 * with bookings as if sold for months). Returns the route id or the reason.
 */
export function devLaunchRoute(g: GameState, marketId: string, aircraftId?: string): string {
  const res = startStudy(g, marketId, 'full');
  if (!res.routeId) return res.why ?? 'no';
  const r = g.network!.routes[res.routeId];
  const m = marketOfRoute(r)!;
  r.study!.est = { p10: 200, p50: 300, p90: 400 };
  const base = studyBaseNow(g, r);
  r.study!.est = { p10: Math.round(base * 0.8), p50: Math.round(base), p90: Math.round(base * 1.2) };
  r.study!.base = base;
  r.status = 'case';
  const p = caseDraft(g, r.id);
  if (!p) return 'no plan';
  const ac = aircraftId ? g.fleet[aircraftId] : undefined;
  if (ac) {
    p.typeId = ac.typeId;
    p.layout = ac.cabin.layout as CabinLayout;
  }
  decideCase(g, r.id, 'go', p);
  for (const s of r.stages) if (s.id !== 'inaugural') { s.state = 'done'; s.due ??= g.now; }
  r.status = 'onSale';
  r.awareness = BAL.v019.demand.awareness.campaign[r.marketing] ?? 0.55;
  r.firstFlight = firstFromDate(m, p, g.now + 3 * DAY);
  r.series = [planSeries(p, r.firstFlight - 12 * 60, `${r.id}s1`, planMonths(m, p))];
  if (ac) r.series[0].tail = ac.id;
  r.slots = { held: 0, flown: 0, season: seasonCode(r.firstFlight).code };
  g.network!.distribution ??= g.now;
  fileRotations(g, r);
  r.slots.held = r.rotations.length;
  touch(g);
  return r.id;
}
