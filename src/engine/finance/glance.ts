// v0.20 Finance at a glance (player: "more visuals in finance, more easily digestible, for me that I don't have that
// much financial knowledge"). Pure helpers over the month statements the ledger already keeps: the statement's lines
// in a few plain groups (where the money went, where it came from), the month's verdict with and without one-offs,
// figures per block hour, the biggest changes on the month before, plain-language tips, and the cash path behind and
// ahead. Nothing here changes how money is computed; it only reads MonthStatement.lines.

import { COST_CATS, REVENUE_CATS, statementTotals } from '../core/ledger';
import { DAY, monthStart } from '../core/time';
import type { LedgerCat, Minute, MonthKey, MonthStatement } from '../core/types';

export type CostGroupId = 'crew' | 'crewTravel' | 'aircraft' | 'mx' | 'flying' | 'overhead' | 'oneOff' | 'other';
export type RevGroupId = 'acmi' | 'charter' | 'routes' | 'leases' | 'other';

export interface GroupDef<Id extends string> {
  id: Id;
  label: string;
  /** One or two plain sentences: what this money is. */
  about: string;
  cats: readonly LedgerCat[];
}

/**
 * The cost groups, in their fixed order (the order is also the colour order: colour follows the group, never its
 * size). 'Other' is last and grey. A cost line under no group falls into 'Other'.
 */
export const COST_GROUPS: readonly GroupDef<CostGroupId>[] = [
  { id: 'crew', label: 'Crew pay', cats: ['salaries', 'training', 'hiring'],
    about: 'Salaries of pilots, cabin crew and office staff, with the employer\'s social charges on top, plus training and hiring. Paid at the month end whether the crew fly or not.' },
  { id: 'crewTravel', label: 'Crew travel & hotels', cats: ['perDiem', 'hotels', 'deadhead', 'crewJet'],
    about: 'What crew cost while away: daily allowances (per diems), hotel nights, airline tickets to and from the aircraft, and the odd private jet.' },
  { id: 'aircraft', label: 'Aircraft rent & insurance', cats: ['rent', 'insurance', 'consent'],
    about: 'Monthly rent to the lessors who own the aircraft, and the hull and liability insurance. Fixed: it comes every month, flying or parked.' },
  { id: 'mx', label: 'Maintenance & reserves', cats: ['maintenance', 'checks', 'reserves'],
    about: 'Fixing and checking the aircraft (line work, A- and C-checks) and the maintenance reserves: money paid to the lessor for every hour flown, saved for the big checks later.' },
  { id: 'flying', label: 'Fuel & airports', cats: ['fuel', 'airportFees', 'navCharges', 'handling', 'catering', 'paxServices', 'warRisk'],
    about: 'Costs of flying itself when we pay them: fuel, landing and handling fees, air navigation charges, catering. On ACMI the client pays most of these.' },
  { id: 'overhead', label: 'Office & sales', cats: ['overhead', 'sales', 'marketing', 'distribution', 'commission', 'compliance', 'approvals', 'bankFees', 'interest'],
    about: 'Running the company: the office, IT, sales trips and fairs, brokers\' commission, approvals, bank fees and interest.' },
  { id: 'oneOff', label: 'One-offs', cats: ['leaseReturn', 'transition', 'refit', 'capex', 'paint', 'delivery', 'routeSetup', 'badDebt', 'distress'],
    about: 'Big costs that do not come every month: handing an aircraft back to its lessor, bringing a new one in, cabin refits, paint, buying an aircraft, unpaid invoices written off.' },
  { id: 'other', label: 'Other', cats: ['subcharter', 'penalties', 'disruption', 'paxComp'],
    about: 'Paying other airlines to fly our flights (sub-charter), contract penalties, diversions and passenger compensation.' },
];

export const REV_GROUPS: readonly GroupDef<RevGroupId>[] = [
  { id: 'acmi', label: 'ACMI', cats: ['acmiRevenue'],
    about: 'Wet leases: our aircraft and crew fly for an airline, which pays per block hour. Invoiced at the month end.' },
  { id: 'charter', label: 'Charters', cats: ['charterRevenue'],
    about: 'Whole-aircraft charters for tour operators, governments, sports teams and others, at a price per trip.' },
  { id: 'routes', label: 'Own routes', cats: ['ticketRevenue', 'cargoRevenue', 'ancillaryRevenue'],
    about: 'Tickets, cargo and extras on the routes we fly under our own name.' },
  { id: 'leases', label: 'Leases out', cats: ['leaseIncome'],
    about: 'Rent and reserves from airlines flying our aircraft with their own crew (a dry lease out).' },
  { id: 'other', label: 'Other', cats: ['otherRevenue', 'interestIncome', 'assetSale'],
    about: 'Everything else: fuel and fees passed on to clients, interest on cash, aircraft sold.' },
];

const COST_OF = new Map<LedgerCat, CostGroupId>(COST_GROUPS.flatMap((g) => g.cats.map((c) => [c, g.id] as const)));
const REV_OF = new Map<LedgerCat, RevGroupId>(REV_GROUPS.flatMap((g) => g.cats.map((c) => [c, g.id] as const)));

/** Is this ledger line revenue (the statement's own split: by category, an unknown one by its sign)? */
const isRevenue = (cat: LedgerCat, v: number) => REVENUE_CATS.includes(cat) || (!COST_CATS.includes(cat) && v >= 0);

export const costGroupOf = (cat: LedgerCat): CostGroupId => COST_OF.get(cat) ?? 'other';
export const revGroupOf = (cat: LedgerCat): RevGroupId => REV_OF.get(cat) ?? 'other';

export interface GroupLine { cat: LedgerCat; amount: number }

export interface Slice<Id extends string> {
  id: Id;
  label: string;
  /** Costs as a positive amount; a group whose refunds outweigh its costs is 0 on the chart (its lines keep the sign). */
  amount: number;
  /** Share of the chart's total (0–1). */
  share: number;
  /** The ledger lines in it, biggest first (costs positive, refunds negative). */
  lines: GroupLine[];
}

export interface MonthGroups {
  costs: Slice<CostGroupId>[];
  revenue: Slice<RevGroupId>[];
  totals: { revenue: number; costs: number; profit: number };
}

function slices<Id extends string>(defs: readonly GroupDef<Id>[], raw: Map<Id, GroupLine[]>): Slice<Id>[] {
  const out = defs.map((d) => {
    const lines = (raw.get(d.id) ?? []).filter((l) => Math.abs(l.amount) >= 0.5).sort((a, b) => b.amount - a.amount);
    return { id: d.id, label: d.label, amount: Math.max(0, lines.reduce((s, l) => s + l.amount, 0)), share: 0, lines };
  });
  const total = out.reduce((s, x) => s + x.amount, 0);
  for (const x of out) x.share = total > 0 ? x.amount / total : 0;
  return out;
}

/** A month's lines in the plain groups, every group in its fixed order (empty ones with amount 0). Pure. */
export function groupMonth(lines: Partial<Record<LedgerCat, number>>): MonthGroups {
  const cost = new Map<CostGroupId, GroupLine[]>();
  const rev = new Map<RevGroupId, GroupLine[]>();
  for (const [cat, v] of Object.entries(lines) as [LedgerCat, number | undefined][]) {
    if (!v) continue;
    if (isRevenue(cat, v)) {
      const id = revGroupOf(cat);
      rev.set(id, [...(rev.get(id) ?? []), { cat, amount: v }]);
    } else {
      const id = costGroupOf(cat);
      cost.set(id, [...(cost.get(id) ?? []), { cat, amount: -v }]);
    }
  }
  const t = statementTotals(lines);
  return { costs: slices(COST_GROUPS, cost), revenue: slices(REV_GROUPS, rev), totals: { revenue: t.revenue, costs: -t.costs, profit: t.profit } };
}

export interface Verdict {
  profit: number;
  revenue: number;
  costs: number;
  /** The month's one-off costs (the One-offs group) and its biggest line. */
  oneOffs: number;
  biggestOneOff: GroupLine | null;
  /** The profit without the one-offs. */
  underlying: number;
  /** Profit per dollar earned (null without revenue). */
  margin: number | null;
}

/** A month's verdict: made or lost, and what it would have been without the one-offs. Pure. */
export function monthVerdict(lines: Partial<Record<LedgerCat, number>>): Verdict {
  const gm = groupMonth(lines);
  const one = gm.costs.find((s) => s.id === 'oneOff')!;
  const { revenue, costs, profit } = gm.totals;
  return {
    profit, revenue, costs, oneOffs: one.amount, biggestOneOff: one.lines[0] ?? null, underlying: profit + one.amount,
    margin: revenue > 0 ? profit / revenue : null,
  };
}

export interface PerBlockHour {
  bh: number;
  /** Revenue and costs (one-offs left out) per block hour, and their difference. */
  earn: number;
  cost: number;
  profit: number;
  revenue: { id: RevGroupId; amount: number }[];
  costs: { id: CostGroupId; amount: number }[];
  /** The one-offs left out of the costs (whole month, not per hour). */
  oneOffsLeftOut: number;
}

/** Below this many block hours in a month the per-hour figures mean nothing. */
export const PER_BH_MIN = 20;

/**
 * Each block hour earns and costs: the month's groups divided by its block hours (revenue and positioning), the
 * one-offs left out so the figure is the running business. Null under PER_BH_MIN hours. Pure.
 */
export function perBlockHour(m: Pick<MonthStatement, 'lines' | 'bh'>): PerBlockHour | null {
  if (!(m.bh >= PER_BH_MIN)) return null;
  const gm = groupMonth(m.lines);
  const costs = gm.costs.filter((s) => s.id !== 'oneOff').map((s) => ({ id: s.id, amount: s.amount / m.bh }));
  const revenue = gm.revenue.map((s) => ({ id: s.id, amount: s.amount / m.bh }));
  const earn = gm.totals.revenue / m.bh;
  const oneOff = gm.costs.find((s) => s.id === 'oneOff')!.amount;
  const cost = (gm.totals.costs - oneOff) / m.bh;
  return { bh: m.bh, earn, cost, profit: earn - cost, revenue, costs, oneOffsLeftOut: oneOff };
}

export interface Change {
  kind: 'revenue' | 'cost';
  id: CostGroupId | RevGroupId;
  label: string;
  /** This month minus the month before (a cost as a positive amount: +$100K = $100K more spent). */
  delta: number;
  /** Good for the company: more revenue or less cost. */
  good: boolean;
}

/** The `n` groups that moved most against the month before (at least $10K), biggest first. Pure. */
export function biggestChanges(cur: Partial<Record<LedgerCat, number>>, prev: Partial<Record<LedgerCat, number>>, n = 3): Change[] {
  const a = groupMonth(cur);
  const b = groupMonth(prev);
  const out: Change[] = [];
  for (const s of a.revenue) {
    const d = s.amount - (b.revenue.find((x) => x.id === s.id)?.amount ?? 0);
    out.push({ kind: 'revenue', id: s.id, label: s.id === 'other' ? 'Other income' : s.label, delta: d, good: d > 0 });
  }
  for (const s of a.costs) {
    const d = s.amount - (b.costs.find((x) => x.id === s.id)?.amount ?? 0);
    out.push({ kind: 'cost', id: s.id, label: s.id === 'other' ? 'Other costs' : s.label, delta: d, good: d < 0 });
  }
  return out.filter((c) => Math.abs(c.delta) >= 10_000).sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta)).slice(0, n);
}

/** Facts beyond the statement the tips read (gathered by the caller from the crew and the receivables). */
export interface GlanceFacts {
  /** Pilots on the books (not joining) and the pilots the flying needs (Crew › Planning's sets). */
  pilots: { have: number; need: number };
  cabin: { have: number; need: number };
  /** Aircraft our crews fly (dry-leased out ones aside). */
  aircraft: number;
  /** Average block hours per pilot in the last 28 days. */
  pilotHours28: number;
  /** Pay a month of the crew beyond what the flying needs (with social charges). */
  surplusCost: number;
  /** Unpaid invoices past their due date. */
  overdue: number;
  cashNow: number;
  /** First day the forecast goes below zero (null: it stays above, or cash is already below). */
  zeroAt: Minute | null;
}

/** ACMI operators' crew pay against revenue, roughly (our pricing research: 5–6 crew sets per aircraft at 250–300 BH a month). */
export const CREW_SHARE_TYPICAL: [number, number] = [0.2, 0.3];
/** Block hours a pilot usually flies in 4 weeks (Crew › Utilisation's 60–85 h a month). */
export const PILOT_HOURS_TYPICAL: [number, number] = [60, 85];

export interface Tip {
  id: 'crewShare' | 'oneOff' | 'cashBelow' | 'cashZero' | 'overdue' | 'goodMonth' | 'fixed';
  tone: 'good' | 'warn' | 'bad' | 'info';
  text: string;
  link?: { label: string; tab: 'crew' | 'contracts' | 'finance'; view?: string };
}

const k = (v: number): string => {
  const a = Math.abs(v);
  const s = a >= 1e6 ? `$${(a / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M` : a >= 1e3 ? `$${Math.round(a / 1e3)}K` : `$${Math.round(a)}`;
  return v < 0 ? `−${s}` : s;
};
const signed = (v: number) => (v >= 0 ? `+${k(v)}` : k(v));
const pct = (r: number) => `${Math.round(r * 100)}%`;

/**
 * Up to `max` plain-language tips from a month's numbers, the most useful first. `monthName` is the month as the
 * player reads it ('December'). Pure.
 */
export function financeTips(lines: Partial<Record<LedgerCat, number>>, monthName: string, f: GlanceFacts, oneOffLabel: (cat: LedgerCat) => string, max = 3): Tip[] {
  const gm = groupMonth(lines);
  const v = monthVerdict(lines);
  const tips: Tip[] = [];
  if (f.cashNow < 0) {
    tips.push({ id: 'cashBelow', tone: 'bad', text: `Cash is below zero (${k(f.cashNow)}). The ways out are further down this page: a credit line, paying later, selling invoices.`, link: { label: 'Ways out', tab: 'finance', view: 'debt' } });
  } else if (f.zeroAt !== null) {
    tips.push({ id: 'cashZero', tone: 'warn', text: 'At this pace cash runs out within 90 days (see the cash line below). More flying, or fewer fixed costs, push that day back.', link: { label: 'Find work', tab: 'contracts' } });
  }
  const crew = gm.costs.find((s) => s.id === 'crew')!.amount;
  const share = v.revenue > 0 ? crew / v.revenue : null;
  if (share !== null && share > CREW_SHARE_TYPICAL[1]) {
    const spare = f.pilots.have - f.pilots.need;
    let text = `Crew pay is ${pct(share)} of what you earned in ${monthName}. A busy ACMI operator spends about ${pct(CREW_SHARE_TYPICAL[0])}–${pct(CREW_SHARE_TYPICAL[1])}.`;
    if (spare >= Math.max(4, f.pilots.need * 0.1)) {
      text += ` You have ${f.pilots.have} pilots for ${f.aircraft} flying aircraft; the flying needs about ${f.pilots.need}.`;
      if (f.pilotHours28 < PILOT_HOURS_TYPICAL[0]) text += ` Each flew about ${Math.round(f.pilotHours28)} h in the last 4 weeks (${PILOT_HOURS_TYPICAL[0]}–${PILOT_HOURS_TYPICAL[1]} h is usual).`;
      if (f.surplusCost > 0) text += ` The spare crew cost about ${k(f.surplusCost)} a month.`;
      tips.push({ id: 'crewShare', tone: 'warn', text, link: { label: 'Crew › Utilisation', tab: 'crew', view: 'use' } });
    } else {
      text += ' Your crew are not too many: the aircraft fly too few hours to pay for them. More block hours help most.';
      tips.push({ id: 'crewShare', tone: 'warn', text, link: { label: 'Find work', tab: 'contracts' } });
    }
  }
  if (v.biggestOneOff && v.oneOffs >= Math.max(250_000, v.costs * 0.1)) {
    tips.push({ id: 'oneOff', tone: 'info', text: `${monthName} had a one-off: ${oneOffLabel(v.biggestOneOff.cat)} ${k(-v.biggestOneOff.amount)}. ${v.underlying >= 0 ? `Without the one-offs you would have made ${signed(v.underlying)}.` : `Without the one-offs you would still have lost ${k(-v.underlying)}.`}` });
  }
  if (f.overdue >= 100_000) {
    tips.push({ id: 'overdue', tone: 'warn', text: `Clients are late paying ${k(f.overdue)}. You can sell an invoice to the bank for cash now (Receivables, below).` });
  }
  const fixed = (gm.costs.find((s) => s.id === 'aircraft')!.amount + crew);
  if (v.costs > 0 && fixed / v.costs > 0.5 && tips.length < max) {
    tips.push({ id: 'fixed', tone: 'info', text: `${pct(fixed / v.costs)} of your costs are fixed (crew pay and aircraft rent): they come every month. Every extra block hour flown is almost all profit.` });
  }
  if (v.margin !== null && v.margin >= 0.08 && v.oneOffs < v.costs * 0.1) {
    tips.push({ id: 'goodMonth', tone: 'good', text: `A good month: you kept ${Math.round(v.margin * 100)} cents of every dollar earned.` });
  }
  return tips.slice(0, max);
}

export interface CashPoint { t: Minute; cash: number; ahead: boolean }
export interface CashEvent { t: Minute; cash: number; cat: LedgerCat; amount: number; month: MonthKey }
export interface CashPath {
  points: CashPoint[];
  /** The first forecast day below zero while cash is above it now (null: none). */
  zeroAt: Minute | null;
  /** While cash is below zero now: the first forecast day back above it (null: none in the forecast). */
  backAt: Minute | null;
  /** Big one-off costs in the closed months (at least $1M or 15 % of the month's costs), on the month-end point. */
  events: CashEvent[];
  /** Cash change over the last three closed months plus this one (null with too little history). */
  trend3: number | null;
}

/**
 * The cash line: each closed month's end (the last `months`), the cash now, then the daily forecast. Pure.
 */
export function cashPath(history: readonly MonthStatement[], current: MonthKey, cashNow: number, now: Minute, forecast: readonly { t: number; cash: number }[], months = 12): CashPath {
  const closed = history.filter((m) => m.month < current).sort((a, b) => a.month - b.month).slice(-months);
  const points: CashPoint[] = [];
  if (closed.length) points.push({ t: monthStart(closed[0].month), cash: closed[0].cashStart, ahead: false });
  const events: CashEvent[] = [];
  for (const m of closed) {
    const t = monthStart(m.month + 1);
    points.push({ t, cash: m.cashEnd, ahead: false });
    const one = groupMonth(m.lines).costs.find((s) => s.id === 'oneOff')!;
    const costs = -statementTotals(m.lines).costs;
    const top = one.lines[0];
    if (top && top.amount >= Math.max(1_000_000, costs * 0.15)) events.push({ t, cash: m.cashEnd, cat: top.cat, amount: -top.amount, month: m.month });
  }
  if (!points.length || points[points.length - 1].t < now) points.push({ t: now, cash: cashNow, ahead: false });
  let zeroAt: Minute | null = null;
  let backAt: Minute | null = null;
  for (const p of forecast) {
    if (p.t <= now) continue;
    points.push({ t: p.t, cash: p.cash, ahead: true });
    if (cashNow >= 0 && zeroAt === null && p.cash < 0) zeroAt = p.t;
    if (cashNow < 0 && backAt === null && p.cash >= 0) backAt = p.t;
  }
  const back = closed.length >= 3 ? closed[closed.length - 3].cashStart : null;
  return { points, zeroAt, backAt, events, trend3: back === null ? null : cashNow - back };
}

/** Days from `now` to `t`, rounded up (for 'in 23 days'). */
export const daysUntil = (now: Minute, t: Minute): number => Math.max(0, Math.ceil((t - now) / DAY));
