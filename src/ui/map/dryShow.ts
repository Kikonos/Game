// v0.14 a dry-leased-out aircraft flies for its lessee on the map: COSMETIC only (no engine state, ledger, crew or
// RNG). Out-and-backs from the lessee's base to real airports its range and runways allow, 2–4 rotations a day with
// turns on the ground and a quiet night, under the lessee's flight numbers. A pure function of (aircraft, base, type,
// lessee prefix, time) through a seeded hash: the same after a save and load, and nothing in the game changes.

import { AIRPORT_BY_CODE, AIRPORTS } from '../../data/airports';
import { standardOffsetHours } from '../../data/timezones';
import { distanceNm } from '../../engine/core/geo';
import { blockMinutes, maxSectorNm, runwayFit, typeOf } from '../../engine/core/perf';
import { DAY } from '../../engine/core/time';
import { hash } from '../../engine/core/util';
import type { Aircraft, GameState } from '../../engine/core/types';
import { clientPrefix } from '../../engine/contracts/clients';
import { dryLeaseOf } from '../../engine/ops/dryLease';

/** One of the lessee's legs (game minutes). */
export interface ShowLeg { from: string; to: string; dep: number; arr: number; no: string }

/** Sectors a lessee flies on it: at least this long (block minutes), at most this long (so 2+ rotations fit a day). */
export const SHOW_MIN_BLOCK = 40;
export const SHOW_MAX_BLOCK = 200;
/** First departure (local, minutes after midnight) and the last arrival home (the quiet night after it). */
const DAY_START = 6 * 60;
const DAY_END = 23 * 60 + 30;

const destMemo = new Map<string, string[]>();

/**
 * The lessee's network for a type at a base: airports it can fly to and back nonstop (range from either end, runway
 * fit at both, not narrowbody-only for a widebody), in block-time reach, never an en-route field, ice runway or a
 * remote late-game place. The biggest airports first, up to 16. Pure (memoised).
 */
export function showDestinations(typeId: string, base: string): string[] {
  const key = `${typeId}|${base}`;
  const hit = destMemo.get(key);
  if (hit) return hit;
  const B = AIRPORT_BY_CODE[base];
  const out: { code: string; w: number }[] = [];
  if (B && runwayFit(typeId, base) !== 'no') {
    for (const a of AIRPORTS) {
      if (a.code === base || a.enroute || a.ice || a.remote || a.size < 2) continue;
      if (runwayFit(typeId, a.code) === 'no') continue;
      const nm = distanceNm(base, a.code);
      if (nm > maxSectorNm(typeId, base, a.code) || nm > maxSectorNm(typeId, a.code, base)) continue;
      const blk = blockMinutes(typeId, base, a.code);
      if (blk < SHOW_MIN_BLOCK || blk > SHOW_MAX_BLOCK) continue;
      out.push({ code: a.code, w: a.size * 10 + a.pop / 2 });
    }
  }
  const list = out.sort((x, y) => y.w - x.w || (x.code < y.code ? -1 : 1)).slice(0, 16).map((x) => x.code);
  destMemo.set(key, list);
  return list;
}

/** The base's local offset (minutes), standard time (good enough for a cosmetic day). */
const localOff = (base: string) => {
  const a = AIRPORT_BY_CODE[base];
  return a ? Math.round(standardOffsetHours(a.code, a.country, a.lon) * 60) : 0;
};

/** Turn on the ground at the far end and at base (minutes): longer for a widebody. */
const turnOf = (typeId: string) => (typeOf(typeId).body === 'narrow' ? [40, 55] : [75, 95]);

/**
 * The lessee's legs on its local day `day` (days since the epoch, local): 2–4 rotations from DAY_START, each to a
 * destination picked by a seeded hash of (aircraft, base, day, rotation), as many as fit before DAY_END. Pure.
 */
export function showDay(acId: string, typeId: string, base: string, prefix: string, day: number): ShowLeg[] {
  const dests = showDestinations(typeId, base);
  if (!dests.length) return [];
  const off = localOff(base);
  const seed = (s: string) => hash(`${acId}|${base}|${day}|${s}`);
  const [turnOut, turnHome] = turnOf(typeId);
  // 2–4 rotations a day; a quiet day or two a month (maintenance at the lessee's): none.
  if (seed('rest') % 23 === 0) return [];
  const want = 2 + (seed('n') % 3);
  let t = day * DAY - off + DAY_START + (seed('start') % 75);
  const end = day * DAY - off + DAY_END;
  const legs: ShowLeg[] = [];
  for (let i = 0; i < want; i++) {
    const to = dests[seed(`d${i}`) % dests.length];
    const blk = blockMinutes(typeId, base, to);
    const back = blockMinutes(typeId, to, base);
    if (t + blk + turnOut + back > end) break;
    // The lessee's numbers: one per destination, out odd, back the next one up (LP2041 / LP2042).
    const n = 1001 + 2 * (hash(`${acId}|${base}|${to}`) % 3999);
    legs.push({ from: base, to, dep: t, arr: t + blk, no: `${prefix}${n}` });
    t += blk + turnOut;
    legs.push({ from: to, to: base, dep: t, arr: t + back, no: `${prefix}${n + 1}` });
    t += back + turnHome + (seed(`g${i}`) % 40);
  }
  return legs;
}

/** Where it is at time t: on a leg (and how far along), or on the ground at an airport. Pure. */
export function showAt(acId: string, typeId: string, base: string, prefix: string, t: number): { leg: ShowLeg; progress: number } | { at: string } {
  const off = localOff(base);
  const day = Math.floor((t + off) / DAY);
  let at = base;
  for (const leg of showDay(acId, typeId, base, prefix, day)) {
    if (t < leg.dep) break;
    if (t < leg.arr) return { leg, progress: (t - leg.dep) / Math.max(1, leg.arr - leg.dep) };
    at = leg.to;
  }
  return { at };
}

/** v0.14 who flies our dry-leased-out aircraft and where (null unless it is with the lessee now). Read-only. */
export interface LeaseShow { lessee: string; site: string; prefix: string }
export function leaseShowOf(g: GameState, ac: Aircraft): LeaseShow | null {
  if (ac.status !== 'leasedOut') return null;
  const v = dryLeaseOf(g, ac.id);
  if (!v || v.phase !== 'leased' || !AIRPORT_BY_CODE[v.site]) return null;
  return { lessee: v.lessee, site: v.site, prefix: clientPrefix(v.lessee) };
}

/** The panel's line: 'Dry-leased to LATAM Perú · flying LIM–CUZ (their flight LP2041)', the turn away from base, or
 *  null at its base (the panel's usual lease line). */
export function leaseShowLine(g: GameState, ac: Aircraft, t: number): string | null {
  const s = leaseShowOf(g, ac);
  if (!s) return null;
  const at = showAt(ac.id, ac.typeId, s.site, s.prefix, t);
  if ('leg' in at) return `Dry-leased to ${s.lessee} · flying ${at.leg.from}–${at.leg.to} (their flight ${at.leg.no})`;
  return at.at !== s.site ? `Dry-leased to ${s.lessee} · on the ground at ${at.at}, turning for ${s.site}` : null;
}
