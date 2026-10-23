// v0.9 crew slip at a fuel stop (UPDATE-0.9.md §W): on a one-way sector with tech stops too long for one crew even with
// rest on board, a fresh crew flies to a stop by airline, rests in a hotel and takes over; the first crew rests there and
// flies home. At most one slip per sector. Pricing, offers, feasibility and the roster read the same cut. Pure reads.

import { AIRPORT_BY_CODE } from '../../data/airports';
import { BAL } from '../core/balance';
import { complement, typeOf } from '../core/perf';
import { fmtTime } from '../core/time';
import type { AcRest, Duty, GameState, Minute } from '../core/types';
import { dutyNeed, type ChainShape, type DutyNeed } from './duties';
import { crewName } from './generate';
import { crewIx, ticketPrice } from './timeline';

export interface SlipPlan {
  /** The stop where the crews change (airport code) and the index of the first leg the fresh crew flies. */
  at: string;
  cutIndex: number;
  first: DutyNeed;
  second: DutyNeed;
  /** Crew in the slip complement, one-way tickets in and out ($, both crews), hotel room nights and the room rate ($). */
  crewN: number;
  tickets: number;
  hotelNights: number;
  hotelNight: number;
  text: string;
}

const RANK: Record<DutyNeed['mode'], number> = { basic: 0, split: 1, ext: 2, aug1: 3, aug2: 4, none: 9 };
const AUG: Record<DutyNeed['mode'], 0 | 1 | 2> = { basic: 0, split: 0, ext: 0, aug1: 1, aug2: 2, none: 0 };
/** The crew hotel at the policy tier (as feasibility and pricing book it) and a cabin crew member's per diem (the slip's extra crew-day). */
const HOTEL = (g: GameState) => BAL.hotelPerNight[g.company.policies.hotelTier] ?? 140;
const PER_DIEM = () => BAL.perDiem.CC ?? 54;

/** City name of an airport ('Istanbul'), else its code. */
export const cityOf = (code: string): string => AIRPORT_BY_CODE[code]?.city ?? code;

/**
 * The best stop to change crews on a chain no single crew can fly (null: one crew can, or no single cut works: then
 * the chain stays impossible). Cuts are tried at each intermediate airport; both halves must be flyable. Ranked by
 * the fewest pilots needed (the larger half), then the most FDP margin, then the cheapest tickets from home. Pure.
 */
export function bestSlip(g: GameState, typeId: string, rest: AcRest, chain: ChainShape): SlipPlan | null {
  const legs = chain.legs;
  if (legs.length < 2) return null;
  if (dutyNeed(g, typeId, rest, chain).mode !== 'none') return null;
  const home = g.company.homeBase;
  const t = typeOf(typeId);
  const seats = t.cabins[0] ? t.cabins[0].j + t.cabins[0].w + t.cabins[0].y : 180;
  let best: { plan: SlipPlan; rank: number; margin: number } | null = null;
  for (let i = 1; i < legs.length; i++) {
    const at = legs[i].from ?? legs[i - 1].to;
    if (!at || at === home || !AIRPORT_BY_CODE[at]) continue;
    const a: ChainShape = { from: chain.from, std: legs[0].std, legs: legs.slice(0, i) };
    const b: ChainShape = { from: at, std: legs[i].std, legs: legs.slice(i) };
    const first = dutyNeed(g, typeId, rest, a);
    // Round 4: the fresh crew flew in the day before, so the roster judges it on the home clock too (FTL state B).
    const second = dutyNeed(g, typeId, rest, b, { stricter: true });
    if (first.mode === 'none' || second.mode === 'none') continue;
    // The crew the roster positions: the second half's pilots, the policy extra cabin crew and the rest plan's.
    const crewN = complement(typeId, seats, { augment: AUG[second.mode], extraCabin: g.company.policies.extraCabin, restCabin: second.plan?.extraCabin ?? 0 }).length;
    // The slip crew flies in, the first crew flies home: one ticket each way per person.
    const tickets = 2 * crewN * ticketPrice(home, at);
    const plan: SlipPlan = {
      at, cutIndex: i, first, second, crewN, tickets, hotelNights: crewN * BAL.v09.slip.roomNights, hotelNight: HOTEL(g),
      text: `Crew change at ${at} (fresh crew flies in)`,
    };
    const rank = Math.max(RANK[first.mode], RANK[second.mode]);
    const margin = Math.min(first.max - first.fdp, second.max - second.fdp);
    if (!best || rank < best.rank || (rank === best.rank && (margin > best.margin || (margin === best.margin && tickets < best.plan.tickets)))) best = { plan, rank, margin };
  }
  return best?.plan ?? null;
}

/** What a slip costs us (tickets, the hotel and per diem for the extra crew-day). Pure. */
export function slipCost(p: SlipPlan): number {
  return Math.round(p.tickets + p.hotelNights * p.hotelNight + p.crewN * PER_DIEM());
}

/** The plain detail under the feasibility line (§W.1); on a wet lease the client pays the travel. Pure. */
export function slipDetail(p: SlipPlan, to: string, wet = false): string {
  const c = cityOf(p.at);
  const k = `$${Math.max(1, Math.round(slipCost(p) / 1000))}K`;
  return `A second crew flies to ${c} by airline the day before and rests; it takes over ${p.at}–${to}. The first crew rests in ${c} and flies home. ${wet ? `The client pays the tickets and hotel (about ${k}).` : `Tickets and hotel about ${k}, priced in.`}`;
}

export interface SlipView {
  flightId: string;
  at: string;
  atName: string;
  inCrew: { names: string[]; ticketIds: string[]; arrives: Minute | null };
  outCrew: { names: string[]; ticketIds: string[]; leaves: Minute | null };
  text: string;
}

/** Names of a duty's crew. */
function crewOf(g: GameState, d: Duty): string[] {
  const p = g.pairings[d.pairingId];
  return p ? p.slots.filter((s) => s.crewId && g.crew[s.crewId]).map((s) => crewName(g.crew[s.crewId!])) : [];
}

/**
 * The crew change at the stop a flight departs from (the fresh crew's first leg) or arrives at (the first crew's
 * last leg): who flies in, who goes home, by which tickets. Null when the flight has no slip. Pure.
 */
export function slipOfFlight(g: GameState, flightId: string): SlipView | null {
  const f = g.flights[flightId];
  const d = f?.dutyId ? g.duties[f.dutyId] : undefined;
  if (!f || !d?.slipAt) return null;
  const at = d.slipAt;
  const t0 = f.from === at ? f.std : f.sta;
  const near = (t: Minute) => Math.abs(t - t0) < 2 * 1440;
  const same = Object.values(g.duties).filter((x) => x.slipAt === at && x.flightIds.some((id) => g.flights[id]?.aircraftId === f.aircraftId));
  const outD = same.find((x) => { const l = g.flights[x.flightIds[x.flightIds.length - 1]]; return !!l && l.to === at && near(l.sta); });
  const inD = same.find((x) => { const l = g.flights[x.flightIds[0]]; return !!l && l.from === at && near(l.std); });
  const tix = (x: Duty | undefined, dir: 'in' | 'out') => (x ? x.deadheadIds.map((id) => g.flights[id]).filter((t) => !!t && (dir === 'in' ? t.to === at : t.from === at)) : []);
  const tin = tix(inD, 'in');
  const tout = tix(outD, 'out');
  const atName = cityOf(at);
  const tIn = tin[0];
  const tOut = tout[0];
  return {
    flightId, at, atName,
    inCrew: { names: inD ? crewOf(g, inD) : [], ticketIds: tin.map((t) => t.id), arrives: tin.length ? Math.max(...tin.map((t) => t.sta)) : null },
    outCrew: { names: outD ? crewOf(g, outD) : [], ticketIds: tout.map((t) => t.id), leaves: tout.length ? Math.min(...tout.map((t) => t.std)) : null },
    text: `Crew change at ${atName} · fresh crew from ${cityOf(tIn?.from ?? g.company.homeBase)}${tIn ? ` on ${tIn.no} (lands ${fmtTime(tIn.sta)})` : ''}${tOut ? ` · the first crew flies home on ${tOut.no}` : ''}`,
  };
}

/** Crew changes on an aircraft's flights departing in [from, to) (one per stop and time). Pure. */
export function slipsOfAircraft(g: GameState, aircraftId: string, from: Minute, to: Minute): SlipView[] {
  const out: SlipView[] = [];
  const seen = new Set<string>();
  for (const p of crewIx(g).byAircraft.get(aircraftId) ?? []) {
    for (const id of p.dutyIds) {
      const d = g.duties[id];
      if (!d?.slipAt) continue;
      const f = g.flights[d.flightIds[0]];
      if (!f || f.from !== d.slipAt || f.std < from || f.std >= to) continue;
      const key = `${d.slipAt}@${f.std}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const v = slipOfFlight(g, f.id);
      if (v) out.push(v);
    }
  }
  return out;
}
