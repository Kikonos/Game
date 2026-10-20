// Random operational events and the decision resolvers (B3). DESIGN.md §5.8.
// Every resolver is keyed by decision.kind; it applies its effects and the decision is removed.

import { AIRPORT_BY_CODE } from '../../data/airports';
import { BAL } from '../core/balance';
import { addFlight, flightsOf, reassignFlights } from '../core/entities';
import { cashOnly, post } from '../core/ledger';
import { pushDecision, pushMessage } from '../core/messages';
import { blockMinutes, reportMinutes, typeOf } from '../core/perf';
import { schedule } from '../core/queue';
import { chance, int, pick, range } from '../core/rng';
import { DAY, fmtDateTime, fmtDay, fmtDuration, fmtTime, localMinuteOfDay, toDate } from '../core/time';
import type { ActionResult, Aircraft, Contract, Decision, DecisionOption, Flight, GameState, MaintenanceEvent, MessageCat, Minute, Receivable, SimEvent } from '../core/types';
import { generateOffer, planPositioning } from '../contracts';
import { applyDiscretion, flightCrewStatus, replaceCrew, rerosterFrom } from '../crew';
import { applyHold, cancelCost, cancelLegs, delayChain, moveFlight, pickRival, planHold, subcharterCost, subcharterLegs, windowLegs } from './flights';
import { setAogEnd } from './maintenance';
import { bumpReliable, bumpRelation, isRevenue, stats, turnOf, usd } from './util';

type Data = Record<string, string | number | boolean>;
const num = (d: Data | undefined, k: string) => Number(d?.[k] ?? 0);
const str = (d: Data | undefined, k: string) => String(d?.[k] ?? '');
const city = (code: string) => AIRPORT_BY_CODE[code]?.city ?? code;
const rivalName = (g: GameState, id: string) => g.rivals.find((r) => r.id === id)?.name ?? 'a rival operator';
const revCount = (legs: Flight[]) => legs.filter(isRevenue).length;
const legsChip = (legs: Flight[]) => `${revCount(legs)} leg${revCount(legs) === 1 ? '' : 's'}`;

/** An open decision of this kind about an aircraft or flight. */
export function hasOpenDecision(g: GameState, kind: string, key: string): boolean {
  return g.decisions.some((d) => d.kind === kind && (d.data?.aircraftId === key || d.data?.flightId === key || d.ref?.id === key));
}

/** Decisions posted in the last 7 days (pacing budget; pruned here). */
function recentAsks(g: GameState): number[] {
  const s = stats(g);
  s.askedAt = (s.askedAt ?? []).filter((t) => t > g.now - 7 * DAY);
  return s.askedAt;
}

/** An optional question fits the pacing: fewer than 2 open and fewer than 3 this week. */
const canAsk = (g: GameState) => g.decisions.length < BAL.maxOpenDecisions && recentAsks(g).length < BAL.maxDecisionsWeek;

const CAT: Record<string, MessageCat> = { aog: 'tech', crewShort: 'crew', sickCrew: 'crew', latePayment: 'finance', rescue: 'finance', changeRequest: 'commercial' };

/**
 * Posts a decision, or (pacing: 2 open / 3 a week, unless `must`) lets operations apply the default option at once
 * and reports it in the inbox.
 */
function ask(g: GameState, d: Omit<Decision, 'id' | 't'>, must = false): void {
  if (!must && !canAsk(g)) {
    const fn = RESOLVERS[d.kind];
    const r = fn ? fn(g, { ...d, id: '', t: g.now }, d.defaultOption) : null;
    const opt = d.options.find((o) => o.id === d.defaultOption);
    pushMessage(g, { tone: 'info', cat: CAT[d.kind] ?? 'ops', title: d.title, body: `${d.body} Operations chose: ${opt?.label ?? d.defaultOption}.${r && r.ok && r.msg ? ` ${r.msg}.` : ''}`, ref: d.ref });
    return;
  }
  recentAsks(g).push(g.now);
  pushDecision(g, d);
}

// ---------- AOG ----------

interface Swap {
  ac: Aircraft;
  from: string;
  arrive: Minute;
  moves: { f: Flight; std: Minute }[];
}

/** Another aircraft of the family that can reach `at` and fly the window legs without touching its own work. Pure. */
function findSwap(g: GameState, ac: Aircraft, legs: Flight[], at: string): Swap | null {
  if (!revCount(legs)) return null;
  const fam = typeOf(ac.typeId).family;
  let best: Swap | null = null;
  for (const b of Object.values(g.fleet)) {
    if (b.id === ac.id || typeOf(b.typeId).family !== fam || b.cabin.total < ac.cabin.total * 0.9) continue;
    if (b.status !== 'available' && b.status !== 'flying') continue;
    const cur = b.flightId ? g.flights[b.flightId] : undefined;
    const from = cur ? cur.to : b.at;
    const ready = cur ? (cur.eta ?? cur.sta) + turnOf(b) : g.now;
    const arrive = from === at ? ready : Math.max(ready, g.now + 60) + blockMinutes(b.typeId, from, at);
    const turn = turnOf(b);
    let t = arrive + (from === at ? 30 : turn);
    const moves = legs.map((f) => {
      const std = Math.max(f.std, t);
      t = std + f.block + turn;
      return { f, std };
    });
    const busyTo = t + 3 * 60;
    const clash = flightsOf(g, b.id).some((f) => f.status === 'scheduled' && f.kind !== 'positioning' && f.std < busyTo && f.sta > g.now);
    const mclash = Object.values(g.maintenance).some((m) => m.aircraftId === b.id && (m.status === 'planned' || m.status === 'inWork') && m.start < busyTo && m.end > g.now);
    if (clash || mclash) continue;
    if (!best || arrive < best.arrive) best = { ac: b, from, arrive, moves };
  }
  return best;
}

export function aogDecision(g: GameState, ac: Aircraft, f: Flight, m: MaintenanceEvent): void {
  const fixC = m.end + 30;
  const teamEnd = g.now + Math.round((m.end - g.now) * BAL.aogTeamFactor);
  const teamCost = Math.round(range(g, BAL.aogTeamCost[0], BAL.aogTeamCost[1]) / 100) * 100;
  const factor = Math.round(range(g, BAL.subcharterFactor[0], BAL.subcharterFactor[1]) * 100) / 100;
  const rivalId = pickRival(g, ac.typeId);
  const holdC = planHold(g, ac, m.at, fixC);
  const holdT = planHold(g, ac, m.at, teamEnd + 30);
  const win = windowLegs(g, ac, m.at, fixC);
  const sub = subcharterCost(g, win, factor);
  const pen = cancelCost(g, win);
  const swap = findSwap(g, ac, win, m.at);
  const hrs = (t: Minute) => `~${Math.round((t - g.now) / 60)} h`;
  const holdChips = (h: ReturnType<typeof planHold>) => {
    const n = revCount(h.cancels);
    return n ? [`${n} leg${n > 1 ? 's' : ''} cancelled`, usd(-cancelCost(g, h.cancels))] : h.moves.length ? [`${h.moves.length} leg${h.moves.length > 1 ? 's' : ''} delayed`] : [];
  };
  const options: DecisionOption[] = [
    { id: 'courier', label: 'Wait for the part', desc: `A spare comes by courier. Legs wait; base legs held over ${BAL.holdMax / 60} h are cancelled.`, tone: 'warn', chips: [hrs(m.end), usd(-m.cost), ...holdChips(holdC)] },
    { id: 'team', label: 'Fly in an AOG team', desc: 'Engineers and the part on the next flight: faster, dearer.', tone: 'warn', chips: [hrs(teamEnd), usd(-(m.cost + teamCost)), ...holdChips(holdT)] },
    swap
      ? { id: 'swap', label: `Swap in ${swap.ac.reg}`, desc: swap.from === m.at ? `${swap.ac.reg} is here and free: it takes over the legs.` : `${swap.ac.reg} ferries ${swap.from}–${m.at} and takes over the legs.`, tone: 'good', chips: [swap.from === m.at ? 'No ferry' : `Ferry ${fmtDuration(swap.arrive - Math.max(g.now + 60, swap.arrive - blockMinutes(swap.ac.typeId, swap.from, m.at)))}`, `First leg ${fmtTime(swap.moves[0]?.std ?? swap.arrive)} UTC`, legsChip(win)] }
      : { id: 'swap', label: 'Swap aircraft', desc: 'No other aircraft of this type is free to take over now.', tone: 'bad', chips: ['Unavailable'] },
    { id: 'subcharter', label: `Sub-charter to ${rivalName(g, rivalId)}`, desc: 'A rival flies the legs; we still bill the client. No reliability hit.', tone: 'warn', chips: [usd(-sub), legsChip(win)] },
    { id: 'cancel', label: 'Cancel the legs', desc: 'Compensation to the client and a reliability hit.', tone: 'bad', chips: [usd(-pen), 'Reliability −3', legsChip(win)] },
  ];
  // Sub-charter is the default only when the wait would cancel legs and it is cheaper than that compensation.
  const waitPen = cancelCost(g, holdC.cancels);
  const def = waitPen > 0 && sub < waitPen ? 'subcharter' : 'courier';
  ask(g, {
    kind: 'aog', title: `AOG: ${ac.reg} at ${city(m.at)}`,
    body: `${m.cause}. ${f.no} ${f.from}–${f.to} can't leave. With a part by courier the aircraft is back in about ${Math.round((m.end - g.now) / 60)} h.`,
    options, defaultOption: def, expires: g.now + BAL.aogDecisionMin, ref: { kind: 'aircraft', id: ac.id },
    data: { aircraftId: ac.id, maintId: m.id, flightId: f.id, teamEnd, teamCost, factor, rivalId },
  }, true);
}

function resolveAog(g: GameState, d: Decision, opt: string): ActionResult {
  const ac = g.fleet[str(d.data, 'aircraftId')];
  const m = g.maintenance[str(d.data, 'maintId')];
  if (!ac || !m || m.status !== 'inWork') return { ok: true, msg: 'The aircraft is already fixed' };
  const fix = () => m.end + 30;
  switch (opt) {
    case 'courier':
      applyHold(g, planHold(g, ac, m.at, fix()), 'AOG: waiting for parts');
      return { ok: true, msg: `${ac.reg}: part on its way, back about ${fmtDateTime(m.end)}` };
    case 'team':
      setAogEnd(g, m, num(d.data, 'teamEnd'));
      m.cost += num(d.data, 'teamCost');
      applyHold(g, planHold(g, ac, m.at, fix()), 'AOG: engineering team');
      return { ok: true, msg: `AOG team flying to ${city(m.at)}, ${ac.reg} back about ${fmtDateTime(m.end)}` };
    case 'swap': {
      const win = windowLegs(g, ac, m.at, fix());
      const sw = findSwap(g, ac, win, m.at);
      if (!sw) return { ok: false, error: 'No aircraft can take over now' };
      if (sw.from !== m.at && !planPositioning(g, sw.ac.id, m.at, sw.moves[0].std, 'ferry', null)) return { ok: false, error: `${sw.ac.reg} can't reach ${m.at} in time` };
      for (const { f, std } of sw.moves) if (f.status === 'scheduled' && std !== f.std) moveFlight(g, f, std, 'AOG: aircraft swap');
      for (const { f } of sw.moves) f.delay = 0;
      reassignFlights(g, sw.moves.map((x) => x.f.id), sw.ac.id);
      return { ok: true, msg: `${sw.ac.reg} takes over ${revCount(win)} legs from ${ac.reg}` };
    }
    case 'subcharter': {
      const win = windowLegs(g, ac, m.at, fix());
      const rival = str(d.data, 'rivalId');
      const n = subcharterLegs(g, win, rival, subcharterCost(g, win, num(d.data, 'factor') || 1.5));
      return { ok: true, msg: `${rivalName(g, rival)} flies ${n} legs for us` };
    }
    case 'cancel': {
      const win = windowLegs(g, ac, m.at, fix());
      const pen = cancelLegs(g, win, 'AOG', 3);
      return { ok: true, msg: `${revCount(win)} legs cancelled, ${usd(pen)} compensation` };
    }
  }
  return { ok: false, error: 'Unknown option' };
}

// ---------- crew short ----------

/** When a legal crew could take the leg: the inbound crew after their rest, or a standby crew from base. Pure. */
export function crewReadyAt(g: GameState, f: Flight, ac: Aircraft): Minute {
  const home = g.company.homeBase;
  const report = reportMinutes(ac.typeId).report;
  let t = f.from === home ? g.now + 90 : g.now + 180 + blockMinutes(ac.typeId, home, f.from);
  let inbound: Flight | undefined;
  for (const x of flightsOf(g, ac.id)) if (x.status === 'done' && x.to === f.from && (x.ata ?? 0) <= g.now) inbound = x;
  const crew = (inbound?.crewIds ?? []).map((id) => g.crew[id]).filter((c) => c && c.loc === f.from);
  if (crew.length) t = Math.min(t, Math.max(...crew.map((c) => c.restUntil)) + report);
  return Math.max(g.now + 60, Math.ceil(t / 5) * 5);
}

export function crewShortDecision(g: GameState, f: Flight, ac: Aircraft): void {
  const d = f.dutyId ? g.duties[f.dutyId] : undefined;
  const cs = flightCrewStatus(g, f.id);
  const legs = windowLegs(g, ac, f.from, f.std + 1);
  const over = d ? d.fdp - d.maxFdp : 0;
  const canDisc = !!d && !cs.missing.length && over > 0 && over <= 120 && !d.discretion;
  const factor = Math.round(range(g, BAL.subcharterFactor[0], BAL.subcharterFactor[1]) * 100) / 100;
  const rivalId = pickRival(g, ac.typeId);
  const ready = crewReadyAt(g, f, ac);
  const wait = ready - g.now;
  const sub = subcharterCost(g, legs, factor);
  const pen = cancelCost(g, legs);
  const what = cs.missing.length ? `no legal ${[...new Set(cs.missing)].join('/')} can take it` : over > 0 ? `the crew would run ${fmtDuration(over)} over their duty limit` : 'the crew is not legal';
  const options: DecisionOption[] = [
    { id: 'standby', label: 'Wait for a legal crew', desc: f.from === g.company.homeBase ? 'A standby crew reports.' : 'The crew finishes its rest, or a standby crew flies in. Passengers wait.', tone: 'warn', chips: [`Delay ~${fmtDuration(wait)}`] },
  ];
  if (canDisc) options.push({ id: 'discretion', label: "Commander's discretion", desc: `The captain extends the duty by ${fmtDuration(over)} (max 2 h).`, tone: 'warn', chips: ['Morale −3', `FDP +${fmtDuration(over)}`] });
  if (revCount(legs)) options.push({ id: 'subcharter', label: `Sub-charter to ${rivalName(g, rivalId)}`, desc: 'A rival operates the trip; we still bill the client.', tone: 'warn', chips: [usd(-sub), legsChip(legs)] });
  options.push({ id: 'cancel', label: 'Cancel the trip', desc: 'Compensation and a reliability hit.', tone: 'bad', chips: [usd(-pen), 'Reliability −3'] });
  const def = canDisc ? 'discretion' : wait <= 8 * 60 || !revCount(legs) || sub > pen ? 'standby' : 'subcharter';
  ask(g, {
    kind: 'crewShort', title: `Crew short: ${f.no} ${f.from}–${f.to}`,
    body: `${f.no} has been waiting ${fmtDuration(f.delay)} at ${city(f.from)}: ${what}.`,
    options, defaultOption: def, expires: g.now + 60, ref: { kind: 'flight', id: f.id },
    data: { flightId: f.id, aircraftId: ac.id, dutyId: d?.id ?? '', factor, rivalId },
  });
}

/** Fills empty slots of the flight's trip (called-in crew lose a day off: morale −4). */
function fillSlots(g: GameState, f: Flight): number {
  const d = f.dutyId ? g.duties[f.dutyId] : undefined;
  const p = d ? g.pairings[d.pairingId] : undefined;
  let n = 0;
  p?.slots.forEach((s, i) => {
    if (s.crewId) return;
    const r = replaceCrew(g, p.id, i);
    const c = r.ok && r.data ? g.crew[r.data.crewId] : undefined;
    if (c) {
      n++;
      c.morale = Math.max(0, c.morale - 4);
    }
  });
  return n;
}

function resolveCrewShort(g: GameState, d: Decision, opt: string): ActionResult {
  const f = g.flights[str(d.data, 'flightId')];
  const ac = f?.aircraftId ? g.fleet[f.aircraftId] : undefined;
  if (!f || !ac || f.status !== 'scheduled') return { ok: true, msg: 'The flight has already been handled' };
  const legs = windowLegs(g, ac, f.from, f.std + 1);
  switch (opt) {
    case 'standby': {
      f.crewDecided = true;
      delayChain(g, f, crewReadyAt(g, f, ac), 'Waiting for a legal crew');
      rerosterFrom(g, ac.id, g.now);
      return { ok: true, msg: `${f.no} now off blocks ${fmtTime(f.std)} UTC` };
    }
    case 'discretion': {
      const duty = str(d.data, 'dutyId');
      const r = applyDiscretion(g, duty);
      if (!r.ok) return r;
      f.crewDecided = true;
      schedule(g, g.now, 'flight.dep', f.id, f.ev);
      return r;
    }
    case 'subcharter': {
      const rival = str(d.data, 'rivalId');
      const n = subcharterLegs(g, legs, rival, subcharterCost(g, legs, num(d.data, 'factor') || 1.5));
      return { ok: true, msg: `${rivalName(g, rival)} flies ${n} legs for us` };
    }
    case 'cancel': {
      const pen = cancelLegs(g, legs, 'Crew shortage', 3);
      return { ok: true, msg: `${revCount(legs)} legs cancelled, ${usd(pen)} compensation` };
    }
  }
  return { ok: false, error: 'Unknown option' };
}

/** B2 posts 'sickCrew' (data crewId, flightId) when nobody legal can refill a slot. */
function resolveSick(g: GameState, d: Decision, opt: string): ActionResult {
  const f = g.flights[str(d.data, 'flightId')];
  const ac = f?.aircraftId ? g.fleet[f.aircraftId] : undefined;
  if (!f || !ac || f.status !== 'scheduled') return { ok: true, msg: 'The flight has already been handled' };
  const legs = windowLegs(g, ac, f.from, f.std + 1);
  switch (opt) {
    case 'callIn': {
      const n = fillSlots(g, f);
      if (!n) rerosterFrom(g, ac.id, g.now);
      const ok = flightCrewStatus(g, f.id).level;
      return { ok: true, msg: ok === 'ok' || ok === 'tight' ? `${f.no} is crewed again` : `Nobody could be called in yet: ops will try again before ${f.no}` };
    }
    case 'subcharter': {
      const rival = pickRival(g, ac.typeId);
      const factor = range(g, BAL.subcharterFactor[0], BAL.subcharterFactor[1]);
      const n = subcharterLegs(g, legs, rival, subcharterCost(g, legs, factor));
      return { ok: true, msg: `${rivalName(g, rival)} flies ${n} legs for us` };
    }
    case 'cancel': {
      const pen = cancelLegs(g, legs, 'Crew sickness', 3);
      return { ok: true, msg: `${revCount(legs)} legs cancelled, ${usd(pen)} compensation` };
    }
  }
  return { ok: false, error: 'Unknown option' };
}

// ---------- payments and solvency ----------

export function latePaymentDecision(g: GameState, r: Receivable): void {
  const cl = g.clients[r.clientId];
  const name = cl?.name ?? 'A client';
  const days = Math.floor((g.now - r.due) / DAY);
  ask(g, {
    kind: 'latePayment', title: `${name} is ${days} days late`,
    body: `${usd(r.amount)} for ${r.desc} was due ${fmtDay(r.due)}.`,
    options: [
      { id: 'wait', label: 'Wait', desc: 'They usually pay in the end.', chips: [] },
      { id: 'factor', label: 'Sell the invoice', desc: `A factor pays now, less ${Math.round(BAL.factorDiscount * 100)}%.`, tone: 'warn', chips: [`+${usd(r.amount * (1 - BAL.factorDiscount))} now`, usd(-r.amount * BAL.factorDiscount)] },
      { id: 'threaten', label: 'Threaten to suspend', desc: 'Usually works within a week, but they will not forget it.', tone: 'bad', chips: ['Relation −20', '70% pay in 7 days'] },
    ],
    defaultOption: 'wait', expires: g.now + 2 * DAY, data: { receivableId: r.id, clientId: r.clientId },
  });
}

function resolveLatePayment(g: GameState, d: Decision, opt: string): ActionResult {
  const r = g.finance.receivables.find((x) => x.id === str(d.data, 'receivableId'));
  if (!r || r.paid !== null) return { ok: true, msg: 'Already paid' };
  if (opt === 'wait') return { ok: true };
  if (opt === 'factor') {
    const fee = Math.round(r.amount * BAL.factorDiscount);
    cashOnly(g, r.amount);
    post(g, 'interest', -fee);
    r.paid = g.now;
    r.factored = true;
    return { ok: true, msg: `Invoice sold: ${usd(r.amount - fee)} in` };
  }
  if (opt === 'threaten') {
    bumpRelation(g, r.clientId, -20);
    if (chance(g, 0.7)) {
      r.payAt = Math.min(r.payAt, g.now + int(g, 1, 7) * DAY);
      schedule(g, r.payAt, 'payment', r.id);
    }
    return { ok: true, msg: 'Letter sent' };
  }
  return { ok: false, error: 'Unknown option' };
}

export function rescueDecision(g: GameState): void {
  const amount = Math.round(range(g, BAL.rescueCash[0], BAL.rescueCash[1]) / 100_000) * 100_000;
  ask(g, {
    kind: 'rescue', title: 'An investor offers a rescue',
    body: `Cash has been negative for ${BAL.rescueDays} days. A private-equity fund offers ${usd(amount)} for 25% of the company.`,
    options: [
      { id: 'accept', label: 'Take the money', desc: 'Cash now; the market notices.', tone: 'warn', chips: [`+${usd(amount)}`, 'Reliability −5'] },
      { id: 'refuse', label: 'Refuse', desc: `Fight on alone: below ${usd(BAL.bankruptFloor)} the company is finished.`, tone: 'bad', chips: ['Risky'] },
    ],
    defaultOption: 'accept', expires: g.now + 3 * DAY, data: { amount },
  }, true);
}

function resolveRescue(g: GameState, d: Decision, opt: string): ActionResult {
  const f = g.finance;
  if (opt === 'accept') {
    cashOnly(g, num(d.data, 'amount'));
    f.rescues = (f.rescues ?? 0) + 1;
    f.negSince = null;
    bumpReliable(g, -5);
    g.company.reputation.clean = Math.max(0, g.company.reputation.clean - 3);
    pushMessage(g, { tone: 'warn', cat: 'finance', title: 'Rescue signed', body: `${usd(num(d.data, 'amount'))} in. A second insolvency will end the company.` });
    return { ok: true, msg: 'Rescue signed' };
  }
  if (opt === 'refuse') {
    f.refusedRescue = true;
    return { ok: true, msg: 'Investor refused' };
  }
  return { ok: false, error: 'Unknown option' };
}

// ---------- client change requests ----------

function extraRotation(g: GameState, c: Contract): void {
  if (c.pattern.kind !== 'base' || c.product.kind !== 'wet') return;
  const p = c.pattern;
  const ac = g.fleet[c.aircraftIds[0]];
  if (!ac || !p.dests.length) return;
  const dest = pick(g, p.dests);
  const turn = turnOf(ac);
  const out = blockMinutes(ac.typeId, p.base, dest);
  const back = blockMinutes(ac.typeId, dest, p.base);
  const need = out + turn + back;
  const from = g.now + 36 * 60;
  const to = Math.min(g.now + 8 * DAY, p.to);
  // First daytime gap between two legs at the base that fits an out-and-back.
  let std = 0;
  const list = flightsOf(g, ac.id).filter((f) => f.status === 'scheduled');
  for (let i = 0; i + 1 < list.length && !std; i++) {
    const a = list[i];
    const b = list[i + 1];
    if (a.to !== p.base || b.from !== p.base || a.sta + turn < from || b.std > to) continue;
    for (let t = Math.ceil((a.sta + turn) / 15) * 15; t + need + turn <= b.std; t += 30) {
      const lm = localMinuteOfDay(p.base, t);
      if (lm >= 6 * 60 && lm <= 21 * 60) {
        std = t;
        break;
      }
    }
  }
  if (!std) return;
  const bh = (out + back) / 60;
  const cl = g.clients[c.clientId];
  ask(g, {
    kind: 'changeRequest', title: `${cl?.name ?? 'Client'} asks for an extra rotation`,
    body: `${p.base}–${dest}–${p.base} on ${fmtDay(std)}, off blocks ${fmtTime(std, p.base)} local. ${bh.toFixed(1)} BH at ${usd(c.product.ratePerBH)}/BH above the minimum; crew are re-rostered automatically.`,
    options: [
      { id: 'accept', label: 'Fly it', desc: 'More hours; the crew roster absorbs it.', tone: 'good', chips: [`+${bh.toFixed(1)} BH`, 'Relation +2'] },
      { id: 'decline', label: 'Decline', desc: 'The aircraft keeps its rest.', chips: ['Relation −3'] },
    ],
    defaultOption: 'accept', expires: g.now + DAY, ref: { kind: 'contract', id: c.id },
    data: { contractId: c.id, kind: 'extra', aircraftId: ac.id, dest, std },
  });
}

function retimeRequest(g: GameState, c: Contract): void {
  const f = Object.values(g.flights)
    .filter((x) => x.contractId === c.id && x.status === 'scheduled' && x.kind === 'revenue' && x.aircraftId && x.std >= g.now + 2 * DAY)
    .sort((a, b) => a.std - b.std)[0];
  if (!f) return;
  const min = pick(g, [60, 90, 120, 180]);
  const fee = int(g, 15, 50) * 100;
  const cl = g.clients[c.clientId];
  ask(g, {
    kind: 'changeRequest', title: `${cl?.name ?? 'Client'} wants to move ${f.no}`,
    body: `${f.from}–${f.to} on ${fmtDay(f.std)}: depart ${fmtDuration(min)} later (${fmtTime(f.std + min, f.from)} local) for a late group. They pay a change fee; later legs move with it.`,
    options: [
      { id: 'accept', label: 'Agree', desc: 'Later legs of the aircraft shift if needed.', tone: 'good', chips: [`+${usd(fee)}`, `+${fmtDuration(min)}`] },
      { id: 'decline', label: 'Decline', desc: 'Keep the schedule.', chips: ['Relation −3'] },
    ],
    defaultOption: 'accept', expires: g.now + DAY, ref: { kind: 'flight', id: f.id },
    data: { contractId: c.id, kind: 'retime', flightId: f.id, minutes: min, fee },
  });
}

function resolveChange(g: GameState, d: Decision, opt: string): ActionResult {
  const c = g.contracts[str(d.data, 'contractId')];
  if (!c) return { ok: true };
  if (opt === 'decline') {
    bumpRelation(g, c.clientId, -3);
    return { ok: true, msg: 'Declined' };
  }
  if (opt !== 'accept') return { ok: false, error: 'Unknown option' };
  if (str(d.data, 'kind') === 'retime') {
    const f = g.flights[str(d.data, 'flightId')];
    if (!f || f.status !== 'scheduled') return { ok: true, msg: 'The flight has already left' };
    delayChain(g, f, f.std + num(d.data, 'minutes'), 'Client request');
    post(g, 'otherRevenue', num(d.data, 'fee'));
    bumpRelation(g, c.clientId, 2);
    return { ok: true, msg: `${f.no} moved to ${fmtTime(f.std)} UTC` };
  }
  const ac = g.fleet[str(d.data, 'aircraftId')];
  const p = c.pattern;
  if (!ac || p.kind !== 'base' || (c.status !== 'active' && c.status !== 'signed')) return { ok: true };
  const dest = str(d.data, 'dest');
  const std = num(d.data, 'std');
  const out = blockMinutes(ac.typeId, p.base, dest);
  const back = blockMinutes(ac.typeId, dest, p.base);
  const turn = turnOf(ac);
  const end = std + out + turn + back;
  if (std < g.now + 60 || flightsOf(g, ac.id).some((f) => f.status === 'scheduled' && f.std < end + turn && f.sta > std - turn)) return { ok: false, error: 'The slot is no longer free' };
  const no = int(g, 700, 989);
  addFlight(g, { no: `${p.prefix}${no}`, aircraftId: ac.id, contractId: c.id, kind: 'revenue', from: p.base, to: dest, std, sta: std + out });
  addFlight(g, { no: `${p.prefix}${no + 1}`, aircraftId: ac.id, contractId: c.id, kind: 'revenue', from: dest, to: p.base, std: std + out + turn, sta: end });
  bumpRelation(g, c.clientId, 2);
  return { ok: true, msg: `Extra rotation to ${dest} on ${fmtDay(std)}` };
}

// ---------- daily ----------

function changeRequests(g: GameState): void {
  for (const c of Object.values(g.contracts)) {
    if (c.status !== 'active') continue;
    if (!chance(g, BAL.changeRequestWeekly / 7) || !canAsk(g)) continue;
    if (c.pattern.kind === 'base') extraRotation(g, c);
    else retimeRequest(g, c);
  }
}

/** 48 h before a trip with permit risk: the landing permit may be late (first leg moves 6–24 h). */
function permitDelays(g: GameState): void {
  for (const c of Object.values(g.contracts)) {
    if ((c.status !== 'signed' && c.status !== 'active') || c.pattern.kind !== 'legs') continue;
    if (c.start < g.now + DAY || c.start >= g.now + 2 * DAY) continue;
    const risk = g.offers[c.offerId]?.risk.permit ?? 0;
    if (!risk || !chance(g, risk * 0.3)) continue;
    const first = Object.values(g.flights)
      .filter((f) => f.contractId === c.id && f.status === 'scheduled' && isRevenue(f) && f.aircraftId)
      .sort((a, b) => a.std - b.std)[0];
    if (!first) continue;
    const h = int(g, 6, 24);
    delayChain(g, first, first.std + h * 60, 'Landing permit pending');
    pushMessage(g, {
      tone: 'warn', cat: 'ops', title: `Permit delay: ${first.no}`,
      body: `The ${AIRPORT_BY_CODE[first.to]?.country ?? ''} landing permit for ${first.from}–${first.to} is not through yet. ${first.no} moved ${h} h to ${fmtDateTime(first.std)} UTC.`,
      ref: { kind: 'flight', id: first.id },
    });
  }
}

/** 1 Feb, 1 Mar, 1 Sep: tender season reminder when an aircraft has nothing for two weeks. */
function seasonNudge(g: GameState): void {
  const d = toDate(g.now);
  if (d.getUTCDate() !== 1 || ![1, 2, 8].includes(d.getUTCMonth())) return;
  const idle = Object.values(g.fleet).filter((ac) => {
    if (ac.status === 'delivering' || ac.status === 'stored' || ac.status === 'leasedOut') return false;
    if (flightsOf(g, ac.id).some((f) => f.status === 'scheduled' && f.std < g.now + 14 * DAY)) return false;
    return !Object.values(g.contracts).some((c) => (c.status === 'signed' || c.status === 'active') && c.aircraftIds.includes(ac.id) && c.start < g.now + 14 * DAY);
  });
  if (!idle.length) return;
  const season = d.getUTCMonth() === 8 ? 'Winter' : 'Summer';
  pushMessage(g, {
    tone: 'info', cat: 'commercial', title: `${season} tenders are out`,
    body: `Airlines are buying ${season.toLowerCase()} capacity now. ${idle.map((a) => a.reg).join(', ')} ${idle.length > 1 ? 'have' : 'has'} nothing in the next two weeks: check the market.`,
  });
}

/** Daily rolls: client change requests, permit delays, season nudges, urgent evacuation offers (via contracts). */
export function dailyEvents(g: GameState): void {
  changeRequests(g);
  permitDelays(g);
  seasonNudge(g);
  if (chance(g, BAL.evacuationPerDay)) generateOffer(g, 'repatriation', { start: g.now + int(g, 20, 60) * 60 });
}

// ---------- resolution ----------

type Resolver = (g: GameState, d: Decision, opt: string) => ActionResult;
const RESOLVERS: Record<string, Resolver> = {
  aog: resolveAog,
  crewShort: resolveCrewShort,
  sickCrew: resolveSick,
  latePayment: resolveLatePayment,
  rescue: resolveRescue,
  changeRequest: resolveChange,
};

/** Applies a decision option (dispatch on decision.kind) and removes the decision. Failed options keep it open. */
export function resolveDecision(g: GameState, decisionId: string, optionId: string): ActionResult {
  const i = g.decisions.findIndex((d) => d.id === decisionId);
  if (i < 0) return { ok: false, error: 'Decision not found' };
  const d = g.decisions[i];
  if (!d.options.some((o) => o.id === optionId)) return { ok: false, error: 'Unknown option' };
  const fn = RESOLVERS[d.kind];
  const r = fn ? fn(g, d, optionId) : ({ ok: true } as ActionResult);
  if (!r.ok) return r;
  const j = g.decisions.indexOf(d);
  if (j >= 0) g.decisions.splice(j, 1);
  stats(g).decisions++;
  return r;
}

/** 'decision.expire': the default option applies; if it can't, the next workable option. */
export function onDecisionExpire(g: GameState, ev: SimEvent): void {
  const d = g.decisions.find((x) => x.id === ev.id);
  if (!d) return;
  const order = [d.defaultOption, ...d.options.map((o) => o.id).filter((id) => id !== d.defaultOption)];
  for (const id of order) if (resolveDecision(g, d.id, id).ok) return;
  const j = g.decisions.indexOf(d);
  if (j >= 0) g.decisions.splice(j, 1);
}
