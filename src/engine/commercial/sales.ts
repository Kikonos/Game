// v0.16 Sales (UPDATE-0.16.md §C; lane `sales`): brokers with a relationship and their commission, the leads pipeline
// (lead → proposal → negotiation → signed, or cold / lost), pre-season pitches to airlines and regional sales managers.
// State lives in g.com (brokers, leads, pitches, reps). Offers that come this way carry `brokerId` / `leadId`.
//
// About half the work now comes to the market by itself (BAL.marketOffers.perWeek halved); the rest is chased here.
// Every lead names a real client at our level on the prestige ladder (one level up now and then: a stretch); a lead
// goes cold after 14 days without a proposal, a proposal is answered in 2–7 days (55 % an offer on the market, the
// normal accept / counter flow), a pitch in autumn is how next summer's ACMI capacity is really sold.
//
// The offer and tender builders live in contracts/offers.ts and ./tenders.ts, which import this module (brokerCut,
// the problem cards): commercial/index.ts hands them in through setSalesHooks so there is no import cycle.

import { AIRPORT_BY_CODE } from '../../data/airports';
import { MARKET_BY_ID, MARKET_IDS, type MarketId } from '../../data/markets';
import { BAL } from '../core/balance';
import { nextId } from '../core/entities';
import { post } from '../core/ledger';
import { pushMessage } from '../core/messages';
import { isolatePauses } from '../core/pause';
import { typeOf } from '../core/perf';
import { schedule } from '../core/queue';
import { chance, int, next, pick, weightedPick, type RngHolder } from '../core/rng';
import { statsV016 } from '../core/stats016';
import { distance } from '../core/geo';
import { DAY, dayIndex, fmtDay, fromUTC, monthKey, monthStart, toDate, fmtSpan } from '../core/time';
import type {
  ActionResult, Archetype, BrokerId, BrokerRel, Client, ClientKind, ContractOffer, GameState, HeadCandidate, Lead, LeadSource, LeadStage, Minute, MonthKey, Pitch, SalesRep,
} from '../core/types';
import type { IdleWindow, OfferOpts } from '../contracts/offers';
import { isGovernment, roleOf } from '../contracts/clients';
import { PRESTIGE_GATE, clientPrestige, noteStretch, playerPrestige } from '../contracts/prestige';
import { bumpClient } from '../contracts/relations';
import { busyShare } from '../ops/director';
import { lockOf } from '../scenario/rules';
import { mkHurt, type ProblemCard } from '../problems/types';
import { rollPeople } from './people';
import { bumpPresence, clientMarket, homeMarket, presenceWeight } from './presence';
import { busyNow, com, comStats, paceOf, sideOf, usdK, withStream } from './state';
import { bodiesFor, holdsWide, pickBody, seatsFor, targetUnit, wideShareOf } from '../contracts/fleetFit';
import { bodyOfReq, type Body } from '../contracts/shape';
import type { Tender } from './types';

/** The tender round open now (tenders.ts roundAt), as the hooks hand it in. */
export interface RoundNow { key: string; kind: 'summer' | 'winter' }

const S = BAL.v016.sales;
const P = BAL.v016.prestige;

export const BROKER_IDS: BrokerId[] = ['acs', 'chapman', 'acc', 'airPartner', 'huntPalmer'];
export const brokerName = (id: BrokerId): string => S.brokers[id]?.name ?? id;
/** The commission a broker takes on a deal it brought (share of the price / rate). Pure. */
export const commissionOf = (id: BrokerId): number => S.brokers[id]?.commission ?? BAL.brokerCommission;
/** A broker id from a broker's name (older offers carry the name only). Pure. */
export const brokerIdOf = (name: string | undefined): BrokerId | undefined => BROKER_IDS.find((id) => S.brokers[id].name === name);

/** Load (and new game): the sales records' defaults (SAVE_VERSION stays 1). */
export function loadSales(g: GameState): void {
  const c = com(g);
  c.brokers ??= {};
  c.leads ??= [];
  c.pitches ??= [];
  c.reps ??= [];
  // v0.19.4 an older live lead gets its body now (its offer's, a narrowbody fleet's, else the fleet-weighted draw on its
  // own stream), so the card shows it and the offer keeps it.
  for (const l of c.leads) {
    if (l.body || (l.stage !== 'lead' && l.stage !== 'proposal' && l.stage !== 'negotiation')) continue;
    const o = l.offerId ? g.offers[l.offerId] : undefined;
    const cl = g.clients[l.clientId];
    l.body = o ? bodyOfReq(o.requirements) : !holdsWide(g) || !cl ? 'narrow' : pickBody(g, cl, next(sideOf(g, `leadbody:${l.id}`))) ?? 'narrow';
  }
}

// ---------- hooks (the builders that import this module) ----------

export interface SalesHooks {
  offer: (g: GameState, archetype: Archetype, opts: OfferOpts) => ContractOffer | null;
  /** v0.16 balance: whether an aircraft of ours is the kind that offer needs (offers.ts fleetCouldFly): brokers and sales staff bring work for the types we operate. */
  fits: (g: GameState, offerId: string) => boolean;
  /** v0.19.4 the type of ours the job fits (offers.ts fleetFitType): the lead remembers it. */
  fitType: (g: GameState, offerId: string) => string | undefined;
  /** v0.16 balance: an idle window of the fleet the kind of work fits (offers.ts leadWindow): a lead's offer takes dates that suit our calendar. v0.19.4 on these aircraft only. */
  window: (g: GameState, archetype: Archetype, r: RngHolder, onAc?: (aircraftId: string) => boolean) => IdleWindow | undefined;
  tender: (g: GameState, opts: { clientId?: string; invited?: boolean }) => Tender | null;
  round: (t: Minute) => RoundNow | null;
  /** Whether this airline issues RFPs in that kind of round (data/fairs.ts TENDER_ISSUERS). */
  /** v0.19.4 or a widebody tenderer once we can bid one. */
  issuer: (name: string, kind: 'summer' | 'winter', g: GameState) => boolean;
}
let hooks: SalesHooks | null = null;
export function setSalesHooks(h: SalesHooks): void {
  hooks = h;
}

const leads = (g: GameState): Lead[] => (com(g).leads ??= []);
const live = (l: Lead): boolean => l.stage === 'lead' || l.stage === 'proposal' || l.stage === 'negotiation';
/** A widebody fleet may be offered widebody work; otherwise the builders stay narrowbody. */
const wideOpt = (g: GameState): false | undefined => (Object.values(g.fleet).some((a) => typeOf(a.typeId).body === 'wide') ? undefined : false);
const joined = (g: GameState): SalesRep[] => (g.com?.reps ?? []).filter((r) => r.joins <= g.now);

// ---------- brokers ----------

export interface BrokerView {
  id: BrokerId;
  name: string;
  commission: number;
  /** What they bring, in words. */
  focus: string;
  rel: BrokerRel | null;
  /** How much of what they sell fits our level (0–1), and the leads a month that makes at this relation. */
  fit: number;
  leadsPerMonth: number;
  /** A visit ($) is possible now (registered, not inside the last 30 days). */
  canVisit: boolean;
  visitCost: number;
}

const FOCUS: Record<BrokerId, string> = {
  acs: 'Every kind of work, worldwide',
  chapman: 'Governments, aid agencies, sports and big groups, worldwide',
  acc: 'Airlines\' ACMI: season bases, AOG cover, capacity leases',
  airPartner: 'Sports, music and corporate groups in Europe and North America',
  huntPalmer: 'Sports and group charters in the UK and Europe',
};

const ALL_KINDS: ClientKind[] = ['airline', 'tourOperator', 'government', 'agency', 'sports', 'music', 'corporate'];
/** What each broker sells: the client kinds, the kinds of work (empty: whatever the client asks) and where. */
const BROKER_FOCUS: Record<BrokerId, { kinds: ClientKind[]; archetypes: Archetype[]; markets?: MarketId[] }> = {
  acs: { kinds: ALL_KINDS, archetypes: [] },
  chapman: { kinds: ['government', 'agency', 'sports'], archetypes: ['repatriation', 'troopRotation', 'unRotation', 'humanitarian', 'sports', 'adhoc'] },
  acc: { kinds: ['airline'], archetypes: ['seasonBase', 'aogCover', 'capacityLease'] },
  airPartner: { kinds: ['sports', 'music', 'corporate'], archetypes: ['sports', 'musicTour', 'adhoc', 'vip'], markets: ['nwe', 'seu', 'cee', 'nam'] },
  huntPalmer: { kinds: ['sports', 'tourOperator', 'corporate'], archetypes: ['sports', 'adhoc', 'tourSeries'], markets: ['nwe', 'seu', 'cee'] },
};
/** A broker visit: a day at their office (tickets and the day), the relation it buys, and how often. */
export const BROKER_VISIT = { cost: 1_500, relation: 5, everyDays: 30 };

/** Clients a broker could bring us: its kinds and markets, in business, not a rival. Pure. */
function brokerPool(g: GameState, id: BrokerId): Client[] {
  const F = BROKER_FOCUS[id];
  return Object.values(g.clients).filter((c) => !c.rivalId && c.ceased === undefined && F.kinds.includes(c.kind) && !!AIRPORT_BY_CODE[c.base] && (!F.markets || F.markets.includes(clientMarket(c))));
}

/** The share of a broker's focus that is at our level ± 1 (what it can sell us). Pure. */
export function brokerFit(g: GameState, id: BrokerId): number {
  if (id === 'acs') return 1;
  const lvl = playerPrestige(g).level;
  const F = BROKER_FOCUS[id];
  const pool = brokerPool(g, id);
  const kinds = F.kinds.filter((k) => pool.some((c) => c.kind === k && Math.abs(clientPrestige(c) - lvl) <= 1));
  return Math.round((0.4 + 0.6 * (kinds.length / F.kinds.length)) * 100) / 100;
}

/**
 * Leads a week a broker brings at this relation (§C.2, v0.16 balance): leadsPerWeek × (base + (1 − base) × relation / 100)
 * × fit. A fresh registration already brings `base` of the full rate (we are on their list for our types); deals and
 * visits bring the rest. Pure.
 */
export const brokerLeadRate = (g: GameState, id: BrokerId, relation: number): number => S.leadsPerWeek * (S.relation.base + (1 - S.relation.base) * (relation / 100)) * brokerFit(g, id);

/** Leads a month a broker brings at this relation. Pure. */
export const brokerLeadsPerMonth = (g: GameState, id: BrokerId, relation: number): number => Math.round(brokerLeadRate(g, id, relation) * (365 / 12 / 7) * 100) / 100;

/** The brokers for Contracts › Sales. Pure. */
export function brokerView(g: GameState): BrokerView[] {
  const rels = g.com?.brokers ?? {};
  return BROKER_IDS.map((id) => {
    const rel = rels[id] ?? null;
    return {
      id, name: brokerName(id), commission: commissionOf(id), focus: FOCUS[id], rel, fit: brokerFit(g, id),
      leadsPerMonth: rel ? brokerLeadsPerMonth(g, id, rel.relation) : 0,
      canVisit: !!rel && g.now - (rel.lastVisit ?? -Infinity) >= BROKER_VISIT.everyDays * DAY, visitCost: BROKER_VISIT.cost,
    };
  });
}

/** Register with a broker: a call or a day at their office, free. Relation starts at 20. */
export function registerBroker(g: GameState, id: BrokerId): ActionResult {
  if (!S.brokers[id]) return { ok: false, error: 'No such broker' };
  const lock = lockOf(g, 'sales');
  if (lock) return { ok: false, error: lock };
  loadSales(g);
  const b = com(g).brokers!;
  if (b[id]) return { ok: false, error: `You are already registered with ${brokerName(id)}` };
  b[id] = { relation: S.relation.register, since: g.now, deals: 0 };
  return { ok: true, msg: `Registered with ${brokerName(id)}. They know what we fly and where; leads come on busy days.` };
}

/** A day at the broker's office: $1,500 and +5 relation, once a month per broker; visits alone take the relation to `visitCap` at most (their deals flown well take it beyond). */
export function visitBroker(g: GameState, id: BrokerId): ActionResult {
  const rel = g.com?.brokers?.[id];
  if (!rel) return { ok: false, error: `Register with ${brokerName(id)} first` };
  const lock = lockOf(g, 'sales');
  if (lock) return { ok: false, error: lock };
  if (g.now - (rel.lastVisit ?? -Infinity) < BROKER_VISIT.everyDays * DAY) return { ok: false, error: `You visited ${brokerName(id)} less than a month ago` };
  if (g.company.cash < BROKER_VISIT.cost) return { ok: false, error: `Needs ${usdK(BROKER_VISIT.cost)}` };
  post(g, 'sales', -BROKER_VISIT.cost);
  const cap = Math.max(rel.relation, S.relation.visitCap);
  rel.relation = Math.min(cap, rel.relation + BROKER_VISIT.relation);
  rel.lastVisit = g.now;
  return { ok: true, msg: `A day with ${brokerName(id)}: relation ${rel.relation}.${rel.relation >= S.relation.visitCap ? ' Visits take it no further: fly their deals well.' : ''}` };
}

/** Relation after a deal (flown well or not) or a cancellation; the floor once registered. */
function brokerDeal(g: GameState, id: BrokerId, what: 'good' | 'poor' | 'cancelled'): void {
  const rel = g.com?.brokers?.[id];
  if (!rel) return;
  const d = what === 'good' ? S.relation.deal : what === 'poor' ? Math.round(S.relation.deal / 3) : S.relation.cancelled;
  rel.relation = Math.max(S.relation.floor, Math.min(100, rel.relation + d));
  if (what !== 'cancelled') {
    rel.deals++;
    rel.lastDeal = g.now;
    statsV016(g).brokerDeals++;
  }
}

/** Daily: contracts a broker brought that closed since (completed or cancelled), credited once. */
function creditBrokerDeals(g: GameState): void {
  for (const c of Object.values(g.contracts)) {
    if (!c.brokerId || c.brokerDone || (c.status !== 'completed' && c.status !== 'cancelled')) continue;
    c.brokerDone = true;
    if (c.status === 'cancelled') {
      brokerDeal(g, c.brokerId, 'cancelled');
      continue;
    }
    const flown = c.legsFlown ?? 0;
    const onTime = flown ? (c.legsOnTime ?? 0) / flown : 1;
    brokerDeal(g, c.brokerId, onTime >= S.relation.onTime ? 'good' : 'poor');
  }
}

/** v0.16 a tender won through a broker: its relation grows (tenders.ts decideTender). */
export function onTenderWonVia(g: GameState, brokerId: BrokerId | undefined): void {
  const rel = brokerId ? g.com?.brokers?.[brokerId] : undefined;
  if (!rel) return;
  rel.relation = Math.min(100, rel.relation + S.tenderBroker);
  rel.deals++;
  rel.lastDeal = g.now;
  statsV016(g).brokerDeals++;
}

// ---------- the client behind a lead (the ladder's gating) ----------

/** A client for a lead: at our level mostly, below less, one above rarely (a stretch, §B.3), weighted by relation. */
function pickLeadClient(g: GameState, r: RngHolder, pool: Client[]): Client | undefined {
  const lvl = playerPrestige(g).level;
  const stretchOk = g.now - (g.company.prestige?.stretchAt ?? -Infinity) >= P.stretchDays * DAY;
  return weightedPick(r, pool, (c) => {
    const d = clientPrestige(c) - lvl;
    const w = P.weight[String(d)] ?? 0;
    if (d >= 1 && !stretchOk) return 0;
    // Brokers sell us where we are known (the ordinary draw's presence weight), and to clients who know us.
    return w * (0.2 + presenceWeight(g, c.country)) * (1 + Math.max(0, c.relation) / 100);
  });
}

/**
 * The kinds of work a client asks for, narrowed to what the source sells; the first is the likeliest. Pure.
 * v0.16 balance: a tour operator's request through a broker or a sales call is a one-off charter first (a rotation
 * or two) and a season series second: series are negotiated with the airline directly, brokers move groups.
 */
export function leadArchetypes(c: Client, focus: Archetype[] = []): Archetype[] {
  // An AOG cover is asked for the same day (a call, a market offer), never worked through a proposal: not a lead kind.
  const base: Archetype[] = c.kind === 'airline' ? ['seasonBase', 'capacityLease']
    : c.kind === 'tourOperator' ? ['adhoc', 'tourSeries']
    : c.kind === 'government' ? (roleOf(c) === 'defence' ? ['troopRotation', 'repatriation'] : ['repatriation', 'adhoc'])
    : c.kind === 'agency' ? (isGovernment(c) ? ['humanitarian', 'unRotation'] : ['adhoc', 'tourSeries'])
    : c.kind === 'sports' ? ['sports']
    : c.kind === 'music' ? ['musicTour', 'adhoc']
    : c.kind === 'corporate' ? ['adhoc', 'vip']
    : ['adhoc'];
  const both = focus.length ? base.filter((a) => focus.includes(a)) : base;
  return both.length ? both : base;
}

/**
 * A quiet draft of the job to price the lead (title, estimated value): built and dropped at once, on a borrowed
 * stream; the stretch slot it might take is given back (the real offer comes at the proposal's answer).
 */
function quoteLead(g: GameState, c: Client, archetypes: Archetype[], key: string, opts: Partial<OfferOpts> = {}, want?: Body): LeadQuote | null {
  if (!hooks) return null;
  const p = g.company.prestige;
  const stretchAt = p?.stretchAt;
  const stretched = statsV016(g).stretchOffers;
  const lastTitle = c.lastTitle;
  // An urgent draft would post its Inbox line and ask for a pause: isolated, and the line taken back.
  const nMsg = g.messages.length;
  // The likeliest kind first in three of five leads; otherwise the client's other kinds come first (one roll on the
  // lead's own stream, so the mix is not all series or all one-offs).
  const order = archetypes.length > 1 && !chance(sideOf(g, `leadq:${key}:kind`), S.lead.firstKind) ? [...archetypes.slice(1), archetypes[0]] : archetypes;
  // v0.19.4 the body the client asks for, fixed now (the offer keeps it): what our fleet has and the client flies,
  // weighted by our idle and soon-idle aircraft (contracts/fleetFit.ts); a widebody job has one of ours in mind (its seats).
  const br = sideOf(g, `leadq:${key}:body`);
  // v0.24 a client that flies nothing like ours (a widebody-only airline and a narrowbody fleet) brings no lead.
  const bodies = bodiesFor(g, c);
  const first = want && bodies.includes(want) ? want : pickBody(g, c, next(br));
  if (!first) return null;
  const tryBodies: Body[] = [first, ...bodies.filter((b) => b !== first)];
  try {
    for (const body of tryBodies) {
      const u = body === 'wide' ? targetUnit(g, 'wide', next(br)) : undefined;
      const seats = u ? Math.min(280, seatsFor(u, next(br))) : undefined;
      for (const a of order) {
        if (lockOf(g, 'market', { archetype: a })) continue;
        const bodyOpts: Partial<OfferOpts> = holdsWide(g) ? { wide: body === 'wide', aspire: false, ...(seats && !opts.seats ? { seats } : {}) } : { wide: false };
        const o = isolatePauses(() => withStream(g, `leadq:${key}:${a}${body === first ? '' : `:${body}`}`, () => hooks!.offer(g, a, { client: c.id, window: false, paint: false, cabin: false, ...bodyOpts, ...opts }), true));
        if (!o) continue;
        // v0.16 balance: a broker or a sales manager brings work for the types we fly (a job no aircraft of ours could do
        // is not a lead): checked while the draft is still on the board.
        const fits = o.clientId === c.id && hooks.fits(g, o.id);
        const typeId = fits ? hooks.fitType(g, o.id) : undefined;
        const got = bodyOfReq(o.requirements);
        const minSeats = o.requirements.minSeats;
        delete g.offers[o.id];
        if (!fits) continue;
        return { archetype: a, title: o.title, value: o.estValue, body: got, seats: minSeats, ...(typeId ? { typeId } : {}) };
      }
    }
    return null;
  } finally {
    if (g.messages.length > nMsg) g.messages.splice(0, g.messages.length - nMsg);
    if (p) {
      if (stretchAt === undefined) delete p.stretchAt;
      else p.stretchAt = stretchAt;
    }
    statsV016(g).stretchOffers = stretched;
    if (lastTitle === undefined) delete c.lastTitle;
    else c.lastTitle = lastTitle;
  }
}

interface LeadQuote { archetype: Archetype; title: string; value: number; body: Body; seats: number; typeId?: string }

interface NewLead {
  source: LeadSource;
  brokerId?: BrokerId;
  repId?: string;
  archetypes: Archetype[];
  key: string;
  stage?: 'lead' | 'proposal';
  why: (title: string) => string;
  /** v0.16 balance: the quote's dates (a pitch lead is priced for its season, not for next month). */
  opts?: Partial<OfferOpts>;
  /** v0.19.4 the body asked for (a pitch's). */
  body?: Body;
}

/** A lead into the pipeline (null when no sensible job could be drafted for that client). */
function newLead(g: GameState, c: Client, x: NewLead): Lead | null {
  const q = quoteLead(g, c, x.archetypes, x.key, x.opts, x.body);
  if (!q) return null;
  const r = sideOf(g, `lead:${x.key}:reply`);
  const stage: LeadStage = x.stage ?? 'lead';
  const lead: Lead = {
    id: nextId(g, 'ld'), clientId: c.id, source: x.source, ...(x.brokerId ? { brokerId: x.brokerId } : {}), ...(x.repId ? { repId: x.repId } : {}),
    archetype: q.archetype, market: clientMarket(c), stage, created: g.now, moved: g.now,
    expires: stage === 'proposal' ? g.now + int(r, S.lead.replyDays[0], S.lead.replyDays[1]) * DAY : g.now + S.lead.coldDays * DAY,
    value: q.value, title: q.title, why: x.why(q.title),
    body: q.body, seats: q.seats, ...(q.typeId ? { typeId: q.typeId } : {}),
  };
  leads(g).push(lead);
  const st = statsV016(g);
  st.leads++;
  (st.leadsBy ??= {})[x.source] = (st.leadsBy[x.source] ?? 0) + 1;
  comStats(g).leads++;
  return lead;
}

/** A lead from a sales trip (trips.ts): the client met asked about work; it waits in the pipeline for a proposal. */
export function fairLead(g: GameState, c: Client, tripId: string, fairName: string | null): Lead | null {
  if (!hooks) return null;
  return newLead(g, c, { source: fairName ? 'fair' : 'visit', archetypes: leadArchetypes(c), key: `trip:${tripId}:${c.id}`, why: (t) => `${fairName ? `Met at ${fairName}` : 'After the visit'}: ${c.name} asked about it. ${t}.` });
}

// ---------- the pipeline ----------

export interface LeadView extends Lead {
  clientName: string;
  country: string;
  stageName: string;
  /** Days before the current stage lapses (0 today). */
  daysLeft: number;
  marketName: string;
  sourceName: string;
  /** The offer under negotiation is still open on the market. */
  offerOpen: boolean;
  /** v0.19.4 the body asked for (the card's tag): the lead's, else its offer's. */
  shown?: Body;
}

export const STAGE_NAME: Record<LeadStage, string> = { lead: 'Lead', proposal: 'Proposal sent', negotiation: 'Offer on the market', signed: 'Signed', cold: 'Went cold', lost: 'Lost' };

export function leadSourceName(g: GameState, l: Lead): string {
  if (l.brokerId) return brokerName(l.brokerId);
  if (l.repId) return g.com?.reps?.find((r) => r.id === l.repId)?.name ?? 'Sales manager';
  return l.source === 'fair' ? 'Trade fair' : l.source === 'visit' ? 'Client visit' : l.source === 'pitch' ? 'Pre-season pitch' : l.source === 'tender' ? 'Tender' : 'Sales desk';
}

/** The pipeline, live leads first (soonest to lapse first), then the last month's signed, lost and cold. Pure. */
export function leadsView(g: GameState): LeadView[] {
  const list = g.com?.leads ?? [];
  const view = (l: Lead): LeadView => ({
    ...l, clientName: g.clients[l.clientId]?.name ?? 'Client', country: g.clients[l.clientId]?.country ?? '', stageName: STAGE_NAME[l.stage],
    daysLeft: Math.max(0, Math.ceil((l.expires - g.now) / DAY)), marketName: MARKET_BY_ID[l.market as MarketId]?.name ?? l.market, sourceName: leadSourceName(g, l),
    offerOpen: !!l.offerId && (g.offers[l.offerId]?.status === 'open' || g.offers[l.offerId]?.status === 'countered'),
    shown: l.body ?? (l.offerId && g.offers[l.offerId] ? bodyOfReq(g.offers[l.offerId].requirements) : undefined),
  });
  const a = list.filter(live).sort((x, y) => x.expires - y.expires).map(view);
  const b = list.filter((l) => !live(l)).sort((x, y) => y.moved - x.moved).map(view);
  return [...a, ...b];
}

/** Proposals the desk can work at once: 3 + 3 per sales manager who has joined. Pure. */
export const workedCap = (g: GameState): number => S.lead.workedBase + S.lead.workedPerRep * joined(g).length;
export const workedNow = (g: GameState): number => (g.com?.leads ?? []).filter((l) => l.stage === 'proposal').length;

/** Send a proposal on a lead: the client answers in 2–7 days (on a busy day). */
export function workLead(g: GameState, leadId: string): ActionResult {
  const l = leads(g).find((x) => x.id === leadId);
  if (!l) return { ok: false, error: 'That lead is gone' };
  if (l.stage !== 'lead') return { ok: false, error: l.stage === 'proposal' ? 'The proposal is with them already' : `This lead is ${STAGE_NAME[l.stage].toLowerCase()}` };
  const lock = lockOf(g, 'sales');
  if (lock) return { ok: false, error: lock };
  const cap = workedCap(g);
  if (workedNow(g) >= cap) return { ok: false, error: `Your desk is already working ${cap} proposal${cap === 1 ? '' : 's'}. Wait for an answer, drop one, or hire a sales manager.` };
  const r = sideOf(g, `lead:${l.id}:work`);
  const days = int(r, S.lead.replyDays[0], S.lead.replyDays[1]);
  l.stage = 'proposal';
  l.moved = g.now;
  l.expires = g.now + days * DAY;
  return { ok: true, msg: `Proposal sent to ${g.clients[l.clientId]?.name ?? 'the client'}. Their answer comes in about ${days} day${days === 1 ? '' : 's'}.` };
}

/** Drop a lead we will not chase (a proposal out can be withdrawn too). */
export function dropLead(g: GameState, leadId: string): ActionResult {
  const l = leads(g).find((x) => x.id === leadId);
  if (!l) return { ok: false, error: 'That lead is gone' };
  if (l.stage !== 'lead' && l.stage !== 'proposal') return { ok: false, error: l.stage === 'negotiation' ? 'Decline the offer on the Market tab instead' : 'This lead is closed already' };
  l.stage = 'lost';
  l.moved = g.now;
  l.why = 'We dropped it.';
  statsV016(g).leadsLost++;
  return { ok: true, msg: 'Lead dropped.' };
}

/** The season a pitch lead is for: the base's start and length (the tender windows, in plain numbers). */
function seasonDates(season: string, r: RngHolder): { start: Minute; days: number } {
  const y = Number(season.slice(1));
  return season.startsWith('S')
    ? { start: fromUTC(y, 5, 1) + int(r, 0, 45) * DAY, days: int(r, 120, 185) }
    : { start: fromUTC(y, 11, 1) + int(r, 0, 30) * DAY, days: int(r, 90, 150) };
}

/** The real offer behind a lead that was answered yes: on the market, asked of us by name (no rival), 5 days at least. */
function leadOffer(g: GameState, l: Lead): ContractOffer | null {
  if (!hooks) return null;
  const c = g.clients[l.clientId];
  if (!c || c.ceased !== undefined) return null;
  if (lockOf(g, 'market', { archetype: l.archetype })) return null;
  const r = sideOf(g, `lead:${l.id}:offer`);
  const pitch = l.source === 'pitch' ? g.com?.pitches?.find((p) => p.leadId === l.id) : undefined;
  const season = pitch ? seasonDates(pitch.season, r) : null;
  const inSeason = !!season && season.start > g.now + 10 * DAY;
  // v0.16 balance: our proposal named dates that suit our calendar (an idle window the work fits), unless the season sets them.
  // v0.19.4 the lead keeps its body and, where it can, its type: the window of an aircraft of that type (else of that
  // body), the seats it was quoted with; an older lead (no body) as before.
  const body = l.body && holdsWide(g) ? l.body : l.body === 'narrow' ? 'narrow' : undefined;
  const ofType = (id: string) => !!g.fleet[id] && g.fleet[id].typeId === l.typeId;
  const ofBody = (id: string) => !!g.fleet[id] && (typeOf(g.fleet[id].typeId).body === 'wide' ? 'wide' : 'narrow') === body;
  const window = inSeason ? false : (body ? (l.typeId ? hooks.window(g, l.archetype, r, ofType) : undefined) ?? hooks.window(g, l.archetype, r, ofBody) : hooks.window(g, l.archetype, r)) ?? false;
  const opts: OfferOpts = {
    client: c.id, window, wide: body ? body === 'wide' : wideOpt(g), leadId: l.id, ...(l.brokerId ? { brokerId: l.brokerId } : {}),
    ...(inSeason ? { start: season.start, days: season.days } : {}),
    ...(body ? { aspire: false } : {}), ...(body && l.seats ? { seats: l.seats } : {}),
  };
  const o = withStream(g, `leado:${l.id}`, () => hooks!.offer(g, l.archetype, opts));
  if (!o) return null;
  if (o.clientId !== c.id) {
    delete g.offers[o.id];
    return null;
  }
  if (body) {
    const v = (g.stats.v0194 ??= {});
    if (bodyOfReq(o.requirements) === body) v.leadKept = (v.leadKept ?? 0) + 1;
    else v.leadChanged = (v.leadChanged ?? 0) + 1;
  }
  o.firstRefusal = true;
  delete o.rivalBid;
  delete o.call;
  // v0.16 review: the lead was taken while the month's stretch slot was open (pickLeadClient); its offer keeps the
  // label whenever the answer comes (markStretch marks a draft only while the slot is open).
  if (!o.stretch && PRESTIGE_GATE.on && !c.jobs && !c.rivalId && clientPrestige(c) === playerPrestige(g).level + 1) {
    o.stretch = true;
    noteStretch(g, o);
  }
  const was = o.expires;
  o.expires = Math.max(o.expires, Math.min(o.start - 12 * 60, g.now + 5 * DAY));
  if (o.expires !== was) schedule(g, o.expires, 'offer.expire', o.id);
  o.blurb = `${l.brokerId ? `Through ${brokerName(l.brokerId)}` : l.source === 'pitch' ? 'After our pitch' : 'After our proposal'}: ${c.name} said yes in principle. ${o.blurb}`;
  return o;
}

const LOST_WHY = ['They went with another operator.', 'They postponed the programme.', 'They kept the flying in-house.', 'Their budget was cut.'];

/** The client's answer to a proposal: an offer on the market (negotiation) or lost. */
function answerProposal(g: GameState, l: Lead): void {
  const r = sideOf(g, `lead:${l.id}:answer`);
  const c = g.clients[l.clientId];
  const name = c?.name ?? 'The client';
  if (c && c.ceased === undefined && chance(r, S.lead.offerChance)) {
    const o = leadOffer(g, l);
    if (o) {
      l.stage = 'negotiation';
      l.moved = g.now;
      l.expires = o.expires;
      l.offerId = o.id;
      // The offer itself rang 'New offer' with its note; the Inbox line says it came from the pipeline.
      pushMessage(g, {
        tone: 'good', cat: 'commercial', title: `${name} says yes in principle: ${o.title}`,
        body: `Their offer is on the Market tab, asked of us by name (no other operator quoting). Answer by ${fmtDay(o.expires)}.${l.brokerId ? ` ${brokerName(l.brokerId)} takes ${Math.round(commissionOf(l.brokerId) * 100)} % if it closes.` : ''}`,
        ref: { kind: 'offer', id: o.id },
      });
      return;
    }
  }
  l.stage = 'lost';
  l.moved = g.now;
  l.why = c && c.ceased !== undefined ? 'They stopped flying.' : pick(r, LOST_WHY);
  statsV016(g).leadsLost++;
  pushMessage(g, { tone: 'info', cat: 'commercial', title: `No deal: ${name}, ${l.title ?? 'the lead'}`, body: `${l.why} Nothing lost but the work.`, ref: { kind: 'lead', id: l.id } });
}

/** A lead under negotiation follows its offer: signed when a contract carries it, lost when the offer closed without one. */
function syncNegotiation(g: GameState, l: Lead): void {
  const ct = Object.values(g.contracts).find((c) => c.leadId === l.id);
  if (ct) {
    l.stage = 'signed';
    l.moved = g.now;
    l.contractId = ct.id;
    statsV016(g).leadsSigned++;
    return;
  }
  const o = l.offerId ? g.offers[l.offerId] : undefined;
  if (o && (o.status === 'open' || o.status === 'countered')) {
    l.expires = o.expires;
    return;
  }
  l.stage = 'lost';
  l.moved = g.now;
  l.why = o?.status === 'lost' ? 'Another operator took it.' : o?.status === 'declined' ? 'We declined their offer.' : 'Their offer lapsed unanswered.';
  statsV016(g).leadsLost++;
}

/** The 'going cold' message (once, 3 days before), the lead going cold, proposals answered, negotiations followed. */
function leadLifetimes(g: GameState): void {
  const busy = busyNow(g);
  for (const l of leads(g)) {
    if (l.stage === 'lead') {
      if (g.now >= l.expires) {
        l.stage = 'cold';
        l.moved = g.now;
        statsV016(g).leadsCold++;
        pushMessage(g, { tone: 'info', cat: 'commercial', title: `Lead gone cold: ${g.clients[l.clientId]?.name ?? 'a client'}, ${l.title ?? 'the job'}`, body: `No proposal went out in ${S.lead.coldDays} days; they moved on. About ${usdK(l.value)} of work.`, ref: { kind: 'lead', id: l.id } });
      } else if (!l.warned && l.expires - g.now <= S.lead.warnDays * DAY) {
        l.warned = true;
        const card = leadColdCard(g, l.id);
        if (card) {
          pushMessage(g, {
            tone: 'warn', cat: 'commercial', title: card.what, body: `${card.why} ${card.hurt.text}.`, ref: card.subject.ref, cue: 'notice',
            problem: card.subject, hurt: { money: card.hurt.money, pax: card.hurt.pax, delayMin: card.hurt.delayMin, level: card.hurt.level },
          });
        }
      }
    } else if (l.stage === 'proposal') {
      if (g.now >= l.expires && (busy || g.now >= l.expires + 4 * DAY)) answerProposal(g, l);
    } else if (l.stage === 'negotiation') syncNegotiation(g, l);
  }
  const c = com(g);
  c.leads = c.leads!.filter((l) => live(l) || g.now - l.moved < 30 * DAY);
}

// ---------- brokers' leads ----------

function brokerLead(g: GameState, id: BrokerId): void {
  if (!hooks) return;
  const rel = g.com?.brokers?.[id];
  if (!rel) return;
  const key = `bl:${id}:${dayIndex(g.now)}`;
  const r = sideOf(g, key);
  const c = pickLeadClient(g, r, brokerPool(g, id));
  if (!c) return;
  const F = BROKER_FOCUS[id];
  // In tender season an airline that tenders gets us invited instead (the tender names the broker; +4 when we win).
  const round = hooks.round(g.now);
  if (round && c.kind === 'airline' && hooks.issuer(c.name, round.kind, g) && !lockOf(g, 'tenders') && !com(g).tenders.some((t) => t.clientId === c.id && t.status === 'open')) {
    const t = hooks.tender(g, { clientId: c.id, invited: true });
    if (t) {
      t.brokerId = id;
      rel.lastLead = g.now;
      return;
    }
  }
  const lead = newLead(g, c, { source: 'broker', brokerId: id, archetypes: leadArchetypes(c, F.archetypes), key, why: (t) => `From ${brokerName(id)}. ${t}.` });
  if (!lead) return;
  rel.lastLead = g.now;
  pushMessage(g, {
    tone: 'info', cat: 'commercial', title: `Lead from ${brokerName(id)}: ${c.name}, ${lead.title ?? 'a job'}`,
    body: `About ${usdK(lead.value)} of work. Send a proposal within ${S.lead.coldDays} days or they move on; ${brokerName(id)} takes ${Math.round(commissionOf(id) * 100)} % if it closes.`,
    ref: { kind: 'lead', id: lead.id }, cue: 'message',
  });
}

function brokerLeads(g: GameState): void {
  const b = g.com?.brokers ?? {};
  const perBusyDay = 7 * busyShare(paceOf(g));
  for (const id of BROKER_IDS) {
    const rel = b[id];
    if (!rel) continue;
    const p = brokerLeadRate(g, id, rel.relation) / perBusyDay;
    if (chance(sideOf(g, `bl:${id}:${dayIndex(g.now)}:roll`), p)) brokerLead(g, id);
  }
}

// ---------- pitches ----------

export interface PitchWindow {
  season: string;
  /** 'summer 2029' / 'winter 2028/29'. */
  label: string;
  kind: 'summer' | 'winter';
  /** The window closes (UTC). */
  until: Minute;
}

/** The season a pitch made now is for ('S2029' / 'W2028'), null outside the windows (Oct–Feb for summer, Apr–Aug for winter). Pure. */
export function pitchWindow(g: GameState): PitchWindow | null {
  const d = toDate(g.now);
  const m = d.getUTCMonth() + 1;
  const y = d.getUTCFullYear();
  if (S.pitch.summerMonths.includes(m)) {
    const yy = m >= 10 ? y + 1 : y;
    return { season: `S${yy}`, label: `summer ${yy}`, kind: 'summer', until: fromUTC(yy, 3, 1) };
  }
  if (S.pitch.winterMonths.includes(m)) return { season: `W${y}`, label: `winter ${y}/${String((y + 1) % 100).padStart(2, '0')}`, kind: 'winter', until: fromUTC(y, 9, 1) };
  return null;
}

export const seasonLabel = (season: string): string => (season.startsWith('S') ? `summer ${season.slice(1)}` : `winter ${season.slice(1)}/${String((Number(season.slice(1)) + 1) % 100).padStart(2, '0')}`);

/** Pitches a season: 4 per desk + 2 per sales manager who has joined. Pure. */
export function pitchQuota(g: GameState): { used: number; max: number } {
  const w = pitchWindow(g);
  const used = w ? (g.com?.pitches ?? []).filter((p) => p.season === w.season).length : 0;
  return { used, max: S.pitch.perSeason + S.reps.pitches * joined(g).length };
}

/** Met at a fair or visited in the last 120 days: the pitch is free (we talked there). Pure. */
export function pitchFree(g: GameState, clientId: string): boolean {
  return (g.com?.trips ?? []).some((t) => t.status === 'done' && g.now - t.end < 120 * DAY && (t.met ?? []).includes(clientId));
}

export interface PitchTarget {
  client: Client;
  level: number;
  /** One level above ours: a stretch. */
  stretch: boolean;
  cost: number;
  pitched: boolean;
  /** v0.19.4 what we could pitch them (our fleet and theirs), and the likelier one. */
  bodies: Body[];
  body: Body;
}

/** Airlines we can pitch for the season open now: at our level or one above, in business, not yet pitched. Pure. */
/**
 * v0.16 balance: an airline we could realistically cover: its base within the ferry range of a type we fly (plus a
 * stop's worth), from our home base. A Lisbon startup does not pitch AirAsia for winter cover. Pure.
 */
export function airlineInReach(g: GameState, c: Client): boolean {
  if (!AIRPORT_BY_CODE[c.base] || !AIRPORT_BY_CODE[g.company.homeBase]) return false;
  const reach = Object.values(g.fleet).reduce((m, a) => Math.max(m, typeOf(a.typeId).rangeNm * 1.852), 0) * S.pitch.reachX;
  return reach > 0 && distance(g.company.homeBase, c.base) <= reach;
}

export function pitchTargets(g: GameState): PitchTarget[] {
  const w = pitchWindow(g);
  if (!w) return [];
  const lvl = playerPrestige(g).level;
  const done = new Set((g.com?.pitches ?? []).filter((p) => p.season === w.season).map((p) => p.clientId));
  return Object.values(g.clients)
    .filter((c) => c.kind === 'airline' && !c.rivalId && c.ceased === undefined && clientPrestige(c) <= lvl + 1 && airlineInReach(g, c))
    .map((c) => ({ c, bodies: bodiesFor(g, c) }))
    // v0.24 nothing of ours they would fly (Iberojet's A330s and A350s against our A320s): not a pitch target.
    .filter((x) => x.bodies.length > 0)
    .map(({ c, bodies }) => ({ client: c, level: clientPrestige(c), stretch: clientPrestige(c) > lvl, cost: pitchFree(g, c.id) ? 0 : S.pitch.cost, pitched: done.has(c.id), bodies, body: defaultPitchBody(g, bodies) }))
    .sort((a, b) => Number(a.pitched) - Number(b.pitched) || b.client.relation - a.client.relation || a.client.name.localeCompare(b.client.name));
}

/** v0.19.4 the body a pitch offers by default: a widebody when half our fleet's weighted work is widebody. Pure. */
const defaultPitchBody = (g: GameState, bodies: Body[]): Body => (bodies.length === 1 ? bodies[0] : wideShareOf(g) >= 0.5 ? 'wide' : 'narrow');

/** Pitch an airline for the coming season's cover: a visit ($1,500, free when we met them lately); the answer in 2–6 weeks.
 *  v0.19.4 with a narrowbody or a widebody (one of the bodies we could offer them; default the likelier). */
export function pitchAirline(g: GameState, clientId: string, body?: Body): ActionResult {
  const w = pitchWindow(g);
  if (!w) return { ok: false, error: 'Pitch summer cover from October to February, winter cover from April to August' };
  const lock = lockOf(g, 'sales');
  if (lock) return { ok: false, error: lock };
  const t = pitchTargets(g).find((x) => x.client.id === clientId);
  if (!t) return { ok: false, error: 'Pitch an airline at your level, or one level up, within reach of your fleet' };
  if (t.pitched) return { ok: false, error: `${t.client.name} has our pitch for ${w.label} already` };
  const q = pitchQuota(g);
  if (q.used >= q.max) return { ok: false, error: `Your desk can make ${q.max} pitches a season. A sales manager adds ${S.reps.pitches}.` };
  if (g.company.cash < t.cost) return { ok: false, error: `Needs ${usdK(t.cost)}` };
  loadSales(g);
  if (t.cost) post(g, 'sales', -t.cost);
  const r = sideOf(g, `pitch:${w.season}:${clientId}`);
  const days = int(r, S.pitch.replyDays[0], S.pitch.replyDays[1]);
  const b = body && t.bodies.includes(body) ? body : t.body;
  const p: Pitch = { id: nextId(g, 'pt'), clientId, season: w.season, at: g.now, replyAt: g.now + days * DAY, ...(t.cost ? {} : { free: true as const }), body: b };
  com(g).pitches!.push(p);
  statsV016(g).pitches++;
  return { ok: true, msg: `Pitched ${t.client.name} for ${w.label} cover with ${b === 'wide' ? 'a widebody' : 'a narrowbody'}. Their answer comes in ${fmtSpan(Math.round(S.pitch.replyDays[0] / 7), Math.round(S.pitch.replyDays[1] / 7), 'weeks')}.` };
}

export const pitchesOf = (g: GameState): Pitch[] => g.com?.pitches ?? [];

export interface PitchView extends Pitch {
  /** v0.19.4 the body pitched (an older pitch: its lead's, else none). */
  shown?: Body;
  clientName: string;
  country: string;
  seasonLabel: string;
  /** 'Answer about 14 Dec' / 'Maybe: a lead' / 'Yes: offer about 3 Mar' / 'No, thank you'. */
  status: string;
  tone: 'info' | 'good' | 'warn';
}

/** Pitches made, newest first (the last year). Pure. */
export function pitchesView(g: GameState): PitchView[] {
  return (g.com?.pitches ?? [])
    .filter((p) => g.now - p.at < 400 * DAY)
    .sort((a, b) => b.at - a.at)
    .map((p) => {
      const lead = p.leadId ? g.com?.leads?.find((l) => l.id === p.leadId) : undefined;
      const status = !p.result ? `Answer about ${fmtDay(p.replyAt)}`
        : p.result === 'no' ? 'No, thank you'
        : p.result === 'offer' ? (lead ? `Yes: ${STAGE_NAME[lead.stage].toLowerCase()}` : `Yes: their offer comes about ${fmtDay(p.offerAt ?? p.replyAt)}`)
        : lead ? `Maybe: ${STAGE_NAME[lead.stage].toLowerCase()}` : 'Maybe';
      return { ...p, shown: p.body ?? lead?.body, clientName: g.clients[p.clientId]?.name ?? 'Airline', country: g.clients[p.clientId]?.country ?? '', seasonLabel: seasonLabel(p.season), status, tone: !p.result ? 'info' : p.result === 'no' ? 'warn' : 'good' };
    });
}

/** The airline's answer to a pitch: maybe (a proposal-stage lead), yes (a direct offer before the season) or no. */
function pitchReply(g: GameState, p: Pitch): void {
  const r = sideOf(g, `pitch:${p.id}:reply`);
  const c = g.clients[p.clientId];
  const name = c?.name ?? 'The airline';
  const label = seasonLabel(p.season);
  bumpClient(g, p.clientId, S.pitch.relation, `We pitched them for ${label} cover`);
  const roll = chance(r, S.pitch.maybe) ? 'maybe' : chance(r, S.pitch.offer / (1 - S.pitch.maybe)) ? 'offer' : 'no';
  if (!c || c.ceased !== undefined) {
    p.result = 'no';
    return;
  }
  if (roll === 'maybe') {
    const sd = seasonDates(p.season, sideOf(g, `pitch:${p.id}:season`));
    const lead = newLead(g, c, { source: 'pitch', archetypes: ['seasonBase'], key: `pitch:${p.id}`, stage: 'proposal', why: (t) => `After our ${label} pitch: ${name} may need cover. ${t}.`, opts: sd.start > g.now + 10 * DAY ? { start: sd.start, days: sd.days } : {}, ...(p.body ? { body: p.body } : {}) });
    if (lead) {
      p.result = 'maybe';
      p.leadId = lead.id;
      pushMessage(g, {
        tone: 'good', cat: 'commercial', title: `${name}: maybe. They want our proposal for ${label}`,
        body: `${name} has a gap in ${label} and asked for numbers; our proposal is with them (an answer in about ${Math.ceil((lead.expires - g.now) / DAY)} days).`,
        ref: { kind: 'lead', id: lead.id }, cue: 'message',
      });
      return;
    }
  }
  if (roll === 'offer') {
    const { start } = seasonDates(p.season, r);
    const at = Math.max(g.now, start - int(r, S.pitch.offerLead[0], S.pitch.offerLead[1]) * DAY);
    p.result = 'offer';
    p.offerAt = at;
    pushMessage(g, {
      tone: 'good', cat: 'commercial', title: `${name}: yes. They want our ${label} cover`,
      body: `${name} will send the season's terms about ${fmtDay(at)}, once their schedule is set. Keep an aircraft for it.`,
      ref: { kind: 'client', id: c.id }, cue: 'message',
    });
    return;
  }
  p.result = 'no';
  pushMessage(g, { tone: 'info', cat: 'commercial', title: `${name}: no, thank you (${label})`, body: `Their own fleet covers ${label}. They know us a little better for the approach.`, ref: { kind: 'client', id: c.id } });
}

/** A pitch answered yes: the season-base offer comes 60–120 days before the season (a negotiation-stage lead). */
function pitchOffer(g: GameState, p: Pitch): void {
  const c = g.clients[p.clientId];
  if (!c || c.ceased !== undefined) {
    p.leadId = '';
    return;
  }
  const sd = seasonDates(p.season, sideOf(g, `pitch:${p.id}:season`));
  const lead = newLead(g, c, { source: 'pitch', archetypes: ['seasonBase'], key: `pitcho:${p.id}`, stage: 'proposal', why: (t) => `After our ${seasonLabel(p.season)} pitch: ${c.name} wants our cover. ${t}.`, opts: { asked: true, ...(sd.start > g.now + 10 * DAY ? { start: sd.start, days: sd.days } : {}) }, ...(p.body ? { body: p.body } : {}) });
  if (!lead) {
    p.leadId = '';
    return;
  }
  p.leadId = lead.id;
  const o = leadOffer(g, lead);
  if (!o) {
    lead.stage = 'lost';
    lead.moved = g.now;
    lead.why = 'Their schedule changed.';
    statsV016(g).leadsLost++;
    pushMessage(g, { tone: 'info', cat: 'commercial', title: `${c.name} dropped the ${seasonLabel(p.season)} cover`, body: 'Their schedule changed. Nothing lost but the work.', ref: { kind: 'client', id: c.id } });
    return;
  }
  lead.stage = 'negotiation';
  lead.moved = g.now;
  lead.expires = o.expires;
  lead.offerId = o.id;
}

function pitchReplies(g: GameState): void {
  const busy = busyNow(g);
  const c = com(g);
  for (const p of c.pitches ?? []) {
    if (!p.result) {
      if (g.now >= p.replyAt && (busy || g.now >= p.replyAt + 4 * DAY)) pitchReply(g, p);
    } else if (p.result === 'offer' && p.offerAt !== undefined && p.leadId === undefined && g.now >= p.offerAt && (busy || g.now >= p.offerAt + 4 * DAY)) pitchOffer(g, p);
  }
  if ((c.pitches?.length ?? 0) > 40) c.pitches = c.pitches!.filter((p) => g.now - p.at < 400 * DAY);
}

// ---------- sales managers ----------

const REP_BLURBS = [
  'Two years selling charters for a broker; knows the tour operators by first name.',
  'Ran the ACMI desk of a leisure airline; knows who is short of aircraft each season.',
  'Twelve years placing capacity with the network airlines; a phone book nobody else has.',
];

export const marketName = (id: string): string => MARKET_BY_ID[id as MarketId]?.name ?? id;

/** Candidates for a market (rolled on first look, kept until hired). Empty for 30 days after a dismissal. */
export function repCandidates(g: GameState, market: string): HeadCandidate[] {
  if (!MARKET_IDS.includes(market as MarketId)) return [];
  const c = com(g);
  if (c.repFiredAt !== undefined && g.now - c.repFiredAt < S.reps.rehireDays * DAY) return [];
  c.repCandidates ??= {};
  return (c.repCandidates[market] ??= rollPeople(g, `rep:${market}:${c.repFiredAt ?? 0}`, S.reps.tiers, S.reps.salary, REP_BLURBS));
}

/** Days until candidates come back after a dismissal (0 when they are there). Pure. */
export const repRehireDays = (g: GameState): number => (g.com?.repFiredAt === undefined ? 0 : Math.max(0, Math.ceil((g.com.repFiredAt + S.reps.rehireDays * DAY - g.now) / DAY)));

export function hireSalesRep(g: GameState, market: string, candidate: number): ActionResult {
  const lock = lockOf(g, 'hiring');
  if (lock) return { ok: false, error: lock };
  if (!MARKET_IDS.includes(market as MarketId)) return { ok: false, error: 'No such market' };
  loadSales(g);
  const c = com(g);
  if (c.reps!.length >= S.reps.max) return { ok: false, error: `Up to ${S.reps.max} sales managers` };
  if (c.reps!.some((r) => r.market === market)) return { ok: false, error: `${marketName(market)} has a sales manager already` };
  const k = repCandidates(g, market)[candidate];
  if (!k) return { ok: false, error: 'No such candidate' };
  const rep: SalesRep = { id: nextId(g, 'sr'), name: k.name, market, skill: k.skill, salary: k.salary, hired: g.now, joins: g.now + S.reps.joinDays * DAY, leads: 0 };
  c.reps!.push(rep);
  delete c.repCandidates?.[market];
  pushMessage(g, {
    tone: 'good', cat: 'company', title: `${k.name} joins as sales manager, ${marketName(market)}`,
    body: `Starts ${fmtDay(rep.joins)} at ${usdK(k.salary)} a month: about ${Math.round(S.reps.leadsPerMonth * k.skill * 10) / 10} leads a month there, +${S.reps.pitches} pitches a season, ${S.lead.workedPerRep} more proposals in work.`,
    ref: { kind: 'rep', id: rep.id }, cue: 'headHired',
  });
  return { ok: true, msg: `${k.name} joins on ${fmtDay(rep.joins)}.` };
}

export function fireSalesRep(g: GameState, repId: string): ActionResult {
  const c = com(g);
  const rep = (c.reps ?? []).find((r) => r.id === repId);
  if (!rep) return { ok: false, error: 'No such sales manager' };
  const severance = Math.round(rep.salary * S.reps.severanceMonths);
  post(g, 'salaries', -severance);
  c.reps = c.reps!.filter((r) => r.id !== repId);
  c.repFiredAt = g.now;
  delete c.repCandidates;
  pushMessage(g, { tone: 'info', cat: 'company', title: `${rep.name} has left`, body: `One month's salary in severance (${usdK(severance)}). New candidates in ${S.reps.rehireDays} days.`, ref: { kind: 'rep', id: rep.id } });
  return { ok: true, msg: `${rep.name} has left. Severance ${usdK(severance)}.` };
}

export const salesReps = (g: GameState): SalesRep[] => g.com?.reps ?? [];

export interface SalesRepView extends SalesRep {
  marketName: string;
  /** Joined, or 'joins 14 Dec'. */
  status: string;
  leadsPerMonth: number;
}

/** Team › Sales managers. Pure. */
export function salesRepsView(g: GameState): SalesRepView[] {
  return salesReps(g).map((r) => ({ ...r, marketName: marketName(r.market), status: r.joins > g.now ? `Joins ${fmtDay(r.joins)}` : `Since ${fmtDay(r.joins)}`, leadsPerMonth: Math.round(S.reps.leadsPerMonth * r.skill * 10) / 10 }));
}

/** The sales managers' pay for month k, pro-rated from the day each joined (month-end bill and forecast alike). Pure. */
export function salesBill(g: GameState, k: MonthKey = monthKey(g.now)): number {
  let pay = 0;
  const a = monthStart(k), b = monthStart(k + 1);
  for (const r of g.com?.reps ?? []) {
    const from = Math.max(a, r.joins);
    if (from < b) pay += r.salary * ((b - from) / (b - a));
  }
  return Math.round(pay);
}

/** Daily: a manager who joins today; presence in their market; leads there on busy days. */
function repWork(g: GameState): void {
  const busy = busyNow(g);
  const perBusyDay = 30 * busyShare(paceOf(g));
  for (const rep of g.com?.reps ?? []) {
    if (rep.joins > g.now) continue;
    if (dayIndex(rep.joins) === dayIndex(g.now)) {
      pushMessage(g, { tone: 'info', cat: 'company', title: `${rep.name} starts today: sales manager, ${marketName(rep.market)}`, body: 'Leads from that market now come to the pipeline; proposals and pitches have another pair of hands.', ref: { kind: 'rep', id: rep.id } });
    }
    bumpPresence(g, rep.market as MarketId, S.reps.presencePerDay);
    if (!busy || !hooks || lockOf(g, 'sales')) continue;
    const key = `rep:${rep.id}:${dayIndex(g.now)}`;
    if (!chance(sideOf(g, `${key}:roll`), (S.reps.leadsPerMonth * rep.skill) / perBusyDay)) continue;
    const r = sideOf(g, key);
    const pool = Object.values(g.clients).filter((c) => !c.rivalId && c.ceased === undefined && c.kind !== 'broker' && c.kind !== 'operator' && !!AIRPORT_BY_CODE[c.base] && clientMarket(c) === rep.market);
    const c = pickLeadClient(g, r, pool);
    if (!c) continue;
    const lead = newLead(g, c, { source: 'staff', repId: rep.id, archetypes: leadArchetypes(c), key, why: (t) => `${rep.name}, ${marketName(rep.market)}. ${t}.` });
    if (!lead) continue;
    rep.leads++;
    pushMessage(g, {
      tone: 'info', cat: 'commercial', title: `Lead from ${rep.name}: ${c.name}, ${lead.title ?? 'a job'}`,
      body: `About ${usdK(lead.value)} of work in ${marketName(rep.market)}. Send a proposal within ${S.lead.coldDays} days or they move on.`,
      ref: { kind: 'lead', id: lead.id }, cue: 'message',
    });
  }
}

// ---------- the desk, in one view ----------

export interface SalesDesk {
  worked: number;
  cap: number;
  reps: number;
  repsJoined: number;
  pitches: { used: number; max: number };
  window: PitchWindow | null;
  registered: number;
  live: number;
  homeMarket: string;
}

/** Contracts › Sales header line. Pure. */
export function salesDesk(g: GameState): SalesDesk {
  return {
    worked: workedNow(g), cap: workedCap(g), reps: salesReps(g).length, repsJoined: joined(g).length, pitches: pitchQuota(g), window: pitchWindow(g),
    registered: Object.keys(g.com?.brokers ?? {}).length, live: (g.com?.leads ?? []).filter(live).length, homeMarket: homeMarket(g),
  };
}

// ---------- passes ----------

/** Daily: broker leads, lead lifetimes, pitch replies, the managers' leads, broker deals credited. */
export function dailySales(g: GameState): void {
  loadSales(g);
  if (g.gameOver) return;
  leadLifetimes(g);
  pitchReplies(g);
  creditBrokerDeals(g);
  if (!lockOf(g, 'sales') && busyNow(g) && g.now - g.started >= 7 * DAY) brokerLeads(g);
  repWork(g);
}

/** Month end (before the statement closes): the sales payroll; broker relations drift when nothing was flown through them. */
export function monthlySales(g: GameState): void {
  loadSales(g);
  const pay = salesBill(g, g.finance.current.month);
  if (pay) post(g, 'salaries', -pay);
  const from = monthStart(g.finance.current.month);
  for (const rel of Object.values(g.com?.brokers ?? {})) {
    if (!rel) continue;
    if ((rel.lastDeal ?? -Infinity) < from && rel.since < from) rel.relation = Math.max(S.relation.floor, rel.relation + S.relation.drift);
  }
}

// ---------- cards (UPDATE-0.16.md §C.3) ----------

/** A lead about to go cold (amber, `lead.warnDays` before). Pure. */
export function leadColdCard(g: GameState, leadId: string): ProblemCard | null {
  const l = (g.com?.leads ?? []).find((x) => x.id === leadId);
  if (!l || l.stage !== 'lead') return null;
  const left = l.expires - g.now;
  if (left > S.lead.warnDays * DAY) return null;
  const days = Math.max(0, Math.ceil(left / DAY));
  const name = g.clients[l.clientId]?.name ?? 'The client';
  const what = `${name}'s lead goes cold ${days <= 0 ? 'today' : `in ${days} day${days === 1 ? '' : 's'}`}`;
  // v0.16.3 the lead sits under Contracts › Market › Leads (was the Sales tab).
  const open = { tab: 'contracts' as const, view: 'leads', sel: { kind: 'lead' as const, id: l.id } };
  return {
    subject: { kind: 'leadCold', ref: { kind: 'lead', id: l.id } }, severity: 'amber',
    title: `Lead going cold: ${name}`, what,
    why: `Nobody has sent them a proposal since ${fmtDay(l.created)}; a client waits about ${S.lead.coldDays} days.`,
    hurt: mkHurt({ money: l.value, what: 'of work if it goes cold' }),
    actions: [
      { id: 'proposal', label: 'Send proposal', open, primary: true },
      { id: 'drop', label: 'Drop the lead', open },
    ],
    details: [`${l.title ?? 'The job'} · ${leadSourceName(g, l)} · estimated ${usdK(l.value)}`, `Desk: ${workedNow(g)} of ${workedCap(g)} proposals in work`],
    visuals: {}, terms: [], by: l.expires,
  };
}

/** Every lead about to go cold (problems/index.ts lists them). Pure. */
export function leadProblems(g: GameState): ProblemCard[] {
  const out: ProblemCard[] = [];
  for (const l of g.com?.leads ?? []) {
    const c = l.stage === 'lead' ? leadColdCard(g, l.id) : null;
    if (c) out.push(c);
  }
  return out;
}
