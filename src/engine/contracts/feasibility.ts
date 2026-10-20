// Feasibility and aircraft selection (B1). DESIGN.md §5.1.5. Pure: no RNG, no ids, no writes.

import { AIRPORT_BY_CODE } from '../../data/airports';
import { BAL } from '../core/balance';
import { flightsOf } from '../core/entities';
import { distanceNm } from '../core/geo';
import { complement, etopsNeeded, maxSectorNm, planSector, reportMinutes, runwayFit, typeOf } from '../core/perf';
import { DAY, fmtDate, fmtDateTime, fmtDay, fmtDuration, toDate } from '../core/time';
import type { Aircraft, ApprovalId, ContractOffer, GameState, Minute } from '../core/types';
import { crewAvailability, type Availability } from '../crew';
import { A_CHECK_DAYS, anchorsOf, chainForward, CHARTER_SLACK, DEPLOY_LEAD, gapMoves, programmeOf, type Anchor, type ChainLeg, type Programme, type Trip } from './plan';
import { productValue, tripTickets } from './pricing';

export type CheckId = 'seats' | 'layout' | 'family' | 'range' | 'runway' | 'etops' | 'approvals' | 'availability' | 'maintenance' | 'crew' | 'positioning' | 'lease';
export type CheckLevel = 'ok' | 'warn' | 'no';

export interface FeasibilityCheck {
  id: CheckId;
  level: CheckLevel;
  label: string;
  detail?: string;
}

/** One empty leg of a positioning plan (built with planSector; a fuel stop makes two legs, each an FTL sector). */
export interface PositioningLeg {
  from: string;
  to: string;
  std: Minute;
  sta: Minute;
}

export interface FeasibilityReport {
  offerId: string;
  aircraftId: string;
  /** Worst check level. */
  level: CheckLevel;
  checks: FeasibilityCheck[];
  /** Empty legs needed before the first and after the last revenue leg ([] when none; > 1 leg = fuel stops). */
  positionIn: PositioningLeg[];
  positionOut: PositioningLeg[];
  techStops: string[];
  /** Flight ids and maintenance ids that overlap the programme on this aircraft. */
  conflicts: { flights: string[]; maintenance: string[] };
  /** Crew capacity vs the programme's need (crew.crewAvailability): shortfall by role and when it bites. */
  crew: Availability;
  estBH: number;
  estRevenue: number;
  estCost: number;
  estMargin: number;
}

const RANK: Record<CheckLevel, number> = { ok: 0, warn: 1, no: 2 };
const ETOPS_APPROVALS: [ApprovalId, number][] = [['etops240', 240], ['etops180', 180], ['etops120', 120]];
/** Longest duty one unaugmented crew may fly (simplified FTL: 13 h FDP). */
const MAX_UNAUGMENTED_FDP = 13 * 60;
const nm = (v: number) => `${Math.round(v).toLocaleString('en-US')} nm`;
const LAYOUT_NAME: Record<string, string> = { 'all-economy': 'all-economy', 'two-class': 'two-class', 'three-class': 'three-class', vip: 'VIP' };

function describe(g: GameState, a: Anchor): string {
  if (a.kind === 'maint') {
    const m = g.maintenance[a.id];
    return m ? `${m.kind === 'AOG' ? 'AOG repair' : `${m.kind}-check`} at ${m.at} ${fmtDay(m.start)}–${fmtDay(m.end)}` : 'maintenance';
  }
  const c = a.contractId ? g.contracts[a.contractId] : undefined;
  if (c) return `${c.title} (${fmtDay(a.std)}–${fmtDay(a.sta)})`;
  const f = g.flights[a.id];
  return f ? `${f.kind === 'ferry' ? 'ferry' : 'flight'} ${f.no} ${f.from}–${f.to} ${fmtDateTime(f.std)}` : 'another commitment';
}

const routeText = (legs: ChainLeg[]) => (legs.length ? [legs[0].from, ...legs.map((l) => l.to)].join('→') : '');
const chainMin = (legs: ChainLeg[]) => (legs.length ? legs[legs.length - 1].sta - legs[0].std : 0);
const blockMin = (legs: ChainLeg[]) => legs.reduce((s, l) => s + l.sta - l.std, 0);

interface TripFit {
  trip: Trip;
  /** Empty legs charged to this job: into its first departure, and out of it (home, or to the next commitment). */
  posIn: ChainLeg[];
  posOut: ChainLeg[];
  /** Hops home before / after a long wait that belong to the neighbouring commitments (shown, not charged). */
  homeBefore: ChainLeg[];
  homeAfter: ChainLeg[];
  /** Arrival when posIn cannot make the first departure (forward-planned), else null. */
  lateArrival: Minute | null;
  noRoute: boolean;
  blockedNext: Anchor | null;
}

/** A gap move through home (a long wait spent at base) split into the legs home and the legs on from home. */
function splitHome(legs: ChainLeg[], home: string): [ChainLeg[], ChainLeg[]] | null {
  const i = legs.findIndex((l, k) => l.to === home && k < legs.length - 1);
  return i < 0 ? null : [legs.slice(0, i + 1), legs.slice(i + 1)];
}

/** Places each trip among the aircraft's commitments: overlaps, positioning in (as late as possible) and out. */
function fitTrips(g: GameState, ac: Aircraft, o: ContractOffer, prog: Programme): { fits: TripFit[]; conflicts: Anchor[] } {
  const t = typeOf(ac.typeId);
  const turn = t.turnMin;
  const home = g.company.homeBase;
  const lead = o.pattern.kind === 'base' ? DEPLOY_LEAD : turn + CHARTER_SLACK;
  const anchors = anchorsOf(g, ac.id);
  const conflicts: Anchor[] = [];
  for (const a of anchors) {
    if (a.kind === 'start') continue;
    if (prog.trips.some((tr) => a.std < tr.sta + turn && a.sta > tr.std - turn) && !conflicts.includes(a)) conflicts.push(a);
  }
  // Merge free anchors and the trips into one timeline.
  type Node = { a?: Anchor; tr?: Trip; std: Minute; sta: Minute; from: string; to: string };
  const nodes: Node[] = [
    ...anchors.filter((a) => !conflicts.includes(a)).map((a) => ({ a, std: a.std, sta: a.sta, from: a.from, to: a.to })),
    ...prog.trips.map((tr) => ({ tr, std: tr.std, sta: tr.sta, from: tr.from, to: tr.to })),
  ].sort((x, y) => x.std - y.std);
  const fits: TripFit[] = [];
  nodes.forEach((n, i) => {
    if (!n.tr) return;
    const fit: TripFit = { trip: n.tr, posIn: [], posOut: [], homeBefore: [], homeAfter: [], lateArrival: null, noRoute: false, blockedNext: null };
    let prev: Node | null = null;
    for (let k = i - 1; k >= 0; k--) if (!prev || nodes[k].sta > prev.sta) prev = nodes[k];
    if (prev) {
      const earliest = prev.a?.kind === 'start' ? prev.sta : prev.sta + turn;
      const hop = prev.a?.kind !== 'maint';
      const ch = gapMoves(t.id, prev.to, n.from, earliest, n.std - lead, home, hop) ?? gapMoves(t.id, prev.to, n.from, earliest, n.std - turn, home, hop);
      if (ch) [fit.homeBefore, fit.posIn] = splitHome(ch, home) ?? [[], ch];
      else {
        const fwd = chainForward(t.id, prev.to, n.from, earliest);
        if (!fwd) fit.noRoute = true;
        else {
          fit.posIn = fwd;
          fit.lateArrival = fwd.length ? fwd[fwd.length - 1].sta : earliest;
        }
      }
    }
    const nx = nodes[i + 1];
    if (nx?.a) {
      const ch = gapMoves(t.id, n.to, nx.from, n.sta + turn, nx.std - turn, home, nx.a.kind !== 'maint');
      if (ch) [fit.posOut, fit.homeAfter] = splitHome(ch, home) ?? [ch, []];
      else fit.blockedNext = nx.a;
    } else if (!nx && n.to !== home) {
      fit.posOut = chainForward(t.id, n.to, home, n.sta + turn) ?? [];
    }
    fits.push(fit);
  });
  return { fits, conflicts };
}

/** Full report for one aircraft: the 12 checks of DESIGN §5.1.5, positioning plan and contribution estimate. */
export function feasibility(g: GameState, offerId: string, aircraftId: string): FeasibilityReport {
  const o = g.offers[offerId];
  const ac = g.fleet[aircraftId];
  const empty: Availability = { setsNeeded: 0, setsAvailable: 0, byRole: {}, firstShort: null };
  const rep: FeasibilityReport = {
    offerId, aircraftId, level: 'ok', checks: [], positionIn: [], positionOut: [], techStops: [], conflicts: { flights: [], maintenance: [] },
    crew: empty, estBH: 0, estRevenue: 0, estCost: 0, estMargin: 0,
  };
  const add = (id: FeasibilityCheck['id'], level: CheckLevel, label: string, detail?: string) => {
    rep.checks.push(detail ? { id, level, label, detail } : { id, level, label });
    if (RANK[level] > RANK[rep.level]) rep.level = level;
  };
  if (!o || !ac) {
    add('availability', 'no', 'Offer or aircraft not found');
    return rep;
  }
  const t = typeOf(ac.typeId);
  const turn = t.turnMin;
  const req = o.requirements;
  const home = g.company.homeBase;
  const wet = o.product.kind === 'wet';
  const base = o.pattern.kind === 'base';

  // 1–3. Cabin and type.
  const seats = ac.cabin.total;
  if (seats < req.minSeats) add('seats', 'no', `${seats} seats: the client needs at least ${req.minSeats}`);
  else if (req.maxSeats && seats > req.maxSeats) add('seats', 'no', `${seats} seats: the client wants at most ${req.maxSeats}`);
  else add('seats', 'ok', `${seats} seats (client needs ${req.minSeats}+)`);
  if (req.layout && ac.cabin.layout !== req.layout) {
    const name = LAYOUT_NAME[req.layout];
    add('layout', 'no', `Needs ${/^[aeiou]/i.test(name) ? 'an' : 'a'} ${name} cabin; ${ac.reg} is ${ac.cabin.label}`, 'Cabin reconfiguration arrives in a later version.');
  }
  else add('layout', 'ok', `Cabin ${ac.cabin.label}`);
  if (req.families?.length && !req.families.includes(t.family)) add('family', 'no', `The client only takes ${req.families.join(' or ')}-family aircraft (crew commonality)`);
  else add('family', 'ok', `${t.name}`);

  // 4–5. Range and runways, sector by sector.
  const prog = programmeOf(o, ac.typeId);
  const usable = t.rangeNm * 0.95;
  const sectors = [...new Map(prog.sectors.map(([a, b]) => [`${a}-${b}`, [a, b] as [string, string]])).values()];
  const stops: string[] = [];
  const rangeNo: string[] = [];
  const runwayNo = new Map<string, string>();
  const runwayLtd = new Set<string>();
  let longest = 0;
  for (const [a, b] of sectors) {
    longest = Math.max(longest, distanceNm(a, b));
    for (const c of [a, b]) {
      const fit = runwayFit(t.id, c);
      if (fit === 'no') runwayNo.set(c, `${c} runway ${AIRPORT_BY_CODE[c]?.runwayM ?? 0} m; the ${t.short} needs ${t.minRunwayM} m`);
      else if (fit === 'limited') runwayLtd.add(c);
    }
    const sp = planSector(t.id, a, b);
    if (!sp.ok) {
      if (sp.reason === 'range') rangeNo.push(`${a}–${b} (${nm(distanceNm(a, b))}) is beyond the ${t.short}'s reach even with two fuel stops`);
      continue;
    }
    if (sp.techStops.length) {
      if (base || req.noTechStops) rangeNo.push(`${a}–${b} needs a fuel stop at ${sp.techStops.join(', ')} and the client wants none`);
      else stops.push(`${sp.techStops.join(' + ')} on ${a}–${b} (${nm(distanceNm(a, b))})`);
      for (const s of sp.techStops) if (!rep.techStops.includes(s)) rep.techStops.push(s);
    }
    if (runwayFit(t.id, a) === 'limited' || runwayFit(t.id, b) === 'limited') {
      const lim = maxSectorNm(t.id, a, b);
      if (sp.techStops.length) stops.push(`payload limit at ${runwayFit(t.id, a) === 'limited' ? a : b} caps legs at ${nm(lim)}`);
    }
  }
  if (rangeNo.length) add('range', 'no', rangeNo[0], rangeNo.slice(1).join('; ') || undefined);
  else if (stops.length) add('range', 'warn', `Fuel stop${stops.length > 1 ? 's' : ''} at ${stops[0]}`, stops.length > 1 ? stops.slice(1).join('; ') : `Adds about an hour on the ground per stop; usable range ${nm(usable)}.`);
  else add('range', 'ok', `All sectors direct (longest ${nm(longest)} of ${nm(usable)})`);
  if (runwayNo.size) add('runway', 'no', [...runwayNo.values()][0], [...runwayNo.values()].slice(1).join('; ') || undefined);
  else if (runwayLtd.size) add('runway', 'warn', `Payload-limited at ${[...runwayLtd].join(', ')} (${[...runwayLtd].map((c) => `${AIRPORT_BY_CODE[c]?.runwayM} m`).join(', ')})`, `Shorter legs from there; the ${t.short} likes ${t.minRunwayM} m.`);
  else {
    const shortest = prog.airports.reduce((m, c) => Math.min(m, AIRPORT_BY_CODE[c]?.runwayM ?? 9999), 9999);
    add('runway', 'ok', `Runways fine (shortest ${shortest.toLocaleString('en-US')} m)`);
  }

  // Place the programme among this aircraft's commitments (only meaningful if it can fly it).
  const flyable = prog.ok && !rangeNo.length && !runwayNo.size;
  const { fits, conflicts } = flyable ? fitTrips(g, ac, o, prog) : { fits: [] as TripFit[], conflicts: [] as Anchor[] };
  rep.positionIn = fits[0]?.posIn ?? [];
  rep.positionOut = fits[fits.length - 1]?.posOut ?? [];

  // 6. ETOPS over revenue and positioning legs.
  let etops = 0;
  if (flyable) {
    for (const [a, b] of sectors) for (const l of planSector(t.id, a, b).legs) etops = Math.max(etops, etopsNeeded(t.id, l.from, l.to));
    for (const f of fits) for (const l of [...f.posIn, ...f.posOut]) etops = Math.max(etops, etopsNeeded(t.id, l.from, l.to));
  }
  const have = ETOPS_APPROVALS.find(([id]) => g.company.approvals.includes(id))?.[1] ?? 0;
  if (t.engines === 4) add('etops', 'ok', 'Four engines: no ETOPS limits');
  else if (!etops) add('etops', 'ok', 'No ETOPS needed');
  else if (t.etopsMax < etops) add('etops', 'no', `Routing needs ETOPS ${etops}; the ${t.short} is certified to ${t.etopsMax || 'none'}`);
  else if (have < etops) add('etops', 'no', `Routing needs ETOPS ${etops}: we hold ${have ? `ETOPS ${have}` : 'no ETOPS approval'}`, 'Apply for it under Company → Approvals.');
  else add('etops', 'ok', `ETOPS ${etops} (approved ${have})`);

  // 7. Approvals.
  const missing = req.approvals.filter((a) => !g.company.approvals.includes(a));
  if (missing.length) add('approvals', 'no', `Needs approval: ${missing.join(', ')}`, 'Apply under Company → Approvals.');
  else add('approvals', 'ok', req.approvals.length ? `Approvals held: ${req.approvals.join(', ')}` : 'No special approvals');

  // 8. Lease and delivery.
  const firstDep = rep.positionIn[0]?.std ?? fits[0]?.trip.std ?? o.start;
  const lastArr = rep.positionOut.length ? rep.positionOut[rep.positionOut.length - 1].sta : fits[fits.length - 1]?.trip.sta ?? o.end;
  if (ac.ownership.kind === 'dryLeaseIn' && ac.ownership.leaseEnd < Math.max(o.end, lastArr)) add('lease', 'no', `Lease returns ${fmtDate(ac.ownership.leaseEnd)}, before the job ends`);
  else if (ac.status === 'delivering' && ac.deliveredAt > firstDep) add('lease', 'no', `Delivers ${fmtDay(ac.deliveredAt)}, after it would have to leave`);
  else add('lease', 'ok', ac.ownership.kind === 'owned' ? 'Owned' : `Dry-leased until ${fmtDate(ac.ownership.leaseEnd)}`);

  // 9. Availability: overlaps with flights, maintenance and signed base deployments.
  let availNo = false;
  for (const a of conflicts) {
    if (a.kind === 'maint') rep.conflicts.maintenance.push(a.id);
    else if (a.kind === 'flight') rep.conflicts.flights.push(a.id);
    else if (a.kind === 'base') for (const f of flightsOf(g, ac.id)) if (f.contractId === a.contractId && f.status === 'scheduled') { rep.conflicts.flights.push(f.id); break; }
  }
  if (!flyable) add('availability', 'warn', 'Not checked: the aircraft cannot fly the routes');
  else if (conflicts.length) {
    const soft = base && conflicts.every((a) => a.kind === 'maint' && g.maintenance[a.id]?.kind === 'A' && g.maintenance[a.id]?.status === 'planned');
    availNo = !soft;
    // One line per contract (its first to last overlapping flight) or check, then "and N more".
    const groups: Anchor[] = [];
    for (const a of conflicts) {
      const k = a.kind === 'maint' ? `m:${a.id}` : a.contractId ? `c:${a.contractId}` : `f:${a.id}`;
      const gr = groups.find((x) => (x.kind === 'maint' ? `m:${x.id}` : x.contractId ? `c:${x.contractId}` : `f:${x.id}`) === k);
      if (gr) {
        gr.std = Math.min(gr.std, a.std);
        gr.sta = Math.max(gr.sta, a.sta);
      } else groups.push({ ...a });
    }
    const more = groups.length > 4 ? ` and ${groups.length - 4} more` : '';
    add('availability', soft ? 'warn' : 'no', soft ? `${describe(g, groups[0])} falls inside: those waves are skipped` : `Busy: ${describe(g, groups[0])}`, groups.length > 1 ? `Also ${groups.slice(1, 4).map((a) => describe(g, a)).join('; ')}${more}` : undefined);
  } else {
    const blocked = fits.find((f) => f.blockedNext);
    if (blocked) {
      availNo = true;
      add('availability', 'no', `Can't be back for ${describe(g, blocked.blockedNext!)}`, `It would have to be at ${blocked.blockedNext!.from} by ${fmtDateTime(blocked.blockedNext!.std - turn)} UTC.`);
    } else add('availability', 'ok', `Free ${fmtDay(firstDep)}–${fmtDay(lastArr)}`);
  }

  // 10. Positioning in and out.
  if (flyable && !availNo) {
    const late = fits.find((f) => f.lateArrival !== null);
    const noRoute = fits.some((f) => f.noRoute);
    const pIn = rep.positionIn;
    if (noRoute) add('positioning', 'no', 'No route to position the aircraft (range or runway)');
    else if (late) {
      const arr = late.lateArrival!;
      const missBy = arr + turn - late.trip.std;
      if (base && missBy < DAY && late === fits[0]) add('positioning', 'warn', `Arrives ${fmtDateTime(arr)} UTC: misses the first ${fmtDuration(missBy)} of flying`, `${routeText(late.posIn)} ${fmtDuration(chainMin(late.posIn))}. MGH still applies.`);
      else add('positioning', 'no', `Can't get there in time: earliest arrival ${fmtDateTime(arr)} UTC, first departure ${fmtDateTime(late.trip.std)} UTC`, late.posIn.length ? `${routeText(late.posIn)} takes ${fmtDuration(chainMin(late.posIn))}.` : undefined);
    } else {
      const pay = wet ? 'billable to the client' : 'priced into the charter';
      const lastFit = fits[fits.length - 1];
      const after = lastFit?.homeAfter ?? [];
      const out = (rep.positionOut.length ? `Back ${routeText(rep.positionOut)} after (${fmtDuration(chainMin(rep.positionOut))}).` : `Ends at ${lastFit?.trip.to ?? home}.`) +
        (after.length ? ` Then ${routeText(after)} on ${fmtDay(after[0].std)} for the next job.` : '');
      const extra = fits.length > 1 && fits.slice(1).some((f) => f.posIn.length) ? ` Between trips it flies home empty.` : '';
      const before = fits[0]?.homeBefore ?? [];
      const first = before.length ? `Home to ${home} ${fmtDay(before[0].std)} after its last job, then ` : '';
      if (pIn.length) {
        const stops = pIn.length - 1;
        add('positioning', 'ok', `Positioning ${routeText(pIn)} ${fmtDuration(chainMin(pIn))}${stops ? ` (fuel stop${stops > 1 ? 's' : ''})` : ''}, ${pay}`, `${first}${first ? 'leaves' : 'Leaves'} ${fmtDateTime(pIn[0].std)} UTC, lands ${fmtDateTime(pIn[pIn.length - 1].sta)} UTC. ${out}${extra}`);
      } else add('positioning', 'ok', `Already at ${fits[0]?.trip.from ?? o.pin} when it starts`, `${out}${extra}`);
    }
  } else add('positioning', availNo ? 'no' : 'warn', availNo ? 'Not planned: the aircraft is busy' : 'Not planned');

  // 11. Maintenance due inside the window (A-check by FH or calendar, C-check by months).
  const winFrom = firstDep;
  const winTo = lastArr;
  const posMin = fits.reduce((s, f) => s + blockMin(f.posIn) + blockMin(f.posOut), 0);
  const progFH = ((prog.revenueMin + prog.emptyMin + posMin) * 0.92) / 60;
  let fhBefore = 0;
  let fhDuring = 0;
  for (const f of flightsOf(g, ac.id)) {
    if (f.status !== 'scheduled' && f.status !== 'enroute') continue;
    const fh = Math.max(0, f.block - 20) / 60;
    if (f.std < winFrom) fhBefore += fh;
    else if (f.std < winTo) fhDuring += fh;
  }
  const maints = Object.values(g.maintenance).filter((m) => m.aircraftId === ac.id && (m.status === 'planned' || m.status === 'inWork'));
  const aBooked = maints.find((m) => m.kind === 'A' && m.start < winTo);
  const aLeft = t.aCheckFH - ac.maint.fhSinceA;
  const aCal = ac.maint.lastA + A_CHECK_DAYS * DAY;
  // When the FH limit bites, spreading the window's hours evenly over it.
  const leftAtStart = aLeft - fhBefore;
  const fhIn = progFH + fhDuring;
  const aFH = leftAtStart <= 0 ? winFrom - 1 : leftAtStart < fhIn ? winFrom + Math.round(((winTo - winFrom) * leftAtStart) / fhIn) : Infinity;
  const aDue = Math.min(aCal, aFH);
  const why = aDue === aCal ? `${A_CHECK_DAYS}-day limit` : `${t.aCheckFH} FH limit`;
  const cDue = ac.maint.lastC + Math.round(t.cCheckMonths * 30.44) * DAY;
  const cPlannedBefore = maints.some((m) => m.kind === 'C' && m.end <= winFrom);
  const checkMin = t.aCheckHours * 60 + 180;
  // A gap between trips (at home or the trip's end) long enough for an A-check before it falls due.
  const gapBefore = (due: Minute) => fits.some((f, i) => {
    const nx = fits[i + 1];
    if (!nx) return false;
    const from = f.trip.sta + turn + blockMin(f.posOut);
    const to = Math.min(due, nx.trip.std - turn - blockMin(nx.posIn));
    return to - from >= checkMin;
  });
  if (cDue <= winTo && !cPlannedBefore) {
    add('maintenance', 'no', cDue <= g.now ? `C-check overdue since ${fmtDay(cDue)}` : `C-check due ${fmtDay(cDue)}, inside the job: ${t.cCheckDays} days in the hangar`, 'Plan the C-check before the job, or pick another aircraft.');
  } else if (aBooked) {
    add('maintenance', 'ok', `A-check booked ${fmtDay(aBooked.start)} at ${aBooked.at}`, `C-check due ${fmtDay(cDue)}.`);
  } else if (aDue > winTo) {
    add('maintenance', 'ok', `No check due: A-check in ${Math.max(0, Math.round(aLeft))} FH / ${Math.max(0, Math.round((aCal - g.now) / DAY))} days`, `C-check due ${fmtDay(cDue)}.`);
  } else if (aDue <= winFrom) {
    add('maintenance', 'warn', `A-check due ${fmtDay(Math.max(g.now, aDue))} (${why}), before the job starts`, `Book it first: ${t.aCheckHours} h in the hangar at ${home}.`);
  } else if (base && o.pattern.kind === 'base' && o.pattern.maintEvery > 0) {
    add('maintenance', 'ok', `A-check due ${fmtDay(aDue)}: fits a maintenance night at ${o.pattern.base}`, `The schedule keeps a ${t.aCheckHours} h+ night free every ${o.pattern.maintEvery} days; the planner books it there.`);
  } else if (gapBefore(aDue)) {
    add('maintenance', 'ok', `A-check due ${fmtDay(aDue)}: fits between trips`, `There is a ${t.aCheckHours} h+ gap at the right time; the planner books it there.`);
  } else {
    add('maintenance', 'warn', `A-check due ${fmtDay(aDue)} (${why}), in the middle of the job`, `Book it before departure (${t.aCheckHours} h at ${home}), or pick another aircraft.`);
  }

  // 12. Crew: capacity over the window, and augmentation on long duties.
  const progBH = (prog.revenueMin + prog.emptyMin + posMin) / 60;
  rep.crew = flyable ? crewAvailability(g, t.family, t.id, winFrom, Math.max(winFrom + DAY, winTo), progBH) : empty;
  const duty = reportMinutes(t.id).report + prog.longestChainMin;
  const augmented = duty > MAX_UNAUGMENTED_FDP;
  const shorts = Object.entries(rep.crew.byRole).filter(([, r]) => r && r.short > 0) as [string, { short: number }][];
  if (augmented && !g.company.approvals.includes('augmented')) add('crew', 'no', `A ${fmtDuration(duty)} duty needs an augmented crew: we have no approval for it`, 'Apply under Company → Approvals.');
  else if (augmented && !t.restClass) add('crew', 'no', `A ${fmtDuration(duty)} duty needs an augmented crew and the ${t.short} has no crew rest seat`);
  else if (shorts.length) {
    const what = shorts.map(([role, r]) => `${r.short} ${role}`).join(', ');
    add('crew', 'warn', `Short of crew: ${what}${rep.crew.firstShort ? ` from ${fmtDay(rep.crew.firstShort)}` : ''}`, 'Hire, or the roster will deadhead crew from other work; sets may run tight.');
  } else if (!rep.crew.setsNeeded && !Object.keys(rep.crew.byRole).length) add('crew', 'warn', 'Crew capacity not checked yet');
  else add('crew', augmented ? 'warn' : 'ok', `${augmented ? 'Augmented crew on long sectors; needs' : 'Needs'} ${rep.crew.setsNeeded} crew set${rep.crew.setsNeeded === 1 ? '' : 's'}, ${rep.crew.setsAvailable} free`);

  // Estimates (contribution: variable costs only).
  const posBH = posMin / 60;
  const revBH = prog.revenueMin / 60;
  const bh = revBH + prog.emptyMin / 60 + posBH;
  rep.estBH = Math.round(bh * 10) / 10;
  rep.estRevenue = Math.round(o.product.kind === 'wet' ? productValue(o.product, revBH + (o.product.positioningBillable ? posBH : 0), o.start, o.end) : productValue(o.product, revBH, o.start, o.end) * (1 - (o.broker ? BAL.brokerCommission : 0)));
  const age = Math.max(0, toDate(g.now).getUTCFullYear() - ac.builtYear - 12);
  let cost = t.maintBH * bh * (1 + age * BAL.maintAgeFactor);
  const crewN = complement(t.id, seats, { extraCabin: req.extraCabin + g.company.policies.extraCabin }).length;
  const perDiem = ((BAL.perDiem.CPT + BAL.perDiem.FO + (crewN - 2) * BAL.perDiem.CC) / crewN) * (g.company.policies.perDiemPct / 100);
  const hotel = BAL.hotelPerNight[g.company.policies.hotelTier] ?? 140;
  if (base && prog.base) {
    const sets = o.pattern.kind === 'base' && o.pattern.waves.length >= 3 ? 3 : 2;
    cost += sets * crewN * perDiem * prog.base.days;
  } else {
    for (const f of fits) {
      const span = (f.posOut.length ? f.posOut[f.posOut.length - 1].sta : f.trip.sta) - (f.posIn.length ? f.posIn[0].std : f.trip.std);
      cost += crewN * perDiem * Math.max(1, Math.ceil(span / DAY));
      if (!wet) {
        cost += crewN * hotel * Math.floor(span / DAY + 0.3);
        const far = f.trip.legs.reduce((m, l) => (distanceNm(home, l.to) > distanceNm(home, m) ? l.to : m), f.trip.from);
        cost += tripTickets(home, far, crewN, span + 90, span);
      }
    }
  }
  if (!wet) {
    const wide = t.body === 'wide';
    const deps = fits.reduce((s, f) => s + f.trip.legs.length + f.posIn.length + f.posOut.length, 0);
    const revDeps = fits.reduce((s, f) => s + f.trip.legs.filter((l) => l.kind !== 'positioning').length, 0);
    cost += bh * t.fuelTBH * g.market.fuelPrice + deps * BAL.airportFees[wide ? 1 : 0] + revDeps * BAL.catering[wide ? 1 : 0];
  }
  rep.estCost = Math.round(cost);
  rep.estMargin = rep.estRevenue - rep.estCost;
  return rep;
}

/** One report per fleet aircraft, best first (ok before warn before no, then margin). */
export function feasibilityAll(g: GameState, offerId: string): FeasibilityReport[] {
  return Object.keys(g.fleet)
    .map((id) => feasibility(g, offerId, id))
    .sort((a, b) => RANK[a.level] - RANK[b.level] || b.estMargin - a.estMargin);
}

export interface MarketFit {
  /** The aircraft-market offer that could fly this job, and when it would be delivered if signed today. */
  marketOfferId: string;
  typeId: string;
  deliversBy: Minute;
}

/**
 * The first aircraft on the market (by delivery) that could fly this offer and be delivered at least a week
 * before it starts: seats, cabin layout, family and range (fuel stops allowed unless the client wants none).
 * Lets an offer card say "can be flown by a market aircraft delivering by X". Pure.
 */
export function marketFit(g: GameState, offerId: string): MarketFit | null {
  const o = g.offers[offerId];
  if (!o) return null;
  const req = o.requirements;
  const p = o.pattern;
  const sectors: [string, string][] = p.kind === 'base' ? p.dests.flatMap((x) => [[p.base, x], [x, p.base]] as [string, string][]) : p.legs.map((l) => [l.from, l.to]);
  const noStops = o.pattern.kind === 'base' || !!req.noTechStops;
  let best: MarketFit | null = null;
  for (const m of g.market.aircraft) {
    if (m.expires <= g.now) continue;
    const t = typeOf(m.typeId);
    const deliversBy = g.now + m.leadDays * DAY;
    if (deliversBy > o.start - 7 * DAY || (best && deliversBy >= best.deliversBy)) continue;
    if (m.cabin.total < req.minSeats || (req.maxSeats && m.cabin.total > req.maxSeats)) continue;
    if ((req.layout && m.cabin.layout !== req.layout) || (req.families?.length && !req.families.includes(t.family))) continue;
    if (!sectors.every(([a, b]) => {
      const sp = planSector(t.id, a, b);
      return sp.ok && (!noStops || !sp.techStops.length);
    })) continue;
    best = { marketOfferId: m.id, typeId: m.typeId, deliversBy };
  }
  return best;
}
