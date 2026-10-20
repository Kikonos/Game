// Headless year of CONTRAIL ACMI with a greedy player (DESIGN.md §7.3). Run: npx tsx scripts/acmi-bot.ts [seed] [days]
// Accepts the best workable offer, hires to 5 sets per aircraft, takes decision defaults, books C-checks when
// warned and leases a third aircraft when cash allows. Prints a monthly table and checks the balance targets.

import LZString from 'lz-string';
import { typeOf } from '../src/engine/core/perf';
import { DAY, WEEK, fmtMonth, monthKey, toDate } from '../src/engine/core/time';
import { statementTotals } from '../src/engine/core/ledger';
import type { GameState, Role } from '../src/engine/core/types';
import { acceptOffer, feasibilityAll } from '../src/engine/contracts';
import { flightsOf } from '../src/engine/core/entities';
import { flightCrewStatus, hireCrew, staffing } from '../src/engine/crew';
import { devFleet } from '../src/engine/dev';
import { createGame } from '../src/engine/newGame';
import { acquireAircraft, checkStatus, groundGaps, resolveDecision, scheduleCheck } from '../src/engine/ops';
import { deserialize, serialize } from '../src/engine/save';
import { advanceTo } from '../src/engine/sim';

const seed = Number(process.argv[2] ?? 1);
const days = Number(process.argv[3] ?? 365);
const wall = performance.now();
const g: GameState = createGame({ name: 'Atlântica Wings', code: 'AW', livery: { primary: '#0b1f4d', secondary: '#f5c451', tail: 'sweep' }, base: 'LIS', seed });
const start = g.now;
const end = start + days * DAY;

const week = () => Math.floor((g.now - start) / WEEK);
const actions = new Map<number, number>();
const decisionsWk = new Map<number, number>();
const act = (n = 1) => actions.set(week(), (actions.get(week()) ?? 0) + n);
const seen = new Set<string>();
let accepted = 0;
let firstAccept: number | null = null;
let wideAffordableAt: number | null = null;

function decide(): void {
  for (const d of [...g.decisions]) {
    if (resolveDecision(g, d.id, d.defaultOption).ok) {
      act();
      decisionsWk.set(week(), (decisionsWk.get(week()) ?? 0) + 1);
    }
  }
}

/**
 * Best workable report: ok/warn with a positive margin; a crew shortfall is fine if hires join before it bites.
 * Bigger jobs first; thin multi-week series (under 3 BH per day of span) are passed over so the calendar stays
 * open for season bases, and small jobs are only taken inside the next 21 days.
 */
function offers(): void {
  const open = Object.values(g.offers)
    .filter((o) => o.status === 'open' && o.start >= g.now)
    .sort((a, b) => b.estValue - a.estValue);
  for (const o of open) {
    const span = Math.max(1, (o.end - o.start) / DAY);
    if (span > 10 && o.estBH / span < 3) continue;
    if (o.estBH < 120 && o.start > g.now + 21 * DAY) continue;
    const best = feasibilityAll(g, o.id).find((r) => {
      if ((r.level !== 'ok' && r.level !== 'warn') || r.estMargin <= 0) return false;
      const crew = r.checks.find((c) => c.id === 'crew');
      return !crew || crew.level === 'ok' || (r.crew.firstShort !== null && r.crew.firstShort > g.now + 50 * DAY);
    });
    if (!best) continue;
    const fam = typeOf(g.fleet[best.aircraftId].typeId).family;
    for (const [role, cap] of Object.entries(best.crew.byRole)) {
      if (cap && cap.short > 0 && hireCrew(g, { role: role as Role, family: fam, base: g.company.homeBase, count: Math.min(30, cap.short) }).ok) act();
    }
    const r = acceptOffer(g, o.id, [best.aircraftId]);
    if (r.ok) {
      accepted++;
      firstAccept ??= g.now;
      act();
    }
  }
}

function hire(): void {
  for (const l of staffing(g)) {
    if (l.have >= l.need) continue;
    if (hireCrew(g, { role: l.role, family: l.family, base: g.company.homeBase, count: Math.min(30, l.need - l.have) }).ok) act();
  }
}

/** C-checks: booked once warned (≤ 90 days), in the first free window long enough (winter preferred). */
function checks(): void {
  for (const ac of Object.values(g.fleet)) {
    if (ac.status === 'delivering') continue;
    const st = checkStatus(g, ac);
    if (st.nextC || st.cDue - g.now > 90 * DAY) continue;
    const t = typeOf(ac.typeId);
    const need = t.cCheckDays * DAY + DAY;
    const gaps = groundGaps(g, ac, g.now + DAY, st.cDue + 20 * DAY).filter((x) => x.to - x.from >= need);
    const winter = gaps.find((x) => [10, 11, 0, 1, 2].includes(toDate(x.from).getUTCMonth()));
    for (const gap of winter ? [winter, ...gaps] : gaps) {
      const lead = gap.at === g.company.homeBase ? 120 : 120 + t.turnMin + 6 * 60;
      if (scheduleCheck(g, ac.id, 'C', gap.from + lead, g.company.homeBase).ok) {
        act();
        break;
      }
    }
  }
}

function fleet(): void {
  for (const o of g.market.aircraft) {
    if (typeOf(o.typeId).body === 'wide' && g.company.cash >= o.deposit && wideAffordableAt === null) wideAffordableAt = g.now;
  }
  if (Object.keys(g.fleet).length >= 3 || g.company.cash < 3_500_000 || monthKey(g.now) - monthKey(start) < 2) return;
  const o = g.market.aircraft.find((x) => x.kind === 'dryLeaseIn' && typeOf(x.typeId).family === 'A320');
  if (o && acquireAircraft(g, o.id).ok) act();
}

// ---------- run ----------

interface Row {
  month: string;
  cash: number;
  bhPerAc: number;
  revenue: number;
  costs: number;
  profit: number;
  offers: number;
  accepted: number;
  aogs: number;
  delays: number;
  uncovered: number;
  illegal: number;
  saveKB: number;
  saveMs: number;
}
const rows: Row[] = [];
let last = { offers: 0, accepted: 0, aogs: 0, delays: 0, uncovered: 0, illegal: 0 };
let acYears = 0;
let maxSave = 0;

function monthRow(): void {
  const st = g.finance.history[g.finance.history.length - 1];
  if (!st) return;
  const t0 = performance.now();
  const kb = LZString.compressToUTF16(serialize(g)).length * 2 / 1024;
  const ms = performance.now() - t0;
  maxSave = Math.max(maxSave, kb);
  const n = Object.values(g.fleet).filter((a) => a.deliveredAt < g.now).length;
  const s = g.stats;
  const cur = { offers: seen.size, accepted, aogs: s.aogs ?? 0, delays: s.delayed, uncovered: s.uncovered ?? 0, illegal: s.illegalFlown ?? 0 };
  const { revenue, costs, profit } = statementTotals(st.lines);
  rows.push({
    month: fmtMonth(st.month), cash: g.company.cash, bhPerAc: st.bh / Math.max(1, n), revenue, costs, profit,
    offers: cur.offers - last.offers, accepted: cur.accepted - last.accepted, aogs: cur.aogs - last.aogs, delays: cur.delays - last.delays,
    uncovered: cur.uncovered - last.uncovered, illegal: cur.illegal - last.illegal, saveKB: kb, saveMs: ms,
  });
  last = cur;
}

const cancelSeen = new Set<string>();
const cancels = new Map<string, number>();
let month = monthKey(g.now);
let lastDay = -1;
while (g.now < end && !g.gameOver) {
  const stepFrom = Number(process.env.BOT_STEP ?? Infinity);
  if (g.now - start >= stepFrom * DAY) {
    const top = g.queue[0];
    console.error('ev', top?.t - g.now, top?.type, top?.id, top?.id && g.flights[top.id] ? `${g.flights[top.id].no} ${g.flights[top.id].status} std ${g.flights[top.id].std - g.now} delay ${g.flights[top.id].delay} ${g.flights[top.id].from}-${g.flights[top.id].to} ${g.flights[top.id].kind} ac ${g.flights[top.id].aircraftId} at ${g.fleet[g.flights[top.id].aircraftId ?? ""]?.at} ${g.fleet[g.flights[top.id].aircraftId ?? ""]?.status} ${g.flights[top.id].contractId} blk ${g.flights[top.id].block} why ${g.flights[top.id].delayReason} ev ${g.flights[top.id].ev}/${top.v} crew ${JSON.stringify(flightCrewStatus(g, top.id))} duty ${g.flights[top.id].dutyId} ${g.duties[g.flights[top.id].dutyId ?? ""]?.legality}` : '');
  }
  const r = advanceTo(g, Math.min(end, g.now >= start + stepFrom * DAY ? g.queue[0]?.t ?? end : g.now + 6 * 60));
  for (const o of Object.values(g.offers)) seen.add(o.id);
  for (const f of Object.values(g.flights)) {
    if (f.status !== 'cancelled' || cancelSeen.has(f.id) || f.kind === 'deadhead') continue;
    cancelSeen.add(f.id);
    const key = `${f.delayReason ?? '?'} (${f.kind})`;
    cancels.set(key, (cancels.get(key) ?? 0) + 1);
  }
  decide();
  const day = Math.floor((g.now - start) / DAY);
  if (process.env.BOT_TRACE === '2' && day !== lastDay) for (const ac of Object.values(g.fleet)) { const st = checkStatus(g, ac); console.error(`  ${ac.id} ${ac.at} ${ac.status} fhA ${ac.maint.fhSinceA.toFixed(0)} aUsed ${st.aUsed.toFixed(2)} due ${((st.aDue - g.now) / DAY).toFixed(1)}d nextA ${st.nextA} ${st.nextA ? JSON.stringify(g.maintenance[st.nextA]) : ''} gr ${st.grounded}`); }
  if (process.env.BOT_TRACE && day !== lastDay) console.error(`day ${day} ${((performance.now() - wall) / 1000).toFixed(1)}s flights ${Object.keys(g.flights).length} q ${g.queue.length} dec ${g.decisions.length} cash ${Math.round(g.company.cash / 1000)}k ${JSON.stringify(Object.values(g.flights).reduce((m, f) => ((m[f.kind + ':' + f.status + ':' + (f.delayReason ?? '')] = (m[f.kind + ':' + f.status + ':' + (f.delayReason ?? '')] ?? 0) + 1), m), {} as Record<string, number>))}`);
  if (r.pause === 'urgentOffer' || day !== lastDay) {
    offers();
    if (day !== lastDay) {
      hire();
      checks();
      fleet();
      acYears += Object.values(g.fleet).filter((a) => a.status !== 'delivering').length / 365;
      lastDay = day;
    }
  }
  if (monthKey(g.now) !== month) {
    month = monthKey(g.now);
    monthRow();
  }
}

// ---------- report ----------

if (process.env.BOT_DUMP) {
  for (const ac of Object.values(g.fleet)) {
    console.log(ac.id, ac.reg, ac.at, ac.status, ac.flightId);
    for (const f of flightsOf(g, ac.id).filter((x) => x.status !== 'done' && x.status !== 'cancelled').slice(0, 14)) {
      const cs = flightCrewStatus(g, f.id);
      console.log(`  ${f.no} ${f.kind} ${f.from}-${f.to} ${f.status} std ${((f.std - g.now) / 60).toFixed(1)}h late ${((f.std - (f.schedStd ?? f.std)) / 60).toFixed(1)}h hold ${f.delay} ${f.delayReason ?? ''} crew ${cs.level} ${cs.missing.join(',')} duty ${f.dutyId} ${f.dutyId ? g.duties[f.dutyId]?.legality : ''} c ${f.contractId}`);
    }
  }
}

const pad = (s: string | number, n: number) => String(s).padStart(n);
const k = (v: number) => `${(v / 1000).toFixed(0)}k`;
console.log(`CONTRAIL ACMI bot — seed ${seed}, ${days} days, base LIS\n`);
console.log('month    cash      BH/ac  revenue    costs   profit  offers acc  AOG  dly  unc ill  saveKB  ms');
for (const r of rows) {
  console.log(`${r.month.padEnd(7)}${pad(k(r.cash), 7)}${pad(r.bhPerAc.toFixed(0), 9)}${pad(k(r.revenue), 9)}${pad(k(r.costs), 9)}${pad(k(r.profit), 9)}${pad(r.offers, 8)}${pad(r.accepted, 4)}${pad(r.aogs, 5)}${pad(r.delays, 5)}${pad(r.uncovered, 5)}${pad(r.illegal, 4)}${pad(r.saveKB.toFixed(0), 8)}${pad(r.saveMs.toFixed(0), 4)}`);
}

// Save size with a 10-aircraft fleet (clones) on the final state.
const big = deserialize(serialize(g));
devFleet(big, 10);
const bigKB = LZString.compressToUTF16(serialize(big)).length * 2 / 1024;

const summer = rows.filter((r) => /^(Jun|Jul|Aug|Sep)/.test(r.month));
const summerBH = summer.length ? summer.reduce((s, r) => s + r.bhPerAc, 0) / summer.length : 0;
const rev = rows.reduce((s, r) => s + r.revenue, 0);
const profit = rows.reduce((s, r) => s + r.profit, 0);
const margin = rev ? profit / rev : -1;
const s = g.stats;
const weeks = Math.max(1, Math.floor(days / 7));
let activeWeeks = 0;
let maxDec = 0;
for (let w = 0; w < weeks; w++) {
  if ((actions.get(w) ?? 0) > 0) activeWeeks++;
  maxDec = Math.max(maxDec, decisionsWk.get(w) ?? 0);
}
const totalActions = [...actions.values()].reduce((a, b) => a + b, 0);
const aogRate = (s.aogs ?? 0) / Math.max(0.1, acYears);
const uncShare = (s.uncovered ?? 0) / Math.max(1, s.departures ?? 0);
const secs = (performance.now() - wall) / 1000;
const checksOut: [string, boolean, string][] = [
  ['summer BH per aircraft 180–320', summerBH >= 180 && summerBH <= 320, summerBH.toFixed(0)],
  ['year net margin −5%…+12%', margin >= -0.05 && margin <= 0.12, `${(margin * 100).toFixed(1)}%`],
  ['no illegal duties flown', (s.illegalFlown ?? 0) === 0, String(s.illegalFlown ?? 0)],
  ['< 2% flights uncovered at departure', uncShare < 0.02, `${(uncShare * 100).toFixed(2)}% of ${s.departures}`],
  ['≥ 1 meaningful action per week', totalActions / weeks >= 1 && activeWeeks / weeks >= 0.8, `${(totalActions / weeks).toFixed(1)}/wk, ${activeWeeks}/${weeks} weeks`],
  ['≤ 3 decisions per week', maxDec <= 3, `max ${maxDec}`],
  ['≥ 30 offers per year', seen.size * (365 / days) >= 30, String(seen.size)],
  ['first contract within 7 days', firstAccept !== null && firstAccept - start <= 7 * DAY, firstAccept === null ? 'none' : `day ${Math.floor((firstAccept - start) / DAY)}`],
  ['widebody acquirable within 12 months', wideAffordableAt !== null && wideAffordableAt - start <= 365 * DAY, wideAffordableAt === null ? 'never' : `day ${Math.floor((wideAffordableAt - start) / DAY)}`],
  ['1–3 AOGs per aircraft-year', aogRate >= 1 && aogRate <= 3, `${aogRate.toFixed(2)} (${s.aogs} in ${acYears.toFixed(1)} ac-yr)`],
  ['save < 300 KB (and with 10 aircraft)', maxSave < 300 && bigKB < 300, `${maxSave.toFixed(0)} KB, 10 ac ${bigKB.toFixed(0)} KB`],
  ['runs in < 10 s', secs < 10, `${secs.toFixed(1)} s`],
];
console.log(`\nlegs ${s.legs}, on time ${((100 * s.onTime) / Math.max(1, s.legs)).toFixed(1)}%, cancelled ${s.cancelled}, contracts done ${s.contractsDone}, decisions ${s.decisions}, sub-chartered ${s.subchartered}, reliable ${g.company.reputation.reliable.toFixed(1)}, fleet ${Object.keys(g.fleet).length}${g.gameOver ? `, GAME OVER: ${g.gameOver.reason}` : ''}`);
console.log(`cancelled legs by reason: ${[...cancels].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}`);
console.log('\ntargets');
for (const [name, ok, val] of checksOut) console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(40)} ${val}`);
process.exitCode = checksOut.every((c) => c[1]) ? 0 : 1;
