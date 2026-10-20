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
// - fleet: lease a widebody once the cash covers its deposit plus three months of the bigger fleet's fixed costs.

import LZString from 'lz-string';
import { BAL } from '../src/engine/core/balance';
import { statementTotals } from '../src/engine/core/ledger';
import { complement, typeOf } from '../src/engine/core/perf';
import { DAY, dayIndex, fmtMonth, monthKey, toDate } from '../src/engine/core/time';
import type { RatingFamily } from '../src/data/acmiTypes';
import type { Archetype, ContractOffer, GameState, LedgerCat, MonthKey, Role } from '../src/engine/core/types';
import { acceptOffer, counterOffer, feasibilityAll, type FeasibilityReport } from '../src/engine/contracts';
import { hireCrew, staffing } from '../src/engine/crew';
import { devFleet } from '../src/engine/dev';
import { createGame } from '../src/engine/newGame';
import { acquireAircraft, checkStatus, fixedCosts, groundGaps, resolveDecision, scheduleCheck } from '../src/engine/ops';
import { deserialize, serialize } from '../src/engine/save';
import { advanceTo } from '../src/engine/sim';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const seed = Number(args[0] ?? 1);
const days = Number(args[1] ?? 365);
const DET = process.argv.includes('--det');
const STEP = 6 * 60;

const newGame = () => createGame({ name: 'Atlântica Wings', code: 'AW', livery: { primary: '#0b1f4d', secondary: '#f5c451', tail: 'sweep' }, base: 'LIS', seed });

// ---------- policy (pure in g) ----------

/** Per-run tallies the policy reports into (never read by the policy). */
interface Tally {
  actions: Map<number, number>;
  decisions: Map<number, number>;
  accepted: number;
  countered: number;
  firstAccept: number | null;
  wideAffordableAt: number | null;
  wideSigned: number | null;
}
const newTally = (): Tally => ({ actions: new Map(), decisions: new Map(), accepted: 0, countered: 0, firstAccept: null, wideAffordableAt: null, wideSigned: null });

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
      return !crew || crew.level === 'ok' || (r.crew.firstShort !== null && r.crew.firstShort > g.now + 50 * DAY);
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
    if (!isBase(o) && o.start > g.now + 21 * DAY) continue;
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
      t.firstAccept ??= g.now;
      act(g, t);
    }
  }
}

/** Fill staffing; one more set per family when its pilots run hot and nobody is joining. */
function hire(g: GameState, t: Tally): void {
  for (const l of staffing(g)) {
    if (l.have < l.need && hireCrew(g, { role: l.role, family: l.family, base: g.company.homeBase, count: Math.min(30, l.need - l.have) }).ok) act(g, t);
  }
  const fams = new Map<RatingFamily, { typeId: string; seats: number }>();
  for (const ac of Object.values(g.fleet)) if (ac.status !== 'delivering') fams.set(typeOf(ac.typeId).family, { typeId: ac.typeId, seats: ac.cabin.total });
  for (const [family, x] of fams) {
    if (pilotUtil(g, family) < 0.8 || g.company.cash < 1_000_000) continue;
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

/** Monthly fixed costs with one more aircraft: rent, insurance, overhead, salaries (5 new sets at widebody pay). */
function fixedWith(g: GameState, rent: number, typeId: string, seats: number): number {
  const fc = fixedCosts(g, monthKey(g.now));
  const sal = Object.values(g.crew).reduce((s, c) => s + c.salary, 0);
  const sets = complement(typeId, seats).reduce((s, r) => s + (BAL.salary[r]?.[1] ?? 3_000), 0) * BAL.crewSetsPerAircraft;
  return fc.rent + fc.insurance + fc.overhead + (sal + sets) * (1 + BAL.onCosts) + rent + typeOf(typeId).insuranceMonth + BAL.overheadPerAircraft;
}

function fleet(g: GameState, t: Tally): void {
  if (Object.values(g.fleet).some((a) => typeOf(a.typeId).body === 'wide')) return;
  for (const o of g.market.aircraft) {
    if (typeOf(o.typeId).body !== 'wide' || o.kind !== 'dryLeaseIn') continue;
    if (g.company.cash < o.deposit + 3 * fixedWith(g, o.rentPerMonth, o.typeId, o.cabin.total)) continue;
    t.wideAffordableAt ??= g.now;
    if (monthKey(g.now) - monthKey(g.started) < 3) continue;
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
  const a = stateJson(runTo(180));
  const b = stateJson(runTo(180));
  const h = runTo(90);
  const g2 = deserialize(serialize(h));
  play(g2, newTally(), g2.started + 180 * DAY);
  const c = stateJson(g2);
  const diff = (x: string, y: string) => {
    let i = 0;
    while (i < x.length && x[i] === y[i]) i++;
    return x === y ? 'identical' : `differ at char ${i}: …${x.slice(Math.max(0, i - 120), i + 60)}… vs …${y.slice(Math.max(0, i - 120), i + 60)}…`;
  };
  console.log(`BLOCK HOURS determinism, seed ${seed} (${((performance.now() - wall) / 1000).toFixed(1)} s)`);
  console.log(`  two runs to day 180:            ${diff(a, b)} (${(a.length / 1024).toFixed(0)} KB JSON)`);
  console.log(`  save/load at day 90 → day 180:  ${diff(a, c)}`);
  process.exit(a === b && a === c ? 0 : 1);
}

// ---------- the year ----------

interface Month {
  legs: number;
  cancelled: number;
  crewBH: number;
  dec: number;
  msgs: number;
  aogs: number;
  illegal: number;
}
const months = new Map<MonthKey, Month>();
const mon = (k: MonthKey): Month => {
  let m = months.get(k);
  if (!m) months.set(k, (m = { legs: 0, cancelled: 0, crewBH: 0, dec: 0, msgs: 0, aogs: 0, illegal: 0 }));
  return m;
};

const wall = performance.now();
const g = newGame();
const tally = newTally();
const end = g.started + days * DAY;
const seenFlight = new Set<string>();
const seenDecision = new Set<string>();
const seenOffer = new Set<string>();
const cancels = new Map<string, number>();
const errors: string[] = [];
let msgCount = 0;
let lastMsgId = g.messages[0]?.id;
let prev = { aogs: 0, illegal: 0 };
let acYears = 0;
let saveRaw = 0;
let saveKB = 0;
let saveMs = 0;
let lastDay = dayIndex(g.now);

function onStep(): void {
  const m = mon(monthKey(g.now));
  for (const o of Object.values(g.offers)) seenOffer.add(o.id);
  for (const d of g.decisions) {
    if (seenDecision.has(d.id)) continue;
    seenDecision.add(d.id);
    m.dec++;
  }
  // Inbox is newest first: count down to the last message seen.
  let n = 0;
  for (const x of g.messages) {
    if (x.id === lastMsgId) break;
    n++;
  }
  lastMsgId = g.messages[0]?.id;
  m.msgs += n;
  msgCount += n;
  for (const f of Object.values(g.flights)) {
    if (f.kind === 'deadhead' || seenFlight.has(f.id)) continue;
    if (f.status === 'done') {
      seenFlight.add(f.id);
      const fm = mon(monthKey(f.ata ?? f.sta));
      if (f.kind === 'revenue') fm.legs++;
      fm.crewBH += (f.crewIds.length * ((f.ata ?? f.sta) - (f.atd ?? f.std))) / 60;
    } else if (f.status === 'cancelled') {
      seenFlight.add(f.id);
      if (f.kind === 'revenue' || f.kind === 'techstop') mon(monthKey(f.std)).cancelled++;
      const key = `${f.delayReason ?? '?'} (${f.kind})`;
      cancels.set(key, (cancels.get(key) ?? 0) + 1);
    }
  }
  const s = g.stats;
  m.aogs += (s.aogs ?? 0) - prev.aogs;
  m.illegal += (s.illegalFlown ?? 0) - prev.illegal;
  prev = { aogs: s.aogs ?? 0, illegal: s.illegalFlown ?? 0 };
  if (dayIndex(g.now) === lastDay) return;
  lastDay = dayIndex(g.now);
  acYears += Object.values(g.fleet).filter((a) => a.status !== 'delivering').length / 365;
  if (toDate(g.now).getUTCDate() !== 1) return;
  // Save size: compressed whenever the raw save is 10% past the last measured peak (bounded cost).
  const raw = serialize(g);
  if (raw.length > saveRaw * 1.1) {
    const t0 = performance.now();
    saveKB = Math.max(saveKB, (LZString.compressToUTF16(raw).length * 2) / 1024);
    saveMs = Math.max(saveMs, performance.now() - t0);
    saveRaw = raw.length;
  }
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
const monthStart = (k: MonthKey) => Date.UTC(Math.floor(k / 12), k % 12, 1) / 60_000;
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
console.log('month       cash  revenue   profit  BH/ac  wet BH/MGH  contracts        legs canc ill util  AOG mxd  dec/msg goals');
let revenueY = 0;
let profitY = 0;
let bhSummer = 0;
let nSummer = 0;
const lines = new Map<LedgerCat, number>();
for (const st of g.finance.history) {
  const { revenue, profit } = statementTotals(st.lines);
  revenueY += revenue;
  profitY += profit;
  for (const [c, v] of Object.entries(st.lines)) lines.set(c as LedgerCat, (lines.get(c as LedgerCat) ?? 0) + (v ?? 0));
  const m = mon(st.month);
  const fleetN = Object.values(g.fleet).filter((a) => a.deliveredAt < monthStart(st.month + 1)).length || 2;
  const bhAc = st.bh / fleetN;
  if ([5, 6, 7, 8].includes(st.month % 12)) {
    bhSummer += bhAc;
    nSummer++;
  }
  console.log(
    `${fmtMonth(st.month).padEnd(8)}${pad(k$(st.cashEnd), 8)}${pad(k$(revenue), 9)}${pad(k$(profit), 9)}${pad(bhAc.toFixed(0), 7)}${pad(mghOf(st.month), 12)}  ${contractsIn(st.month).padEnd(15)}` +
      `${pad(m.legs, 6)}${pad(m.cancelled, 5)}${pad(m.illegal, 4)}${pad(`${Math.round((100 * m.crewBH) / Math.max(1, crewCap(st.month)))}%`, 5)}${pad(m.aogs, 5)}${pad(maintDays(st.month).toFixed(0), 4)}${pad(`${m.dec}/${m.msgs}`, 9)}${pad(goalsBy(monthStart(st.month + 1)), 6)}`,
  );
}

const t0 = performance.now();
const finalRaw = serialize(g);
saveKB = Math.max(saveKB, (LZString.compressToUTF16(finalRaw).length * 2) / 1024);
saveMs = Math.max(saveMs, performance.now() - t0);
const big = deserialize(finalRaw);
devFleet(big, 10);
const bigKB = (LZString.compressToUTF16(serialize(big)).length * 2) / 1024;
errors.push(...badNumbers(g).map((p) => `final: non-finite ${p}`));

const s = g.stats;
const weeks = Math.max(1, Math.floor(days / 7));
let activeWeeks = 0;
let maxDec = 0;
for (let w = 0; w < weeks; w++) {
  if ((tally.actions.get(w) ?? 0) > 0) activeWeeks++;
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
  ['no illegal duties flown', (s.illegalFlown ?? 0) === 0, String(s.illegalFlown ?? 0)],
  ['< 2% flights uncovered at departure', uncShare < 0.02, `${(uncShare * 100).toFixed(2)}% of ${s.departures ?? 0}`],
  ['≥ 1 meaningful action per week', totalActions / weeks >= 1 && activeWeeks / weeks >= 0.8, `${(totalActions / weeks).toFixed(1)}/wk, ${activeWeeks}/${weeks} weeks`],
  ['≤ 3 decisions per week', maxDec <= 3, `max ${maxDec}, ${seenDecision.size} asked`],
  ['≥ 30 offers per year', seenOffer.size * (365 / days) >= 30, String(seenOffer.size)],
  ['first contract within 7 days', tally.firstAccept !== null && tally.firstAccept - g.started <= 7 * DAY, dayOf(tally.firstAccept)],
  ['widebody acquirable within 12 months', tally.wideAffordableAt !== null && tally.wideAffordableAt - g.started <= 365 * DAY, `${dayOf(tally.wideAffordableAt)}, signed ${dayOf(tally.wideSigned)}`],
  ['1–3 AOGs per aircraft-year', aogRate >= 1 && aogRate <= 3, `${aogRate.toFixed(2)} (${s.aogs ?? 0} in ${acYears.toFixed(1)} ac-yr)`],
  ['governments mostly pay late', gov.length < 3 || govLate / gov.length >= 0.5, `${govLate}/${gov.length} invoices late`],
  ['save < 300 KB (and with 10 aircraft)', saveKB < 300 && bigKB < 300, `${saveKB.toFixed(0)} KB (${saveMs.toFixed(0)} ms), 10 ac ${bigKB.toFixed(0)} KB`],
  ['runs in < 10 s', runSecs < 10, `${runSecs.toFixed(1)} s`],
];
console.log(`\nyear P&L: ${[...lines].sort((a, b) => b[1] - a[1]).map(([c, v]) => `${c} ${k$(v)}`).join(', ')}`);
console.log(
  `legs ${s.legs}, on time ${((100 * s.onTime) / Math.max(1, s.legs)).toFixed(1)}%, cancelled ${s.cancelled}, contracts ${tally.accepted} signed (${tally.countered} countered), ` +
    `done ${s.contractsDone}, decisions ${s.decisions ?? 0}, sub-chartered ${s.subchartered ?? 0}, reliable ${g.company.reputation.reliable.toFixed(1)}, ` +
    `fleet ${Object.values(g.fleet).map((a) => typeOf(a.typeId).short).join('+')}, crew ${Object.keys(g.crew).length}, messages ${msgCount}`,
);
console.log(`cancelled legs by reason: ${[...cancels].sort((a, b) => b[1] - a[1]).map(([c, v]) => `${c} ${v}`).join(', ') || 'none'}`);
for (const e of errors.slice(0, 3)) console.log(e);
console.log('\ntargets');
for (const [name, ok, val] of targets) console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(38)} ${val}`);
process.exitCode = errors.length ? 2 : targets.every((c) => c[1]) ? 0 : 1;
