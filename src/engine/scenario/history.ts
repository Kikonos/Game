// v0.15 Scenarios: stepping into an established airline (the player: "make each scenario like it's been played in
// already … days in the AOC, relevant company qualifications and certifications, as if I'm just stepping in"). Each
// scenario's `history` (scenario/defs.ts) is written into the new game before its setup: the AOC date, the standing and
// reputation, approvals held since a date, a year of monthly statements, completed jobs with their clients, crew
// seniority and recent duties (legal under the FTL rules, ending with a recovery rest before the start), the technical
// dispatch and on-time record, lifetime counters, and the achievements and goals those already earn. Deterministic:
// its own random stream, seeded from the scenario's seed (the game's own stream is left as it was).

import { ACMI_TYPES, type RatingFamily } from '../../data/acmiTypes';
import { AIRPORT_BY_CODE } from '../../data/airports';
import { BAL } from '../core/balance';
import { nextId } from '../core/entities';
import { statementTotals } from '../core/ledger';
import { isPilot, typeOf } from '../core/perf';
import { chance, int, range, type RngHolder } from '../core/rng';
import { DAY, daysInMonth, fromUTC, localOffset, monthKey, monthStart, yearOf } from '../core/time';
import type { ApprovalId, Archetype, Contract, DutyLogEntry, GameState, LedgerCat, Minute, MonthStatement, SchedulePattern } from '../core/types';
import { levelFor, standingFor } from '../contracts/relations';
import { crewPlan } from '../crew/sets';
import { touchCrew } from '../crew/timeline';
import { checkAchievements } from '../ops/achievements';
import { insuranceOf } from '../ops/finance';
import { GOALS } from '../ops/goals';

/** One completed job before the start (the Clients list, Contracts › Recently finished, the client's record). */
export interface PastJob {
  client: string;
  title: string;
  arch: Archetype;
  /** Fleet index of the aircraft that flew it. */
  ac: number;
  /** First day [year, month, day] and length in days. */
  start: [number, number, number];
  days: number;
  /** Wet lease (rate per BH) or charter (one price); block hours flown. */
  kind: 'wet' | 'charter';
  bh: number;
  /** A wet lease's base and destinations ('DUS>ALC,SVQ,PMI'), or a charter's legs ('MAD-TFS,TFS-MAD'). */
  route: string;
}

export interface ScenarioHistory {
  /** The AOC was issued [year, month, day]. */
  aoc: [number, number, number];
  reliable: number;
  clean: number;
  /** Approvals held and since when [id, year, month] (the scenario's own approvals included). */
  granted: [ApprovalId, number, number][];
  /** Block hours per aircraft in each of the 12 months before the start, oldest first. */
  util: number[];
  /** Share of that flying that was charter (we paid fuel and fees) rather than ACMI. */
  charter: number;
  /** Cash at the end of the month a year before the start (the statements run from there to the start cash). */
  cash0: number;
  /** Contracts completed since the AOC, and the share of legs on time and of technical dispatch, %. */
  jobs: number;
  onTime: number;
  tech: number;
  past: PastJob[];
  /** Client relations (−100…100) at the start, the past jobs' clients first. */
  rel: [string, number][];
  /** How busy the crew were in the last four weeks (0 idle, 1 a full 4-on 3-off pattern). */
  busy: number;
  /** Cabin crew hold both narrowbody families of a mixed fleet (share of them). */
  dual?: number;
  /** Crew sets per aircraft over the past year when the roster was fuller than today's (Crew Crisis: before the walkout). */
  sets?: number;
  /** Profit ÷ revenue over the year (the revenue lines are scaled to it; the months keep their seasons). */
  margin: number;
}

const H = 60;
type Rng = RngHolder;

/** Days from a [y, m, d]. */
const at = (d: [number, number, number]) => fromUTC(d[0], d[1], d[2]);

/** Writes the history into a freshly built scenario game (before its setup). */
export function seedHistory(g: GameState, h: ScenarioHistory, seed: number): void {
  const r: Rng = { rng: (seed * 7919 + 104_729) | 0 };
  const start = g.now;
  const co = g.company;
  co.aocAt = Math.min(start - 400 * DAY, at(h.aoc));
  co.reputation.reliable = h.reliable;
  co.reputation.clean = h.clean;
  // Approvals held since their grant.
  co.approvalsAt ??= {};
  for (const [id, y, m] of h.granted) {
    if (!co.approvals.includes(id)) co.approvals.push(id);
    co.approvalsAt[id] = Math.max(co.aocAt, Math.min(start - 120 * DAY, fromUTC(y, m, 1)));
  }
  // An ETOPS operator has its maintenance programme in place.
  if (co.approvals.some((a) => /^etops/.test(a))) co.etopsMx = { started: co.approvalsAt.etops120 ?? co.aocAt, done: co.approvalsAt.etops120 ?? co.aocAt, cost: 0, held: true };
  seedFleet(g, r, start);
  seedCrew(g, h, r, start);
  seedStatements(g, h, r, start);
  seedJobs(g, h, start);
  seedRecord(g, h, r, start);
  co.standing = standingFor(g);
  const v8 = g.stats.v08;
  if (v8 && co.standing >= 1) v8.establishedAt ??= co.aocAt + 200 * DAY;
  if (v8 && co.standing >= 2) v8.respectedAt ??= co.aocAt + 500 * DAY;
  seedEarned(g, start);
  touchCrew(g);
}

// ---------- fleet ----------

/** Leases signed years ago (still running past the scenario). */
function seedFleet(g: GameState, r: Rng, start: Minute): void {
  const aoc = g.company.aocAt!;
  for (const ac of Object.values(g.fleet)) {
    if (ac.ownership.kind !== 'dryLeaseIn' || ac.ownership.leaseStart < start - 200 * DAY) continue;
    // The A330 of Long-Haul Debut arrives with the scenario (noCrew): its lease is new.
    if (!Object.values(g.crew).some((c) => c.ratings.includes(typeOf(ac.typeId).family))) continue;
    ac.ownership.leaseStart = Math.max(aoc, start - int(r, 420, 1_600) * DAY);
  }
}

// ---------- crew ----------

/** Seniority dates since the AOC, a year of block hours by month, and the last four weeks' duties (legal, rested). */
function seedCrew(g: GameState, h: ScenarioHistory, r: Rng, start: Minute): void {
  const aoc = g.company.aocAt!;
  const span = Math.max(120, Math.floor((start - aoc) / DAY) - 30);
  const fleet = Object.values(g.fleet);
  // Fleet block hours by family and month (index 0 = 12 months before the start month).
  const famBh = new Map<RatingFamily, number>();
  for (const ac of fleet) {
    const fam = typeOf(ac.typeId).family;
    if (!Object.values(g.crew).some((c) => c.ratings.includes(fam))) continue;
    famBh.set(fam, (famBh.get(fam) ?? 0) + 1);
  }
  // Crew sets per family (a set: the pilots, purser and cabin crew one aircraft flies with), before any walkout.
  const setsOf = new Map<RatingFamily, number>();
  for (const p of crewPlan(g)) {
    const cpt = p.roles.find((x) => x.role === 'CPT');
    const have = Object.values(g.crew).filter((c) => c.role === 'CPT' && c.ratings[0] === p.family).length;
    setsOf.set(p.family, Math.max(1, have / Math.max(1, cpt?.perSet ?? 1), (h.sets ?? 0) * p.aircraft));
  }
  const k0 = monthKey(start);
  const families = [...famBh.keys()];
  for (const c of Object.values(g.crew)) {
    // Seniority: a few founders from the AOC's first months, the rest spread since (newer more often).
    const u = next01(r);
    const days = chance(r, 0.12) ? span - int(r, 0, 60) : Math.round(60 + (span - 60) * u * u);
    c.hired = start - Math.max(60, days) * DAY;
    // Cabin crew of a mixed fleet are often rated on both families.
    if (!isPilot(c.role) && h.dual && families.length > 1 && chance(r, h.dual)) c.ratings = [c.ratings[0], ...families.filter((f) => f !== c.ratings[0])].slice(0, 3);
    const fam = c.ratings[0];
    const acN = famBh.get(fam) ?? 0;
    if (!acN) continue;
    // A set flies as one: each member logs about the family's block hours divided by its sets (the captains).
    const sets = setsOf.get(fam) ?? 1;
    const wide = fleet.some((a) => typeOf(a.typeId).family === fam && typeOf(a.typeId).body === 'wide');
    const logs = recentDuties(c.base, r, start, h.busy, wide);
    c.log = logs;
    const logged = new Map<number, number>();
    for (const e of logs) logged.set(monthKey(e.start), (logged.get(monthKey(e.start)) ?? 0) + e.block);
    const bm: Record<number, number> = {};
    const windowFrom = start - 28 * DAY;
    for (let i = 0; i < 12; i++) {
      const mk = k0 - 12 + i;
      const target = Math.round(((h.util[i] ?? 0) * acN * H) / sets * range(r, 0.82, 1.18));
      // The part of the month inside the four weeks of logged duties is what was logged; the rest at the target rate.
      const ms = monthStart(mk);
      const me = monthStart(mk + 1);
      const inWin = Math.max(0, Math.min(me, start) - Math.max(ms, windowFrom)) / (me - ms);
      bm[mk] = Math.round(target * (1 - inWin) + (logged.get(mk) ?? 0));
    }
    // The start month so far (a scenario that begins mid-month).
    if (logged.get(k0)) bm[k0] = logged.get(k0)!;
    // Before they joined: nothing.
    for (const k of Object.keys(bm)) if (monthStart(Number(k) + 1) <= c.hired) delete bm[Number(k)];
    c.blockMonths = bm;
    const y = yearOf(start);
    c.blockYearOf = y;
    c.blockYear = Object.entries(bm).filter(([k]) => yearOf(monthStart(Number(k))) === y).reduce((s, [, v]) => s + v, 0);
    const year = Object.values(bm).reduce((s, v) => s + v, 0) / H;
    c.totalHours = Math.round(Math.max(c.totalHours, year + (start - c.hired) / DAY / 365 * 650));
    if (logs.length) {
      const last = logs[logs.length - 1];
      c.restUntil = Math.min(c.restUntil, last.end + 12 * H);
      // Fatigue as the game keeps it: + the FDP hours of each duty, − 6 a day (the daily tick).
      let f = 0;
      for (let t = Math.floor(logs[0].start / DAY) * DAY; t < start; t += DAY) {
        for (const e of logs) if (e.start >= t && e.start < t + DAY) f = Math.min(100, f + Math.round(e.fdp / H));
        f = Math.max(0, f - 6);
      }
      c.fatigue = f;
    }
  }
}

const next01 = (r: Rng) => range(r, 0, 1);

/**
 * The last four weeks' duties, legal by construction: blocks of up to 4 working days and at least 2 days off, a report
 * between 06:30 and 09:30 local, at most 10 h of duty (narrowbody 2–4 sectors, widebody 1–2), nothing in the two days
 * before the start (an extended recovery rest with 2 local nights ends there). 7/14/28-day duty stays well under
 * 60/110/190 h and block under 100 h.
 */
function recentDuties(base: string, r: Rng, start: Minute, busy: number, wide: boolean): DutyLogEntry[] {
  const out: DutyLogEntry[] = [];
  if (busy <= 0) return out;
  const off = localOffset(base, start);
  // Local midnight of the day 27 days before the start, to the day 3 days before.
  const day0 = Math.floor((start + off) / DAY) * DAY - off;
  let d = -27 + int(r, 0, 3);
  while (d <= -3) {
    const on = wide ? int(r, 2, 3) : int(r, 3, 4);
    for (let k = 0; k < on && d <= -3; k++, d++) {
      if (!chance(r, busy)) continue;
      const report = day0 + d * DAY + int(r, 13, 19) * 30;
      const duty = wide ? int(r, 18, 24) * 30 : int(r, 14, 20) * 30;
      const sectors = wide ? int(r, 1, 2) : int(r, 2, 4);
      const block = Math.round((duty - 90 - (sectors - 1) * 45) * range(r, 0.85, 1));
      out.push({ start: report, end: report + duty, fdp: duty - 30, block: Math.max(60, block), sectors, augmented: false, disruptive: false });
    }
    // Days off between the blocks (widebody: the long trips' rest at home).
    d += wide ? int(r, 3, 4) : int(r, 2, 3);
  }
  return out;
}

// ---------- the statements ----------

/** A year of closed months: revenue and costs by line from the fleet, its flying and the crew; cash along a path to the start. */
function seedStatements(g: GameState, h: ScenarioHistory, r: Rng, start: Minute): void {
  const k0 = monthKey(start);
  const fleet = Object.values(g.fleet).filter((a) => Object.values(g.crew).some((c) => c.ratings.includes(typeOf(a.typeId).family)));
  const months: MonthStatement[] = [];
  for (let i = 0; i < 12; i++) {
    const mk = k0 - 12 + i;
    const ms = monthStart(mk);
    if (monthStart(mk + 1) <= g.company.aocAt!) continue;
    const lines: Partial<Record<LedgerCat, number>> = {};
    const add = (cat: LedgerCat, v: number) => {
      if (Math.round(v)) lines[cat] = (lines[cat] ?? 0) + Math.round(v);
    };
    let bh = 0;
    for (const ac of fleet) {
      const t = ACMI_TYPES[ac.typeId];
      const b = Math.round((h.util[i] ?? 0) * range(r, 0.9, 1.1));
      bh += b;
      const ch = b * h.charter;
      add('acmiRevenue', (b - ch) * t.rateBH * range(r, 1.02, 1.12));
      add('charterRevenue', ch * t.rateBH * range(r, 1.85, 2.05));
      add('fuel', -ch * t.fuelTBH * BAL.fuelPrice * range(r, 0.95, 1.08));
      add('airportFees', -ch * t.rateBH * 0.06);
      add('maintenance', -b * t.maintBH * range(r, 0.78, 0.9));
      if (ac.ownership.kind === 'dryLeaseIn') {
        add('rent', -ac.ownership.rentPerMonth);
        add('reserves', -b * 0.92 * ac.ownership.reservesPerFH);
      }
      add('insurance', -insuranceOf(g, ac));
      add('perDiem', -b * (t.body === 'wide' ? 260 : 150));
      add('hotels', -b * (25 + 60 * h.charter));
      // The heavy check in the month it was done.
      if (monthKey(ac.maint.lastC) === mk) add('checks', -(t.cCheck ?? 0));
    }
    add('overhead', -(BAL.overheadBase + BAL.overheadPerAircraft * fleet.length));
    const crew = Object.values(g.crew).filter((c) => c.hired < ms + 15 * DAY);
    add('salaries', -crew.reduce((s, c) => s + c.salary, 0));
    add('training', -crew.length * range(r, 60, 140));
    if (i % 4 === 1) add('hiring', -int(r, 2, 6) * 2_000);
    months.push({ month: mk, lines, bh, cashStart: 0, cashEnd: 0, closed: true });
  }
  // The year's result at the scenario's margin: the rates the airline achieved (its own clients, its own season).
  const REV: LedgerCat[] = ['acmiRevenue', 'charterRevenue'];
  let rev = 0;
  let cost = 0;
  for (const m of months) for (const [k, v] of Object.entries(m.lines) as [LedgerCat, number][]) if (REV.includes(k)) rev += v; else cost += v;
  const k = rev > 0 ? Math.max(0.5, Math.min(1.5, -cost / (rev * (1 - h.margin)))) : 1;
  for (const m of months) for (const c of REV) if (m.lines[c]) m.lines[c] = Math.round(m.lines[c]! * k);
  // Money owed to us (Cash Crunch): already invoiced, booked in the last months it was earned (the current month starts clean).
  const cur = g.finance.current;
  const owed = cur.lines.otherRevenue ?? 0;
  const late = months.slice(-3);
  if (owed && late.length) {
    for (const m of late) m.lines.otherRevenue = (m.lines.otherRevenue ?? 0) + Math.round(owed / late.length);
    delete cur.lines.otherRevenue;
  }
  // Cash: from cash0 to the start's cash, rising and falling with the months' results (the rest went to the owners,
  // the bank and the lessors' deposits). An overdraft pays interest.
  const profits = months.map((m) => statementTotals(m.lines).profit);
  const avg = profits.reduce((s, v) => s + v, 0) / Math.max(1, profits.length);
  const drift = (cur.cashStart - h.cash0) / Math.max(1, months.length);
  let cash = h.cash0;
  months.forEach((m, i) => {
    m.cashStart = Math.round(cash);
    cash += 0.55 * (profits[i] - avg) + drift;
    m.cashEnd = Math.round(cash);
  });
  // The last month ends exactly where the scenario starts.
  if (months.length) {
    const last = months[months.length - 1];
    last.cashEnd = cur.cashStart;
    for (const m of months) if (Math.min(m.cashStart, m.cashEnd) < 0) m.lines.interest = Math.round(Math.min(m.cashStart, m.cashEnd) * 0.011);
  }
  g.finance.history = months;
}

// ---------- completed jobs and the clients ----------

function patternOf(j: PastJob, s: Minute, e: Minute): SchedulePattern {
  if (j.kind === 'wet') {
    const [base, dests] = j.route.split('>');
    return { kind: 'base', base, dests: (dests ?? '').split(',').filter(Boolean), from: s, to: e, targetBH: Math.round((j.bh / Math.max(1, j.days)) * 30), waves: [420, 840], prefix: 'XX', maintEvery: 7 };
  }
  const legs = j.route.split(',');
  const step = legs.length > 1 ? (e - s - DAY) / (legs.length - 1) : 0;
  return { kind: 'legs', legs: legs.map((x, i) => { const [from, to] = x.split('-'); return { from, to, dep: Math.round(s + 10 * H + i * step), flightNo: '' }; }) };
}

/** Completed contracts (closed, no flights) and what the clients remember: jobs, relation, level, the last notes. */
function seedJobs(g: GameState, h: ScenarioHistory, start: Minute): void {
  const ids = Object.keys(g.fleet);
  const byName = new Map(Object.values(g.clients).map((c) => [c.name, c]));
  let color = 0;
  for (const j of h.past) {
    const cl = byName.get(j.client);
    if (!cl) continue;
    const s = at(j.start);
    const e = Math.min(start - DAY, s + j.days * DAY);
    const acId = ids[j.ac] ?? ids[0];
    const t = ACMI_TYPES[g.fleet[acId]?.typeId ?? 'a320ceo'];
    const value = Math.round(j.bh * t.rateBH * (j.kind === 'wet' ? 1.05 : 1.95));
    const legs = Math.max(2, Math.round(j.bh / (t.body === 'wide' ? 5.5 : 2.2)));
    const k: Contract = {
      id: nextId(g, 'k'), offerId: '', archetype: j.arch, clientId: cl.id, title: j.title,
      product: j.kind === 'wet'
        ? { kind: 'wet', ratePerBH: Math.round(t.rateBH * 1.05 / 10) * 10, mghPerMonth: Math.round((j.bh / Math.max(1, j.days)) * 30 * 0.85), excessRate: 0.95, cycleFee: 900, positioningBillable: true }
        : { kind: 'charter', price: value, depositPct: 0.3, balanceDaysBefore: 14, fuelEscalation: false },
      pattern: patternOf(j, s, e),
      requirements: { minSeats: Math.min(180, g.fleet[acId]?.cabin.total ?? 180), longestSectorNm: 0, minRunwayM: 0, etops: 0, approvals: [], extraCabin: 0 },
      penalties: { cancelScale: [[0, 1]], perDelay: 0, perCancelledLeg: 0 },
      payment: { basis: j.kind === 'wet' ? 'arrears' : 'onCompletion', dueDays: 14, depositPct: j.kind === 'wet' ? 0 : 0.3 },
      effects: {}, aircraftIds: [acId], start: s, end: e, signed: s - 30 * DAY, status: 'completed',
      generatedUntil: e, use: {}, billedMonths: [], color: color++ % 8, balanceAt: null,
      invoiced: value, accrued: value, legsFlown: legs, legsOnTime: Math.round(legs * h.onTime / 100),
    };
    g.contracts[k.id] = k;
    cl.jobs = (cl.jobs ?? 0) + 1;
    cl.firstJob = Math.min(cl.firstJob ?? e, e);
    cl.lastJob = Math.max(cl.lastJob ?? e, e);
    (cl.log ??= []).push([e, 4, `Completed: ${j.title}`]);
    cl.log.sort((a, b) => a[0] - b[0]);
    if (cl.log.length > 8) cl.log.splice(0, cl.log.length - 8);
    // The scenario's tally never counts them as its own.
    if (g.scen) (g.scen.doneIds ??= []).push(k.id);
  }
  for (const [name, rel] of h.rel) {
    const cl = byName.get(name);
    if (!cl) continue;
    cl.relation = rel;
    // A client we know without a listed job: older work with them; a close one has given us several (Trusted needs 2
    // jobs, Partner 4).
    if (!cl.jobs && rel > 0) cl.firstJob = cl.lastJob = start - int({ rng: rel * 131 + 7 }, 120, 600) * DAY;
    const want = rel >= 60 ? 4 : rel >= 30 ? 2 : rel > 0 ? 1 : 0;
    if ((cl.jobs ?? 0) < want) {
      cl.jobs = want;
      cl.firstJob = Math.min(cl.firstJob ?? start, start - 700 * DAY);
    }
    cl.level = levelFor(g, cl, undefined);
  }
}

// ---------- the record: counters, dispatch reliability, on time by month ----------

function seedRecord(g: GameState, h: ScenarioHistory, r: Rng, start: Minute): void {
  const st = g.stats;
  const fleet = Object.values(g.fleet);
  const years = (start - g.company.aocAt!) / (365 * DAY);
  const avgUtil = h.util.reduce((s, v) => s + v, 0) / h.util.length;
  const wideShare = fleet.filter((a) => typeOf(a.typeId).body === 'wide').length / Math.max(1, fleet.length);
  const sector = 2.2 + wideShare * 3.6;
  // A smaller fleet in the early years: about 70 % of today's over the AOC's life.
  const lifeBh = avgUtil * 12 * years * fleet.length * 0.7;
  st.blockMin = Math.round(lifeBh * H);
  st.legs = Math.round(lifeBh / sector);
  st.departures = st.legs;
  st.onTime = Math.round(st.legs * h.onTime / 100);
  st.cancelled = Math.round(st.legs * 0.004);
  st.delayed = st.legs - st.onTime - st.cancelled;
  st.contractsDone = h.jobs;
  st.aogs = Math.round(years * fleet.length * (100 - h.tech) * 0.9);
  st.augmentedDuties = g.company.approvals.includes('augmented') ? Math.round(st.legs * 0.2) : 0;
  st.bestMonthProfit = Math.max(0, ...g.finance.history.map((m) => statementTotals(m.lines).profit));
  // Months: departures and those on time (Clockwork, the bot's record), crew coverage, the year's results.
  const v9 = (st.v09 ??= { legalStreak: 0, cover: {}, slips: 0, oohRed: 0, oohAmber: 0, discretionUsed: 0, discretionRefused: 0, headHandled: 0, headMistakes: 0, jumboLoads: 0, lateGovPaid: 0, cOnTime: 0 });
  v9.onTimeM ??= {};
  const tech: Record<number, [number, number]> = {};
  const today = Math.floor(start / DAY);
  for (const m of g.finance.history) {
    const deps = Math.round(m.bh / sector);
    if (!deps) continue;
    const ot = Math.round(deps * Math.min(99, h.onTime + range(r, -3, 3)) / 100);
    v9.onTimeM[m.month] = [deps, ot];
    v9.cover[m.month] = [deps, Math.round(deps * range(r, 0, 0.01))];
    const d0 = Math.floor(monthStart(m.month) / DAY);
    const n = daysInMonth(m.month);
    const fails = Math.round(deps * (100 - h.tech) / 100);
    for (let d = 0; d < n; d++) if (d0 + d < today) (tech[d0 + d] ??= [0, 0])[0] += deps / n;
    for (let f = 0; f < fails; f++) {
      const day = d0 + int(r, 0, n - 1);
      if (day < today) (tech[day] ??= [0, 0])[1] += 1;
    }
  }
  st.techDisp = Object.fromEntries(Object.entries(tech).filter(([k]) => Number(k) >= today - 366).map(([k, v]) => [k, [Math.round(v[0] * 100) / 100, Math.min(v[1], Math.ceil(v[0]))]]));
  // v0.19.4 the same record by aircraft (the ETOPS fleet's record): departures shared evenly, each failure on one aircraft in turn.
  const acs = fleet.map((a) => a.id).sort();
  if (acs.length) {
    const byAc: Record<string, Record<number, [number, number]>> = {};
    const fails: NonNullable<typeof st.techFails> = [];
    let turn = 0;
    for (const [k, [d, f]] of Object.entries(st.techDisp)) {
      const day = Number(k);
      for (const id of acs) ((byAc[id] ??= {})[day] = [Math.round((d / acs.length) * 100) / 100, 0]);
      for (let i = 0; i < f; i++) {
        const id = acs[turn++ % acs.length];
        byAc[id][day][1]++;
        byAc[id][day][0] = Math.max(byAc[id][day][0], byAc[id][day][1]);
        fails.push({ t: day * DAY + 12 * H, ac: id, no: '', cause: 'defect' });
      }
    }
    st.techAc = byAc;
    st.techFails = fails.sort((a, b) => a.t - b.t);
    st.techAcSince = (today - 366) * DAY;
  }
  v9.legalStreak = Math.round(st.legs * 0.15);
  v9.lastOverdue = g.company.aocAt;
  v9.lastCancel = start - int(r, 20, 140) * DAY;
  v9.cOnTime = Math.max(v9.cOnTime, Math.floor(years));
  if (st.v08) st.v08.levelUps = Object.values(g.clients).filter((c) => c.level === 'trusted' || c.level === 'partner').length;
  // Hajj experience (the Hajj airlift), evacuations and repatriations flown home (the humanitarian work).
  for (const j of h.past) {
    if (j.arch === 'hajj') v9.hajjDone = (v9.hajjDone ?? 0) + 1;
    if (j.arch === 'evacuation' || j.arch === 'repatriation') v9.homeSafe = (v9.homeSafe ?? 0) + 1;
  }
  // The authority's yearly audit: the last one five weeks ago (a level 1 finding or two, closed), the next a year on
  // (none falls inside a scenario).
  const audit = g.opsx?.audit;
  if (audit && !audit.last) {
    const last = start - 35 * DAY;
    audit.last = last;
    audit.history = [[last, int(r, 0, 2), 0]];
    audit.next = last + 365 * DAY;
  }
  // The yearly results so far (the bot's and Company's year line).
  const yn: Record<number, number> = {};
  for (const m of g.finance.history) yn[Math.floor(m.month / 12)] = (yn[Math.floor(m.month / 12)] ?? 0) + statementTotals(m.lines).profit;
  v9.yearNet = yn;
}

// ---------- achievements and goals already earned ----------

/** What the record already earns, dated before the start, silently (the heads they unlock wait on Company › Team). */
function seedEarned(g: GameState, start: Minute): void {
  const got = checkAchievements(g, { monthEnd: true, silent: true });
  const aoc = g.company.aocAt!;
  // A widebody that comes with the scenario (Long-Haul Debut's A330) is today's news.
  const newWide = Object.values(g.fleet).some((a) => typeOf(a.typeId).body === 'wide' && !Object.values(g.crew).some((c) => c.ratings.includes(typeOf(a.typeId).family)));
  got.forEach((id, i) => {
    g.achievements![id] = id === 'widebody' && newWide ? start : Math.max(aoc + 30 * DAY, start - (40 + ((i * 97) % 600)) * DAY);
  });
  for (const hd of Object.values(g.heads ?? {})) if (hd.unlockedAt !== null && hd.unlockedAt >= start) hd.unlockedAt = start - 30 * DAY;
  for (const goal of g.goals) {
    const def = GOALS.find((x) => x.id === goal.id);
    if (def && goal.done === null && def.progress(g) >= 1) goal.done = Math.max(aoc + 60 * DAY, start - 200 * DAY);
  }
}

/** Airports a past job names that do not exist (scenario.test checks every scenario's data). Pure. */
export function unknownAirports(j: PastJob): string[] {
  return j.route.replace('>', ',').split(',').flatMap((x) => x.split('-')).filter((x) => !AIRPORT_BY_CODE[x]);
}
