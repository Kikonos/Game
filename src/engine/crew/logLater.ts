// v0.23.1 log a later report time (the player: "Many charter airlines fudge the numbers (for example, they update the
// roster and it shows that we checked in later, so the duty would be legal). Add this as well at the cost of crew morale.
// Also, this has to be within reason. It cannot be extended for hours on end.")
//
// Crew control writes a report time on the roster later than the crew really reported. It hides one of two limits, and
// only by a little: a rest before the duty short of its minimum, or a day (FDP) over its limit, by at most
// BAL.logLater.capMin minutes. Never anything else (missing crew, a rating, leave, sickness, training, the wrong place,
// days off or the weekly rest), never twice on one duty, and never for a crew member whose roster was already changed
// twice in the last 28 days (they refuse to sign it). The duty keeps both times (Duty.logged: the real report and the
// minutes added); the roster, the crew logs and every legality check read the logged one, so the flight then operates
// as normal. It costs morale (most for the crew whose limit it hides, more when it happens to them again), a little
// fatigue, and carries a risk: a crew report or the authority's audit may find it later (decided on the day on a side
// stream, ops/audit.ts logLaterFound: a fine and an audit finding). scripts/invariants.ts counts these duties apart.

import { BAL } from '../core/balance';
import { DAY, fmtTime } from '../core/time';
import type { AdjustRecord, CrewMember, Duty, GameState, Minute, Pairing } from '../core/types';
import { hashUnit } from '../core/util';
import { opsState } from '../ops/disrupt';
import { crewIssuesFor } from './check';
import { crewName } from './generate';
import { moraleShock } from './morale';
import { infoOf, outOfHours, type OohInfo } from './outOfHours';
import { flightCrewStatus } from './roster';
import { touchCrew } from './timeline';

const L = () => BAL.logLater;

export interface LogLaterOffer {
  ok: true;
  /** Minutes added to the report on the roster (a multiple of stepMin, at most capMin). */
  min: number;
  limit: 'fdp' | 'rest';
  /** The crew whose limit it hides (their seat, or the empty seat they left for it). */
  who: OohInfo[];
  /** Everyone else on the duty (their report is logged later too). */
  others: string[];
}

export type LogLaterCheck = LogLaterOffer | { ok: false; why: string };

/** Changes to crewId's roster in the 28 days before t. Pure. */
export const adjustedRecently = (c: CrewMember | undefined, t: Minute): number => (c?.adjusted ?? []).filter((x) => x > t - L().windowDays * DAY).length;

const ceilStep = (m: number) => Math.ceil(m / L().stepMin) * L().stepMin;

/**
 * Whether a later report time on the roster would hide what keeps flight `flightId` from flying, and by how much.
 * Cheap (no copy of the game): Crew Control's row then tries it on a copy (the preview), and refuses when the flight
 * would still not be legal. Pure.
 */
export function logLaterOffer(g: GameState, flightId: string): LogLaterCheck {
  const f = g.flights[flightId];
  const d = f?.dutyId ? g.duties[f.dutyId] : undefined;
  const p = d ? g.pairings[d.pairingId] : undefined;
  if (!f || !d || !p || d.done || f.status !== 'scheduled') return { ok: false, why: 'No crew plan for this flight yet' };
  if (d.logged) return { ok: false, why: `The report time was already logged ${d.logged.min} min later once on this duty` };
  const lv = flightCrewStatus(g, flightId, { live: false }).level;
  if (lv !== 'missing' && lv !== 'illegal') return { ok: false, why: 'Only for a short rest or a day over its limit' };
  const list = outOfHours(g, flightId);
  if (!list.length) return { ok: false, why: 'Only for a short rest or a day over its limit' };
  // Every reason the crew can't fly must be one of the two limits, with a number (a rule in its own words is not).
  const own = new Set(list.map((x) => x.crewId));
  for (const b of crewIssuesFor(g, d)) {
    const x = infoOf(g, b.crewId, b.issue);
    if (!x || (x.limit !== 'rest' && x.limit !== 'fdp') || x.text || !x.overMin) return { ok: false, why: 'Only for a short rest or a day over its limit' };
    own.add(b.crewId);
  }
  for (const x of list) if ((x.limit !== 'rest' && x.limit !== 'fdp') || x.text || !x.overMin) return { ok: false, why: 'Only for a short rest or a day over its limit' };
  // An empty seat must be one a crew member left for one of these limits (else crew are missing: no later time helps).
  for (const s of p.slots) if (!s.crewId && !s.above && !(s.ooh && list.some((x) => x.crewId === s.ooh!.crewId))) return { ok: false, why: 'Seats are empty: a later report time does not crew a flight' };
  const over = Math.max(...list.map((x) => x.overMin));
  const min = ceilStep(over);
  if (min > L().capMin) return { ok: false, why: `${Math.round(over)} min over: too much to hide (at most ${L().capMin} min)` };
  const limit = list.some((x) => x.limit === 'fdp') ? 'fdp' : 'rest';
  const refuse = list.find((x) => adjustedRecently(g.crew[x.crewId], g.now) >= L().refuseAt);
  if (refuse) return { ok: false, why: `${refuse.name.split(' ')[0]} refuses: their report time was changed twice this month` };
  const others = p.slots.map((s) => s.crewId).filter((id): id is string => !!id && !own.has(id));
  return { ok: true, min, limit, who: list, others };
}

/** Morale for one crew member whose limit it hides: base + per10 for each 10 min, ×repeatX when it happened before. */
export function logLaterMorale(min: number, before: number): number {
  const M = L().morale;
  const v = M.base + M.per10 * Math.ceil(min / 10);
  return before > 0 ? v * M.repeatX : v;
}

/** The short label: 'Log a later report time (+40 min)'. */
export const logLaterLabel = (min: number) => `Log a later report time (+${min} min)`;

/**
 * Applies the change on `g` (Crew Control's runFix, on the live game or a preview copy): the duty's logged report, the
 * duty re-measured from it (by the caller: syncDuty), morale and fatigue, the record and its side-stream roll. Returns
 * the lines Crew Control shows. The caller seats again whoever left a seat for the limit and checks the result.
 */
export function writeLogLater(g: GameState, d: Duty, _p: Pairing, no: string, o: LogLaterOffer): string[] {
  const C = L();
  const real = d.report;
  d.logged = { min: o.min, at: g.now, limit: o.limit, crewIds: o.who.map((x) => x.crewId), real };
  const lines: string[] = [`Report on the roster ${fmtTime(real + o.min)} instead of ${fmtTime(real)} UTC (+${o.min} min) for the crew of ${no}`];
  const hit: string[] = [];
  for (const x of o.who) {
    const c = g.crew[x.crewId];
    if (!c) continue;
    const before = adjustedRecently(c, g.now);
    const m = logLaterMorale(o.min, before);
    moraleShock(g, c, 'logLater', m);
    c.fatigue = Math.min(100, c.fatigue + C.fatigue);
    c.adjusted = [...(c.adjusted ?? []).filter((t) => t > g.now - C.windowDays * DAY), g.now];
    hit.push(`${crewName(c)} ${m}`);
  }
  for (const id of o.others) {
    const c = g.crew[id];
    if (!c) continue;
    moraleShock(g, c, 'logLater', C.morale.others);
  }
  const onDuty = new Set([...o.who.map((x) => x.crewId), ...o.others]);
  for (const c of Object.values(g.crew)) if (!onDuty.has(c.id) && c.status !== 'joining') moraleShock(g, c, 'logLater', C.morale.company);
  lines.push(`Morale ${hit.join(', ')}${o.others.length ? `; ${C.morale.others} for the other ${o.others.length} crew` : ''}; a little for everyone`);
  // The side stream: whether (and how) it comes to light, decided now so a reload finds the same.
  const ops = opsState(g);
  const year = (ops.adjusted ?? []).filter((a) => a.t > g.now - 365 * DAY).length;
  const chance = Math.min(C.findMax, C.findBase + C.findPer * year);
  const key = `${g.seed}:logLater:${d.id}:${g.now}`;
  const rec: AdjustRecord = { t: g.now, dutyId: d.id, no, min: o.min, limit: o.limit, crewIds: d.logged.crewIds };
  if (hashUnit(key) < chance) {
    const report = hashUnit(`${key}:how`) < 0.5;
    const [lo, hi] = C.reportDays;
    rec.how = report ? 'report' : 'audit';
    rec.foundAt = report ? g.now + Math.round((lo + hashUnit(`${key}:when`) * (hi - lo)) * DAY) : Math.max(ops.audit.next, g.now + 7 * DAY);
  }
  ops.adjusted = [...(ops.adjusted ?? []).filter((a) => a.t > g.now - 400 * DAY), rec];
  lines.push(`Risk: a crew report or an audit may find it later (a fine and an audit finding)`);
  touchCrew(g);
  return lines;
}
