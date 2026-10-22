// Player sub-charter (BRIEF core loop step 7): hand legs we can't or won't fly to a rival operator at their
// price; the client is still billed, the cost goes to 'subcharter'. v0.7.2: the client notices (reliability, F3).

import { BAL } from '../core/balance';
import { dayStart, fmtDay } from '../core/time';
import { typeOf } from '../core/perf';
import { hashUnit } from '../core/util';
import type { ActionResult, Flight, GameState, Rival } from '../core/types';
import { levelOf } from '../contracts/relations';
import { isActive, type RivalStyle } from '../contracts/rivals';
import { cancelCost, noticeText, subcharterCost, subcharterLegs, subHit, unitOf, type SubHit } from './flights';
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
  /** v0.7.2 what the hand-over costs in reliability and client relation. */
  hit: SubcharterHit;
  /** v0.8 the rival's quality 0–1 (three dots), whether it has an aircraft free (else why), its style. */
  quality: number;
  available: boolean;
  why?: string;
  style: RivalStyle;
}

/** v0.7.2 a hand-over's reliability cost: 'reliability −2 · the client notices'. */
export interface SubcharterHit { reliability: number; relation: number; text: string }

/** The reliability and relation a hand-over of these legs would cost (UPDATE-0.7.2.md F3). Pure. */
export function subcharterHit(g: GameState, flightIds: string[]): SubcharterHit {
  const rev = flightIds.map((id) => g.flights[id]).filter((f): f is Flight => !!f && f.status === 'scheduled' && f.purpose !== 'delivery' && isRevenue(f));
  const h = subHit(g, rev);
  return { reliability: h.reliability, relation: h.relation, text: h.text };
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

/** v0.8 a rival as a client of ours: Trusted −5 %, Partner −10 % on what they charge us. */
function levelDiscount(g: GameState, r: Rival): number {
  const cl = r.clientId ? g.clients[r.clientId] : undefined;
  const lv = cl ? levelOf(g, cl) : 'new';
  return lv === 'partner' ? 0.9 : lv === 'trusted' ? 0.95 : 1;
}

/**
 * v0.8 (UPDATE-0.8.md §3.4) up to three rivals' prices for flying these legs (all of one contract), cheapest
 * available first: active rivals flying the same family (else any), today's factor (fixed per contract, rival and
 * day) × their price level × our level as their client. A rival booked over 90 % shows when it has an aircraft
 * again. Pure.
 */
export function subcharterQuotes(g: GameState, flightIds: string[]): SubcharterQuote[] {
  const legs = flightIds.map((id) => g.flights[id]).filter((f) => live(g, f));
  if (!legs.length || !legs.some(isRevenue)) return [];
  const cid = legs[0].contractId;
  if (!cid || legs.some((f) => f.contractId !== cid)) return [];
  const ac = legs[0].aircraftId ? g.fleet[legs[0].aircraftId] : undefined;
  const fam = ac ? typeOf(ac.typeId).family : null;
  const active = g.rivals.filter(isActive);
  const fit = active.filter((r) => !fam || r.fleet.some((x) => x.count > 0 && typeOf(x.typeId).family === fam));
  const pool = fit.length ? fit : active;
  if (!pool.length) return [];
  const day = dayStart(g.now);
  const [lo, hi] = BAL.subcharterFactor;
  const rev = legs.filter(isRevenue);
  const revenue = legRevenue(g, legs);
  const cancel = cancelCost(g, legs);
  const base = subcharterHit(g, legs.map((f) => f.id));
  const bh = Math.round(rev.reduce((s, f) => s + f.block, 0) / 6) / 10;
  const out = pool.map((rival): SubcharterQuote => {
    // Planned hand-overs (not an AOG scramble) price in the lower part of the band.
    const factor = (lo + hashUnit(`subf:${cid}:${day}:${rival.id}`) * (hi - lo) * 0.6) * rival.priceFactor * levelDiscount(g, rival);
    const load = rival.load ?? 0.7;
    const available = load < BAL.v08.rivals.quoteLoadMax;
    const hit: SubcharterHit = { ...base, relation: Math.round(base.relation * (1.5 - rival.quality) * 10) / 10 };
    return {
      flightIds: legs.map((f) => f.id), revenueLegs: rev.length, bh, rivalId: rival.id, rivalName: rival.name,
      cost: subcharterCost(g, legs, factor), revenue, cancel, validUntil: day + 1440, hit,
      quality: rival.quality, available, style: rival.personality,
      ...(available ? {} : { why: `No aircraft free until ${fmtDay(day + (3 + Math.floor(hashUnit(`subfree:${rival.id}:${day}`) * 18)) * 1440)}` }),
    };
  });
  out.sort((a, b) => Number(b.available) - Number(a.available) || a.cost - b.cost);
  return out.slice(0, BAL.v08.rivals.quotes);
}

/** The cheapest available quote (v0.7.2 single-quote API; Crew Control, the AOG decision and the bot use it). Pure. */
export function subcharterQuote(g: GameState, flightIds: string[]): SubcharterQuote | null {
  const q = subcharterQuotes(g, flightIds);
  return q.find((x) => x.available) ?? null;
}

/** Hands the legs to the chosen rival (default the cheapest) at the quoted price (re-quoted now; refused when it rose or legs left). */
export function subcharter(g: GameState, flightIds: string[], expectCost?: number, rivalId?: string): ActionResult<{ legs: number; cost: number; rivalName: string }> {
  const qs = subcharterQuotes(g, flightIds);
  const q = rivalId ? qs.find((x) => x.rivalId === rivalId) : qs.find((x) => x.available);
  if (!q) return { ok: false, error: rivalId && qs.length ? 'That operator can no longer quote; pick another' : 'Those legs can no longer be handed over' };
  if (!q.available) return { ok: false, error: `${q.rivalName}: ${q.why ?? 'no aircraft free'}` };
  if (expectCost !== undefined && q.cost > expectCost) return { ok: false, error: `${q.rivalName} now asks $${Math.round(q.cost / 1000)}K; review the quote again` };
  const legs = q.flightIds.map((id) => g.flights[id]);
  const out: { hit?: SubHit } = {};
  const n = subcharterLegs(g, legs, q.rivalId, q.cost, out);
  return { ok: true, msg: `${q.rivalName} flies ${n} leg${n === 1 ? '' : 's'} for us.${noticeText(g, legs[0], out.hit)}`, data: { legs: n, cost: q.cost, rivalName: q.rivalName } };
}
