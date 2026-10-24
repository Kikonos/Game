// Feasibility and aircraft selection (B1). DESIGN.md §5.1.5. Pure: no RNG, no ids, no writes.

import { ACMI_TYPES, ACMI_TYPES_LIST, type CabinLayout } from '../../data/acmiTypes';
import { AIRPORT_BY_CODE } from '../../data/airports';
import { BAL } from '../core/balance';
import { flightsOf } from '../core/entities';
import { distanceNm } from '../core/geo';
import { blockMinutes, complement, etopsNeeded, maxSectorNm, planSector, reportMinutes, runwayFit, typeOf } from '../core/perf';
import { DAY, fmtDate, fmtDateTime, fmtDay, fmtDuration, toDate } from '../core/time';
import type { AcRest, Aircraft, ApprovalId, ContractOffer, CrewExtra, GameState, Minute, RestRefitId } from '../core/types';
import { crewAvailability, offerExtra, type Availability } from '../crew';
import { dutyNeed, type ChainShape, type DutyNeed } from '../crew/duties';
import { restOf } from '../crew/restPlan';
import { minRest } from '../crew/rules';
import { dhBlock } from '../crew/timeline';
import { bestSlip, slipCost, slipDetail, type SlipPlan } from '../crew/slip';
import { A_CHECK_DAYS, anchorsOf, chainForward, chainsOf, CHARTER_SLACK, DEPLOY_LEAD, gapMoves, longestChains, maxPax, programmeOf, type Anchor, type ChainLeg, type Programme, type Trip } from './plan';
import { afterRefit, cabinAt, cabinFits, cabinOf, layoutsOf, refitTip, restAfterRefit, restRefitOptions } from '../ops/cabin';
import { aircraftGate, APPROVALS, gateApprovals, ratedPilots } from '../ops/company';
import { deliveryQuote } from '../ops/delivery';
import { paintQuote, paintWindow, type PaintSlot } from './paintTerms';
import { cabinQuote, cabinTarget, termsProduct } from './cabinTerms';
import { clientCabinSlot } from '../ops/clientCabin';
import { bodyText, maintWord, usd } from '../ops/util';
import { possessive } from './flavor';
import { productValue, tripTickets } from './pricing';
import { v08Lines } from './missionChecks';
import { dryFeasibility } from '../ops/dryLease';

export type CheckId = 'seats' | 'layout' | 'family' | /** v0.8 fix pack */ 'body' | 'range' | 'runway' | 'etops' | 'approvals' | 'availability' | 'maintenance' | 'crew' | 'positioning' | 'lease' | 'paint' | 'restSeats' | /** v0.7.3 */ 'rest'
  /** v0.7.4 client cabin request */ | 'cabinReq'
  /** v0.8 */ | 'mission' | 'warRisk' | 'airspace' | 'clientCrew' | 'dryLease';
export type CheckLevel = 'ok' | 'warn' | 'no';

export interface FeasibilityCheck {
  id: CheckId;
  level: CheckLevel;
  label: string;
  detail?: string;
  /** v0.7: a fix the offer screen can start ("Plan refit…"). */
  action?: { kind: 'refit'; layout: CabinLayout } | /** v0.7.3 */ { kind: 'restRefit'; option: RestRefitId; /** absent (lets older UI code read .layout) */ layout?: undefined }
    | /** v0.8 book the C-check first */ { kind: 'cCheck'; aircraftId: string; layout?: undefined };
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
  /** v0.5.1: paint-shop slot before the job (offers with client paint, paint on). */
  paint?: PaintSlot;
  /** v0.7.4: the client's reconfiguration window (offers with a cabin request, on, when the cabin must change). */
  cabinSlot?: { label: string; start: Minute };
}

const RANK: Record<CheckLevel, number> = { ok: 0, warn: 1, no: 2 };
const ETOPS_APPROVALS: [ApprovalId, number][] = [['etops240', 240], ['etops180', 180], ['etops120', 120]];
/** v0.7: approval names for the check lines. */
const APPROVAL_NAME: Partial<Record<ApprovalId, string>> = Object.fromEntries(APPROVALS.map((x) => [x.id, x.name]));
const nm = (v: number) => `${Math.round(v).toLocaleString('en-US')} nm`;
const LAYOUT_NAME: Record<string, string> = { 'all-economy': 'all-economy', 'two-class': 'two-class', 'three-class': 'three-class', vip: 'VIP' };

/** v0.7: when a delivering aircraft is home (the delivery ferry's last arrival, else the handover). */
function homeBy(g: GameState, ac: Aircraft): Minute {
  let t = ac.deliveredAt;
  for (const id of ac.delivery?.ferryIds ?? []) {
    const f = g.flights[id];
    if (f && f.status !== 'cancelled') t = Math.max(t, f.eta ?? f.sta);
  }
  return t;
}

/** v0.7: a booked lease return takes the aircraft from its return ferry's departure (else the check's start). */
function returnFrom(g: GameState, ac: Aircraft): Minute | null {
  const r = ac.returning;
  if (!r) return null;
  const fs = r.ferryIds.map((id) => g.flights[id]).filter((f) => f && f.status === 'scheduled');
  if (fs.length) return Math.min(...fs.map((f) => f.std));
  return g.maintenance[r.maintId]?.start ?? null;
}

function describe(g: GameState, a: Anchor): string {
  if (a.kind === 'maint') {
    const m = g.maintenance[a.id];
    return m ? `${maintWord(m)} at ${m.at} ${fmtDay(m.start)}–${fmtDay(m.end)}` : 'maintenance';
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

/** Full report for one aircraft: the 12 checks of DESIGN §5.1.5 (+ client paint), positioning plan and contribution estimate. */
/**
 * A short-notice job flown in from far away: the positioning crew can't fly on (positioning, the turn and the first
 * sector chain past 13 h of duty) and no crew on an airline ticket lands with minimum rest before the first report.
 * The reason, or null when a crew can make it. Pure.
 */
function crewReach(g: GameState, o: ContractOffer, typeId: string, f: TripFit | undefined): string | null {
  if (!f || !f.posIn.length) return null;
  const rm = reportMinutes(typeId);
  let dep: string;
  let std: Minute;
  let end: Minute;
  if (f.trip.legs.length) {
    const legs = f.trip.legs;
    let n = 1;
    while (n < legs.length && legs[n].kind === 'techstop') n++;
    [dep, std, end] = [legs[0].from, legs[0].std, legs[n - 1].sta];
  } else if (o.pattern.kind === 'base' && o.pattern.dests.length) {
    // A base: its first wave, out and back to the first destination.
    const b = o.pattern.base;
    const x = o.pattern.dests[0];
    [dep, std] = [b, Math.max(o.pattern.from, f.trip.std)];
    end = std + blockMinutes(typeId, b, x) + typeOf(typeId).turnMin + blockMinutes(typeId, x, b);
  } else return null;
  const report = std - rm.report;
  // Positioned as late as the first departure allows (the plan may fly it in earlier and wait).
  const posDur = f.posIn[f.posIn.length - 1].sta - f.posIn[0].std;
  const onFrom = Math.max(f.posIn[0].std, std - typeOf(typeId).turnMin - posDur) - rm.report;
  // Table 2's best cell: a crew positioned in the same day can fly it (a quick screen; the roster measures it exactly).
  if (end + rm.post - onFrom <= 13 * 60) return null;
  // A fresh crew: the earliest airline ticket from home, then minimum rest away from base.
  const blk = dhBlock(g.company.homeBase, dep);
  const lands = Math.ceil((g.now + BAL.deadheadCheckIn) / 60) * 60 + blk;
  if (lands + minRest({ dutyMin: blk + BAL.deadheadCheckIn, atHome: false, augmented: false, tzShift: 0 }) <= report) return null;
  return `No crew can be at ${dep} for the first departure ${fmtDateTime(std)}: the positioning crew would be on duty ${fmtDuration(end + rm.post - onFrom)}, and a crew on an airline lands ${fmtDateTime(lands)} with no time to rest`;
}

export function feasibility(g: GameState, offerId: string, aircraftId: string, opts: { paint?: boolean; cabin?: boolean; crewExtra?: CrewExtra; quick?: boolean } = {}): FeasibilityReport {
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
  // v0.8 a dry lease out has its own checks (no flying of ours but the ferries).
  if (o.product.kind === 'dry') return dryFeasibility(g, o, ac, rep, add);
  const t = typeOf(ac.typeId);
  const turn = t.turnMin;
  const req = o.requirements;
  const home = g.company.homeBase;
  const wet = o.product.kind === 'wet';
  const base = o.pattern.kind === 'base';

  // 1–3. Cabin and type (v0.7: a refit planned to end before the start counts).
  const { cabin: cab0, refitEnd } = cabinAt(g, ac, o.start);
  // v0.7.4 a client cabin request (on): the work flies the client's layout after a quick reconfiguration.
  const cabinOn = !!o.cabin && (opts.cabin !== false || o.cabin.required);
  const target = o.cabin ? cabinTarget(ac.typeId, o.cabin.layout) : null;
  const changing = cabinOn && !!target && cab0.layout !== o.cabin!.layout;
  const cab = changing ? cabinOf(target!) : cab0;
  const after = changing ? ' after the client’s reconfiguration' : refitEnd !== null ? ` ${afterRefit(refitEnd)}` : '';
  const seats = cab.total;
  // v0.8 fix pack: seats = passengers ('168 seats: the client needs 170 (170 passengers)', '180 seats for 166 passengers').
  const pax = maxPax(o.pattern);
  const st = req.stretchers ? ` and ${req.stretchers} stretcher${req.stretchers === 1 ? '' : 's'}` : '';
  if (seats < req.minSeats) add('seats', 'no', `${seats} seats${after}: the client needs ${pax ? (req.minSeats === pax && !st ? `${pax}` : `${req.minSeats} (${pax} passengers${st})`) : `${req.minSeats}+`}`);
  else if (req.maxSeats && seats > req.maxSeats) add('seats', 'no', `${seats} seats${after}: the client wants at most ${req.maxSeats}`);
  else add('seats', 'ok', pax ? `${seats} seats${after} for ${pax} passengers${st}` : `${seats} seats${after} (client needs ${req.minSeats}+)`);
  // v0.8 fix pack: the body the client asks for (a widebody base, Hajj, Antarctica); no refit changes it.
  const bodyNo = !!req.body && req.body !== t.body;
  const wantL = layoutsOf(req);
  const layoutNo = !!wantL && !wantL.includes(cab.layout);
  const premiumNo = !!req.minPremium && cab.j + cab.w < req.minPremium;
  if (layoutNo || premiumNo) {
    const tip = bodyNo ? null : refitTip(g, ac, req);
    const names = (wantL ?? []).map((l) => LAYOUT_NAME[l]);
    const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}` : names[0] ?? '';
    const label = layoutNo
      ? `Needs ${/^[aeiou]/i.test(list) ? 'an' : 'a'} ${list} cabin${req.minPremium ? ` (${req.minPremium}+ premium seats)` : ''}; ${ac.reg} is ${cab.label}`
      : `Needs ${req.minPremium}+ premium seats; ${ac.reg} has ${cab.j + cab.w ? `${cab.j + cab.w}` : 'none'} (${cab.label})`;
    rep.checks.push({ id: 'layout', level: 'no', label, detail: tip?.text ?? 'No cabin layout of this type meets it.', ...(tip ? { action: { kind: 'refit' as const, layout: tip.layout } } : {}) });
    rep.level = 'no';
  } else add('layout', 'ok', `Cabin ${cab.label}${after}`);
  if (bodyNo) add('body', 'no', bodyText(req.body!, ac.reg, ac.typeId));
  if (req.families?.length && !req.families.includes(t.family)) add('family', 'no', `The client only takes ${req.families.join(' or ')}-family aircraft (crew commonality)`);
  else if (!bodyNo) add('family', 'ok', `${t.name}`);

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
    // v0.8 no fuel on the ice: the aircraft carries the way back (Antarctica).
    if (req.roundTrip && (AIRPORT_BY_CODE[b]?.ice || AIRPORT_BY_CODE[a]?.ice)) {
      const ice = AIRPORT_BY_CODE[b]?.ice ? b : a;
      const gate = ice === b ? a : b;
      if (2 * distanceNm(a, b) > usable) rangeNo.push(`No fuel at ${AIRPORT_BY_CODE[ice]?.city ?? ice}: ${gate}–${ice}–${gate} is ${nm(2 * distanceNm(a, b))} without refuelling; the ${t.short} reaches ${nm(usable)}`);
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

  // 7. Approvals (v0.7: plus the Ladder's gate for this type; a pending gate approval flies revenue only after its grant).
  const missing = req.approvals.filter((a) => !g.company.approvals.includes(a));
  const gate = gateApprovals(t.tier).filter((a) => !g.company.approvals.includes(a));
  const gateLate = gate.filter((a) => {
    const p = g.company.pendingApprovals.find((x) => x.id === a);
    return !p || p.done > o.start || !!p.waiting;
  });
  const gateText = gate.map((a) => {
    const p = g.company.pendingApprovals.find((x) => x.id === a);
    return `${APPROVAL_NAME[a] ?? a} ${p ? `pending, due ${fmtDate(p.done)}` : 'needed'}`;
  }).join('; ');
  if (missing.length) add('approvals', 'no', `Needs approval: ${missing.map((a) => APPROVAL_NAME[a] ?? a).join(', ')}`, 'Apply under Company → Ladder.');
  else if (gateLate.length) add('approvals', 'no', `${gateText}: the ${t.short} flies revenue after the grant`, 'Company → Ladder.');
  else if (gate.length) add('approvals', 'warn', `${gateText} (before the job starts)`, 'If the grant slips, the job cannot be flown.');
  else add('approvals', 'ok', req.approvals.length ? `Approvals held: ${req.approvals.map((a) => APPROVAL_NAME[a] ?? a).join(', ')}` : 'No special approvals');
  // v0.8 what the work needs, closures, war-risk cover, the client's cabin crew (one sentence each).
  for (const x of v08Lines(g, o, t.body === 'wide', prog.airports, sectors)) add(x.id, x.level, x.label, x.detail);

  // 8. Lease and delivery.
  const firstDep = rep.positionIn[0]?.std ?? fits[0]?.trip.std ?? o.start;
  const lastArr = rep.positionOut.length ? rep.positionOut[rep.positionOut.length - 1].sta : fits[fits.length - 1]?.trip.sta ?? o.end;
  if (ac.ownership.kind === 'dryLeaseIn' && ac.ownership.leaseEnd < Math.max(o.end, lastArr)) add('lease', 'no', `Lease returns ${fmtDate(ac.ownership.leaseEnd)}, before the job ends`);
  else if (ac.returning && (returnFrom(g, ac) ?? Infinity) < Math.max(o.end, lastArr)) add('lease', 'no', `Goes back to the lessor from ${fmtDay(returnFrom(g, ac)!)}`);
  else if (ac.status === 'delivering' && ac.deliveredAt > firstDep) {
    const dl = ac.delivery;
    add('lease', 'no', dl && dl.site !== home ? `Handed over at ${dl.site} ${fmtDay(ac.deliveredAt)}, after it would have to leave` : `Delivers ${fmtDay(ac.deliveredAt)}, after it would have to leave`);
  } else if (ac.delivery && ac.delivery.arrived === undefined && ac.delivery.site !== home) {
    // v0.7: home-by is the delivery ferry's last arrival; positioning comes from the timeline (the ferry legs are on it).
    // Without rated pilots (or already waiting at the site) that date is not firm: each day without them moves it.
    const r = ratedPilots(g, [typeOf(ac.typeId).family]);
    const firm = r.CPT >= 1 && r.FO >= 1 && ac.delivery.waitingSince === undefined;
    if (firm) add('lease', 'ok', `Home ${fmtDay(homeBy(g, ac))} after the delivery ferry`);
    else add('lease', 'warn', `Home ${fmtDay(homeBy(g, ac))} after the delivery ferry, if rated pilots fly it`, ac.delivery.waitingSince !== undefined ? 'The aircraft is waiting at the site for rated pilots: every day without them moves the ferry and this job.' : `No ${typeOf(ac.typeId).short}-rated pilots yet: the ferry waits a day at a time until they are.`);
  } else add('lease', 'ok', ac.ownership.kind === 'owned' ? 'Owned' : `Dry-leased until ${fmtDate(ac.ownership.leaseEnd)}`);

  // 9. Availability: overlaps with flights, maintenance and signed base deployments.
  let availNo = false;
  for (const a of conflicts) {
    if (a.kind === 'maint') rep.conflicts.maintenance.push(a.id);
    else if (a.kind === 'flight') rep.conflicts.flights.push(a.id);
    else if (a.kind === 'base') for (const f of flightsOf(g, ac.id)) if (f.contractId === a.contractId && f.status === 'scheduled') { rep.conflicts.flights.push(f.id); break; }
  }
  // v0.7.2 an aircraft being sold takes no new work.
  if (ac.sale) {
    availNo = true;
    add('availability', 'no', `Sold: goes to ${ac.sale.buyer} on ${fmtDay(ac.sale.closes)}`);
  } else if (!flyable) add('availability', 'warn', 'Not checked: the aircraft cannot fly the routes');
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

  // 10b. Client paint (v0.5.1): a paint-shop slot ending 24 h before the first departure, on top of the above.
  const paintOn = !!o.paint && opts.paint !== false;
  if (o.paint && !paintOn) {
    if (o.paint.required) add('paint', 'no', 'The client requires their livery on the aircraft', 'Counter without paint and they may walk away, or cut the rate.');
    else add('paint', 'ok', `Client livery declined: ${Math.round(o.paint.declinePct * 100)}% off the ${wet ? 'rate' : 'price'}`);
  } else if (o.paint) {
    const pt = o.paint;
    const first = fits[0]?.trip;
    const slot = flyable && !availNo && first ? paintWindow(g, ac.id, pt, first.std, undefined, { nextAt: first.from }) : null;
    const what = pt.kind === 'full' ? 'Full repaint' : 'Decals';
    const other = ac.paintedFor ? g.contracts[ac.paintedFor] : undefined;
    if (!flyable || availNo || !first) add('paint', availNo ? 'no' : 'warn', 'Paint not planned: the aircraft is busy');
    else if (!slot) add('paint', 'no', `No paint-shop slot: ${pt.days} day${pt.days > 1 ? 's' : ''} in a paint shop must end a day before ${fmtDateTime(first.std)} UTC`, `The aircraft is busy until then, or can't get to a paint shop and back in time.`);
    else {
      rep.paint = slot;
      const ferry = blockMin(slot.ferryIn);
      const where = `${what} at ${AIRPORT_BY_CODE[slot.shop]?.city ?? slot.shop}, ${fmtDay(slot.start)}–${fmtDay(slot.end)}`;
      const detail = `${slot.ferryIn.length ? `Ferry ${routeText(slot.ferryIn)} ${fmtDuration(ferry)}. ` : ''}Blocks the aircraft like a check. ${ac.livery === 'white' ? 'Back to plain white' : typeof ac.livery === 'object' ? 'Back in its own livery' : 'Back in our colours'} after the job (${pt.stripDays} day${pt.stripDays > 1 ? 's' : ''}).`;
      if (other && (other.status === 'active' || other.status === 'signed')) add('paint', 'warn', `${where}: it flies ${other.title} in ${possessive(g.clients[other.clientId]?.name ?? 'another client')} colours until then`, detail);
      else if (ferry > BAL.paint.longFerryMin) add('paint', 'warn', `${where}: long ferry to the shop (${fmtDuration(ferry)})`, detail);
      else add('paint', 'ok', where, detail);
    }
  }

  // 10c. v0.7.4 the client's cabin request: a quick reconfiguration in our hangar ending a day before the job.
  let cabinCost = 0;
  if (o.cabin && !cabinOn) add('cabinReq', 'ok', `Client cabin declined: ${Math.round(o.cabin.declinePct * 100)}% off the ${wet ? 'rate' : 'price'}`);
  else if (o.cabin && !target) add('cabinReq', 'no', `The client wants a ${LAYOUT_NAME[o.cabin.layout]} cabin; the ${t.short} has no such layout`);
  else if (o.cabin && target) {
    const q = cabinQuote(o.cabin, ac.typeId, cab0.layout);
    const pays = o.cabin.clientShare >= 1 ? 'client pays' : 'client pays half';
    if (!changing) add('cabinReq', 'ok', `Client cabin: ${ac.reg} is already ${cab0.label}, nothing to change`);
    else {
      const first = fits[0];
      const before = first ? (first.posIn.length ? first.posIn[0].std : first.trip.std) : null;
      const slot = flyable && !availNo && before !== null ? clientCabinSlot(g, ac.id, target.label, before) : null;
      if (!flyable || availNo || before === null) add('cabinReq', availNo ? 'no' : 'warn', 'Cabin change not planned: the aircraft is busy');
      else if (!slot) add('cabinReq', 'no', `No 2-day window in our hangar to reconfigure to ${target.label} before ${fmtDateTime(before)} UTC`, 'The aircraft is busy until then, or signed work after it needs the current cabin.');
      else {
        rep.cabinSlot = { label: target.label, start: slot.start };
        cabinCost = q.cost + q.back - q.reimbursed;
        add('cabinReq', 'ok', `Client cabin: quick reconfiguration to ${target.label}, ${fmtDay(slot.start)}–${fmtDay(slot.end)} (${pays}, ${usd(q.cost)}${q.back ? ` + ${usd(q.back)} to put back` : ''})`, `${q.days * 24} h in our hangar; the cabin crew minimum follows the new seats.`);
      }
    }
  }

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
  // v0.6: the crew need includes the extra crew (client request, or this aircraft's / the chosen setting).
  const xc = offerExtra(g, aircraftId, o.requirements, opts.crewExtra);
  // v0.7.3 C7 the real limit for each long chain's report time and sectors, then extension / split / 3 or 4 pilots
  // with this airframe's rest facilities and the rest plan (the worst chain wins).
  const rest = restOf(g, ac.id);
  // As the roster builds the duties: positioning in and out joined to the trip's own legs when one crew can fly
  // them as one duty (else the roster slips a fresh crew at the outstation and the trip's own chains stand).
  const joined = crewChains(g, fits.filter((f) => f.posIn.length || f.posOut.length).flatMap((f) => chainsOf([...f.posIn, ...f.trip.legs, ...f.posOut].map((l) => ({ std: l.std, sta: l.sta, from: l.from, to: l.to })))));
  const chains = [...prog.chains, ...joined.filter((c) => dutyNeed(g, t.id, rest, c).mode !== 'none')];
  const rn = restNeed(g, o, t.id, rest, chains);
  const augmented = rn.need?.mode === 'aug1' || rn.need?.mode === 'aug2';
  // v0.7 `quick` (a caller that only wants a flyable pick): no crew capacity sizing once another check says no.
  // Round 4 §W: a crew change puts a second crew in the air at the same time: one more set per concurrent slip.
  rep.crew = flyable && !(opts.quick && rep.level === 'no') ? crewAvailability(g, t.family, t.id, winFrom, Math.max(winFrom + DAY, winTo), progBH, xc, rn.extraSets) : empty;
  const shorts = Object.entries(rep.crew.byRole).filter(([, r]) => r && r.short > 0) as [string, { short: number }][];
  const reach = flyable ? crewReach(g, o, t.id, fits[0]) : null;
  if (reach) add('crew', 'no', reach, 'Too soon for this aircraft: a later start, or an aircraft already nearby.');
  else if (shorts.length) {
    const what = shorts.map(([role, r]) => `${r.short} ${role}`).join(', ');
    add('crew', 'warn', `Short of crew: ${what}${rep.crew.firstShort ? ` from ${fmtDay(rep.crew.firstShort)}` : ''}`, 'Hire, or the roster will deadhead crew from other work; sets may run tight.');
  } else if (!rep.crew.setsNeeded && !Object.keys(rep.crew.byRole).length) { if (flyable) add('crew', 'warn', 'Crew capacity not checked yet'); }
  else add('crew', 'ok', `Needs ${rep.crew.setsNeeded} crew set${rep.crew.setsNeeded === 1 ? '' : 's'}, ${rep.crew.setsAvailable >= rep.crew.setsNeeded ? `${rep.crew.setsAvailable} free` : 'enough free in each role'}`);
  if (rn.line) {
    // v0.7.4 seat rest everywhere: a refit can also lift a day that is too long for the seats (recliners, class 2).
    const fix = rn.level === 'no' && (rn.need?.why === 'noRest' || rn.need?.why === 'tooLong' || rn.need?.why === 'cabin') ? restRefitFix(g, ac.id, o, t.id, chains) : null;
    rep.checks.push({ id: 'rest', level: rn.level, label: rn.line, ...(rn.detail ? { detail: rn.detail } : {}), ...(fix ? { action: { kind: 'restRefit', option: fix } } : {}) });
    if (RANK[rn.level] > RANK[rep.level]) rep.level = rn.level;
  }
  // Seats curtained off for crew rest on the long legs (seat-based facilities only).
  const blocked = rn.blocked;
  if (augmented && blocked > 0) {
    const sellable = cab.total - blocked;
    const lvl = sellable < o.requirements.minSeats ? 'no' : sellable < o.requirements.minSeats + blocked ? 'warn' : 'ok';
    add('restSeats', lvl, `Crew rest: ${blocked} seats blocked on the long legs, ${sellable} sellable (needs ${o.requirements.minSeats})`);
  }

  // Estimates (contribution: variable costs only).
  const posBH = posMin / 60;
  const revBH = prog.revenueMin / 60;
  const bh = revBH + prog.emptyMin / 60 + posBH;
  rep.estBH = Math.round(bh * 10) / 10;
  const product = termsProduct(o, { paint: paintOn, cabin: cabinOn });
  rep.estRevenue = Math.round(product.kind === 'wet' ? productValue(product, revBH + (product.positioningBillable ? posBH : 0), o.start, o.end) : productValue(product, revBH, o.start, o.end) * (1 - (o.broker ? BAL.brokerCommission : 0)));
  // v0.9 §Y.2 fuel at cost: the client pays this aircraft's own burn on the revenue legs after flying.
  if (product.kind === 'charter' && product.fuelAtCost) rep.estRevenue += Math.round(revBH * t.fuelTBH * g.market.fuelPrice);
  const age = Math.max(0, toDate(g.now).getUTCFullYear() - ac.builtYear - 12);
  let cost = t.maintBH * bh * (1 + age * BAL.maintAgeFactor);
  const crewN = complement(t.id, seats, { extraCabin: xc.cabin, augment: rn.need?.mode === 'aug2' ? 2 : rn.need?.mode === 'aug1' ? 1 : 0, restCabin: rn.need?.plan?.extraCabin ?? 0 }).length + xc.pilot;
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
  if (paintOn) {
    // Our share of paint + strip, and the ferries to and from the shop (fuel and maintenance).
    const q = paintQuote(o, true);
    const ferryBH = rep.paint ? (blockMin(rep.paint.ferryIn) + blockMin(rep.paint.ferryOut)) / 60 : 0;
    cost += q.cost - q.reimbursed + ferryBH * (t.maintBH + t.fuelTBH * g.market.fuelPrice);
  }
  cost += cabinCost;
  // v0.9 §W crew changes at fuel stops: tickets, hotel and per diem for the slip crews (the client pays on a wet lease).
  if (!wet && rn.slips) cost += rn.slips.reduce((n, x) => n + slipCost(x), 0);
  rep.estCost = Math.round(cost);
  rep.estMargin = rep.estRevenue - rep.estCost;
  return rep;
}

/** One report per fleet aircraft, best first (ok before warn before no, then margin). */
export function feasibilityAll(g: GameState, offerId: string, opts: { paint?: boolean; cabin?: boolean; crewExtra?: CrewExtra } = {}): FeasibilityReport[] {
  return Object.keys(g.fleet)
    .map((id) => feasibility(g, offerId, id, opts))
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
    // v0.7: home after the delivery ferry; only types the Ladder lets us sign.
    if (!aircraftGate(g, m.typeId).ok) continue;
    const deliversBy = deliveryQuote(g, m.typeId, m.site ?? g.company.homeBase, g.now + m.leadDays * DAY).homeBy;
    if (deliversBy > o.start - 7 * DAY || (best && deliversBy >= best.deliversBy)) continue;
    if (m.cabin.total < req.minSeats || (req.maxSeats && m.cabin.total > req.maxSeats)) continue;
    if (!cabinFits(m.cabin, req) || (req.families?.length && !req.families.includes(t.family)) || (req.body && req.body !== t.body)) continue;
    if (!sectors.every(([a, b]) => {
      const sp = planSector(t.id, a, b);
      return sp.ok && (!noStops || !sp.techStops.length);
    })) continue;
    best = { marketOfferId: m.id, typeId: m.typeId, deliversBy };
  }
  return best;
}

// ---------- v0.7.3 the rest line (UPDATE-0.7.3.md §2.9) ----------

const NEED_RANK: Record<DutyNeed['mode'], number> = { basic: 0, split: 1, ext: 2, aug1: 3, aug2: 4, none: 9 };
const RANK_NEED = NEED_RANK;

/** v0.7.3 class 1 rest for pilots and cabin crew (bunks): what an ultra-long-range day is planned against. */
export const ULR_REST: AcRest = { fc: { cls: 1, kind: 'fcrc', places: 2 }, cc: { cls: 1, kind: 'ccrc', places: 8 } };

/** v0.7.3 a ULR round trip on the best type: its worst day (the more demanding sector). */
export interface UlrNeed { typeId: string; need: DutyNeed }

/**
 * v0.7.3 (EASA guide 2026-10 §6.2; CS FTL.1.205(c)): can a crew legally fly home–far nonstop both ways? For every
 * type that flies the sector without a fuel stop and can carry bunks for both crews (class 1), each sector is planned
 * as the roster plans a duty (dutyNeed: report, block and the in-flight rest plan; the maximum is 18:00 with 4 pilots,
 * class 1 for both crews and one sector over 9 h). The type with the shortest worst day, or null when no type and
 * crew can fly it within the limits. Pure.
 */
export function ulrNeed(g: GameState, home: string, far: string, out: Minute, back: Minute): UlrNeed | null {
  // Planned as if we held the augmented crew approval (a ULR offer is the top of the ladder).
  const gx: GameState = g.company.approvals.includes('augmented') ? g : { ...g, company: { ...g.company, approvals: [...g.company.approvals, 'augmented'] } };
  let best: UlrNeed | null = null;
  for (const t of ACMI_TYPES_LIST) {
    const R = t.rest;
    if (!t.available || t.body !== 'wide' || !(R.bunkShare > 0 || R.mro)) continue;
    let worst: DutyNeed | null = null;
    for (const [a, b, std] of [[home, far, out], [far, home, back]] as [string, string, Minute][]) {
      const sp = planSector(t.id, a, b);
      if (!sp.ok || sp.techStops.length) {
        worst = null;
        break;
      }
      const n = dutyNeed(gx, t.id, ULR_REST, { from: a, std, legs: [{ std, sta: std + blockMinutes(t.id, a, b), from: a, to: b }] });
      if (n.mode === 'none') {
        worst = null;
        break;
      }
      if (!worst || NEED_RANK[n.mode] > NEED_RANK[worst.mode] || (n.mode === worst.mode && n.fdp > worst.fdp)) worst = n;
    }
    if (worst && (!best || worst.fdp < best.need.fdp)) best = { typeId: t.id, need: worst };
  }
  return best;
}

/** The programme's chains cut at the home base (a crew change) as well as at night stops: the 5 longest. */
export function crewChains(g: GameState, chains: ChainShape[]): ChainShape[] {
  const home = g.company.homeBase;
  return longestChains(chains.flatMap((c) => chainsOf(c.legs.map((l, i) => ({ std: l.std, sta: l.sta, from: l.from ?? (i ? '?' : c.from), to: l.to ?? '?' })), home)));
}

/** A chain's need is 'warn' on its own: a 4th pilot, or extra cabin crew for the rest plan. */
const warnNeed = (n: DutyNeed) => n.mode === 'aug2' || (n.plan?.extraCabin ?? 0) > 0;

/**
 * The worst chain's need on this type and facilities, the check line, its level and the seats it blocks. `extraSets`:
 * the most slipping chains in the air at once (each puts a second crew up: one more set, §W.1). Pure.
 */
export function restNeed(g: GameState, o: ContractOffer, typeId: string, rest: AcRest, chains: ChainShape[]): { need: DutyNeed | null; level: CheckLevel; line: string | null; detail?: string; blocked: number; slips?: SlipPlan[]; extraSets: number } {
  let worst: DutyNeed | null = null;
  // Round 4: the worst chain that does not slip, so a 4-pilot or extra-cabin warning is not hidden by the slip line.
  let worstPlain: DutyNeed | null = null;
  let blocked = 0;
  const slips: { plan: SlipPlan; to: string; from: Minute; till: Minute }[] = [];
  for (const c of crewChains(g, chains)) {
    let n = dutyNeed(g, typeId, rest, c);
    let slipped = false;
    // v0.9 §W a chain too long for one crew splits at a fuel stop: a fresh crew flies in and takes over.
    if (n.mode === 'none') {
      const sp = bestSlip(g, typeId, rest, c);
      if (sp) {
        slips.push({ plan: sp, to: c.legs[c.legs.length - 1].to ?? '', from: c.std, till: c.legs[c.legs.length - 1].sta });
        n = RANK_NEED[sp.second.mode] >= RANK_NEED[sp.first.mode] ? sp.second : sp.first;
        slipped = true;
      }
    }
    if (n.plan?.ok) blocked = Math.max(blocked, ...Object.values(n.plan.blocked), 0);
    if (!worst || NEED_RANK[n.mode] > NEED_RANK[worst.mode] || (n.mode === worst.mode && n.fdp > worst.fdp)) worst = n;
    if (!slipped && (!worstPlain || NEED_RANK[n.mode] > NEED_RANK[worstPlain.mode] || (n.mode === worstPlain.mode && n.fdp > worstPlain.fdp))) worstPlain = n;
  }
  const extraSets = slips.reduce((m, a) => Math.max(m, slips.filter((b) => b.from < a.till && a.from < b.till).length), 0);
  const ulr = o.requirements.approvals.includes('ulr');
  if (ulr && !(rest.fc?.cls === 1 && rest.cc?.cls === 1)) return { need: worst, level: 'no', line: 'ULR needs bunks for pilots and cabin crew (class 1)', blocked, extraSets };
  if (!worst) return { need: null, level: 'ok', line: null, blocked, extraSets };
  if (slips.length && worst.mode !== 'none') {
    const s0 = slips[0];
    const stops = [...new Set(slips.map((x) => x.plan.at))];
    const line = stops.length === 1 ? s0.plan.text : `Crew change at ${stops.join(' and ')} (fresh crews fly in)`;
    const detail = `${slipDetail(s0.plan, s0.to, o.product.kind === 'wet')}${worstPlain && warnNeed(worstPlain) ? ` Another day: ${worstPlain.text}.` : ''}`;
    return { need: worst, level: 'warn', line, detail, blocked, slips: slips.map((x) => x.plan), extraSets };
  }
  const level: CheckLevel = worst.mode === 'none' ? 'no' : warnNeed(worst) ? 'warn' : 'ok';
  const R = typeOf(typeId).rest;
  const detail = worst.mode === 'none' && (worst.why === 'noRest' || worst.why === 'tooLong' || worst.why === 'cabin')
    ? (R.recliners || R.mro ? 'Better crew rest (Fleet → Crew rest: recliners or bunks), or pick an aircraft with bunks.' : 'Pick an aircraft with better crew rest (business seats or bunks).')
    : worst.mode === 'ext' ? 'Each crew member may fly at most 2 extended days in any 7.' : undefined;
  return { need: worst, level, line: worst.text, detail, blocked, extraSets };
}

/** The cheapest home-base crew rest refit that makes every chain plannable on this aircraft, else null. Pure. */
export function restRefitFix(g: GameState, aircraftId: string, o: ContractOffer, typeId: string, chains: ChainShape[]): RestRefitId | null {
  const ac = g.fleet[aircraftId];
  if (!ac) return null;
  const opts = restRefitOptions(g, aircraftId).filter((x) => x.where === 'home' && x.ok && x.id !== 'removeRecliners').sort((a, b) => a.cost - b.cost);
  for (const x of opts) {
    const after = restAfterRefit(ac, x.id).rest;
    if (restNeed(g, o, typeId, after, chains).level !== 'no') return x.id;
  }
  return null;
}

/**
 * v0.7.3 for long-haul offers (the longest chain over the no-rest limit at its report time and sectors, CS
 * FTL Table 2, on the smallest fitting widebody type): 'Longest day 15:40 · needs 3 pilots (bunks or business
 * seats)', 'Longest day 16:05 · needs 3 pilots with bunks, 4 with business seats'; null when 2 pilots without
 * rest can fly it. Pure.
 */
export function offerRestLine(g: GameState, offerId: string): string | null {
  const o = g.offers[offerId];
  if (!o) return null;
  // v0.7.3 ULR: the need in plain words, on the type that flies it with the shortest day (bunks for both crews).
  if (o.requirements.approvals.includes('ulr') && o.pattern.kind === 'legs' && o.pattern.legs.length >= 2) {
    const [a, b] = o.pattern.legs;
    const u = ulrNeed(g, a.from, a.to, a.dep, b.dep);
    const hm = (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
    if (!u) return 'ULR: longer than any crew may fly (18:00 even with 4 pilots in bunks)';
    return `ULR: ${u.need.mode === 'aug1' ? 3 : 4} pilots, bunks for pilots and cabin crew (class 1) · longest day ${hm(u.need.fdp)} of ${hm(u.need.max)}`;
  }
  const types = Object.values(ACMI_TYPES).filter((t) => t.body === 'wide' && t.available).sort((a, b) => a.maxSeats - b.maxSeats);
  const NO_REST: AcRest = { fc: null, cc: null };
  const fc1: AcRest = { fc: { cls: 1, kind: 'fcrc', places: 2 }, cc: { cls: 1, kind: 'ccrc', places: 8 } };
  const j2: AcRest = { fc: { cls: 2, kind: 'jSeats', places: 2 }, cc: { cls: 2, kind: 'jSeats', places: 5 } };
  for (const t of types) {
    const cabin = t.cabins[0];
    if (cabin.j + cabin.w + cabin.y < o.requirements.minSeats) continue;
    const prog = programmeOf(o, t.id);
    if (!prog.ok) continue;
    const chains = crewChains(g, prog.chains);
    if (!chains.length) continue;
    // The worst chain without in-flight rest (Table 2 at its own report time and sectors).
    let c = chains[0];
    let solo = dutyNeed(g, t.id, NO_REST, c);
    for (const x of chains.slice(1)) {
      const n = dutyNeed(g, t.id, NO_REST, x);
      if (NEED_RANK[n.mode] > NEED_RANK[solo.mode] || (n.mode === solo.mode && n.fdp > solo.fdp)) [c, solo] = [x, n];
    }
    if (solo.mode === 'basic') return null;
    const hmm = `${Math.floor(solo.fdp / 60)}:${String(solo.fdp % 60).padStart(2, '0')}`;
    if (solo.mode === 'ext') return `Longest day ${hmm} · fits a planned extension (2 pilots, twice a week per crew)`;
    if (solo.mode === 'split') return `Longest day ${hmm} · fits a split duty (a rest on the ground)`;
    const pilots = (n: DutyNeed) => (n.mode === 'aug1' ? 3 : n.mode === 'aug2' ? 4 : 0);
    const a = pilots(dutyNeed(g, t.id, fc1, c));
    const b = pilots(dutyNeed(g, t.id, j2, c));
    // v0.9 §W: a slip offer splits that day at the fuel stop (the aircraft rows say who flies each half).
    if (!a && !b) return o.slip?.at.length ? `Longest day ${hmm} · crew change at ${o.slip.at.join(' and ')}` : `Longest day ${hmm} · too long for in-flight rest`;
    if (a && a === b) return `Longest day ${hmm} · needs ${a} pilots (bunks or business seats)`;
    if (!b) return `Longest day ${hmm} · needs ${a} pilots and bunks`;
    if (!a) return `Longest day ${hmm} · needs ${b} pilots (business seats)`;
    return `Longest day ${hmm} · needs ${a} pilots with bunks, ${b} with business seats`;
  }
  return null;
}
