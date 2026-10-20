// Maintenance planning, checks and AOG (B3). DESIGN.md §5.6.

import { AIRPORT_BY_CODE } from '../../data/airports';
import { BAL } from '../core/balance';
import { flightsOf, nextId, removeFlights, touchFlights } from '../core/entities';
import { post } from '../core/ledger';
import { pushMessage } from '../core/messages';
import { blockMinutes, typeOf } from '../core/perf';
import { requestPause } from '../core/pause';
import { schedule } from '../core/queue';
import { int, pick, range } from '../core/rng';
import { DAY, fmtDate, fmtDateTime, fmtDay, toDate } from '../core/time';
import type { ActionResult, Aircraft, Flight, GameState, MaintenanceEvent, MaintKind, Minute, SimEvent } from '../core/types';
import { clamp } from '../core/util';
import { planPositioning } from '../contracts';
import { aogDecision } from './events';
import { cancelLegs } from './flights';
import { ageOf, bumpRelation, contractOf, isRevenue, stats, usd } from './util';

export interface CheckStatus {
  /** A-check: flight hours remaining and due date (FH limit reached by planned flying, or the calendar, whichever first). */
  aHoursLeft: number;
  aDue: Minute;
  /** C-check calendar due date and FH remaining. */
  cDue: Minute;
  cHoursLeft: number;
  /** Next planned events. */
  nextA: string | null;
  nextC: string | null;
  /** 0–1 AOG risk indicator for the UI. */
  risk: number;
  /** Share of the A and C intervals used (0–1+). */
  aUsed: number;
  cUsed: number;
  /** Past the 10% tolerance: departures are cancelled until the check is done. */
  grounded: boolean;
}

const MONTH = 30.44 * DAY;
const cLimitFH = (ac: Aircraft) => (typeOf(ac.typeId).body === 'wide' ? BAL.cCheckFH.wide : BAL.cCheckFH.narrow);
const checkCostOf = (ac: Aircraft, kind: 'A' | 'C') => BAL.checkCost[kind][typeOf(ac.typeId).body === 'wide' ? 1 : 0];
const durationOf = (ac: Aircraft, kind: 'A' | 'C') => (kind === 'A' ? typeOf(ac.typeId).aCheckHours * 60 : typeOf(ac.typeId).cCheckDays * DAY);

function nextPlanned(g: GameState, acId: string, kind: MaintKind): MaintenanceEvent | undefined {
  let best: MaintenanceEvent | undefined;
  for (const m of Object.values(g.maintenance)) {
    if (m.aircraftId !== acId || m.kind !== kind || (m.status !== 'planned' && m.status !== 'inWork')) continue;
    if (!best || m.start < best.start) best = m;
  }
  return best;
}

/** When the A-check falls due: FH limit reached by the planned legs (extrapolated past the schedule), or the calendar. */
function aDueOf(g: GameState, ac: Aircraft): Minute {
  const lim = typeOf(ac.typeId).aCheckFH;
  const cal = ac.maint.lastA + BAL.aCheckDays * DAY;
  let fh = ac.maint.fhSinceA;
  if (fh >= lim) return Math.min(cal, g.now);
  let last = g.now;
  let flown = 0;
  for (const f of flightsOf(g, ac.id)) {
    if (f.status !== 'scheduled' && f.status !== 'enroute') continue;
    if (f.std >= cal) return cal;
    const h = Math.max(0, f.block - 20) / 60;
    if (fh + h >= lim) return Math.min(cal, f.std);
    fh += h;
    flown += h;
    last = f.sta;
  }
  const days = (last - g.now) / DAY;
  if (days < 3 || flown <= 0) return cal;
  return Math.min(cal, Math.round(last + ((lim - fh) / (flown / days)) * DAY));
}

/** Check status for the Fleet screen and planning. Pure. */
export function checkStatus(g: GameState, ac: Aircraft): CheckStatus {
  const t = typeOf(ac.typeId);
  const m = ac.maint;
  const aUsed = Math.max(m.fhSinceA / t.aCheckFH, (g.now - m.lastA) / (BAL.aCheckDays * DAY));
  const cCal = m.lastC + t.cCheckMonths * MONTH;
  const cUsed = Math.max(m.fhSinceC / cLimitFH(ac), (g.now - m.lastC) / (t.cCheckMonths * MONTH));
  const tol = 1 + BAL.overdueTolerance;
  return {
    aHoursLeft: Math.round(t.aCheckFH - m.fhSinceA),
    aDue: aDueOf(g, ac),
    cDue: Math.round(cCal),
    cHoursLeft: Math.round(cLimitFH(ac) - m.fhSinceC),
    nextA: nextPlanned(g, ac.id, 'A')?.id ?? null,
    nextC: nextPlanned(g, ac.id, 'C')?.id ?? null,
    risk: clamp(aogChance(g, ac, ac.at) / (BAL.aogBase * 12), 0, 1),
    aUsed,
    cUsed,
    grounded: aUsed > tol || cUsed > tol,
  };
}

/** Past the overdue tolerance on either check (ferry flights to the check are still allowed). */
export function isGrounded(g: GameState, ac: Aircraft): boolean {
  const t = typeOf(ac.typeId);
  const m = ac.maint;
  const tol = 1 + BAL.overdueTolerance;
  return m.fhSinceA > t.aCheckFH * tol || g.now - m.lastA > BAL.aCheckDays * DAY * tol || m.fhSinceC > cLimitFH(ac) * tol || g.now - m.lastC > t.cCheckMonths * MONTH * tol;
}

/** Our engineers are at home base and at the base of a running base programme the aircraft flies. */
function engineersAt(g: GameState, acId: string, airport: string): boolean {
  if (airport === g.company.homeBase) return true;
  for (const c of Object.values(g.contracts)) {
    if ((c.status === 'active' || c.status === 'signed') && c.pattern.kind === 'base' && c.pattern.base === airport && c.aircraftIds.includes(acId)) return true;
  }
  return false;
}

/** AOG probability for the next departure: base × (1 + age/10) × (1 + 4 × deferred) × outstation 1.5. Pure. */
export function aogChance(g: GameState, ac: Aircraft, airport: string): number {
  const out = engineersAt(g, ac.id, airport) ? 1 : BAL.aogOutstation;
  return BAL.aogBase * (1 + ageOf(g, ac) / 10) * (1 + 4 * ac.maint.deferred) * out;
}

/** A-checks at home base or any major airport (size ≥ 4); C-checks at home base only. */
export function checkAirportOk(g: GameState, kind: 'A' | 'C', at: string): boolean {
  if (at === g.company.homeBase) return true;
  return kind === 'A' && (AIRPORT_BY_CODE[at]?.size ?? 0) >= 4;
}

/** Wet base-programme revenue legs we may drop for a check: ≥ 12 h notice, no penalty, MGH unaffected. */
function droppableForCheck(g: GameState, f: Flight): boolean {
  const c = contractOf(g, f);
  return f.status === 'scheduled' && isRevenue(f) && c?.product.kind === 'wet' && c.pattern.kind === 'base' && f.std >= g.now + BAL.maintNotice;
}

/** Where the aircraft will be at time t (last arrival before t), from its legs and checks. */
function locationAt(g: GameState, ac: Aircraft, t: Minute): { at: string; free: Minute } {
  let at = ac.at;
  let free = g.now;
  if (ac.flightId) {
    const f = g.flights[ac.flightId];
    if (f) {
      at = f.to;
      free = f.eta ?? f.sta;
    }
  }
  for (const f of flightsOf(g, ac.id)) {
    if (f.status !== 'scheduled' || f.sta > t) continue;
    if (f.sta >= free) {
      at = f.to;
      free = f.sta;
    }
  }
  return { at, free };
}

/**
 * Books a check at an airport from `start` (blocks the aircraft). Flights in the way must be cleared first, except
 * with `dropLegs` (auto-planner): wet base-programme legs with ≥ 12 h notice are cancelled (no penalty, relation −2).
 * A ferry is booked when the aircraft would be elsewhere (B1 planPositioning).
 */
export function scheduleCheck(g: GameState, aircraftId: string, kind: MaintKind, start: Minute, at: string, opts: { dropLegs?: boolean; auto?: boolean } = {}): ActionResult<{ maintId: string }> {
  const ac = g.fleet[aircraftId];
  if (!ac) return { ok: false, error: 'Aircraft not found' };
  if (kind !== 'A' && kind !== 'C') return { ok: false, error: 'Only A- and C-checks can be booked' };
  if (ac.status === 'delivering' || ac.status === 'stored' || ac.status === 'leasedOut') return { ok: false, error: `${ac.reg} is not on the AOC` };
  if (!AIRPORT_BY_CODE[at]) return { ok: false, error: 'Unknown airport' };
  if (!checkAirportOk(g, kind, at)) return { ok: false, error: kind === 'C' ? 'C-checks are done at the home base' : 'A-checks need the home base or a major airport' };
  if (nextPlanned(g, ac.id, kind)) return { ok: false, error: `${ac.reg} already has a ${kind}-check booked` };
  start = Math.round(Math.max(start, g.now));
  const end = start + durationOf(ac, kind);
  const turn = typeOf(ac.typeId).turnMin;
  const clash = flightsOf(g, ac.id).filter((f) => (f.status === 'scheduled' || f.status === 'enroute') && f.std < end + 30 && (f.eta ?? f.sta) > start - 30);
  const hard = clash.filter((f) => f.kind !== 'positioning');
  if (hard.some((f) => f.status === 'enroute')) return { ok: false, error: `${ac.reg} is flying then` };
  if (hard.length && !(opts.dropLegs && hard.every((f) => droppableForCheck(g, f)))) {
    return { ok: false, error: `Clashes with ${hard.length} flight${hard.length > 1 ? 's' : ''} (${hard[0].no} ${fmtDateTime(hard[0].std)})` };
  }
  const other = Object.values(g.maintenance).find((m) => m.aircraftId === ac.id && (m.status === 'planned' || m.status === 'inWork') && m.start < end && m.end > start);
  if (other) return { ok: false, error: `Overlaps the ${other.kind} event ${fmtDay(other.start)}` };
  // Reachability before touching anything.
  const before = clash.length ? Math.min(start, ...clash.map((f) => f.std)) : start;
  const loc = locationAt(g, ac, before - 1);
  const needFerry = loc.at !== at;
  if (needFerry && loc.free + turn + blockMinutes(ac.typeId, loc.at, at) + 30 > start) return { ok: false, error: `${ac.reg} can't reach ${at} by then` };
  // Clear the way.
  const drop = hard.filter((f) => f.status === 'scheduled');
  for (const f of drop) bumpRelation(g, contractOf(g, f)?.clientId, -1);
  if (drop.length) cancelLegs(g, drop, `${kind}-check`, 0);
  const soft = clash.filter((f) => f.kind === 'positioning' && f.status === 'scheduled');
  if (soft.length) removeFlights(g, soft.map((f) => f.id));
  const m: MaintenanceEvent = {
    id: nextId(g, 'mx'), aircraftId: ac.id, kind, at, start, end, cost: checkCostOf(ac, kind), status: 'planned', planned: true, ev: 0,
  };
  g.maintenance[m.id] = m;
  if (needFerry) {
    const legs = planPositioning(g, ac.id, at, start, 'ferry', null);
    if (legs?.length) m.ferryIds = legs.map((f) => f.id);
  }
  schedule(g, start, 'maint.start', m.id, m.ev);
  touchFlights(g);
  const where = AIRPORT_BY_CODE[at]?.city ?? at;
  const msg = `${kind}-check for ${ac.reg} at ${where}, ${fmtDateTime(start)}–${fmtDateTime(end)} UTC${drop.length ? ` (${drop.length} leg${drop.length > 1 ? 's' : ''} dropped with notice)` : ''}`;
  pushMessage(g, { tone: 'info', cat: 'tech', title: `${kind}-check booked: ${ac.reg}`, body: `${msg}.${opts.auto ? ' Planned automatically.' : ''}`, ref: { kind: 'maint', id: m.id } });
  return { ok: true, msg, data: { maintId: m.id } };
}

export function cancelCheck(g: GameState, maintId: string): ActionResult {
  const m = g.maintenance[maintId];
  if (!m) return { ok: false, error: 'Check not found' };
  if (m.status !== 'planned') return { ok: false, error: m.status === 'inWork' ? 'The check is already in work' : 'Not a planned check' };
  if (m.kind === 'AOG') return { ok: false, error: 'An AOG repair cannot be cancelled' };
  m.status = 'cancelled';
  m.ev++;
  const ferries = (m.ferryIds ?? []).filter((id) => g.flights[id]?.status === 'scheduled');
  if (ferries.length) removeFlights(g, ferries);
  touchFlights(g);
  return { ok: true, msg: `${m.kind}-check cancelled` };
}

// ---------- planning ----------

interface Gap {
  from: Minute;
  to: Minute;
  at: string;
}

/** Ground gaps of an aircraft in [from, until): between legs, checks and the not-yet-generated tail of base programmes. */
export function groundGaps(g: GameState, ac: Aircraft, from: Minute, until: Minute): Gap[] {
  type Busy = { s: Minute; e: Minute; from: string; to: string };
  const busy: Busy[] = [];
  for (const f of flightsOf(g, ac.id)) {
    if (f.status !== 'scheduled' && f.status !== 'enroute') continue;
    busy.push({ s: f.status === 'enroute' ? (f.atd ?? f.std) : f.std, e: f.status === 'enroute' ? (f.eta ?? f.sta) : f.sta, from: f.from, to: f.to });
  }
  for (const m of Object.values(g.maintenance)) {
    if (m.aircraftId === ac.id && (m.status === 'planned' || m.status === 'inWork')) busy.push({ s: m.start, e: m.end, from: m.at, to: m.at });
  }
  for (const c of Object.values(g.contracts)) {
    if ((c.status !== 'signed' && c.status !== 'active') || c.pattern.kind !== 'base' || !c.aircraftIds.includes(ac.id)) continue;
    if (c.generatedUntil < c.pattern.to) busy.push({ s: Math.max(c.generatedUntil, c.pattern.from), e: c.pattern.to, from: c.pattern.base, to: c.pattern.base });
  }
  busy.sort((a, b) => a.s - b.s || a.e - b.e);
  const out: Gap[] = [];
  let t = Math.max(from, ac.deliveredAt);
  let at = ac.at;
  for (const b of busy) {
    if (b.e <= t) {
      at = b.to;
      continue;
    }
    if (b.s > t && t < until) out.push({ from: t, to: Math.min(b.s, until), at });
    t = Math.max(t, b.e);
    at = b.to;
  }
  if (t < until) out.push({ from: t, to: until, at });
  return out;
}

/** Books the A-check into the first ground gap before it falls due (home/major airport, else a ferry home). */
function planA(g: GameState, ac: Aircraft, due: Minute): boolean {
  const dur = durationOf(ac, 'A');
  const t = typeOf(ac.typeId);
  const home = g.company.homeBase;
  const gaps = groundGaps(g, ac, g.now + 30, due);
  for (const gp of gaps) {
    if (!checkAirportOk(g, 'A', gp.at)) continue;
    const buf = gp.at === home ? 60 : 120;
    const start = gp.from + 30;
    if (start + dur + buf - 30 <= gp.to && scheduleCheck(g, ac.id, 'A', start, gp.at, { auto: true }).ok) return true;
  }
  for (const gp of gaps) {
    if (checkAirportOk(g, 'A', gp.at)) continue;
    const out = blockMinutes(ac.typeId, gp.at, home);
    const start = gp.from + t.turnMin + out + 30;
    if (start + dur + 60 + t.turnMin + out <= gp.to && scheduleCheck(g, ac.id, 'A', start, home, { auto: true }).ok) return true;
  }
  // No gap: drop one base-programme wave (out and back) with notice to make a night at an eligible base.
  const legs = flightsOf(g, ac.id).filter((f) => f.status === 'scheduled');
  for (let i = 0; i < legs.length; i++) {
    const x = legs[i];
    if (x.std >= due) break;
    if (!droppableForCheck(g, x) || !checkAirportOk(g, 'A', x.from)) continue;
    let j = i;
    while (j + 1 < legs.length && legs[j].to !== x.from && droppableForCheck(g, legs[j + 1])) j++;
    if (legs[j].to !== x.from) continue;
    const prevEnd = i > 0 ? legs[i - 1].sta : g.now;
    const nextStart = j + 1 < legs.length ? legs[j + 1].std : Infinity;
    const start = Math.max(prevEnd + 30, x.std - 6 * 60, g.now + BAL.maintNotice);
    if (start + dur + 90 > nextStart || start + dur > due) continue;
    if (scheduleCheck(g, ac.id, 'A', start, x.from, { auto: true, dropLegs: true }).ok) return true;
  }
  return false;
}

/** First gap of at least the C-check length before `due`, preferring November–March. */
function suggestC(g: GameState, ac: Aircraft, due: Minute): Gap | null {
  const need = durationOf(ac, 'C') + DAY;
  const gaps = groundGaps(g, ac, g.now + DAY, due).filter((x) => x.to - x.from >= need);
  const winter = gaps.find((x) => {
    const m = toDate(x.from).getUTCMonth();
    return m >= 10 || m <= 2;
  });
  return winter ?? gaps[0] ?? null;
}

/** Daily: auto-plan A-checks (policy), C-check warnings at 90/60/30 days, forced checks for grounded aircraft. */
export function planChecks(g: GameState): void {
  for (const ac of Object.values(g.fleet)) {
    if (ac.status === 'delivering' || ac.status === 'stored' || ac.status === 'leasedOut') continue;
    const st = checkStatus(g, ac);
    // A-check.
    if (!st.nextA && (st.aUsed >= BAL.planAt || st.aDue - g.now <= BAL.planAheadDays * DAY)) {
      const booked = g.company.policies.autoMaintenance && planA(g, ac, Math.max(st.aDue, g.now + DAY));
      if (!booked && st.aDue - g.now <= 7 * DAY && (ac.maint.aWarned ?? 0) < g.now - 3 * DAY) {
        ac.maint.aWarned = g.now;
        pushMessage(g, {
          tone: 'warn', cat: 'tech', title: `A-check due: ${ac.reg}`,
          body: `Due ${fmtDate(st.aDue)} (${Math.max(0, st.aHoursLeft)} FH left)${g.company.policies.autoMaintenance ? ' and no ground slot is free' : ''}. Book it on the Fleet screen or free the aircraft for a night.`,
          ref: { kind: 'aircraft', id: ac.id },
        });
      }
    }
    // C-check warnings (never auto-booked).
    if (!st.nextC) {
      const days = Math.floor((st.cDue - g.now) / DAY);
      for (const w of BAL.cWarnDays) {
        if (days > w || (ac.maint.cWarned ?? Infinity) <= w) continue;
        ac.maint.cWarned = w;
        const s = suggestC(g, ac, st.cDue);
        const dur = typeOf(ac.typeId).cCheckDays;
        pushMessage(g, {
          tone: w <= 30 ? 'bad' : 'warn', cat: 'tech', title: `C-check due in ${Math.max(0, days)} days: ${ac.reg}`,
          body: `${dur} days at ${g.company.homeBase}, due ${fmtDate(st.cDue)}. ${s ? `Free window: ${fmtDay(s.from)}–${fmtDay(s.to)}${s.to - s.from > 60 * DAY ? ' (open)' : ''}.` : 'No free window yet: plan around your contracts.'} Winter checks cost no summer revenue.`,
          ref: { kind: 'aircraft', id: ac.id },
        });
        break;
      }
    }
    if (st.grounded && ac.status === 'available' && !ac.flightId) forceCheck(g, ac, st);
  }
}

/** Grounded past tolerance: book the overdue check at once (here if possible, else at home after a ferry). */
function forceCheck(g: GameState, ac: Aircraft, st: CheckStatus): void {
  const kind: 'A' | 'C' = st.cUsed > 1 + BAL.overdueTolerance ? 'C' : 'A';
  if (nextPlanned(g, ac.id, kind)) return;
  const at = checkAirportOk(g, kind, ac.at) ? ac.at : g.company.homeBase;
  const dur = durationOf(ac, kind);
  const start = g.now + (at === ac.at ? 60 : 60 + typeOf(ac.typeId).turnMin + blockMinutes(ac.typeId, ac.at, at));
  const legs = flightsOf(g, ac.id).filter((f) => f.status === 'scheduled' && f.std < start + dur + 60);
  if (legs.length) cancelLegs(g, legs, `${ac.reg} grounded`, 1);
  const r = scheduleCheck(g, ac.id, kind, start, at);
  if (r.ok) pushMessage(g, { tone: 'bad', cat: 'tech', title: `${ac.reg} grounded for its ${kind}-check`, body: `The check was overdue. ${legs.length} legs cancelled.`, ref: { kind: 'aircraft', id: ac.id } });
}

// ---------- events ----------

/** 'maint.start': the aircraft goes into the hangar (waits for a late arrival or an AOG fix first). */
export function onMaintStart(g: GameState, ev: SimEvent): void {
  const m = g.maintenance[ev.id];
  if (!m || m.ev !== ev.v || m.status !== 'planned') return;
  const ac = g.fleet[m.aircraftId];
  if (!ac) return;
  let ready = g.now;
  if (ac.flightId) {
    const f = g.flights[ac.flightId];
    ready = f ? (f.eta ?? f.sta) + 30 : g.now + 60;
  } else if (ac.status === 'aog' || ac.status === 'maintenance') {
    const cur = ac.maintId ? g.maintenance[ac.maintId] : undefined;
    ready = cur && cur.end > g.now ? cur.end : g.now + 60;
  } else if (ac.at !== m.at) {
    // Not there and no way in: give the slot up; the planner books another.
    if (g.now - m.start > DAY || !flightsOf(g, ac.id).some((f) => f.status === 'scheduled' && f.to === m.at && f.std < g.now + DAY)) {
      m.status = 'cancelled';
      m.ev++;
      touchFlights(g);
      pushMessage(g, { tone: 'warn', cat: 'tech', title: `${m.kind}-check missed: ${ac.reg}`, body: `${ac.reg} is at ${ac.at}, not ${m.at}. The check needs a new slot.`, ref: { kind: 'aircraft', id: ac.id } });
      return;
    }
    ready = g.now + 60;
  }
  if (ready > g.now) {
    const dur = m.end - m.start;
    m.start = ready;
    m.end = ready + dur;
    m.ev++;
    schedule(g, m.start, 'maint.start', m.id, m.ev);
    touchFlights(g);
    return;
  }
  m.status = 'inWork';
  ac.status = 'maintenance';
  ac.maintId = m.id;
  schedule(g, m.end, 'maint.end', m.id, m.ev);
  touchFlights(g);
}

/** 'maint.end': counters reset, cost posted, back in service. */
export function onMaintEnd(g: GameState, ev: SimEvent): void {
  const m = g.maintenance[ev.id];
  if (!m || m.ev !== ev.v || m.status !== 'inWork') return;
  m.status = 'done';
  const ac = g.fleet[m.aircraftId];
  if (m.kind === 'AOG') post(g, 'maintenance', -m.cost);
  else post(g, 'checks', -m.cost);
  touchFlights(g);
  if (!ac) return;
  const mc = ac.maint;
  if (m.kind === 'A' || m.kind === 'C') {
    mc.fhSinceA = 0;
    mc.lastA = g.now;
    mc.deferred *= 0.3;
    delete mc.aWarned;
  }
  if (m.kind === 'C') {
    mc.fhSinceC = 0;
    mc.lastC = g.now;
    mc.deferred = 0;
    delete mc.cWarned;
  }
  if (m.kind === 'AOG') mc.deferred *= 0.7;
  if (ac.maintId === m.id) ac.maintId = null;
  if (ac.status === 'maintenance' || ac.status === 'aog') ac.status = 'available';
  pushMessage(g, {
    tone: m.kind === 'AOG' ? 'good' : 'info', cat: 'tech',
    title: m.kind === 'AOG' ? `${ac.reg} back in service` : `${m.kind}-check done: ${ac.reg}`,
    body: m.kind === 'AOG' ? `${m.cause ?? 'Fault'} fixed at ${m.at}. Repair ${usd(m.cost)}.` : `${ac.reg} is released to service at ${m.at}. ${usd(m.cost)}.`,
    ref: { kind: 'aircraft', id: ac.id },
  });
}

// ---------- AOG ----------

const CAUSES = ['Hydraulic leak', 'Bleed air fault', 'Bird strike', 'Brake wear beyond limits', 'Tyre damage', 'IDG fault', 'APU failure', 'Avionics fault', 'Ground damage by a tug', 'Cracked windshield'];

/** AOG at departure: the aircraft is grounded at the gate, the clock pauses and the recovery decision opens. */
export function startAog(g: GameState, ac: Aircraft, f: Flight): void {
  const out = !engineersAt(g, ac.id, f.from);
  const hours = int(g, BAL.aogHours[0], BAL.aogHours[1]) * (out ? BAL.aogOutstation : 1);
  const m: MaintenanceEvent = {
    id: nextId(g, 'mx'), aircraftId: ac.id, kind: 'AOG', at: f.from, start: g.now, end: g.now + Math.round(hours * 60),
    cost: Math.round(range(g, BAL.courierCost[0], BAL.courierCost[1]) / 100) * 100, status: 'inWork', planned: false, cause: pick(g, CAUSES), ev: 0,
  };
  g.maintenance[m.id] = m;
  ac.status = 'aog';
  ac.maintId = m.id;
  schedule(g, m.end, 'maint.end', m.id, m.ev);
  stats(g).aogs++;
  requestPause('aog');
  aogDecision(g, ac, f, m);
  touchFlights(g);
}

/** Changes an AOG repair's end (AOG team flown in). */
export function setAogEnd(g: GameState, m: MaintenanceEvent, end: Minute): void {
  m.end = Math.max(g.now + 30, end);
  m.ev++;
  schedule(g, m.end, 'maint.end', m.id, m.ev);
}
