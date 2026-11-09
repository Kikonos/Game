// v0.10.2 technical dispatch reliability (the Ladder): the share of our revenue departures that left no more than 15
// minutes late and were not cancelled for a technical reason. A leg is marked `tech` when a technical cause touches it
// (a technical delay at the gate, the aircraft AOG or in an overrunning check, grounded for an overdue check); it is
// judged once: when it leaves, when a rival flies it for us (sub-charter) or when it is cancelled. A spare aircraft or a
// sub-charter that gets the client's flight away within 15 minutes counts as on time. Kept by day, 366 days.

import { BAL } from './balance';
import { DAY, monthStart } from './time';
import type { Flight, GameState, TechCause } from './types';

/** Reasons that make a leg technical: the aircraft itself (not a knock-on of a short technical delay elsewhere). */
const TECH_RE = /^(Recovery: )?(Aircraft unserviceable|Maintenance overrun|AOG|Aircraft grounded)|^Technical|grounded$/;
export const isTechReason = (reason: string | undefined): boolean => !!reason && TECH_RE.test(reason);

/** Marks a leg technical when the reason is (v0.19.4 and remembers the aircraft and the first technical reason). */
export function markTech(f: Flight, reason: string | undefined): void {
  if (isTechReason(reason)) techHit(f, reason!);
}

/** v0.19.4 a technical cause touched the leg: flagged, with the aircraft it hit and why (the first cause kept). */
export function techHit(f: Flight, reason: string): void {
  f.tech = true;
  if (f.aircraftId && !f.techAc) f.techAc = f.aircraftId;
  f.techWhy ??= reason;
}

/** v0.19.4 the cause of a technical failure, from the reason text. Pure. */
export function techCause(reason: string | undefined): TechCause {
  const r = (reason ?? '').replace(/^Recovery: /, '');
  if (/^(AOG|Aircraft unserviceable)/.test(r)) return 'aog';
  if (/^Maintenance overrun/.test(r)) return 'overrun';
  if (/grounded/.test(r)) return 'grounded';
  if (/diversion/i.test(r)) return 'diversion';
  return 'defect';
}

const isRev = (f: Flight) => f.kind === 'revenue' || f.kind === 'techstop';
const lateOf = (f: Flight) => Math.max(0, (f.atd ?? f.std + f.delay) - (f.schedStd ?? f.std));

function bucket(g: GameState): [number, number] {
  const rec = (g.stats.techDisp ??= {});
  return (rec[Math.floor(g.now / DAY)] ??= [0, 0]);
}

/**
 * v0.19.4 the aircraft's own record: a leg a technical cause touched counts for the aircraft it hit (a swap or a
 * sub-charter that saves it is that aircraft's save), any other for the aircraft that flew it.
 */
function noteAc(g: GameState, f: Flight, fail: boolean, late?: number): void {
  const ac = f.tech ? f.techAc ?? f.aircraftId : f.aircraftId;
  if (!ac) return;
  const day = Math.floor(g.now / DAY);
  const rec = ((g.stats.techAc ??= {})[ac] ??= {});
  const b = (rec[day] ??= [0, 0]);
  b[0]++;
  if (!fail) return;
  b[1]++;
  (g.stats.techFails ??= []).push({ t: g.now, ac, no: f.no, cause: techCause(f.techWhy), ...(late !== undefined ? { late } : {}) });
}

/** A revenue leg left (our aircraft, or a rival's for us): counted, a failure when technical and over 15 min late. */
export function noteDispatch(g: GameState, f: Flight): void {
  if (!isRev(f)) return;
  const b = bucket(g);
  b[0]++;
  const late = lateOf(f);
  const fail = !!f.tech && late > BAL.ladder.tech.lateMin;
  if (fail) b[1]++;
  noteAc(g, f, fail, fail ? Math.round(late) : undefined);
}

/** A revenue leg cancelled: a failure when technical (other cancellations are not departures of ours). */
export function noteTechCancel(g: GameState, f: Flight, reason: string | undefined): void {
  if (!isRev(f) || !(f.tech || isTechReason(reason))) return;
  const b = bucket(g);
  b[0]++;
  b[1]++;
  if (!f.tech && reason) techHit(f, reason);
  noteAc(g, f, true);
}

/** Daily: buckets older than a year drop out. */
export function pruneTechLog(g: GameState): void {
  const keep = Math.floor(g.now / DAY) - BAL.ladder.tech.keepDays;
  const rec = g.stats.techDisp;
  if (rec) for (const k of Object.keys(rec)) if (Number(k) < keep) delete rec[Number(k)];
  for (const r of Object.values(g.stats.techAc ?? {})) for (const k of Object.keys(r)) if (Number(k) < keep) delete r[Number(k)];
  const fails = g.stats.techFails;
  if (fails?.length && fails[0].t < keep * DAY) g.stats.techFails = fails.filter((x) => x.t >= keep * DAY);
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
  // v0.19.4 the record by aircraft starts now in an older save (nothing told us which aircraft failed before), at the
  // start in a new game.
  g.stats.techAc ??= {};
  g.stats.techFails ??= [];
  g.stats.techAcSince ??= g.now;
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
