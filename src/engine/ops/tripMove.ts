// v0.7.2.1 Trip swap: move a whole trip (DUB–DUS–DUB, or a connected chain) from one of our aircraft to another,
// with a plain-words quote of what it changes: the money before and after, the ferries it needs, the crew who come
// off and go on, and what the first aircraft is free for. Player request; UI: Schedule drag and drop, flight sheet.
//
// The quote runs the move on a copy of the game (as Crew Control's previews do) so the ferries, crew and tickets it
// shows are exactly what the move will do; the real game is never touched (no rng, no ids, no pauses).
//
// Not re-exported from ops/index: it settles the copy through sim.ts, which imports the ops module.

import { BAL } from '../core/balance';
import { flightsOf, flightsRev, reassignFlights, retimeFlight, touchFlights } from '../core/entities';
import { distance } from '../core/geo';
import { isolatePauses } from '../core/pause';
import { blockMinutes, canFill, complement, etopsNeeded, planSector, runwayFit, typeOf } from '../core/perf';
import { DAY, fmtDateTime, fmtDay, fmtDuration, fmtTime } from '../core/time';
import type { ActionResult, Aircraft, Contract, Flight, GameState, Minute, Pairing, Role } from '../core/types';
import { brokerCut } from '../contracts/accept';
import { SHORT_CYCLE_MIN } from '../contracts/billing';
import { anchorsOf, chainBackward, chainForward, chainsOf, isSoft, SOFT_AFTER, type Anchor } from '../contracts/plan';
import { crewName, crewRev, dutyNeed, flightCrewStatus, rerosterFrom, restOf, restPlanForFlight, type DutyNeed } from '../crew';
import { settle } from '../sim';
import { cabinAt, layoutName, layoutsOf } from './cabin';
import { aircraftGate } from './company';
import { paysFuel } from './flights';
import { isGrounded, relinkCheckFerries } from './maintenance';
import { ageOf, isRevenue } from './util';

/** Legs of a trip are on the ground at most this long between them (an overnight stop at most). */
export const TRIP_LINK_MAX = 18 * 60;
/** A trip leaving sooner than this can't change aircraft any more. */
export const MOVE_LEAD = 60;
/** The trip may leave this much later than planned so the new aircraft can get there (charter penalties over 3 h). */
export const MAX_SHIFT = 3 * 60;
/** Within this, 'You gain' / 'You lose' reads 'About the same'. */
export const SAME_BAND = 500;

// ---------- the trip ----------

export interface TripView {
  ok: boolean;
  /** Why it can't move (plain words). */
  reason?: string;
  /** Every leg of the trip in order (positioning legs of the contract included), for highlighting. */
  legs: Flight[];
  /** The legs that change aircraft (empty positioning is re-planned for both aircraft instead). */
  moved: Flight[];
  aircraftId: string | null;
  contractId: string | null;
  /** 'DUB–DUS–DUB'. */
  label: string;
  start: Minute;
  end: Minute;
}

const none = (reason: string, f?: Flight): TripView => ({
  ok: false, reason, legs: f ? [f] : [], moved: [], aircraftId: f?.aircraftId ?? null, contractId: f?.contractId ?? null, label: f ? `${f.from}–${f.to}` : '', start: f?.std ?? 0, end: f?.sta ?? 0,
});

/** 'DUB–DUS–DUB' from connected legs. */
function routeLabel(legs: Flight[]): string {
  if (!legs.length) return '';
  const out = [legs[0].from];
  for (const f of legs) {
    if (out[out.length - 1] !== f.from) out.push('·', f.from);
    out.push(f.to);
  }
  return out.join('–').replace(/–·–/g, ' · ');
}

/**
 * The whole trip a leg belongs to on its aircraft: the legs of the same contract connected end to start (on the
 * ground ≤ 18 h between them) from where it leaves its station (the client base of a base programme, else our home
 * base) until it is back where it started or at the station; one-way chains run to the next break. The contract's
 * own positioning legs in the chain belong to it. Refused when a leg of it has left already. Pure.
 */
export function tripOf(g: GameState, flightId: string): TripView {
  const f = g.flights[flightId];
  if (!f) return none('Flight not found');
  if (!f.aircraftId || f.operatedBy) return none('Another operator flies this leg', f);
  if (f.kind === 'deadhead') return none('Crew tickets are airline flights, not ours', f);
  if (f.status === 'cancelled') return none('This leg is cancelled', f);
  if (f.status === 'done') return none('This leg has already flown', f);
  if (f.status === 'enroute') return none('This leg is in the air', f);
  if (f.kind === 'ferry' || f.purpose) return none('A ferry flight stays with its aircraft (delivery, checks, returns)', f);
  const c = f.contractId ? g.contracts[f.contractId] : undefined;
  if (!c) return none('Empty positioning legs follow the aircraft’s work by themselves: move the trip they lead to', f);
  const station = c.pattern.kind === 'base' ? c.pattern.base : g.company.homeBase;
  const legs = flightsOf(g, f.aircraftId).filter((x) => x.status !== 'cancelled');
  const i = legs.indexOf(f);
  const mine = (x: Flight) => x.contractId === f.contractId && x.kind !== 'ferry' && !x.purpose && x.kind !== 'deadhead';
  const link = (a: Flight, b: Flight) => mine(a) && mine(b) && a.to === b.from && b.std - a.sta <= TRIP_LINK_MAX;
  let lo = i;
  while (lo > 0 && legs[lo].from !== station && link(legs[lo - 1], legs[lo])) lo--;
  let hi = i;
  while (hi + 1 < legs.length && legs[hi].to !== legs[lo].from && legs[hi].to !== station && link(legs[hi], legs[hi + 1])) hi++;
  const chain = legs.slice(lo, hi + 1);
  const rev = chain.filter(isRevenue);
  const first = rev[0] ?? f;
  const last = rev[rev.length - 1] ?? f;
  const core = chain.slice(chain.indexOf(first), chain.indexOf(last) + 1);
  const moved = core.filter((x) => !isSoft(g, x));
  const view: TripView = {
    ok: true, legs: chain, moved, aircraftId: f.aircraftId, contractId: c.id, label: routeLabel(core),
    start: moved[0]?.std ?? f.std, end: moved[moved.length - 1]?.sta ?? f.sta,
  };
  const gone = chain.find((x) => x.status !== 'scheduled');
  if (gone) return { ...view, ok: false, reason: `This trip is under way: ${gone.from}–${gone.to} left at ${fmtTime(gone.atd ?? gone.std)}. Only a trip that hasn't started can change aircraft` };
  if (!rev.length) return { ...view, ok: false, reason: 'Empty positioning legs follow the aircraft’s work by themselves: move the trip they lead to' };
  const lead = Math.min(...moved.map((x) => x.std + x.delay)) - g.now;
  if (lead < MOVE_LEAD) return { ...view, ok: false, reason: `${first.from}–${first.to} leaves in ${fmtDuration(Math.max(0, lead))}: too late to change aircraft` };
  // v0.7.2.2: the empty legs flying the aircraft out to the trip go with it (re-planned); one already leaving can't.
  const k = legs.indexOf(moved[0] ?? first);
  for (let j = k - 1; j >= 0 && k >= 0; j--) {
    const x = legs[j];
    const nx = legs[j + 1];
    if (x.status === 'done' || x.to !== nx.from || nx.std - x.sta > TRIP_LINK_MAX || x.kind !== 'positioning') break;
    if (x.status !== 'scheduled' || x.std <= g.now + SOFT_AFTER) return { ...view, ok: false, reason: `The empty ${x.from}–${x.to} flight to this trip ${x.status === 'scheduled' ? `leaves in ${fmtDuration(Math.max(0, x.std - g.now))}` : 'has left'}: too late to change aircraft` };
  }
  return view;
}

// ---------- the plan (pure checks, no copy) ----------

interface Plan {
  trip: TripView;
  src: Aircraft;
  tgt: Aircraft;
  /** New [std, sta] of each moved leg. */
  times: Map<string, [Minute, Minute]>;
  /** How much later the trip leaves so the new aircraft can get there. */
  shift: number;
  reasons: string[];
  /** v0.7.3 the worst crew day of the trip on the target (its rest facilities): 3 or 4 pilots, extension, split. */
  need: DutyNeed | null;
}

const NEED_RANK: Record<DutyNeed['mode'], number> = { basic: 0, split: 1, ext: 2, aug1: 3, aug2: 4, none: 9 };

/**
 * v0.7.3 the worst crew day of these legs on a type with these rest facilities: the legs cut into crew days as the
 * contract checks do (night stops, a crew change at home base), each through dutyNeed (Table 2 at its report time,
 * split duty, planned extension, 3 or 4 pilots with the in-flight rest plan). Pure.
 */
function tripNeed(g: GameState, typeId: string, rest: ReturnType<typeof restOf>, legs: { std: Minute; sta: Minute; from: string; to: string }[]): DutyNeed | null {
  let worst: DutyNeed | null = null;
  for (const c of chainsOf(legs, g.company.homeBase)) {
    const n = dutyNeed(g, typeId, rest, c);
    if (!worst || NEED_RANK[n.mode] > NEED_RANK[worst.mode] || (n.mode === worst.mode && n.fdp > worst.fdp)) worst = n;
  }
  return worst;
}

/** 'A330', '737', 'A321' (the plain type name a player says), from 'Airbus A330-200'. */
const typeWord = (typeId: string) => { const t = typeOf(typeId); return t.name.match(/\b(A\d{3}|[1-9]\d7)\b/)?.[1] ?? t.short; };
const an = (w: string) => (/^(A|E|F|H|I|L|M|N|O|R|S|X|8|11|18)/i.test(w) ? 'An' : 'A');
const km = (a: string, b: string) => `${Math.round(distance(a, b) / 100) * 100 >= 1000 ? (Math.round(distance(a, b) / 100) * 100).toLocaleString('en-US') : Math.round(distance(a, b))} km`;
/** '20h 00m' up to two days, then '20 days' / '3 days 4h'. */
const span = (min: number) => (min < 2 * DAY ? fmtDuration(min) : `${Math.floor(min / DAY)} days${Math.floor((min % DAY) / 60) ? ` ${Math.floor((min % DAY) / 60)}h` : ''}`);
const until = (g: GameState, t: Minute) => (t - g.now < 2 * DAY ? `${fmtDay(t)} ${fmtTime(t)}` : fmtDay(t));

const MAINT_PHRASE: Record<string, string> = { A: 'in an A-check', C: 'in a C-check', AOG: 'AOG (under repair)', line: 'in line maintenance', paint: 'at the paint shop', refit: 'in a cabin refit', return: 'in its lease return check' };

/** 'CS-TQB is flying LIS–FCO 09:10–12:00 at that time' / 'CS-TQB is in a C-check until 4 Sep'. */
function busyText(g: GameState, ac: Aircraft, a: Anchor, day: Minute): string {
  if (a.kind === 'maint') {
    const m = g.maintenance[a.id];
    return `${ac.reg} is ${MAINT_PHRASE[m?.kind ?? 'line'] ?? 'in maintenance'} until ${until(g, a.sta)}`;
  }
  if (a.kind === 'base') return `${ac.reg} is on the ${g.contracts[a.contractId ?? '']?.title ?? 'season'} programme then`;
  const f = g.flights[a.id];
  const same = Math.floor(a.std / DAY) === Math.floor(day / DAY);
  return `${ac.reg} is flying ${a.from}–${a.to} ${fmtTime(a.std)}–${fmtTime(a.sta)}${same ? '' : ` on ${fmtDay(a.std)}`} at that time${f?.kind === 'positioning' ? ' (positioning)' : ''}`;
}

/** Requirements of the contract the target aircraft doesn't meet (cabin, family, paint, approvals). */
function requirementGaps(g: GameState, c: Contract, src: Aircraft, tgt: Aircraft, legs: Flight[], start: Minute): string[] {
  const out: string[] = [];
  const req = c.requirements;
  const t = typeOf(tgt.typeId);
  const cab = cabinAt(g, tgt, start).cabin;
  const pax = Math.max(0, ...legs.map((f) => f.pax ?? 0));
  if (cab.total < req.minSeats) out.push(`The client needs at least ${req.minSeats} seats; ${tgt.reg} has ${cab.total}`);
  else if (pax > cab.total) out.push(`${pax} passengers are booked; ${tgt.reg} has ${cab.total} seats`);
  if (req.maxSeats && cab.total > req.maxSeats) out.push(`The client wants at most ${req.maxSeats} seats; ${tgt.reg} has ${cab.total}`);
  const want = layoutsOf(req);
  if (want && !want.includes(cab.layout)) out.push(`The client asked for ${want.map(layoutName).join(' or ')} seats; ${tgt.reg} is ${layoutName(cab.layout)}`);
  else if (req.minPremium && cab.j + cab.w < req.minPremium) out.push(`The client asked for ${req.minPremium}+ business seats; ${tgt.reg} has ${cab.j + cab.w || 'none'}`);
  if (req.families?.length && !req.families.includes(t.family)) out.push(`The client only takes ${req.families.join(' or ')} aircraft; ${tgt.reg} is ${an(typeWord(tgt.typeId)).toLowerCase()} ${typeWord(tgt.typeId)}`);
  if (req.body && req.body !== t.body) out.push(`The client asked for a ${req.body === 'wide' ? 'widebody' : 'narrowbody'}; ${tgt.reg} is ${t.body === 'wide' ? 'a widebody' : 'a narrowbody'}`);
  if (c.paint?.accepted && src.paintedFor === c.id && tgt.paintedFor !== c.id) out.push(`The client's livery is on ${src.reg}; ${tgt.reg} is in ${tgt.paintedFor ? 'another client’s' : 'our'} colours`);
  const gate = aircraftGate(g, tgt.typeId);
  if (!gate.ok || gate.pending.length) out.push(`The ${typeWord(tgt.typeId)} can't fly passengers for us yet: ${gate.text.split(':')[0].toLowerCase()}`);
  return out;
}

/** Each crew seat of the target's complement can be filled by someone rated on its type (not leaving, not joining). */
function ratedGap(g: GameState, tgt: Aircraft, c: Contract): string | null {
  const t = typeOf(tgt.typeId);
  const name = typeWord(tgt.typeId);
  const roles = [...new Set(complement(tgt.typeId, tgt.cabin.total, { extraCabin: c.requirements.extraCabin }))];
  const crew = Object.values(g.crew).filter((x) => x.ratings.includes(t.family) && x.status !== 'joining' && !(x.notice && x.notice.leaves <= g.now));
  const miss = roles.filter((r) => !crew.some((x) => canFill(r, x.role)));
  if (!miss.length) return null;
  if (!crew.length || miss.length === roles.length) return `No crew rated on the ${name} can take it`;
  return `No crew rated on the ${name} can take it (no ${miss.map(roleWord).join(' or ')})`;
}

const ROLE_WORD: Record<Role, string> = { CPT: 'captain', FO: 'first officer', CRP: 'relief pilot', PUR: 'purser', CC: 'cabin crew' };
const roleWord = (r: Role) => ROLE_WORD[r] ?? r;

/** The checks that need no copy of the game: what refuses the move and the new leg times. Pure. */
function planMove(g: GameState, flightId: string, targetId: string): Plan | { error: string; trip: TripView } {
  const trip = tripOf(g, flightId);
  const src = trip.aircraftId ? g.fleet[trip.aircraftId] : undefined;
  const tgt = g.fleet[targetId];
  if (!src) return { error: trip.reason ?? 'Flight not found', trip };
  if (!tgt) return { error: 'Aircraft not found', trip };
  const reasons: string[] = [];
  if (!trip.ok) reasons.push(trip.reason ?? 'This trip can’t move');
  if (tgt.id === src.id) reasons.push(`It is already on ${src.reg}`);
  const c = trip.contractId ? g.contracts[trip.contractId] : undefined;
  const t = typeOf(tgt.typeId);
  const turn = t.turnMin;
  // New times: the target's block times (a different type flies at its own speed), turns kept.
  const times = new Map<string, [Minute, Minute]>();
  const block = (f: Flight) => (tgt.typeId === src.typeId ? f.block : blockMinutes(tgt.typeId, f.from, f.to));
  const timeAll = (shift: number) => {
    times.clear();
    let prevSta = -Infinity;
    for (const f of trip.moved) {
      const std = Math.max(f.std + shift, prevSta + turn);
      const sta = std + block(f);
      times.set(f.id, [std, sta]);
      prevSta = sta;
    }
  };
  timeAll(0);
  const plan: Plan = { trip, src, tgt, times, shift: 0, reasons, need: null };
  if (reasons.length || !c) return plan;

  // The aircraft itself.
  if (tgt.status === 'stored') reasons.push(`${tgt.reg} is in storage`);
  if (tgt.status === 'leasedOut') reasons.push(`${tgt.reg} is leased out to another operator`);
  if (tgt.sale) reasons.push(`${tgt.reg} is sold: it goes to ${tgt.sale.buyer} on ${fmtDay(tgt.sale.closes)}`);
  if (tgt.returning) reasons.push(`${tgt.reg} is going back to its lessor`);
  if (tgt.status === 'delivering' && tgt.deliveredAt > trip.start) reasons.push(`${tgt.reg} isn't delivered until ${fmtDay(tgt.deliveredAt)}`);
  if (tgt.ownership.kind === 'dryLeaseIn' && tgt.ownership.leaseEnd < trip.end + DAY) reasons.push(`${tgt.reg}'s lease ends ${fmtDay(tgt.ownership.leaseEnd)}`);
  if (isGrounded(g, tgt)) reasons.push(`${tgt.reg} is grounded: a check is overdue`);
  // Range, runways and ETOPS, leg by leg (the trip's fuel stops stay as they are).
  for (const f of trip.moved) {
    if (f.kind === 'positioning') continue;
    const sp = planSector(tgt.typeId, f.from, f.to);
    if (!sp.ok && sp.reason === 'runway') {
      const ap = runwayFit(tgt.typeId, f.from) === 'no' ? f.from : f.to;
      reasons.push(`${ap}'s runway is too short for the ${typeWord(tgt.typeId)}`);
      break;
    }
    if (!sp.ok || sp.legs.length > 1) {
      reasons.push(`${an(typeWord(tgt.typeId))} ${typeWord(tgt.typeId)} can't fly this ${km(f.from, f.to)} leg (${f.from}–${f.to}) without a fuel stop`);
      break;
    }
    const need = etopsNeeded(tgt.typeId, f.from, f.to);
    if (need > 0 && t.engines !== 4 && t.etopsMax < need) {
      reasons.push(`${f.from}–${f.to} needs ETOPS ${need}; the ${typeWord(tgt.typeId)} is certified to ${t.etopsMax || 'none'}`);
      break;
    }
  }
  reasons.push(...requirementGaps(g, c, src, tgt, trip.moved, trip.start));
  const rated = ratedGap(g, tgt, c);
  if (rated) reasons.push(rated);
  if (reasons.length) return plan;
  // v0.7.3 the crew days on the target's own in-flight rest: a long-haul trip needs the rest it gets now (a
  // 3- or 4-pilot day needs bunks or seats the target has); refused only when it is plannable on its aircraft now.
  const shape = (ac: Aircraft) => trip.moved.map((f) => ({ std: f.std, sta: f.std + (ac.typeId === src.typeId ? f.block : blockMinutes(ac.typeId, f.from, f.to)), from: f.from, to: f.to }));
  plan.need = tripNeed(g, tgt.typeId, restOf(g, tgt.id), shape(tgt));
  if (plan.need?.mode === 'none' && tripNeed(g, src.typeId, restOf(g, src.id), shape(src))?.mode !== 'none') {
    reasons.push(`${tgt.reg} can't crew this trip legally: ${plan.need.text.replace(/^No crew rest → ✗ /, 'no crew rest on board, and ')}`);
    return plan;
  }

  // Its other work: nothing of its own may overlap; it must get there (a short delay allowed) and back.
  const anchors = anchorsOf(g, tgt.id);
  const first = trip.moved[0];
  const last = trip.moved[trip.moved.length - 1];
  const overlap = (): boolean => {
    const s = times.get(first.id)![0];
    const e = times.get(last.id)![1];
    for (const a of anchors) {
      if (a.kind === 'start') continue;
      if (a.std < e + turn && a.sta > s - turn) {
        reasons.push(busyText(g, tgt, a, s));
        return true;
      }
    }
    return false;
  };
  // Busy then (its own flying, a check, its programme) comes first: that is the real reason.
  if (overlap()) return plan;
  let prev: Anchor | null = null;
  for (const a of anchors) if (a.std < first.std && (!prev || a.sta > prev.sta)) prev = a;
  let shift = 0;
  if (prev) {
    const X = prev.to;
    const earliest = prev.kind === 'start' ? prev.sta : prev.sta + turn;
    if (X !== first.from) {
      const back = chainBackward(tgt.typeId, X, first.from, earliest, first.std - turn);
      if (!back) {
        const fwd = chainForward(tgt.typeId, X, first.from, earliest);
        if (!fwd) reasons.push(`${tgt.reg} can't fly from ${X} to ${first.from} (range or runway)`);
        else {
          const arr = fwd[fwd.length - 1].sta;
          shift = Math.ceil((arr + turn - first.std) / 5) * 5;
          if (shift > MAX_SHIFT) reasons.push(`${tgt.reg} can't get to ${first.from} in time: it could land ${fmtDateTime(arr)} UTC, the trip leaves ${fmtTime(first.std)}`);
        }
      }
    } else if (earliest > first.std) {
      shift = Math.ceil((earliest - first.std) / 5) * 5;
      if (shift > MAX_SHIFT) reasons.push(`${tgt.reg} isn't free at ${first.from} until ${fmtDateTime(earliest)} UTC`);
    }
  }
  if (reasons.length) return plan;
  if (shift > 0) {
    timeAll(shift);
    if (overlap()) return plan;
  }
  plan.shift = shift;
  const e = times.get(last.id)![1];
  const next = anchors.find((a) => a.kind !== 'start' && a.std >= e);
  if (next && next.from !== last.to) {
    const ch = chainForward(tgt.typeId, last.to, next.from, e + turn);
    if (!ch || ch[ch.length - 1].sta + turn > next.std) {
      const what = next.kind === 'flight' ? `${next.from}–${next.to} at ${fmtTime(next.std)}${Math.floor(next.std / DAY) === Math.floor(e / DAY) ? '' : ` on ${fmtDay(next.std)}`}` : next.kind === 'maint' ? `its ${g.maintenance[next.id]?.kind ?? ''}-check at ${next.from} on ${fmtDay(next.std)}` : `its programme at ${next.from}`;
      reasons.push(`${tgt.reg} couldn't be back at ${next.from} for ${what}`);
    }
  }
  return plan;
}

// ---------- money ----------

/** One side of the comparison: revenue positive, costs negative (USD). */
export interface TripMoney {
  revenue: number;
  fuel: number;
  maintenance: number;
  fees: number;
  ferry: number;
  crew: number;
  penalties: number;
}

export const MONEY_LINES: { key: keyof TripMoney; label: string; hint: string }[] = [
  { key: 'revenue', label: 'Revenue', hint: 'What the client pays for these legs: the rate per block hour on a wet lease (it pays the time flown), the same share of the price on a charter.' },
  { key: 'fuel', label: 'Fuel', hint: 'Fuel we buy: on charters and empty legs. On a wet lease the client pays the fuel.' },
  { key: 'maintenance', label: 'Maintenance reserves', hint: 'Engine and airframe wear per block hour, by type and age.' },
  { key: 'fees', label: 'Airport & navigation fees', hint: 'Landing, handling and navigation fees (more for a widebody) and catering, when we pay them.' },
  { key: 'ferry', label: 'Ferry / positioning', hint: 'Empty flights added or no longer needed to get the aircraft there and back: fuel, wear and fees.' },
  { key: 'crew', label: 'Crew (tickets, hotels, per diem)', hint: 'Estimate: airline tickets bought to bring crew to the aircraft, hotel nights and per diems of the crew trips that change.' },
  { key: 'penalties', label: 'Penalties', hint: 'A charter client is paid compensation for a departure more than 3 hours late.' },
];

const zero = (): TripMoney => ({ revenue: 0, fuel: 0, maintenance: 0, fees: 0, ferry: 0, crew: 0, penalties: 0 });
export const moneyTotal = (m: TripMoney) => m.revenue + m.fuel + m.maintenance + m.fees + m.ferry + m.crew + m.penalties;

/** What a leg earns and costs on an aircraft (as flight.arr and billing post them, at planned block time). */
function legMoney(g: GameState, f: Flight, ac: Aircraft, charterBlock = f.block): Omit<TripMoney, 'ferry' | 'crew'> {
  const t = typeOf(ac.typeId);
  const bh = f.block / 60;
  const c = f.contractId ? g.contracts[f.contractId] : undefined;
  let revenue = 0;
  if (c?.product.kind === 'wet' && (isRevenue(f) || (f.kind === 'positioning' && c.product.positioningBillable))) {
    revenue = (c.product.ratePerBH * bh + (f.block < SHORT_CYCLE_MIN ? c.product.cycleFee : 0)) * (1 - brokerCut(c));
  } else if (c?.product.kind === 'charter' && isRevenue(f)) {
    revenue = (c.product.price * (1 - brokerCut(c)) * charterBlock) / Math.max(1, c.planRevMin ?? charterBlock);
  }
  const wide = t.body === 'wide' ? 1 : 0;
  const pays = paysFuel(g, f);
  const late = (f.std - (f.schedStd ?? f.std)) > 180;
  return {
    revenue: Math.round(revenue),
    fuel: pays ? -Math.round(t.fuelTBH * bh * g.market.fuelPrice) : 0,
    maintenance: -Math.round(t.maintBH * (1 + BAL.maintAgeFactor * Math.max(0, ageOf(g, ac) - 12)) * bh),
    fees: pays ? -(BAL.airportFees[wide] + (isRevenue(f) ? BAL.catering[wide] : 0)) : 0,
    penalties: c?.product.kind === 'charter' && isRevenue(f) && late ? -c.penalties.perDelay : 0,
  };
}

/** Per diem and hotel nights of a crew trip (estimate): away days × per diem, nights away × hotel (not on wet leases). */
function pairingCost(g: GameState, p: Pairing): number {
  const duties = p.dutyIds.map((id) => g.duties[id]).filter((d) => !!d).sort((a, b) => a.report - b.report);
  if (!duties.length) return 0;
  const dep = g.flights[duties[0].flightIds[0]]?.from ?? p.base;
  if (dep === p.base && duties.every((d) => d.restAt === p.base)) return 0;
  const k = p.contractId ? g.contracts[p.contractId] : undefined;
  const days = Math.max(1, Math.ceil((p.end - p.start) / DAY));
  let nights = 0;
  duties.forEach((d, i) => {
    if (d.restAt === p.base) return;
    const nxt = duties[i + 1];
    nights += Math.max(1, Math.round(((nxt ? nxt.report : d.release + DAY) - d.release) / DAY));
  });
  const pct = g.company.policies.perDiemPct / 100;
  const night = BAL.hotelPerNight[g.company.policies.hotelTier] ?? BAL.hotelPerNight[4];
  let s = 0;
  for (const slot of p.slots) s += (BAL.perDiem[slot.role] ?? 54) * pct * days + (k?.product.kind === 'wet' ? 0 : night * nights);
  // v0.7.3 split duties: the crew room or a hotel day room at the break, per crew member.
  const S = BAL.v073.split;
  for (const d of duties) if (d.split) s += p.slots.length * (d.split.room === 'hotel' ? S.dayRoom : S.lounge);
  return Math.round(s);
}

const pairingSig = (g: GameState, p: Pairing) =>
  `${p.aircraftId}|${p.status}|${p.dutyIds.map((id) => { const d = g.duties[id]; return d ? `${id}:${d.report}:${d.release}:${d.restAt}` : id; }).join(',')}|${p.slots.map((s) => `${s.role}:${s.crewId ?? '-'}`).join(',')}`;
const live = (p: Pairing) => p.status === 'planned' || p.status === 'active';
const legSig = (f: Flight) => `${f.aircraftId}|${f.from}|${f.to}|${f.std}|${f.sta}|${f.status}`;
const ledger = (g: GameState, cats: string[]) => cats.reduce((s, k) => s + (g.finance.current.lines[k as keyof typeof g.finance.current.lines] ?? 0), 0);

// ---------- the quote ----------

export interface QuoteLeg {
  id: string;
  no: string;
  from: string;
  to: string;
  kind: Flight['kind'];
  /** Times now (on the first aircraft) and after the move. */
  std: Minute;
  sta: Minute;
  newStd: Minute;
  newSta: Minute;
}

export interface QuoteEmptyLeg {
  aircraftId: string;
  reg: string;
  from: string;
  to: string;
  std: Minute;
  sta: Minute;
  /** true: a new ferry/positioning leg; false: one no longer needed. */
  added: boolean;
}

export interface TripMoveQuote {
  ok: boolean;
  /** Why not (plain words), first the most important. */
  reasons: string[];
  /** Things to know that don't block it (crew still to find). */
  warnings: string[];
  label: string;
  sourceId: string;
  targetId: string;
  sourceReg: string;
  targetReg: string;
  legs: QuoteLeg[];
  /** Minutes later the trip leaves so the new aircraft can get there. */
  shift: number;
  positioning: QuoteEmptyLeg[];
  /** Full quote only (a quick check leaves these at zero). */
  before: TripMoney;
  after: TripMoney;
  diff: TripMoney;
  /** after − before, = the sum of diff's lines. */
  net: number;
  verdict: 'gain' | 'loss' | 'same';
  crewOff: string[];
  crewOn: string[];
  /** Notes in plain words (ferries, crew, what the first aircraft is free for). */
  notes: string[];
  /** 'CS-TAY is free at DUB 4 Sep 05:20 – 5 Sep 18:00 (36h)'. */
  sourceFree: string | null;
  /** false: the quick check only (no money yet). */
  full: boolean;
}

function baseQuote(g: GameState, p: Plan | { error: string; trip: TripView }, targetId: string): TripMoveQuote {
  const trip = p.trip;
  const src = trip.aircraftId ? g.fleet[trip.aircraftId] : undefined;
  const tgt = g.fleet[targetId];
  const times = 'times' in p ? p.times : new Map<string, [Minute, Minute]>();
  return {
    ok: !('error' in p) && !p.reasons.length, reasons: 'error' in p ? [p.error] : [...p.reasons], warnings: [], label: trip.label,
    sourceId: src?.id ?? '', targetId, sourceReg: src?.reg ?? '', targetReg: tgt?.reg ?? '',
    legs: trip.moved.map((f) => ({ id: f.id, no: f.no, from: f.from, to: f.to, kind: f.kind, std: f.std, sta: f.sta, newStd: times.get(f.id)?.[0] ?? f.std, newSta: times.get(f.id)?.[1] ?? f.sta })),
    shift: 'shift' in p ? p.shift : 0, positioning: [], before: zero(), after: zero(), diff: zero(), net: 0, verdict: 'same', crewOff: [], crewOn: [], notes: [], sourceFree: null, full: false,
  };
}

/** Applies a plan to a game (the real one, or a copy for the quote): times, aircraft, then the rolling re-plans. */
function applyPlan(h: GameState, plan: Plan): boolean {
  const legs = plan.trip.moved.map((f) => h.flights[f.id]).filter((f): f is Flight => !!f && f.status === 'scheduled');
  if (!legs.length) return false;
  for (const f of legs) {
    const [std, sta] = plan.times.get(f.id) ?? [f.std, f.sta];
    if (std !== f.std || sta !== f.sta) {
      if (std !== f.std) f.schedStd ??= f.std;
      retimeFlight(h, f, std, sta);
    }
    // A fresh start on the new aircraft: holds and crew-shortage marks belonged to the old one.
    f.delay = 0;
    delete f.crewHeld;
    delete f.heldAt;
    delete f.crewTries;
    delete f.crewAlert;
    delete f.crewWarned;
    delete f.crewDecided;
    if (plan.shift) f.delayReason = `Moved to ${plan.tgt.reg}`;
  }
  reassignFlights(h, legs.map((f) => f.id), plan.tgt.id);
  // v0.7.2.2: a check's ferry that left from the end of the trip now leaves from where each aircraft really is.
  relinkCheckFerries(h, plan.src.id);
  relinkCheckFerries(h, plan.tgt.id);
  // Empty legs relinked for both aircraft (the target flies in as late as it can, a long wait spent at home), crew
  // re-synced and new legs rostered: the same settle every action gets…
  settle(h);
  // …and the empty legs in and out are our choice, so ours to pay (as an AOG swap's ferry), not the client's
  // positioning: the relink plans them as the contract's.
  const first = legs[0];
  const last = legs[legs.length - 1];
  const tl = flightsOf(h, plan.tgt.id).filter((f) => f.status === 'scheduled');
  const ours = (f: Flight | undefined) => !!f && f.kind === 'positioning' && f.contractId === first.contractId && !legs.includes(f);
  for (let i = tl.indexOf(first) - 1, at = first.from; i >= 0 && ours(tl[i]) && tl[i].to === at && tl[i].std > first.std - 2 * DAY; i--) {
    tl[i].contractId = null;
    at = tl[i].from;
  }
  for (let i = tl.indexOf(last) + 1, at = last.to; i < tl.length && ours(tl[i]) && tl[i].from === at && tl[i].std < last.sta + 2 * DAY; i++) {
    tl[i].contractId = null;
    at = tl[i].to;
  }
  touchFlights(h);
  // …then both aircraft re-rostered from the trip start, so crew stay legal on what is left and what arrived.
  const from = Math.max(h.now, plan.trip.start - DAY);
  rerosterFrom(h, plan.tgt.id, from);
  rerosterFrom(h, plan.src.id, from);
  settle(h);
  return true;
}

/** The largest free stretch of `ac` around [s, e] in h: 'CS-TAY is free at DUB 4 Sep 05:20 – 5 Sep 18:00 (36h)'. */
function freeText(h: GameState, ac: Aircraft, s: Minute, e: Minute): string | null {
  const busy: [Minute, Minute, string, string][] = [];
  for (const f of flightsOf(h, ac.id)) if (f.status === 'scheduled' || f.status === 'enroute') busy.push([f.std, f.sta, f.from, f.to]);
  for (const m of Object.values(h.maintenance)) if (m.aircraftId === ac.id && (m.status === 'planned' || m.status === 'inWork')) busy.push([m.start, m.end, m.at, m.at]);
  busy.sort((a, b) => a[0] - b[0]);
  let from = h.now;
  let at = ac.at;
  let best: { from: Minute; to: Minute; at: string; open: boolean } | null = null;
  const consider = (to: Minute, open: boolean) => {
    const ov = Math.min(to, e) - Math.max(from, s);
    if (to - from >= 60 && ov > 0 && (!best || ov > Math.min(best.to, e) - Math.max(best.from, s))) best = { from, to, at, open };
  };
  for (const [bs, be, , to] of busy) {
    if (bs > from) consider(bs, false);
    if (be > from) {
      from = be;
      at = to;
    }
  }
  consider(Infinity, true);
  if (!best) return null;
  const b = best as { from: Minute; to: Minute; at: string; open: boolean };
  return b.open
    ? `${ac.reg} is free at ${b.at} ${b.from <= h.now ? 'from now' : `from ${fmtDateTime(b.from)} UTC`}, with nothing booked after`
    : `${ac.reg} is free at ${b.at} ${b.from <= h.now ? 'from now' : fmtDateTime(b.from)} – ${fmtDateTime(b.to)} UTC (${span(b.to - Math.max(b.from, h.now))})`;
}

const memo = new WeakMap<GameState, { key: string; m: Map<string, TripMoveQuote> }>();

/**
 * What moving the trip of `flightId` to `targetId` would do: ok or the plain reasons it can't; the legs and their new
 * times; ferries added or dropped on both aircraft; and the money before (on its aircraft now) and after (on the
 * target), line by line, with the net. `quick` runs only the checks (drag highlighting); the full quote previews the
 * move on a copy (exactly what moveTrip does) and also refuses when the target's other legs would have to move or it
 * couldn't be positioned in time. Pure (memoized per state).
 */
export function quoteTripMove(g: GameState, flightId: string, targetId: string, opts: { quick?: boolean } = {}): TripMoveQuote {
  const key = `${flightsRev(g)}:${crewRev(g)}:${g.now}:${g.seq}`;
  let c = memo.get(g);
  if (!c || c.key !== key) memo.set(g, (c = { key, m: new Map() }));
  const mk = `${flightId}>${targetId}>${opts.quick ? 'q' : 'f'}`;
  const hit = c.m.get(mk) ?? (opts.quick ? c.m.get(`${flightId}>${targetId}>f`) : undefined);
  if (hit) return hit;
  const p = planMove(g, flightId, targetId);
  const q = baseQuote(g, p, targetId);
  if (!q.ok || opts.quick || 'error' in p) {
    c.m.set(mk, q);
    return q;
  }
  fullQuote(g, p, q);
  c.m.set(mk, q);
  return q;
}

function fullQuote(g: GameState, plan: Plan, q: TripMoveQuote): void {
  const h = structuredClone(g);
  try {
    if (!isolatePauses(() => applyPlan(h, plan))) q.reasons.push(`${plan.tgt.reg} can't be flown to ${plan.trip.moved[0].from} in time`);
  } catch (e) {
    q.ok = false;
    q.reasons.push(`The move could not be planned (${e instanceof Error ? e.message : String(e)})`);
    return;
  }
  q.full = true;
  const { src, tgt } = plan;
  const ids = new Set(plan.trip.moved.map((f) => f.id));
  const moved = plan.trip.moved.map((f) => h.flights[f.id]).filter((f): f is Flight => !!f);
  const turn = typeOf(tgt.typeId).turnMin;

  // Refusals only the copy shows: legs that would have to move, a ferry that can't make it.
  const checkFerry = new Set(Object.values(g.maintenance).filter((m) => m.status === 'planned' && (m.aircraftId === src.id || m.aircraftId === tgt.id)).flatMap((m) => m.ferryIds ?? []));
  for (const f of Object.values(g.flights)) {
    if (ids.has(f.id) || f.status !== 'scheduled' || !f.aircraftId || f.kind === 'positioning' || f.kind === 'deadhead') continue;
    // A check's ferry out of the two aircraft is re-planned from where they now are (shown with the empty legs).
    if (f.kind === 'ferry' && (f.aircraftId === src.id || f.aircraftId === tgt.id) && checkFerry.has(f.id)) continue;
    const x = h.flights[f.id];
    if (!x || x.status === 'cancelled' || x.aircraftId !== f.aircraftId || x.std !== f.std) {
      const ac = g.fleet[f.aircraftId];
      q.reasons.push(`${ac?.reg ?? 'Another aircraft'}'s ${f.from}–${f.to} at ${fmtTime(f.std)} on ${fmtDay(f.std)} would have to ${!x || x.status === 'cancelled' ? 'be cancelled' : 'move'}`);
      break;
    }
  }
  if (moved.length !== plan.trip.moved.length || moved.some((f) => f.aircraftId !== tgt.id || f.status !== 'scheduled')) q.reasons.push('The legs could not all be moved');
  const tl = flightsOf(h, tgt.id).filter((f) => f.status === 'scheduled' || f.status === 'enroute');
  const i0 = tl.findIndex((f) => ids.has(f.id));
  if (i0 >= 0) {
    const first = tl[i0];
    const before = tl[i0 - 1];
    const at = before ? before.to : tgt.flightId ? h.flights[tgt.flightId]?.to ?? tgt.at : tgt.at;
    if (at !== first.from) q.reasons.push(`${tgt.reg} can't get to ${first.from} for the first departure`);
    else if (before && before.sta + turn > first.std) q.reasons.push(`${tgt.reg} can't get to ${first.from} in time: it lands there ${fmtDateTime(before.sta)} UTC`);
  }
  q.ok = !q.reasons.length;

  // Legs and their new times (from the copy: exactly what the move does).
  q.legs = plan.trip.moved.map((f) => {
    const x = h.flights[f.id] ?? f;
    return { id: f.id, no: f.no, from: f.from, to: f.to, kind: f.kind, std: f.std, sta: f.sta, newStd: x.std, newSta: x.sta };
  });

  // Empty legs added or no longer needed on the two aircraft.
  const two = (f: Flight) => (f.aircraftId === src.id || f.aircraftId === tgt.id) && f.status === 'scheduled' && (f.kind === 'positioning' || f.kind === 'ferry') && !ids.has(f.id);
  const gEmpty = [src.id, tgt.id].flatMap((id) => flightsOf(g, id)).filter(two);
  const hEmpty = [src.id, tgt.id].flatMap((id) => flightsOf(h, id)).filter(two);
  const gSig = new Set(gEmpty.map(legSig));
  const hSig = new Set(hEmpty.map(legSig));
  const removed = gEmpty.filter((f) => !hSig.has(legSig(f)));
  const added = hEmpty.filter((f) => !gSig.has(legSig(f)));
  const reg = (st: GameState, id: string | null) => (id ? st.fleet[id]?.reg ?? '' : '');
  q.positioning = [
    ...added.map((f) => ({ aircraftId: f.aircraftId!, reg: reg(h, f.aircraftId), from: f.from, to: f.to, std: f.std, sta: f.sta, added: true })),
    ...removed.map((f) => ({ aircraftId: f.aircraftId!, reg: reg(g, f.aircraftId), from: f.from, to: f.to, std: f.std, sta: f.sta, added: false })),
  ].sort((a, b) => Number(b.added) - Number(a.added) || a.std - b.std);

  // Money: the trip's own legs on each aircraft; changed empty legs; crew; penalties.
  const before = zero();
  const after = zero();
  for (const f of plan.trip.moved) {
    const a = legMoney(g, f, src);
    const x = h.flights[f.id];
    const b = x && h.fleet[tgt.id] ? legMoney(h, x, h.fleet[tgt.id], f.block) : a;
    for (const k of ['revenue', 'fuel', 'maintenance', 'fees', 'penalties'] as const) {
      before[k] += a[k];
      after[k] += b[k];
    }
  }
  const emptyCost = (st: GameState, f: Flight) => {
    const ac = f.aircraftId ? st.fleet[f.aircraftId] : undefined;
    if (!ac) return { rev: 0, cost: 0 };
    const m = legMoney(st, f, ac);
    return { rev: m.revenue, cost: m.fuel + m.maintenance + m.fees };
  };
  for (const f of removed) {
    const m = emptyCost(g, f);
    before.revenue += m.rev;
    before.ferry += m.cost;
  }
  for (const f of added) {
    const m = emptyCost(h, f);
    after.revenue += m.rev;
    after.ferry += m.cost;
  }
  // Crew: trips (pairings) the move changes, valued before and after; tickets bought on the copy.
  const ids2 = new Set([...Object.keys(g.pairings), ...Object.keys(h.pairings)]);
  for (const id of ids2) {
    const a = g.pairings[id];
    const b = h.pairings[id];
    const sa = a && live(a) ? pairingSig(g, a) : '';
    const sb = b && live(b) ? pairingSig(h, b) : '';
    if (sa === sb) continue;
    if (sa) before.crew -= pairingCost(g, a);
    if (sb) after.crew -= pairingCost(h, b);
  }
  after.crew += Math.round(ledger(h, ['deadhead', 'crewJet']) - ledger(g, ['deadhead', 'crewJet']));
  after.penalties += Math.round(ledger(h, ['penalties', 'subcharter']) - ledger(g, ['penalties', 'subcharter']));
  q.before = before;
  q.after = after;
  q.diff = zero();
  for (const k of Object.keys(before) as (keyof TripMoney)[]) q.diff[k] = after[k] - before[k];
  q.net = moneyTotal(q.diff);
  q.verdict = Math.abs(q.net) < SAME_BAND ? 'same' : q.net > 0 ? 'gain' : 'loss';

  // Crew who come off and go on (operating the moved legs).
  const crewOf = (list: (Flight | undefined)[]) => new Set(list.flatMap((f) => f?.crewIds ?? []));
  const was = crewOf(plan.trip.moved);
  const now = crewOf(moved);
  const who = (st: GameState, id: string) => (st.crew[id] ? `${st.crew[id].role} ${crewName(st.crew[id])}` : id);
  q.crewOff = [...was].filter((id) => !now.has(id)).map((id) => who(g, id));
  q.crewOn = [...now].filter((id) => !was.has(id)).map((id) => who(h, id));
  const short = new Set<Role>();
  let unrostered = 0;
  for (const f of moved) {
    if (f.std > h.now + BAL.rosterHorizonDays * DAY) {
      unrostered++;
      continue;
    }
    const cs = flightCrewStatus(h, f.id);
    if (cs.level === 'missing' || cs.level === 'illegal') for (const r of cs.missing.length ? cs.missing : (['CPT'] as Role[])) short.add(r);
  }
  if (short.size) q.warnings.push(`The roster can't crew it yet (${[...short].map(roleWord).join(', ')} short): you'll get a crew warning to fix it`);
  // v0.7.3 in-flight rest on the target: the rest plan of each moved leg's duty (the roster's own, on the copy).
  const badRest = moved.map((f) => restPlanForFlight(h, f.id)).find((p) => p && !p.ok && p.code !== 'tooShort');
  if (badRest) q.warnings.push(`In-flight rest on ${tgt.reg}: ${badRest.why ?? 'the rest plan is not possible'}`);

  // Plain notes.
  const notes: string[] = [];
  if (plan.shift) notes.push(`The trip leaves ${fmtDuration(plan.shift)} later than planned so ${tgt.reg} can get there.`);
  const need = plan.need;
  if (need && need.mode !== 'basic' && need.mode !== 'none') notes.push(`On ${tgt.reg}: ${need.text}.`);
  const addT = q.positioning.filter((x) => x.added && x.aircraftId === tgt.id);
  if (addT.length) notes.push(`${tgt.reg} flies empty ${addT.map((x) => `${x.from}–${x.to} (${fmtDateTime(x.std)})`).join(' and ')}.`);
  else notes.push(`${tgt.reg} is already where the trip starts: no extra flying.`);
  const gone = q.positioning.filter((x) => !x.added);
  if (gone.length) notes.push(`No longer needed: ${gone.map((x) => `${x.reg} ${x.from}–${x.to}`).join(', ')}.`);
  const addS = q.positioning.filter((x) => x.added && x.aircraftId === src.id);
  if (addS.length) notes.push(`${src.reg} flies empty ${addS.map((x) => `${x.from}–${x.to} (${fmtDateTime(x.std)})`).join(' and ')} instead.`);
  if (q.crewOff.length || q.crewOn.length) notes.push(`Crew: ${q.crewOff.length} come off, ${q.crewOn.length} go on.`);
  else if (!was.size && !now.size) notes.push(`Crew: not picked yet; the roster names a ${typeWord(tgt.typeId)} crew nearer the day.`);
  else if (unrostered === moved.length) notes.push(`Crew: not rostered yet (the roster plans ${BAL.rosterHorizonDays} days ahead); ${typeWord(tgt.typeId)}-rated crew will be picked.`);
  else notes.push('Crew: the same crew fly it.');
  q.sourceFree = freeText(h, src, plan.trip.start, plan.trip.end);
  if (q.sourceFree) notes.push(`${q.sourceFree}.`);
  q.notes = notes;
}

/**
 * Moves the trip of `flightId` to `targetId` as quoted: new times if it must wait for the aircraft, the legs to the
 * target (core reassignFlights), empty legs re-planned for both aircraft and both re-rostered from the trip start.
 * Refused with the quote's first reason when it can't; `expectNet` refuses a quote that got worse since it was shown.
 */
export function moveTrip(g: GameState, flightId: string, targetId: string, expectNet?: number): ActionResult<{ quote: TripMoveQuote }> {
  const q = quoteTripMove(g, flightId, targetId);
  if (!q.ok) return { ok: false, error: q.reasons[0] ?? 'This trip can’t move there' };
  if (expectNet !== undefined && q.net < expectNet - SAME_BAND) return { ok: false, error: 'The numbers changed since you looked: check the quote again' };
  const plan = planMove(g, flightId, targetId);
  if ('error' in plan || plan.reasons.length) return { ok: false, error: 'error' in plan ? plan.error : plan.reasons[0] };
  if (!applyPlan(g, plan)) return { ok: false, error: `${plan.tgt.reg} can't be flown to ${plan.trip.moved[0].from} in time` };
  return { ok: true, msg: `${q.label} moved to ${q.targetReg}`, data: { quote: q } };
}

/** Every other aircraft as a move target for the trip, quoted (full quotes for the ones that pass the checks). Pure. */
export function tripTargets(g: GameState, flightId: string): TripMoveQuote[] {
  const trip = tripOf(g, flightId);
  const out: TripMoveQuote[] = [];
  for (const ac of Object.values(g.fleet)) {
    if (ac.id === trip.aircraftId || ac.status === 'leasedOut') continue;
    out.push(quoteTripMove(g, flightId, ac.id));
  }
  return out.sort((a, b) => Number(b.ok) - Number(a.ok) || b.net - a.net || (a.targetReg < b.targetReg ? -1 : 1));
}
