// Player sub-charter (BRIEF core loop step 7): hand legs we can't or won't fly to a rival operator at their
// price; the client is still billed, the cost goes to 'subcharter', reliability takes no hit (DESIGN §5.8).

import { BAL } from '../core/balance';
import { dayStart } from '../core/time';
import { typeOf } from '../core/perf';
import { hashUnit } from '../core/util';
import type { ActionResult, Flight, GameState } from '../core/types';
import { cancelCost, subcharterCost, subcharterLegs, unitOf } from './flights';
import { contractOf, isRevenue } from './util';

/** Legs closer than this to departure can't be handed over any more (the rival needs to position). */
export const SUB_LEAD = 6 * 60;

export interface SubcharterQuote {
  flightIds: string[];
  /** Revenue legs (techstop sectors count) and their block hours. */
  revenueLegs: number;
  bh: number;
  rivalId: string;
  rivalName: string;
  /** What the rival charges ($). */
  cost: number;
  /** What we still bill the client for those legs ($, estimate). */
  revenue: number;
  /** What cancelling the same legs would cost in compensation instead ($). */
  cancel: number;
  /** Quote valid until (the rival re-prices daily). */
  validUntil: number;
}

const live = (g: GameState, f: Flight | undefined): f is Flight =>
  !!f && !!f.aircraftId && f.status === 'scheduled' && f.kind !== 'deadhead' && f.std > g.now + SUB_LEAD;

/** Our scheduled legs of a contract that can still be handed over (aircraft legs, not imminent), by time. Pure. */
export function subcharterable(g: GameState, contractId: string): Flight[] {
  return Object.values(g.flights).filter((f) => f.contractId === contractId && live(g, f)).sort((a, b) => a.std - b.std);
}

/** The rotation a leg belongs to (out and back to the station, or a round trip), still hand-over-able. Pure. */
export function rotationOf(g: GameState, flightId: string): Flight[] {
  const f = g.flights[flightId];
  const ac = f?.aircraftId ? g.fleet[f.aircraftId] : undefined;
  if (!f || !ac) return [];
  return unitOf(g, ac, f).filter((x) => live(g, x));
}

/** Billable value of legs we keep billing although a rival flies them (wet rate × BH, or pro-rata charter). Pure. */
function legRevenue(g: GameState, legs: Flight[]): number {
  let s = 0;
  for (const f of legs) {
    if (!isRevenue(f)) continue;
    const c = contractOf(g, f);
    if (c?.product.kind === 'wet') s += c.product.ratePerBH * (f.block / 60);
    else if (c?.product.kind === 'charter') s += (c.product.price * f.block) / Math.max(f.block, c.planRevMin ?? f.block * 4);
  }
  return Math.round(s);
}

/**
 * A rival's price for flying these legs (all of one contract). The rival flies the same family when one does;
 * rival and price are fixed per contract and day (hashUnit), so the quote the player saw is what they pay. Pure.
 */
export function subcharterQuote(g: GameState, flightIds: string[]): SubcharterQuote | null {
  const legs = flightIds.map((id) => g.flights[id]).filter((f) => live(g, f));
  if (!legs.length || !legs.some(isRevenue)) return null;
  const cid = legs[0].contractId;
  if (!cid || legs.some((f) => f.contractId !== cid)) return null;
  const ac = legs[0].aircraftId ? g.fleet[legs[0].aircraftId] : undefined;
  const fam = ac ? typeOf(ac.typeId).family : null;
  const fit = g.rivals.filter((r) => !fam || r.fleet.some((x) => typeOf(x.typeId).family === fam));
  const pool = fit.length ? fit : g.rivals;
  if (!pool.length) return null;
  const day = dayStart(g.now);
  const rival = pool[Math.floor(hashUnit(`sub:${cid}:${day}`) * pool.length)];
  const [lo, hi] = BAL.subcharterFactor;
  // Planned hand-overs (not an AOG scramble) price in the lower part of the band.
  const factor = (lo + hashUnit(`subf:${cid}:${day}`) * (hi - lo) * 0.6) * rival.priceFactor;
  const rev = legs.filter(isRevenue);
  return {
    flightIds: legs.map((f) => f.id), revenueLegs: rev.length, bh: Math.round(rev.reduce((s, f) => s + f.block, 0) / 6) / 10,
    rivalId: rival.id, rivalName: rival.name, cost: subcharterCost(g, legs, factor), revenue: legRevenue(g, legs), cancel: cancelCost(g, legs),
    validUntil: day + 1440,
  };
}

/** Hands the legs to the quoted rival at the quoted price (re-quoted now; refused when it changed or legs left). */
export function subcharter(g: GameState, flightIds: string[], expectCost?: number): ActionResult<{ legs: number; cost: number; rivalName: string }> {
  const q = subcharterQuote(g, flightIds);
  if (!q) return { ok: false, error: 'Those legs can no longer be handed over' };
  if (expectCost !== undefined && q.cost > expectCost) return { ok: false, error: `${q.rivalName} now asks $${Math.round(q.cost / 1000)}K; review the quote again` };
  const legs = q.flightIds.map((id) => g.flights[id]);
  const n = subcharterLegs(g, legs, q.rivalId, q.cost);
  return { ok: true, msg: `${q.rivalName} flies ${n} leg${n === 1 ? '' : 's'} for us`, data: { legs: n, cost: q.cost, rivalName: q.rivalName } };
}
