// v0.10.2 technical dispatch reliability (the Ladder): the share of our revenue departures that left no more than 15
// minutes late and were not cancelled for a technical reason. A leg is marked `tech` when a technical cause touches it
// (a technical delay at the gate, the aircraft AOG or in an overrunning check, grounded for an overdue check); it is
// judged once: when it leaves, when a rival flies it for us (sub-charter) or when it is cancelled. A spare aircraft or a
// sub-charter that gets the client's flight away within 15 minutes counts as on time. Kept by day, 366 days.

import { BAL } from './balance';
import { DAY, monthStart } from './time';
import type { Flight, GameState } from './types';

/** Reasons that make a leg technical: the aircraft itself (not a knock-on of a short technical delay elsewhere). */
const TECH_RE = /^(Recovery: )?(Aircraft unserviceable|Maintenance overrun|AOG|Aircraft grounded)|^Technical|grounded$/;
export const isTechReason = (reason: string | undefined): boolean => !!reason && TECH_RE.test(reason);

/** Marks a leg technical when the reason is. */
export function markTech(f: Flight, reason: string | undefined): void {
  if (isTechReason(reason)) f.tech = true;
}

const isRev = (f: Flight) => f.kind === 'revenue' || f.kind === 'techstop';
const lateOf = (f: Flight) => Math.max(0, (f.atd ?? f.std + f.delay) - (f.schedStd ?? f.std));

function bucket(g: GameState): [number, number] {
  const rec = (g.stats.techDisp ??= {});
  return (rec[Math.floor(g.now / DAY)] ??= [0, 0]);
}

/** A revenue leg left (our aircraft, or a rival's for us): counted, a failure when technical and over 15 min late. */
export function noteDispatch(g: GameState, f: Flight): void {
  if (!isRev(f)) return;
  const b = bucket(g);
  b[0]++;
  if (f.tech && lateOf(f) > BAL.ladder.tech.lateMin) b[1]++;
}

/** A revenue leg cancelled: a failure when technical (other cancellations are not departures of ours). */
export function noteTechCancel(g: GameState, f: Flight, reason: string | undefined): void {
  if (!isRev(f) || !(f.tech || isTechReason(reason))) return;
  const b = bucket(g);
  b[0]++;
  b[1]++;
}

/** Daily: buckets older than a year drop out. */
export function pruneTechLog(g: GameState): void {
  const rec = g.stats.techDisp;
  if (!rec) return;
  const keep = Math.floor(g.now / DAY) - BAL.ladder.tech.keepDays;
  for (const k of Object.keys(rec)) if (Number(k) < keep) delete rec[Number(k)];
}

export interface TechReliability { deps: number; fails: number; /** % (one decimal) or null under the minimum sample. */ pct: number | null }

/** Technical dispatch reliability over the last `days` days (today included). Pure. */
export function techReliability(g: GameState, days: number): TechReliability {
  const from = Math.floor(g.now / DAY) - days + 1;
  let deps = 0;
  let fails = 0;
  for (const [k, [d, f]] of Object.entries(g.stats.techDisp ?? {})) {
    if (Number(k) < from) continue;
    deps += d;
    fails += f;
  }
  deps = Math.round(deps);
  fails = Math.round(fails);
  const pct = deps >= BAL.ladder.tech.minDeps ? Math.floor((1000 * (deps - fails)) / deps) / 10 : null;
  return { deps, fails, pct };
}

/**
 * Load (saves from before v0.10.2): the record from what the save has: revenue departures by month (onTimeM, last 14
 * months) spread evenly over each month's days so far, and each AOG of the last year as one failed departure.
 */
export function seedTechLog(g: GameState): void {
  if (g.stats.techDisp) return;
  const rec: Record<number, [number, number]> = {};
  const today = Math.floor(g.now / DAY);
  const first = Math.floor(g.started / DAY);
  for (const [k, v] of Object.entries(g.stats.v09?.onTimeM ?? {})) {
    const a = Math.max(first, Math.floor(monthStart(Number(k)) / DAY));
    const b = Math.min(today, Math.floor(monthStart(Number(k) + 1) / DAY) - 1);
    if (b < a || !v[0]) continue;
    const n = b - a + 1;
    for (let d = a; d <= b; d++) (rec[d] ??= [0, 0])[0] += v[0] / n;
  }
  for (const [t, kind] of g.stats.incidents ?? []) {
    if (kind !== 'aog') continue;
    const r = (rec[Math.floor(t / DAY)] ??= [0, 0]);
    r[1] += 1;
    if (r[0] < r[1]) r[0] = r[1];
  }
  g.stats.techDisp = rec;
}
