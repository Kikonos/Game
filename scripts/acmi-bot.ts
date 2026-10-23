// BLOCK HOURS headless year (DESIGN.md §7.3): a new Startup game (Lisbon, 2× A320ceo) played by a simple,
// sensible policy, with a monthly table and the balance targets.
//   npx tsx scripts/acmi-bot.ts [seed] [days]        one game (default seed 1, 365 days)
//   npx tsx scripts/acmi-bot.ts [seed] --det         determinism: same seed twice to day 180, and save/load at day 90
//   npx tsx scripts/acmi-bot.ts [seed] [days] --wide  v0.6: lease the first affordable widebody (conversion classes)
//   … --wide --aug  v0.7.3: with Widebody operations and augmented crews granted at the start (in-flight rest in play)
//   … --b744  v0.8 fix pack: the widebody is a Boeing 747-400 (e.g. `1 --wide --aug --b744`)
//   … --msgs (inbox lines to stderr) · --why (v0.7.3: why each new offer found no aircraft, to stderr) · --dump=day,file
//
// Policy (a pure function of the game state, so a loaded save plays on identically):
// - offers: base deployments first, then ad hoc fill-ins; accept the best ok/warn feasibility with a positive
//   margin (crew shortfalls only when hires join in time); counter long-lead base deals at +5% once;
// - crew: fill staffing (widebodies: two more crew sets each, dual-type cabin crew count half; pilots past the rated pool
//   in a second batch), hire one more set when the family's pilots fly > 80% of productive hours;
// - maintenance: C-checks booked when warned, in the first free window (winter first); A-checks auto;
// - decisions: swap aircraft on AOG when one is free, else the cheapest option by its chips (v0.7.3), factor a late
//   invoice when cash is short, else the default;
// - fleet: lease a widebody once the cash covers its deposit, three months of its fixed costs and a cushion, the last
//   quarter was profitable and a big widebody job starts after delivery; its crew hired to join a week before it can fly;
// - client paint (v0.5.1): required paint is accepted with the job; optional paint is taken when the client pays at
//   least half or adds a rate bonus; never countered away;
// - v0.6 crew: per diem 110% when company morale sits below 55 for two weeks, 5★ hotels if still below 52 four weeks
//   later, defaults again above 66; one replacement hired per resignation; a conversion booked from surplus crew
//   when a new type arrives (or a family is 2+ sets short far enough ahead); one extra cabin crew on widebodies;
//   the client's paid extra cabin crew taken when staffing allows.
// - v0.7 the Ladder: ETOPS 120 from month 4 when affordable and two over-water jobs are on the board; Widebody operations from day 120 off a $1.2M+ quarter, 4 + 4
//   pilots rated on (or converting to) a widebody family first (hired when the narrowbody surplus is short); augmented
//   crews once a widebody is held and a 13 h+ widebody job was seen; ETOPS 180 / 240 when ready with $2M spare; never ULR.
// - v0.7 market: the widebody rule above, only for types the Ladder lets us sign; a second narrowbody lease when the
//   fleet is ≥ 75% committed over the next 60 days and cash covers the deposit + $1M; never new-build. A delivery
//   waiting for rated pilots: two rated pilots hired (once). Lease notices: extend 12 months when the aircraft is
//   ≥ 50% used over 90 days or a contract runs past the lease end − 30 days, else return.
// - v0.7 refits (at most one per 180 days): an open premium sports or VIP job worth $1.2M+ whose only failing check is
//   the cabin, when the cheapest refit ends before it and costs < 40% of it: booked, then the job taken.
// - v0.7.1 Crew Control (UPDATE-0.7.1.md §16): for each crew-short flight inside 36 h, the first available fix in the
//   order auto-fix → fly someone in → call in → swap (when the other flight stays crewed) → private jet (≤ 18 h out, ≥ 100
//   passengers, leaving 3 h+ sooner than waiting for a ticket, at most 8 a year) → discretion → delay (≤ 6 h) → sub-charter (cheaper than cancelling);
//   else the gate decision keeps today's defaults.
// - v0.7.2 (UPDATE-0.7.2.md §13): C-checks at MRO hubs (cCheckOptions → the cheapest hub whose slot ends before the due
//   date, winter first; bookCCheck books the ferries and the pilots' tickets); cabin crew short on two fleet families at
//   once are hired as one multi-type order; a widebody without bunks gets crew rest seats once augmented crews are held;
//   a lease is returned early only when it is the least used, under 1 BH a day for 90 days, with no work for 60 days,
//   6+ months left and a positive net (once a year); never sells. Captains fly as FO through the auto-roster only.
// - v0.7.3 (UPDATE-0.7.3.md §8): the feasibility rest line counts like any check, an aircraft whose rest line is ok
//   preferred over warn; crew rest refits once per aircraft while holding augmented crews, for a signed duty that
//   needs better rest (restFacility card) or an open job that fails only on rest: recliners on an economy-seat cabin
//   (v0.7.4; business seats and economy seats need no refit); crew bunks (pilots and cabin crew together) added to a
//   C-check for an A330/A340 with ≥ 8 augmented duties on class 2 rest; never overhead compartments. restTooShort →
//   fly it with 4 pilots. Crew Control's call-in takes standby crew first (engine).
// - v0.7.4: client cabin requests are taken as offered (the bot signs with them on); refits are quick and cheap now.

import { writeFileSync } from 'node:fs';
import LZString from 'lz-string';
import { BAL } from '../src/engine/core/balance';
import { statementTotals } from '../src/engine/core/ledger';
import { complement, typeOf } from '../src/engine/core/perf';
import { DAY, dayIndex, fmtDateTime, fmtMonth, fromUTC, monthKey, toDate } from '../src/engine/core/time';
import type { RatingFamily } from '../src/data/acmiTypes';
import type { Archetype, ContractOffer, CrewFix, GameState, LedgerCat, MonthKey, Role } from '../src/engine/core/types';
import { acceptOffer, counterOffer, feasibility, offerCompetition, type FeasibilityReport } from '../src/engine/contracts';
import { aboveMinimum, applyCrewFix, hireQuote, restOf, restPlan, setDutyAugment, classOf, conversionClasses, conversionEarliest, conversionPlan, crewControl, hireCrew, ratedMarket, setCrewExtra, shortFlights, staffing, startConversion, type CrewSolution, type StaffingLine } from '../src/engine/crew';
import { devFleet, devGrantApproval } from '../src/engine/dev';
import { createGame } from '../src/engine/newGame';
import {
  acquireAircraft, addRestToCCheck, aircraftGate, applyApproval, approvalBlocker, approvalReqs, APPROVALS, bookCCheck, bookRefit, bookRestRefit, cabinOptions, cancelCheck, cCheckOptions, cCheckSlots, checkStatus, deliveryStatus,
  earlyReturnQuote, fixedCosts, groundGaps, leastUsed, ratedPilots, refitQuote, refitSlots, refitStations, resolveDecision, restRefitOptions, returnEarly, saleQuote, sellAircraft, ticketPurpose,
} from '../src/engine/ops';
import { cabinAt, cabinFits, refitTip } from '../src/engine/ops/cabin';
import { deliveryQuote } from '../src/engine/ops/delivery';
import { devMarketOffer } from '../src/engine/ops/market';
import { restCards } from '../src/engine/problems/crew';
import type { ProblemCard } from '../src/engine/problems/types';
import type { ApprovalId } from '../src/engine/core/types';
import { chainAugment } from '../src/engine/contracts/offers';
import { programmeOf } from '../src/engine/contracts/plan';
import { isWideJob } from '../src/engine/contracts/pricing';
import { safetyTrips } from '../src/engine/core/safety';
import { deserialize, serialize } from '../src/engine/save';
import { advanceTo, settle } from '../src/engine/sim';
import { LEVEL_ORDER, levelOf } from '../src/engine/contracts/relations';
import { warRiskAt } from '../src/engine/ops/world';
import { acceptProposal, hireHead } from '../src/engine/ops/heads';
import { HEAD_IDS } from '../src/data/heads';


const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const seed = Number(args[0] ?? 1);
const days = Number(args[1] ?? 365);
const DET = process.argv.includes('--det');
const BIG = process.argv.includes('--big');
const MSGS = process.argv.includes('--msgs');
/** v0.6: take the first widebody lease the cash allows (exercises conversions and widebody extra crew). */
const WIDE = process.argv.includes('--wide');
/** v0.7.3 long-haul test mode: Widebody operations and augmented crews granted at the start (exercises in-flight rest). */
const AUG = process.argv.includes('--aug');
/** v0.8 fix pack: the widebody rule takes a Boeing 747-400 (one is posted on the market while none is on offer), its pilots rated B747. */
const B744 = process.argv.includes('--b744');
/** Fixed crew policies for the whole run (hotel★,perDiem%,tourWeeks), e.g. --policy=3,80,6 for stingy play. */
const POLICY = process.argv.find((a) => a.startsWith('--policy='))?.slice(9).split(',').map(Number);
/** Extra cabin crew on every aircraft (--extra=2). */
const EXTRA = Number(process.argv.find((a) => a.startsWith('--extra='))?.slice(8) ?? 0);
const BIG_DAYS = Number(process.env.BIG_DAYS ?? 120);
/** --dump=<day>,<file>: the save at the first step past that game day (debugging a run). */
const DUMP = process.argv.find((a) => a.startsWith('--dump='))?.slice(7).split(',');
const STEP = 6 * 60;

const newGame = () => {
  const g = createGame({ name: 'Atlântica Wings', code: 'AW', livery: { primary: '#0b1f4d', secondary: '#f5c451', tail: 'sweep' }, base: 'LIS', seed });
  if (AUG) for (const id of ['widebody', 'augmented'] as const) devGrantApproval(g, id);
  return g;
};

// ---------- policy (pure in g) ----------

/** Per-run tallies the policy reports into (never read by the policy). */
interface Tally {
  actions: Map<number, number>;
  decisions: Map<number, number>;
  /** Decisions answered per month, and by kind. */
  decMonth: Map<number, number>;
  decKinds: Map<string, number>;
  accepted: number;
  countered: number;
  firstAccept: number | null;
  wideAffordableAt: number | null;
  /** When the bot's own (stricter) signing test on cash first passed. */
  wideReadyAt: number | null;
  wideSigned: number | null;
  /** Tour series and troop rotations signed. */
  longLead: number;
  /** v0.5.1: offers with client paint signed ('full/req/50%'). */
  paintOffers: string[];
  /** v0.6: replacements hired for resignations, policy changes, conversions booked, paid extra crew taken. */
  rehired: number;
  policyChanges: string[];
  classesBooked: number;
  paidExtra: number;
  /** v0.7: approvals filed / granted (day), market offers seen per month and teasers, signings, refits, lease choices, delivery waits handled. */
  filed: string[];
  signed: string[];
  narrowSigned: number;
  refits: string[];
  leaseChoices: string[];
  waitHires: number;
  /** v0.7.1: Crew Control fixes applied by kind. */
  crewFixes: Map<string, number>;
  /** v0.7.2: hub C-checks booked (hub codes), their ferry + ticket cost, rest seats booked, multi-type cabin hires, early return day. */
  cHubs: string[];
  hubTravel: number;
  restSeats: number;
  multiHires: number;
  /** v0.7.3: crew rest refits booked ('reg option'), duties moved to 4 pilots. */
  restRefits: string[];
  aug4: number;
  earlyReturnDay: number | null;
  /** v0.8: signings by archetype code, the last deportation, flights asked about war-risk cover once, dry leases (months, income). */
  types: Map<string, number>;
  dryLeases: number;
}
const newTally = (): Tally => ({
  actions: new Map(), decisions: new Map(), decMonth: new Map(), decKinds: new Map(), accepted: 0, countered: 0, firstAccept: null, wideAffordableAt: null, wideReadyAt: null, wideSigned: null, longLead: 0, paintOffers: [],
  rehired: 0, policyChanges: [], classesBooked: 0, paidExtra: 0, filed: [], signed: [], narrowSigned: 0, refits: [], leaseChoices: [], waitHires: 0, crewFixes: new Map(),
  cHubs: [], hubTravel: 0, restSeats: 0, multiHires: 0, earlyReturnDay: null, restRefits: [], aug4: 0,
  types: new Map(), dryLeases: 0,
});

const weekOf = (g: GameState) => Math.floor((g.now - g.started) / (7 * DAY));
const act = (g: GameState, t: Tally, n = 1) => t.actions.set(weekOf(g), (t.actions.get(weekOf(g)) ?? 0) + n);

const isBase = (o: ContractOffer) => o.pattern.kind === 'base' || o.archetype === 'seasonBase' || o.archetype === 'aogCover';
const CODE: Partial<Record<Archetype, string>> = {
  seasonBase: 'SB', aogCover: 'AC', adhoc: 'AH', sports: 'SP', repatriation: 'RP', tourSeries: 'TS', troopRotation: 'TR', evacuation: 'EV', vip: 'VI',
  // v0.8
  hajj: 'HJ', unRotation: 'UN', deportation: 'DP', medical: 'MD', musicTour: 'MT', antarctic: 'AN', capacityLease: 'CL', subcharterIn: 'SI', dryLeaseOut: 'DL', humanitarian: 'HU',
};
/** v0.8 the client's level rank (Partner first at equal value). */
const levelRank = (g: GameState, o: ContractOffer) => LEVEL_ORDER.indexOf(levelOf(g, g.clients[o.clientId]));
const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7) >>> 0;

/** Pilot block hours over productive capacity, last 28 days (crew logs), for a rating family. */
function pilotUtil(g: GameState, family: RatingFamily): number {
  let block = 0;
  let n = 0;
  for (const c of Object.values(g.crew)) {
    if ((c.role !== 'CPT' && c.role !== 'FO') || !c.ratings.includes(family) || c.status === 'joining' || c.hired > g.now - 28 * DAY) continue;
    n++;
    for (const e of c.log) if (e.end > g.now - 28 * DAY) block += e.block;
  }
  return n ? block / 60 / (n * BAL.pilotBHMonth * (28 / 30.4)) : 0;
}

/**
 * v0.7.3 what an AOG option costs, read off its chips: the money (repair, team, sub-charter, compensation for legs
 * cancelled) plus $10K per reliability point (a hold that cancels legs costs 3, like cancelling).
 */
function aogCost(chips: string[]): number {
  let cost = 0;
  let rel = 0;
  for (const c of chips) {
    const m = /^[−-]\$([\d.]+)([KM]?)$/.exec(c);
    if (m) cost += Number(m[1]) * (m[2] === 'M' ? 1e6 : m[2] === 'K' ? 1e3 : 1);
    const r = /reliability −([\d.]+)/i.exec(c);
    if (r) rel += Number(r[1]);
    else if (/legs? cancelled$/.test(c)) rel += 3;
  }
  return cost + 10_000 * rel;
}

function decide(g: GameState, t: Tally): void {
  for (const d of [...g.decisions]) {
    const usable = (id: string) => d.options.some((o) => o.id === id && !o.chips?.includes('Unavailable'));
    let opt = d.defaultOption;
    if (d.kind === 'aog' && usable('swap')) opt = 'swap';
    // v0.7.3 otherwise the cheapest way through (an AOG team or a short wait before sub-chartering a long series).
    else if (d.kind === 'aog') opt = [...d.options].filter((o) => usable(o.id)).sort((a, b) => aogCost(a.chips ?? []) - aogCost(b.chips ?? []) || Number(b.id === d.defaultOption) - Number(a.id === d.defaultOption))[0]?.id ?? opt;
    else if (d.kind === 'latePayment' && g.company.cash < 600_000 && usable('factor')) opt = 'factor';
    // v0.8 favours: Trusted+ clients get the late-payment interest waived; a client below Trusted gets its extra
    // rotation or later departure while the A-check has 30 FH of room; small late-change fees are waived (Known+).
    else if (d.kind === 'latePayment' && usable('waive') && ['trusted', 'partner'].includes(levelOf(g, g.clients[String(d.data?.clientId ?? '')]))) opt = 'waive';
    else if (d.kind === 'changeRequest' && opt !== 'accept' && usable('accept')) {
      const c = g.contracts[String(d.data?.contractId ?? '')];
      const ac = c ? g.fleet[String(d.data?.aircraftId ?? '')] ?? g.fleet[g.flights[String(d.data?.flightId ?? '')]?.aircraftId ?? ''] : undefined;
      const below = c && !['trusted', 'partner'].includes(levelOf(g, g.clients[c.clientId]));
      if (below && ac && typeOf(ac.typeId).aCheckFH - ac.maint.fhSinceA >= 30 && !/fresh crew/.test(d.options.find((o) => o.id === 'accept')?.chips?.join(' ') ?? '')) opt = 'accept';
    } else if (d.kind === 'clientFee') opt = Number(d.data?.fee ?? 0) < 10_000 ? 'waive' : 'bill';
    else if (d.kind === 'airspace') opt = 'wait';
    else if (d.kind === 'uninsurable') {
      // Wait once (the leg then carries uninsured 'wait'), then cancel: read from the game, so a reload decides alike.
      opt = g.flights[String(d.data?.flightId ?? '')]?.uninsured === 'wait' ? 'cancel' : 'wait';
    }
    else if (d.kind === 'rescue') opt = 'accept';
    else if (d.kind === 'leaseEnd') opt = keepLease(g, String(d.data?.aircraftId ?? '')) ? 'extend12' : 'return';
    if (resolveDecision(g, d.id, opt).ok || resolveDecision(g, d.id, d.defaultOption).ok) {
      if (MSGS) console.error(`${fmtDateTime(g.now)} DECISION ${d.kind}:${opt} ${d.title} — ${d.options.map((o) => `${o.id}[${(o.chips ?? []).join('; ')}]`).join(' ')}`);
      act(g, t);
      t.decisions.set(weekOf(g), (t.decisions.get(weekOf(g)) ?? 0) + 1);
      t.decMonth.set(monthKey(g.now), (t.decMonth.get(monthKey(g.now)) ?? 0) + 1);
      t.decKinds.set(`${d.kind}:${opt}`, (t.decKinds.get(`${d.kind}:${opt}`) ?? 0) + 1);
    }
  }
}

/** Block hours flown over the last 90 days as a share of 8 BH a day. */
function util90(g: GameState, acId: string): number {
  let bh = 0;
  for (const f of Object.values(g.flights)) if (f.aircraftId === acId && f.status === 'done' && (f.ata ?? f.sta) > g.now - 90 * DAY) bh += ((f.ata ?? f.sta) - (f.atd ?? f.std)) / 60;
  return bh / (90 * 8);
}

/** v0.7 lease notice: keep an aircraft that works (≥ 50% over 90 days) or has a contract running past the lease end − 30 days. */
function keepLease(g: GameState, acId: string): boolean {
  const ac = g.fleet[acId];
  if (!ac || ac.ownership.kind !== 'dryLeaseIn') return true;
  const end = ac.ownership.leaseEnd;
  const busy = Object.values(g.contracts).some((c) => (c.status === 'signed' || c.status === 'active') && c.aircraftIds.includes(acId) && c.end > end - 30 * DAY);
  return busy || util90(g, acId) >= 0.5;
}

function hireFor(g: GameState, t: Tally, r: FeasibilityReport): void {
  const family = typeOf(g.fleet[r.aircraftId].typeId).family;
  for (const [role, cap] of Object.entries(r.crew.byRole)) {
    if (cap && cap.short > 0 && hireSplit(g, { role: role as Role, family, base: g.company.homeBase, count: Math.min(30, cap.short) }).ok) act(g, t);
  }
}

/**
 * Pilots past the month's rated pool take 1.5× as long to join (all of the batch): the pool's share is hired at
 * the normal lead, the rest in a second batch. Cabin crew in one go.
 */
function hireSplit(g: GameState, r: Parameters<typeof hireCrew>[1]): { ok: boolean } {
  const left = ratedMarket(g, r.family, r.role)?.left;
  if (left === undefined || left === 0 || r.count <= left) return hireCrew(g, r);
  const a = hireCrew(g, { ...r, count: left });
  const b = hireCrew(g, { ...r, count: r.count - left });
  return { ok: a.ok || b.ok };
}

/** Client paint on or off for an offer (required: on; optional: when they pay half or more, or add a bonus). */
const paintOn = (o: ContractOffer) => !!o.paint && (o.paint.required || o.paint.clientShare >= 0.5 || (o.paint.bonusPct ?? 0) > 0);

/** The best workable report for an offer, or null. */
/** Aircraft passing an offer's seats and family checks (the others' feasibility is 'no' anyway). */
function seatsFit(g: GameState, o: ContractOffer): string[] {
  const req = o.requirements;
  return Object.values(g.fleet)
    .filter((ac) => {
      const n = cabinAt(g, ac, o.start).cabin.total;
      return n >= req.minSeats && (!req.maxSeats || n <= req.maxSeats) && (!req.families?.length || req.families.includes(typeOf(ac.typeId).family));
    })
    .map((ac) => ac.id);
}

function bestFit(g: GameState, o: ContractOffer): FeasibilityReport | null {
  // Only aircraft that could pass (same pick as over the whole fleet, less work).
  const ids = seatsFit(g, o);
  if (!ids.length) return null;
  const all = ids.map((id) => feasibility(g, o.id, id, { paint: paintOn(o), quick: true }));
  const rank = { ok: 0, warn: 1, no: 2 } as const;
  // v0.7.3 an aircraft whose rest line is ok before one where it warns (a 4th pilot, a tight plan).
  const restRank = (r: FeasibilityReport) => rank[r.checks.find((c) => c.id === 'rest')?.level ?? 'ok'];
  return (
    all.sort((a, b) => rank[a.level] - rank[b.level] || restRank(a) - restRank(b) || b.estMargin - a.estMargin).find((r) => {
      if ((r.level !== 'ok' && r.level !== 'warn') || r.estMargin <= 0) return false;
      const crew = r.checks.find((c) => c.id === 'crew');
      return !crew || crew.level === 'ok' || (r.crew.firstShort !== null && r.crew.firstShort > g.now + 70 * DAY);
    }) ?? null
  );
}

/**
 * Base deployments first (biggest first), then ad hoc fill-ins inside the next 21 days. Thin multi-week series
 * (under 3 BH a day of span) are passed over so the calendar stays open for base work. New offers are looked at
 * on arrival, older ones every third day (a player skims the board a few times a week).
 */
function offers(g: GameState, t: Tally): void {
  const open = Object.values(g.offers)
    .filter((o) => o.status === 'open' && o.start >= g.now && g.now < o.expires)
    .filter((o) => o.created > g.now - DAY || (dayIndex(g.now) + hash(o.id)) % 3 === 0)
    // v0.8 Partner / Trusted clients first at equal value (their rate perk counts).
    .sort((a, b) => Number(isBase(b)) - Number(isBase(a)) || levelRank(g, b) - levelRank(g, a) || b.estValue - a.estValue);
  // v0.7: a calendar under half full over the next month takes ad hoc work up to 45 days out.
  const hungry = open.length > 0 && committed(g, 30) < 0.5;
  for (const o of open) {
    const span = Math.max(1, (o.end - o.start) / DAY);
    // v0.8 dry leases have their own policy; deportation at most once a year and only with a clean record (70+);
    // no evacuation into level-3 war risk.
    if (o.archetype === 'dryLeaseOut') continue;
    if (o.archetype === 'deportation' && (g.company.reputation.clean < 70 || Object.values(g.contracts).some((c) => c.archetype === 'deportation' && g.now - c.signed < 365 * DAY))) continue;
    if (o.archetype === 'evacuation' && warRiskAt(g, o.pin) > 2) continue;
    // Hajj only with a widebody of 300+ seats free for both phases (§13; a narrowbody airlift from Islamabad, crewed
    // from Lisbon, lost seed 2 every other rotation).
    if (o.archetype === 'hajj' && (o.requirements.body !== 'wide' || !Object.values(g.fleet).some((a) => typeOf(a.typeId).body === 'wide' && a.cabin.total >= 300))) continue;
    if (span > 10 && o.estBH / span < 3 && o.archetype !== 'unRotation') continue;
    // Ad hoc work inside 30 days (v0.6: was three weeks); tour series and troop rotations up to 90 days out (v0.8:
    // and the long-lead new work: Hajj, UN rotations, tours, Antarctica, deportation frameworks).
    const longLead = o.archetype === 'tourSeries' || o.archetype === 'troopRotation' || o.archetype === 'unRotation' || o.archetype === 'hajj' || o.archetype === 'musicTour' || o.archetype === 'antarctic' || o.archetype === 'deportation';
    // v0.8 (§13) an offer rivals are keen on is decided now: up to 90 days out instead of waiting for it to come closer.
    const keen = offerCompetition(g, o.id).level === 'strong';
    if (!isBase(o) && o.start > g.now + (longLead ? (o.archetype === 'hajj' || o.archetype === 'antarctic' ? 200 : 90) : keen ? 90 : hungry ? 45 : 30) * DAY) continue;
    const best = bestFit(g, o);
    if (!best && process.argv.includes('--why') && o.created > g.now - DAY) {
      for (const id of seatsFit(g, o)) {
        const r = feasibility(g, o.id, id, { paint: paintOn(o), quick: true });
        console.error(`${fmtDateTime(g.now)} WHY ${o.archetype} ${o.id} ${g.fleet[id].reg} ${r.level} m${Math.round(r.estMargin / 1000)}k ${r.checks.filter((c) => c.level !== 'ok').map((c) => `${c.id}:${c.level}:${c.label}`).join(' | ')}`);
      }
    }
    if (!best) continue;
    // A long-lead base deal is worth one counter at +5%; a refusal reopens it at the asking price.
    if (isBase(o) && !o.counter && o.product.kind === 'wet' && o.start > g.now + 14 * DAY && o.expires > g.now + 36 * 60) {
      if (counterOffer(g, o.id, o.product.ratePerBH * 1.05, [best.aircraftId], { paint: paintOn(o) }).ok) {
        t.countered++;
        act(g, t);
        continue;
      }
    }
    hireFor(g, t, best);
    const xc = paidExtra(g, o, best.aircraftId);
    if (acceptOffer(g, o.id, [best.aircraftId], { paint: paintOn(o), crewExtra: xc ?? undefined }).ok) {
      t.accepted++;
      const code = CODE[o.archetype] ?? o.archetype;
      t.types.set(code, (t.types.get(code) ?? 0) + 1);
      if (xc) t.paidExtra++;
      if (o.paint) t.paintOffers.push(`${o.paint.kind}${o.paint.required ? '/req' : ''}/${Math.round(o.paint.clientShare * 100)}%${paintOn(o) ? '' : ' declined'}`);
      if (longLead) t.longLead++;
      t.firstAccept ??= g.now;
      act(g, t);
    }
  }
}

/**
 * v0.8 dry lease out (§13): an aircraft free over the whole lease takes a fitting dry-lease request: a narrowbody
 * going out October–February and back before the summer peak (never the last of a family with base work running);
 * a widebody any time it has no job in the window; a leased-in airframe when the lessor's consent fee is under 15 %
 * of the rent it brings.
 */
function dryLeases(g: GameState, t: Tally): void {
  for (const o of Object.values(g.offers)) {
    if (o.archetype !== 'dryLeaseOut' || o.status !== 'open' || !o.dryFor || o.expires <= g.now) continue;
    const ac = g.fleet[o.dryFor];
    if (!ac || ac.status === 'leasedOut' || o.product.kind !== 'dry') continue;
    const wide = typeOf(ac.typeId).body === 'wide';
    if (ac.ownership.kind !== 'owned') {
      const consent = wide ? BAL.v08.dry.consent.wide : BAL.v08.dry.consent.narrow;
      if (ac.ownership.kind !== 'dryLeaseIn' || consent >= 0.15 * o.product.rentPerMonth * ((o.end - o.start) / (30.44 * DAY))) continue;
    }
    // Back before the summer peak (seed 4 leased one of its two A320s out from March to July and lost the summer).
    const back = toDate(o.end).getUTCMonth();
    // A narrowbody goes out in winter (October–February), never misses the summer peak (June–August) and is back
    // within 8 months.
    const peak = (y: number) => fromUTC(y, 6, 1);
    const y0 = toDate(o.start).getUTCFullYear();
    const overlapsSummer = [y0, y0 + 1].some((y) => o.start < peak(y) + 92 * DAY && o.end > peak(y));
    const startMo = toDate(o.start).getUTCMonth();
    if (!wide && (overlapsSummer || o.end - g.now > 240 * DAY || !(startMo >= 9 || startMo <= 1))) continue;
    const fam = typeOf(ac.typeId).family;
    const others = Object.values(g.fleet).filter((a) => a.id !== ac.id && typeOf(a.typeId).family === fam && a.status !== 'leasedOut' && a.status !== 'delivering');
    const baseLive = Object.values(g.contracts).some((c) => (c.status === 'active' || c.status === 'signed') && c.pattern.kind === 'base' && c.aircraftIds.some((id) => g.fleet[id] && typeOf(g.fleet[id].typeId).family === fam));
    if (!wide && !others.length && baseLive) continue;
    // ... and two more of the family keep flying when it is back only in June.
    if (!wide && back === 5 && others.length < 2) continue;
    // Free over the whole lease (feasibility: from the ferry out to two days after the return).
    if (feasibility(g, o.id, ac.id).level === 'no') continue;
    if (acceptOffer(g, o.id, [ac.id]).ok) {
      t.dryLeases++;
      t.types.set('DL', (t.types.get('DL') ?? 0) + 1);
      act(g, t);
    }
  }
}

/** v0.6: the client's paid extra cabin crew, when this aircraft's family has the cabin crew to spare (2 per extra seat per set). */
function paidExtra(g: GameState, o: ContractOffer, aircraftId: string): { cabin: number; pilot: 0 } | null {
  const paid = o.requirements.extraCabinPaid;
  if (!paid) return null;
  const family = typeOf(g.fleet[aircraftId].typeId).family;
  const cc = staffing(g).find((l) => l.family === family && l.role === 'CC');
  const cur = g.fleet[aircraftId].crewExtra?.cabin ?? g.company.policies.extraCabin;
  const want = o.requirements.extraCabin + paid.n;
  if (cur >= want) return { cabin: cur, pilot: 0 };
  return cc && cc.have - cc.need >= paid.n * 2 ? { cabin: want, pilot: 0 } : null;
}

/** Crew trouble in the inbox over the last two weeks (legs sub-chartered or cancelled for want of a legal crew). */
const crewTrouble = (g: GameState) => g.messages.filter((m) => m.cat === 'crew' && m.tone !== 'info' && m.t > g.now - 14 * DAY && /sub-chartered|cancelled/.test(m.title)).length;

/** Fill staffing; one more set per family when its pilots run hot or crew trouble keeps costing legs, and nobody is joining. */
function hire(g: GameState, t: Tally): void {
  // v0.7: widebody work (slip crews at each outstation of a long-haul base, no augmented crews early on, short-notice
  // AOG covers with sets on station) wants two more crew sets per widebody than the plain complement; hired at
  // signing so they join before the first job.
  const wideN = new Map<RatingFamily, number>();
  for (const ac of Object.values(g.fleet)) if (typeOf(ac.typeId).body === 'wide' && ac.status !== 'leasedOut') wideN.set(typeOf(ac.typeId).family, (wideN.get(typeOf(ac.typeId).family) ?? 0) + 1);
  // v0.7.2 cabin crew short on two fleet families at once: one multi-type order covers both (they count in each).
  const short = new Map<Role, { family: RatingFamily; n: number }[]>();
  for (const l of staffing(g)) {
    if (l.role !== 'PUR' && l.role !== 'CC') continue;
    const n = l.need - l.have - inClass(g, l);
    if (n > 0) short.set(l.role, [...(short.get(l.role) ?? []), { family: l.family, n }]);
  }
  for (const [role, xs] of short) {
    if (xs.length < 2) continue;
    const [a, b] = [...xs].sort((x, y) => y.n - x.n || (x.family < y.family ? -1 : 1));
    if (hireCrew(g, { role, family: a.family, families: [a.family, b.family], base: g.company.homeBase, count: Math.min(30, b.n) }).ok) {
      t.multiHires++;
      act(g, t);
    }
  }
  for (const l of staffing(g)) {
    const pilot = l.role === 'CPT' || l.role === 'FO';
    // Widebody cabin crew who also hold a narrowbody type fly both fleets: counted as half a widebody crew member.
    const shared = !pilot && wideN.has(l.family) ? Object.values(g.crew).filter((c) => c.role === l.role && c.ratings.includes(l.family) && c.ratings.length > 1 && !c.notice).length : 0;
    const have = l.have + inClass(g, l) - Math.ceil(shared / 2);
    // Two more sets of every role per widebody (one set's worth of each role per extra set).
    const need = l.need + (wideN.has(l.family) ? Math.round((2 * l.need) / Math.max(1, BAL.crewSetsPerAircraft * (wideN.get(l.family) ?? 1))) * (wideN.get(l.family) ?? 0) : 0);
    // v0.7.3 a widebody's crew join about a week before it can fly revenue (home and Widebody operations granted),
    // not at the signing: their salaries ran for months with the aircraft still parked or on its way.
    if (wideN.has(l.family) && hireQuote(g, { role: l.role, family: l.family, base: g.company.homeBase, count: 1 }).readyAt < wideFrom(g, l.family) - 7 * DAY) continue;
    if (have < need && hireSplit(g, { role: l.role, family: l.family, base: g.company.homeBase, count: Math.min(30, need - have) }).ok) act(g, t);
  }
  const fams = new Map<RatingFamily, { typeId: string; seats: number }>();
  for (const ac of Object.values(g.fleet)) if (ac.status !== 'delivering') fams.set(typeOf(ac.typeId).family, { typeId: ac.typeId, seats: ac.cabin.total });
  const trouble = crewTrouble(g) >= 4;
  for (const [family, x] of fams) {
    // v0.7: widebody work (long rotations, away bases, augmented duties) keeps a deeper bench.
    const wide = typeOf(x.typeId).body === 'wide';
    if ((!trouble && pilotUtil(g, family) < (wide ? 0.65 : 0.8)) || g.company.cash < 1_500_000) continue;
    if (Object.values(g.crew).some((c) => c.status === 'joining' && c.ratings.includes(family))) continue;
    const per = new Map<Role, number>();
    for (const r of complement(x.typeId, x.seats, { extraCabin: g.company.policies.extraCabin })) per.set(r, (per.get(r) ?? 0) + 1);
    for (const [role, n] of per) if (hireSplit(g, { role, family, base: g.company.homeBase, count: n }).ok) act(g, t);
  }
}

/** v0.7.3 when a widebody family first flies revenue: its first aircraft home and Widebody operations granted. */
function wideFrom(g: GameState, family: RatingFamily): number {
  const acs = Object.values(g.fleet).filter((a) => typeOf(a.typeId).body === 'wide' && typeOf(a.typeId).family === family);
  const home = Math.min(...acs.map((a) => (a.status === 'delivering' ? a.deliveredAt : g.now)));
  const grant = g.company.approvals.includes('widebody') ? g.now : g.company.pendingApprovals.find((p) => p.id === 'widebody')?.done ?? g.now;
  return Math.max(home, grant);
}

/** v0.6: crew of a staffing line's role booked on a class onto its family (they count once the course ends). */
const inClass = (g: GameState, l: StaffingLine) => conversionClasses(g).filter((k) => k.family === l.family).reduce((n, k) => n + k.crewIds.filter((id) => g.crew[id]?.role === l.role).length, 0);

/**
 * v0.6 resignations: one replacement of the same role, family and base per resignation. A resignation is matched by
 * a crew member hired after it was given (pure in g: a reload plays on identically).
 */
function rehire(g: GameState, t: Tally): void {
  const leaving = Object.values(g.crew).filter((c) => c.notice).sort((a, b) => a.notice!.given - b.notice!.given || (a.id < b.id ? -1 : 1));
  const used = new Set<string>();
  for (const c of leaving) {
    const fam = c.ratings[0];
    const match = Object.values(g.crew).filter((x) => !used.has(x.id) && !x.notice && x.role === c.role && x.ratings.includes(fam) && x.hired > c.notice!.given).sort((a, b) => (a.id < b.id ? -1 : 1))[0];
    if (match) {
      used.add(match.id);
      continue;
    }
    const r = hireCrew(g, { role: c.role, family: fam, base: c.base, count: 1 });
    if (r.ok) {
      used.add(r.data!.crewIds[0]);
      t.rehired++;
      act(g, t);
    }
  }
}

/**
 * v0.6 company policies: per diem 110% after two weeks below 55, 5★ hotels if still below 52 four weeks later,
 * the defaults again above 66 (weekly averages in g.stats.moraleWeeks).
 */
function policies(g: GameState, t: Tally): void {
  if (POLICY) {
    const [hotelTier, perDiemPct, rotationWeeks] = POLICY;
    Object.assign(g.company.policies, { hotelTier: hotelTier as 3 | 4 | 5, perDiemPct, rotationWeeks });
    return;
  }
  const w = g.stats.moraleWeeks ?? [];
  if (!w.length || Math.floor((g.now - g.started) / DAY) % 7 !== 1) return;
  const p = g.company.policies;
  const last = w[w.length - 1];
  const set = (patch: Partial<typeof p>, what: string) => {
    Object.assign(p, patch);
    t.policyChanges.push(`${what} day ${Math.floor((g.now - g.started) / DAY)}`);
    act(g, t);
  };
  if (last > 66 && (p.perDiemPct !== 100 || p.hotelTier !== 4)) set({ perDiemPct: 100, hotelTier: 4 }, 'defaults');
  else if (p.perDiemPct === 100 && w.length >= 2 && w.slice(-2).every((x) => x < 55)) set({ perDiemPct: 110 }, 'per diem 110%');
  else if (p.perDiemPct === 110 && p.hotelTier !== 5 && w.length >= 4 && w.slice(-4).every((x) => x < 52)) set({ hotelTier: 5 }, 'hotels 5★');
}

/** v0.6: one extra cabin crew on widebodies (set once per aircraft). */
function extraCrew(g: GameState, t: Tally): void {
  if (EXTRA) {
    for (const ac of Object.values(g.fleet)) if (!ac.crewExtra) setCrewExtra(g, { aircraftId: ac.id }, { cabin: EXTRA, pilot: 0 });
    return;
  }
  for (const ac of Object.values(g.fleet)) {
    if (typeOf(ac.typeId).body !== 'wide' || ac.crewExtra) continue;
    if (setCrewExtra(g, { aircraftId: ac.id }, { cabin: 1, pilot: 0 }).ok) act(g, t);
  }
}

/**
 * v0.6 conversions: a family with no rated crew (a new type) or short by 2+ sets with its aircraft or work 45+ days
 * out gets crew converted from the family with the most surplus (cabin crew keep their old type; pilots only when
 * the donor stays fully staffed), starting as early as possible; hire() hires the rest.
 */
function conversions(g: GameState, t: Tally): void {
  const lines = staffing(g);
  const fams = [...new Set(lines.map((l) => l.family))];
  for (const fam of fams) {
    const mine = lines.filter((l) => l.family === fam);
    const rated = Object.values(g.crew).some((c) => c.ratings.includes(fam) && !c.notice);
    const shortSets = Math.max(0, ...mine.map((l) => (l.need - l.have - inClass(g, l)) / Math.max(1, l.need / BAL.crewSetsPerAircraft)));
    const due = Math.min(...Object.values(g.fleet).filter((a) => typeOf(a.typeId).family === fam).map((a) => (a.status === 'delivering' ? a.deliveredAt : g.now)));
    if (rated && !(shortSets >= 2 && due > g.now + 45 * DAY)) continue;
    if (conversionClasses(g).some((k) => k.family === fam && k.status === 'planned')) continue;
    const take: string[] = [];
    for (const l of mine) {
      let short = l.need - l.have - inClass(g, l);
      if (short <= 0) continue;
      // Donors: same role, other families, most spare first. Pilots only from a family that stays fully staffed
      // (they give up the old type); cabin crew keep their old type, so a family lends up to 15% of its need for
      // the 8-day course.
      const pilot = l.role === 'CPT' || l.role === 'FO' || l.role === 'CRP';
      const spare = (x: StaffingLine) => (pilot ? x.have - x.need : Math.floor(x.have - 0.85 * x.need));
      const donors = lines.filter((x) => x.role === l.role && x.family !== fam && spare(x) > 0).sort((a, b) => spare(b) - spare(a) || (a.family < b.family ? -1 : 1));
      for (const d of donors) {
        const pool = Object.values(g.crew)
          .filter((c) => c.role === l.role && c.ratings.includes(d.family) && !c.ratings.includes(fam) && !c.notice && c.status !== 'joining' && !classOf(g, c.id) && c.ratings.length < 3)
          .sort((a, b) => (a.id < b.id ? -1 : 1));
        const n = Math.min(short, spare(d), pool.length);
        take.push(...pool.slice(0, n).map((c) => c.id));
        short -= n;
        if (short <= 0) break;
      }
    }
    if (!take.length) continue;
    const plan = conversionPlan(g, { crewIds: take, family: fam, start: conversionEarliest(g) });
    if (!plan.ok || plan.warnings.some((w) => w.level === 'bad')) continue;
    if (startConversion(g, { crewIds: take, family: fam, start: conversionEarliest(g) }).ok) {
      t.classesBooked += plan.classes.length;
      act(g, t);
    }
  }
}

/**
 * v0.7.2 C-checks at MRO hubs: once warned (≤ 90 days), the cheapest hub whose slot ends before the due date (+20 days
 * of tolerance), a winter slot first; bookCCheck books the ferries out and home (the roster tickets the pilots).
 */
function checks(g: GameState, t: Tally): void {
  for (const ac of Object.values(g.fleet)) {
    if (ac.status === 'delivering' || ac.sale || ac.returning) continue;
    const st = checkStatus(g, ac);
    if (st.nextC || st.cDue - g.now > 90 * DAY) continue;
    const dur = typeOf(ac.typeId).cCheckDays * DAY;
    const cands: { hub: string; start: number; total: number; winter: boolean }[] = [];
    for (const o of cCheckOptions(g, ac.id)) {
      if (!o.ok) continue;
      for (const s0 of cCheckSlots(g, ac.id, o.hub.code, 8)) {
        if (s0 + dur > st.cDue + 20 * DAY) break;
        cands.push({ hub: o.hub.code, start: s0, total: o.total, winter: [10, 11, 0, 1, 2].includes(toDate(s0).getUTCMonth()) });
      }
    }
    cands.sort((a, b) => Number(b.winter) - Number(a.winter) || a.total - b.total || a.start - b.start);
    // v0.7.3 pilots' bunks with the check for an aircraft flying ≥ 8 augmented duties on class 2 pilot rest.
    const fcrc = g.company.approvals.includes('augmented') && restOf(g, ac.id).fc?.cls === 2 && !hadRestFit(g, ac.id) && augDuties(g, ac.id) >= 8
      && restRefitOptions(g, ac.id).some((o) => o.id === 'fcrc' && o.ok);
    for (const c of cands) {
      const opt = cCheckOptions(g, ac.id, c.start, fcrc ? 'fcrc' : undefined).find((o) => o.hub.code === c.hub);
      if (fcrc && bookCCheck(g, ac.id, c.hub, c.start, { restFit: 'fcrc' }).ok) {
        t.restRefits.push(`${ac.reg} fcrc (C-check)`);
        t.cHubs.push(c.hub);
        t.hubTravel += opt ? opt.ferryCost + opt.crewCost : 0;
        act(g, t);
        break;
      }
      if (bookCCheck(g, ac.id, c.hub, c.start).ok) {
        t.cHubs.push(c.hub);
        t.hubTravel += opt ? opt.ferryCost + opt.crewCost : 0;
        act(g, t);
        break;
      }
    }
  }
}

/** v0.7.3 augmented duties on this aircraft reporting within 30 days either side of now (the state holds no older ones). */
function augDuties(g: GameState, acId: string): number {
  let n = 0;
  for (const d of Object.values(g.duties)) {
    if (d.augment > 0 && Math.abs(d.report - g.now) <= 30 * DAY && g.pairings[d.pairingId]?.aircraftId === acId) n++;
  }
  return n;
}

/** v0.7.3 a crew rest refit already booked or done on this aircraft (once per aircraft). */
const hadRestFit = (g: GameState, acId: string) => Object.values(g.maintenance).some((m) => m.aircraftId === acId && m.restFit && m.status !== 'cancelled');

/**
 * v0.7.3 crew rest refits (UPDATE-0.7.3.md §8), once per aircraft while holding augmented crews: a signed duty with no
 * rest (restFacility card) or an open job failing only on rest → curtained J seats (J ≥ 4) else recliners, first slot;
 * an A330/A340 flying ≥ 8 augmented duties on business-seat cabin rest → a lower-deck module when $3M stay after it.
 */
function restRefits(g: GameState, t: Tally, cards: ProblemCard[]): void {
  if (!g.company.approvals.includes('augmented')) return;
  const signed = new Set<string>();
  for (const c of cards) {
    if (c.subject.kind !== 'restFacility') continue;
    const ac = g.flights[c.subject.ref.id]?.aircraftId;
    if (ac) signed.add(ac);
  }
  for (const ac of Object.values(g.fleet)) {
    if (ac.status === 'delivering' || ac.sale || ac.returning || hadRestFit(g, ac.id)) continue;
    if (Object.values(g.maintenance).some((m) => m.aircraftId === ac.id && m.kind === 'refit' && (m.status === 'planned' || m.status === 'inWork'))) continue;
    const opts = restRefitOptions(g, ac.id).filter((o) => o.ok && o.where === 'home');
    const rest = restOf(g, ac.id);
    let pick: (typeof opts)[number] | undefined;
    // v0.7.4 every aircraft rests its crew in curtained seats; recliners (class 2) lift an all-economy cabin's class 3.
    if ((rest.cc?.cls ?? 3) >= 3 || (rest.fc?.cls ?? 3) >= 3) {
      const wanted = signed.has(ac.id) || openRestJob(g, ac.id);
      if (wanted) pick = opts.find((o) => o.id === 'recliners');
    }
    // v0.7.3 pilots' bunks added to a C-check already booked, for an aircraft flying ≥ 8 augmented duties on class 2.
    if (!pick && rest.fc?.cls === 2 && augDuties(g, ac.id) >= 8 && restRefitOptions(g, ac.id).some((o) => o.id === 'fcrc' && o.ok)) {
      const m = Object.values(g.maintenance).find((x) => x.aircraftId === ac.id && x.kind === 'C' && x.status === 'planned' && !x.restFit);
      if (m && addRestToCCheck(g, m.id, 'fcrc').ok) {
        t.restRefits.push(`${ac.reg} fcrc (added to C-check)`);
        act(g, t);
        continue;
      }
    }
    if (!pick) continue;
    const slot = refitSlots(g, ac.id, `rest:${pick.id}`, 1).slots[0];
    if (slot && bookRestRefit(g, ac.id, pick.id, slot.start).ok) {
      t.restRefits.push(`${ac.reg} ${pick.id}`);
      act(g, t);
    }
  }
}

/** v0.7.3 an open job (seen this week, $500k+) that this aircraft fails only on its in-flight rest, a refit fixing it. */
function openRestJob(g: GameState, acId: string): boolean {
  for (const o of Object.values(g.offers)) {
    if (o.status !== 'open' || o.estValue < 500_000 || o.start < g.now + 21 * DAY || !seatsFit(g, o).includes(acId)) continue;
    // Like the board: new offers on arrival, older ones every third day.
    if (o.created < g.now - DAY && (dayIndex(g.now) + hash(o.id)) % 3 !== 0) continue;
    const rep = feasibility(g, o.id, acId, { quick: true });
    const no = rep.checks.filter((c) => c.level === 'no');
    if (no.length === 1 && no[0].id === 'rest' && no[0].action?.kind === 'restRefit') return true;
  }
  return false;
}

/** v0.7.3 a duty whose cruise is too short for 3 pilots' rest: fly it with 4 pilots when the plan allows (once per duty). */
function restTooShort(g: GameState, t: Tally, cards: ProblemCard[]): void {
  for (const c of cards) {
    if (c.subject.kind !== 'restTooShort') continue;
    const d = g.duties[g.flights[c.subject.ref.id]?.dutyId ?? ''];
    if (!d || d.forceAug || d.report <= g.now) continue;
    if (setDutyAugment(g, d.id, 2).ok) {
      t.aug4++;
      act(g, t);
    }
  }
}

/**
 * v0.7.2 an early lease return (at most one a year): the least-used leased aircraft, under 1 BH a day over 90 tracked
 * days, no work in the next 60 days, 6+ months left and a positive net (rent saved + deposit − fee − return costs).
 */
function earlyReturns(g: GameState, t: Tally): void {
  if ((g.stats.earlyReturns ?? 0) > Math.floor(dayN(g) / 365)) return;
  const row = leastUsed(g, 'leased')[0];
  const ac = row ? g.fleet[row.aircraftId] : undefined;
  if (!row || !ac || ac.ownership.kind !== 'dryLeaseIn' || row.days < 90 || row.perDay >= 1) return;
  if (ac.ownership.leaseEnd - g.now < 182 * DAY) return;
  const busy = Object.values(g.flights).some((f) => f.aircraftId === ac.id && f.status === 'scheduled' && f.kind !== 'positioning' && f.std < g.now + 60 * DAY)
    || Object.values(g.contracts).some((c) => (c.status === 'signed' || c.status === 'active') && c.aircraftIds.includes(ac.id));
  if (busy) return;
  const q = earlyReturnQuote(g, ac.id);
  if (q.ok && q.net > 0 && returnEarly(g, ac.id, q.end).ok) {
    t.earlyReturnDay = dayN(g);
    t.leaseChoices.push(`${ac.reg} early ${fmtDateTime(q.end).slice(0, 6)}`);
    act(g, t);
  }
}

/**
 * v0.7.2 cash below zero for a week: sell the least-used owned aircraft (under 2 BH a day over a tracked week or more,
 * no signed work in the way), at most one a year.
 */
function sales(g: GameState, t: Tally): void {
  const neg = g.finance.negSince;
  if (neg === null || neg === undefined || g.now - neg < 7 * DAY) return;
  if ((g.stats.sales ?? 0) + Object.values(g.fleet).filter((a) => a.sale).length > Math.floor(dayN(g) / 365)) return;
  for (const row of leastUsed(g, 'owned')) {
    if (!row.enough || row.perDay >= 2) continue;
    const q = saleQuote(g, row.aircraftId);
    if (q.ok && sellAircraft(g, row.aircraftId, q.price).ok) {
      t.leaseChoices.push(`${g.fleet[row.aircraftId].reg} sold ${fmtDateTime(q.closes).slice(0, 6)}`);
      act(g, t);
      return;
    }
  }
}

/** A widebody's own monthly fixed costs: rent, insurance, overhead share, the crew sets hire() keeps (5 + 2) with on-costs. */
function wideMonth(rent: number, typeId: string, seats: number): number {
  const sets = complement(typeId, seats).reduce((s, r) => s + (BAL.salary[r]?.[1] ?? 3_000), 0) * (BAL.crewSetsPerAircraft + 2) * (1 + BAL.onCosts);
  return rent + typeOf(typeId).insuranceMonth + BAL.overheadPerAircraft + sets;
}

/**
 * Signed when the deposit, three months of the widebody's fixed costs (its 7 crew sets included) and $500K are in the bank, only
 * while the last three months were profitable and a widebody base of 75+ days worth $2.5M+ starts far enough out for delivery
 * and crew hiring (but within 75 days of delivery, so the new aircraft isn't parked for months); that job is then taken as
 * soon as the aircraft can fly it.
 */
function fleet(g: GameState, t: Tally): void {
  if (Object.values(g.fleet).some((a) => typeOf(a.typeId).body === 'wide')) return;
  // v0.8 fix pack (--b744): a 747-400 on the market once Widebody operations is held or filed.
  if (B744 && held(g, 'widebody') && !g.market.aircraft.some((o) => o.typeId === 'b744' && o.kind === 'dryLeaseIn' && o.expires > g.now)) devMarketOffer(g, 'b744', { kind: 'dryLeaseIn' });
  const recent = g.finance.history.slice(-3);
  // v0.7: the Ladder's approval fees are an investment, not a sign of a losing quarter.
  const qProfit = recent.reduce((s, st) => s + statementTotals(st.lines).profit - (st.lines.approvals ?? 0), 0);
  const earning = recent.length === 3 && qProfit > 0;
  // v0.7: the cheapest lease first (an A330-300 at $420K/month parked for months sinks the year).
  for (const o of [...g.market.aircraft].sort((a, b) => a.rentPerMonth - b.rentPerMonth || (a.id < b.id ? -1 : 1))) {
    // v0.7: only what the Ladder lets us sign (pending counts), never a new-build slot.
    if (typeOf(o.typeId).body !== 'wide' || o.kind !== 'dryLeaseIn' || o.newBuild || o.expires <= g.now || !aircraftGate(g, o.typeId).ok) continue;
    if (B744 && o.typeId !== 'b744') continue;
    // The family our widebody pilots fly (another only 60 days after filing with nothing of ours on offer).
    const filed = g.company.pendingApprovals.find((p) => p.id === 'widebody')?.started ?? g.company.approvalsAt?.widebody ?? g.now;
    // v0.8 as the comment says: only while one of our family is on offer (the post-filing A330 lapsed unseen).
    const ours = g.market.aircraft.some((x) => x.kind === 'dryLeaseIn' && x.expires > g.now && typeOf(x.typeId).family === wideFamily(g));
    if (typeOf(o.typeId).family !== wideFamily(g) && g.now - filed < 60 * DAY && ours) continue;
    // Acquirable (the target): deposit plus three months of rent and insurance, with $1M left to run the airline.
    if (g.company.cash >= o.deposit + 3 * (o.rentPerMonth + typeOf(o.typeId).insuranceMonth) + 1_000_000) t.wideAffordableAt ??= g.now;
    // v0.8 two months of its fixed costs after the deposit (v0.7.3: three) and $300K (was $500K) to run the airline.
    // v0.8 pre-release: --wide too (its $1M left after the deposit signed a 747 on day 13 of a Startup: insolvent).
    if (g.company.cash < o.deposit + 2 * wideMonth(o.rentPerMonth, o.typeId, o.cabin.total) + 300_000) continue;
    t.wideReadyAt ??= g.now;
    // v0.7: home after the delivery ferry; a widebody job worth $1M+ starting 1–4 months after that (or, from day 150
    // on the ladder, the widebody itself: wide work follows a widebody fleet).
    // v0.8 pre-release: with no pilots rated on the family yet, a 6-week conversion (or a 45-day rated hire) comes first,
    // so the job it is signed for starts after that (a 747's delivery ferry waited at Amsterdam for converting pilots).
    const rated = ratedPilots(g, [typeOf(o.typeId).family]);
    const crewLead = Math.max(o.leadDays + 7, rated.CPT >= 2 && rated.FO >= 2 ? 0 : 50);
    const lead = o.leadDays + 7;
    // On the ladder: signed so it is home about when Widebody operations is granted (it flies revenue only then).
    const due = g.company.approvals.includes('widebody') ? g.now : g.company.pendingApprovals.find((p) => p.id === 'widebody')?.done;
    const job = Object.values(g.offers).find(
      (x) => x.status === 'open' && x.estValue >= 1_000_000 && x.start > g.now + (crewLead + 14) * DAY && x.start < g.now + (lead + 120) * DAY && (x.requirements.body === 'wide' || x.requirements.minSeats > 220) &&
        o.cabin.total >= x.requirements.minSeats && (!x.requirements.families?.length || x.requirements.families.includes(typeOf(o.typeId).family)) &&
        // v0.7: work the widebody can fly (after the grant).
        (due === undefined || x.start >= due + 7 * DAY),
    );
    // v0.7.2 not before the grant is near: home at most about two weeks before it (rent and crew run from the handover).
    if (!WIDE && due !== undefined && due - g.now > (lead + 14) * DAY) continue;
    const timed = due !== undefined;
    // Without a job to fly, only a lease the airline can carry while it waits for work ($300K/month at most; v0.7.3 the
    // last quarter earned three months of its fixed costs: seed 6 signed an A340 off a thin autumn and lost $1.2M).
    // v0.8 1.75× (2× signed none of seeds 1–6: a $110K A330-200 against an $868K quarter; 1.5× five of six).
    const carry = timed && o.rentPerMonth <= 300_000 && qProfit >= 1.75 * wideMonth(o.rentPerMonth, o.typeId, o.cabin.total);
    // v0.8 pre-release: --wide no longer signs with nothing to fly (seed 1 --wide --aug leased an A330-300 at Madrid on
    // day 76 with no work): a widebody job in hand, or a last quarter that carries the lease while it waits; and not
    // before a first quarter is in (the Startup's cash: --b744 signed a 747 on day 13 for a June job, went insolvent).
    if (WIDE ? recent.length < 3 || !(job || carry) : !earning || !(job || carry)) continue;
    if (acquireAircraft(g, o.id).ok) {
      t.wideSigned = g.now;
      t.signed.push(`${typeOf(o.typeId).short} day ${Math.floor((g.now - g.started) / DAY)} at ${o.site}${job ? '' : ' (no job yet)'}`);
      act(g, t);
      conversions(g, t);
      hire(g, t);
    }
    return;
  }
}

// ---------- v0.7 ----------

const dayN = (g: GameState) => Math.floor((g.now - g.started) / DAY);
const held = (g: GameState, id: ApprovalId) => g.company.approvals.includes(id) || g.company.pendingApprovals.some((p) => p.id === id);
const monthFixed = (g: GameState) => {
  const f = fixedCosts(g, monthKey(g.now));
  return f.rent + f.insurance + f.overhead;
};

function file(g: GameState, t: Tally, id: ApprovalId): void {
  if (applyApproval(g, id).ok) {
    t.filed.push(`${id} day ${dayN(g)}`);
    act(g, t);
  }
}

/**
 * The Ladder: ETOPS 120 from month 4 once over-water work is on offer; Widebody operations from day 120 off a $1.2M+ quarter (4 + 4 widebody pilots hired first when the
 * narrowbody fleet has none to spare); augmented crews once a widebody flies and a 13 h+ widebody job was seen;
 * ETOPS 180 / 240 when ready with $2M spare. Never ULR in a year.
 */
function ladderSteps(g: GameState, t: Tally): void {
  const cash = g.company.cash;
  const cost = (id: ApprovalId) => APPROVALS.find((a) => a.id === id)!.cost;
  // ETOPS 120 once the work asks for it: two open over-water jobs worth $300K+ on the board at once.
  const overWater = Object.values(g.offers).filter((o) => o.status === 'open' && o.estValue >= 300_000 && (o.requirements.etops > 0 || o.requirements.approvals.includes('etops120'))).length;
  if (dayN(g) >= 90 && overWater >= 2 && !held(g, 'etops120') && !approvalBlocker(g, 'etops120') && cash >= cost('etops120') + 2_500_000) file(g, t, 'etops120');
  // Widebody operations once an old 767 / A330 lease is on the market (the family to crew for is known then).
  const wideLease = g.market.aircraft.some((o) => o.kind === 'dryLeaseIn' && o.expires > g.now + 3 * DAY && (o.typeId === 'a332' || o.typeId === 'b763'));
  // Off a good half-year (approval fees aside): the filing half of the fee ($300K; the rest at the grant) plus $1M and a
  // month of fixed costs in hand (the lessor's post-filing widebody wants one month's deposit, handed over near the grant).
  const q = g.finance.history.slice(-6).reduce((s, st) => s + statementTotals(st.lines).profit - (st.lines.approvals ?? 0), 0);
  // v0.8 (§8 widebody on 2–4 seeds): from day 150 without a lease on show (the market posts one after filing), off $450K.
  if (dayN(g) >= 120 && (wideLease || dayN(g) >= 150) && q >= 450_000 && !held(g, 'widebody') && cash >= cost('widebody') + 1_000_000 + monthFixed(g)) {
    // Pilots are hired only when they are all that's missing (never for an application the record still blocks).
    const otherwise = approvalReqs(g, 'widebody').every((r) => r.ok || / CPT \+ /.test(r.label));
    const fam = wideFamily(g);
    const r = ratedPilots(g, [fam], { booked: true });
    for (const role of ['CPT', 'FO'] as const) {
      const short = 4 - r[role];
      if (otherwise && short > 0 && hireSplit(g, { role, family: fam, base: g.company.homeBase, count: short }).ok) act(g, t);
    }
    if (!approvalBlocker(g, 'widebody')) file(g, t, 'widebody');
  }
  const wideTypes = [...new Set(Object.values(g.fleet).filter((a) => typeOf(a.typeId).body === 'wide' && a.status !== 'delivering').map((a) => a.typeId))];
  const wideHeld = wideTypes.length > 0;
  // v0.7.3 an open job a held widebody type would fly with 3 or 4 pilots (the roster's own reading of each chain, C7).
  const longJob = wideHeld && !held(g, 'augmented') && Object.values(g.offers).some((o) => o.status === 'open' && o.expires > g.now && o.estValue >= 300_000
    && wideTypes.some((tid) => {
      const prog = programmeOf(o, tid);
      return prog.ok && chainAugment(g, tid, prog.chains).aug > 0;
    }));
  if (wideHeld && longJob && !held(g, 'augmented') && !approvalBlocker(g, 'augmented') && cash >= cost('augmented') + 2_000_000) file(g, t, 'augmented');
  for (const id of ['etops180', 'etops240'] as ApprovalId[]) if (!held(g, id) && !approvalBlocker(g, id) && cash >= cost(id) + 2_000_000) file(g, t, id);
  // v0.8 Antarctica: blue-ice runway operations once a widebody and ETOPS 180 are held and an Antarctic job is on offer.
  const ice = Object.values(g.offers).some((o) => o.archetype === 'antarctic' && o.status === 'open');
  if (ice && wideHeld && g.company.approvals.includes('etops180') && !held(g, 'polar') && !approvalBlocker(g, 'polar') && cash >= cost('polar') + 2_000_000) file(g, t, 'polar');
}

/**
 * The widebody family we build crew for: the one with the most widebody pilots (rated or converting), else the
 * family of the cheaper open A330 / 767 lease (teasers included), else the 767.
 */
function wideFamily(g: GameState): RatingFamily {
  if (B744) return 'B747';
  const fams: RatingFamily[] = ['A330/340', 'B757/767'];
  const have = fams.map((f) => ({ f, n: ratedPilots(g, [f], { booked: true }) })).filter((x) => x.n.CPT + x.n.FO > 0).sort((a, b) => b.n.CPT + b.n.FO - (a.n.CPT + a.n.FO));
  if (have.length) return have[0].f;
  const wide = g.market.aircraft.filter((o) => o.kind === 'dryLeaseIn' && (o.typeId === 'a332' || o.typeId === 'b763')).sort((a, b) => a.rentPerMonth - b.rentPerMonth)[0];
  return wide ? typeOf(wide.typeId).family : 'B757/767';
}

/** Past 60 days: block hours per narrowbody against 10 BH a day. */
export function narrowUse60(g: GameState): number {
  const nb = Object.values(g.fleet).filter((a) => typeOf(a.typeId).body === 'narrow' && a.status !== 'delivering' && a.deliveredAt < g.now - 60 * DAY);
  if (!nb.length) return 0;
  const ids = new Set(nb.map((a) => a.id));
  let bh = 0;
  for (const f of Object.values(g.flights)) if (f.aircraftId && ids.has(f.aircraftId) && f.status === 'done' && (f.ata ?? f.sta) > g.now - 60 * DAY) bh += ((f.ata ?? f.sta) - (f.atd ?? f.std)) / 60;
  return bh / (nb.length * 60 * 10);
}

/** Next `days`: the share of narrowbody aircraft-time already committed (flights, checks, signed base work). */
function committed(g: GameState, days: number): number {
  const nb = Object.values(g.fleet).filter((a) => typeOf(a.typeId).body === 'narrow' && a.status !== 'delivering' && !a.returning);
  if (!nb.length) return 0;
  let idle = 0;
  for (const ac of nb) for (const gp of groundGaps(g, ac, g.now, g.now + days * DAY)) if (gp.to - gp.from >= DAY) idle += gp.to - gp.from;
  return 1 - idle / (nb.length * days * DAY);
}

/**
 * A third A320-family aircraft when the narrowbodies are well committed over the next 60 days; never new-build; one
 * at a time. Like a real ACMI operator it is timed for a season: never handed over in the summer (June–September) with
 * nothing booked, unless a 60-day+ base or tour series on offer starts within 21 days of its arrival; signed by day
 * 200 for the autumn, or in the winter for next summer (home between 1 February and 1 June).
 */
function narrowGrowth(g: GameState, t: Tally): void {
  // From day 75 (the first two prove the business).
  if (dayN(g) < 75 || Object.values(g.fleet).some((a) => a.status === 'delivering')) return;
  if (Object.values(g.fleet).filter((a) => typeOf(a.typeId).body === 'narrow').length >= 3) return;
  const o = g.market.aircraft.find((x) => x.kind === 'dryLeaseIn' && !x.newBuild && x.expires > g.now && typeOf(x.typeId).family === 'A320' && aircraftGate(g, x.typeId).ok);
  // 75% committed over the next 60 days; from day 150, 60% (the winter programme is being sold by then).
  if (!o || g.company.cash < o.deposit + 1_000_000 || committed(g, 60) < (dayN(g) >= 150 ? 0.6 : 0.75)) return;
  const homeBy = deliveryQuote(g, o.typeId, o.site ?? g.company.homeBase, g.now + o.leadDays * DAY).homeBy;
  const y = toDate(g.now).getUTCFullYear();
  const june = (yr: number) => fromUTC(yr, 6, 1);
  const nextSummer = homeBy >= fromUTC(y + 1, 2, 1) && homeBy <= june(y + 1);
  if (dayN(g) > 200 && !nextSummer) return;
  // The summer season is June–September (handed over in September it already counts as a summer aircraft).
  const summer = homeBy <= june(y) || g.now + o.leadDays * DAY >= fromUTC(y, 10, 1);
  const series = Object.values(g.offers).some((x) => x.status === 'open' && x.end - x.start >= 60 * DAY && x.start >= homeBy && x.start <= homeBy + 21 * DAY && (x.pattern.kind === 'base' || x.archetype === 'tourSeries') && !isWideJob(x.requirements));
  if (!summer && !series) return;
  if (acquireAircraft(g, o.id).ok) {
    t.narrowSigned++;
    t.signed.push(`${typeOf(o.typeId).short} day ${dayN(g)} at ${o.site}`);
    act(g, t);
  }
}

/** A delivery waiting at its site for rated pilots: two rated pilots hired (once: not while some are joining). */
function deliveryWaits(g: GameState, t: Tally): void {
  for (const ac of Object.values(g.fleet)) {
    if (deliveryStatus(g, ac.id)?.phase !== 'waiting') continue;
    const fam = typeOf(ac.typeId).family;
    if (Object.values(g.crew).some((c) => c.status === 'joining' && c.ratings.includes(fam) && (c.role === 'CPT' || c.role === 'FO'))) continue;
    for (const role of ['CPT', 'FO'] as const) if (hireCrew(g, { role, family: fam, base: g.company.homeBase, count: 1 }).ok) act(g, t);
    t.waitHires++;
  }
}

/** At most one refit per 180 days: a premium job worth $1.2M+ failing only on the cabin, the refit ending in time at < 40% of it. */
function refits(g: GameState, t: Tally): void {
  if (Object.values(g.maintenance).some((m) => m.kind === 'refit' && m.booked !== undefined && m.booked > g.now - 180 * DAY && m.status !== 'cancelled')) return;
  if ((g.stats.refits ?? 0) > 0 && Object.values(g.maintenance).every((m) => m.kind !== 'refit')) return;
  for (const o of Object.values(g.offers)) {
    if (o.status !== 'open' || o.estValue < 1_200_000 || o.start < g.now + 14 * DAY || (!o.requirements.layouts && !o.requirements.minPremium)) continue;
    if (o.created < g.now - DAY && (dayIndex(g.now) + hash(o.id)) % 3 !== 0) continue;
    for (const id of seatsFit(g, o)) {
      const ac = g.fleet[id];
      // Only a cabin that fails the job is worth a refit (else the layout check passes).
      if (cabinFits(cabinAt(g, ac, o.start).cabin, o.requirements)) continue;
      const rep = feasibility(g, o.id, ac.id, { quick: true });
      const no = rep.checks.filter((c) => c.level === 'no');
      if (no.length !== 1 || no[0].id !== 'layout') continue;
      const tip = refitTip(g, ac, o.requirements);
      const st = refitStations(g, ac.id)[0];
      if (!tip || !st) continue;
      // v0.7.3 with augmented crews held, a widebody keeps 4+ business seats (its crew rest) unless it has bunks.
      if (g.company.approvals.includes('augmented') && typeOf(ac.typeId).body === 'wide' && restOf(g, ac.id).fc?.cls !== 1 && (cabinOptions(ac.typeId).find((c) => c.label === tip.label)?.j ?? 0) < 4) continue;
      for (let d = 7; d < 60; d++) {
        const start = Math.ceil((g.now + d * DAY) / DAY) * DAY + 8 * 60;
        const q = refitQuote(g, ac.id, tip.label, st.code, start);
        if (!q.ok) continue;
        if (q.end + 2 * DAY > o.start || q.cost >= 0.4 * o.estValue) break;
        const booked = bookRefit(g, ac.id, tip.label, st.code, start);
        if (booked.ok) {
          // The job on the refitted aircraft itself (bestFit could pick another one, leaving the refit for nothing).
          const mine = feasibility(g, o.id, ac.id, { paint: paintOn(o) });
          // No job after all (another check fails with the new cabin): the refit is called off.
          if ((mine.level !== 'ok' && mine.level !== 'warn') || mine.estMargin <= 0 || !acceptOffer(g, o.id, [ac.id], { paint: paintOn(o) }).ok) {
            cancelCheck(g, booked.data!.maintId);
            return;
          }
          t.refits.push(`${ac.reg} → ${tip.label} day ${dayN(g)}`);
          act(g, t);
          {
            t.accepted++;
            act(g, t);
            // Back to the everyday cabin right after the job (the narrowbody work wants its seats).
            const was = typeOf(ac.typeId).cabins[0];
            const lastArr = Math.max(...Object.values(g.flights).filter((f) => f.contractId && g.contracts[f.contractId]?.offerId === o.id).map((f) => f.sta));
            if (was.label !== tip.label && Number.isFinite(lastArr)) {
              for (let k = 1; k < 20; k++) {
                const back = Math.ceil((lastArr + k * DAY) / DAY) * DAY + 8 * 60;
                if (bookRefit(g, ac.id, was.label, refitStations(g, ac.id)[0]?.code ?? st.code, back).ok) {
                  t.refits.push(`${ac.reg} → ${was.label} day ${dayN(g)}`);
                  break;
                }
              }
            }
          }
          return;
        }
      }
    }
  }
}

/** One policy pass after each clock step; the daily jobs run once per game day. */
/**
 * v0.7.1 Crew Control: for each short flight inside 36 h, the fixes in the §16 order until the flight is crewed
 * (availability read without previews; only the swap guard needs one). A pure function of the state.
 */
/** When crewControlPolicy last weighed the expensive fixes per flight (game time). */


function crewControlPolicy(g: GameState, t: Tally): void {
  for (const x of shortFlights(g)) {
    if (x.hoursLeft > 36) continue;
    const f = g.flights[x.flightId];
    if (!f || f.status !== 'scheduled') continue;
    // v0.7.3 each stage reads only the fixes it weighs (the delay and jet searches try copies of the state).
    const view = (only: CrewFix[], previews = false) => crewControl(g, x.flightId, { previews, only });
    const v = view(['autoFix', 'deadhead', 'callIn']);
    if (!v || v.stage === 'ok') continue;
    const sol = (w: NonNullable<typeof v>, id: CrewFix) => w.solutions.find((s) => s.id === id && s.available);
    const unit = v.unit.flightIds.map((id) => g.flights[id]).filter((y) => y && y.status === 'scheduled');
    const lateCapMin = unit.some((y) => y.contractId && g.contracts[y.contractId]?.pattern.kind === 'base') ? BAL.holdMax : 6 * 60;
    const apply = (s: CrewSolution | undefined): boolean => {
      if (!s) return false;
      const r = applyCrewFix(g, x.flightId, s.id, { confirmed: true });
      if (!r.ok) return false;
      if (MSGS) console.error(`${fmtDateTime(g.now)} CREW CONTROL ${f.no} ${s.id}: ${r.data!.changes.join(' / ')}`);
      act(g, t);
      t.crewFixes.set(s.id, (t.crewFixes.get(s.id) ?? 0) + 1);
      return r.data!.after === null;
    };
    // v0.8 speed: the roster's own re-run (a full re-roster on the live game, usually finding nobody: seed 3 tried
    // 140 times) on the first look and in the last 12 h only; the policy stays a pure function of the game.
    const autoOk = x.hoursLeft > 30 || x.hoursLeft <= 12;
    if ((autoOk && apply(sol(v, 'autoFix'))) || apply(sol(v, 'deadhead')) || apply(sol(v, 'callIn'))) continue;
    if (g.flights[x.flightId]?.status !== 'scheduled') continue;
    const sw = view(['swap'], true);
    const full = sw && sol(sw, 'swap');
    if (full && (full.preview.after.level === 'ok' || full.preview.after.level === 'tight') && !full.preview.ripple.some((r) => r.tone === 'bad') && apply(full)) continue;
    // v0.8 speed: the delay and jet searches (copies of the state) only in the last 14 h (the roster's own fixes
    // often land before; 73 searches a year cost seed 5 five seconds).
    if (x.hoursLeft > 14) continue;
    // ... and never for an empty ferry: the schedule retimes it itself (seed 5 searched one MAD–LIS ferry 28 times).
    if (f.kind === 'ferry') continue;
    const rest = view(['jet', 'delay', 'discretion', 'subcharter', 'cancel']);
    if (!rest || rest.stage === 'ok') continue;
    // A jet when it gets a crew there at least 3 h sooner than waiting for a ticket, with passengers at stake.
    const jet = sol(rest, 'jet');
    const delay = sol(rest, 'delay');
    const jetDep = jet ? (jet.newDeparture ?? f.std) : Infinity;
    const waitDep = delay ? (delay.newDeparture ?? f.std) : Infinity;
    // v0.8 at most $60K a jet (a widebody crew flown to Asia cost seed 3 $100K a time).
    if (jet && jet.cost <= 60_000 && x.hoursLeft <= 18 && v.unit.pax >= 100 && jetDep + 180 <= waitDep && (g.stats.jets ?? 0) < 8 && apply(jet)) continue;
    if (apply(sol(rest, 'discretion'))) continue;
    // v0.8 the cap counts from the original time (seed 5 delayed one leg 11 times, half a day each).
    if (delay && (delay.newDeparture ?? f.std) - (f.schedStd ?? f.std) <= lateCapMin && apply(delay)) continue;
    const sub = sol(rest, 'subcharter');
    if (sub && sub.cost < (sol(rest, 'cancel')?.cost ?? Infinity)) apply(sub);
  }
}

/**
 * v0.9 (§13) department heads: the mid candidate once unlocked when cash is at least $1M (else the junior); rules at
 * their defaults; ferry-home proposals under $60K and C-check slot proposals accepted; nobody is ever fired.
 */
const headUnlocked = new Map<string, number>();
function heads(g: GameState, t: Tally): void {
  if (process.env.NOHEADS) return;
  for (const id of HEAD_IDS) {
    const h = g.heads?.[id];
    if (!h || h.unlockedAt === null) continue;
    if (!headUnlocked.has(id)) headUnlocked.set(id, Math.floor((h.unlockedAt - g.started) / DAY));
    if (process.env.SKIPHEAD?.split(',').includes(id)) continue;
    if (!h.hired && h.candidates?.length && hireHead(g, id, g.company.cash >= 1_000_000 ? 1 : 0).ok) act(g, t);
    for (const p of [...h.proposals]) {
      if ((p.kind === 'ferryHome' && p.cost < 60_000) || p.kind === 'cSlot') {
        if (acceptProposal(g, id, p.id).ok) act(g, t);
      }
    }
  }
}

function policy(g: GameState, t: Tally, urgent: boolean, newDay: boolean): void {
  decide(g, t);
  crewControlPolicy(g, t);
  if (newDay) {
    heads(g, t);
    policies(g, t);
    rehire(g, t);
    extraCrew(g, t);
    conversions(g, t);
    hire(g, t);
    checks(g, t);
    // v0.7.3 the rest cards (widebodies held with augmented crews only: the cards read every duty's rest plan).
    const cards = g.company.approvals.includes('augmented') && Object.values(g.fleet).some((a) => typeOf(a.typeId).body === 'wide') ? restCards(g) : [];
    restRefits(g, t, cards);
    restTooShort(g, t, cards);
    earlyReturns(g, t);
    sales(g, t);
    ladderSteps(g, t);
    fleet(g, t);
    narrowGrowth(g, t);
    deliveryWaits(g, t);
    refits(g, t);
    dryLeases(g, t);
  }
  if (newDay || urgent) offers(g, t);
}

/** Advances to `end` on a fixed 6-hour grid from the start (a save at a grid point plays on identically). */
function play(g: GameState, t: Tally, end: number, onStep?: () => void): void {
  let day = dayIndex(g.now);
  while (g.now < end && !g.gameOver) {
    const grid = g.started + (Math.floor((g.now - g.started) / STEP) + 1) * STEP;
    const r = advanceTo(g, Math.min(end, grid));
    const newDay = dayIndex(g.now) !== day;
    day = dayIndex(g.now);
    policy(g, t, r.pause === 'urgentOffer', newDay);
    // Like the UI's store.act: runtime-only change marks are applied now, so a save here plays on identically.
    settle(g);
    onStep?.();
  }
}

// ---------- checks ----------

/** Paths of non-finite numbers anywhere in the state (NaN, ±Infinity). */
function badNumbers(o: unknown, path = 'g', out: string[] = []): string[] {
  if (out.length > 5) return out;
  if (typeof o === 'number') {
    if (!Number.isFinite(o)) out.push(`${path}=${o}`);
  } else if (Array.isArray(o)) o.forEach((v, i) => badNumbers(v, `${path}[${i}]`, out));
  else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) badNumbers(v, `${path}.${k}`, out);
  return out;
}

const stateJson = (g: GameState) => JSON.stringify((JSON.parse(serialize(g)) as { state: unknown }).state);

if (DET) {
  const wall = performance.now();
  const runTo = (d: number) => {
    const g = newGame();
    play(g, newTally(), g.started + d * DAY);
    return g;
  };
  const END = 365;
  const a = stateJson(runTo(END));
  const b = stateJson(runTo(END));
  const h = runTo(90);
  const g2 = deserialize(serialize(h));
  play(g2, newTally(), g2.started + END * DAY);
  const c = stateJson(g2);
  // Off the 6-hour grid, between policy steps (a player saving at any minute).
  const h2 = runTo(200);
  advanceTo(h2, h2.now + 137);
  settle(h2);
  const g3 = deserialize(serialize(h2));
  play(g3, newTally(), g3.started + END * DAY);
  const d3 = stateJson(g3);
  const diff = (x: string, y: string) => {
    let i = 0;
    while (i < x.length && x[i] === y[i]) i++;
    return x === y ? 'identical' : `differ at char ${i}: …${x.slice(Math.max(0, i - 120), i + 60)}… vs …${y.slice(Math.max(0, i - 120), i + 60)}…`;
  };
  console.log(`BLOCK HOURS determinism, seed ${seed} (${((performance.now() - wall) / 1000).toFixed(1)} s)`);
  console.log(`  two runs to day ${END}:            ${diff(a, b)} (${(a.length / 1024).toFixed(0)} KB JSON)`);
  console.log(`  save/load at day 90 → day ${END}:   ${diff(a, c)}`);
  console.log(`  save/load at day 200 + 2h17 → ${END}: ${diff(a, d3)}`);
  process.exit(a === b && a === c && a === d3 ? 0 : 1);
}

// ---------- the year ----------

interface Month {
  legs: number;
  cancelled: number;
  sub: number;
  crewBH: number;
  msgs: number;
  aogs: number;
  illegal: number;
}
const months = new Map<MonthKey, Month>();
const mon = (k: MonthKey): Month => {
  let m = months.get(k);
  if (!m) months.set(k, (m = { legs: 0, cancelled: 0, sub: 0, crewBH: 0, msgs: 0, aogs: 0, illegal: 0 }));
  return m;
};

const wall = performance.now();
const g = newGame();
const tally = newTally();
const end = g.started + days * DAY;
const seenFlight = new Set<string>();
const seenOffer = new Set<string>();
const slipSeen = new Set<string>();
const cancels = new Map<string, number>();
const errors: string[] = [];
let msgCount = 0;
let lastMsgId = g.messages[0]?.id;
let prev = { aogs: 0, illegal: 0 };
/**
 * Duties flown illegally: over their FDP limit, or (checked at each duty's first off-blocks, per crew member with
 * the roster's planCrew) with anyone over a crew limit: rest, recovery, cumulative hours, location, status.
 */
const illegalOf = (s: GameState['stats']) => (s.illegalFlown ?? 0) + (s.illegalCrewFlown ?? 0);
let acYears = 0;
let peakSave = '';
let lastDay = dayIndex(g.now);

/** v0.6: duties flown, those with crew above the legal minimum; daily headcount (resignation rate). */
const seenDuty = new Set<string>();
let dutiesFlown = 0;
let dutiesExtra = 0;
let negFrom: number | null = null;
let negMaxDays = 0;
let headDays = 0;
let headN = 0;
let moraleMin = 100;

/** Client paint reimbursements invoiced (receivables are pruned after a while, so counted as they appear). */
const seenRecv = new Set<string>();
let paintBack = 0;

/** v0.7: market offers seen (month, teaser), delivery legs and their crew tickets, abroad deliveries, longest wait. */
const seenMarket = new Map<string, { month: number; teaser: boolean; newBuild: boolean }>();
const dhDelivery = new Set<string>();
/** Tickets looked at once (a ticket's purpose is set when it is bought). */
const dhSeen = new Set<string>();
const ferryLegs = new Set<string>();
let ferryBH = 0;
const checkLegs = new Set<string>();
let illegalAtCheck = 0;
const reliable0 = g.company.reputation.reliable;
const abroad = new Set<string>();
let maxWait = 0;
let illegalAtFerry = 0;

/** Revenue legs held for crew at departure (the 'uncovered' stat), by body and contract archetype. */
const heldSeen = new Set<string>();
const heldBy = new Map<string, number>();
/** v0.7.3 augmented duties seen airborne, and those flown with a rest plan that is not possible (hard target 0). */
const augSeen = new Set<string>();
let restBad = 0;
/** v0.7.3 home standby crew-days held (windows seen). */
const sbySeen = new Set<string>();
/** v0.8 market phase by quarter, fuel range, first Trusted client day, mixed-crew contracts seen. */
const phases: string[] = [];
let fuelMin = Infinity;
let fuelMax = 0;
let trustedAt: number | null = null;
const mixedSeen = new Set<string>();

function onStep(): void {
  const m = mon(monthKey(g.now));
  for (const c of Object.values(g.crew)) for (const w of c.standby ?? []) if (w.from <= g.now) sbySeen.add(`${c.id}:${w.from}`);
  for (const f of Object.values(g.flights)) {
    if (!f.crewHeld || heldSeen.has(f.id) || (f.kind !== 'revenue' && f.kind !== 'techstop') || !f.aircraftId || !g.fleet[f.aircraftId]) continue;
    heldSeen.add(f.id);
    const k = `${typeOf(g.fleet[f.aircraftId].typeId).body === 'wide' ? 'WB' : 'NB'} ${(f.contractId && CODE[g.contracts[f.contractId]?.archetype]) || '?'} ${fmtMonth(monthKey(f.std))}`;
    heldBy.set(k, (heldBy.get(k) ?? 0) + 1);
    if (MSGS) console.error(`${fmtDateTime(g.now)} HELD ${f.no} ${f.from}–${f.to} std ${fmtDateTime(f.std)} ${g.fleet[f.aircraftId].reg} duty ${f.dutyId ?? '-'} day ${dayN(g)}`);
  }
  for (const f of Object.values(g.flights)) {
    if (f.status !== 'enroute' || !f.dutyId || augSeen.has(f.dutyId)) continue;
    const d = g.duties[f.dutyId];
    if (!d || d.augment === 0) continue;
    augSeen.add(d.id);
    if (!d.legacyRest && restPlan(g, d.id)?.ok === false) {
      restBad++;
      if (MSGS) console.error(`${fmtDateTime(g.now)} REST PLAN NOT POSSIBLE ${f.no} duty ${d.id}: ${restPlan(g, d.id)?.why}`);
    }
  }
  for (const r of g.finance.receivables) {
    if (seenRecv.has(r.id) || !/^(Paint|Repaint)/.test(r.desc)) continue;
    seenRecv.add(r.id);
    paintBack += r.amount;
  }
  for (const o of Object.values(g.offers)) {
    seenOffer.add(o.id);
    if (o.slip) slipSeen.add(o.id);
  }
  for (const o of g.market.aircraft) if (!seenMarket.has(o.id)) seenMarket.set(o.id, { month: monthKey(g.now), teaser: !aircraftGate(g, o.typeId).ok, newBuild: !!o.newBuild });
  // Inbox is newest first: count down to the last message seen.
  let n = 0;
  for (const x of g.messages) {
    if (x.id === lastMsgId) break;
    n++;
    // --msgs: inbox lines to stderr (debugging a run).
    if (MSGS) console.error(`${fmtDateTime(x.t)} [${x.cat}/${x.tone}] ${x.title} — ${x.body}`);
  }
  lastMsgId = g.messages[0]?.id;
  m.msgs += n;
  msgCount += n;
  const s = g.stats;
  m.aogs += (s.aogs ?? 0) - prev.aogs;
  const ill = illegalOf(s);
  m.illegal += ill - prev.illegal;
  prev = { aogs: s.aogs ?? 0, illegal: ill };
  if (dayIndex(g.now) === lastDay && g.now < end) return;
  lastDay = dayIndex(g.now);
  if (DUMP && dayN(g) === Number(DUMP[0])) writeFileSync(DUMP[1], serialize(g));
  // v0.7 deliveries: airline tickets of delivery crews, ferry legs flown, waits.
  for (const f of Object.values(g.flights)) {
    if (f.kind === 'deadhead' && f.status !== 'cancelled' && !dhSeen.has(f.id)) {
      dhSeen.add(f.id);
      if (ticketPurpose(g, f.id).kind === 'delivery') dhDelivery.add(f.id);
    }
    // v0.7.2 hub C-check ferries flown, and any illegal duty on them.
    if (f.purpose === 'check' && f.status === 'done' && !checkLegs.has(f.id)) {
      checkLegs.add(f.id);
      const d = f.dutyId ? g.duties[f.dutyId] : undefined;
      if (d?.legality === 'illegal') illegalAtCheck++;
    }
    if (f.purpose === 'delivery' && f.status === 'done' && !ferryLegs.has(f.id)) {
      ferryLegs.add(f.id);
      ferryBH += ((f.ata ?? f.sta) - (f.atd ?? f.std)) / 60;
      const d = f.dutyId ? g.duties[f.dutyId] : undefined;
      if (d?.legality === 'illegal') illegalAtFerry++;
    }
  }
  for (const ac of Object.values(g.fleet)) {
    const dl = ac.delivery;
    if (!dl) continue;
    if (dl.site !== g.company.homeBase) abroad.add(ac.id);
    if (dl.waitingSince !== undefined) maxWait = Math.max(maxWait, (g.now - dl.waitingSince) / DAY);
  }
  // Once a day: flights flown or cancelled (pruned only a week after their month is billed).
  for (const f of Object.values(g.flights)) {
    if (f.kind === 'deadhead' || seenFlight.has(f.id)) continue;
    if (f.status === 'done') {
      seenFlight.add(f.id);
      const fm = mon(monthKey(f.ata ?? f.sta));
      if (f.operatedBy) fm.sub++;
      else if (f.kind === 'revenue') fm.legs++;
      fm.crewBH += (f.crewIds.length * ((f.ata ?? f.sta) - (f.atd ?? f.std))) / 60;
    } else if (f.status === 'cancelled') {
      seenFlight.add(f.id);
      if (f.kind === 'revenue' || f.kind === 'techstop') mon(monthKey(f.std)).cancelled++;
      const key = `${f.delayReason ?? '?'} (${f.kind})`;
      cancels.set(key, (cancels.get(key) ?? 0) + 1);
    }
  }
  acYears += Object.values(g.fleet).filter((a) => a.status !== 'delivering').length / 365;
  // v0.8 market and relationships.
  fuelMin = Math.min(fuelMin, g.market.fuelPrice);
  fuelMax = Math.max(fuelMax, g.market.fuelPrice);
  const q = Math.floor(dayN(g) / 91.3);
  if (phases.length <= q) phases.push(g.market.cycle?.phase ?? 'steady');
  if (trustedAt === null && Object.values(g.clients).some((c) => c.level === 'trusted' || c.level === 'partner')) trustedAt = g.now;
  for (const c of Object.values(g.contracts)) if (c.requirements.clientCabin?.n) mixedSeen.add(c.id);
  for (const d of Object.values(g.duties)) {
    if (!d.done || seenDuty.has(d.id)) continue;
    seenDuty.add(d.id);
    dutiesFlown++;
    const dp = g.pairings[d.pairingId];
    if (dp && aboveMinimum(g, dp).cabin + aboveMinimum(g, dp).pilots > 0) dutiesExtra++;
  }
  // v0.7.2 the longest run of negative cash (the solvency target fails past the rescue window).
  if (g.company.cash < 0) {
    negFrom ??= g.now;
    negMaxDays = Math.max(negMaxDays, (g.now - negFrom) / DAY);
  } else negFrom = null;
  const staff = Object.values(g.crew).filter((c) => c.status !== 'joining');
  headDays += staff.length;
  headN++;
  if (staff.length) moraleMin = Math.min(moraleMin, staff.reduce((a, c) => a + c.morale, 0) / staff.length);
  if (toDate(g.now).getUTCDate() !== 1) return;
  // Save size: the biggest month-start save is kept and compressed after the run (outside the timing).
  const raw = serialize(g);
  if (raw.length > peakSave.length) peakSave = raw;
  const bad = badNumbers(g);
  if (bad.length) errors.push(`${fmtMonth(monthKey(g.now))}: non-finite ${bad.join(', ')}`);
}

try {
  play(g, tally, end, onStep);
} catch (e) {
  errors.push(`exception at ${new Date(g.now * 60_000).toISOString()}: ${(e as Error).stack ?? String(e)}`);
}
const runSecs = (performance.now() - wall) / 1000;

// ---------- report ----------

const monthStart = (k: MonthKey) => fromUTC(Math.floor(k / 12), (k % 12) + 1, 1);
const contractsIn = (k: MonthKey) => {
  const n = new Map<string, number>();
  for (const c of Object.values(g.contracts)) {
    if (c.status === 'cancelled' || c.start >= monthStart(k + 1) || c.end <= monthStart(k)) continue;
    const code = CODE[c.archetype] ?? c.archetype.slice(0, 2).toUpperCase();
    n.set(code, (n.get(code) ?? 0) + 1);
  }
  return [...n].sort().map(([c, v]) => `${c}${v}`).join(' ') || '-';
};
/** Wet-lease billable BH vs the month's guarantee (MGH × aircraft, pro-rated to the days on contract). */
const mghOf = (k: MonthKey) => {
  let flown = 0;
  let mgh = 0;
  const a = monthStart(k);
  const b = monthStart(k + 1);
  for (const c of Object.values(g.contracts)) {
    if (c.product.kind !== 'wet') continue;
    flown += (c.use[k]?.blockMin ?? 0) / 60;
    if (c.status !== 'cancelled') mgh += (c.product.mghPerMonth * c.aircraftIds.length * Math.max(0, Math.min(b, c.end) - Math.max(a, c.start))) / (b - a);
  }
  return `${flown.toFixed(0)}/${mgh.toFixed(0)}`;
};
const maintDays = (k: MonthKey) => {
  const a = monthStart(k);
  const b = Math.min(g.now, monthStart(k + 1));
  let d = 0;
  for (const m of Object.values(g.maintenance)) if (m.status === 'done' || m.status === 'inWork') d += Math.max(0, Math.min(b, m.end) - Math.max(a, m.start)) / DAY;
  return d;
};
const crewCap = (k: MonthKey) =>
  Object.values(g.crew)
    .filter((c) => c.hired < monthStart(k + 1))
    .reduce((s, c) => s + (c.role === 'CPT' || c.role === 'FO' || c.role === 'CRP' ? BAL.pilotBHMonth : BAL.cabinBHMonth), 0);
const goalsBy = (t: number) => g.goals.filter((x) => x.done !== null && x.done < t).length;

const pad = (s: string | number, n: number) => String(s).padStart(n);
const k$ = (v: number) => `${(v / 1000).toFixed(0)}k`;
console.log(`BLOCK HOURS bot — seed ${seed}, ${days} days, Startup at LIS (2× A320ceo)\n`);
console.log('month       cash  revenue   profit  BH/ac  wet BH/MGH  contracts        legs cx/sub ill util  AOG mxd  dec/msg goals');
let revenueY = 0;
let profitY = 0;
let bhSummer = 0;
let nSummer = 0;
const lines = new Map<LedgerCat, number>();
// Closed statements, then the month still open at the end (marked *, fixed costs not yet posted).
for (const st of [...g.finance.history, g.finance.current]) {
  const open = st === g.finance.current;
  if (open && !st.bh && !Object.keys(st.lines).length) continue;
  const { revenue, profit } = statementTotals(st.lines);
  if (!open) {
    revenueY += revenue;
    profitY += profit;
    for (const [c, v] of Object.entries(st.lines)) lines.set(c as LedgerCat, (lines.get(c as LedgerCat) ?? 0) + (v ?? 0));
  }
  const m = mon(st.month);
  const fleetN = Object.values(g.fleet).filter((a) => a.deliveredAt < monthStart(st.month + 1)).length || 2;
  const bhAc = st.bh / fleetN;
  if (!open && [5, 6, 7, 8].includes(st.month % 12)) {
    bhSummer += bhAc;
    nSummer++;
  }
  console.log(
    `${(fmtMonth(st.month) + (open ? '*' : '')).padEnd(8)}${pad(k$(open ? g.company.cash : st.cashEnd), 8)}${pad(k$(revenue), 9)}${pad(k$(profit), 9)}${pad(bhAc.toFixed(0), 7)}${pad(mghOf(st.month), 12)}  ${contractsIn(st.month).padEnd(15)}` +
      `${pad(m.legs, 6)}${pad(`${m.cancelled}/${m.sub}`, 7)}${pad(m.illegal, 4)}${pad(`${Math.round((100 * m.crewBH) / Math.max(1, crewCap(st.month)))}%`, 5)}${pad(m.aogs, 5)}${pad(maintDays(st.month).toFixed(0), 4)}${pad(`${tally.decMonth.get(st.month) ?? 0}/${m.msgs}`, 9)}${pad(goalsBy(monthStart(st.month + 1)), 6)}`,
  );
}

const finalRaw = serialize(g);
if (finalRaw.length > peakSave.length) peakSave = finalRaw;
const t0 = performance.now();
const saveKB = (LZString.compressToUTF16(peakSave).length * 2) / 1024;
const saveMs = performance.now() - t0;
// 10 aircraft: --big plays a real 10-aircraft game (BIG_DAYS, default 120) for the peak save; otherwise idle clones.
let bigKB = 0;
let bigMs = 0;
let bigNote = 'idle clones';
if (BIG) {
  const b = newGame();
  devFleet(b, 10);
  b.company.cash += 20_000_000;
  let peak = '';
  play(b, newTally(), b.started + BIG_DAYS * DAY, () => {
    if (toDate(b.now).getUTCDate() === 1 && b.now % DAY < STEP) {
      const raw = serialize(b);
      if (raw.length > peak.length) peak = raw;
    }
  });
  const t1 = performance.now();
  bigKB = (LZString.compressToUTF16(peak).length * 2) / 1024;
  bigMs = performance.now() - t1;
  bigNote = `real game, ${Object.keys(b.fleet).length} aircraft, ${Object.keys(b.crew).length} crew, ${BIG_DAYS} days, compress ${bigMs.toFixed(0)} ms`;
} else {
  const big = deserialize(finalRaw);
  devFleet(big, 10);
  bigKB = (LZString.compressToUTF16(serialize(big)).length * 2) / 1024;
}
errors.push(...badNumbers(g).map((p) => `final: non-finite ${p}`));
// v0.8 pre-release: an engine safety net that tripped (a re-planning loop broken) is a bug like an exception.
errors.push(...safetyTrips.map((x) => `safety net tripped: ${x}`));

const s = g.stats;
const weeks = Math.max(1, Math.floor(days / 7));
let activeWeeks = 0;
let maxDec = 0;
const idle: number[] = [];
for (let w = 0; w < weeks; w++) {
  if ((tally.actions.get(w) ?? 0) > 0) activeWeeks++;
  else idle.push(w + 1);
  maxDec = Math.max(maxDec, tally.decisions.get(w) ?? 0);
}
const totalActions = [...tally.actions.values()].reduce((a, b) => a + b, 0);
const summerBH = nSummer ? bhSummer / nSummer : 0;
const margin = revenueY ? profitY / revenueY : -1;
/** v0.7: the Ladder's approval fees are an investment (like the bot's own fleet rule): the margin gate leaves them out. */
const ladderFees = -[...lines].filter(([c]) => c === 'approvals').reduce((a, [, v]) => a + v, 0);
const marginEx = revenueY ? (profitY + ladderFees) / revenueY : -1;
const aogRate = (s.aogs ?? 0) / Math.max(0.1, acYears);
const uncShare = (s.uncovered ?? 0) / Math.max(1, s.departures ?? 0);
const gov = g.finance.receivables.filter((r) => g.clients[r.clientId]?.kind === 'government' && (r.paid !== null || r.due < g.now));
const govLate = gov.filter((r) => (r.paid ?? g.now) > r.due + BAL.graceDays * DAY).length;
const minCash = Math.min(g.company.cash, ...g.finance.history.map((h) => h.cashEnd));
const dayOf = (t: number | null) => (t === null ? 'never' : `day ${Math.floor((t - g.started) / DAY)}`);

const staffNow = Object.values(g.crew).filter((c) => c.status !== 'joining');
const moraleEnd = staffNow.length ? staffNow.reduce((a, c) => a + c.morale, 0) / staffNow.length : 0;
const weeksM = g.stats.moraleWeeks ?? [];
const moraleTrend = weeksM.length >= 5 ? moraleEnd - weeksM[weeksM.length - 5] : 0;
const avgHead = headN ? headDays / headN : 1;
const resignRate = ((g.stats.resigned ?? 0) + staffNow.filter((c) => c.notice).length) / Math.max(1, avgHead) * (365 / days);
/** v0.7 targets pooled over seeds (printed per seed, not failing the run). */
const softTargets: [string, boolean, string][] = [];
const targets: [string, boolean, string][] = [
  ['no exceptions, no NaN/Infinity', errors.length === 0, errors.length ? errors[0].split('\n')[0] : 'clean'],
  // v0.7.2 below zero past the rescue window fails (the rescue offer would come); a month-end below 0 warns (soft).
  ['solvent all year (no game over, cash < 0 ≤ rescue days)', !g.gameOver && negMaxDays <= BAL.rescueDays, g.gameOver ? g.gameOver.reason : `month-end low ${k$(minCash)}, end ${k$(g.company.cash)}, longest below 0 ${Math.round(negMaxDays)} days`],
  ['summer BH per aircraft 180–320', summerBH >= 180 && summerBH <= 320, summerBH.toFixed(0)],
  ['year net margin −5%…+12% (ex Ladder fees)', marginEx >= -0.05 && marginEx <= 0.12, `${(marginEx * 100).toFixed(1)}% ex ${k$(ladderFees)} approvals; ${(margin * 100).toFixed(1)}% all in (${k$(profitY)} on ${k$(revenueY)})`],
  ['no illegal duties flown (FDP + crew)', illegalOf(s) === 0, `${illegalOf(s)} (FDP ${s.illegalFlown ?? 0}, crew ${s.illegalCrewFlown ?? 0})`],
  ['0 duties flown with an impossible rest plan (v0.7.3)', restBad === 0, `${restBad} of ${augSeen.size} augmented duties`],
  // v0.5.2 gate: was < 2%; the roster now covers tour gaps, rest slips and stretched duties.
  ['≤ 0.3% flights uncovered at departure', uncShare <= 0.003, `${(uncShare * 100).toFixed(2)}% of ${s.departures ?? 0}`],
  ['≥ 1 meaningful action per week', totalActions / weeks >= 1 && activeWeeks / weeks >= 0.8, `${(totalActions / weeks).toFixed(1)}/wk, ${activeWeeks}/${weeks} weeks${idle.length ? ` (idle: ${idle.join(' ')})` : ''}`],
  ['≤ 3 decisions per week', maxDec <= 3, `max ${maxDec}, ${[...tally.decisions.values()].reduce((a, b) => a + b, 0)} answered`],
  ['≥ 30 offers per year', seenOffer.size * (365 / days) >= 30, String(seenOffer.size)],
  ['first contract within 7 days', tally.firstAccept !== null && tally.firstAccept - g.started <= 7 * DAY, dayOf(tally.firstAccept)],
  // v0.7: replaced by the ladder target (widebody ops filed by day 200, a widebody signed in the year; soft, below).
  ['1–3 AOGs per aircraft-year', aogRate >= 0.995 && aogRate <= 3.005, `${aogRate.toFixed(2)} (${s.aogs ?? 0} in ${acYears.toFixed(1)} ac-yr)`],
  // v0.6: pooled over seeds 1–6 (≥ 60% late); per seed it is printed (a seed sees only a handful of invoices).
  ['governments pay late (info; pool seeds 1–6)', true, `${govLate}/${gov.length} invoices late`],
  ['save < 300 KB (and with 10 aircraft)', saveKB < 300 && bigKB < 300, `peak ${saveKB.toFixed(0)} KB (compress ${saveMs.toFixed(0)} ms), with 10 aircraft ${bigKB.toFixed(0)} KB (${bigNote})`],
  // v0.7: 12 s (the v0.7 market, deliveries and ladder add work; machines under load vary).
  ['runs in < 12 s', runSecs < 12, `${runSecs.toFixed(1)} s`],
  // v0.6
  ['company morale 55–75 at the end', moraleEnd >= 55 && moraleEnd <= 75, `${moraleEnd.toFixed(1)} (lowest ${moraleMin.toFixed(1)}, last month ${moraleTrend >= 0 ? '+' : ''}${moraleTrend.toFixed(1)})`],
  ['resignations 4–20% of headcount a year', resignRate >= 0.04 && resignRate <= 0.2, `${(resignRate * 100).toFixed(1)}% (${g.stats.resigned ?? 0} left, ${staffNow.filter((c) => c.notice).length} on notice, avg headcount ${avgHead.toFixed(0)})`],
];
console.log(`\nP&L of the closed months: ${[...lines].sort((a, b) => b[1] - a[1]).map(([c, v]) => `${c} ${k$(v)}`).join(', ')}`);
console.log(
  `legs ${s.legs}, on time ${((100 * s.onTime) / Math.max(1, s.legs)).toFixed(1)}%, cancelled ${s.cancelled}, contracts ${tally.accepted} signed (${tally.countered} countered), ` +
    `done ${s.contractsDone}, decisions ${s.decisions ?? 0}, sub-chartered ${s.subchartered ?? 0}, reliable ${g.company.reputation.reliable.toFixed(1)}, ` +
    `fleet ${Object.values(g.fleet).map((a) => typeOf(a.typeId).short).join('+')}, crew ${Object.keys(g.crew).length}, messages ${msgCount}`,
);
console.log(`decisions answered: ${[...tally.decKinds].sort((a, b) => b[1] - a[1]).map(([c, v]) => `${c} ${v}`).join(', ') || 'none'}`);
console.log(`uncovered at departure (held for crew): ${[...heldBy].map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}`);
console.log(`cancelled legs by reason: ${[...cancels].sort((a, b) => b[1] - a[1]).map(([c, v]) => `${c} ${v}`).join(', ') || 'none'}`);
for (const e of errors.slice(0, 3)) console.log(e);
// Soft target (information): the ladder in practice, a widebody signed with a job inside the year.
console.log(`ladder: widebody signed ${dayOf(tally.wideSigned)}; tour series / troop rotations signed ${tally.longLead}`);
{
  // v0.7.1 Crew Control: ladder stages, fixes by kind, jets and their share of revenue (soft targets, §16).
  const fixes = [...tally.crewFixes].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ') || 'none';
  const jetShare = revenueY ? (s.jetSpend ?? 0) / revenueY : 0;
  console.log(`crew control: amber ${s.crewAmber ?? 0}, red ${s.crewRed ?? 0}, fixes {${fixes}}, jets ${s.jets ?? 0} ${k$(s.jetSpend ?? 0)} (${(jetShare * 100).toFixed(2)}% of revenue)`);
  softTargets.push(['jets ≤ 8 a year and ≤ 1% of revenue', (s.jets ?? 0) * (365 / days) <= 8 && jetShare <= 0.01, `${s.jets ?? 0} jets, ${k$(s.jetSpend ?? 0)}`]);
  softTargets.push(['red crew shortages ≤ 12 a year', (s.crewRed ?? 0) * (365 / days) <= 12, `${s.crewRed ?? 0} red, ${s.crewAmber ?? 0} amber`]);
}
// v0.5.1 client paint: jobs in the paint shop, and what paint cost net of the clients' share (all months incl. the open one).
{
  const jobs = Object.values(g.maintenance).filter((m) => m.kind === 'paint' && m.status !== 'cancelled');
  const paid = [...g.finance.history, g.finance.current].reduce((s, st) => s + (st.lines.paint ?? 0), 0);
  const back = paintBack;
  const rev = revenueY || 1;
  console.log(`paint: ${tally.paintOffers.length} deals with client paint (${tally.paintOffers.join(', ') || '-'}); paint-shop visits ${jobs.filter((m) => m.paint?.phase === 'in').length} in / ${jobs.filter((m) => m.paint?.phase === 'out').length} out; paint ${k$(paid)}, reimbursed ${k$(back)}, net ${k$(paid + back)} (${(((paid + back) / rev) * 100).toFixed(1)}% of revenue)`);
}
console.log(
  `crew v0.6: morale ${moraleEnd.toFixed(1)} (min ${moraleMin.toFixed(1)}, month trend ${moraleTrend >= 0 ? '+' : ''}${moraleTrend.toFixed(1)}), resigned ${g.stats.resigned ?? 0}, hired back ${tally.rehired}, ` +
    `classes booked ${tally.classesBooked} done ${g.stats.conversions ?? 0}, extra-crew duties ${dutiesFlown ? ((100 * dutiesExtra) / dutiesFlown).toFixed(1) : '0'}% of ${dutiesFlown}, paid extras ${tally.paidExtra}, ` +
    `policies [${tally.policyChanges.join(', ') || '-'}], government invoices late ${govLate}/${gov.length}`,
);
{
  // v0.7 lines: the ladder, the market, deliveries, refits and leases.
  const granted = Object.entries(g.company.approvalsAt ?? {}).filter(([, t]) => (t ?? 0) > g.started).map(([id, t]) => `${id} day ${Math.floor(((t ?? 0) - g.started) / DAY)}`);
  console.log(`ladder v0.7: filed [${tally.filed.join(', ') || '-'}], granted [${granted.join(', ') || '-'}], pending [${g.company.pendingApprovals.map((p) => `${p.id}${p.waiting ? ' (waiting)' : ''}`).join(', ') || '-'}], findings ${s.findings ?? 0}`);
  const byMonth = new Map<number, number>();
  for (const x of seenMarket.values()) byMonth.set(x.month, (byMonth.get(x.month) ?? 0) + 1);
  const mk = [...seenMarket.values()];
  console.log(`market: ${mk.length} offers (${[...byMonth.values()].join('/')} per month), ${mk.filter((x) => x.teaser).length} teasers, ${mk.filter((x) => x.newBuild).length} new-build; signed [${tally.signed.join(', ') || '-'}]`);
  console.log(`deliveries: ${s.deliveries ?? 0} handed over (${abroad.size} abroad), ferry legs ${ferryLegs.size} (${ferryBH.toFixed(1)} BH), delivery-crew airline tickets ${dhDelivery.size}, waits ${s.deliveryWaitDays ?? 0} days (longest ${maxWait.toFixed(0)}), wait hires ${tally.waitHires}`);
  const refitCost = [...g.finance.history, g.finance.current].reduce((x, st) => x + (st.lines.refit ?? 0), 0);
  const retCost = [...g.finance.history, g.finance.current].reduce((x, st) => x + (st.lines.leaseReturn ?? 0), 0);
  console.log(`refits: ${s.refits ?? 0} done [${tally.refits.join(', ') || '-'}] ${k$(refitCost)}; leases: ${s.leaseExtensions ?? 0} extended, ${s.leaseReturns ?? 0} returned ${k$(retCost)}`);
  {
    // v0.7.4 client cabin requests: offered, signed with the cabin on, reconfigurations done (client-paid).
    const offered = Object.values(g.offers).filter((o) => o.cabin).length + Object.values(g.contracts).filter((c) => c.cabin).length;
    const signed = Object.values(g.contracts).filter((c) => c.cabin?.accepted);
    const mx = Object.values(g.maintenance).filter((m) => m.clientCabin && m.status === 'done');
    console.log(`v0.7.4: client cabin requests seen ${offered}, signed with the cabin ${signed.length}, reconfigurations done ${mx.length} (${k$(mx.reduce((a, m) => a + m.cost, 0))}, client share invoiced on completion)`);
  }
  softTargets.push(['ladder: widebody ops filed by day 200, a widebody signed by day 365 (≥ 4 of seeds 1–6)', tally.filed.some((f) => f.startsWith('widebody ') && Number(f.split(' day ')[1]) <= 200) && tally.wideSigned !== null, `filed ${tally.filed.find((f) => f.startsWith('widebody ')) ?? 'never'}; signed ${dayOf(tally.wideSigned)}`]);
  softTargets.push(['delivery pilots on airline deadheads (when handed over abroad)', abroad.size === 0 || dhDelivery.size > 0, `${dhDelivery.size} tickets for ${abroad.size} abroad`]);
  // v0.7.2 crew rules & fleet.
  console.log(`v0.7.2: sub-chartered legs ${s.subchartered ?? 0} (reliability ${s.subHit ?? 0}), C-checks at hubs [${tally.cHubs.join(', ') || '-'}], ferry+ticket cost ${Math.round(tally.hubTravel / 1000)}k, ferry legs ${checkLegs.size}, captains as FO ${s.asFo ?? 0}, multi-type cabin hires ${tally.multiHires}, early returns ${s.earlyReturns ?? 0}, sales ${s.sales ?? 0}`);
  // v0.7.3 in-flight rest & EASA.
  {
    const aug = Object.values(g.duties).filter((d) => d.augment > 0);
    const cls = [1, 2, 3].map((k) => aug.filter((d) => restOf(g, g.pairings[d.pairingId]?.aircraftId ?? null).fc?.cls === k).length);
    const notPossible = aug.filter((d) => !d.legacyRest && restPlan(g, d.id)?.ok === false).length;
    const extraCc = aug.filter((d) => (d.restExtra ?? 0) > 0).length;
    console.log(`v0.7.3: augmented duties flown ${augSeen.size}, standby crew-days held ${sbySeen.size}, in the state ${aug.length} (3P ${aug.filter((d) => d.augment === 1).length} / 4P ${aug.filter((d) => d.augment === 2).length}; class 1 ${cls[0]} / 2 ${cls[1]} / 3 ${cls[2]}), rest plans not possible ${notPossible}, extra cabin crew for rest ${extraCc}, extensions ${s.extensions ?? 0}, splits ${s.splits ?? 0}, standby call-ins ${s.standbyCalls ?? 0}, delayed reports ${s.delayedReports ?? 0}, rest refits [${tally.restRefits.join(', ') || '-'}], 4 pilots for a short cruise ${tally.aug4}, discretion reports ${s.discretionReports ?? 0}`);
  }
  if (WIDE && AUG) {
    softTargets.push(['augmented duties ≥ 20 on --wide --aug seeds 1–3 (v0.7.3)', augSeen.size >= 20 * (days / 365), `${augSeen.size} flown`]);
    softTargets.push(['the rest-plan check covers ≥ 1 duty (v0.7.3)', augSeen.size >= 1, `${augSeen.size} augmented duties checked`]);
  }
  softTargets.push(['standby call-ins ≥ 3 a year (v0.7.3)', (s.standbyCalls ?? 0) >= 3 * (days / 365), `${s.standbyCalls ?? 0} call-ins, ${sbySeen.size} standby crew-days`]);
  targets.push(['C-check ferries: 0 illegal duties', illegalAtCheck === 0, `${checkLegs.size} legs, ${illegalAtCheck} illegal`]);
  // v0.7.1 runs end at 90–97 from a 60 start; sub-chartering (F3) may take a few points of it.
  softTargets.push(['reliability ends ≥ 85 (v0.7.1: 90–97)', g.company.reputation.reliable >= 85, `${reliable0.toFixed(1)} → ${g.company.reputation.reliable.toFixed(1)} (sub-charters ${s.subHit ?? 0})`]);
  softTargets.push(['month-end cash ≥ 0 and the year ends ≥ 0 (v0.7.1 seed 6: −2657k low)', minCash >= 0 && g.company.cash >= 0, `month-end low ${k$(minCash)}, end ${k$(g.company.cash)}`]);
  softTargets.push(['captains as FO ≤ 24 duties a year', (s.asFo ?? 0) <= 24 * (days / 365), `${s.asFo ?? 0}`]);
  targets.push(['delivery ferries: 0 illegal duties, no wait > 30 days', illegalAtFerry === 0 && maxWait <= 30, `${ferryLegs.size} legs, ${illegalAtFerry} illegal, longest wait ${maxWait.toFixed(0)} days`]);
}
{
  // v0.8 (UPDATE-0.8.md §13).
  const v8 = g.stats.v08 ?? { lostToRival: 0, subIn: 0, dryLeases: 0, dryMonths: 0, worldEvents: 0, closuresHit: 0, legsRerouted: 0, legsFm: 0, warRiskPaid: 0, injunctions: 0, whiteouts: 0, levelUps: 0, feesWaived: 0 };
  const lv = { unhappy: 0, new: 0, known: 0, trusted: 0, partner: 0 } as Record<string, number>;
  for (const c of Object.values(g.clients)) lv[c.level ?? 'new']++;
  const lw = v8.lostWhy ?? { cheaper: 0, closer: 0, sooner: 0 };
  const byRival = Object.entries(v8.subByRival ?? {}).map(([id, n]) => `${g.rivals.find((r) => r.id === id)?.name ?? id} ${n}`).join(', ');
  const types = [...tally.types.entries()].sort().map(([k, n]) => `${k} ${n}`).join(' ');
  let dryIncome = 0;
  for (const st of [...g.finance.history, g.finance.current]) dryIncome += st.lines.leaseIncome ?? 0;
  console.log(
    `v0.8: levels U/N/K/T/P ${lv.unhappy}/${lv.new}/${lv.known}/${lv.trusted}/${lv.partner} · standing Est. ${dayOf(v8.establishedAt ?? null)}, Resp. ${dayOf(v8.respectedAt ?? null)} · types ${types || '-'} · ` +
      `lost to rivals ${v8.lostToRival} (cheaper ${lw.cheaper}/closer ${lw.closer}/sooner ${lw.sooner}) · sub-charter out ${s.subchartered ?? 0} (${byRival || '-'}) in ${v8.subIn} · ` +
      `events ${v8.worldEvents} (closures hit ${v8.closuresHit}, legs rerouted ${v8.legsRerouted}, strike delays ${v8.strikeDelays ?? 0}, FM cancels ${v8.legsFm}, war-risk ${k$(v8.warRiskPaid)}, injunctions ${v8.injunctions}, whiteouts ${v8.whiteouts}) · ` +
      `phases by quarter ${phases.join('/')} · fuel ${fuelMin}–${fuelMax} · dry leases ${v8.dryLeases} (${v8.dryMonths} months, ${k$(dryIncome)}) · mixed-crew contracts ${mixedSeen.size} · fees waived ${v8.feesWaived} · runtime ${runSecs.toFixed(1)} s`,
  );
  softTargets.push(['Established by day 240 (≥ 5 of seeds 1–6, v0.8)', v8.establishedAt !== undefined && v8.establishedAt - g.started <= 240 * DAY, dayOf(v8.establishedAt ?? null)]);
  softTargets.push(['a Trusted client by day 365 (≥ 4 of seeds 1–6, v0.8)', trustedAt !== null, dayOf(trustedAt)]);
  softTargets.push(['a widebody signed (2–4 of seeds 1–6, v0.8)', tally.wideSigned !== null, dayOf(tally.wideSigned)]);
  softTargets.push(['≥ 1 offer lost to a rival with a reason (v0.8)', v8.lostToRival >= 1, `${v8.lostToRival}`]);
  softTargets.push(['a world event touching our flights (≥ 3 of seeds 1–6, v0.8)', v8.closuresHit + v8.legsRerouted + (v8.strikeDelays ?? 0) + (v8.warRiskPaid > 0 ? 1 : 0) > 0, `closures ${v8.closuresHit}, rerouted ${v8.legsRerouted}, strike delays ${v8.strikeDelays ?? 0}, war-risk ${k$(v8.warRiskPaid)}`]);
  softTargets.push(['a dry lease (≥ 2 of seeds 1–6, v0.8)', v8.dryLeases >= 1, `${v8.dryLeases}`]);
}
{
  // v0.9 (UPDATE-0.9.md §13): heads, achievements, slips, out of hours, discretion, jumbo loads.
  const v9 = g.stats.v09;
  const hs = g.heads ? Object.values(g.heads) : [];
  const unl = HEAD_IDS.map((id) => `${id} ${headUnlocked.has(id) ? `d${headUnlocked.get(id)}` : '–'}`).join(' ');
  const handled = hs.reduce((n, h) => n + h.handled, 0);
  const ach = Object.keys(g.achievements ?? {}).length;
  const slipOffers = slipSeen.size;
  const b744 = Object.values(g.fleet).filter((a) => a.typeId === 'b744').map((a) => a.id);
  let rev744 = 0;
  for (const c of Object.values(g.contracts)) if (c.aircraftIds.some((id) => b744.includes(id))) rev744 += c.invoiced ?? 0;
  const decided = [...tally.decisions.values()].reduce((a, b) => a + b, 0);
  console.log(
    `v0.9: heads unlocked ${unl} · hired ${hs.filter((h) => h.hired).length} · handled ${handled} (mistakes ${hs.reduce((n, h) => n + h.mistakes, 0)}, overridden ${hs.reduce((n, h) => n + h.overridden, 0)}) · ` +
      `achievements ${ach}/24 · slips ${v9?.slips ?? 0} (offers ${slipOffers}) · out of hours red ${v9?.oohRed ?? 0} amber ${v9?.oohAmber ?? 0} · ` +
      `discretion used ${v9?.discretionUsed ?? 0} (planned ${v9?.discretionPlanned ?? 0}) refused ${v9?.discretionRefused ?? 0} · jumbo loads ${v9?.jumboLoads ?? 0} (747 invoiced ${k$(rev744)}) · runtime ${runSecs.toFixed(1)} s`,
  );
  targets.push(['discretion never planned (v0.9)', (v9?.discretionPlanned ?? 0) === 0, `${v9?.discretionPlanned ?? 0}`]);
  targets.push(['runs in ≤ 20 s (v0.9 hard limit)', runSecs <= 20, `${runSecs.toFixed(1)} s`]);
  softTargets.push(['≥ 3 heads unlocked (v0.9; ≥ 5 on 3 seeds)', headUnlocked.size >= 3 * Math.min(1, days / 365), `${headUnlocked.size}`]);
  softTargets.push(['heads take ≥ 40 % of the routine decisions (v0.9)', handled + decided === 0 || handled / (handled + decided) >= 0.4, `${handled} of ${handled + decided}`]);
  softTargets.push(['achievements 6–14 (v0.9)', ach >= 6 && ach <= 14, `${ach}`]);
}
{
  // v0.9 §R roster planning (UPDATE-0.9.md §R.12).
  const r = g.stats.v09?.roster;
  if (r) {
    const months: number[] = [];
    for (const c of Object.values(g.crew)) for (const n of Object.values(c.offMonths ?? {})) months.push(n);
    const avg = months.length ? months.reduce((a, b) => a + b, 0) / months.length : 0;
    const sby = r.sbyHome + r.sbyHotel + r.asby + r.res;
    const free = sby + r.otherDays;
    const all = r.offDays + r.leaveDays + r.flying + free;
    const fixes = [...tally.crewFixes.values()].reduce((a, b) => a + b, 0);
    const pct = (a: number, b: number) => (b ? Math.round((100 * a) / b) : 0);
    console.log(
      `roster: days off/crew-month ${avg.toFixed(1)} (min 7, <7: ${r.monthsLow} of ${r.months}) · leave ${(r.leaveDays / Math.max(1, months.length)).toFixed(1)} · standby ${pct(sby, all)}% of days (home ${pct(r.sbyHome, all)} · hotel ${pct(r.sbyHotel, all)} · airport ${pct(r.asby, all)} · reserve ${pct(r.res, all)}) · ` +
        `standby share of free days ${pct(sby, free)}% · call-outs ${r.callOuts} (crew fixes ${fixes}) · max recovery gap ${r.maxRecGapH} h · offBroken ${r.offBroken} · moved ${r.offMoved ?? 0}`,
    );
    targets.push(['roster: no crew-month below 7 days off (v0.9)', r.monthsLow === 0, `${r.monthsLow} of ${r.months}`]);
    targets.push(['roster: recovery gap ≤ 168 h (v0.9)', r.maxRecGapH <= 168, `${r.maxRecGapH} h`]);
    softTargets.push(['roster: average days off 8.5–10 (v0.9)', avg >= 8.5 && avg <= 10, avg.toFixed(1)]);
    softTargets.push(['roster: standby + reserve ≥ 85% of the free days (v0.9)', pct(sby, free) >= 85, `${pct(sby, free)}%`]);
  }
}
console.log('\ntargets');
for (const [name, ok, val] of targets) console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(38)} ${val}`);
for (const [name, ok, val] of softTargets) console.log(`  ${ok ? 'ok  ' : 'no  '}  ${name} — ${val}`);
process.exitCode = errors.length ? 2 : targets.every((c) => c[1]) ? 0 : 1;
