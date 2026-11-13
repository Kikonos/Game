// v0.19.4 ETOPS 180 / 240 "hard but possible". A real ETOPS approval looks at the ETOPS fleet: the twin-engine aircraft
// that will fly it, their dispatch record and their maintenance, not the whole narrowbody fleet. So the Ladder's
// technical reliability for ETOPS 180 and 240 is measured on the ETOPS fleet (twins capable of that ETOPS), from the
// record by aircraft (core/techLog.ts), with a minimum of their revenue departures in the window. The approval card
// shows the breakdown (by aircraft and cause), the last 30 days against the 30 before, when failures leave the window,
// when the current pace reaches the target, and what would help.
//
// What the player can do (each a real lever with its effect in the engine):
// - the ETOPS maintenance programme held: the ETOPS twins' technical delays and AOGs × BAL.v0194.etops.mxX;
// - the ETOPS reliability programme (a monthly fee per ETOPS twin; set-up 3 weeks): rotable spares along the ETOPS
//   network and an engineer on call: technical delays × delayX, AOGs × aogX, and an AOG away from base is fixed as fast
//   as at home and no likelier (no outstation factor);
// - the ETOPS dispatch standard (etopsCheckChance): a twin of the ETOPS fleet is kept fit for ETOPS every day, so its
//   ETOPS-significant defects are fixed before it leaves (an old airframe and deferred defects are held more; the
//   programme halves it);
// - checks on time (deferred defects raise the AOG chance and the pre-departure check's; an A-check clears most), a swap or the AOG team on an AOG
//   (a swap that gets the leg away within 15 minutes counts as on time), and the oldest airframe out of the ETOPS fleet.

import { BAL } from '../core/balance';
import { pushMessage } from '../core/messages';
import { post } from '../core/ledger';
import { typeOf } from '../core/perf';
import { DAY, fmtDate, fmtDay, monthKey, yearOf } from '../core/time';
import type { ActionResult, Aircraft, GameState, Minute, TechCause } from '../core/types';
import { pmFactors } from './pm';

const E = () => BAL.v0194.etops;

/** A twin of the ETOPS fleet for that ETOPS (180 or 240): two engines, certified that far. Pure. */
export const etopsTwin = (typeId: string, min: number): boolean => {
  const t = typeOf(typeId);
  return !!t && t.engines === 2 && t.etopsMax >= min;
};

export interface EtopsAcRow { id: string; reg: string; type: string; age: number; deps: number; fails: number; pct: number | null; deferred: number }

export interface EtopsRecord {
  /** The ETOPS minutes measured (180, 240). */
  min: number;
  days: number;
  need: number;
  minDeps: number;
  deps: number;
  fails: number;
  /** % (one decimal) or null under the minimum sample. */
  pct: number | null;
  /** The record by aircraft starts here (an older save: the day it was loaded). */
  since: Minute;
  /** First day of the window. */
  from: Minute;
  byAc: EtopsAcRow[];
  causes: Partial<Record<TechCause, number>>;
  /** The last 30 days and the 30 before (ETOPS fleet), null under 10 departures. */
  last30: number | null;
  prev30: number | null;
  /** Failures leaving the window in the next 30 days. */
  leaving30: number;
  /** When the current pace (the last 60 days) reaches the target, if within a year. */
  reachAt: Minute | null;
  /** What would get us there (plain lines, the first the likeliest). */
  advice: string[];
}

const pct1 = (deps: number, fails: number) => Math.floor((1000 * (deps - fails)) / deps) / 10;
const ageOf = (g: GameState, a: Aircraft) => Math.max(0, yearOf(g.now) - a.builtYear);

export const CAUSE_TEXT: Record<TechCause, string> = {
  aog: 'AOG (aircraft on the ground)', defect: 'Defects at the gate', etops: 'ETOPS pre-departure check', overrun: 'Checks overrunning', grounded: 'Grounded: check overdue', diversion: 'Technical diversions',
};

/** The ETOPS fleet's technical dispatch record over the window (today included), with the breakdown. Pure. */
export function etopsRecord(g: GameState, min: number, days: number): EtopsRecord {
  const need = BAL.ladder.tech.target[min === 240 ? 'etops240' : 'etops180'] ?? 98;
  const today = Math.floor(g.now / DAY);
  const since = g.stats.techAcSince ?? g.started;
  const from = Math.max(today - days + 1, Math.floor(since / DAY));
  const rec = g.stats.techAc ?? {};
  const ids = Object.keys(rec).filter((id) => g.fleet[id] && etopsTwin(g.fleet[id].typeId, min));
  // Twins of the ETOPS fleet with no record yet (just delivered) still show.
  for (const a of Object.values(g.fleet)) if (!ids.includes(a.id) && etopsTwin(a.typeId, min) && a.status !== 'delivering') ids.push(a.id);
  let deps = 0;
  let fails = 0;
  const sumOf = (id: string, a: number, b: number) => {
    let d = 0;
    let f = 0;
    for (const [k, v] of Object.entries(rec[id] ?? {})) {
      const day = Number(k);
      if (day < a || day > b) continue;
      d += v[0];
      f += v[1];
    }
    return [d, f];
  };
  const byAc: EtopsAcRow[] = ids.map((id) => {
    const a = g.fleet[id];
    const [d, f] = sumOf(id, from, today);
    deps += d;
    fails += f;
    const dr = Math.round(d);
    const fr = Math.round(f);
    return { id, reg: a.reg, type: typeOf(a.typeId).short, age: ageOf(g, a), deps: dr, fails: fr, pct: dr > 0 ? pct1(dr, fr) : null, deferred: Math.round(a.maint.deferred * 100) / 100 };
  }).sort((x, y) => y.fails - x.fails || y.deps - x.deps || (x.reg < y.reg ? -1 : 1));
  deps = Math.round(deps);
  fails = Math.round(fails);
  const minDeps = E().minDeps;
  const pct = deps >= minDeps && deps > 0 ? pct1(deps, fails) : null;
  const causes: Partial<Record<TechCause, number>> = {};
  const idSet = new Set(ids);
  const fl = (g.stats.techFails ?? []).filter((x) => idSet.has(x.ac) && Math.floor(x.t / DAY) >= from);
  for (const x of fl) causes[x.cause] = (causes[x.cause] ?? 0) + 1;
  const span = (a: number, b: number) => ids.reduce((s, id) => { const [d, f] = sumOf(id, a, b); return [s[0] + d, s[1] + f]; }, [0, 0]);
  const [d30, f30] = span(today - 29, today);
  const [dp, fp] = span(today - 59, today - 30);
  const last30 = d30 >= 10 ? pct1(Math.round(d30), Math.round(f30)) : null;
  const prev30 = dp >= 10 && today - 59 >= Math.floor(since / DAY) ? pct1(Math.round(dp), Math.round(fp)) : null;
  // Failures leaving the window in the next 30 days (the window's first 30 days, when it is full).
  const full = today - days + 1 >= Math.floor(since / DAY);
  const leaving30 = full ? fl.filter((x) => Math.floor(x.t / DAY) < from + 30).length : 0;
  const reachAt = projectReach(g, ids, sumOf, { from, today, days, need, minDeps, since, deps, fails });
  const r: EtopsRecord = { min, days, need, minDeps, deps, fails, pct, since, from: from * DAY, byAc, causes, last30, prev30, leaving30, reachAt, advice: [] };
  r.advice = etopsAdvice(g, r);
  return r;
}

/**
 * When the target is met at the last 60 days' pace: day by day the window rolls on (the oldest day leaves, a day at
 * the recent rate of departures and failures comes in). Null when not within a year (or met already: now). Pure.
 */
function projectReach(g: GameState, ids: string[], sumOf: (id: string, a: number, b: number) => number[], w: { from: number; today: number; days: number; need: number; minDeps: number; since: Minute; deps: number; fails: number }): Minute | null {
  if (w.deps >= w.minDeps && w.deps > 0 && pct1(w.deps, w.fails) >= w.need) return g.now;
  const look = Math.min(60, w.today - Math.floor(w.since / DAY) + 1);
  if (look < 14) return null;
  let d60 = 0;
  let f60 = 0;
  for (const id of ids) {
    const [d, f] = sumOf(id, w.today - look + 1, w.today);
    d60 += d;
    f60 += f;
  }
  const dr = d60 / look;
  const fr = f60 / look;
  if (dr <= 0) return null;
  // Per-day totals inside the window, to drop as it rolls.
  const perDay = new Map<number, [number, number]>();
  for (const id of ids) for (let k = w.from; k <= w.today; k++) {
    const [d, f] = sumOf(id, k, k);
    if (!d && !f) continue;
    const p = perDay.get(k) ?? [0, 0];
    perDay.set(k, [p[0] + d, p[1] + f]);
  }
  let deps = w.deps;
  let fails = w.fails;
  let from = w.from;
  for (let k = 1; k <= 365; k++) {
    deps += dr;
    fails += fr;
    if (w.today + k - from + 1 > w.days) {
      const p = perDay.get(from);
      if (p) {
        deps -= p[0];
        fails -= p[1];
      }
      from++;
    }
    if (deps >= w.minDeps && deps > 0 && (deps - fails) / deps >= w.need / 100) return (w.today + k) * DAY;
  }
  return null;
}

/** What would get the ETOPS fleet there, the likeliest first. Pure. */
export function etopsAdvice(g: GameState, r: EtopsRecord): string[] {
  const out: string[] = [];
  const short = r.deps < r.minDeps;
  if (r.pct !== null && r.pct >= r.need) return ['On target: keep flying the ETOPS twins as you do.'];
  if (!r.byAc.length) return [`No twin capable of ETOPS ${r.min} in service yet: its record starts when it flies.`];
  if (g.company.etopsMx?.held !== true) out.push(`Set up the ETOPS maintenance programme: it cuts the twins' defects and AOGs by ${Math.round((1 - E().mxX) * 100)} % once it is ready.`);
  const prog = relProgState(g);
  if (prog === 'none') {
    const n = etopsTwins(g, r.min).length;
    out.push(`Join the ETOPS reliability programme (${usdK(E().programme.costPerTwin * n)} a month for ${n} twin${n === 1 ? '' : 's'}): spares along the ETOPS routes and an engineer on call cut defects by ${Math.round((1 - E().programme.delayX) * 100)} % and AOGs by ${Math.round((1 - E().programme.aogX) * 100)} %, and an AOG away from base is fixed as fast as at home.`);
  }
  const worst = r.byAc[0];
  if (worst && r.fails >= 3 && worst.fails / r.fails >= 0.4 && r.byAc.length >= 1) {
    out.push(`${worst.reg} (${worst.type}, ${worst.age} years) caused ${worst.fails} of the ${r.fails} failures. Age adds about 10 % a year to defects and AOGs: keep its checks early, or replace it with a younger twin (an aircraft that leaves the fleet takes its record with it).`);
  }
  for (const a of r.byAc) {
    if (a.deferred >= 0.12) out.push(`${a.reg} carries deferred defects (${Math.round(a.deferred * 100)} %): the ETOPS pre-departure check holds it for them. An A-check now clears most and lowers its AOG risk.`);
  }
  const aog = r.causes.aog ?? 0;
  if (aog >= 2 && aog >= r.fails / 2) out.push('AOGs cost the most: on the next one swap in a free aircraft (a leg that leaves within 15 minutes counts as on time) or fly in the AOG team.');
  if ((r.causes.etops ?? 0) >= 2 && (r.causes.etops ?? 0) >= r.fails / 3) out.push('The ETOPS pre-departure check holds the twins: keep their deferred defects low (an A-check clears most) and join the reliability programme.');
  if ((r.causes.overrun ?? 0) + (r.causes.grounded ?? 0) >= 2) out.push('Checks ran over or were overdue: book them with room before the next flights, never past their limit.');
  if (short) out.push(`Fly more on the ETOPS twins: ${r.minDeps - r.deps} more revenue departures needed in the window.`);
  if (r.leaving30 > 0) out.push(`${r.leaving30} failure${r.leaving30 === 1 ? '' : 's'} leave${r.leaving30 === 1 ? 's' : ''} the ${r.days}-day window in the next 30 days.`);
  return out;
}

const usdK = (v: number) => (v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : `$${Math.round(v / 1e3)}K`);

// ---------- the ETOPS reliability programme ----------

export type RelProgState = 'none' | 'pending' | 'active';

/** The ETOPS fleet's twins in service (a programme's fee is per twin). Pure. */
export const etopsTwins = (g: GameState, min = 180): Aircraft[] =>
  Object.values(g.fleet).filter((a) => etopsTwin(a.typeId, min) && a.status !== 'delivering' && a.status !== 'leasedOut' && a.status !== 'stored');

export function relProgState(g: GameState): RelProgState {
  const p = g.company.relProg;
  if (!p || p.ended !== undefined) return 'none';
  return p.ready <= g.now ? 'active' : 'pending';
}

/** Why the programme cannot be joined now, or null. Pure. */
export function relProgBlocker(g: GameState): string | null {
  if (relProgState(g) !== 'none') return 'Already in the programme';
  if (!etopsTwins(g, 120).length) return 'Needs an ETOPS twin in service';
  return null;
}

/** Player action: join the ETOPS reliability programme (the pool and the engineer on call in place in 3 weeks; billed monthly). */
export function joinRelProgramme(g: GameState): ActionResult {
  const why = relProgBlocker(g);
  if (why) return { ok: false, error: why };
  const P = E().programme;
  const ready = g.now + P.days * DAY;
  g.company.relProg = { started: g.now, ready, billed: monthKey(g.now) };
  // The first month from the set-up day, pro rata.
  bill(g, 1 - (g.now - monthStartOf(g.now)) / (30.44 * DAY));
  pushMessage(g, { tone: 'info', cat: 'tech', title: 'ETOPS reliability programme: joined', body: `Rotable spares along the ETOPS routes and an engineer on call from ${fmtDate(ready)}. ${usdK(P.costPerTwin)} a twin a month.` });
  return { ok: true, msg: `ETOPS reliability programme from ${fmtDay(ready)}` };
}

/** Player action: leave the programme (from today; nothing refunded). */
export function leaveRelProgramme(g: GameState): ActionResult {
  const p = g.company.relProg;
  if (!p || p.ended !== undefined) return { ok: false, error: 'Not in the programme' };
  p.ended = g.now;
  return { ok: true, msg: 'Left the ETOPS reliability programme' };
}

const monthStartOf = (t: Minute) => {
  const d = new Date(Date.UTC(2000, 0, 1) + t * 60_000);
  return Math.round((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) - Date.UTC(2000, 0, 1)) / 60_000);
};

function bill(g: GameState, share: number): void {
  const n = etopsTwins(g, 120).filter((a) => etopsTwin(a.typeId, 180)).length || etopsTwins(g, 120).length;
  const cost = Math.round(E().programme.costPerTwin * Math.max(1, n) * Math.max(0, Math.min(1, share)));
  if (cost > 0) post(g, 'maintenance', -cost);
}

/** Daily: the programme's month billed on its first day in a new month. */
export function dailyRelProgramme(g: GameState): void {
  const p = g.company.relProg;
  if (!p || p.ended !== undefined) return;
  const mk = monthKey(g.now);
  if (p.billed === mk) return;
  p.billed = mk;
  bill(g, 1);
}

// ---------- effects ----------

/**
 * The ETOPS dispatch standard's chance of a finding that holds this departure: a twin of the ETOPS fleet (capable of
 * 180, with ETOPS held) is kept fit to fly ETOPS on any day, so open defects on ETOPS-significant systems are put right
 * before it leaves instead of being deferred (the ETOPS pre-departure service check). An old airframe and a backlog of
 * deferred defects are held more; the reliability programme halves it. 0 for any other aircraft. Pure.
 */
export function etopsCheckChance(g: GameState, ac: Aircraft): number {
  if (!etopsTwin(ac.typeId, 180) || !g.company.approvals.some((a) => a === 'etops120' || a === 'etops180' || a === 'etops240')) return 0;
  const C = E().check;
  // v0.24 × the preventive maintenance programme's defect factor (ops/pm.ts): fewer findings to hold it.
  return C.base * (1 + ageOf(g, ac) / 10) * (1 + C.deferredX * ac.maint.deferred) * (relProgState(g) === 'active' ? C.progX : 1) * pmFactors(g).delay;
}

/** Factors on an aircraft's technical delay and AOG chances, and whether an AOG away from base is fixed as at home. Pure. */
export function relFactors(g: GameState, ac: Aircraft): { delay: number; aog: number; noOutstation: boolean } {
  if (!etopsTwin(ac.typeId, 180)) return { delay: 1, aog: 1, noOutstation: false };
  let delay = 1;
  let aog = 1;
  if (g.company.etopsMx?.held) {
    delay *= E().mxX;
    aog *= E().mxX;
  }
  const active = relProgState(g) === 'active';
  if (active) {
    delay *= E().programme.delayX;
    aog *= E().programme.aogX;
  }
  return { delay, aog, noOutstation: active };
}
