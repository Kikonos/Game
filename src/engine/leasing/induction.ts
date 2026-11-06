// v0.17 transition and CAMO capacity (UPDATE-0.17.md §G; lane `deals`). Step 0: the legacy lead time (handover =
// signing + the offer's leadDays), no transition plan; the CAMO capacity read is real (pure, nothing acts on it).

import { BAL } from '../core/balance';
import { typeOf } from '../core/perf';
import { DAY } from '../core/time';
import type { AircraftOffer, GameState, Induction, Minute } from '../core/types';

export interface InductionPlan {
  /** Handover (in service at the site) after the transition. */
  ready: Minute;
  /** The plan to store on the aircraft (absent: a legacy delivery). */
  induction?: Induction;
  /** When our CAMO has a slot (now when free). */
  camoFreeAt?: Minute;
}

/**
 * The transition plan of an offer signed now (§G.1), on the stream `ind:<offerId>` (the same plan the letter-of-intent
 * dialog shows before signing). Step 0: the legacy handover. Pure.
 */
export function inductionPlan(g: GameState, o: AircraftOffer, opts: { start?: Minute; techReps?: boolean; paint?: boolean } = {}): InductionPlan {
  void opts;
  return { ready: g.now + o.leadDays * DAY };
}

/** Transitions our CAMO can run at once: 1 + one per 5 aircraft on the AOC, at most 4 (§G.2). Pure. */
export function camoCapacity(g: GameState): number {
  const C = BAL.v017.induction.camo;
  const n = Object.values(g.fleet).filter((a) => a.status !== 'delivering').length;
  return Math.min(C.max, C.base + Math.floor(n / C.perAircraft));
}

/** Slots in use at `t` (a widebody counts 2, or the whole capacity when that is 1; short-term 1). Pure. */
export function camoLoad(g: GameState, t: Minute = g.now): number {
  const cap = camoCapacity(g);
  let n = 0;
  for (const a of Object.values(g.fleet)) {
    const i = a.induction;
    if (!i || i.slot > t || i.ready <= t) continue;
    const wide = typeOf(a.typeId).body === 'wide' && !(a.ownership.kind === 'dryLeaseIn' && a.ownership.spot);
    n += wide ? (cap === 1 ? 1 : BAL.v017.induction.camo.wideSlots) : 1;
  }
  return n;
}

/** Daily: transition steps done, findings (§G.1). Step 0: nothing. */
export function dailyInduction(g: GameState): void {
  void g;
}
