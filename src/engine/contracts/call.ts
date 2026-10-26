// v0.10.2 the phone call: an urgent offer that pays clearly above the norm rings as a phone call instead of the HI-LO
// offer chime. Rule (isCallOffer): urgent in the game's sense (first departure < 72 h away, so the answer is due within
// hours) AND, on our best aircraft for it, the estimated margin per block hour is at least CALL_MARGIN_X × the
// reference type's standard ACMI rate per block hour. Calibrated on seeded bot years (seeds 1–5, --wide): about the
// top third of the offers we can fly and 5–7 calls a year on a two-aircraft start (urgent work we can fly is the limit).
// Answering runs the offer dialog's own path: the first aircraft that passes every check, the dialog's default
// options, acceptOffer; a blocked call says why and accepts nothing. Declining is declineOffer. No UI here.

import { AIRPORT_BY_CODE } from '../../data/airports';
import { ACMI_TYPES } from '../../data/acmiTypes';
import { kitsFor, NAMES } from '../../data/names';
import { DAY, fmtDay, fmtTime, localMinuteOfDay, toLocal } from '../core/time';
import type { ActionResult, ClientKind, ContractOffer, GameState } from '../core/types';
import { hashUnit } from '../core/util';
import { offerExtra } from '../crew/extraSeats';
import { acceptOffer, declineOffer } from './accept';
import { feasibilityAll, type FeasibilityReport } from './feasibility';
import { referenceType } from './pricing';

/** Margin per BH over the reference type's standard rate that makes an urgent offer a call. */
export const CALL_MARGIN_X = 1.5;

function sectorsOf(o: ContractOffer): [string, string][] {
  const p = o.pattern;
  return p.kind === 'base' ? p.dests.flatMap((d) => [[p.base, d], [d, p.base]] as [string, string][]) : p.legs.map((l) => [l.from, l.to]);
}

/** The offer dialog's default options (paint and cabin on when asked). */
const callOpts = (o: ContractOffer) => ({ paint: !!o.paint, cabin: !!o.cabin });
/** A report the dialog would let us accept with (no red check). */
const passes = (r: FeasibilityReport) => !r.checks.some((c) => c.level === 'no');

/** How far the offer pays above the norm: our best aircraft's margin per BH over the reference type's rate (0 = none). */
export function callScore(g: GameState, o: ContractOffer): number {
  const ref = referenceType(o.requirements, sectorsOf(o), !!o.requirements.noTechStops, o.requirements.approvals.includes('ulr'));
  const rate = ref ? ACMI_TYPES[ref]?.rateBH : undefined;
  if (!rate) return 0;
  const best = feasibilityAll(g, o.id, callOpts(o)).filter((r) => r.level !== 'no').sort((a, b) => b.estMargin - a.estMargin)[0];
  if (!best || best.estBH <= 0) return 0;
  return best.estMargin / best.estBH / rate;
}

/** The trigger: urgent and high-paying (and something in the fleet could fly it). */
export function isCallOffer(g: GameState, o: ContractOffer): boolean {
  return o.urgency === 'urgent' && callScore(g, o) >= CALL_MARGIN_X;
}

export type CallPlan = { ok: true; aircraftId: string } | { ok: false; error: string };

/** What Accept on the call would do now: the dialog's first aircraft that passes every check, or why none can. Pure. */
export function callPlan(g: GameState, offerId: string): CallPlan {
  const o = g.offers[offerId];
  if (!o) return { ok: false, error: 'Offer not found' };
  if (o.status !== 'open' || o.expires <= g.now) return { ok: false, error: 'This offer is no longer on the market' };
  const reports = feasibilityAll(g, o.id, callOpts(o));
  const sel = reports.find(passes);
  if (sel) return { ok: true, aircraftId: sel.aircraftId };
  const r = reports[0];
  const why = r?.checks.find((c) => c.level === 'no');
  return { ok: false, error: !r ? 'No aircraft in the fleet' : why ? `${why.label}${why.detail ? `: ${why.detail}` : ''}` : 'No aircraft can take it' };
}

/** Answering the call: the offer dialog's accept with its first aircraft that passes; else why not, nothing signed. */
export function answerCall(g: GameState, offerId: string): ActionResult<{ contractId: string }> {
  const plan = callPlan(g, offerId);
  if (!plan.ok) return plan;
  const o = g.offers[offerId];
  const crewExtra = o.product.kind !== 'dry' ? offerExtra(g, plan.aircraftId, o.requirements) : undefined;
  return acceptOffer(g, o.id, [plan.aircraftId], { ...callOpts(o), crewExtra });
}

/** Declining on the phone is the normal decline. */
export function declineCall(g: GameState, offerId: string): ActionResult {
  return declineOffer(g, offerId);
}

const ROLE: Record<ClientKind, string> = {
  airline: 'Operations control', tourOperator: 'Flight programme desk', government: 'Protocol office', agency: 'Logistics coordinator',
  sports: 'Team travel manager', music: 'Tour manager', corporate: 'Travel department', broker: 'Charter broker', operator: 'Operations control',
};

export interface CallScript {
  /** The client (or the broker for the client). */
  caller: string;
  /** The person on the line ('Sofia Almeida') and their role ('Operations control'). */
  person: string;
  role: string;
  /** What they say, in their words. */
  line: string;
  /** Route summary ('LIS–FNC–LIS' / 'Based at FAO: OPO, FNC'). */
  route: string;
  firstDep: number;
  firstFrom: string;
  seats: number;
}

const city = (code: string) => AIRPORT_BY_CODE[code]?.city ?? code;

/** The same contact every time a client calls: a name from the client's own country (Belgium: a Dutch or a French
 *  name, never mixed). Exported for tests. */
export function contactOf(key: string, country: string): string {
  const kits = kitsFor(country);
  const kit = NAMES[kits.length > 1 ? kits[Math.floor(hashUnit(`${key}:kit`) * kits.length)] : kits[0] ?? 'GB'];
  if (!kit) return '';
  const fem = hashUnit(`${key}:sex`) < 0.5;
  const firsts = fem ? kit.f : kit.m;
  const first = firsts[Math.floor(hashUnit(`${key}:first`) * firsts.length)];
  const i = Math.floor(hashUnit(`${key}:last`) * kit.last.length);
  const last = (fem && kit.lastF?.[i]) || kit.last[i];
  return kit.familyFirst ? `${last} ${first}` : `${first} ${last}`;
}

/** 'tonight at 21:00' / 'tomorrow morning at 06:30' / 'on Tue 12 May at 06:30' (local at the airport, from now). */
export function whenSaid(g: GameState, t: number, at: string): string {
  const day = (x: number) => Math.floor(toLocal(at, x) / DAY);
  const d = day(t) - day(g.now);
  const hm = fmtTime(t, at);
  const m = localMinuteOfDay(at, t);
  if (d <= 0) return `${m >= 17 * 60 ? 'tonight' : m < 12 * 60 ? 'this morning' : 'this afternoon'} at ${hm}`;
  if (d === 1) return `tomorrow ${m < 12 * 60 ? 'morning' : m >= 17 * 60 ? 'evening' : 'afternoon'} at ${hm}`;
  return `on ${fmtDay(toLocal(at, t))} at ${hm}`;
}

/** The call as the player hears it. Pure. */
export function callScript(g: GameState, offerId: string): CallScript | null {
  const o = g.offers[offerId];
  if (!o) return null;
  const cl = g.clients[o.clientId];
  const p = o.pattern;
  const firstFrom = p.kind === 'base' ? p.base : p.legs[0].from;
  const firstDep = p.kind === 'base' ? p.from : p.legs[0].dep;
  const route = p.kind === 'base'
    ? `Based at ${firstFrom}: ${p.dests.join(', ')}`
    : p.legs.length <= 4 ? [p.legs[0].from, ...p.legs.map((l) => l.to)].join('–') : `${p.legs[0].from}–${p.legs[0].to} + ${p.legs.length - 1} more legs`;
  const seats = Math.max(o.requirements.minSeats, ...(p.kind === 'legs' ? p.legs.map((l) => l.pax ?? 0) : [0]));
  const when = whenSaid(g, firstDep, firstFrom);
  const there = city(p.kind === 'base' ? p.base : p.legs.find((l) => l.from !== g.company.homeBase)?.from ?? p.legs[0].to);
  const leg0 = p.kind === 'legs' ? `${city(p.legs[0].from)}–${city(p.legs[0].to)}` : `from ${city(firstFrom)}`;
  const days = Math.max(1, Math.round((o.end - o.start) / DAY));
  let line: string;
  switch (o.archetype) {
    case 'aogCover': line = `We've lost an aircraft at ${there}. Can you cover ${leg0} ${when}? ${seats} seats, about ${days} day${days === 1 ? '' : 's'}.`; break;
    case 'evacuation': line = `We have to get ${seats} people out of ${there}. Can you fly ${leg0} ${when}?`; break;
    case 'repatriation': line = `We need to bring ${seats} people home from ${there}. Can you fly ${leg0} ${when}?`; break;
    case 'medical': line = `It's a medical flight out of ${there}, ${when}. Can you do ${leg0}?`; break;
    case 'humanitarian': line = `Relief has to reach ${city(p.kind === 'legs' ? p.legs[0].to : p.base)} fast. Can you fly ${leg0} ${when}?`; break;
    case 'subcharterIn': line = `We're an aircraft short. Can you take our ${leg0} ${when}? ${seats} passengers.`; break;
    default: line = `Can you fly ${leg0} ${when}? ${seats} passengers.`;
  }
  const broker = o.broker;
  const key = broker ? `broker:${broker}` : `client:${o.clientId}`;
  return {
    caller: broker ? `${broker} for ${cl?.name ?? 'a client'}` : cl?.name ?? 'A client',
    person: contactOf(key, broker ? 'GB' : cl?.country ?? 'GB'),
    role: broker ? 'Charter broker' : ROLE[cl?.kind ?? 'airline'],
    line, route, firstDep, firstFrom, seats,
  };
}
