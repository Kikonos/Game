// v0.12.1 the late-leg policy in one place (pure): how late a leg is, whether the delay is ours, and what it costs
// under the contract (charter compensation over 3 h, presidential standards over 30 min × 3). flights.ts lateLeg posts
// it; the previews (delay cues, disruption cards, crew control) read the same rule, so a card never promises a
// penalty the arrival does not charge.

import { BAL } from '../core/balance';
import type { Contract, Flight } from '../core/types';

/** Minutes a flight runs (or ran) behind its original schedule (UI). */
export function delayOf(f: Flight): number {
  const off = f.atd ?? f.std + f.delay;
  return Math.max(0, off - (f.schedStd ?? f.std));
}

/** Delays nobody at our end controls (ATC, weather, the client, the world). */
export const NOT_OURS = /^(ATC|Weather|Late passengers|Airport congestion|Client|Landing permit|Waiting:|Closed:|Whiteout|Moved to|Medical|Night stop|Bird strike)/;

/** v0.12.1 the leg's delay reason is one we answer for. */
export const isOurDelay = (f: Flight): boolean => !NOT_OURS.test(f.delayReason ?? '');

/** v0.12.1 lateness left once the minutes that are not ours (f.excused: world waits, a client CTOT) are taken off. */
export const excusedLate = (f: Flight): number => Math.max(0, delayOf(f) - (f.excused ?? 0));

/** v0.12.1 on time = left within 15 minutes of its schedule. */
export const onTimeLeg = (f: Flight): boolean => delayOf(f) <= 15;

/**
 * v0.12.1 what a late leg costs under its contract: over 3 h (presidential standards: over 30 min), charter
 * compensation (× 3 for VIP) and a relation hit (−3 for VIP; the monthly cap is applied by the caller). Nothing when
 * the delay is not ours. Pure.
 */
export function latePenalty(c: Contract, f: Flight, lateMin = excusedLate(f)): { money: number; relation: number; ours: boolean } {
  const ours = isOurDelay(f);
  const vip = c.requirements.standards === 'vip';
  if (!ours || lateMin <= (vip ? 30 : 180)) return { money: 0, relation: 0, ours };
  const money = c.product.kind === 'charter' ? c.penalties.perDelay * (vip ? 3 : 1) : 0;
  return { money, relation: vip ? -3 : BAL.v08.rel.lateLeg, ours };
}
