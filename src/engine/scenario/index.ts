// v0.12 Scenarios mode: building a scenario game, the daily goal tally and scan, the end and its stars, and the views
// the UI reads (objectives, results). Definitions in scenario/defs.ts. A normal game has no `g.scen` and is untouched:
// the module's daily hook returns at once, the offer stream reads no bias, the finance rescue runs as before.

import { AIRPORT_BY_CODE } from '../../data/airports';
import { invoice, statementTotals } from '../core/ledger';
import { pushMessage } from '../core/messages';
import { typeOf } from '../core/perf';
import { DAY, fmtDay, fromUTC } from '../core/time';
import type { GameState, Minute, ScenarioResult, ScenarioState, ScenarioTally } from '../core/types';
import { createGame } from '../newGame';
import { SCENARIO_BY_ID, SCENARIOS, type MetricId, type Must, type ScenarioDef } from './defs';
import { SCEN_HOOKS } from './module';

export { SCENARIOS, SCENARIO_BY_ID, type MetricId, type Must, type ScenarioDef };

export const scenarioDef = (g: GameState): ScenarioDef | undefined => (g.scen ? SCENARIO_BY_ID[g.scen.id] : undefined);

const emptyTally = (): ScenarioTally => ({ legs: 0, onTime: 0, cxl: 0, sub: 0, pax: 0, bh: 0, wideBh: 0, regionBh: 0, fLegs: 0, fOn: 0, fCxl: 0, fDone: 0, posRun: 0, negRun: 0 });

/** First minute of the scenario (00:00 UTC on its first day). Pure. */
export const scenarioStart = (d: ScenarioDef): Minute => fromUTC(d.start[0], d.start[1], d.start[2]);

/** A new game of scenario `id`: its company, base, date, fleet, crew, cash, approvals, contracts and day-0 script. */
export function createScenario(id: string): GameState {
  const d = SCENARIO_BY_ID[id];
  if (!d) throw new Error(`Unknown scenario ${id}`);
  const start = scenarioStart(d);
  const c = d.company;
  const g = createGame({
    name: c.name, code: c.code, icao: c.icao, callsign: c.callsign, livery: c.livery, base: c.base, seed: d.seed, start,
    custom: { fleet: d.fleet, sets: d.sets, cash: d.cash }, quiet: true,
    beforeInit: (x) => {
      x.scenario = d.id;
      x.scen = {
        id: d.id, end: start + d.days * DAY, tally: emptyTally(), scan: start, fired: [],
        ...(d.bias ? { bias: { ...d.bias } } : {}), ...(d.rate ? { rate: d.rate } : {}), ...(d.focus ? { focus: [...d.focus] } : {}),
        ...(d.countries ? { region: [...d.countries] } : {}), ...(d.noRescue ? { noRescue: true } : {}), ...(d.noSale ? { noSale: true } : {}),
      };
      // Approvals held for a while before the start (as if earned last year), and applications already filed.
      for (const a of d.approvals ?? []) {
        if (!x.company.approvals.includes(a)) x.company.approvals.push(a);
        (x.company.approvalsAt ??= {})[a] = start - 200 * DAY;
      }
      for (const p of d.pending ?? []) x.company.pendingApprovals.push({ id: p.id, started: start - 60 * DAY, done: start + p.days * DAY, cost: 0 });
    },
  });
  // Money owed to us from before the start (paid when the client pays: governments late).
  for (const [name, amount, days] of d.owed ?? []) {
    const cl = Object.values(g.clients).find((x) => x.name === name);
    if (cl) invoice(g, { clientId: cl.id, contractId: null, desc: `Owed from last winter (${name})`, amount, cat: 'otherRevenue', dueDays: days });
  }
  d.setup?.(g);
  pushMessage(g, { tone: 'info', cat: 'goal', topic: 'scenario', title: `Scenario: ${d.name}`, body: `${d.brief} Goal: ${goalLine(d)}` });
  runScript(g, d, 0);
  return g;
}

// ---------- measures ----------

export type Unit = 'money' | 'pct' | 'days' | 'n' | 'bh' | 'pax';

export interface MetricDef {
  label: string;
  unit: Unit;
  value(g: GameState): number;
}

/** P&L since the start: every statement of the game (it began with the scenario). Pure. */
function pnl(g: GameState): { revenue: number; profit: number } {
  let revenue = 0;
  let profit = 0;
  for (const st of [...g.finance.history, g.finance.current]) {
    const t = statementTotals(st.lines);
    revenue += t.revenue;
    profit += t.profit;
  }
  return { revenue, profit };
}

const pct = (a: number, b: number, none: number) => (b > 0 ? Math.floor((1000 * a) / b) / 10 : none);

export const METRICS: Record<MetricId, MetricDef> = {
  profit: { label: 'Profit', unit: 'money', value: (g) => pnl(g).profit },
  revenue: { label: 'Revenue', unit: 'money', value: (g) => pnl(g).revenue },
  posRun: { label: 'Days in a row with cash above zero', unit: 'days', value: (g) => (g.company.cash >= 0 ? g.scen?.tally.posRun ?? 0 : 0) },
  fOnTime: { label: 'Legs on time', unit: 'pct', value: (g) => pct(g.scen?.tally.fOn ?? 0, g.scen?.tally.fLegs ?? 0, 0) },
  fOnPlan: { label: 'Legs on time, of all planned', unit: 'pct', value: (g) => {
    const t = g.scen?.tally;
    return t ? pct(t.fOn, t.fLegs + t.fCxl + (t.fSub ?? 0), 0) : 0;
  } },
  pax: { label: 'Passengers flown', unit: 'pax', value: (g) => g.scen?.tally.pax ?? 0 },
  fLegs: { label: 'Charter legs flown', unit: 'n', value: (g) => g.scen?.tally.fLegs ?? 0 },
  rescues: { label: 'Rescue flights flown', unit: 'n', value: (g) => g.scen?.tally.fLegs ?? 0 },
  reliability: { label: 'Legs flown as planned', unit: 'pct', value: (g) => reliability(g) },
  wideBh: { label: 'Widebody block hours', unit: 'bh', value: (g) => Math.floor(g.scen?.tally.wideBh ?? 0) },
  regionBh: { label: 'Block hours in South America', unit: 'bh', value: (g) => Math.floor(g.scen?.tally.regionBh ?? 0) },
  fDone: { label: 'Missions completed', unit: 'n', value: (g) => g.scen?.tally.fDone ?? 0 },
};

/** Our revenue legs flown ÷ planned (cancelled and handed to rivals count against), %. 100 before any leg. Pure. */
export function reliability(g: GameState): number {
  const t = g.scen?.tally;
  if (!t) return 100;
  return pct(t.legs, t.legs + t.cxl + t.sub, 100);
}

/** '$1.2M', '96 %', '12 days', '1,450 pax', '320 BH'. Pure. */
export function fmtValue(unit: Unit, v: number): string {
  if (unit === 'money') {
    const a = Math.abs(v);
    const s = a >= 1e6 ? `$${(a / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M` : a >= 1e3 ? `$${Math.round(a / 1e3)}K` : `$${Math.round(a)}`;
    return v < 0 ? `−${s}` : s;
  }
  if (unit === 'pct') return `${v} %`;
  if (unit === 'days') return `${v} day${v === 1 ? '' : 's'}`;
  if (unit === 'bh') return `${v.toLocaleString('en-US')} BH`;
  if (unit === 'pax') return `${v.toLocaleString('en-US')} passengers`;
  return v.toLocaleString('en-US');
}

const FOCUS_WORD: Record<string, string> = { hajj: 'Hajj', sports: 'charter', repatriation: 'rescue' };
const focusWord = (d: ScenarioDef) => FOCUS_WORD[d.focus?.[0] ?? ''] ?? 'mission';

export function mustText(d: ScenarioDef, m: Must): string {
  if (m.kind === 'reliability') return `Fly at least ${m.min} % of the legs as planned`;
  if (m.kind === 'focusLost') return `Cancel no more than ${m.max} ${focusWord(d)} legs`;
  return `Fly at least ${m.n} legs`;
}

export function mustOk(g: GameState, m: Must): boolean {
  const t = g.scen?.tally;
  if (!t) return false;
  if (m.kind === 'reliability') return reliability(g) >= m.min;
  if (m.kind === 'focusLost') return t.fCxl <= m.max;
  return t.legs >= m.n;
}

/** Where a must stands now: '97 %', '1 cancelled', '84 of 120'. Pure. */
export function mustNow(g: GameState, m: Must): string {
  const t = g.scen?.tally;
  if (!t) return '';
  if (m.kind === 'reliability') return `${reliability(g)} %`;
  if (m.kind === 'focusLost') return `${t.fCxl} cancelled`;
  return `${t.legs} of ${m.n}`;
}

/** 'Profit of $0.4M / $1.5M / $3.0M by 30 Sep' (the card and the welcome note). Pure. */
export function goalLine(d: ScenarioDef): string {
  const m = METRICS[d.metric];
  const end = scenarioStart(d) + d.days * DAY - 1;
  return `${m.label}: ${d.stars.map((v) => fmtValue(m.unit, v)).join(' · ')} for ★ · ★★ · ★★★ by ${fmtDay(end)}.${(d.must ?? []).map((x) => ` ${mustText(d, x)}.`).join('')}`;
}

// ---------- the daily scan ----------

const countryOf = (code: string) => AIRPORT_BY_CODE[code]?.country ?? '';

/** Counts the flights done and cancelled since the last scan into the tally. */
function scan(g: GameState): void {
  const s = g.scen!;
  const t = s.tally;
  const focus = new Set(s.focus ?? []);
  const region = new Set(s.region ?? []);
  for (const id in g.flights) {
    const f = g.flights[id];
    if (f.kind !== 'revenue') continue;
    const contract = f.contractId ? g.contracts[f.contractId] : undefined;
    const isFocus = !!contract && focus.has(contract.archetype);
    if (f.status === 'done') {
      const when = f.ata ?? f.sta;
      if (when < s.scan || when >= g.now) continue;
      if (f.operatedBy) {
        t.sub++;
        if (isFocus) t.fSub = (t.fSub ?? 0) + 1;
        continue;
      }
      const block = Math.max(0, when - (f.atd ?? f.std)) / 60;
      const onTime = (f.atd ?? f.std) - f.std <= 15;
      t.legs++;
      if (onTime) t.onTime++;
      t.pax += f.pax ?? 0;
      t.bh += block;
      const ac = f.aircraftId ? g.fleet[f.aircraftId] : undefined;
      if (ac && typeOf(ac.typeId).body === 'wide') t.wideBh += block;
      if (region.size && (region.has(countryOf(f.from)) || region.has(countryOf(f.to)))) t.regionBh += block;
      if (isFocus) {
        t.fLegs++;
        if (onTime) t.fOn++;
      }
    } else if (f.status === 'cancelled') {
      if (f.std < s.scan || f.std >= g.now) continue;
      t.cxl++;
      if (isFocus) t.fCxl++;
    }
  }
  // Focus contracts completed (once each).
  if (focus.size) {
    const done = new Set(s.doneIds ?? []);
    for (const c of Object.values(g.contracts)) {
      if (c.status !== 'completed' || done.has(c.id) || !focus.has(c.archetype) || (c.legsFlown ?? 0) === 0) continue;
      done.add(c.id);
      t.fDone++;
    }
    s.doneIds = [...done];
  }
  s.scan = g.now;
}

function runScript(g: GameState, d: ScenarioDef, today: number): void {
  const s = g.scen!;
  (d.script ?? []).forEach((st, i) => {
    if (st.day > today || s.fired.includes(i)) return;
    s.fired.push(i);
    st.run(g);
  });
}

/** The scenario's day (00:00 UTC, after the other modules): tally, script, offer streams, fail floor, the end. */
function scenarioDay(g: GameState): void {
  const s = g.scen!;
  const d = SCENARIO_BY_ID[s.id];
  if (!d) return;
  scan(g);
  if (g.company.cash >= 0) {
    s.tally.posRun++;
    s.tally.negRun = 0;
  } else {
    s.tally.posRun = 0;
    s.tally.negRun++;
  }
  if (g.now >= s.end) return finish(g, d);
  const today = Math.floor((g.now - g.started) / DAY);
  runScript(g, d, today);
  d.daily?.(g);
  const t = s.tally;
  if (d.floor && t.legs + t.cxl + t.sub >= d.floor.afterLegs && reliability(g) < d.floor.reliability) {
    return finish(g, d, `Fewer than ${d.floor.reliability} % of the legs flew as planned: the airlines stopped calling.`);
  }
}
SCEN_HOOKS.day = scenarioDay;

/** Stars for a value on the scenario's thresholds (no conditions). Pure. */
export function starsFor(d: ScenarioDef, value: number): 0 | 1 | 2 | 3 {
  return d.stars.filter((x) => value >= x).length as 0 | 1 | 2 | 3;
}

/** Scores the run now: the measure, the conditions (any missed: no stars) and an early failure. Pure. */
export function scoreNow(g: GameState, failed?: string): ScenarioResult {
  const d = scenarioDef(g)!;
  const value = METRICS[d.metric].value(g);
  const miss = (d.must ?? []).find((m) => !mustOk(g, m));
  const why = failed ?? (miss ? `Missed: ${mustText(d, miss)}.` : undefined);
  return { stars: why ? 0 : starsFor(d, value), t: g.now, value, ...(why ? { failed: why } : {}) };
}

/** The end: the result, the clock stops (gameOver), one message. */
export function finish(g: GameState, d: ScenarioDef, failed?: string): void {
  const s = g.scen!;
  if (s.result) return;
  s.result = scoreNow(g, failed);
  const r = s.result;
  const v = fmtValue(METRICS[d.metric].unit, r.value);
  g.gameOver = { t: g.now, reason: failed ?? `${d.name} is over.` };
  pushMessage(g, {
    tone: r.stars ? 'good' : 'bad', cat: 'goal', topic: 'scenario',
    title: r.failed && !r.stars ? `${d.name}: not this time` : `${d.name}: ${'★'.repeat(r.stars)}${'☆'.repeat(3 - r.stars)}`,
    body: `${METRICS[d.metric].label}: ${v}.${r.failed ? ` ${r.failed}` : ''}`,
  });
}

/** The run's result: when over (or the company failed: no stars, its reason). null while it runs. Pure. */
export function scenarioOutcome(g: GameState): ScenarioResult | null {
  const s = g.scen;
  if (!s) return null;
  if (s.result) return s.result;
  if (g.gameOver) return { ...scoreNow(g, g.gameOver.reason), stars: 0, failed: g.gameOver.reason };
  return null;
}

// ---------- the objectives view ----------

export interface ScenarioView {
  def: ScenarioDef;
  metric: MetricDef;
  value: number;
  valueText: string;
  /** Stars the value earns now (conditions aside). */
  stars: 0 | 1 | 2 | 3;
  /** The next threshold, or null at three stars. */
  next: { stars: 1 | 2 | 3; target: number; text: string } | null;
  /** 0–1 towards the next threshold (1 at three stars). */
  progress: number;
  daysLeft: number;
  endText: string;
  musts: { text: string; ok: boolean; now: string }[];
  floor?: string;
  result: ScenarioResult | null;
}

export function scenarioView(g: GameState): ScenarioView | null {
  const d = scenarioDef(g);
  if (!d || !g.scen) return null;
  const m = METRICS[d.metric];
  const value = m.value(g);
  const stars = starsFor(d, value);
  const nextI = d.stars.findIndex((x) => value < x);
  const next = nextI < 0 ? null : { stars: (nextI + 1) as 1 | 2 | 3, target: d.stars[nextI], text: fmtValue(m.unit, d.stars[nextI]) };
  const lo = nextI <= 0 ? Math.min(0, value) : d.stars[nextI - 1];
  const progress = next ? Math.max(0, Math.min(1, (value - lo) / Math.max(1e-9, next.target - lo))) : 1;
  return {
    def: d, metric: m, value, valueText: fmtValue(m.unit, value), stars, next, progress,
    daysLeft: Math.max(0, Math.ceil((g.scen.end - g.now) / DAY)), endText: fmtDay(g.scen.end - 1),
    musts: (d.must ?? []).map((x) => ({ text: mustText(d, x), ok: mustOk(g, x), now: mustNow(g, x) })),
    ...(d.floor ? { floor: `Below ${d.floor.reliability} % flown as planned (after ${d.floor.afterLegs} legs) ends it early.` } : {}),
    result: scenarioOutcome(g),
  };
}

/** The scenario's key numbers for the results card. Pure. */
export function scenarioNumbers(g: GameState): [string, string][] {
  const t = g.scen?.tally;
  if (!t) return [];
  const { revenue, profit } = pnl(g);
  const out: [string, string][] = [
    ['Legs flown', t.legs.toLocaleString('en-US')],
    ['As planned', `${reliability(g)} %`],
    ['Passengers', t.pax.toLocaleString('en-US')],
    ['Revenue', fmtValue('money', revenue)],
    ['Profit', fmtValue('money', profit)],
    ['Cash', fmtValue('money', g.company.cash)],
  ];
  return out;
}

export type { ScenarioState };
