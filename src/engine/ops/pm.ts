// v0.24 the fleet's preventive maintenance programme (the player: "a preventative maintenance program in general
// (different intensities low, medium, high) that would lower AOG risk ... to increase reliability"). One level for the
// whole fleet, set in Company › Policies:
// - low: the approved programme's minimum (the behaviour before v0.24; every factor 1, no cost);
// - medium: enhanced (more line checks, defects fixed at the night stop, hard-time items a little early);
// - high: intensive reliability programme (soft-time component replacement, trend monitoring, spares pool, engineer).
// Higher levels cost more per block hour (posted with each leg's maintenance) and a monthly fee per aircraft (accrued
// daily on `maintenance`), and lower technical delays, AOGs and the build-up of deferred defects. A change shows in
// full after BAL.pm.rampDays (the parts are replaced at the coming checks), and the technical dispatch reliability the
// Ladder reads is itself a rolling record, so it climbs over months, not at once.

import { BAL } from '../core/balance';
import { post } from '../core/ledger';
import { typeOf } from '../core/perf';
import { DAY } from '../core/time';
import type { ActionResult, Aircraft, GameState, PmLevel } from '../core/types';
import { ageOf } from './util';

const P = () => BAL.pm;
export const PM_LEVELS: readonly PmLevel[] = ['low', 'medium', 'high'];
export const PM_LABEL: Record<PmLevel, string> = { low: 'Low', medium: 'Medium', high: 'High' };
const DAYS_IN_MONTH = 30.44;

/** The level set (old saves and new games: 'low'). Pure. */
export const pmLevel = (g: GameState): PmLevel => g.company.pm?.level ?? 'low';

/** How far a change has come in (0 just changed, 1 in full). Pure. */
export function pmProgress(g: GameState): number {
  const p = g.company.pm;
  if (!p) return 1;
  const to = levelFactors(p.level);
  if (p.at ? p.at.delay === to.delay && p.at.aog === to.aog && p.at.deferred === to.deferred : p.from === p.level) return 1;
  return Math.max(0, Math.min(1, (g.now - p.since) / (P().rampDays * DAY)));
}

export interface PmFactors {
  /** Technical delay chance at the gate. */
  delay: number;
  /** AOG chance per departure. */
  aog: number;
  /** Deferred defects building up per flight. */
  deferred: number;
}

const ONE: PmFactors = { delay: 1, aog: 1, deferred: 1 };

/** The full factors of a level. Pure. */
const levelFactors = (level: PmLevel): PmFactors => ({ delay: P().delayX[level], aog: P().aogX[level], deferred: P().deferredX[level] });

/** The factors in force now (moving from those in force at the change to the new level's over the ramp). Pure. */
export function pmFactors(g: GameState): PmFactors {
  const p = g.company.pm;
  if (!p) return ONE;
  const k = pmProgress(g);
  const to = levelFactors(p.level);
  if (k >= 1) return to;
  const from = p.at ?? levelFactors(p.from);
  const mix = (f: keyof PmFactors) => from[f] + (to[f] - from[f]) * k;
  return { delay: mix('delay'), aog: mix('aog'), deferred: mix('deferred') };
}

/** The share of maintBH added per block hour at the level set (the cost moves at once). Pure. */
export const pmCostX = (g: GameState): number => P().costX[pmLevel(g)];

/** The aircraft the programme covers and bills: ours in service (not delivering, stored or flown by a lessee). */
const covered = (g: GameState): Aircraft[] => Object.values(g.fleet).filter((a) => a.status !== 'delivering' && a.status !== 'stored' && a.status !== 'leasedOut');

const feeOf = (level: PmLevel, a: Aircraft) => P().fee[level][typeOf(a.typeId).body === 'wide' ? 1 : 0];

/** Block hours of an aircraft over its last 30 days (its daily record). Pure. */
function bh30(g: GameState, a: Aircraft): number {
  const day = Math.floor(g.now / DAY);
  return (a.bhDays ?? []).filter(([d]) => d > day - 30).reduce((s, [, m]) => s + m, 0) / 60;
}

export interface PmQuote {
  level: PmLevel;
  /** A month at the last 30 days' flying: the per-hour part, the fees and both. */
  perHour: number;
  fees: number;
  monthly: number;
  /** Against the minimum: technical delays, AOGs and deferred defects, in % fewer. */
  delayLess: number;
  aogLess: number;
  deferredLess: number;
}

/** What a level costs a month on the fleet's recent flying, and what it does. Pure. */
export function pmQuote(g: GameState, level: PmLevel): PmQuote {
  let perHour = 0;
  let fees = 0;
  for (const a of covered(g)) {
    const t = typeOf(a.typeId);
    perHour += t.maintBH * (1 + BAL.maintAgeFactor * Math.max(0, ageOf(g, a) - 12)) * P().costX[level] * bh30(g, a);
    fees += feeOf(level, a);
  }
  const less = (x: Record<PmLevel, number>) => Math.round((1 - x[level]) * 100);
  return { level, perHour: Math.round(perHour), fees: Math.round(fees), monthly: Math.round(perHour + fees), delayLess: less(P().delayX), aogLess: less(P().aogX), deferredLess: less(P().deferredX) };
}

/** Player action: the fleet's programme level. The cost changes today; the effect builds over BAL.pm.rampDays. */
export function setPmLevel(g: GameState, level: PmLevel): ActionResult {
  if (!PM_LEVELS.includes(level)) return { ok: false, error: 'Unknown level' };
  const cur = pmLevel(g);
  if (cur === level) return { ok: true };
  // The new ramp starts from the factors in force now, mid-change included: a change never jumps them (a switch back
  // to High after a spell at Low does not bring High's full effect back at once).
  const p = g.company.pm;
  const at = pmFactors(g);
  g.company.pm = { level, from: cur, since: g.now, at, ...(p?.billed !== undefined ? { billed: p.billed } : {}) };
  return { ok: true, msg: `Maintenance programme: ${PM_LABEL[level]} · in full in about ${P().rampDays} days` };
}

/** Daily: the programme's fees for the day (none at 'low'). */
export function dailyPm(g: GameState): void {
  const level = pmLevel(g);
  if (level === 'low') return;
  const day = Math.floor(g.now / DAY);
  const p = g.company.pm!;
  if (p.billed === day) return;
  p.billed = day;
  const fee = covered(g).reduce((s, a) => s + feeOf(level, a), 0) / DAYS_IN_MONTH;
  if (fee > 0) post(g, 'maintenance', -Math.round(fee));
}
