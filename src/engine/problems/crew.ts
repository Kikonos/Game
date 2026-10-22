// v0.7.1 crew problems as ProblemCards (UPDATE-0.7.1.md §3.6–§3.8, §9): crew-short / illegal / tight flights (the
// Crew Control card), a sick crew member with work ahead, a resignation with trips still to cover. Pure.

import { BAL } from '../core/balance';
import { seatLabel, typeOf } from '../core/perf';
import { DAY, fmtDay, fmtDateTime } from '../core/time';
import type { GameState, ProblemRef, RestFacility } from '../core/types';
import { crewGauges, crewShortCard, shortFlights } from '../crew/control';
import { crewName } from '../crew/generate';
import { dutyLegality } from '../crew/rosterActions';
import { flightCrewStatus, rosterOf } from '../crew/roster';
import { restSeatsBlocked } from '../crew/crewRest';
import { isSeatRest, restOf, restPlan, restText, slipShort } from '../crew/restPlan';
import { augLimitOf, longSector } from '../crew/rules';
import { ticketPrice } from '../crew/timeline';
import { AIRPORT_BY_CODE } from '../../data/airports';
import type { TermId } from '../../data/glossary';
import { mkHurt, usdShort, type ProblemCard } from './types';

/** The crew card for a flight: shortage / illegal (Crew Control's), or a tight crew (amber, no fix needed yet). */
export function crewFlightCard(g: GameState, flightId: string, kind: ProblemRef['kind'] = 'crewShort'): ProblemCard | null {
  const f = g.flights[flightId];
  if (!f || f.status !== 'scheduled' || !f.aircraftId || f.kind === 'deadhead') return null;
  const cs = flightCrewStatus(g, flightId);
  if (cs.level === 'missing' || cs.level === 'illegal') {
    const card = crewShortCard(g, flightId);
    if (card && kind !== 'crewShort' && kind !== 'crewIllegal') card.subject = { kind, ref: card.subject.ref };
    return card;
  }
  if (cs.level !== 'tight' || kind === 'crewShort' || kind === 'crewIllegal') return null;
  const d = f.dutyId ? g.duties[f.dutyId] : undefined;
  const lv = d ? dutyLegality(g, d.id) : null;
  const w = lv?.warnings.find((x) => x.level === 'tight') ?? lv?.warnings[0];
  const who = w?.crewId ? g.crew[w.crewId] : undefined;
  const why = w ? (who && w.reason ? `${crewName(who)} is ${w.reason.text}; one delay breaks it.` : `${w.text}; one delay breaks it.`) : 'The crew is within half an hour of a limit; one delay breaks it.';
  return {
    subject: { kind: 'crewTight', ref: { kind: 'flight', id: f.id } }, severity: 'amber',
    title: `${f.no}'s crew is close to a limit`, what: `${f.no}'s crew is close to a limit`, why,
    hurt: mkHurt({ pax: 0, what: 'penalty', extra: 'nothing yet' }),
    actions: [...(d ? [{ id: 'adjustCrew', label: 'Adjust crew', open: { modal: 'duty' as const, id: d.id }, primary: true }] : []), { id: 'schedule', label: 'Schedule', open: { tab: 'schedule', sel: { kind: 'flight', id: f.id } } }],
    details: lv ? lv.warnings.map((x) => x.text) : [], visuals: { gauges: who ? crewGauges(g, who.id, d?.id) : undefined }, terms: ['tight', 'fdp'], by: f.std,
  };
}

/** A sick crew member whose next duty inside a week has nobody else yet (their trips are re-crewed by the roster). */
export function crewSickCard(g: GameState, crewId: string): ProblemCard | null {
  const c = g.crew[crewId];
  if (!c) return null;
  const block = c.blocks?.find((b) => b.from <= g.now + 7 * DAY && b.to > g.now && b.why === 'sick');
  if (!block && c.status !== 'sick') return null;
  const until = block?.to;
  const next = rosterOf(g, c.id, g.now, g.now + 7 * DAY).find((d) => !d.done && d.report > g.now);
  const f = next ? g.flights[next.flightIds[0]] : undefined;
  const cs = f ? flightCrewStatus(g, f.id) : null;
  const short = !!cs && (cs.level === 'missing' || cs.level === 'illegal');
  return {
    subject: { kind: 'crewSick', ref: { kind: 'crew', id: c.id } }, severity: short ? 'red' : 'amber',
    title: `${crewName(c)} is sick${until ? ` until ${fmtDay(until)}` : ''}`, what: `${crewName(c)} is sick${until ? ` until ${fmtDay(until)}` : ''}`,
    why: f ? `${f.no} on ${fmtDay(f.std)} ${short ? 'still needs a replacement' : 'has a replacement from the roster'}.` : 'Nothing of theirs is rostered this week.',
    hurt: mkHurt({ pax: short ? f?.pax ?? 0 : 0, legs: short ? 1 : 0, what: 'penalty', extra: short ? undefined : 'nothing' }),
    actions: f && short ? [{ id: 'crewControl', label: 'Crew Control', open: { modal: 'crewControl', id: f.id }, primary: true }] : [{ id: 'crew', label: 'Crew', open: { tab: 'crew', sel: { kind: 'crew', id: c.id } } }],
    details: [`Status ${c.status}${until ? `, back ${fmtDateTime(until)}` : ''}`], visuals: {}, terms: ['standby'], by: until,
  };
}

/** A crew member on notice with trips rostered past their leaving date (the roster re-crews them). */
export function crewResignedCard(g: GameState, crewId: string): ProblemCard | null {
  const c = g.crew[crewId];
  if (!c?.notice) return null;
  const leaves = c.notice.leaves;
  const days = Math.max(0, Math.ceil((leaves - g.now) / DAY));
  return {
    subject: { kind: 'crewResigned', ref: { kind: 'crew', id: c.id } }, severity: 'amber',
    title: `${crewName(c)} leaves in ${days} days`, what: `${crewName(c)} leaves in ${days} days`,
    why: `They resigned on ${fmtDay(c.notice.given)}; from ${fmtDay(leaves)} their trips need someone else.`,
    hurt: mkHurt({ extra: 'one fewer crew member' }),
    actions: [{ id: 'hire', label: 'Hire', open: { modal: 'hire', id: c.role }, primary: true }, { id: 'crew', label: 'Crew', open: { tab: 'crew', sel: { kind: 'crew', id: c.id } } }],
    details: [`Morale ${Math.round(c.morale)}`], visuals: {}, terms: [], by: leaves,
  };
}

/** Every current crew problem, worst first: short/illegal flights (the ladder's list), sick crew with work ahead, resignations. */
export function crewProblems(g: GameState): ProblemCard[] {
  const out: ProblemCard[] = [];
  const seen = new Set<string>();
  for (const x of shortFlights(g)) {
    const f = g.flights[x.flightId];
    const k = f.dutyId ?? f.id;
    if (seen.has(k)) continue;
    seen.add(k);
    const card = crewFlightCard(g, x.flightId);
    if (card) out.push(card);
  }
  // v0.7.2 captains in an FO seat and rest seats that would offload passengers, over the next 48 h.
  for (const d of Object.values(g.duties)) {
    if (d.done || d.report < g.now || d.report > g.now + 2 * DAY || !d.flightIds.length) continue;
    const cap = captainAsFoCard(g, d.flightIds[0]);
    if (cap) out.push(cap);
    for (const fid of d.flightIds) {
      const f = g.flights[fid];
      if (!f || f.pax === undefined || !restSeatsBlocked(g, fid)) continue;
      const r = restSeatsCard(g, fid);
      if (r && r.hurt.pax > 0) out.push(r);
    }
  }
  // v0.7.3 in-flight rest (rest too short, a 4th pilot for seats, extra cabin crew) inside the roster horizon.
  out.push(...restCards(g));
  for (const c of Object.values(g.crew)) {
    if (c.status === 'sick' || c.blocks?.some((b) => b.why === 'sick' && b.from <= g.now + 7 * DAY && b.to > g.now)) {
      const card = crewSickCard(g, c.id);
      if (card && card.severity === 'red') out.push(card);
    }
    if (c.notice && c.notice.leaves - g.now <= 14 * DAY) {
      const card = crewResignedCard(g, c.id);
      if (card) out.push(card);
    }
  }
  return out;
}

// ---------- v0.7.2 ----------

/** A captain rostered in a first officer's (or relief pilot's) seat on the flight's duty (the soonest one). Pure. */
export function captainAsFoCard(g: GameState, flightId: string): ProblemCard | null {
  const f = g.flights[flightId];
  const d = f?.dutyId ? g.duties[f.dutyId] : undefined;
  const p = d ? g.pairings[d.pairingId] : undefined;
  if (!f || !d || !p || d.done) return null;
  const slot = p.slots.find((s) => s.crewId && (s.role === 'FO' || s.role === 'CRP') && g.crew[s.crewId]?.role === 'CPT');
  const c = slot ? g.crew[slot.crewId!] : undefined;
  if (!c) return null;
  const ac = f.aircraftId ? g.fleet[f.aircraftId] : undefined;
  const type = ac ? typeOf(ac.typeId).short : 'type';
  const nth = (c.asFoAt ?? []).filter((t) => t > g.now - 30 * DAY).length + 1;
  const A = BAL.v072.asFo;
  const ord = nth === 1 ? '1st' : nth === 2 ? '2nd' : nth === 3 ? '3rd' : `${nth}th`;
  return {
    subject: { kind: 'captainAsFo', ref: { kind: 'flight', id: f.id } }, severity: 'amber',
    title: `Capt. ${crewName(c)} flies ${f.no} as first officer`, what: `Capt. ${crewName(c)} flies ${f.no} as first officer`,
    why: `No ${type} first officer is free on ${fmtDay(d.report)}.`,
    hurt: { ...mkHurt({}), text: `Not much: their pay stays; their morale drops if it happens more than twice a month (this is the ${ord})${nth > A.freePerMonth ? `: morale ${A.morale}` : ''}` },
    actions: [
      { id: 'hire', label: 'Hire first officers', open: { modal: 'hire', id: 'FO' }, primary: true },
      { id: 'adjustCrew', label: 'Adjust crew', open: { modal: 'duty', id: d.id } },
    ],
    details: [`${seatLabel(slot!.role, c.role)} on ${f.no} ${f.from}–${f.to} ${fmtDateTime(f.std)}`, `${nth} time${nth > 1 ? 's' : ''} in 30 days`],
    visuals: {}, terms: ['asFo'], by: f.std,
  };
}

/** Seats taken out of sale for crew rest on a flight (someone rests in curtained business seats or recliners on it). Pure. */
export function restSeatsCard(g: GameState, flightId: string): ProblemCard | null {
  const f = g.flights[flightId];
  const ac = f?.aircraftId ? g.fleet[f.aircraftId] : undefined;
  if (!f || !ac) return null;
  const blocked = restSeatsBlocked(g, f.id);
  const off = g.messages.find((m) => m.problem?.kind === 'restSeats' && m.ref?.id === f.id);
  if (!blocked && !off) return null;
  const d = f.dutyId ? g.duties[f.dutyId] : undefined;
  const rest = restOf(g, ac.id);
  const seat = [rest.fc, rest.cc].find((x) => x && isSeatRest(x)) ?? null;
  const what = seat?.kind === 'recliners' ? 'crew rest recliners' : seat?.kind === 'ySeats' ? 'economy seats' : 'business seats';
  const total = ac.cabin.total;
  const sellable = total - blocked;
  const pax = f.pax ?? 0;
  const n = off?.hurt?.pax ?? Math.max(0, pax - sellable);
  const money = off?.hurt?.money ?? n * BAL.v072.restSeats.offloadPerPax;
  const title = `${f.no} can sell ${sellable} of ${total} seats`;
  return {
    subject: { kind: 'restSeats', ref: { kind: 'flight', id: f.id } }, severity: n > 0 ? 'red' : 'amber',
    title, what: title,
    why: `The ${d ? hrs(d.fdp) : 'long'} day needs in-flight rest; ${blocked} ${what} are curtained off as class ${seat?.cls ?? 2} crew rest.`,
    hurt: n > 0
      ? { ...mkHurt({ money, pax: n, what: 'compensation' }), text: `Yes: ${n} passenger${n > 1 ? 's' : ''} ${off ? 'offloaded' : 'to offload at departure'}, ${usdShort(money)}` }
      : { ...mkHurt({}), text: `Not much: the load is ${pax || 'below the sellable seats'}` },
    actions: [
      { id: 'schedule', label: 'Swap aircraft', open: { tab: 'schedule', sel: { kind: 'flight', id: f.id } }, primary: true },
      { id: 'refit', label: 'Plan crew rest', open: { modal: 'refit', id: ac.id } },
    ],
    details: [`${blocked} ${what} blocked (class ${seat?.cls ?? 2} crew rest) on ${ac.reg}`, `Booked ${pax} passengers`], visuals: {}, terms: ['restSeats', seat?.kind === 'ySeats' ? 'ySeats' : seat?.kind === 'recliners' ? 'recliners' : 'jSeats', 'crewRest'], by: f.std,
  };
}

// ---------- v0.7.3 in-flight rest (UPDATE-0.7.3.md §2.7) ----------

const hmm = (m: number) => `${Math.floor(Math.max(0, m) / 60)}:${String(Math.round(Math.max(0, m) % 60)).padStart(2, '0')}`;
const hrs = (m: number) => (m % 60 ? hmm(m) : `${m / 60} h`);
const kindName = (f: RestFacility): string => (f.kind === 'jSeats' ? 'business seats' : f.kind === 'ySeats' ? 'economy seats' : f.kind === 'recliners' ? 'crew rest recliners' : f.kind === 'ldmcr' ? 'lower-deck bunks' : 'bunks');
const restTerms = (f: RestFacility | null): TermId[] => (!f ? [] : f.kind === 'jSeats' ? ['jSeats', 'restClass2'] : f.kind === 'ySeats' ? ['ySeats', 'restClass3'] : f.kind === 'recliners' ? ['recliners', 'restClass2'] : f.kind === 'ldmcr' ? ['ldmcr', 'restClass1'] : f.kind === 'fcrc' ? ['fcrc', 'restClass1'] : ['ccrc', 'restClass1']);

/** The duty of a flight id (the card's ref is the duty's first leg), with its aircraft and facilities. */
function dutyOfFlight(g: GameState, flightId: string) {
  const f = g.flights[flightId];
  const d = f?.dutyId ? g.duties[f.dutyId] : undefined;
  const ac = f?.aircraftId ? g.fleet[f.aircraftId] : undefined;
  if (!f || !d || !ac || d.done || f.status === 'cancelled') return null;
  const first = g.flights[d.flightIds[0]] ?? f;
  const lastF = g.flights[d.flightIds[d.flightIds.length - 1]] ?? f;
  // The whole day's stations (an out-and-back reads AMM–MAA–AMM, not AMM–AMM).
  const stops = [first.from, ...d.flightIds.map((id) => g.flights[id]?.to).filter((x): x is string => !!x)];
  return { f: first, d, ac, rest: restOf(g, ac.id), route: stops.length <= 5 ? stops.join('–') : `${first.from}–${lastF.to}` };
}

/** Another aircraft of the same family with class 1 rest for both sides, free around the duty (a swap hint). */
function bunkAircraft(g: GameState, acId: string): string | null {
  const ac = g.fleet[acId];
  if (!ac) return null;
  const fam = typeOf(ac.typeId).family;
  for (const x of Object.values(g.fleet)) {
    if (x.id === acId || typeOf(x.typeId).family !== fam || x.status === 'delivering' || x.status === 'stored' || x.status === 'leasedOut') continue;
    const r = restOf(g, x.id);
    if (r.fc?.cls === 1 && r.cc?.cls === 1) return x.reg;
  }
  return null;
}

/** A trip's cost of one more crew member (a day's pay, per diem and a hotel night), est. */
const extraCrewCost = (g: GameState, role: 'CRP' | 'CC', days: number) =>
  Math.round(((BAL.salary[role]?.[1] ?? 3_000) / 21) * days + (BAL.perDiem[role] ?? 60) * days + (BAL.hotelPerNight[g.company.policies.hotelTier] ?? 140) * Math.max(1, days - 1));

/** A duty flies with 4 pilots only because the aircraft's rest is seats, not bunks (3 pilots in bunks would do). Pure. */
export function restFacilityCard(g: GameState, flightId: string): ProblemCard | null {
  const x = dutyOfFlight(g, flightId);
  if (!x || x.d.augment !== 2 || !x.rest.fc || !x.rest.cc || x.rest.fc.cls === 1) return null;
  const { f, d, ac } = x;
  const fc = x.rest.fc;
  const cc = x.rest.cc;
  const long = longSector(d.sectors, Math.max(...d.flightIds.map((id) => g.flights[id]?.block ?? 0)));
  const bunks = augLimitOf(1, 1, 1, long, 0).max;
  if (d.fdp > bunks) return null;
  const three = augLimitOf(fc.cls, cc.cls, 1, long, 0).max;
  if (d.fdp <= three) return null; // 3 pilots would do on these seats: 4 is not the facility's doing (e.g. the player chose it)
  const other = bunkAircraft(g, ac.id);
  const plan = restPlan(g, d.id);
  const blocked = plan ? Math.max(0, ...Object.values(plan.blocked)) : 0;
  const days = Math.max(1, Math.ceil((d.release - d.report) / 1440) + 1);
  const cost = extraCrewCost(g, 'CRP', days);
  const what = `${f.no} ${x.route} needs a 4th pilot.`;
  return {
    subject: { kind: 'restFacility', ref: { kind: 'flight', id: f.id } }, severity: 'amber',
    title: what, what,
    why: `${ac.reg} has no bunks: its ${kindName(fc)} are class ${fc.cls} rest, which allow ${hrs(three)} with 3 pilots. The day is ${hmm(d.fdp)}.`,
    hurt: { ...mkHurt({ money: cost, what: 'crew cost' }), text: `A 4th pilot's pay and hotel (about ${usdShort(cost)} a trip)${blocked && isSeatRest(fc) ? `; ${fc.places} more ${kindName(fc)} blocked` : ''}` },
    actions: [
      ...(other ? [{ id: 'swap', label: `Use ${other} (has bunks)`, open: { tab: 'schedule' as const, sel: { kind: 'flight' as const, id: f.id } }, primary: true }] : []),
      { id: 'refit', label: 'Plan a crew rest refit', open: { modal: 'refit', id: ac.id }, primary: !other },
      { id: 'ok', label: 'OK, fly with 4 pilots', open: { modal: 'duty', id: d.id } },
    ],
    details: [`Pilots rest: ${restText(fc, 'fc', ac.typeId)}`, `Cabin crew rest: ${restText(cc, 'cc', ac.typeId)}`, `With bunks: ${hrs(bunks)} with 3 pilots`],
    visuals: {}, terms: ['augmented', ...restTerms(fc), 'inflightRest'], by: f.std,
  };
}

/** No in-flight rest possible on a flight's duty: the cruise is too short (the roster slips a fresh crew, or nobody fits). Pure. */
export function restTooShortCard(g: GameState, flightId: string): ProblemCard | null {
  const x = dutyOfFlight(g, flightId);
  if (!x) return null;
  const { f, d, ac } = x;
  const slip = slipShort(g, d.id);
  const own = !slip && d.augment > 0 ? restPlan(g, d.id) : null;
  const plan = slip?.plan ?? (own && !own.ok && own.code === 'tooShort' ? own : null);
  if (!plan) return null;
  const fdp = slip?.fdp ?? d.fdp;
  const basic = slip?.basic ?? d.basicFdp ?? 13 * 60;
  const station = slip ? g.flights[slip.next.flightIds[0]]?.from ?? d.restAt : d.restAt;
  const city = AIRPORT_BY_CODE[station]?.city ?? station;
  const crewN = g.pairings[d.pairingId]?.slots.length ?? 4;
  const cost = slip ? Math.round(crewN * (ticketPrice(g.company.homeBase, station) + (BAL.hotelPerNight[g.company.policies.hotelTier] ?? 140))) : 0;
  const can4 = !!restPlan(g, d.id, { augment: 2 })?.ok;
  const short = (plan.why ?? '').replace(/^The cruise is too short for in-flight rest \(/, 'The cruise is too short (').replace(/; the /, '; the ');
  const what = `No in-flight rest possible on ${f.no}.`;
  return {
    subject: { kind: 'restTooShort', ref: { kind: 'flight', id: f.id } }, severity: 'red',
    title: what, what,
    why: `${short.endsWith('.') ? short : `${short}.`} Without rest the limit is ${hmm(basic)}; the day is ${hmm(fdp)}.`,
    hurt: slip
      ? { ...mkHurt({ money: cost, what: 'tickets and a hotel' }), text: `Yes: the roster splits it with a fresh crew at ${city} (tickets and a hotel, ~${usdShort(cost)})` }
      : { ...mkHurt({ pax: f.pax ?? 0, legs: d.flightIds.length, what: 'at risk' }), text: `Yes: no legal crew, ${d.flightIds.length} legs at risk` },
    actions: [
      ...(can4 ? [{ id: 'aug4', label: 'Fly it with 4 pilots', open: { modal: 'duty' as const, id: d.id }, primary: true }] : []),
      { id: 'retime', label: 'Retime the first leg', open: { tab: 'schedule', sel: { kind: 'flight', id: f.id } }, primary: !can4 },
      { id: 'crewControl', label: 'Crew Control', open: { modal: 'crewControl', id: f.id } },
    ],
    details: plan.cruise.map((c) => `${g.flights[c.flightId]?.no ?? c.flightId}: cruise ${hmm(Math.max(0, c.to - c.from))}`).concat([`${ac.reg}: ${restText(x.rest.fc, 'fc', ac.typeId)}`]),
    visuals: {}, terms: ['inflightRest', 'landingPilots', 'augmented'], by: f.std,
  };
}

/** A duty needs extra cabin crew so everyone can rest in the cruise. Pure. */
export function cabinRestCard(g: GameState, flightId: string): ProblemCard | null {
  const x = dutyOfFlight(g, flightId);
  if (!x || !(x.d.restExtra ?? 0) || x.d.augment === 0 || !x.rest.cc) return null;
  const { f, d, ac } = x;
  const cc = x.rest.cc;
  const plan = restPlan(g, d.id);
  if (!plan?.ok || plan.cabinNeed === null) return null;
  const n = d.restExtra!;
  const base = plan.cabin.reduce((s, t) => s + t.n, 0) - n;
  const days = Math.max(1, Math.ceil((d.release - d.report) / 1440) + 1);
  const cost = n * extraCrewCost(g, 'CC', days);
  const what = `${f.no} needs ${n} more cabin crew.`;
  const ldm = !!typeOf(ac.typeId).rest.mro && cc.cls !== 1;
  const other = bunkAircraft(g, ac.id);
  return {
    subject: { kind: 'cabinRest', ref: { kind: 'flight', id: f.id } }, severity: 'amber',
    title: what, what,
    why: `On a ${hmm(plan.cabinFdp)} day with class ${cc.cls} ${kindName(cc)} each flight attendant needs ${hmm(plan.cabinNeed)} rest. With ${base} crew and half of them in the cabin, the cruise only fits if ${base + n} fly.`,
    hurt: { ...mkHurt({ money: cost, what: 'crew cost' }), text: `${n} × per diem and hotel (about ${usdShort(cost)} a trip)` },
    actions: [
      ...(other ? [{ id: 'swap', label: 'Swap to an aircraft with bunks', open: { tab: 'schedule' as const, sel: { kind: 'flight' as const, id: f.id } }, primary: true }] : []),
      ...(ldm ? [{ id: 'refit', label: 'Plan crew bunks', open: { modal: 'refit' as const, id: ac.id }, primary: !other }] : []),
      { id: 'ok', label: 'OK', open: { modal: 'duty', id: d.id }, primary: !other && !ldm },
    ],
    details: [`Band ${plan.band}, class ${cc.cls}: ${hmm(plan.cabinNeed)} each`, `Cabin crew rest: ${restText(cc, 'cc', ac.typeId)}`],
    visuals: {}, terms: ['inflightRest', 'cabinCrew', ...restTerms(cc)], by: f.std,
  };
}

/** v0.7.3 the in-flight rest cards of duties reporting in the next `days` days (first legs), worst first. Pure. */
export function restCards(g: GameState, days = BAL.rosterHorizonDays): ProblemCard[] {
  const out: ProblemCard[] = [];
  for (const d of Object.values(g.duties)) {
    if (d.done || d.report < g.now || d.report > g.now + days * DAY || !d.flightIds.length) continue;
    const ac = g.fleet[g.flights[d.flightIds[0]]?.aircraftId ?? ''];
    if (!ac || typeOf(ac.typeId).body !== 'wide' && !restOf(g, ac.id).fc) continue;
    const fid = d.flightIds[0];
    const c = restTooShortCard(g, fid) ?? restFacilityCard(g, fid) ?? cabinRestCard(g, fid);
    if (c) out.push(c);
  }
  return out;
}
