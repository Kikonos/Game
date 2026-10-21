// Random operational events and the decision resolvers (B3). DESIGN.md §5.8.
// Every resolver is keyed by decision.kind; it applies its effects and the decision is removed.

import { chooseLease, type LeaseChoice } from './leaseReturn';
import { AIRPORT_BY_CODE } from '../../data/airports';
import { COUNTRIES } from '../../data/countries';
import type { RatingFamily } from '../../data/acmiTypes';
import { BAL } from '../core/balance';
import { addFlight, flightsOf, reassignFlights } from '../core/entities';
import { cashOnly, post } from '../core/ledger';
import { pushDecision, pushMessage } from '../core/messages';
import { blockMinutes, canFill, complement, reportMinutes, typeOf } from '../core/perf';
import { schedule } from '../core/queue';
import { chance, int, pick, range } from '../core/rng';
import { DAY, fmtDateTime, fmtDay, fmtDuration, fmtTime, localMinuteOfDay, monthKey, toDate } from '../core/time';
import type { ActionResult, Aircraft, Contract, CrewMember, CrewStatus, Decision, DecisionOption, Flight, GameState, MaintenanceEvent, MessageCat, Minute, Receivable, Role, SimEvent } from '../core/types';
import { generateOffer, planPositioning } from '../contracts';
import { applyDiscretion, flightCrewStatus, minRest, moraleShock, replaceCrew, rerosterFrom, rosterOf } from '../crew';
import { applyHold, cancelCost, cancelLegs, crewBlocked, delayChain, moveFlight, pickRival, planHold, planRecovery, rivalFactor, stationOf, subcharterCost, subcharterLegs, windowLegs } from './flights';
import { setAogEnd } from './maintenance';
import { ticketBlock } from './commercial';
import { bumpReliable, bumpRelation, isRevenue, stats, turnOf, usd } from './util';

type Data = Record<string, string | number | boolean>;
const num = (d: Data | undefined, k: string) => Number(d?.[k] ?? 0);
const str = (d: Data | undefined, k: string) => String(d?.[k] ?? '');
const city = (code: string) => AIRPORT_BY_CODE[code]?.city ?? code;
const rivalName = (g: GameState, id: string) => g.rivals.find((r) => r.id === id)?.name ?? 'a rival operator';
const revCount = (legs: Flight[]) => legs.filter(isRevenue).length;
const legsChip = (legs: Flight[]) => `${revCount(legs)} leg${revCount(legs) === 1 ? '' : 's'}`;
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** An open decision of this kind about an aircraft or flight. */
export function hasOpenDecision(g: GameState, kind: string, key: string): boolean {
  return g.decisions.some((d) => d.kind === kind && (d.data?.aircraftId === key || d.data?.flightId === key || d.ref?.id === key));
}

// ---------- pacing ----------

/** Decisions posted to the player in the last 7 days (pacing budget; pruned here). */
function recentAsks(g: GameState): number[] {
  const s = stats(g);
  s.askedAt = (s.askedAt ?? []).filter((t) => t > g.now - 7 * DAY);
  return s.askedAt;
}

/**
 * An optional question fits the pacing (DESIGN §5.8): fewer than 2 open, and fewer than 3 this week with one of
 * them kept for the questions that can't wait (AOG, rescue).
 */
export const canAsk = (g: GameState) => g.decisions.length < BAL.maxOpenDecisions && recentAsks(g).length < BAL.maxDecisionsWeek - 1;

const CAT: Record<string, MessageCat> = { aog: 'tech', crewShort: 'crew', sickCrew: 'crew', latePayment: 'finance', rescue: 'finance', changeRequest: 'commercial', leaseEnd: 'company' };

/** Applies the default (or the next workable option) and explains it in the inbox. `lead` opens the message body. */
function autoApply(g: GameState, d: Omit<Decision, 'id' | 't'>, lead = 'Operations chose'): void {
  const tmp: Decision = { ...d, id: '', t: g.now };
  const fn = RESOLVERS[d.kind];
  const order = [d.defaultOption, ...d.options.map((o) => o.id).filter((id) => id !== d.defaultOption)];
  for (const id of order) {
    const r: ActionResult = fn ? fn(g, tmp, id) : { ok: true };
    if (!r.ok) continue;
    const opt = d.options.find((o) => o.id === id);
    pushMessage(g, { tone: 'info', cat: CAT[d.kind] ?? 'ops', title: d.title, body: `${d.body} ${lead}: ${opt?.label ?? id}.${r.msg ? ` ${r.msg}.` : ''}`, ref: d.ref });
    return;
  }
}

/** Posts a decision; an optional one over the pacing budget is applied by operations instead (inbox message). */
function ask(g: GameState, d: Omit<Decision, 'id' | 't'>, must = false): Decision | null {
  if (!must && !canAsk(g)) {
    autoApply(g, d);
    return null;
  }
  recentAsks(g).push(g.now);
  return pushDecision(g, { ...d, data: { ...d.data, paced: true } });
}

/**
 * settle: decisions other modules post directly (crew's 'sickCrew') join the same budget the moment they appear;
 * over it, operations apply the default and say so in the inbox. Cheap: only unseen decisions are looked at.
 */
export function paceDecisions(g: GameState): void {
  for (const d of g.decisions.filter((x) => !x.data?.paced)) {
    d.data = { ...d.data, paced: true };
    const others = g.decisions.length - 1;
    if (others < BAL.maxOpenDecisions && recentAsks(g).length < BAL.maxDecisionsWeek - 1) {
      recentAsks(g).push(d.t);
      continue;
    }
    g.decisions.splice(g.decisions.indexOf(d), 1);
    autoApply(g, d);
  }
}

// ---------- AOG ----------

interface Swap {
  ac: Aircraft;
  from: string;
  arrive: Minute;
  moves: { f: Flight; std: Minute }[];
}

/** Another aircraft of the family that can reach `at` and fly the window legs without touching its own work. Pure. */
function findSwap(g: GameState, ac: Aircraft, legs: Flight[], at: string): Swap | null {
  if (!revCount(legs)) return null;
  const fam = typeOf(ac.typeId).family;
  let best: Swap | null = null;
  for (const b of Object.values(g.fleet)) {
    if (b.id === ac.id || typeOf(b.typeId).family !== fam || b.cabin.total < ac.cabin.total * 0.9) continue;
    if (b.status !== 'available' && b.status !== 'flying') continue;
    const cur = b.flightId ? g.flights[b.flightId] : undefined;
    const from = cur ? cur.to : b.at;
    const ready = cur ? (cur.eta ?? cur.sta) + turnOf(b) : g.now;
    const arrive = from === at ? ready : Math.max(ready, g.now + 60) + blockMinutes(b.typeId, from, at);
    const turn = turnOf(b);
    let t = arrive + (from === at ? 30 : turn);
    const moves = legs.map((f) => {
      const std = Math.max(f.std, t);
      t = std + f.block + turn;
      return { f, std };
    });
    const busyTo = t + 3 * 60;
    const clash = flightsOf(g, b.id).some((f) => f.status === 'scheduled' && f.kind !== 'positioning' && f.std < busyTo && f.sta > g.now);
    const mclash = Object.values(g.maintenance).some((m) => m.aircraftId === b.id && (m.status === 'planned' || m.status === 'inWork') && m.start < busyTo && m.end > g.now);
    if (clash || mclash) continue;
    if (!best || arrive < best.arrive) best = { ac: b, from, arrive, moves };
  }
  return best;
}

const holdChips = (g: GameState, h: ReturnType<typeof planHold>): string[] => {
  const n = revCount(h.cancels);
  return n ? [`${plural(n, 'leg')} cancelled`, usd(-cancelCost(g, h.cancels))] : h.moves.length ? [`${plural(h.moves.length, 'leg')} delayed`] : [];
};

/** The 5-option recovery menu (RESEARCH §5.7); always asked, the clock pauses on 'aog'. */
export function aogDecision(g: GameState, ac: Aircraft, f: Flight, m: MaintenanceEvent): void {
  const fixC = m.end + 30;
  const teamEnd = g.now + Math.round((m.end - g.now) * BAL.aogTeamFactor);
  const teamCost = Math.round(range(g, BAL.aogTeamCost[0], BAL.aogTeamCost[1]) / 100) * 100;
  const roll = range(g, BAL.subcharterFactor[0], BAL.subcharterFactor[1]);
  const rivalId = pickRival(g, ac.typeId);
  const factor = Math.round(roll * rivalFactor(g, rivalId) * 100) / 100;
  const holdC = planHold(g, ac, m.at, fixC);
  const holdT = planHold(g, ac, m.at, teamEnd + 30);
  const win = windowLegs(g, ac, m.at, fixC);
  const sub = subcharterCost(g, win, factor);
  const pen = cancelCost(g, win);
  const swap = findSwap(g, ac, win, m.at);
  const hrs = (t: Minute) => `~${fmtDuration(t - g.now)}`;
  const options: DecisionOption[] = [
    { id: 'courier', label: 'Wait for the part', desc: `A spare comes by courier. Legs wait; base legs held over ${BAL.holdMax / 60} h are cancelled.`, tone: 'warn', chips: [hrs(m.end), usd(-m.cost), ...holdChips(g, holdC)] },
    { id: 'team', label: 'Fly in an AOG team', desc: 'Engineers and the part on the next flight: faster, dearer.', tone: 'warn', chips: [hrs(teamEnd), usd(-(m.cost + teamCost)), ...holdChips(g, holdT)] },
    swap
      ? { id: 'swap', label: `Swap in ${swap.ac.reg}`, desc: swap.from === m.at ? `${swap.ac.reg} is here and free: it takes over the legs.` : `${swap.ac.reg} ferries ${swap.from}–${m.at} and takes over the legs.`, tone: 'good', chips: [swap.from === m.at ? 'No ferry' : `Ferry ${fmtDuration(blockMinutes(swap.ac.typeId, swap.from, m.at))}`, `First leg ${fmtTime(swap.moves[0]?.std ?? swap.arrive)} UTC`, legsChip(win)] }
      : { id: 'swap', label: 'Swap aircraft', desc: 'No other aircraft of this type is free to take over now.', tone: 'bad', chips: ['Unavailable'] },
    { id: 'subcharter', label: `Sub-charter to ${rivalName(g, rivalId)}`, desc: 'A rival flies the legs; we still bill the client. No reliability hit.', tone: 'warn', chips: [usd(-sub), legsChip(win)] },
    { id: 'cancel', label: 'Cancel the legs', desc: 'Compensation to the client and a reliability hit.', tone: 'bad', chips: [usd(-pen), 'Reliability −3', legsChip(win)] },
  ];
  // Sub-charter is the default only when the wait would cancel legs and it is cheaper than their compensation and fares.
  const waitPen = cancelCost(g, holdC.cancels) + subcharterCost(g, holdC.cancels, 1);
  const def = waitPen > 0 && sub < waitPen ? 'subcharter' : 'courier';
  ask(g, {
    kind: 'aog', title: `AOG: ${ac.reg} at ${city(m.at)}`,
    body: `${m.cause}. ${f.no} ${f.from}–${f.to} can't leave. With a part by courier the aircraft is back in about ${Math.round((m.end - g.now) / 60)} h.`,
    options, defaultOption: def, expires: g.now + BAL.aogDecisionMin, ref: { kind: 'aircraft', id: ac.id },
    data: { aircraftId: ac.id, maintId: m.id, flightId: f.id, teamEnd, teamCost, factor, rivalId },
  }, true);
}

function resolveAog(g: GameState, d: Decision, opt: string): ActionResult {
  const ac = g.fleet[str(d.data, 'aircraftId')];
  const m = g.maintenance[str(d.data, 'maintId')];
  if (!ac || !m || m.status !== 'inWork') return { ok: true, msg: 'The aircraft is already fixed' };
  const fix = () => m.end + 30;
  switch (opt) {
    case 'courier':
      applyHold(g, planHold(g, ac, m.at, fix()), 'AOG: waiting for parts');
      return { ok: true, msg: `${ac.reg}: part on its way, back about ${fmtDateTime(m.end)}` };
    case 'team':
      setAogEnd(g, m, num(d.data, 'teamEnd'));
      m.cost += num(d.data, 'teamCost');
      applyHold(g, planHold(g, ac, m.at, fix()), 'AOG: engineering team');
      return { ok: true, msg: `AOG team flying to ${city(m.at)}, ${ac.reg} back about ${fmtDateTime(m.end)}` };
    case 'swap': {
      const win = windowLegs(g, ac, m.at, fix());
      const sw = findSwap(g, ac, win, m.at);
      if (!sw) return { ok: false, error: 'No aircraft can take over now' };
      if (sw.from !== m.at && !planPositioning(g, sw.ac.id, m.at, sw.moves[0].std, 'ferry', null)) return { ok: false, error: `${sw.ac.reg} can't reach ${m.at} in time` };
      for (const { f, std } of sw.moves) if (f.status === 'scheduled' && std !== f.std) moveFlight(g, f, std, 'AOG: aircraft swap');
      for (const { f } of sw.moves) f.delay = 0;
      reassignFlights(g, sw.moves.map((x) => x.f.id), sw.ac.id);
      return { ok: true, msg: `${sw.ac.reg} takes over ${plural(revCount(win), 'leg')} from ${ac.reg}` };
    }
    case 'subcharter': {
      const win = windowLegs(g, ac, m.at, fix());
      const rival = str(d.data, 'rivalId');
      const n = subcharterLegs(g, win, rival, subcharterCost(g, win, num(d.data, 'factor') || 1.5));
      return { ok: true, msg: `${rivalName(g, rival)} flies ${plural(n, 'leg')} for us` };
    }
    case 'cancel': {
      const win = windowLegs(g, ac, m.at, fix());
      const pen = cancelLegs(g, win, 'AOG', 3);
      return { ok: true, msg: `${plural(revCount(win), 'leg')} cancelled, ${usd(pen)} compensation` };
    }
  }
  return { ok: false, error: 'Unknown option' };
}

// ---------- crew short ----------

const SLOT_ORDER: Role[] = ['CPT', 'FO', 'CRP', 'CSD', 'SCC', 'CC'];
const UNFIT: CrewStatus[] = ['sick', 'leave', 'training', 'joining'];

/** The leg and those after it until the aircraft is back where it is, or at its station (the trip to cover). */
function tripLegs(g: GameState, ac: Aircraft, f: Flight): Flight[] {
  const station = stationOf(g, f);
  const out: Flight[] = [];
  let loc = f.from;
  let started = false;
  for (const x of flightsOf(g, ac.id)) {
    if (!started) {
      if (x !== f) continue;
      started = true;
    }
    if (x.status !== 'scheduled') continue;
    if (out.length && (loc === f.from || loc === station)) break;
    if (x.from !== loc || out.length >= 16) break;
    out.push(x);
    loc = x.to;
  }
  return out;
}

/** Seats still to crew: the empty ones, a whole fresh complement when the rostered crew is out of hours, none when covered. */
function rolesNeeded(g: GameState, f: Flight, ac: Aircraft): Role[] {
  const cs = flightCrewStatus(g, f.id);
  if (cs.level === 'ok' || cs.level === 'tight') return [];
  if (cs.missing.length) return [...cs.missing];
  return complement(ac.typeId, ac.cabin.total, { extraCabin: f.contractId ? g.contracts[f.contractId]?.requirements.extraCabin ?? 0 : 0 });
}

/**
 * When crew at `at` could report for these seats for a duty of `need` minutes: rested, not sick or on leave then,
 * and not rostered on other work in that window (crew on duty count from their release and rest). Null when the
 * seats can't all be filled from there. Pure.
 */
function readyAt(g: GameState, roles: Role[], at: string, family: RatingFamily, need: number, own: Set<string>): Minute | null {
  const cand: { c: CrewMember; t: Minute }[] = [];
  for (const c of Object.values(g.crew)) {
    if (c.loc !== at || !c.ratings.includes(family) || UNFIT.includes(c.status)) continue;
    let t = c.restUntil;
    if (c.status === 'onDuty') {
      const d = rosterOf(g, c.id, g.now, g.now + 1).find((x) => x.report <= g.now && !x.done);
      if (!d || d.restAt !== at) continue;
      t = d.release + minRest({ dutyMin: d.release - d.report, atHome: at === c.base, augmented: d.augment > 0, tzShift: 0 });
    }
    t = Math.max(g.now, t);
    const end = t + need;
    if (c.blocks?.some((b) => b.from < end && b.to > t)) continue;
    if (rosterOf(g, c.id, t, end).some((x) => !x.done && !own.has(x.id))) continue;
    cand.push({ c, t });
  }
  cand.sort((a, b) => a.t - b.t || (a.c.id < b.c.id ? -1 : 1));
  const taken = new Set<string>();
  let ready = g.now;
  for (const role of [...roles].sort((a, b) => SLOT_ORDER.indexOf(a) - SLOT_ORDER.indexOf(b))) {
    const x = cand.find((y) => !taken.has(y.c.id) && y.c.role === role) ?? cand.find((y) => !taken.has(y.c.id) && canFill(role, y.c.role));
    if (!x) return null;
    taken.add(x.c.id);
    ready = Math.max(ready, x.t);
  }
  return ready;
}

/**
 * When a legal crew could take the leg: crew free at the airport once rested, else a free set from the leg's
 * station (a deployment's hotel) or our home base flown in on a ticket (check-in, the flight, 3 h before report,
 * as B2 plans it). A day out when nobody is free. Pure.
 */
export function crewReadyAt(g: GameState, f: Flight, ac: Aircraft): Minute {
  const roles = rolesNeeded(g, f, ac);
  const report = reportMinutes(ac.typeId).report;
  const fam = typeOf(ac.typeId).family;
  // The duty to cover: report, the trip's legs and turns, 30 min after the last one (capped at a long FDP).
  const legs = tripLegs(g, ac, f);
  const need = Math.min(14 * 60, report + legs.reduce((s, x) => s + x.block, 0) + Math.max(0, legs.length - 1) * turnOf(ac) + 30);
  const own = new Set(legs.map((x) => x.dutyId).filter((x): x is string => !!x));
  let t = Infinity;
  const here = roles.length ? readyAt(g, roles, f.from, fam, need, own) : g.now;
  if (here !== null) t = here + report;
  for (const from of new Set([stationOf(g, f), g.company.homeBase])) {
    if (from === f.from) continue;
    // v0.5.2: tickets take the airline itinerary's time (a connection included), as crew planning books them.
    let travel = BAL.deadheadCheckIn + ticketBlock(from, f.from) + 180;
    // Too long for one duty with the ticket in it: the crew flies out the day before and rests first.
    if (travel + need > 13 * 60) travel += 10 * 60;
    const r = readyAt(g, roles, from, fam, need + travel, own);
    if (r !== null) t = Math.min(t, r + travel + report);
  }
  if (t === Infinity) t = g.now + DAY;
  return Math.max(g.now + 60, Math.ceil(t / 5) * 5);
}

export function crewShortDecision(g: GameState, f: Flight, ac: Aircraft): void {
  const d = f.dutyId ? g.duties[f.dutyId] : undefined;
  const cs = flightCrewStatus(g, f.id);
  const legs = tripLegs(g, ac, f);
  const over = d ? d.fdp - d.maxFdp - (d.discretion ?? 0) : 0;
  const canDisc = !!d && !cs.missing.length && over > 0 && over <= 120 && !d.discretion;
  const roll = range(g, BAL.subcharterFactor[0], BAL.subcharterFactor[1]);
  const rivalId = pickRival(g, ac.typeId);
  const factor = Math.round(roll * rivalFactor(g, rivalId) * 100) / 100;
  const ready = crewReadyAt(g, f, ac);
  const wait = ready - g.now;
  const station = stationOf(g, f);
  // Waiting: the leg leaves at `ready` (its own wave too is dropped past the lateness cap), the rest follow.
  const later = planRecovery(g, ac, f.from, ready, Math.min(f.std, g.now));
  const sub = subcharterCost(g, legs, factor);
  const pen = cancelCost(g, legs);
  const what = cs.missing.length
    ? `no legal ${[...new Set(cs.missing)].join('/')} can take it`
    : over > 0 ? `the crew would run ${fmtDuration(over)} over their duty limit` : 'the rostered crew is out of hours';
  const options: DecisionOption[] = [
    {
      id: 'standby', label: 'Wait for a legal crew',
      desc: f.from === station ? 'A rested crew from the station takes the leg. Passengers wait.' : 'The crew finishes its rest, or a standby crew flies in on a ticket. Passengers wait.',
      tone: 'warn', chips: [`Delay ~${fmtDuration(wait)}`, ...holdChips(g, later)],
    },
  ];
  if (canDisc) options.push({ id: 'discretion', label: "Commander's discretion", desc: `The captain extends the duty by ${fmtDuration(over)} (max 2 h).`, tone: 'warn', chips: ['Morale −3', `FDP +${fmtDuration(over)}`] });
  if (revCount(legs)) options.push({ id: 'subcharter', label: `Sub-charter to ${rivalName(g, rivalId)}`, desc: 'A rival operates the trip; we still bill the client.', tone: 'warn', chips: [usd(-sub), legsChip(legs)] });
  options.push({ id: 'cancel', label: 'Cancel the trip', desc: 'Compensation and a reliability hit.', tone: 'bad', chips: [usd(-pen), 'Reliability −3', legsChip(legs)] });
  // Sub-charter when waiting would cancel revenue legs and the rival costs less than their compensation and fares.
  const lost = cancelCost(g, later.cancels) + subcharterCost(g, later.cancels, 1);
  const def = canDisc ? 'discretion' : revCount(legs) && revCount(later.cancels) && sub < lost ? 'subcharter' : 'standby';
  ask(g, {
    kind: 'crewShort', title: `Crew short: ${f.no} ${f.from}–${f.to}`,
    body: `${f.no} has been waiting ${fmtDuration(f.delay)} at ${city(f.from)}: ${what}.`,
    options, defaultOption: def, expires: g.now + 60, ref: { kind: 'flight', id: f.id },
    data: { flightId: f.id, aircraftId: ac.id, dutyId: d?.id ?? '', factor, rivalId },
  });
}

/** Fills empty slots of the flight's trip (called-in crew lose a day off: morale −4). */
function fillSlots(g: GameState, f: Flight): number {
  const d = f.dutyId ? g.duties[f.dutyId] : undefined;
  const p = d ? g.pairings[d.pairingId] : undefined;
  let n = 0;
  p?.slots.forEach((s, i) => {
    if (s.crewId || s.above) return;
    const r = replaceCrew(g, p.id, i);
    const c = r.ok && r.data ? g.crew[r.data.crewId] : undefined;
    if (c) {
      n++;
      moraleShock(g, c, 'pay', -4);
    }
  });
  return n;
}

/**
 * Holds the leg until a crew can take it and re-rosters against the new time; a second try goes to the next
 * estimate (at least 2 h on). Departure retries the rest (flights.crewProblem) before giving the rotation up.
 */
function waitForCrew(g: GameState, f: Flight, ac: Aircraft): boolean {
  f.crewDecided = true;
  let t = crewReadyAt(g, f, ac);
  for (let i = 0; i < 2; i++) {
    // The first wait is the player's (its chips showed what it drops); on a second, ops sub-charter dropped waves when cheaper.
    delayChain(g, f, t, 'Waiting for a legal crew', true, i > 0);
    rerosterFrom(g, ac.id, g.now);
    if (f.status !== 'scheduled' || !crewBlocked(g, f)) return true;
    const next = crewReadyAt(g, f, ac);
    t = next > f.std ? next : f.std + 120;
  }
  return false;
}

function resolveCrewShort(g: GameState, d: Decision, opt: string): ActionResult {
  const f = g.flights[str(d.data, 'flightId')];
  const ac = f?.aircraftId ? g.fleet[f.aircraftId] : undefined;
  if (!f || !ac || f.status !== 'scheduled') return { ok: true, msg: 'The flight has already been handled' };
  const legs = tripLegs(g, ac, f);
  switch (opt) {
    case 'standby': {
      const ok = waitForCrew(g, f, ac);
      return { ok: true, msg: ok ? `${f.no} now off blocks ${fmtTime(f.std)} UTC` : `${f.no} waits: no legal crew yet, operations keep trying` };
    }
    case 'discretion': {
      const r = applyDiscretion(g, str(d.data, 'dutyId'));
      if (!r.ok) return r;
      f.crewDecided = true;
      schedule(g, g.now, 'flight.dep', f.id, f.ev);
      return r;
    }
    case 'subcharter': {
      const rival = str(d.data, 'rivalId');
      const n = subcharterLegs(g, legs, rival, subcharterCost(g, legs, num(d.data, 'factor') || 1.5));
      return { ok: true, msg: `${rivalName(g, rival)} flies ${plural(n, 'leg')} for us` };
    }
    case 'cancel': {
      const pen = cancelLegs(g, legs, 'Crew shortage', 3);
      return { ok: true, msg: `${plural(revCount(legs), 'leg')} cancelled, ${usd(pen)} compensation` };
    }
  }
  return { ok: false, error: 'Unknown option' };
}

/**
 * B2 posts 'sickCrew' (data crewId, flightId) when nobody legal can refill a slot. Its options (call in a crew
 * member / sub-charter / cancel) replace DESIGN's deadhead / blocked-seat / delay trio: the call-in deadheads a
 * replacement through replaceCrew, and a delay is what happens anyway at departure (crew-short decision).
 */
function resolveSick(g: GameState, d: Decision, opt: string): ActionResult {
  const f = g.flights[str(d.data, 'flightId')];
  const ac = f?.aircraftId ? g.fleet[f.aircraftId] : undefined;
  if (!f || !ac || f.status !== 'scheduled') return { ok: true, msg: 'The flight has already been handled' };
  const legs = tripLegs(g, ac, f);
  switch (opt) {
    case 'callIn': {
      const n = fillSlots(g, f);
      if (!n) rerosterFrom(g, ac.id, g.now);
      const ok = flightCrewStatus(g, f.id).level;
      return { ok: true, msg: ok === 'ok' || ok === 'tight' ? `${f.no} is crewed again` : `Nobody could be called in yet: ops will try again before ${f.no}` };
    }
    case 'subcharter': {
      const rival = pickRival(g, ac.typeId);
      const factor = range(g, BAL.subcharterFactor[0], BAL.subcharterFactor[1]) * rivalFactor(g, rival);
      const n = subcharterLegs(g, legs, rival, subcharterCost(g, legs, factor));
      return { ok: true, msg: `${rivalName(g, rival)} flies ${plural(n, 'leg')} for us` };
    }
    case 'cancel': {
      const pen = cancelLegs(g, legs, 'Crew sickness', 3);
      return { ok: true, msg: `${plural(revCount(legs), 'leg')} cancelled, ${usd(pen)} compensation` };
    }
  }
  return { ok: false, error: 'Unknown option' };
}

// ---------- payments and solvency ----------

export function latePaymentDecision(g: GameState, r: Receivable): void {
  const cl = g.clients[r.clientId];
  const name = cl?.name ?? 'A client';
  const days = Math.floor((g.now - r.due) / DAY);
  const ct = r.contractId ? g.contracts[r.contractId] : undefined;
  const live = !!ct && (ct.status === 'active' || ct.status === 'signed');
  ask(g, {
    kind: 'latePayment', title: `${name} is ${days} days late`,
    body: `${usd(r.amount)} for ${r.desc} was due ${fmtDay(r.due)}.`,
    options: [
      { id: 'wait', label: 'Wait', desc: 'They usually pay in the end; until then the cash is not ours.', chips: [`${usd(r.amount)} outstanding`, 'No cost'] },
      { id: 'factor', label: 'Sell the invoice', desc: `A factor pays now, less ${Math.round(BAL.factorDiscount * 100)}%.`, tone: 'warn', chips: [`+${usd(r.amount * (1 - BAL.factorDiscount))} now`, usd(-r.amount * BAL.factorDiscount)] },
      live
        ? { id: 'threaten', label: 'Threaten to suspend service', desc: 'A letter saying we stop flying for them unless paid; usually works within a week, but they will not forget it.', tone: 'bad', chips: ['Relation −20', '70%: paid within 7 days'] }
        : { id: 'threaten', label: 'Send a formal demand', desc: "A lawyer's letter; usually works within a week, but they will not forget it.", tone: 'bad', chips: ['Relation −20', '70%: paid within 7 days'] },
    ],
    defaultOption: 'wait', expires: g.now + 2 * DAY, data: { receivableId: r.id, clientId: r.clientId },
  });
}

function resolveLatePayment(g: GameState, d: Decision, opt: string): ActionResult {
  const r = g.finance.receivables.find((x) => x.id === str(d.data, 'receivableId'));
  if (!r || r.paid !== null) return { ok: true, msg: 'Already paid' };
  const name = g.clients[r.clientId]?.name ?? 'The client';
  if (opt === 'wait') return { ok: true, msg: `We keep waiting for ${name}` };
  if (opt === 'factor') {
    const fee = Math.round(r.amount * BAL.factorDiscount);
    cashOnly(g, r.amount);
    post(g, 'interest', -fee);
    r.paid = g.now;
    r.factored = true;
    return { ok: true, msg: `Invoice sold: ${usd(r.amount - fee)} in` };
  }
  if (opt === 'threaten') {
    bumpRelation(g, r.clientId, -20);
    if (chance(g, 0.7)) {
      r.payAt = Math.min(r.payAt, g.now + int(g, 1, 7) * DAY);
      schedule(g, r.payAt, 'payment', r.id);
      return { ok: true, msg: `${name} promises to pay by ${fmtDay(r.payAt)}` };
    }
    return { ok: true, msg: `${name} does not reply; the invoice stays open` };
  }
  return { ok: false, error: 'Unknown option' };
}

export function rescueDecision(g: GameState): void {
  const amount = Math.round(range(g, BAL.rescueCash[0], BAL.rescueCash[1]) / 100_000) * 100_000;
  ask(g, {
    kind: 'rescue', title: 'An investor offers a rescue',
    body: `Cash has been negative for ${BAL.rescueDays} days. A private-equity fund offers ${usd(amount)} for 25% of the company.`,
    options: [
      { id: 'accept', label: 'Take the money', desc: 'Cash now; the market notices.', tone: 'warn', chips: [`+${usd(amount)}`, 'Reliability −5'] },
      { id: 'refuse', label: 'Refuse', desc: `Fight on alone: below ${usd(BAL.bankruptFloor)} the company is finished.`, tone: 'bad', chips: ['Risky'] },
    ],
    defaultOption: 'accept', expires: g.now + 3 * DAY, data: { amount },
  }, true);
}

function resolveRescue(g: GameState, d: Decision, opt: string): ActionResult {
  const f = g.finance;
  if (opt === 'accept') {
    cashOnly(g, num(d.data, 'amount'));
    f.rescues = (f.rescues ?? 0) + 1;
    f.negSince = null;
    bumpReliable(g, -5);
    g.company.reputation.clean = Math.max(0, g.company.reputation.clean - 3);
    pushMessage(g, { tone: 'warn', cat: 'finance', title: 'Rescue signed', body: `${usd(num(d.data, 'amount'))} in. A second insolvency will end the company.` });
    return { ok: true, msg: 'Rescue signed' };
  }
  if (opt === 'refuse') {
    f.refusedRescue = true;
    return { ok: true, msg: 'Investor refused' };
  }
  return { ok: false, error: 'Unknown option' };
}

// ---------- client change requests ----------

/** First number n in 700–989 with n and n+1 unused under this prefix (extra rotation pair). */
function freePair(g: GameState, prefix: string): number {
  const used = new Set<number>();
  for (const f of Object.values(g.flights)) if (f.no.startsWith(prefix)) used.add(Number(f.no.slice(prefix.length)));
  let n = int(g, 700, 988);
  for (let i = 0; i < 290; i++, n = n >= 988 ? 700 : n + 1) if (!used.has(n) && !used.has(n + 1)) break;
  return n;
}

function extraRotation(g: GameState, c: Contract): boolean {
  if (c.pattern.kind !== 'base' || c.product.kind !== 'wet') return false;
  const p = c.pattern;
  const ac = g.fleet[c.aircraftIds[0]];
  if (!ac || !p.dests.length) return false;
  const dest = pick(g, p.dests);
  const turn = turnOf(ac);
  const out = blockMinutes(ac.typeId, p.base, dest);
  const back = blockMinutes(ac.typeId, dest, p.base);
  const need = out + turn + back;
  const from = g.now + 36 * 60;
  const to = Math.min(g.now + 8 * DAY, p.to);
  // First daytime gap between two legs at the base that fits an out-and-back.
  let std = 0;
  const list = flightsOf(g, ac.id).filter((f) => f.status === 'scheduled');
  for (let i = 0; i + 1 < list.length && !std; i++) {
    const a = list[i];
    const b = list[i + 1];
    if (a.to !== p.base || b.from !== p.base || a.sta + turn < from || b.std > to) continue;
    for (let t = Math.ceil((a.sta + turn) / 15) * 15; t + need + turn <= b.std; t += 30) {
      const lm = localMinuteOfDay(p.base, t);
      if (lm >= 6 * 60 && lm <= 21 * 60) {
        std = t;
        break;
      }
    }
  }
  if (!std) return false;
  const bh = (out + back) / 60;
  const cl = g.clients[c.clientId];
  // The trade-off: the hours only pay once the month passes its guarantee; they always cost maintenance and
  // bring the next A-check closer.
  const k = monthKey(std);
  let monthMin = c.use[k]?.blockMin ?? 0;
  for (const f of flightsOf(g, ac.id)) if (f.contractId === c.id && f.status === 'scheduled' && isRevenue(f) && monthKey(f.std) === k) monthMin += f.block;
  const mgh = c.product.mghPerMonth * c.aircraftIds.length;
  const paid = Math.max(0, Math.min(bh, monthMin / 60 + bh - mgh));
  const earn = Math.round(paid * c.product.ratePerBH * c.product.excessRate);
  const maint = Math.round(typeOf(ac.typeId).maintBH * bh);
  const aLeft = Math.max(0, Math.round(typeOf(ac.typeId).aCheckFH - ac.maint.fhSinceA));
  ask(g, {
    kind: 'changeRequest', title: `${cl?.name ?? 'Client'} asks for an extra rotation`,
    body: `${p.base}–${dest}–${p.base} on ${fmtDay(std)}, off blocks ${fmtTime(std, p.base)} local. ${bh.toFixed(1)} BH, paid only above the month's ${Math.round(mgh)} guaranteed hours: ${earn ? `about ${paid.toFixed(1)} BH of it would be` : 'this month is planned below it, so it earns nothing extra'}.`,
    options: [
      { id: 'accept', label: 'Fly it', desc: `${ac.reg} flies two more legs; a crew gets an extra duty and ${ac.reg}'s A-check (${aLeft} FH left) comes ${bh.toFixed(1)} FH sooner.`, tone: earn > maint ? 'good' : 'warn', chips: [earn ? `+${usd(earn)}` : 'No extra revenue', `−${usd(maint)} maintenance`, 'Relation +2'] },
      { id: 'decline', label: 'Decline', desc: 'The aircraft and crews keep their rest; the client notes it.', chips: ['Relation −3'] },
    ],
    defaultOption: earn > maint ? 'accept' : 'decline', expires: g.now + DAY, ref: { kind: 'contract', id: c.id },
    data: { contractId: c.id, kind: 'extra', aircraftId: ac.id, dest, std },
  });
  return true;
}

function retimeRequest(g: GameState, c: Contract): boolean {
  const f = Object.values(g.flights)
    .filter((x) => x.contractId === c.id && x.status === 'scheduled' && x.kind === 'revenue' && x.aircraftId && x.std >= g.now + 2 * DAY)
    .sort((a, b) => a.std - b.std)[0];
  if (!f) return false;
  const min = pick(g, [60, 90, 120, 180]);
  const fee = int(g, 15, 50) * 100;
  const cl = g.clients[c.clientId];
  // The trade-off: the crew's duty stretches by the same amount (beyond its limit a fresh crew is needed).
  const d = f.dutyId ? g.duties[f.dutyId] : undefined;
  const lim = d ? d.maxFdp + (d.discretion ?? 0) : 0;
  const over = !!d && d.fdp + min > lim;
  const tight = !!d && !over && d.fdp + min > lim - 30;
  const duty = d ? (over ? `Crew duty over its limit: a fresh crew` : `Crew duty ${fmtDuration(d.fdp + min)} of ${fmtDuration(lim)}`) : 'Crew re-rostered';
  ask(g, {
    kind: 'changeRequest', title: `${cl?.name ?? 'Client'} wants to move ${f.no}`,
    body: `${f.from}–${f.to} on ${fmtDay(f.std)}: depart ${fmtDuration(min)} later (${fmtTime(f.std + min, f.from)} local) for a late group. They pay a change fee; later legs move with it.`,
    options: [
      { id: 'accept', label: 'Agree', desc: over ? "The crew's duty would run past its limit: the roster swaps in a fresh crew, if one is free." : 'Later legs of the aircraft shift if needed.', tone: over || tight ? 'warn' : 'good', chips: [`+${usd(fee)}`, `+${fmtDuration(min)}`, duty] },
      { id: 'decline', label: 'Decline', desc: 'Keep the schedule; the client notes it.', chips: ['Relation −3'] },
    ],
    defaultOption: over ? 'decline' : 'accept', expires: g.now + DAY, ref: { kind: 'flight', id: f.id },
    data: { contractId: c.id, kind: 'retime', flightId: f.id, minutes: min, fee },
  });
  return true;
}

/** A client change request for this contract: an extra rotation on a base programme, a later departure on a trip. */
export function changeRequestFor(g: GameState, c: Contract): boolean {
  return c.pattern.kind === 'base' ? extraRotation(g, c) : retimeRequest(g, c);
}

function resolveChange(g: GameState, d: Decision, opt: string): ActionResult {
  const c = g.contracts[str(d.data, 'contractId')];
  if (!c) return { ok: true };
  if (opt === 'decline') {
    bumpRelation(g, c.clientId, -3);
    return { ok: true, msg: 'Declined' };
  }
  if (opt !== 'accept') return { ok: false, error: 'Unknown option' };
  if (str(d.data, 'kind') === 'retime') {
    const f = g.flights[str(d.data, 'flightId')];
    if (!f || f.status !== 'scheduled') return { ok: true, msg: 'The flight has already left' };
    delayChain(g, f, f.std + num(d.data, 'minutes'), 'Client request');
    post(g, 'otherRevenue', num(d.data, 'fee'));
    bumpRelation(g, c.clientId, 2);
    return { ok: true, msg: `${f.no} moved to ${fmtTime(f.std)} UTC` };
  }
  const ac = g.fleet[str(d.data, 'aircraftId')];
  const p = c.pattern;
  if (!ac || p.kind !== 'base' || (c.status !== 'active' && c.status !== 'signed')) return { ok: true };
  const dest = str(d.data, 'dest');
  const std = num(d.data, 'std');
  const out = blockMinutes(ac.typeId, p.base, dest);
  const back = blockMinutes(ac.typeId, dest, p.base);
  const turn = turnOf(ac);
  const end = std + out + turn + back;
  if (std < g.now + 60 || flightsOf(g, ac.id).some((f) => f.status === 'scheduled' && f.std < end + turn && f.sta > std - turn)) return { ok: false, error: 'The slot is no longer free' };
  const no = freePair(g, p.prefix);
  addFlight(g, { no: `${p.prefix}${no}`, aircraftId: ac.id, contractId: c.id, kind: 'revenue', from: p.base, to: dest, std, sta: std + out });
  addFlight(g, { no: `${p.prefix}${no + 1}`, aircraftId: ac.id, contractId: c.id, kind: 'revenue', from: dest, to: p.base, std: std + out + turn, sta: end });
  bumpRelation(g, c.clientId, 2);
  return { ok: true, msg: `Extra rotation to ${dest} on ${fmtDay(std)}` };
}

// ---------- daily ----------

function changeRequests(g: GameState): void {
  for (const c of Object.values(g.contracts)) {
    if (c.status !== 'active') continue;
    if (!chance(g, BAL.changeRequestWeekly / 7) || !canAsk(g)) continue;
    changeRequestFor(g, c);
  }
}

/** The landing permit for a trip's first leg is late: it moves 6–24 h (permits are auto-filed, RESEARCH §10.1). */
export function permitDelayFor(g: GameState, c: Contract): Flight | null {
  const first = Object.values(g.flights)
    .filter((f) => f.contractId === c.id && f.status === 'scheduled' && isRevenue(f) && f.aircraftId)
    .sort((a, b) => a.std - b.std)[0];
  if (!first) return null;
  const h = int(g, 6, 24);
  const cn = COUNTRIES[AIRPORT_BY_CODE[first.to]?.country ?? '']?.name;
  delayChain(g, first, first.std + h * 60, 'Landing permit pending');
  pushMessage(g, {
    tone: 'warn', cat: 'ops', title: `Permit delay: ${first.no}`,
    body: `The ${cn ? `${cn} ` : ''}landing permit for ${first.from}–${first.to} is not through yet. ${first.no} moved ${h} h to ${fmtDateTime(first.std)} UTC.`,
    ref: { kind: 'flight', id: first.id },
  });
  return first;
}

/** 48 h before a trip with permit risk: p = risk × 0.3. The risk is noted while the signed offer still exists. */
function permitDelays(g: GameState): void {
  const s = stats(g);
  const risks = (s.permits ??= {});
  for (const id of Object.keys(risks)) if (!g.contracts[id]) delete risks[id];
  for (const c of Object.values(g.contracts)) {
    if ((c.status !== 'signed' && c.status !== 'active') || c.pattern.kind !== 'legs') {
      delete risks[c.id];
      continue;
    }
    if (!(c.id in risks)) {
      if (c.start < g.now + DAY) continue;
      risks[c.id] = g.offers[c.offerId]?.risk.permit ?? 0;
    }
    if (c.start >= g.now + 2 * DAY) continue;
    const risk = risks[c.id];
    delete risks[c.id];
    if (c.start >= g.now + DAY && risk && chance(g, risk * 0.3)) permitDelayFor(g, c);
  }
}

/** 1 Feb, 1 Mar, 1 Sep: tender season reminder when an aircraft has nothing for two weeks. */
export function seasonNudge(g: GameState): boolean {
  const d = toDate(g.now);
  if (d.getUTCDate() !== 1 || ![1, 2, 8].includes(d.getUTCMonth())) return false;
  const idle = Object.values(g.fleet).filter((ac) => {
    if (ac.status === 'delivering' || ac.status === 'stored' || ac.status === 'leasedOut') return false;
    if (flightsOf(g, ac.id).some((f) => f.status === 'scheduled' && f.std < g.now + 14 * DAY)) return false;
    return !Object.values(g.contracts).some((c) => (c.status === 'signed' || c.status === 'active') && c.aircraftIds.includes(ac.id) && c.start < g.now + 14 * DAY);
  });
  if (!idle.length) return false;
  const season = d.getUTCMonth() === 8 ? 'Winter' : 'Summer';
  pushMessage(g, {
    tone: 'info', cat: 'commercial', title: `${season} tenders are out`,
    body: `Airlines are buying ${season.toLowerCase()} capacity now. ${idle.map((a) => a.reg).join(', ')} ${idle.length > 1 ? 'have' : 'has'} nothing in the next two weeks: check the market.`,
  });
  return true;
}

/** Daily rolls: client change requests, permit delays, season nudges, urgent evacuation offers (via contracts). */
export function dailyEvents(g: GameState): void {
  changeRequests(g);
  permitDelays(g);
  seasonNudge(g);
  if (chance(g, BAL.evacuationPerDay)) generateOffer(g, 'repatriation', { start: g.now + int(g, 20, 60) * 60 });
}

// ---------- resolution ----------

type Resolver = (g: GameState, d: Decision, opt: string) => ActionResult;
const RESOLVERS: Record<string, Resolver> = {
  aog: resolveAog,
  crewShort: resolveCrewShort,
  sickCrew: resolveSick,
  latePayment: resolveLatePayment,
  rescue: resolveRescue,
  changeRequest: resolveChange,
  // v0.7: the 120-day lease notice (extend 12 / 36 months or return).
  leaseEnd: (g, d, opt) => chooseLease(g, String(d.data?.aircraftId ?? ''), opt as LeaseChoice),
};

/** Applies a decision option (dispatch on decision.kind) and removes the decision. Failed options keep it open. */
export function resolveDecision(g: GameState, decisionId: string, optionId: string): ActionResult {
  const i = g.decisions.findIndex((d) => d.id === decisionId);
  if (i < 0) return { ok: false, error: 'Decision not found' };
  const d = g.decisions[i];
  if (!d.options.some((o) => o.id === optionId)) return { ok: false, error: 'Unknown option' };
  const fn = RESOLVERS[d.kind];
  const r: ActionResult = fn ? fn(g, d, optionId) : { ok: true };
  if (!r.ok) return r;
  const j = g.decisions.indexOf(d);
  if (j >= 0) g.decisions.splice(j, 1);
  stats(g).decisions++;
  return r;
}

/** 'decision.expire': the default option applies; if it can't, the next workable option. The inbox says which. */
export function onDecisionExpire(g: GameState, ev: SimEvent): void {
  const d = g.decisions.find((x) => x.id === ev.id);
  if (!d) return;
  const order = [d.defaultOption, ...d.options.map((o) => o.id).filter((id) => id !== d.defaultOption)];
  for (const id of order) {
    const r = resolveDecision(g, d.id, id);
    if (!r.ok) continue;
    const opt = d.options.find((o) => o.id === id);
    pushMessage(g, { tone: 'info', cat: CAT[d.kind] ?? 'ops', title: `No answer: ${d.title}`, body: `Time ran out, so operations chose: ${opt?.label ?? id}.${r.msg ? ` ${r.msg}.` : ''}`, ref: d.ref });
    return;
  }
  const j = g.decisions.indexOf(d);
  if (j >= 0) g.decisions.splice(j, 1);
}
