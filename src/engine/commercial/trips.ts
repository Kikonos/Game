// v0.14 sales trips and trade fairs (Update 2 "Commercial"). From Company › Team the player sends someone (you, the
// accountable manager, or the commercial analyst once hired) to a trade fair or to visit a client. The traveller flies
// on airline seats exactly as our deadheading crew do: a seat on the hour that exists (no closed airport, no curfew:
// crew/timeline.ts ticketSlotOk / slotAfter), the airline itinerary with its hub connection (ops/commercial.ts),
// the per-seat price by distance (ticketPrice), the company's hotel tier. On the map the traveller rides the
// airline's aircraft icon like our crew. Costs go to the ledger's 'sales' line. On the way home the trip pays off:
// relations with the clients met, and leads that become offers (a handshake: no rival bidding) or, in tender season,
// an invitation to tender.

import { AIRPORT_BY_CODE } from '../../data/airports';
import { FAIR_BY_ID, FAIRS, fairEdition, TENDER_ISSUERS, TENDER_CLIENT_SEEDS, type Fair } from '../../data/fairs';
import { BAL } from '../core/balance';
import { nextId } from '../core/entities';
import { post } from '../core/ledger';
import { pushMessage } from '../core/messages';
import { chance, int, weightedPick } from '../core/rng';
import { DAY, fmtDay, fmtTime, fromUTC, localOffset, toDate } from '../core/time';
import type { ActionResult, Archetype, Client, GameState, Minute } from '../core/types';
import { ticketPrice, ticketSlotOk, slotAfter } from '../crew/timeline';
import { itinerary, ticketBlock, type CommercialLeg } from '../ops/commercial';
import { generateOffer } from '../contracts/offers';
import { hajjTender } from '../contracts/missions';
import { bumpClient } from '../contracts/relations';
import { issueTender, roundAt } from './tenders';
import { clientByName, com, comStats, sideOf, usdK, withStream } from './state';
import type { SalesTrip, TravelTicket, Traveller, TripLead } from './types';

export const TRIPS = {
  /** Per diem for the traveller (USD a day), the pass of a client visit (none). */
  perDiem: 110,
  /** Lead odds per client met: base + skill × slope (a visit: its own); at most this many leads a trip. */
  fairLead: [0.16, 0.16] as [number, number],
  visitLead: [0.4, 0.2] as [number, number],
  maxLeads: 2,
  /** Relation per client met at a fair, and for a visit. */
  fairRel: 4,
  visitRel: 8,
  /** Clients met at a fair. */
  meet: [3, 5] as [number, number],
  /** The skill of 'you' (the analyst's own skill when it travels). */
  ceoSkill: 0.6,
  /** Earliest departure after booking (minutes): tickets are bought now. */
  bookLead: 6 * 60,
  /** Fairs shown ahead (days). */
  ahead: 200,
};

const city = (code: string) => AIRPORT_BY_CODE[code]?.city ?? code;

// ---------- who travels ----------

export interface TravellerView {
  who: Traveller;
  name: string;
  title: string;
  skill: number;
  /** The trip they are on or booked for. */
  tripId: string | null;
}

/** You always; the commercial analyst once hired. Pure. */
export function travellers(g: GameState): TravellerView[] {
  const busy = (who: Traveller) => com(g).trips.find((t) => t.who === who && (t.status === 'planned' || t.status === 'away'))?.id ?? null;
  const out: TravellerView[] = [{ who: 'ceo', name: g.company.ceo || 'You', title: g.company.ceo ? 'Accountable manager (you)' : 'Accountable manager', skill: TRIPS.ceoSkill, tripId: busy('ceo') }];
  const a = g.heads?.analyst?.hired;
  if (a) out.push({ who: 'analyst', name: a.name, title: 'Commercial analyst', skill: a.skill, tripId: busy('analyst') });
  return out;
}

// ---------- dates and tickets ----------

/** A fair's meeting days in UTC: 08:00 local on the first day to 18:00 local on the last. Pure. */
export function fairDays(f: Fair, y: number): { start: Minute; end: Minute; at: string; where: string } {
  const e = fairEdition(f, y);
  const at = e.at;
  const s0 = fromUTC(e.y, e.m, e.d, 8);
  const start = s0 - localOffset(at, s0);
  return { start, end: start + (e.days - 1) * DAY + 10 * 60, at, where: e.where };
}

/** The next edition of a fair that has not started yet (this year or next). Pure. */
export function nextEdition(f: Fair, now: Minute): { start: Minute; end: Minute; at: string; where: string; year: number } {
  const y = toDate(now).getUTCFullYear();
  for (const yy of [y, y + 1, y + 2]) {
    const d = fairDays(f, yy);
    if (d.start > now) return { ...d, year: yy };
  }
  return { ...fairDays(f, y + 2), year: y + 2 };
}

/** A seat from → to leaving at or after t (the hour, a seat that exists), as a crew ticket is booked. */
function seatAfter(g: GameState, from: string, to: string, t: Minute): TravelTicket | null {
  const blk = ticketBlock(from, to);
  const std = slotAfter(g, from, to, Math.ceil(t / 60) * 60, blk);
  return std === null ? null : { from, to, std, sta: std + blk };
}

/**
 * Out: the latest seat landing by 21:00 local the evening before the meetings (from 06:00 UTC two days before),
 * never before the booking lead; back: the first seat from 2 h after the last meeting. Null with why when none fits.
 */
export function planTickets(g: GameState, home: string, at: string, start: Minute, end: Minute): { out: TravelTicket; back: TravelTicket } | { why: string } {
  if (home === at) return { why: 'It is at our home base: no trip needed' };
  const blk = ticketBlock(home, at);
  const eve = start - 11 * 60; // 21:00 local the evening before (start is 08:00 local)
  const earliest = Math.max(g.now + TRIPS.bookLead, start - 2 * DAY - 2 * 60);
  let out: TravelTicket | null = null;
  // The latest seat that lands by the evening before; else the first that lands before the meetings start.
  for (let std = Math.floor((eve - blk) / 60) * 60; std >= earliest; std -= 60) {
    if (ticketSlotOk(g, home, at, std, std + blk)) {
      out = { from: home, to: at, std, sta: std + blk };
      break;
    }
  }
  if (!out) {
    const s = seatAfter(g, home, at, earliest);
    if (s && s.sta <= start + 2 * 60) out = s;
  }
  if (!out) return { why: g.now + TRIPS.bookLead + blk > start ? 'Too late: no seat gets there in time' : `No seat to ${city(at)} in time (closed or curfew)` };
  const back = seatAfter(g, at, home, end + 2 * 60);
  if (!back) return { why: `No seat home from ${city(at)}` };
  return { out, back };
}

const hotelRate = (g: GameState) => BAL.hotelPerNight[g.company.policies.hotelTier] ?? 140;

export interface TripQuote {
  ok: boolean;
  why?: string;
  kind: 'fair' | 'visit';
  title: string;
  at: string;
  where: string;
  start: Minute;
  end: Minute;
  out?: TravelTicket;
  back?: TravelTicket;
  legsOut: CommercialLeg[];
  legsBack: CommercialLeg[];
  tickets: number;
  pass: number;
  hotel: number;
  perDiem: number;
  total: number;
  nights: number;
  /** Who you will meet ('Tour operators and leisure airlines'). */
  meets: string;
}

/** What a trip would cost and when it would fly (the planner's card). Pure. */
export function tripQuote(g: GameState, who: Traveller, target: { fairId?: string; clientId?: string }): TripQuote {
  const home = g.company.homeBase;
  let kind: 'fair' | 'visit' = 'fair';
  let at = '';
  let where = '';
  let title = '';
  let start = 0;
  let end = 0;
  let pass = 0;
  let meets = '';
  if (target.fairId) {
    const f = FAIR_BY_ID[target.fairId];
    if (!f) return emptyQuote('Unknown fair');
    const e = nextEdition(f, g.now);
    ({ at, where, start, end } = e);
    title = `${f.name} ${e.year}`;
    pass = f.pass;
    meets = f.leads === 'tour' ? 'Tour operators and leisure airlines' : f.leads === 'gulf' ? 'Gulf airlines, Hajj and Umrah operators' : f.leads === 'aog' ? 'Airline engineering chiefs: AOG cover' : 'Airline network and fleet planners';
  } else {
    const c = target.clientId ? g.clients[target.clientId] : undefined;
    if (!c || !AIRPORT_BY_CODE[c.base]) return emptyQuote('Choose a client to visit');
    kind = 'visit';
    at = c.base;
    where = `${city(c.base)}, ${c.name}`;
    title = `Visit ${c.name}`;
    // Meetings the second day after booking (09:00–17:00 local): a day to get there.
    const d = toDate(g.now + 2 * DAY);
    const s0 = fromUTC(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), 9);
    start = s0 - localOffset(at, s0);
    end = start + 8 * 60;
    meets = c.name;
  }
  const q: TripQuote = { ok: false, kind, title, at, where, start, end, legsOut: [], legsBack: [], tickets: 0, pass, hotel: 0, perDiem: 0, total: 0, nights: 0, meets };
  if (who === 'analyst' && !g.heads?.analyst?.hired) return { ...q, why: 'Hire a commercial analyst first' };
  const busy = travellers(g).find((x) => x.who === who)?.tripId;
  if (busy) return { ...q, why: 'Already on a trip' };
  const plan = planTickets(g, home, at, start, end);
  if ('why' in plan) return { ...q, why: plan.why };
  const { out, back } = plan;
  const nights = Math.max(1, Math.round((back.std - out.sta) / DAY));
  const tickets = ticketPrice(home, at) + ticketPrice(at, home);
  const hotel = nights * hotelRate(g);
  const perDiem = (nights + 1) * TRIPS.perDiem;
  return {
    ...q, ok: true, out, back, legsOut: itinerary(out.from, out.to, out.std, out.sta), legsBack: itinerary(back.from, back.to, back.std, back.sta),
    tickets, hotel, perDiem, nights, total: tickets + pass + hotel + perDiem,
  };
}

const emptyQuote = (why: string): TripQuote => ({ ok: false, why, kind: 'fair', title: '', at: '', where: '', start: 0, end: 0, legsOut: [], legsBack: [], tickets: 0, pass: 0, hotel: 0, perDiem: 0, total: 0, nights: 0, meets: '' });

/** Player action: book the trip (tickets and the pass paid now; hotel and per diem on return). */
export function bookTrip(g: GameState, who: Traveller, target: { fairId?: string; clientId?: string }): ActionResult<{ tripId: string }> {
  const q = tripQuote(g, who, target);
  if (!q.ok || !q.out || !q.back) return { ok: false, error: q.why ?? 'Cannot plan this trip' };
  const name = travellers(g).find((x) => x.who === who)?.name ?? 'You';
  const t: SalesTrip = {
    id: nextId(g, 'tp'), who, name, kind: q.kind, ...(target.fairId ? { fairId: target.fairId } : {}), ...(target.clientId ? { clientId: target.clientId } : {}),
    at: q.at, start: q.start, end: q.end, out: q.out, back: q.back, booked: g.now,
    cost: { tickets: q.tickets, pass: q.pass, hotel: q.hotel, perDiem: q.perDiem }, status: 'planned',
  };
  com(g).trips.push(t);
  post(g, 'sales', -(q.tickets + q.pass));
  comStats(g).trips++;
  const leg = q.legsOut[0];
  return { ok: true, msg: `${name} flies to ${city(q.at)} ${fmtDay(q.out.std)} ${fmtTime(q.out.std)} UTC (${fmtTime(q.out.std, q.out.from)} local)${leg ? ` on ${leg.no}` : ''}`, data: { tripId: t.id } };
}

/** Player action: call off a trip before it leaves (the pass is refunded; the seats are not). */
export function cancelTrip(g: GameState, tripId: string): ActionResult {
  const t = com(g).trips.find((x) => x.id === tripId);
  if (!t || t.status !== 'planned') return { ok: false, error: 'Only a trip that has not left can be called off' };
  if (g.now >= t.out.std) return { ok: false, error: 'Already on the way' };
  callOff(g, t, 'You called it off');
  return { ok: true, msg: `Trip called off: ${usdK(t.cost.pass)} pass refunded` };
}

function callOff(g: GameState, t: SalesTrip, why: string): void {
  t.status = 'cancelled';
  t.why = why;
  if (t.cost.pass) post(g, 'sales', t.cost.pass);
}

// ---------- daily: departures, closures, the way home ----------

export function dailyTrips(g: GameState): void {
  for (const t of com(g).trips) {
    if (t.status === 'planned' && t.out.std > g.now && !ticketSlotOk(g, t.out.from, t.out.to, t.out.std, t.out.sta)) {
      callOff(g, t, `${city(t.at)} is closed`);
      pushMessage(g, { tone: 'warn', cat: 'commercial', title: `Trip called off: ${tripTitle(t)}`, body: `${city(t.at)} is closed for now. The pass is refunded; the seats are not.`, ref: { kind: 'trip', id: t.id }, cue: 'notice' });
      continue;
    }
    if (t.status === 'planned' && g.now >= t.out.std) t.status = 'away';
    if (t.status === 'away' && g.now >= t.back.sta) tripDone(g, t);
  }
  // Trips over a year old are pruned.
  const c = com(g);
  if (c.trips.length > 30) c.trips = c.trips.filter((t) => t.status === 'planned' || t.status === 'away' || g.now - t.back.sta < 365 * DAY);
}

export const tripTitle = (t: SalesTrip): string => (t.kind === 'fair' ? FAIR_BY_ID[t.fairId ?? '']?.name ?? 'Trade fair' : `Visit to ${city(t.at)}`);

/** The clients a fair's audience offers: airlines and tour operators (or its other kinds) of its countries, still flying. */
function audience(g: GameState, f: Fair): Client[] {
  const inc = (country: string) => !f.countries.length || f.countries.includes(country);
  return Object.values(g.clients).filter((c) => !c.rivalId && c.ceased === undefined && f.meets.includes(c.kind) && inc(c.country) && AIRPORT_BY_CODE[c.base]);
}

/** Back home: hotel and per diem, the clients met, the leads. */
function tripDone(g: GameState, t: SalesTrip): void {
  t.status = 'done';
  post(g, 'sales', -(t.cost.hotel + t.cost.perDiem));
  const r = sideOf(g, `trip:${t.id}`);
  const skill = travellers(g).find((x) => x.who === t.who)?.skill ?? TRIPS.ceoSkill;
  const met: Client[] = [];
  const f = t.fairId ? FAIR_BY_ID[t.fairId] : undefined;
  if (f) {
    const pool = audience(g, f);
    // The airlines of the tender issuers not in the game yet may be met too (added on meeting).
    const extra = TENDER_CLIENT_SEEDS.filter((s) => f.meets.includes('airline') && (!f.countries.length || f.countries.includes(s.country)) && !pool.some((c) => c.name === s.name));
    const n = int(r, TRIPS.meet[0], TRIPS.meet[1]);
    const cands: (Client | string)[] = [...pool, ...extra.map((s) => s.name)];
    for (let i = 0; i < n && cands.length; i++) {
      const x = weightedPick(r, cands, (c) => (typeof c === 'string' ? 1 : (c.jobs ?? 0) > 0 || c.relation > 0 ? 1.5 : 1))!;
      cands.splice(cands.indexOf(x), 1);
      const c = typeof x === 'string' ? clientByName(g, x) : x;
      if (c) met.push(c);
    }
    for (const c of met) bumpClient(g, c.id, TRIPS.fairRel, `Met at ${f.name}`);
  } else if (t.clientId && g.clients[t.clientId]) {
    met.push(g.clients[t.clientId]);
    bumpClient(g, t.clientId, TRIPS.visitRel, `${t.name} visited them`);
  }
  t.met = met.map((c) => c.id);
  const leads: TripLead[] = [];
  const [b, s] = f ? TRIPS.fairLead : TRIPS.visitLead;
  for (const c of met) {
    if (leads.length >= TRIPS.maxLeads || (!f && leads.length >= 1)) break;
    if (!chance(r, b + s * skill)) continue;
    const lead = makeLead(g, t, c, f);
    if (lead) leads.push(lead);
  }
  t.leads = leads;
  comStats(g).leads += leads.length;
  const names = met.map((c) => c.name);
  const leadText = leads.length
    ? leads.map((l) => `${g.clients[l.clientId]?.name}: ${l.kind === 'rfp' ? 'an invitation to tender' : g.offers[l.offerId ?? '']?.title ?? 'an offer'}`).join('; ')
    : 'no firm leads this time';
  pushMessage(g, {
    tone: leads.length ? 'good' : 'info', cat: 'commercial', title: `${t.name} is back from ${tripTitle(t)}`,
    body: `Met ${names.length ? names.join(', ') : 'nobody new'}. ${leads.length ? 'Leads' : 'Result'}: ${leadText}. Cost ${usdK(t.cost.tickets + t.cost.pass + t.cost.hotel + t.cost.perDiem)}.`,
    ref: leads[0]?.offerId ? { kind: 'offer', id: leads[0].offerId } : leads[0]?.tenderId ? { kind: 'tender', id: leads[0].tenderId } : { kind: 'trip', id: t.id },
  });
}

/** One lead: in tender season an airline's invitation to tender; else an offer asked of us first (no rival bidding). */
function makeLead(g: GameState, t: SalesTrip, c: Client, f: Fair | undefined): TripLead | null {
  const round = roundAt(g.now);
  const c0 = com(g);
  if (round && c.kind === 'airline' && TENDER_ISSUERS.some((x) => x.name === c.name && (round.kind === 'summer' || x.winter)) && !c0.tenders.some((x) => x.clientId === c.id && x.status === 'open')) {
    const tn = issueTender(g, { clientId: c.id, invited: true, round });
    if (tn) return { clientId: c.id, kind: 'rfp', tenderId: tn.id };
  }
  const kinds: Archetype[] = c.kind === 'tourOperator' ? ['tourSeries', 'adhoc'] : c.kind === 'government' ? (hajjTender(g.now) ? ['hajj', 'repatriation'] : ['repatriation']) : f?.leads === 'aog' ? ['seasonBase', 'adhoc'] : ['seasonBase', 'adhoc'];
  for (const a of kinds) {
    const o = withStream(g, `lead:${t.id}:${c.id}:${a}`, () => generateOffer(g, a, { client: c.id, window: false, wide: false, paint: false, cabin: false }));
    if (!o || o.clientId !== c.id) {
      if (o) delete g.offers[o.id];
      continue;
    }
    o.firstRefusal = true;
    delete o.rivalBid;
    o.expires = Math.max(o.expires, Math.min(o.start - 12 * 60, g.now + 5 * DAY));
    o.blurb = `${t.kind === 'fair' ? `Met at ${f?.name ?? 'the fair'}` : `After ${t.name}'s visit`}: they asked us first. ${o.blurb}`;
    return { clientId: c.id, kind: 'offer', offerId: o.id };
  }
  return null;
}

// ---------- views ----------

export interface FairView {
  id: string;
  name: string;
  short: string;
  where: string;
  at: string;
  start: Minute;
  end: Minute;
  pass: number;
  blurb: string;
  /** A trip already booked to it. */
  tripId: string | null;
}

/** Fairs in the next TRIPS.ahead days, soonest first. Pure. */
export function fairsAhead(g: GameState): FairView[] {
  const out: FairView[] = [];
  for (const f of FAIRS) {
    const e = nextEdition(f, g.now);
    if (e.start - g.now > TRIPS.ahead * DAY) continue;
    const trip = com(g).trips.find((t) => t.fairId === f.id && t.start === e.start && t.status !== 'cancelled');
    out.push({ id: f.id, name: f.name, short: f.short, where: e.where, at: e.at, start: e.start, end: e.end, pass: f.pass, blurb: f.blurb, tripId: trip?.id ?? null });
  }
  return out.sort((a, b) => a.start - b.start);
}

/** Trips: under way or booked first, then the last done. Pure. */
export function tripsView(g: GameState): SalesTrip[] {
  const rank = (t: SalesTrip) => (t.status === 'away' ? 0 : t.status === 'planned' ? 1 : 2);
  return [...com(g).trips].sort((a, b) => rank(a) - rank(b) || (rank(a) < 2 ? a.out.std - b.out.std : b.back.sta - a.back.sta)).slice(0, 12);
}

/** Where the traveller is now: 'In the air to Berlin on LH 1171', 'At ITB Berlin', 'Home'. Pure. */
export function tripNow(g: GameState, t: SalesTrip): string {
  const now = g.now;
  if (t.status === 'cancelled') return `Called off${t.why ? `: ${t.why}` : ''}`;
  if (t.status === 'done') return `Back ${fmtDay(t.back.sta)}`;
  const legOf = (k: TravelTicket) => itinerary(k.from, k.to, k.std, k.sta).find((l) => l.dep <= now && now < l.arr);
  if (now < t.out.std) return `Leaves ${fmtDay(t.out.std)} ${fmtTime(t.out.std)} UTC (${fmtTime(t.out.std, t.out.from)} local)`;
  if (now < t.out.sta) {
    const l = legOf(t.out);
    return l ? `Flying ${l.from}–${l.to} on ${l.no}` : `Connecting on the way to ${city(t.at)}`;
  }
  if (now < t.back.std) return now < t.start ? `In ${city(t.at)}, meetings from ${fmtDay(t.start)}` : `At ${tripTitle(t)}`;
  const l = legOf(t.back);
  return l ? `Flying home on ${l.no}` : 'On the way home';
}

/** The airline legs our travellers ride overlapping [t0, t1) (the map's deadhead layer). Pure. */
export function travelLegs(g: GameState, t0: Minute, t1: Minute): { ticketId: string; legs: CommercialLeg[]; who: string; tripId: string }[] {
  const out: { ticketId: string; legs: CommercialLeg[]; who: string; tripId: string }[] = [];
  for (const t of g.com?.trips ?? []) {
    if (t.status === 'cancelled') continue;
    for (const [k, tk] of [['o', t.out], ['b', t.back]] as const) {
      if (tk.std >= t1 || tk.sta <= t0) continue;
      out.push({ ticketId: `${t.id}~${k}`, legs: itinerary(tk.from, tk.to, tk.std, tk.sta), who: t.name, tripId: t.id });
    }
  }
  return out;
}
