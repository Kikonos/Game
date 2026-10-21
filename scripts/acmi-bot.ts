// BLOCK HOURS headless year (DESIGN.md §7.3): a new Startup game (Lisbon, 2× A320ceo) played by a simple,
// sensible policy, with a monthly table and the balance targets.
//   npx tsx scripts/acmi-bot.ts [seed] [days]        one game (default seed 1, 365 days)
//   npx tsx scripts/acmi-bot.ts [seed] --det         determinism: same seed twice to day 180, and save/load at day 90
//   npx tsx scripts/acmi-bot.ts [seed] [days] --wide  v0.6: lease the first affordable widebody (conversion classes)
//
// Policy (a pure function of the game state, so a loaded save plays on identically):
// - offers: base deployments first, then ad hoc fill-ins; accept the best ok/warn feasibility with a positive
//   margin (crew shortfalls only when hires join in time); counter long-lead base deals at +5% once;
// - crew: fill staffing, hire one more set when the family's pilots fly > 80% of productive hours;
// - maintenance: C-checks booked when warned, in the first free window (winter first); A-checks auto;
// - decisions: swap aircraft on AOG when one is free, factor a late invoice when cash is short, else the default;
// - fleet: lease a widebody once the cash covers its deposit, three months of its fixed costs and a cushion, the last
//   quarter was profitable and a big widebody job starts after delivery;
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

import LZString from 'lz-string';
import { BAL } from '../src/engine/core/balance';
import { statementTotals } from '../src/engine/core/ledger';
import { complement, typeOf } from '../src/engine/core/perf';
import { DAY, dayIndex, fmtDateTime, fmtMonth, fromUTC, monthKey, toDate } from '../src/engine/core/time';
import type { RatingFamily } from '../src/data/acmiTypes';
import type { Archetype, ContractOffer, GameState, LedgerCat, MonthKey, Role } from '../src/engine/core/types';
import { acceptOffer, counterOffer, feasibility, type FeasibilityReport } from '../src/engine/contracts';
import { aboveMinimum, classOf, conversionClasses, conversionEarliest, conversionPlan, hireCrew, setCrewExtra, staffing, startConversion, type StaffingLine } from '../src/engine/crew';
import { devFleet } from '../src/engine/dev';
import { createGame } from '../src/engine/newGame';
import {
  acquireAircraft, aircraftGate, applyApproval, approvalBlocker, approvalReqs, APPROVALS, bookRefit, cancelCheck, checkStatus, deliveryStatus, fixedCosts, groundGaps, ratedPilots,
  refitQuote, refitStations, resolveDecision, scheduleCheck, ticketPurpose,
} from '../src/engine/ops';
import { cabinAt, cabinFits, refitTip } from '../src/engine/ops/cabin';
import type { ApprovalId } from '../src/engine/core/types';
import { deserialize, serialize } from '../src/engine/save';
import { advanceTo, settle } from '../src/engine/sim';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const seed = Number(args[0] ?? 1);
const days = Number(args[1] ?? 365);
const DET = process.argv.includes('--det');
const BIG = process.argv.includes('--big');
const MSGS = process.argv.includes('--msgs');
/** v0.6: take the first widebody lease the cash allows (exercises conversions and widebody extra crew). */
const WIDE = process.argv.includes('--wide');
/** Fixed crew policies for the whole run (hotel★,perDiem%,tourWeeks), e.g. --policy=3,80,6 for stingy play. */
const POLICY = process.argv.find((a) => a.startsWith('--policy='))?.slice(9).split(',').map(Number);
/** Extra cabin crew on every aircraft (--extra=2). */
const EXTRA = Number(process.argv.find((a) => a.startsWith('--extra='))?.slice(8) ?? 0);
const BIG_DAYS = Number(process.env.BIG_DAYS ?? 120);
const STEP = 6 * 60;

const newGame = () => createGame({ name: 'Atlântica Wings', code: 'AW', livery: { primary: '#0b1f4d', secondary: '#f5c451', tail: 'sweep' }, base: 'LIS', seed });

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
}
const newTally = (): Tally => ({
  actions: new Map(), decisions: new Map(), decMonth: new Map(), decKinds: new Map(), accepted: 0, countered: 0, firstAccept: null, wideAffordableAt: null, wideReadyAt: null, wideSigned: null, longLead: 0, paintOffers: [],
  rehired: 0, policyChanges: [], classesBooked: 0, paidExtra: 0, filed: [], signed: [], narrowSigned: 0, refits: [], leaseChoices: [], waitHires: 0,
});

const weekOf = (g: GameState) => Math.floor((g.now - g.started) / (7 * DAY));
const act = (g: GameState, t: Tally, n = 1) => t.actions.set(weekOf(g), (t.actions.get(weekOf(g)) ?? 0) + n);

const isBase = (o: ContractOffer) => o.pattern.kind === 'base' || o.archetype === 'seasonBase' || o.archetype === 'aogCover';
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

function decide(g: GameState, t: Tally): void {
  for (const d of [...g.decisions]) {
    const usable = (id: string) => d.options.some((o) => o.id === id && !o.chips?.includes('Unavailable'));
    let opt = d.defaultOption;
    if (d.kind === 'aog' && usable('swap')) opt = 'swap';
    else if (d.kind === 'latePayment' && g.company.cash < 600_000 && usable('factor')) opt = 'factor';
    else if (d.kind === 'rescue') opt = 'accept';
    else if (d.kind === 'leaseEnd') opt = keepLease(g, String(d.data?.aircraftId ?? '')) ? 'extend12' : 'return';
    if (resolveDecision(g, d.id, opt).ok || resolveDecision(g, d.id, d.defaultOption).ok) {
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
    if (cap && cap.short > 0 && hireCrew(g, { role: role as Role, family, base: g.company.homeBase, count: Math.min(30, cap.short) }).ok) act(g, t);
  }
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
  return (
    all.sort((a, b) => rank[a.level] - rank[b.level] || b.estMargin - a.estMargin).find((r) => {
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
    .sort((a, b) => Number(isBase(b)) - Number(isBase(a)) || b.estValue - a.estValue);
  // v0.7: a calendar under half full over the next month takes ad hoc work up to 45 days out.
  const hungry = open.length > 0 && committed(g, 30) < 0.5;
  for (const o of open) {
    const span = Math.max(1, (o.end - o.start) / DAY);
    if (span > 10 && o.estBH / span < 3) continue;
    // Ad hoc work inside 30 days (v0.6: was three weeks); tour series and troop rotations up to 90 days out.
    const longLead = o.archetype === 'tourSeries' || o.archetype === 'troopRotation';
    if (!isBase(o) && o.start > g.now + (longLead ? 90 : hungry ? 45 : 30) * DAY) continue;
    const best = bestFit(g, o);
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
      if (xc) t.paidExtra++;
      if (o.paint) t.paintOffers.push(`${o.paint.kind}${o.paint.required ? '/req' : ''}/${Math.round(o.paint.clientShare * 100)}%${paintOn(o) ? '' : ' declined'}`);
      if (longLead) t.longLead++;
      t.firstAccept ??= g.now;
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
  for (const l of staffing(g)) {
    const have = l.have + inClass(g, l);
    if (have < l.need && hireCrew(g, { role: l.role, family: l.family, base: g.company.homeBase, count: Math.min(30, l.need - have) }).ok) act(g, t);
  }
  const fams = new Map<RatingFamily, { typeId: string; seats: number }>();
  for (const ac of Object.values(g.fleet)) if (ac.status !== 'delivering') fams.set(typeOf(ac.typeId).family, { typeId: ac.typeId, seats: ac.cabin.total });
  const trouble = crewTrouble(g) >= 4;
  for (const [family, x] of fams) {
    if ((!trouble && pilotUtil(g, family) < 0.8) || g.company.cash < 1_500_000) continue;
    if (Object.values(g.crew).some((c) => c.status === 'joining' && c.ratings.includes(family))) continue;
    const per = new Map<Role, number>();
    for (const r of complement(x.typeId, x.seats, { extraCabin: g.company.policies.extraCabin })) per.set(r, (per.get(r) ?? 0) + 1);
    for (const [role, n] of per) if (hireCrew(g, { role, family, base: g.company.homeBase, count: n }).ok) act(g, t);
  }
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

/** C-checks: booked once warned (≤ 90 days), in the first free window long enough (winter preferred). */
function checks(g: GameState, t: Tally): void {
  for (const ac of Object.values(g.fleet)) {
    if (ac.status === 'delivering') continue;
    const st = checkStatus(g, ac);
    if (st.nextC || st.cDue - g.now > 90 * DAY) continue;
    const ty = typeOf(ac.typeId);
    const need = ty.cCheckDays * DAY + DAY;
    const gaps = groundGaps(g, ac, g.now + DAY, st.cDue + 20 * DAY).filter((x) => x.to - x.from >= need);
    const winter = gaps.find((x) => [10, 11, 0, 1, 2].includes(toDate(x.from).getUTCMonth()));
    for (const gap of winter ? [winter, ...gaps] : gaps) {
      const lead = gap.at === g.company.homeBase ? 120 : 120 + ty.turnMin + 6 * 60;
      if (scheduleCheck(g, ac.id, 'C', gap.from + lead, g.company.homeBase).ok) {
        act(g, t);
        break;
      }
    }
  }
}

/** A widebody's own monthly fixed costs: rent, insurance, overhead share, 5 crew sets with on-costs. */
function wideMonth(rent: number, typeId: string, seats: number): number {
  const sets = complement(typeId, seats).reduce((s, r) => s + (BAL.salary[r]?.[1] ?? 3_000), 0) * BAL.crewSetsPerAircraft * (1 + BAL.onCosts);
  return rent + typeOf(typeId).insuranceMonth + BAL.overheadPerAircraft + sets;
}

/**
 * Signed when the deposit, three months of the widebody's fixed costs (crew included) and a $1.5M cushion are in the bank, only
 * while the last three months were profitable and a widebody base of 75+ days worth $2.5M+ starts far enough out for delivery
 * and crew hiring (but within 75 days of delivery, so the new aircraft isn't parked for months); that job is then taken as
 * soon as the aircraft can fly it.
 */
function fleet(g: GameState, t: Tally): void {
  if (Object.values(g.fleet).some((a) => typeOf(a.typeId).body === 'wide')) return;
  const recent = g.finance.history.slice(-3);
  // v0.7: the Ladder's approval fees are an investment, not a sign of a losing quarter.
  const earning = recent.length === 3 && recent.reduce((s, st) => s + statementTotals(st.lines).profit - (st.lines.approvals ?? 0), 0) > 0;
  for (const o of g.market.aircraft) {
    // v0.7: only what the Ladder lets us sign (pending counts), never a new-build slot.
    if (typeOf(o.typeId).body !== 'wide' || o.kind !== 'dryLeaseIn' || o.newBuild || o.expires <= g.now || !aircraftGate(g, o.typeId).ok) continue;
    // The family our widebody pilots fly (another only 60 days after filing with nothing of ours on offer).
    const filed = g.company.pendingApprovals.find((p) => p.id === 'widebody')?.started ?? g.company.approvalsAt?.widebody ?? g.now;
    if (typeOf(o.typeId).family !== wideFamily(g) && g.now - filed < 60 * DAY) continue;
    // Acquirable (the target): deposit plus three months of rent and insurance, with $1M left to run the airline.
    if (g.company.cash >= o.deposit + 3 * (o.rentPerMonth + typeOf(o.typeId).insuranceMonth) + 1_000_000) t.wideAffordableAt ??= g.now;
    if (g.company.cash < o.deposit + (WIDE ? 1_000_000 : wideMonth(o.rentPerMonth, o.typeId, o.cabin.total) + 500_000)) continue;
    t.wideReadyAt ??= g.now;
    // v0.7: home after the delivery ferry; a widebody job worth $1M+ starting 1–4 months after that (or, from day 150
    // on the ladder, the widebody itself: wide work follows a widebody fleet).
    const lead = o.leadDays + 7;
    const job = Object.values(g.offers).find(
      (x) => x.status === 'open' && x.estValue >= 1_000_000 && x.start > g.now + (lead + 14) * DAY && x.start < g.now + (lead + 120) * DAY && (x.requirements.body === 'wide' || x.requirements.minSeats > 220) &&
        o.cabin.total >= x.requirements.minSeats && (!x.requirements.families?.length || x.requirements.families.includes(typeOf(o.typeId).family)),
    );
    // On the ladder: signed so it is home about when Widebody operations is granted (it flies revenue only then).
    const due = g.company.approvals.includes('widebody') ? g.now : g.company.pendingApprovals.find((p) => p.id === 'widebody')?.done;
    const timed = due !== undefined && due - g.now <= (lead + 45) * DAY;
    if (!WIDE && (!earning || !(job || timed))) continue;
    if (acquireAircraft(g, o.id).ok) {
      t.wideSigned = g.now;
      t.signed.push(`${typeOf(o.typeId).short} day ${Math.floor((g.now - g.started) / DAY)} at ${o.site}`);
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
  // Only off a strong quarter (approval fees aside): the widebody ladder costs ~$2M before the first widebody revenue.
  const q = g.finance.history.slice(-3).reduce((s, st) => s + statementTotals(st.lines).profit - (st.lines.approvals ?? 0), 0);
  if (dayN(g) >= 120 && wideLease && q >= 1_200_000 && !held(g, 'widebody') && cash >= cost('widebody') + 2_500_000 + 2 * monthFixed(g)) {
    // Pilots are hired only when they are all that's missing (never for an application the record still blocks).
    const otherwise = approvalReqs(g, 'widebody').every((r) => r.ok || / CPT \+ /.test(r.label));
    const fam = wideFamily(g);
    const r = ratedPilots(g, [fam], { booked: true });
    for (const role of ['CPT', 'FO'] as const) {
      const short = 4 - r[role];
      if (otherwise && short > 0 && hireCrew(g, { role, family: fam, base: g.company.homeBase, count: short }).ok) act(g, t);
    }
    if (!approvalBlocker(g, 'widebody')) file(g, t, 'widebody');
  }
  const wideHeld = Object.values(g.fleet).some((a) => typeOf(a.typeId).body === 'wide' && a.status !== 'delivering');
  const longJob = Object.values(g.offers).some((o) => o.requirements.body === 'wide' && o.pattern.kind === 'legs' && o.pattern.legs.some((l) => l.dep && o.requirements.longestSectorNm > 13 * 470));
  if (wideHeld && longJob && !held(g, 'augmented') && !approvalBlocker(g, 'augmented') && cash >= cost('augmented') + 2_000_000) file(g, t, 'augmented');
  for (const id of ['etops180', 'etops240'] as ApprovalId[]) if (!held(g, id) && !approvalBlocker(g, id) && cash >= cost(id) + 2_000_000) file(g, t, id);
}

/**
 * The widebody family we build crew for: the one with the most widebody pilots (rated or converting), else the
 * family of the cheaper open A330 / 767 lease (teasers included), else the 767.
 */
function wideFamily(g: GameState): RatingFamily {
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

/** A third A320-family aircraft on days 75–200 when the narrowbodies are well committed over the next 60 days; never new-build; one at a time. */
function narrowGrowth(g: GameState, t: Tally): void {
  // From day 75 (the first two prove the business), not in the last five months of the year (a late aircraft pays
  // rent and new crew long before its first season).
  if (dayN(g) < 75 || dayN(g) > 200 || Object.values(g.fleet).some((a) => a.status === 'delivering')) return;
  if (Object.values(g.fleet).filter((a) => typeOf(a.typeId).body === 'narrow').length >= 3) return;
  const o = g.market.aircraft.find((x) => x.kind === 'dryLeaseIn' && !x.newBuild && x.expires > g.now && typeOf(x.typeId).family === 'A320' && aircraftGate(g, x.typeId).ok);
  // 75% committed over the next 60 days; from day 150, 60% (the winter programme is being sold by then).
  if (!o || g.company.cash < o.deposit + 1_000_000 || committed(g, 60) < (dayN(g) >= 150 ? 0.6 : 0.75)) return;
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
      for (let d = 7; d < 60; d++) {
        const start = Math.ceil((g.now + d * DAY) / DAY) * DAY + 8 * 60;
        const q = refitQuote(g, ac.id, tip.label, st.code, start);
        if (!q.ok) continue;
        if (q.end + 2 * DAY > o.start || q.cost >= 0.4 * o.estValue) break;
        const booked = bookRefit(g, ac.id, tip.label, st.code, start);
        if (booked.ok) {
          const best = bestFit(g, o);
          // No job after all (another check fails with the new cabin): the refit is called off.
          if (!best || !acceptOffer(g, o.id, [best.aircraftId], { paint: paintOn(o) }).ok) {
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
function policy(g: GameState, t: Tally, urgent: boolean, newDay: boolean): void {
  decide(g, t);
  if (newDay) {
    policies(g, t);
    rehire(g, t);
    extraCrew(g, t);
    conversions(g, t);
    hire(g, t);
    checks(g, t);
    ladderSteps(g, t);
    fleet(g, t);
    narrowGrowth(g, t);
    deliveryWaits(g, t);
    refits(g, t);
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
const abroad = new Set<string>();
let maxWait = 0;
let illegalAtFerry = 0;

function onStep(): void {
  const m = mon(monthKey(g.now));
  for (const r of g.finance.receivables) {
    if (seenRecv.has(r.id) || !/^(Paint|Repaint)/.test(r.desc)) continue;
    seenRecv.add(r.id);
    paintBack += r.amount;
  }
  for (const o of Object.values(g.offers)) seenOffer.add(o.id);
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
  // v0.7 deliveries: airline tickets of delivery crews, ferry legs flown, waits.
  for (const f of Object.values(g.flights)) {
    if (f.kind === 'deadhead' && f.status !== 'cancelled' && !dhSeen.has(f.id)) {
      dhSeen.add(f.id);
      if (ticketPurpose(g, f.id).kind === 'delivery') dhDelivery.add(f.id);
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
  for (const d of Object.values(g.duties)) {
    if (!d.done || seenDuty.has(d.id)) continue;
    seenDuty.add(d.id);
    dutiesFlown++;
    const dp = g.pairings[d.pairingId];
    if (dp && aboveMinimum(g, dp).cabin + aboveMinimum(g, dp).pilots > 0) dutiesExtra++;
  }
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

const CODE: Partial<Record<Archetype, string>> = { seasonBase: 'SB', aogCover: 'AC', adhoc: 'AH', sports: 'SP', repatriation: 'RP', tourSeries: 'TS', troopRotation: 'TR', evacuation: 'EV', vip: 'VI' };
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
  ['solvent all year (no game over)', !g.gameOver, g.gameOver ? g.gameOver.reason : `month-end low ${k$(minCash)}, end ${k$(g.company.cash)}`],
  ['summer BH per aircraft 180–320', summerBH >= 180 && summerBH <= 320, summerBH.toFixed(0)],
  ['year net margin −5%…+12%', margin >= -0.05 && margin <= 0.12, `${(margin * 100).toFixed(1)}% (${k$(profitY)} on ${k$(revenueY)})`],
  ['no illegal duties flown (FDP + crew)', illegalOf(s) === 0, `${illegalOf(s)} (FDP ${s.illegalFlown ?? 0}, crew ${s.illegalCrewFlown ?? 0})`],
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
  ['runs in < 10 s', runSecs < 10, `${runSecs.toFixed(1)} s`],
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
console.log(`cancelled legs by reason: ${[...cancels].sort((a, b) => b[1] - a[1]).map(([c, v]) => `${c} ${v}`).join(', ') || 'none'}`);
for (const e of errors.slice(0, 3)) console.log(e);
// Soft target (information): the ladder in practice, a widebody signed with a job inside the year.
console.log(`ladder: widebody signed ${dayOf(tally.wideSigned)}; tour series / troop rotations signed ${tally.longLead}`);
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
  softTargets.push(['ladder: widebody ops filed by day 200, a widebody signed by day 365 (≥ 4 of seeds 1–6)', tally.filed.some((f) => f.startsWith('widebody ') && Number(f.split(' day ')[1]) <= 200) && tally.wideSigned !== null, `filed ${tally.filed.find((f) => f.startsWith('widebody ')) ?? 'never'}; signed ${dayOf(tally.wideSigned)}`]);
  softTargets.push(['delivery pilots on airline deadheads (when handed over abroad)', abroad.size === 0 || dhDelivery.size > 0, `${dhDelivery.size} tickets for ${abroad.size} abroad`]);
  targets.push(['delivery ferries: 0 illegal duties, no wait > 30 days', illegalAtFerry === 0 && maxWait <= 30, `${ferryLegs.size} legs, ${illegalAtFerry} illegal, longest wait ${maxWait.toFixed(0)} days`]);
}
console.log('\ntargets');
for (const [name, ok, val] of targets) console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(38)} ${val}`);
for (const [name, ok, val] of softTargets) console.log(`  ${ok ? 'ok  ' : 'no  '}  ${name} — ${val}`);
process.exitCode = errors.length ? 2 : targets.every((c) => c[1]) ? 0 : 1;
