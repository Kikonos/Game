// v0.7.1 maintenance problems as ProblemCards (UPDATE-0.7.1.md §9.1): AOG, checks due / overdue / grounded, a
// planned check clashing with flights, no ground slot. Numbers from ops/maintenance read APIs. Pure.

import { AIRPORT_BY_CODE } from '../../data/airports';
import { BAL } from '../core/balance';
import { liveFlightsOf } from '../core/entities';
import { typeOf } from '../core/perf';
import { DAY, fmtDateTime, fmtDay, fmtDuration } from '../core/time';
import type { Aircraft, GameState, MaintenanceEvent } from '../core/types';
import { cancelCost, windowLegs } from '../ops/flights';
import { checkStatus } from '../ops/maintenance';
import { isRevenue, usd } from '../ops/util';
import { mkHurt, type GaugeSpec, type ProblemCard, type TimelineSpec } from './types';

const city = (code: string) => AIRPORT_BY_CODE[code]?.city ?? code;
const paxOf = (ac: Aircraft, legs: { pax?: number; kind: string }[]) => legs.reduce((n, f) => n + (f.kind === 'revenue' || f.kind === 'techstop' ? f.pax ?? Math.round(ac.cabin.total * 0.85) : 0), 0);

function checkGauge(g: GameState, ac: Aircraft, kind: 'A' | 'C'): GaugeSpec {
  const st = checkStatus(g, ac);
  const used = Math.round((kind === 'A' ? st.aUsed : st.cUsed) * 100);
  return { id: kind === 'A' ? 'aCheck' : 'cCheck', label: `${kind}-check`, value: Math.min(100, used), limit: 100, unit: 'pct', text: `${used}% used`, tone: used >= 100 ? 'bad' : used >= 95 ? 'bad' : used >= 75 ? 'warn' : 'good', by: kind === 'A' ? st.aDue : st.cDue };
}

/** The AOG in work on an aircraft (null when it flies). */
function aogOf(g: GameState, ac: Aircraft): MaintenanceEvent | null {
  const m = ac.maintId ? g.maintenance[ac.maintId] : undefined;
  return m && m.kind === 'AOG' && m.status === 'inWork' ? m : null;
}

export function aogCard(g: GameState, aircraftId: string): ProblemCard | null {
  const ac = g.fleet[aircraftId];
  const m = ac ? aogOf(g, ac) : null;
  if (!ac || !m) return null;
  const legs = windowLegs(g, ac, m.at, m.end + 30);
  const rev = legs.filter(isRevenue);
  const pax = paxOf(ac, legs);
  const next = legs[0];
  const money = cancelCost(g, legs) + m.cost;
  const decision = g.decisions.find((d) => d.kind === 'aog' && d.data?.aircraftId === ac.id);
  const timeline: TimelineSpec = {
    from: m.start, to: Math.max(m.end + 60, next ? next.std + next.block : m.end + 60),
    marks: [{ t: m.start, label: 'Fault', tone: 'bad' }, { t: m.end, label: 'Repaired', tone: 'good' }, ...(next ? [{ t: next.std, label: next.no, tone: 'warn' as const }] : [])],
    spans: [{ from: m.start, to: m.end, label: 'Repair', tone: 'bad' }, ...rev.slice(0, 4).map((f) => ({ from: f.std, to: f.sta, label: f.no, tone: 'warn' as const }))],
  };
  const fault = (m.cause ?? 'a fault').toLowerCase().replace(/^technical: /, '');
  // How it is being fixed: the decision taken, else the open decision, else what the fault itself needs (a tyre,
  // brakes, a bird strike or tug damage are fixed on the spot; the rest wait for a part).
  const local = /tyre|brake|bird|tug/i.test(m.cause ?? '');
  const how = m.fix === 'team' ? 'an AOG team flies in' : m.fix === 'courier' ? 'part by courier' : m.fix === 'local' ? 'local fix with the fly-away kit'
    : decision ? 'waiting for your decision' : local ? 'local repair' : 'part by courier';
  return {
    subject: { kind: 'aog', ref: { kind: 'aircraft', id: ac.id } }, severity: 'red',
    title: `${ac.reg} can't fly: ${fault} in ${city(m.at)}`, what: `${ac.reg} can't fly: ${fault} in ${city(m.at)}`,
    why: `Repair about ${fmtDuration(Math.max(0, m.end - g.now))} (${how}); back ${fmtDateTime(m.end)} UTC.`,
    hurt: mkHurt({ money, pax, legs: rev.length, what: 'at stake', empty: !rev.length }),
    actions: [
      ...(decision ? [{ id: 'decide', label: 'Decide', open: { modal: 'decision' as const, id: decision.id }, primary: true }] : []),
      ...(rev.length ? [{ id: 'subcharter', label: 'Sub-charter', open: { modal: 'subcharter' as const, id: rev[0].id }, primary: !decision }] : []),
      { id: 'schedule', label: 'Schedule', open: { tab: 'schedule', sel: { kind: 'aircraft', id: ac.id } } },
    ],
    details: [`${m.cause ?? 'Fault'} since ${fmtDateTime(m.start)} UTC at ${m.at}; repair ${usd(m.cost)}`, ...legs.slice(0, 6).map((f) => `${f.no} ${f.from}–${f.to} ${fmtDateTime(f.std)}`)],
    visuals: { timeline }, terms: ['aog', 'subcharter'], by: m.end,
  };
}

/** Flights the aircraft has scheduled after `t` (grounded means they are lost until the check). */
function legsAfter(g: GameState, ac: Aircraft, t: number, days = 14) {
  return liveFlightsOf(g, ac.id).filter((f) => f.status === 'scheduled' && f.std >= t && f.std < t + days * DAY);
}

export function checkCard(g: GameState, aircraftId: string): ProblemCard | null {
  const ac = g.fleet[aircraftId];
  if (!ac || ac.status === 'delivering' || ac.status === 'leasedOut') return null;
  const st = checkStatus(g, ac);
  const t = typeOf(ac.typeId);
  if (st.grounded) {
    const kind = st.aUsed >= st.cUsed ? 'A' : 'C';
    const due = kind === 'A' ? st.aDue : st.cDue;
    const legs = legsAfter(g, ac, g.now, 7);
    return {
      subject: { kind: 'grounded', ref: { kind: 'aircraft', id: ac.id } }, severity: 'red',
      title: `${ac.reg} is grounded: its ${kind}-check is overdue`, what: `${ac.reg} is grounded: its ${kind}-check is overdue`,
      why: `The ${kind === 'A' ? `${t.aCheckFH} flight-hour / ${BAL.aCheckDays}-day` : `${t.cCheckMonths}-month`} limit passed on ${fmtDay(due)}; passengers may not be carried until it is done.`,
      hurt: mkHurt({ money: cancelCost(g, legs), pax: paxOf(ac, legs), legs: legs.filter(isRevenue).length, what: 'penalty', empty: !legs.length }),
      actions: [{ id: 'planCheck', label: 'Plan check', open: { modal: 'check', id: ac.id }, primary: true }, { id: 'fleet', label: 'Fleet', open: { tab: 'fleet', sel: { kind: 'aircraft', id: ac.id } } }],
      details: [`A-check ${Math.round(st.aUsed * 100)}% used, due ${fmtDay(st.aDue)}; C-check ${Math.round(st.cUsed * 100)}% used, due ${fmtDay(st.cDue)}`],
      visuals: { gauges: [checkGauge(g, ac, kind)] }, terms: [kind === 'A' ? 'aCheck' : 'cCheck'], by: due,
    };
  }
  const which: ('A' | 'C')[] = [];
  if (!st.nextA && (st.aUsed >= 0.75 || st.aDue - g.now <= 14 * DAY)) which.push('A');
  if (!st.nextC && (st.cUsed >= 0.8 || st.cDue - g.now <= 60 * DAY)) which.push('C');
  if (!which.length) return null;
  const kind = which[0];
  const due = kind === 'A' ? st.aDue : st.cDue;
  const used = Math.round((kind === 'A' ? st.aUsed : st.cUsed) * 100);
  const overdue = used >= 100 || due <= g.now;
  const legs = legsAfter(g, ac, due, 7);
  const days = Math.max(0, Math.ceil((due - g.now) / DAY));
  return {
    subject: { kind: overdue ? 'checkOverdue' : 'checkDue', ref: { kind: 'aircraft', id: ac.id } }, severity: overdue || days <= 3 ? 'red' : 'amber',
    title: overdue ? `${ac.reg}'s ${kind}-check is overdue` : `${ac.reg} needs its ${kind}-check by ${fmtDay(due)}`,
    what: overdue ? `${ac.reg}'s ${kind}-check is overdue` : `${ac.reg} needs its ${kind}-check by ${fmtDay(due)}`,
    why: `${used}% of the interval is used and no slot is booked${overdue ? `: it is grounded once ${Math.round(BAL.overdueTolerance * 100)}% over` : ''}.`,
    hurt: mkHurt({ money: cancelCost(g, legs), pax: paxOf(ac, legs), legs: legs.filter(isRevenue).length, what: 'at stake once grounded', extra: legs.length ? `grounded after ${fmtDay(due)}` : undefined }),
    actions: [{ id: 'planCheck', label: 'Plan check', open: { modal: 'check', id: ac.id }, primary: true }, { id: 'schedule', label: 'Schedule', open: { tab: 'schedule', sel: { kind: 'aircraft', id: ac.id } } }],
    details: [`A-check ${Math.round(st.aUsed * 100)}% used (${Math.round(st.aHoursLeft)} FH left), due ${fmtDay(st.aDue)}`, `C-check ${Math.round(st.cUsed * 100)}% used, due ${fmtDay(st.cDue)}`, ...(g.company.policies.autoMaintenance && kind === 'A' ? ['Auto-maintenance will book the A-check when a ground slot fits'] : [])],
    visuals: { gauges: which.map((k) => checkGauge(g, ac, k)) }, terms: [kind === 'A' ? 'aCheck' : 'cCheck'], by: due,
  };
}

/** A planned check whose window overlaps scheduled flights of its aircraft (recovery will move or drop them). */
export function checkClashCard(g: GameState, maintId: string): ProblemCard | null {
  const m = g.maintenance[maintId];
  const ac = m ? g.fleet[m.aircraftId] : undefined;
  if (!m || !ac || m.status !== 'planned') return null;
  const legs = liveFlightsOf(g, ac.id).filter((f) => f.status === 'scheduled' && f.std < m.end && f.sta > m.start && f.kind !== 'ferry');
  if (!legs.length) return null;
  const rev = legs.filter(isRevenue);
  const k = rev[0]?.contractId ? g.contracts[rev[0].contractId] : undefined;
  const label = m.kind === 'A' || m.kind === 'C' ? `${m.kind}-check` : m.kind === 'paint' ? 'paint-shop visit' : m.kind === 'refit' ? 'cabin refit' : m.kind === 'return' ? 'return check' : 'maintenance';
  return {
    subject: { kind: 'checkClash', ref: { kind: 'maint', id: m.id } }, severity: rev.length ? 'red' : 'amber',
    title: `${ac.reg}'s ${label} on ${fmtDay(m.start)} clashes with ${legs.length} flight${legs.length > 1 ? 's' : ''}`,
    what: `${ac.reg}'s ${label} on ${fmtDay(m.start)} clashes with ${legs.length} flight${legs.length > 1 ? 's' : ''}`,
    why: k ? `${g.clients[k.clientId]?.name ?? 'The client'}'s ${k.title} runs until ${fmtDay(k.end)}; the aircraft can't be in ${city(m.at)} and flying at once.` : `${legs[0].no} ${legs[0].from}–${legs[0].to} leaves ${fmtDateTime(legs[0].std)} UTC, inside the check.`,
    hurt: mkHurt({ money: cancelCost(g, legs), pax: paxOf(ac, legs), legs: rev.length, what: 'penalty', empty: !rev.length }),
    actions: [{ id: 'reschedule', label: 'Move the check', open: { modal: 'check', id: ac.id }, primary: true }, ...(rev.length ? [{ id: 'subcharter', label: 'Sub-charter', open: { modal: 'subcharter' as const, id: rev[0].id } }] : [])],
    details: legs.slice(0, 6).map((f) => `${f.no} ${f.from}–${f.to} ${fmtDateTime(f.std)}`),
    visuals: { timeline: { from: Math.min(m.start, legs[0].std) - 60, to: Math.max(m.end, legs[legs.length - 1].sta) + 60, marks: [{ t: m.start, label: `${label} starts`, tone: 'warn' }, { t: m.end, label: 'done', tone: 'good' }], spans: [{ from: m.start, to: m.end, label, tone: 'off' }, ...legs.slice(0, 5).map((f) => ({ from: f.std, to: f.sta, label: f.no, tone: 'bad' as const }))] } },
    terms: [m.kind === 'C' ? 'cCheck' : 'aCheck'], by: m.start,
  };
}

/** An A-check the planner could not fit before its due date (the aircraft flies every night). */
export function noSlotCard(g: GameState, aircraftId: string): ProblemCard | null {
  const ac = g.fleet[aircraftId];
  if (!ac || ac.status === 'delivering') return null;
  const st = checkStatus(g, ac);
  if (st.nextA || !ac.maint.aWarned || st.aDue - g.now > 7 * DAY || st.grounded) return null;
  const legs = legsAfter(g, ac, st.aDue, 7);
  return {
    subject: { kind: 'checkNoSlot', ref: { kind: 'aircraft', id: ac.id } }, severity: 'amber',
    title: `No ground slot for ${ac.reg}'s A-check before ${fmtDay(st.aDue)}`, what: `No ground slot for ${ac.reg}'s A-check before ${fmtDay(st.aDue)}`,
    why: `The aircraft flies every night until then: a ${typeOf(ac.typeId).aCheckHours} h slot needs a wave dropped or a quieter day.`,
    hurt: mkHurt({ money: cancelCost(g, legs), pax: paxOf(ac, legs), legs: legs.filter(isRevenue).length, what: 'at stake once grounded' }),
    actions: [{ id: 'planCheck', label: 'Plan check', open: { modal: 'check', id: ac.id }, primary: true }, { id: 'schedule', label: 'Schedule', open: { tab: 'schedule', sel: { kind: 'aircraft', id: ac.id } } }],
    details: [`A-check ${Math.round(st.aUsed * 100)}% used, ${Math.round(st.aHoursLeft)} FH left`], visuals: { gauges: [checkGauge(g, ac, 'A')] }, terms: ['aCheck'], by: st.aDue,
  };
}

export function techProblems(g: GameState): ProblemCard[] {
  const out: ProblemCard[] = [];
  for (const ac of Object.values(g.fleet)) {
    const a = aogCard(g, ac.id);
    if (a) out.push(a);
    const c = checkCard(g, ac.id);
    if (c) out.push(c);
    else {
      const n = noSlotCard(g, ac.id);
      if (n) out.push(n);
    }
  }
  for (const m of Object.values(g.maintenance)) {
    if (m.status !== 'planned' || m.start > g.now + 14 * DAY) continue;
    const c = checkClashCard(g, m.id);
    if (c) out.push(c);
  }
  return out;
}
