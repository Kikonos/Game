// BLOCK HOURS headless year (DESIGN.md §7.3): a new Startup game (Lisbon, 2× A320ceo) played by a simple,
// sensible policy, with a monthly table and the balance targets.
//   npx tsx scripts/acmi-bot.ts [seed] [days]        one game (default seed 1, 365 days)
//   npx tsx scripts/acmi-bot.ts [seed] --det         determinism: same seed twice to day 180, and save/load at day 90
//
// Policy (a pure function of the game state, so a loaded save plays on identically):
// - offers: base deployments first, then ad hoc fill-ins; accept the best ok/warn feasibility with a positive
//   margin (crew shortfalls only when hires join in time); counter long-lead base deals at +5% once;
// - crew: fill staffing, hire one more set when the family's pilots fly > 80% of productive hours;
// - maintenance: C-checks booked when warned, in the first free window (winter first); A-checks auto;
// - decisions: swap aircraft on AOG when one is free, factor a late invoice when cash is short, else the default;
// - fleet: lease a widebody once the cash covers its deposit, three months of its fixed costs and a cushion, the last
//   quarter was profitable and a big widebody job starts after delivery.

import LZString from 'lz-string';
import { BAL } from '../src/engine/core/balance';
import { statementTotals } from '../src/engine/core/ledger';
import { complement, typeOf } from '../src/engine/core/perf';
import { DAY, dayIndex, fmtMonth, fromUTC, monthKey, toDate } from '../src/engine/core/time';
import type { RatingFamily } from '../src/data/acmiTypes';
import type { Archetype, ContractOffer, GameState, LedgerCat, MonthKey, Role } from '../src/engine/core/types';
import { acceptOffer, counterOffer, feasibilityAll, type FeasibilityReport } from '../src/engine/contracts';
import { hireCrew, staffing } from '../src/engine/crew';
import { devFleet } from '../src/engine/dev';
import { createGame } from '../src/engine/newGame';
import { acquireAircraft, checkStatus, groundGaps, resolveDecision, scheduleCheck } from '../src/engine/ops';
import { deserialize, serialize } from '../src/engine/save';
import { advanceTo, settle } from '../src/engine/sim';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const seed = Number(args[0] ?? 1);
const days = Number(args[1] ?? 365);
const DET = process.argv.includes('--det');
const BIG = process.argv.includes('--big');
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
}
const newTally = (): Tally => ({ actions: new Map(), decisions: new Map(), decMonth: new Map(), decKinds: new Map(), accepted: 0, countered: 0, firstAccept: null, wideAffordableAt: null, wideReadyAt: null, wideSigned: null, longLead: 0 });

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
    if (resolveDecision(g, d.id, opt).ok || resolveDecision(g, d.id, d.defaultOption).ok) {
      act(g, t);
      t.decisions.set(weekOf(g), (t.decisions.get(weekOf(g)) ?? 0) + 1);
      t.decMonth.set(monthKey(g.now), (t.decMonth.get(monthKey(g.now)) ?? 0) + 1);
      t.decKinds.set(`${d.kind}:${opt}`, (t.decKinds.get(`${d.kind}:${opt}`) ?? 0) + 1);
    }
  }
}

function hireFor(g: GameState, t: Tally, r: FeasibilityReport): void {
  const family = typeOf(g.fleet[r.aircraftId].typeId).family;
  for (const [role, cap] of Object.entries(r.crew.byRole)) {
    if (cap && cap.short > 0 && hireCrew(g, { role: role as Role, family, base: g.company.homeBase, count: Math.min(30, cap.short) }).ok) act(g, t);
  }
}

/** The best workable report for an offer, or null. */
function bestFit(g: GameState, o: ContractOffer): FeasibilityReport | null {
  return (
    feasibilityAll(g, o.id).find((r) => {
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
  for (const o of open) {
    const span = Math.max(1, (o.end - o.start) / DAY);
    if (span > 10 && o.estBH / span < 3) continue;
    // Ad hoc work inside three weeks; tour series and troop rotations (booked months ahead) up to 90 days out.
    const longLead = o.archetype === 'tourSeries' || o.archetype === 'troopRotation';
    if (!isBase(o) && o.start > g.now + (longLead ? 90 : 21) * DAY) continue;
    const best = bestFit(g, o);
    if (!best) continue;
    // A long-lead base deal is worth one counter at +5%; a refusal reopens it at the asking price.
    if (isBase(o) && !o.counter && o.product.kind === 'wet' && o.start > g.now + 14 * DAY && o.expires > g.now + 36 * 60) {
      if (counterOffer(g, o.id, o.product.ratePerBH * 1.05, [best.aircraftId]).ok) {
        t.countered++;
        act(g, t);
        continue;
      }
    }
    hireFor(g, t, best);
    if (acceptOffer(g, o.id, [best.aircraftId]).ok) {
      t.accepted++;
      if (longLead) t.longLead++;
      t.firstAccept ??= g.now;
      act(g, t);
    }
  }
}

/** Crew trouble in the inbox over the last two weeks (legs sub-chartered or cancelled for want of a legal crew). */
const crewTrouble = (g: GameState) => g.messages.filter((m) => m.cat === 'crew' && m.tone !== 'info' && m.t > g.now - 14 * DAY && /sub-chartered|cancelled/.test(m.title)).length;

/** Fill staffing; one more set per family when its pilots run hot or crew trouble keeps costing legs, and nobody is joining. */
function hire(g: GameState, t: Tally): void {
  for (const l of staffing(g)) {
    if (l.have < l.need && hireCrew(g, { role: l.role, family: l.family, base: g.company.homeBase, count: Math.min(30, l.need - l.have) }).ok) act(g, t);
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
 * and crew hiring; that job is then taken as soon as the aircraft can fly it.
 */
function fleet(g: GameState, t: Tally): void {
  if (Object.values(g.fleet).some((a) => typeOf(a.typeId).body === 'wide')) return;
  const recent = g.finance.history.slice(-3);
  const earning = recent.length === 3 && recent.reduce((s, st) => s + statementTotals(st.lines).profit, 0) > 0;
  for (const o of g.market.aircraft) {
    if (typeOf(o.typeId).body !== 'wide' || o.kind !== 'dryLeaseIn') continue;
    // Acquirable (the target): deposit plus three months of rent and insurance, with $1M left to run the airline.
    if (g.company.cash >= o.deposit + 3 * (o.rentPerMonth + typeOf(o.typeId).insuranceMonth) + 1_000_000) t.wideAffordableAt ??= g.now;
    if (g.company.cash < o.deposit + 3 * wideMonth(o.rentPerMonth, o.typeId, o.cabin.total) + 1_500_000) continue;
    t.wideReadyAt ??= g.now;
    const job = Object.values(g.offers).find(
      (x) => x.status === 'open' && x.estValue >= 2_500_000 && x.product.kind === 'wet' && x.end - x.start >= 75 * DAY && x.start > g.now + (o.leadDays + 30) * DAY && (x.requirements.body === 'wide' || x.requirements.minSeats > 220) &&
        o.cabin.total >= x.requirements.minSeats && (!x.requirements.families?.length || x.requirements.families.includes(typeOf(o.typeId).family)),
    );
    if (!earning || !job) continue;
    if (acquireAircraft(g, o.id).ok) {
      t.wideSigned = g.now;
      act(g, t);
      hire(g, t);
    }
    return;
  }
}

/** One policy pass after each clock step; the daily jobs run once per game day. */
function policy(g: GameState, t: Tally, urgent: boolean, newDay: boolean): void {
  decide(g, t);
  if (newDay) {
    hire(g, t);
    checks(g, t);
    fleet(g, t);
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

function onStep(): void {
  const m = mon(monthKey(g.now));
  for (const o of Object.values(g.offers)) seenOffer.add(o.id);
  // Inbox is newest first: count down to the last message seen.
  let n = 0;
  for (const x of g.messages) {
    if (x.id === lastMsgId) break;
    n++;
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

const CODE: Partial<Record<Archetype, string>> = { seasonBase: 'SB', aogCover: 'AC', adhoc: 'AH', sports: 'SP', repatriation: 'RP', tourSeries: 'TS', troopRotation: 'TR', evacuation: 'EV' };
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

const targets: [string, boolean, string][] = [
  ['no exceptions, no NaN/Infinity', errors.length === 0, errors.length ? errors[0].split('\n')[0] : 'clean'],
  ['solvent all year (no game over)', !g.gameOver, g.gameOver ? g.gameOver.reason : `month-end low ${k$(minCash)}, end ${k$(g.company.cash)}`],
  ['summer BH per aircraft 180–320', summerBH >= 180 && summerBH <= 320, summerBH.toFixed(0)],
  ['year net margin −5%…+12%', margin >= -0.05 && margin <= 0.12, `${(margin * 100).toFixed(1)}% (${k$(profitY)} on ${k$(revenueY)})`],
  ['no illegal duties flown (FDP + crew)', illegalOf(s) === 0, `${illegalOf(s)} (FDP ${s.illegalFlown ?? 0}, crew ${s.illegalCrewFlown ?? 0})`],
  ['< 2% flights uncovered at departure', uncShare < 0.02, `${(uncShare * 100).toFixed(2)}% of ${s.departures ?? 0}`],
  ['≥ 1 meaningful action per week', totalActions / weeks >= 1 && activeWeeks / weeks >= 0.8, `${(totalActions / weeks).toFixed(1)}/wk, ${activeWeeks}/${weeks} weeks${idle.length ? ` (idle: ${idle.join(' ')})` : ''}`],
  ['≤ 3 decisions per week', maxDec <= 3, `max ${maxDec}, ${[...tally.decisions.values()].reduce((a, b) => a + b, 0)} answered`],
  ['≥ 30 offers per year', seenOffer.size * (365 / days) >= 30, String(seenOffer.size)],
  ['first contract within 7 days', tally.firstAccept !== null && tally.firstAccept - g.started <= 7 * DAY, dayOf(tally.firstAccept)],
  ['widebody acquirable within 12 months', tally.wideAffordableAt !== null && tally.wideAffordableAt - g.started <= 365 * DAY, `${dayOf(tally.wideAffordableAt)}; with crew costs ${dayOf(tally.wideReadyAt)}; signed ${dayOf(tally.wideSigned)}`],
  ['1–3 AOGs per aircraft-year', aogRate >= 0.995 && aogRate <= 3.005, `${aogRate.toFixed(2)} (${s.aogs ?? 0} in ${acYears.toFixed(1)} ac-yr)`],
  ['governments mostly pay late (≥ 3 invoices)', gov.length < 3 || govLate / gov.length >= 0.5, `${govLate}/${gov.length} invoices late`],
  ['save < 300 KB (and with 10 aircraft)', saveKB < 300 && bigKB < 300, `peak ${saveKB.toFixed(0)} KB (compress ${saveMs.toFixed(0)} ms), with 10 aircraft ${bigKB.toFixed(0)} KB (${bigNote})`],
  ['runs in < 10 s', runSecs < 10, `${runSecs.toFixed(1)} s`],
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
console.log('\ntargets');
for (const [name, ok, val] of targets) console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(38)} ${val}`);
process.exitCode = errors.length ? 2 : targets.every((c) => c[1]) ? 0 : 1;
