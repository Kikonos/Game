// v0.19 route rotations an ACMI job wants the aircraft of (UPDATE-0.19.md §H.2, §H.4). Four choices per rotation with
// their real money: swap the aircraft (a trip move; business passengers who lose their seat are refunded at departure),
// sub-charter (no penalty, only the price; we stop paying the flying costs), move it clear of the job (a small cost) or
// cancel it (refunds, re-protection, the margin lost). The offer dialog lists them; signing applies the player's choice
// or the cheapest.

import { subcharterFlights } from '../core/entities';
import { post } from '../core/ledger';
import { typeOf } from '../core/perf';
import { DAY, fmtDay } from '../core/time';
import type { GameState, Minute } from '../core/types';
import { relinkPositioning } from '../contracts/schedule';
import { autoRoster } from '../crew/roster';
import { moveTrip, quoteTripMove } from '../ops/tripMove';
import { costTotal, routeLegCost, sectorPax } from './costs';
import { marketOfRoute, usd } from './model';
import { fareFor } from './sales';
import { candidates, cancelRotation, findRotation, moveRotation, quoteCancelRotation, quoteMoveRotation, rotationSchedule, subCost, subRival } from './timetable';
import type { RouteChoice, Rotation, Route } from './types';
import { BAL } from '../core/balance';

export interface RouteConflict {
  rotId: string;
  routeId: string;
  dep: Minute;
  /** One line: "YU351 LIS–OXB Fri 14 Nov". */
  label: string;
}

export interface RotationChoiceQuote {
  choice: RouteChoice;
  ok: boolean;
  /** Net money effect (negative = a cost). */
  net: number;
  why: string;
  /** Swap: the aircraft; move: the shift (minutes). */
  targetId?: string;
  delta?: number;
}

const live = (g: GameState, rot: Rotation) => rot.sectors.map((s) => (s.flightId ? g.flights[s.flightId] : undefined)).filter((f) => !!f && f.status === 'scheduled');

/** §H.2 our rotations on an aircraft that touch a window (pure). */
export function routeConflicts(g: GameState, aircraftId: string, from: Minute, to: Minute): RouteConflict[] {
  const out: RouteConflict[] = [];
  const turn = typeOf(g.fleet[aircraftId]?.typeId ?? '')?.turnMin ?? 60;
  for (const route of Object.values(g.network?.routes ?? {})) {
    for (const rot of route.rotations) {
      if (rot.status !== 'flights' || rot.aircraftId !== aircraftId) continue;
      const fl = live(g, rot);
      if (!fl.length || fl.length < rot.sectors.length) continue;
      const a = Math.min(...fl.map((f) => f!.std)) - turn;
      const b = Math.max(...fl.map((f) => f!.sta)) + turn;
      if (a < to && b > from) {
        const m = marketOfRoute(route);
        out.push({ rotId: rot.id, routeId: route.id, dep: rot.dep, label: `${fl[0]!.no} ${m ? `${m.from}–${m.to}` : route.marketId} ${fmtDay(rot.dep)}` });
      }
    }
  }
  return out.sort((x, y) => x.dep - y.dep);
}

/** The rotation's direct flying costs we stop paying when a rival flies it or it is cancelled (USD). */
function flyingCost(g: GameState, rot: Rotation): number {
  let c = 0;
  for (const f of live(g, rot)) {
    const ac = f!.aircraftId ? g.fleet[f!.aircraftId] : undefined;
    if (!ac) continue;
    const x = routeLegCost(g, f!, ac);
    c += costTotal(x) - x.distribution;
  }
  return Math.round(c);
}

/** The rotation's revenue still to come (tickets held, cargo and extras at the catalogue's rates). */
function revenueOf(_g: GameState, route: Route, rot: Rotation): number {
  const m = marketOfRoute(route);
  let r = 0;
  for (const s of rot.sectors) r += s.sold ?? 0;
  const pax = sectorPax(rot.sectors[0]);
  r += (pax.j + pax.y) * (m?.ancillary ?? 20) * 2;
  r += ((m?.cargo.south ?? 0) * 2 + (m?.cargo.north ?? 0) * 1.4);
  return Math.round(r);
}

/** The downgrade cost of flying a rotation on an aircraft with fewer business seats than sold. */
function downgradeCost(g: GameState, route: Route, rot: Rotation, targetId: string): { n: number; cost: number } {
  const ac = g.fleet[targetId];
  if (!ac) return { n: 0, cost: 0 };
  const capJ = ac.cabin.j + ac.cabin.w;
  const n = Math.max(0, ...rot.sectors.map((s) => s.bookedJ - capJ));
  if (!n) return { n: 0, cost: 0 };
  const P = BAL.v019.pax;
  const share = marketOfRoute(route)?.eu261 === 'long' ? P.downgrade[2] : P.downgrade[1];
  return { n, cost: Math.round(n * (fareFor(g, route, 'J', rot.dep) * share + P.voucher * P.voucherCost) * 2) };
}

/** §H.2 the four quotes for a rotation (pure). `aircraftId`/`from`/`to`: the job that wants the aircraft. */
export function rotationChoices(g: GameState, rotId: string, opts: { aircraftId?: string; from?: Minute; to?: Minute } = {}): RotationChoiceQuote[] {
  const at = findRotation(g, rotId);
  if (!at) return [];
  const { route, rot } = at;
  const out: RotationChoiceQuote[] = [];
  const first = live(g, rot)[0];
  const from = opts.from ?? rot.dep;
  const to = opts.to ?? rot.dep;
  const s = route.series.find((x) => x.id === rot.seriesId) ?? route.series[0];
  // Swap: another free aircraft, the trip-move money plus the product effect.
  let swap: RotationChoiceQuote = { choice: 'swap', ok: false, net: 0, why: 'No other aircraft is free for it.' };
  if (first) {
    for (const id of candidates(g, route, rot).filter((x) => x !== (opts.aircraftId ?? rot.aircraftId))) {
      const q = quoteTripMove(g, first.id, id);
      if (!q.ok) continue;
      const d = downgradeCost(g, route, rot, id);
      const net = Math.round(q.net - d.cost);
      const why = `${g.fleet[id].reg}${d.n ? `: ${d.n} business passenger${d.n === 1 ? '' : 's'} downgraded, refunds about ${usd(d.cost)}` : ': same cabin'}`;
      if (!swap.ok || net > swap.net) swap = { choice: 'swap', ok: true, net, why, targetId: id };
    }
  }
  out.push(swap);
  // Sub-charter: the rival's price, and the flying costs we no longer pay. No penalty.
  const rv = s ? subRival(g, s.typeId) : undefined;
  if (rv && first && s) {
    const times = rotationSchedule(g, route, rot);
    const blk = times.reduce((a, x) => a + (x.sta - x.std), 0);
    const cost = subCost(g, s.typeId, blk, rot.dep);
    const saved = flyingCost(g, rot);
    out.push({ choice: 'sub', ok: true, net: saved - cost, why: `${g.rivals.find((r) => r.id === rv)?.name ?? 'A rival'} flies it for ${usd(cost)}; no penalty` });
  } else out.push({ choice: 'sub', ok: false, net: 0, why: 'No operator has a suitable aircraft.' });
  // Move: clear of the job, later or earlier, within a few days.
  const times = rotationSchedule(g, route, rot);
  const span = times[times.length - 1].sta - times[0].std;
  const turn = typeOf(s?.typeId ?? '')?.turnMin ?? 60;
  const tries = [to + turn + 60 - times[0].std, from - turn - 60 - span - times[0].std].map((d) => Math.ceil(d / (DAY / 4)) * (DAY / 4)).filter((d) => d && Math.abs(d) <= 4 * DAY);
  let move: RotationChoiceQuote = { choice: 'move', ok: false, net: 0, why: 'No time nearby clears the job.' };
  for (const d of tries.sort((a, b) => Math.abs(a) - Math.abs(b))) {
    const q = quoteMoveRotation(g, rotId, d);
    if (!q.ok) continue;
    move = { choice: 'move', ok: true, net: -q.cost, why: `Leaves ${fmtDay(rot.dep + d)} (${d > 0 ? 'later' : 'earlier'}); passengers rebooked`, delta: d };
    break;
  }
  out.push(move);
  // Cancel: refunds and re-protection, and the margin lost.
  const cq = quoteCancelRotation(g, rotId);
  if (cq.ok) {
    const lost = revenueOf(g, route, rot) - flyingCost(g, rot);
    out.push({ choice: 'cancel', ok: true, net: -cq.cost - Math.max(0, lost), why: `${cq.pax} passengers refunded or rebooked; the slot counts as not flown` });
  } else out.push({ choice: 'cancel', ok: false, net: 0, why: cq.why ?? 'It cannot be cancelled now.' });
  return out;
}

/** The default choice: the best money effect among those that work. */
export function bestChoice(qs: RotationChoiceQuote[]): RotationChoiceQuote | null {
  const ok = qs.filter((q) => q.ok);
  return ok.length ? ok.reduce((a, b) => (b.net > a.net ? b : a)) : null;
}

/** §H.2 applies one choice. False when it could not be applied. */
export function resolveRotation(g: GameState, rotId: string, choice: RouteChoice, expect?: { aircraftId?: string; from?: Minute; to?: Minute; net?: number }): boolean {
  const at = findRotation(g, rotId);
  if (!at) return false;
  const { route, rot } = at;
  const q = rotationChoices(g, rotId, expect ?? {}).find((x) => x.choice === choice);
  if (!q?.ok) return false;
  const was = rot.aircraftId;
  if (choice === 'swap') {
    const first = live(g, rot)[0];
    if (!first || !q.targetId) return false;
    const r = moveTrip(g, first.id, q.targetId);
    if (!r.ok) return false;
    rot.aircraftId = q.targetId;
    rot.notice = g.now;
    g.network!.stats.swaps++;
  } else if (choice === 'sub') {
    const s = route.series.find((x) => x.id === rot.seriesId) ?? route.series[0];
    const rv = s ? subRival(g, s.typeId) : undefined;
    if (!rv || !s) return false;
    const times = rotationSchedule(g, route, rot);
    const cost = subCost(g, s.typeId, times.reduce((a, x) => a + (x.sta - x.std), 0), rot.dep);
    const ids = live(g, rot).map((f) => f!.id);
    subcharterFlights(g, ids, rv);
    post(g, 'subcharter', -cost);
    rot.operatedBy = rv;
    rot.aircraftId = null;
    g.network!.stats.subs++;
    const p = route.pnl;
    void p;
  } else if (choice === 'move') {
    if (!q.delta || !moveRotation(g, rotId, q.delta)) return false;
  } else if (!cancelRotation(g, rotId, 'Cancelled for other work')) return false;
  if (was && g.fleet[was]) {
    relinkPositioning(g, was);
    autoRoster(g, { aircraftIds: [was] });
  }
  if (g.network) g.network.rev = (g.network.rev ?? 0) + 1;
  return true;
}

/** Signing a job: frees the aircraft of our rotations in its window (the player's choices, else the cheapest). */
export function clearForJob(g: GameState, aircraftId: string, from: Minute, to: Minute, choices: Record<string, RouteChoice> = {}): string | null {
  for (const c of routeConflicts(g, aircraftId, from, to)) {
    const qs = rotationChoices(g, c.rotId, { aircraftId, from, to });
    const want = choices[c.rotId];
    const pick = (want && qs.find((q) => q.choice === want && q.ok)) || bestChoice(qs);
    if (!pick) return `${c.label}: no way to free the aircraft from it`;
    if (!resolveRotation(g, c.rotId, pick.choice, { aircraftId, from, to })) return `${c.label}: could not ${pick.choice === 'sub' ? 'sub-charter' : pick.choice} it`;
  }
  return null;
}
