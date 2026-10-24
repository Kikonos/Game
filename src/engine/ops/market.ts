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
import { chance, gaussian, int, pick, range, weightedPick, type RngHolder } from '../core/rng';
import { DAY, fmtDate, fmtDay, monthKey, yearOf } from '../core/time';
import type { ActionResult, Aircraft, AircraftOffer, ApprovalId, Cabin, GameState, MarketPhase, MarketShock, SimEvent } from '../core/types';
import { antarcticSeason, nextHajj } from '../../data/worldCalendar';
import { clamp, hash } from '../core/util';
import { familyLabel } from '../crew/conversion';
import { fittedRest, migrateRest, rollRest } from '../crew/restPlan';
import { aircraftGate, APPROVALS, ratedPilots, type AircraftGate } from './company';
import { deliveryQuote, handoverMessage, planDeliveryFerry, type DeliveryQuote } from './delivery';
import { usedHoursCycles } from './sale';
import { usd } from './util';

/** Real operating lessors (names only; they also trade used aircraft). */
/**
 * v0.7: market rolls use their own stream of the engine PRNG (seeded from the game seed and a key: the day, the
 * offer id), so offers coming and going never shift the rest of the game's randomness. Deterministic, save-safe.
 */
const side = (g: GameState, key: string): RngHolder => ({ rng: hash(`${g.seed}:market:${key}`) | 0 });

const LESSORS = ['AerCap', 'Avolon', 'SMBC Aviation Capital', 'BOC Aviation', 'Carlyle Aviation Partners', 'Air Lease Corporation', 'Aviation Capital Group'];
const MONTH = 30.44 * DAY;
const OLD = ['b763', 'a332', 'a343', 'b752', 'b744'];

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
function makeOffer(g: GameState, t: AcmiType, opts: { lease?: boolean; kind?: 'dryLeaseIn' | 'buy'; newBuild?: boolean; site?: string; depositMonths?: number; handoverAt?: number } = {}): AircraftOffer {
  const M = BAL.market7;
  const id = nextId(g, 'mo');
  const r = side(g, id);
  const now = yearOf(g.now);
  const old = OLD.includes(t.id);
  const index = t.body === 'wide' ? g.market.wideIndex : g.market.narrowIndex;
  const canNew = NEW_BUILD.includes(t.id) && !!FACTORIES[t.family];
  const newBuild = canNew && (opts.newBuild ?? (!opts.lease && !opts.kind && chance(r, M.newBuildChance)));
  let o: AircraftOffer;
  if (newBuild) {
    const lead = int(r, M.newBuildLead[0], M.newBuildLead[1]);
    const rent = Math.round(((t.rentNew ?? t.rentMonth) * range(r, M.newBuildRent[0], M.newBuildRent[1]) * index) / 1000) * 1000;
    const site = pick(r, FACTORIES[t.family]!.sites);
    o = {
      id, typeId: t.id, kind: 'dryLeaseIn', lessor: pick(r, LESSORS), builtYear: yearOf(g.now + lead * DAY), cabin: cabinOf(t), rentPerMonth: rent,
      reservesPerFH: Math.round((t.maintBH * range(r, 0.38, 0.46)) / 10) * 10, leaseMonths: int(r, M.newBuildMonths[0] / 12, M.newBuildMonths[1] / 12) * 12, price: 0,
      deposit: M.newBuildDepositMonths * rent, leadDays: lead, expires: 0, site: site.code, where: siteText(site), newBuild: true,
    };
  } else {
    // Within the type's production years (no A321neo before 2017, no 757 after 2004).
    const [lo, hi] = old ? [1996, 2008] : t.tier <= 1 ? [2005, 2017] : [now - 16, now - 6];
    const from = Math.max(lo, t.firstYear ?? lo);
    const to = Math.min(hi, t.lastYear ?? hi, now - 1);
    const built = from <= to ? int(r, from, to) : int(r, Math.min(t.firstYear ?? lo, now - 1), Math.min(t.lastYear ?? now - 1, now - 1));
    const age = now - built;
    // Steeper past 18 years (lessors price old jets down fast).
    const ageAdj = clamp(1 - (age - 12) * 0.02 - Math.max(0, age - 18) * 0.04, 0.55, 1.15);
    const canBuy = t.body === 'narrow' || old;
    const buy = opts.kind ? opts.kind === 'buy' && canBuy : !opts.lease && canBuy && chance(r, 0.3);
    const rent = Math.round((t.rentMonth * range(r, 0.9, 1.15) * index * ageAdj) / 1000) * 1000;
    // v0.7.2 priced like a sale (the market index included), so buying and selling straight back loses the spread.
    const price = buy ? Math.round((t.valueUsed * range(r, 0.95, 1.12) * ageAdj * index) / 10_000) * 10_000 : 0;
    o = {
      id, typeId: t.id, kind: buy ? 'buy' : 'dryLeaseIn', lessor: buy ? `${pick(r, LESSORS)} (used sale)` : pick(r, LESSORS),
      builtYear: built, cabin: cabinOf(t), rentPerMonth: buy ? 0 : rent, reservesPerFH: buy ? 0 : Math.round((t.maintBH * range(r, 0.38, 0.46)) / 10) * 10,
      leaseMonths: buy ? 0 : int(r, BAL.leaseMonths[0] / 6, BAL.leaseMonths[1] / 6) * 6, price, deposit: buy ? price : (opts.depositMonths ?? 2) * rent,
      leadDays: t.body === 'wide' ? int(r, BAL.deliveryDaysWide[0], BAL.deliveryDaysWide[1]) : int(r, BAL.deliveryDays[0], BAL.deliveryDays[1]), expires: 0,
    };
    // Handover: a lessor site half the time, else the previous operator's hub.
    const ops = (EX_OPERATORS[t.id] ?? []).filter((x) => AIRPORT_BY_CODE[x.hub] && runwayFit(t.id, x.hub) !== 'no');
    if (!ops.length || chance(r, M.lessorSiteShare)) {
      const s = pick(r, lessorSites(t));
      o.site = s.code;
      o.where = siteText(s);
    } else {
      const x = pick(r, ops);
      o.site = x.hub;
      o.exOperator = x.airline;
      o.where = `ex-${x.airline}, ${AIRPORT_BY_CODE[x.hub].city} (${x.hub})`;
    }
  }
  if (opts.site && AIRPORT_BY_CODE[opts.site] && opts.site !== o.site) {
    // Another site: the ex-operator only when it is that operator's hub.
    const x = (EX_OPERATORS[t.id] ?? []).find((e) => e.hub === opts.site);
    o.site = opts.site;
    if (x) o.exOperator = x.airline;
    else delete o.exOperator;
    const s = LESSOR_SITES.find((l) => l.code === opts.site);
    o.where = s ? siteText(s) : `${o.exOperator ? `ex-${o.exOperator}, ` : ''}${AIRPORT_BY_CODE[opts.site].city} (${opts.site})`;
  }
  if (opts.handoverAt !== undefined) o.leadDays = Math.max(BAL.deliveryDays[0], Math.round((opts.handoverAt - g.now) / DAY));
  o.index = index;
  o.expires = g.now + int(r, M.offerDays[0], M.offerDays[1]) * DAY;
  o.created = g.now;
  // v0.7.3 pilots' and cabin crew's rest facilities per airframe, rolled last on the offer's own stream.
  o.rest = rollRest(t.id, o.cabin.j, () => range(r, 0, 1));
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
  const city = o.site ? siteCity(o.site) : 'base';
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
  // v0.8 the outlook's trend arrows compare against last month.
  m.prev = { narrow: m.narrowIndex, wide: m.wideIndex, fuel: m.fuelPrice };
  m.fuelPrice = Math.round(clamp(m.fuelPrice * (1 + gaussian(g) * 0.04) + (BAL.fuelPrice - m.fuelPrice) * 0.15, 550, 1250));
  // v0.8 (UPDATE-0.8.md §4.2): each index is pulled toward its phase target (+ the segment offset) with a little noise.
  stepCycle(g);
  const C = BAL.v08.market;
  const cy = m.cycle!;
  const tgt = C.target[cy.phase];
  m.narrowIndex = Math.round(clamp(m.narrowIndex + (tgt + cy.narrowOff - m.narrowIndex) * C.pull + gaussian(g) * C.noise, C.clamp[0], C.clamp[1]) * 1000) / 1000;
  m.wideIndex = Math.round(clamp(m.wideIndex + (tgt + cy.wideOff - m.wideIndex) * C.pull + gaussian(g) * C.noise, C.clamp[0], C.clamp[1]) * 1000) / 1000;
  m.shocks = (m.shocks ?? []).filter((x) => x.until > g.now);
  hajjShock(g);
  const month = monthKey(g.now) - monthKey(g.started);
  const r = side(g, `m${month}`);
  if (!m.gotNarrow && (month >= 1 || chance(r, 0.5))) {
    m.gotNarrow = true;
    postOffer(g, makeOffer(g, typeOf(chance(r, 0.6) ? 'a320ceo' : 'b738'), { lease: true }));
  }
  // The old widebody lease shows as a teaser while the gate is still closed.
  if (!m.gotWide && month >= 3 && (month >= 5 || chance(r, 0.4))) {
    m.gotWide = true;
    postOffer(g, makeOffer(g, typeOf(chance(r, 0.5) ? 'b763' : 'a332'), { lease: true }));
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
  const r = side(g, `d${Math.floor(g.now / DAY)}`);
  if (m.aircraft.length < M.maxOpen && chance(r, M.perMonth / 30.44)) {
    const x = weightedPick(r, eligibleTypes(g), (e) => e.w);
    if (x) postOffer(g, makeOffer(g, x.t));
  }
  // Within 45 days of filing there is an unlocked widebody lease to sign: posted when none is open (the one open on
  // the filing day may lapse unsigned).
  const filed = g.company.pendingApprovals.find((p) => p.id === 'widebody');
  if (!m.gotWideFiled && filed) {
    const days = (g.now - filed.started) / DAY;
    // v0.8 only one handed over near the grant counts (one open on the filing day lapses months before it).
    const open = m.aircraft.some((o) => typeOf(o.typeId).body === 'wide' && o.kind === 'dryLeaseIn' && aircraftGate(g, o.typeId).ok && g.now + o.leadDays * DAY >= filed.done - 30 * DAY);
    if (days >= M.wideAfterFilingDays) m.gotWideFiled = true;
    else if (!open && (days >= M.wideAfterFilingDays - 1 || chance(r, 1 / 20))) {
      m.gotWideFiled = true;
      // A lessor keen to place an old widebody: one month's deposit, handed over around the approval's due date.
      postOffer(g, makeOffer(g, typeOf(chance(r, 0.5) ? 'b763' : 'a332'), { lease: true, depositMonths: 1, handoverAt: filed.done + int(r, -15, 15) * DAY }));
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
  // v0.7.2 hours and cycles on the sale model's norms (its adjustments average 1.0 on a fresh purchase).
  const w = t.body === 'wide' ? 1 : 0;
  // v0.8 pre-release: cycles on the type's own hours per cycle (a 747-400 about 1 per 8.5 h, not a narrowbody's 2 h).
  const { hours, cycles } = o.newBuild ? { hours: 0, cycles: 0 } : usedHoursCycles(o.typeId, age, range(g, 0.85, 1.15));
  const ac: Aircraft = {
    id: nextId(g, 'a'), reg: registration(g), typeId: o.typeId,
    ownership: o.kind === 'buy'
      ? { kind: 'owned', bookValue: o.price, boughtAt: g.now, boughtPrice: o.price, boughtIndex: o.index ?? (w ? g.market.wideIndex : g.market.narrowIndex), ...(o.newBuild ? { newBuild: true } : {}) }
      : {
          kind: 'dryLeaseIn', lessor: o.lessor, rentPerMonth: o.rentPerMonth, reservesPerFH: o.reservesPerFH, leaseStart: handover, leaseEnd: handover + Math.round(o.leaseMonths * MONTH), deposit: o.deposit,
          returnSite: returnSiteOf(o), deliveredLayout: o.cabin.layout, index: o.index ?? (t.body === 'wide' ? g.market.wideIndex : g.market.narrowIndex), ...(o.newBuild ? { newBuild: true } : {}),
        },
    builtYear: o.builtYear, hours, cycles,
    // Delivered fresh from a redelivery check (new-build: zero time).
    maint: o.newBuild
      ? { fhSinceA: 0, lastA: handover, fhSinceC: 0, lastC: handover, deferred: 0 }
      : { fhSinceA: 0, lastA: handover, fhSinceC: Math.round(range(g, 0.1, 0.4) * (t.body === 'wide' ? 6000 : 7500)), lastC: handover - int(g, 60, 300) * DAY, deferred: 0.03 },
    cabin: { ...o.cabin }, etops: t.body === 'wide' ? Math.min(180, t.etopsMax) : 0, rest: fittedRest(t.id, structuredClone(migrateRest(o)), t.rest.bunkShare === 0 && !t.rest.mro),
    // v0.9 round 3: in the v0.7.4 rest model from the start, as a reload would put it (restPlan.ts loadRest074): a save
    // made after a delivery played on with `restV` set and the straight game without it (bot --det, day 200).
    restV: 2,
    at: site, flightId: null, status: 'delivering', maintId: null, deliveredAt: handover,
    // Utilisation tracked from signing (a reload would set it at the load day otherwise: save/load determinism).
    bhSince: Math.floor(g.now / DAY),
    delivery: { site, where: o.where ?? `${AIRPORT_BY_CODE[site]?.city ?? site} (${site})`, handover, ferryIds: [] },
  };
  g.fleet[ac.id] = ac;
  schedule(g, handover, 'aircraft.delivery', ac.id);
  if (ac.ownership.kind === 'dryLeaseIn') schedule(g, ac.ownership.leaseEnd, 'lease.end', ac.id);
  const legs = planDeliveryFerry(g, ac.id);
  touchFlights(g);
  const rated = ratedPilots(g, [t.family]);
  const fam = familyLabel(t.family);
  const city = siteCity(site);
  const ferry = legs.length
    ? ` Handover at ${city}${o.exOperator ? ` (ex-${o.exOperator})` : ''} on ${fmtDay(handover)}; ferry home ${fmtDay(legs[0].std)}${fmtDay(legs[legs.length - 1].sta) !== fmtDay(legs[0].std) ? `–${fmtDay(legs[legs.length - 1].sta)}` : ''}${legs.length > 1 ? ` via ${legs.slice(0, -1).map((l) => AIRPORT_BY_CODE[l.to]?.city ?? l.to).join(', ')}` : ''}. Our pilots deadhead out on airline flights before that.`
    : ` Handover at ${city} on ${fmtDay(handover)}.`;
  const crew = rated.CPT >= 1 && rated.FO >= 1 ? '' : ` No ${fam}-rated pilots yet: book a conversion before ${fmtDay(legs[0]?.std ?? handover)}.`;
  pushMessage(g, {
    tone: 'good', cat: 'company', title: `${shortName(t)} signed: ${ac.reg}`,
    body: `${o.kind === 'buy' ? `Bought for ${usd(o.price)}` : `Leased from ${o.lessor} at ${usd(o.rentPerMonth)}/month for ${o.leaseMonths} months`}.${ferry}${crew}`,
    ref: { kind: 'aircraft', id: ac.id },
  });
  return { ok: true, msg: `${ac.reg} signed · handover at ${city} ${fmtDay(handover)}`, data: { aircraftId: ac.id } };
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

// ---------- v0.8 market cycle and outlook (UPDATE-0.8.md §4) ----------

const PHASE_NEXT: Record<MarketPhase, [MarketPhase, number][]> = {
  steady: [['boom', 0.35], ['soft', 0.45], ['steady', 0.2]],
  boom: [['steady', 0.6], ['soft', 0.4]],
  soft: [['slump', 0.35], ['steady', 0.65]],
  slump: [['soft', 0.5], ['steady', 0.5]],
};
const PHASE_TITLE: Record<MarketPhase, string> = {
  boom: 'The ACMI market is booming', steady: 'The ACMI market has steadied', soft: 'The ACMI market is softening', slump: 'The ACMI market is in a slump',
};
const PHASE_BODY: Record<MarketPhase, string> = {
  boom: 'Airlines want every spare aircraft: more offers and rates about 15 % higher for the next 6–12 months. Long contracts signed now keep their rates.',
  steady: 'Demand is back to normal: the usual number of offers at the usual rates.',
  soft: 'Airlines are taking fewer extra aircraft: fewer offers and rates about 8 % lower for the next 6–12 months. Long contracts signed now keep their rates.',
  slump: 'Airlines are parking aircraft, not leasing them: far fewer offers and rates about 18 % lower for the next 6–12 months. Long contracts signed now keep their rates.',
};
const MONTH_MIN = 30.44 * DAY;

/** A cycle for a game or save that has none: steady for 9 months. */
export function defaultCycle(t: number): NonNullable<GameState['market']['cycle']> {
  return { phase: 'steady', since: t, until: t + Math.round(9 * MONTH_MIN), narrowOff: 0, wideOff: 0 };
}

/** Monthly: the phase ends → the next one (side stream per month), new offsets, one message. */
function stepCycle(g: GameState): void {
  const m = g.market;
  m.cycle ??= defaultCycle(g.now);
  const cy = m.cycle;
  if (g.now < cy.until) return;
  const r = side(g, `cycle:${monthKey(g.now)}`);
  const C = BAL.v08.market;
  const phase = weightedPick(r, PHASE_NEXT[cy.phase], ([, w]) => w)![0];
  setPhase(g, phase, int(r, C.months[phase][0], C.months[phase][1]), r);
}

/** Sets the market phase for `months` (a recession forces a slump). One message when the phase changes. */
export function setPhase(g: GameState, phase: MarketPhase, months: number, r: RngHolder = side(g, `phase:${g.now}`)): void {
  const C = BAL.v08.market;
  const was = g.market.cycle?.phase;
  const off = () => Math.round(range(r, -C.offset, C.offset) * 1000) / 1000;
  g.market.cycle = { phase, since: g.now, until: g.now + Math.round(months * MONTH_MIN), narrowOff: off(), wideOff: off() };
  if (was && was !== phase) pushMessage(g, { tone: phase === 'boom' ? 'good' : phase === 'steady' ? 'info' : 'warn', cat: 'commercial', title: PHASE_TITLE[phase], body: PHASE_BODY[phase] });
}

/** A Hajj overlapping June raises widebody demand +0.08 for its weeks (added a month ahead, once). */
function hajjShock(g: GameState): void {
  const h = nextHajj(g.now, 1)[0];
  if (!h || g.now < h.pre[0] - 31 * DAY) return;
  const june = (t: number) => new Date(Date.UTC(2000, 0, 1) + t * 60_000).getUTCMonth() === 5;
  if (!june(h.pre[0]) && !june(h.pre[1]) && !june(h.post[0]) && !june(h.post[1])) return;
  const text = `Hajj ${h.ah} in June`;
  if ((g.market.shocks ?? []).some((x) => x.text === text)) return;
  addShock(g, { seg: 'wide', delta: 0.08, until: h.post[1], text });
}

/** Demand index of a segment with today's shocks (pricing and offer volume read this). Pure. */
export function segIndex(g: GameState, seg: 'narrow' | 'wide'): number {
  let idx = seg === 'wide' ? g.market.wideIndex : g.market.narrowIndex;
  for (const s of g.market.shocks ?? []) if (s.until > g.now && (s.seg === 'all' || s.seg === seg)) idx += s.delta;
  return Math.round(idx * 1000) / 1000;
}

/** Adds a demand shock (world events, Hajj weeks). */
export function addShock(g: GameState, x: Omit<MarketShock, 'id'>): void {
  const list = (g.market.shocks ??= []);
  list.push({ id: nextId(g, 'sh'), ...x });
}

/** Fleet-weighted demand: offer volume × (index)² (slump ≈ 0.67, boom ≈ 1.32). Pure. */
export function demandFactor(g: GameState): number {
  let w = 0;
  let n = 0;
  for (const ac of Object.values(g.fleet)) {
    if (ac.status === 'stored') continue;
    w += segIndex(g, typeOf(ac.typeId).body === 'wide' ? 'wide' : 'narrow');
    n++;
  }
  const idx = n ? w / n : segIndex(g, 'narrow');
  return Math.round(idx * idx * 1000) / 1000;
}

export interface MarketOutlook {
  phase: MarketPhase;
  phaseText: string;
  narrow: { index: number; trend: -1 | 0 | 1; text: string };
  wide: { index: number; trend: -1 | 0 | 1; text: string };
  fuel: { price: number; trend: -1 | 0 | 1; text: string };
  season: { name: string; text: string };
  hajj: { arafah: number; pre: [number, number]; post: [number, number]; ah: number }[];
  antarctic: [number, number];
  shocks: { text: string; until: number }[];
  offersText: string;
}

const trendOf = (now: number, prev: number | undefined, band: number): -1 | 0 | 1 => (prev === undefined || Math.abs(now - prev) <= band ? 0 : now > prev ? 1 : -1);
const levelWord = (i: number) => (i >= 1.12 ? 'high' : i >= 1.04 ? 'firm' : i >= 0.96 ? 'steady' : i >= 0.88 ? 'soft' : 'weak');
const arrow = (t: -1 | 0 | 1) => (t > 0 ? '↑' : t < 0 ? '↓' : '');
const PHASE_LINE: Record<MarketPhase, string> = {
  boom: 'Boom: airlines want every spare aircraft; more offers and rates about 15 % higher.',
  steady: 'Steady: the usual number of offers at the usual rates.',
  soft: 'Soft: airlines take fewer extra aircraft; fewer offers and rates about 8 % lower.',
  slump: 'Slump: airlines are parking aircraft; far fewer offers and rates about 18 % lower.',
};

/** The market outlook (§4.4): phase, segment demand, fuel, season, the next Hajj windows, shocks. Pure. */
export function marketOutlook(g: GameState): MarketOutlook {
  const m = g.market;
  const cy = m.cycle ?? defaultCycle(g.now);
  const n = segIndex(g, 'narrow');
  const w = segIndex(g, 'wide');
  const nt = trendOf(m.narrowIndex, m.prev?.narrow, 0.01);
  const wt = trendOf(m.wideIndex, m.prev?.wide, 0.01);
  const ft = trendOf(m.fuelPrice, m.prev?.fuel, 10);
  const mo = new Date(Date.UTC(2000, 0, 1) + g.now * 60_000).getUTCMonth();
  const season = mo >= 5 && mo <= 8 ? { name: 'Summer peak', text: 'Rates about 15 % up for summer starts; everyone is busy.' }
    : mo >= 10 || mo <= 2 ? { name: 'Winter trough', text: 'Rates about 15 % down for winter starts; aircraft sit idle.' }
    : mo <= 4 ? { name: 'Spring', text: 'Airlines are planning their summer: season bases are signed now.' }
    : { name: 'Autumn', text: 'The summer is ending: shorter programmes and winter sun.' };
  const hj = nextHajj(g.now, 3);
  const nextH = hj.find((h) => h.pre[0] > g.now);
  const hajjIn = nextH ? Math.ceil((nextH.pre[0] - g.now) / DAY) : 0;
  if (nextH && hajjIn <= 120) season.name = `${season.name} · Hajj in ${hajjIn} d`;
  const perWeek = BAL.offersPerWeek * demandFactor(g);
  return {
    phase: cy.phase, phaseText: PHASE_LINE[cy.phase],
    narrow: { index: n, trend: nt, text: `Narrowbody demand ${arrow(nt)} ${levelWord(n)}`.replace('  ', ' ') },
    wide: { index: w, trend: wt, text: `Widebody demand ${arrow(wt)} ${levelWord(w)}`.replace('  ', ' ') },
    fuel: { price: m.fuelPrice, trend: ft, text: `Fuel $${m.fuelPrice}/t ${arrow(ft)}`.trim() },
    season,
    hajj: hj.map((h) => ({ arafah: h.arafah, pre: h.pre, post: h.post, ah: h.ah })),
    antarctic: antarcticSeason(g.now),
    shocks: (m.shocks ?? []).filter((x) => x.until > g.now).map((x) => ({ text: `${x.text}: ${x.delta > 0 ? '+' : '−'}${Math.round(Math.abs(x.delta) * 100)} % ${x.seg === 'all' ? '' : `${x.seg}body `}demand until ${fmtDay(x.until)}`.replace('  ', ' '), until: x.until })),
    offersText: `About ${Math.round(perWeek * 10) / 10} new offers a week at this size`,
  };
}

/** v0.7 load: v0.6 offers hand over at base; leases return at base with today's cabin. v0.8: the market cycle. */
export function loadMarket(g: GameState): void {
  g.market.cycle ??= defaultCycle(g.now);
  g.market.shocks ??= [];
  for (const o of g.market.aircraft) o.site ??= g.company.homeBase;
  for (const ac of Object.values(g.fleet)) {
    if (ac.ownership.kind !== 'dryLeaseIn') continue;
    ac.ownership.returnSite ??= g.company.homeBase;
    ac.ownership.deliveredLayout ??= ac.cabin.layout;
  }
}
