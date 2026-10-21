// Scarce aircraft market and lease lifecycle (B3). DESIGN.md §5.10. v0.7 (UPDATE-0.7.md §F6): a daily roll
// (about one offer a month, at most four open, each open 7–21 days), types gated by the Ladder (the next rung as a
// rare teaser), rare new-build slots, and a real handover site (lessor site, factory or previous operator's hub)
// from which the aircraft is ferried home.

import { ACMI_TYPES_LIST, type AcmiType } from '../../data/acmiTypes';
import { AIRPORT_BY_CODE } from '../../data/airports';
import { EX_OPERATORS, FACTORIES, LESSOR_SITES, NEW_BUILD, type Site } from '../../data/market';
import { BAL } from '../core/balance';
import { flightsOf, nextId, touchFlights } from '../core/entities';
import { cashOnly } from '../core/ledger';
import { pushMessage } from '../core/messages';
import { requestPause } from '../core/pause';
import { runwayFit, typeOf } from '../core/perf';
import { schedule } from '../core/queue';
import { chance, gaussian, int, pick, range, weightedPick } from '../core/rng';
import { DAY, fmtDate, fmtDay, monthKey, yearOf } from '../core/time';
import type { ActionResult, Aircraft, AircraftOffer, ApprovalId, Cabin, GameState, SimEvent } from '../core/types';
import { clamp, hash } from '../core/util';
import { familyLabel } from '../crew/conversion';
import { aircraftGate, APPROVALS, ratedPilots, type AircraftGate } from './company';
import { deliveryQuote, handoverMessage, planDeliveryFerry, type DeliveryQuote } from './delivery';
import { usd } from './util';

/** Real operating lessors (names only; they also trade used aircraft). */
const LESSORS = ['AerCap', 'Avolon', 'SMBC Aviation Capital', 'BOC Aviation', 'Carlyle Aviation Partners', 'Air Lease Corporation', 'Aviation Capital Group'];
const MONTH = 30.44 * DAY;
const OLD = ['b763', 'a332', 'a343', 'b752'];

const cabinOf = (t: AcmiType): Cabin => {
  const p = t.cabins[0];
  return { j: p.j, w: p.w, y: p.y, total: p.j + p.w + p.y, label: p.label, layout: p.layout };
};

/** 'A330-200' from 'Airbus A330-200'. */
export const shortName = (t: AcmiType) => t.name.replace(/^(Airbus|Boeing) /, '');

/** Approvals still to file before these (their unmet prerequisites included): the 787 is two away without ETOPS 180. */
function rungsAway(g: GameState, missing: ApprovalId[]): number {
  const co = g.company;
  const have = (a: ApprovalId) => co.approvals.includes(a) || co.pendingApprovals.some((p) => p.id === a);
  const need = new Set<ApprovalId>();
  const add = (a: ApprovalId) => {
    if (have(a) || need.has(a)) return;
    need.add(a);
    for (const r of APPROVALS.find((x) => x.id === a)?.requires ?? []) add(r);
  };
  missing.forEach(add);
  return need.size;
}

/**
 * Types on offer now with their weight: unlocked (gate held or pending) 1 − scarcity; the next rung (exactly one
 * approval missing) a teaser at × 0.3; the rest are not offered.
 */
export function eligibleTypes(g: GameState): { t: AcmiType; w: number; teaser: boolean }[] {
  const out: { t: AcmiType; w: number; teaser: boolean }[] = [];
  for (const t of ACMI_TYPES_LIST) {
    if (!t.available) continue;
    const miss = rungsAway(g, aircraftGate(g, t.id).missing);
    if (miss === 0) out.push({ t, w: 1 - t.scarcity, teaser: false });
    else if (miss === 1) out.push({ t, w: (1 - t.scarcity) * BAL.market7.teaserWeight, teaser: true });
  }
  return out;
}

/** Lessor sites the type can use (runway), else all. */
function lessorSites(t: AcmiType): Site[] {
  const ok = LESSOR_SITES.filter((s) => AIRPORT_BY_CODE[s.code] && runwayFit(t.id, s.code) === 'ok');
  return ok.length ? ok : LESSOR_SITES.filter((s) => AIRPORT_BY_CODE[s.code]);
}

const siteText = (s: Site) => `${s.name}, ${s.city} (${s.code})`;
/** 'Shannon', 'Tarbes', 'Malta' for our sites, else the airport's city. */
export const siteCity = (code: string) => LESSOR_SITES.find((s) => s.code === code)?.city ?? AIRPORT_BY_CODE[code]?.city ?? code;

/** Where a lease is redelivered: the delivery site when it is a lessor site, else one of them (stable per offer). Pure. */
export function returnSiteOf(o: Pick<AircraftOffer, 'id' | 'typeId' | 'site'>): string {
  if (o.site && LESSOR_SITES.some((s) => s.code === o.site)) return o.site;
  const sites = lessorSites(typeOf(o.typeId));
  return sites[hash(`${o.id}:return`) % sites.length].code;
}

/** One offer of type t (`opts.lease` forces a dry lease: the guaranteed offers). */
function makeOffer(g: GameState, t: AcmiType, opts: { lease?: boolean; kind?: 'dryLeaseIn' | 'buy'; newBuild?: boolean; site?: string } = {}): AircraftOffer {
  const M = BAL.market7;
  const now = yearOf(g.now);
  const old = OLD.includes(t.id);
  const index = t.body === 'wide' ? g.market.wideIndex : g.market.narrowIndex;
  const canNew = NEW_BUILD.includes(t.id) && !!FACTORIES[t.family];
  const newBuild = canNew && (opts.newBuild ?? (!opts.lease && !opts.kind && chance(g, M.newBuildChance)));
  const id = nextId(g, 'mo');
  let o: AircraftOffer;
  if (newBuild) {
    const lead = int(g, M.newBuildLead[0], M.newBuildLead[1]);
    const rent = Math.round((t.rentMonth * range(g, M.newBuildRent[0], M.newBuildRent[1]) * index) / 1000) * 1000;
    const site = pick(g, FACTORIES[t.family]!.sites);
    o = {
      id, typeId: t.id, kind: 'dryLeaseIn', lessor: pick(g, LESSORS), builtYear: yearOf(g.now + lead * DAY), cabin: cabinOf(t), rentPerMonth: rent,
      reservesPerFH: Math.round((t.maintBH * range(g, 0.38, 0.46)) / 10) * 10, leaseMonths: int(g, M.newBuildMonths[0] / 12, M.newBuildMonths[1] / 12) * 12, price: 0,
      deposit: M.newBuildDepositMonths * rent, leadDays: lead, expires: 0, site: site.code, where: siteText(site), newBuild: true,
    };
  } else {
    const built = old ? int(g, 1996, 2008) : t.tier <= 1 ? int(g, 2005, 2017) : int(g, now - 16, now - 6);
    const age = now - built;
    const ageAdj = clamp(1 - (age - 12) * 0.015, 0.75, 1.15);
    const canBuy = t.body === 'narrow' || old;
    const buy = opts.kind ? opts.kind === 'buy' && canBuy : !opts.lease && canBuy && chance(g, 0.3);
    const rent = Math.round((t.rentMonth * range(g, 0.9, 1.15) * index * ageAdj) / 1000) * 1000;
    const price = buy ? Math.round((t.valueUsed * range(g, 0.85, 1.1) * ageAdj) / 10_000) * 10_000 : 0;
    o = {
      id, typeId: t.id, kind: buy ? 'buy' : 'dryLeaseIn', lessor: buy ? `${pick(g, LESSORS)} (used sale)` : pick(g, LESSORS),
      builtYear: built, cabin: cabinOf(t), rentPerMonth: buy ? 0 : rent, reservesPerFH: buy ? 0 : Math.round((t.maintBH * range(g, 0.38, 0.46)) / 10) * 10,
      leaseMonths: buy ? 0 : int(g, BAL.leaseMonths[0] / 6, BAL.leaseMonths[1] / 6) * 6, price, deposit: buy ? price : 2 * rent,
      leadDays: t.body === 'wide' ? int(g, BAL.deliveryDaysWide[0], BAL.deliveryDaysWide[1]) : int(g, BAL.deliveryDays[0], BAL.deliveryDays[1]), expires: 0,
    };
    // Handover: a lessor site half the time, else the previous operator's hub.
    const ops = (EX_OPERATORS[t.id] ?? []).filter((x) => AIRPORT_BY_CODE[x.hub] && runwayFit(t.id, x.hub) !== 'no');
    if (!ops.length || chance(g, M.lessorSiteShare)) {
      const s = pick(g, lessorSites(t));
      o.site = s.code;
      o.where = siteText(s);
    } else {
      const x = pick(g, ops);
      o.site = x.hub;
      o.exOperator = x.airline;
      o.where = `ex-${x.airline}, ${AIRPORT_BY_CODE[x.hub].city} (${x.hub})`;
    }
  }
  if (opts.site && AIRPORT_BY_CODE[opts.site] && opts.site !== o.site) {
    o.site = opts.site;
    o.where = `${o.exOperator ? `ex-${o.exOperator}, ` : ''}${AIRPORT_BY_CODE[opts.site].city} (${opts.site})`;
  }
  o.expires = g.now + int(g, M.offerDays[0], M.offerDays[1]) * DAY;
  o.created = g.now;
  return o;
}

const kindText = (o: AircraftOffer) => (o.newBuild ? 'new-build slot' : o.kind === 'buy' ? 'for sale' : 'for lease');

/** Posts an offer: one Inbox message (topic market; the UI may hide them) and a market pause request. */
function postOffer(g: GameState, o: AircraftOffer): void {
  const m = g.market;
  // At most maxOpen: the oldest goes first.
  while (m.aircraft.length >= BAL.market7.maxOpen) m.aircraft.shift();
  m.aircraft.push(o);
  const t = typeOf(o.typeId);
  const gate = aircraftGate(g, o.typeId);
  const weeks = Math.round(o.leadDays / 7);
  const lead = o.leadDays < 14 ? `${o.leadDays} days` : o.leadDays < 120 ? `about ${weeks} weeks` : `about ${Math.round(o.leadDays / 30.44)} months`;
  const terms = o.kind === 'buy' ? `Price ${usd(o.price)}` : `${usd(o.rentPerMonth)}/month for ${o.leaseMonths} months, deposit ${usd(o.deposit)}`;
  const city = o.site ? AIRPORT_BY_CODE[o.site]?.city ?? o.site : 'base';
  const who = o.newBuild
    ? `${o.lessor} offers a new-build ${shortName(t)} slot (delivery ${yearOf(g.now + o.leadDays * DAY)}, ${o.cabin.label})`
    : `${o.lessor.replace(' (used sale)', '')} offers ${o.exOperator ? `an ex-${o.exOperator}` : /^[AEIOU8]/.test(shortName(t)) ? 'an' : 'a'} ${shortName(t)} (${o.builtYear}, ${o.cabin.label})`;
  pushMessage(g, {
    tone: 'info', cat: 'company', topic: 'market', title: `Market: ${shortName(t)} ${kindText(o)}`,
    body: `${who}, handed over at ${city}. ${terms}. Handover ${lead} after signing. Open until ${fmtDate(o.expires)}.${gate.ok ? '' : ` ${gate.text} first.`}`,
    ref: { kind: 'market', id: o.id },
  });
  requestPause('marketOffer');
}

/** Monthly (and at the start): fuel and demand drift; the guaranteed narrowbody (month 1–2) and old widebody (month 4–6) leases. */
export function refreshMarket(g: GameState): void {
  const m = g.market;
  m.aircraft = m.aircraft.filter((o) => o.expires > g.now);
  m.fuelPrice = Math.round(clamp(m.fuelPrice * (1 + gaussian(g) * 0.04) + (BAL.fuelPrice - m.fuelPrice) * 0.15, 550, 1050));
  m.narrowIndex = Math.round(clamp(m.narrowIndex + gaussian(g) * 0.03 + (1 - m.narrowIndex) * 0.2, 0.8, 1.25) * 1000) / 1000;
  m.wideIndex = Math.round(clamp(m.wideIndex + gaussian(g) * 0.03 + (1 - m.wideIndex) * 0.2, 0.8, 1.25) * 1000) / 1000;
  const month = monthKey(g.now) - monthKey(g.started);
  if (!m.gotNarrow && (month >= 1 || chance(g, 0.5))) {
    m.gotNarrow = true;
    postOffer(g, makeOffer(g, typeOf(chance(g, 0.6) ? 'a320ceo' : 'b738'), { lease: true }));
  }
  // The old widebody lease shows as a teaser while the gate is still closed.
  if (!m.gotWide && month >= 3 && (month >= 5 || chance(g, 0.4))) {
    m.gotWide = true;
    postOffer(g, makeOffer(g, typeOf(chance(g, 0.5) ? 'b763' : 'a332'), { lease: true }));
  }
}

/**
 * Daily: lapsed offers leave; a new one with p = perMonth / 30.44 while fewer than maxOpen are open; within 45 days
 * of filing Widebody operations, one old 767/A330 lease when no unlocked widebody is on offer.
 */
export function dailyMarket(g: GameState): void {
  const m = g.market;
  m.aircraft = m.aircraft.filter((o) => o.expires > g.now);
  const M = BAL.market7;
  if (m.aircraft.length < M.maxOpen && chance(g, M.perMonth / 30.44)) {
    const x = weightedPick(g, eligibleTypes(g), (e) => e.w);
    if (x) postOffer(g, makeOffer(g, x.t));
  }
  const filed = g.company.pendingApprovals.find((p) => p.id === 'widebody');
  if (!m.gotWideFiled && filed) {
    const days = (g.now - filed.started) / DAY;
    const open = m.aircraft.some((o) => typeOf(o.typeId).body === 'wide' && aircraftGate(g, o.typeId).ok);
    if (open) m.gotWideFiled = true;
    else if (days >= M.wideAfterFilingDays - 1 || chance(g, 1 / 20)) {
      m.gotWideFiled = true;
      postOffer(g, makeOffer(g, typeOf(chance(g, 0.5) ? 'b763' : 'a332'), { lease: true }));
    }
  }
}

function registration(g: GameState): string {
  const used = new Set(Object.values(g.fleet).map((a) => a.reg));
  const prefix = g.company.regPrefix;
  const n = prefix.length <= 2 ? 4 : 3;
  for (;;) {
    let s = prefix === 'CS-' ? 'T' : '';
    while (s.length < n) s += String.fromCharCode(65 + int(g, 0, 25));
    if (!used.has(prefix + s)) return prefix + s;
  }
}

/**
 * Signs a dry lease in (deposit) or a purchase (price). Refused when the Ladder's gate is closed (pending counts),
 * cash is short or the offer has lapsed. The aircraft is 'delivering' at the handover site until the handover; the
 * delivery ferry home is planned at once (the roster sends rated pilots out on airline tickets before it).
 */
export function acquireAircraft(g: GameState, offerId: string): ActionResult<{ aircraftId: string }> {
  const i = g.market.aircraft.findIndex((o) => o.id === offerId);
  if (i < 0) return { ok: false, error: 'Offer not found' };
  const o = g.market.aircraft[i];
  const gate = aircraftGate(g, o.typeId);
  if (!gate.ok) return { ok: false, error: `${gate.text}: apply under Company → Ladder` };
  if (g.company.cash < o.deposit) return { ok: false, error: `Not enough cash: ${usd(o.deposit)} due at signing` };
  if (o.expires <= g.now) return { ok: false, error: 'This offer has expired' };
  const t = typeOf(o.typeId);
  g.market.aircraft.splice(i, 1);
  cashOnly(g, -o.deposit);
  const handover = g.now + o.leadDays * DAY;
  const site = o.site ?? g.company.homeBase;
  const age = Math.max(0, yearOf(g.now) - o.builtYear);
  const hours = o.newBuild ? 0 : Math.round(age * (t.body === 'wide' ? 3_600 : 2_600) * range(g, 0.85, 1.1));
  const ac: Aircraft = {
    id: nextId(g, 'a'), reg: registration(g), typeId: o.typeId,
    ownership: o.kind === 'buy'
      ? { kind: 'owned', bookValue: o.price, ...(o.newBuild ? { newBuild: true } : {}) }
      : {
          kind: 'dryLeaseIn', lessor: o.lessor, rentPerMonth: o.rentPerMonth, reservesPerFH: o.reservesPerFH, leaseStart: handover, leaseEnd: handover + Math.round(o.leaseMonths * MONTH), deposit: o.deposit,
          returnSite: returnSiteOf(o), deliveredLayout: o.cabin.layout, ...(o.newBuild ? { newBuild: true } : {}),
        },
    builtYear: o.builtYear, hours, cycles: Math.round(hours / (t.body === 'wide' ? 4.5 : 1.7)),
    // Delivered fresh from a redelivery check (new-build: zero time).
    maint: o.newBuild
      ? { fhSinceA: 0, lastA: handover, fhSinceC: 0, lastC: handover, deferred: 0 }
      : { fhSinceA: 0, lastA: handover, fhSinceC: Math.round(range(g, 0.1, 0.4) * (t.body === 'wide' ? 6000 : 7500)), lastC: handover - int(g, 60, 300) * DAY, deferred: 0.03 },
    cabin: { ...o.cabin }, etops: t.body === 'wide' ? Math.min(180, t.etopsMax) : 0,
    at: site, flightId: null, status: 'delivering', maintId: null, deliveredAt: handover,
    delivery: { site, where: o.where ?? `${AIRPORT_BY_CODE[site]?.city ?? site} (${site})`, handover, ferryIds: [] },
  };
  g.fleet[ac.id] = ac;
  schedule(g, handover, 'aircraft.delivery', ac.id);
  if (ac.ownership.kind === 'dryLeaseIn') schedule(g, ac.ownership.leaseEnd, 'lease.end', ac.id);
  const legs = planDeliveryFerry(g, ac.id);
  touchFlights(g);
  const rated = ratedPilots(g, [t.family]);
  const fam = familyLabel(t.family);
  const city = AIRPORT_BY_CODE[site]?.city ?? site;
  const ferry = legs.length
    ? ` Handover at ${city}${o.exOperator ? ` (ex-${o.exOperator})` : ''} on ${fmtDay(handover)}; ferry home ${fmtDay(legs[0].std)}${fmtDay(legs[legs.length - 1].sta) !== fmtDay(legs[0].std) ? `–${fmtDay(legs[legs.length - 1].sta)}` : ''}${legs.length > 1 ? ` via ${legs.slice(0, -1).map((l) => AIRPORT_BY_CODE[l.to]?.city ?? l.to).join(', ')}` : ''}. Our pilots deadhead out on airline flights before that.`
    : ` Handover at ${city} on ${fmtDay(handover)}.`;
  const crew = rated.CPT >= 1 && rated.FO >= 1 ? '' : ` No ${fam}-rated pilots yet: book a conversion before ${fmtDay(legs[0]?.std ?? handover)}.`;
  pushMessage(g, {
    tone: 'good', cat: 'company', title: `${shortName(t)} signed: ${ac.reg}`,
    body: `${o.kind === 'buy' ? `Bought for ${usd(o.price)}` : `Leased from ${o.lessor} at ${usd(o.rentPerMonth)}/month for ${o.leaseMonths} months`}.${ferry}${crew}`,
    ref: { kind: 'aircraft', id: ac.id },
  });
  return { ok: true, msg: `${ac.reg} handed over ${fmtDay(handover)} at ${city}`, data: { aircraftId: ac.id } };
}

/** 'aircraft.delivery': on the AOC at the handover site (v0.6 deliveries without a site: at home base). */
export function onDelivery(g: GameState, ev: SimEvent): void {
  const ac = g.fleet[ev.id];
  if (!ac || ac.status !== 'delivering') return;
  ac.status = 'available';
  g.stats.deliveries = (g.stats.deliveries ?? 0) + 1;
  touchFlights(g);
  const dl = ac.delivery;
  if (dl && dl.site !== g.company.homeBase) {
    ac.at = dl.site;
    handoverMessage(g, ac);
    return;
  }
  ac.at = g.company.homeBase;
  if (dl) dl.arrived = g.now;
  pushMessage(g, { tone: 'good', cat: 'company', title: `${ac.reg} delivered`, body: `The ${typeOf(ac.typeId).name} is on the AOC at ${g.company.homeBase}.`, ref: { kind: 'aircraft', id: ac.id } });
}

/** 'lease.end': a booked return ends with its check (leaseReturn.ts); else return at base when free, or roll on a month at +10%. */
export function onLeaseEnd(g: GameState, ev: SimEvent): void {
  const ac = g.fleet[ev.id];
  if (!ac || ac.ownership.kind !== 'dryLeaseIn' || ac.ownership.leaseEnd > g.now || ac.returning) return;
  const busy = ac.status !== 'available' || ac.at !== g.company.homeBase || flightsOf(g, ac.id).some((f) => f.status === 'scheduled' || f.status === 'enroute')
    || Object.values(g.contracts).some((c) => (c.status === 'signed' || c.status === 'active') && c.aircraftIds.includes(ac.id));
  if (busy) {
    ac.ownership.leaseEnd = g.now + Math.round(MONTH);
    ac.ownership.rentPerMonth = Math.round(ac.ownership.rentPerMonth * 1.1);
    schedule(g, ac.ownership.leaseEnd, 'lease.end', ac.id);
    pushMessage(g, { tone: 'warn', cat: 'company', title: `Lease extended: ${ac.reg}`, body: `${ac.reg} is still working, so the lease rolls on a month at ${usd(ac.ownership.rentPerMonth)} (+10%).`, ref: { kind: 'aircraft', id: ac.id } });
    return;
  }
  if (ac.ownership.deposit) cashOnly(g, ac.ownership.deposit);
  delete g.fleet[ac.id];
  touchFlights(g);
  pushMessage(g, { tone: 'info', cat: 'company', title: `${ac.reg} returned`, body: `Redelivered to ${ac.ownership.lessor}.${ac.ownership.deposit ? ` Deposit ${usd(ac.ownership.deposit)} refunded.` : ''}` });
}

// ---------- v0.7 market view ----------

export interface MarketOfferView {
  offer: AircraftOffer; typeId: string; gate: AircraftGate; quote: DeliveryQuote;
  crew: { level: 'ok' | 'warn' | 'bad'; rated: number; text: string };
  /** Days until it lapses (whole days, for 'Open 9 more days'). */ daysLeft: number;
  /** 'Return at Shannon · 7-day check · cabin back to 18J/282Y' (leases). */
  returnText: string | null;
}

/** Open offers, newest first, with gate, delivery quote, crew and return terms. Pure. */
export function marketView(g: GameState): MarketOfferView[] {
  return g.market.aircraft
    .filter((o) => o.expires > g.now)
    .map((o) => {
      const t = typeOf(o.typeId);
      const site = o.site ?? g.company.homeBase;
      const handover = g.now + o.leadDays * DAY;
      const quote = deliveryQuote(g, o.typeId, site, handover, o.where);
      const r = ratedPilots(g, [t.family]);
      const n = r.CPT + r.FO;
      const fam = familyLabel(t.family);
      const convDays = BAL.conv.pilotDays;
      const ferryAt = quote.legs[0]?.std ?? handover;
      const crew = r.CPT >= 1 && r.FO >= 1
        ? { level: 'ok' as const, rated: n, text: `${n} ${fam} pilots` }
        : { level: (ferryAt - g.now > (convDays + BAL.conv.leadDays + 3) * DAY ? 'warn' : 'bad') as 'warn' | 'bad', rated: n, text: `No ${fam} pilots: convert or hire (${convDays} days)` };
      const back = returnSiteOf(o);
      const ret = o.kind === 'dryLeaseIn' ? `Return at ${siteCity(back)} · ${BAL.leaseReturn.checkDays[t.body === 'wide' ? 1 : 0]}-day check · cabin back to ${o.cabin.label}` : null;
      return { offer: o, typeId: o.typeId, gate: aircraftGate(g, o.typeId), quote, crew, daysLeft: Math.max(0, Math.ceil((o.expires - g.now) / DAY)), returnText: ret };
    })
    .sort((a, b) => (b.offer.created ?? 0) - (a.offer.created ?? 0) || (a.offer.id < b.offer.id ? 1 : -1));
}

/** v0.7 dev: posts an offer now (type, kind, new-build, handover site); returns its id. */
export function devMarketOffer(g: GameState, typeId?: string, opts: { kind?: 'dryLeaseIn' | 'buy'; newBuild?: boolean; site?: string } = {}): string {
  const t = typeOf(typeId && ACMI_TYPES_LIST.some((x) => x.id === typeId) ? typeId : 'a320ceo');
  const o = makeOffer(g, t, { kind: opts.newBuild ? undefined : opts.kind ?? 'dryLeaseIn', newBuild: opts.newBuild ?? false, site: opts.site });
  postOffer(g, o);
  return o.id;
}

/** v0.7 load: v0.6 offers hand over at base; leases return at base with today's cabin. */
export function loadMarket(g: GameState): void {
  for (const o of g.market.aircraft) o.site ??= g.company.homeBase;
  for (const ac of Object.values(g.fleet)) {
    if (ac.ownership.kind !== 'dryLeaseIn') continue;
    ac.ownership.returnSite ??= g.company.homeBase;
    ac.ownership.deliveredLayout ??= ac.cabin.layout;
  }
}
