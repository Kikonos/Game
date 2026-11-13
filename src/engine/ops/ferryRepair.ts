// v0.23.2 hotfix (player report, save "Malteser", 27 Jul 2027): 9H-VZH sat at Quito for days on its way from Santiago
// to a job in London. Its ferry crew were at Quito, rested; each time the move was planned again (a London flight
// cancelled, the next one out of another airport) its departure was put a crew ticket's lead from now (46 h), so it never
// left, and the job's flights were cancelled day after day (contracts/schedule.ts crewThere has the fix).
//
// Once, on loading an older save (Stats.ferryRefund), for each aircraft stuck like that:
// 1. the ferry is planned again to leave as soon as its crew can fly it;
// 2. the job's flights it still cannot reach are taken off at no charge, and those pushed late that it can reach go
//    back to their own times;
// 3. the compensation charged for the flights cancelled while it sat there is given back (the ledger's 'refund' line),
//    with the client's relation, and one Inbox line says so.
// A new game and a save of this version never run it.

import { AIRPORT_BY_CODE } from '../../data/airports';
import { BAL } from '../core/balance';
import { flightsOf, retimeFlight } from '../core/entities';
import { post } from '../core/ledger';
import { pushMessage } from '../core/messages';
import { DAY, fmtDateTime, fmtDay } from '../core/time';
import type { Aircraft, Contract, Flight, GameState, Minute } from '../core/types';
import { route, routeMinutes } from '../contracts/plan';
import { bumpClient } from '../contracts/relations';
import { relinkPositioning } from '../contracts/schedule';
import { cancelLegs, lateCap } from './flights';
import { isRevenue, turnOf } from './util';

/** On the ground this long with the move out still to come: stuck. */
const STUCK_MIN = DAY;
/** A flight put back to an earlier time leaves no sooner than this from now (its crew's notice). */
const NOTICE = 12 * 60;
/** The longest night stop between two ferry days of one move. */
const NIGHT_MAX = 36 * 60;
/** Why a flight was cancelled when the aircraft was not there. */
const AWAY = /Late inbound aircraft|Aircraft out of position/;

export interface StuckFerry {
  ac: Aircraft;
  contract: Contract;
  /** Where it sits and since when. */
  at: string;
  since: Minute;
  /** The job's flights cancelled (and charged) while it sat there. */
  lost: Flight[];
  money: number;
}

const sched = (f: Flight): Minute => f.schedStd ?? f.std;
const city = (code: string): string => AIRPORT_BY_CODE[code]?.city ?? code;
const usd = (v: number): string => (v >= 1e6 ? '$' + (v / 1e6).toFixed(2) + 'M' : '$' + Math.round(v / 1e3) + 'K');

/** The scheduled empty legs that lead on from where the aircraft stands, in order. Pure. */
function wayOut(g: GameState, ac: Aircraft): Flight[] {
  const out: Flight[] = [];
  let loc = ac.at;
  for (const f of flightsOf(g, ac.id)) {
    if (f.status !== 'scheduled' || f.from !== loc || (f.kind !== 'positioning' && f.kind !== 'ferry')) continue;
    // One move: its ferry days a night stop apart, not the empty legs of the weeks after.
    if (out.length && f.std - out[out.length - 1].sta > NIGHT_MAX) break;
    out.push(f);
    loc = f.to;
  }
  return out;
}

/**
 * Aircraft on the ground away for a day or more, the empty move to a live job still to leave, and flights of that job
 * cancelled meanwhile because the aircraft was not there. Pure.
 */
export function stuckFerries(g: GameState): StuckFerry[] {
  const out: StuckFerry[] = [];
  for (const ac of Object.values(g.fleet)) {
    if (ac.flightId || ac.status !== 'available') continue;
    let since = -Infinity;
    for (const f of flightsOf(g, ac.id)) if (f.status === 'done' && f.to === ac.at && f.kind !== 'deadhead') since = Math.max(since, f.ata ?? f.sta);
    if (since === -Infinity || g.now - since < STUCK_MIN) continue;
    const next = wayOut(g, ac)[0];
    const k = next?.contractId ? g.contracts[next.contractId] : undefined;
    if (!next || next.kind !== 'positioning' || !k || (k.status !== 'active' && k.status !== 'signed') || !k.aircraftIds.includes(ac.id)) continue;
    const lost = flightsOf(g, ac.id).filter((f) => f.contractId === k.id && isRevenue(f) && f.status === 'cancelled' && !f.operatedBy && !f.sched && sched(f) >= since && AWAY.test(f.delayReason ?? ''));
    if (!lost.length) continue;
    out.push({ ac, contract: k, at: ac.at, since, lost, money: lost.length * k.penalties.perCancelledLeg });
  }
  return out;
}

/** The job's flights from `i` that go together: out and back to where the first leaves or to the job's station (a base wave, a round trip). */
function unitFrom(legs: Flight[], i: number, station: string): Flight[] {
  const out = [legs[i]];
  for (let k = i + 1; k < legs.length && out[out.length - 1].to !== legs[i].from && out[out.length - 1].to !== station && out.length < 12; k++) {
    if (legs[k].from !== out[out.length - 1].to) break;
    out.push(legs[k]);
  }
  return out;
}

/**
 * One pass over the job's flights still to fly, in their own order, with the aircraft at the end of its way out:
 * a wave it cannot start within the lateness it may have is taken off at no charge; one pushed later than it need be
 * goes back to its own time (or to when the aircraft is there). Returns the flights taken off and those moved.
 */
function tidy(g: GameState, s: StuckFerry): { dropped: Flight[]; moved: number } {
  const turn = turnOf(s.ac);
  const way = wayOut(g, s.ac);
  let loc = way.length ? way[way.length - 1].to : s.ac.at;
  let t = way.length ? way[way.length - 1].sta + turn : g.now;
  const legs = flightsOf(g, s.ac.id)
    .filter((f) => f.contractId === s.contract.id && isRevenue(f) && f.status === 'scheduled')
    .sort((a, b) => sched(a) - sched(b) || a.std - b.std);
  const station = s.contract.pattern.kind === 'base' ? s.contract.pattern.base : g.company.homeBase;
  const dropped: Flight[] = [];
  let moved = 0;
  for (let i = 0; i < legs.length; ) {
    const u = unitFrom(legs, i, station);
    i += u.length;
    const x = u[0];
    const r = loc !== x.from ? route(s.ac.typeId, loc, x.from) : null;
    const there = t + (loc !== x.from ? (r ? routeMinutes(r) : 0) + turn : 0);
    // Flights at their own times that the aircraft reaches: nothing to tidy from here on.
    if (u.every((y) => y.std === sched(y)) && x.std >= there) break;
    const want = Math.max(sched(x), there, x.std > sched(x) ? Math.min(x.std, g.now + NOTICE) : x.std);
    if (want - sched(x) - (x.lateOk ?? 0) > lateCap(g, x)) {
      cancelLegs(g, u, 'Aircraft out of position', 0, true);
      dropped.push(...u);
      continue;
    }
    let at = want;
    for (const y of u) {
      const std = Math.max(sched(y), at);
      if (std !== y.std) {
        retimeFlight(g, y, std, std + y.block);
        moved++;
      }
      if (std === sched(y)) {
        delete y.schedStd;
        if (AWAY.test(y.delayReason ?? '')) delete y.delayReason;
      }
      at = std + y.block + turn;
    }
    t = at;
    loc = u[u.length - 1].to;
  }
  return { dropped, moved };
}

function relink(g: GameState, id: string): void {
  for (let i = 0; i < 3; i++) if (!relinkPositioning(g, id).length) break;
}

/** The repair and the refund, once per save (Stats.ferryRefund). */
export function repairStuckFerries(g: GameState): void {
  if (g.stats.ferryRefund !== undefined) return;
  g.stats.ferryRefund = 0;
  for (const s of stuckFerries(g)) {
    const dropped: Flight[] = [];
    for (let i = 0; i < 4; i++) {
      relink(g, s.ac.id);
      const r = tidy(g, s);
      dropped.push(...r.dropped);
      if (!r.dropped.length && !r.moved) break;
    }
    relink(g, s.ac.id);
    g.stats.ferryRefund += s.money;
    post(g, 'refund', s.money);
    bumpClient(g, s.contract.clientId, -BAL.v08.rel.cancelLeg * s.lost.length, 'Refund: stuck ferry');
    const way = wayOut(g, s.ac);
    const last = way[way.length - 1];
    const client = g.clients[s.contract.clientId]?.name ?? 'the client';
    const n = s.lost.length;
    const d = dropped.length;
    pushMessage(g, {
      tone: 'good', cat: 'finance', cue: null,
      title: 'Refund: ' + s.ac.reg + ' stuck at ' + city(s.at) + ' (' + usd(s.money) + ')',
      body:
        'The game was wrong: ' + s.ac.reg + ' sat at ' + city(s.at) + ' from ' + fmtDay(s.since) + ', its ferry put back again and again, while its flights for ' + client + ' were cancelled. ' +
        'Given back: compensation ' + usd(s.money) + ' for ' + n + ' flight' + (n > 1 ? 's' : '') + ', and the client\'s trust lost with them.' +
        (last ? ' The ferry now leaves ' + fmtDateTime(way[0].std) + ' UTC and lands in ' + city(last.to) + ' ' + fmtDateTime(last.sta) + ' UTC.' : '') +
        (d ? ' ' + d + ' flight' + (d > 1 ? 's' : '') + ' it cannot reach ' + (d > 1 ? 'were' : 'was') + ' taken off at no charge.' : '') +
        ' Fixed in this version.',
      ref: { kind: 'aircraft', id: s.ac.id },
    });
  }
}
