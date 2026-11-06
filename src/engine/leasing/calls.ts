// v0.17 lessor calls (UPDATE-0.17.md §J.1–§J.2; lane `supply`): the daily random offers become lessor calls, the
// aircraft a lessor has now (stored, or coming off lease). Two rolls a day on the side stream `call:<day>`:
// narrowbodies 1.6 a month, widebodies 0.35 a month once a widebody gate is held or pending (one rung away: a rare
// teaser), plus about one exotic a year (§T). Types are weighted by 1 − tightNow; the lessor is one whose families,
// ages and lowest grade fit us and who has room under its cap: lessors don't call airlines they won't lease to.
// At most 6 calls open, 2 of them widebodies (ops/market.ts postOffer). New-build slots come with realistic leads.
// Also daily: the reserves escalation of v0.17 leases (+3 % on each anniversary).

import { ACMI_TYPES_LIST, type AcmiType } from '../../data/acmiTypes';
import { LESSOR_BY_ID, LESSOR_DEFS, type LessorDef } from '../../data/lessors';
import { EX_OPERATORS, FACTORIES, NEW_BUILD, STORAGE_SITES } from '../../data/market';
import { AIRPORT_BY_CODE } from '../../data/airports';
import { BAL } from '../core/balance';
import { typeOf } from '../core/perf';
import { chance, int, pick, weightedPick, type RngHolder } from '../core/rng';
import { DAY, fromUTC, yearOf } from '../core/time';
import type { AgeBand, AircraftOffer, CreditGrade, GameState, LessorId, Minute } from '../core/types';
import { aircraftGate } from '../ops/company';
import { bandsFor, dailyMarketLegacy, eligibleTypes, makeOffer, postFiling, postOffer, type OfferOpts } from '../ops/market';
import { exposureOf } from './credit';
import { isExotic } from './exotic';
import { leasingSide } from './side';
import { gradeNow } from './terms';
import { tightNow } from './tightness';

const C = () => BAL.v017.calls;
const RANK: Record<CreditGrade, number> = { A: 0, B: 1, C: 2, D: 3 };
const MONTH = 30.44 * DAY;

/** A lessor call (or a legacy offer): what the open-calls cap counts (proposals, batches, short-term are not). Pure. */
export const isCall = (o: AircraftOffer): boolean => !o.source || o.source === 'call' || o.source === 'newBuild';

/** Widebodies we hold or are getting: on the AOC, delivering, in a deal (§C.2's total). Pure. */
export function widebodiesHeld(g: GameState): number {
  let n = 0;
  for (const a of Object.values(g.fleet)) if (typeOf(a.typeId).body === 'wide') n++;
  for (const d of g.leasing?.deals ?? []) if ((d.stage === 'committee' || d.stage === 'conditions' || d.stage === 'approved') && typeOf(d.offer.typeId).body === 'wide') n++;
  return n;
}

/**
 * The lessors that would place type t with us now, with the bands they would offer it in (§B, §C.2, §C.3, §T): the
 * family leased, our grade at or above its lowest (an exotic at one grade lower with the big security), room under
 * its cap at our grade, our grade's widebody total, widebodies at C only aged 15 years or more. `newBuild`: the
 * lessors with new aircraft at the new-build grade (B narrowbody, A widebody). Pure.
 */
export function callLessors(g: GameState, t: AcmiType, opts: { newBuild?: boolean; grade?: CreditGrade } = {}): { def: LessorDef; bands: AgeBand[] }[] {
  const grade = opts.grade ?? gradeNow(g).grade;
  const body = t.body;
  const X = BAL.v017.exotic;
  const exotic = isExotic(t.id);
  if (body === 'wide' && widebodiesHeld(g) >= (BAL.v017.credit.wideTotal[grade] ?? 0)) return [];
  const typeBands = bandsFor(g, t);
  const out: { def: LessorDef; bands: AgeBand[] }[] = [];
  for (const def of LESSOR_DEFS) {
    if (!def.families.includes(t.family)) continue;
    const min = def.minGrade[body];
    if (!min || def.appetite[body] === null) continue;
    const ok = RANK[grade] <= RANK[min] || (exotic && grade === X.securityGrade && RANK[grade] - RANK[min] === 1);
    if (!ok) continue;
    const cap = def.caps[grade];
    const ex = exposureOf(g, def.id);
    if (ex.all >= cap.all || (body === 'wide' && ex.wide >= cap.wide)) continue;
    if (def.id === 'exop' && !(EX_OPERATORS[t.id] ?? []).length) continue;
    let bands: AgeBand[];
    if (opts.newBuild) {
      const need = BAL.v017.newBuild.grade[body] as CreditGrade;
      bands = def.ages.includes('new') && typeBands.includes('new') && RANK[grade] <= RANK[need] ? ['new'] : [];
    } else {
      bands = typeBands.filter((b) => b !== 'new' && def.ages.includes(b));
      if (body === 'wide' && grade === 'C') bands = bands.filter((b) => b === 'old');
    }
    if (bands.length) out.push({ def, bands });
  }
  return out;
}

/** The earliest new-build handover of a type (§J.2): a fixed year for the placed widebodies, else none. Pure. */
export function newBuildEarliest(typeId: string): Minute | null {
  const y = BAL.v017.newBuild.earliestYear[typeId];
  return y ? fromUTC(y, 1, 1) : null;
}

/**
 * The lead of a new-build slot signed now (§J.2): A321neo 540–1,080 days, A330-900neo 730–1,095, the 787s and A350s
 * from January 2030 (the A350-900ULR and 777-9 2031, the 777-8 2032), never under 540 days. With the v0.17 market
 * off: the v0.16 lead (180–420 days).
 */
export function newBuildLead(g: GameState, typeId: string, r: RngHolder): number {
  const N = BAL.v017.newBuild.lead;
  const M = BAL.market7.newBuildLead;
  if (!BAL.v017.on) return int(r, M[0], M[1]);
  const min = N.minLead as number;
  const span = (N[typeId] ?? (typeOf(typeId).body === 'narrow' ? N.narrow : undefined)) as [number, number] | undefined;
  const early = newBuildEarliest(typeId);
  let lead = span ? int(r, span[0], span[1]) : min + int(r, 0, 180);
  if (early !== null) lead = Math.max(lead, Math.ceil((early - g.now) / DAY) + int(r, 0, 180));
  return Math.max(min, lead);
}

/** The open window [min, max] days of a call of this body. */
const daysOf = (t: AcmiType): [number, number] => (t.body === 'wide' ? C().wideDays : C().days);

/**
 * One lessor call of type t: the lessor drawn by appetite among those that would place it with us, the band among
 * theirs; a sale (30 % of narrowbodies and out-of-production types, as before) from any lessor holding the family.
 * Null when no lessor fits. On the call's stream `r`.
 */
export function lessorCall(g: GameState, t: AcmiType, r: RngHolder, opts: { newBuild?: boolean; band?: AgeBand; lease?: boolean; depositMonths?: number; handoverAt?: Minute } = {}): AircraftOffer | null {
  const grade = gradeNow(g).grade;
  const canNew = NEW_BUILD.includes(t.id) && !!FACTORIES[t.family];
  const newBuild = canNew && (!!t.newOnly || !!opts.newBuild);
  const oldType = !t.lastYear || t.lastYear < yearOf(g.now) - 1 ? !!t.lastYear : false;
  const canBuy = !newBuild && (t.body === 'narrow' || oldType);
  if (!opts.lease && canBuy && chance(r, 0.3)) {
    const sellers = LESSOR_DEFS.filter((l) => l.families.includes(t.family) && l.id !== 'exop');
    const def = sellers.length ? pick(r, sellers) : undefined;
    const bands = bandsFor(g, t).filter((b) => b !== 'new');
    if (!bands.length) return null;
    return makeOffer(g, t, { source: 'call', kind: 'buy', band: pick(r, bands), seller: def?.name ?? 'A lessor', days: daysOf(t), grade });
  }
  const fits = callLessors(g, t, { newBuild, grade });
  const withBand = opts.band ? fits.filter((x) => x.bands.includes(opts.band!)) : fits;
  const x = weightedPick(r, withBand.length ? withBand : fits, (f) => f.def.appetite[t.body] ?? 0.1);
  if (!x) return null;
  const band = opts.band && x.bands.includes(opts.band) ? opts.band : pick(r, x.bands);
  const o: OfferOpts = { source: newBuild ? 'newBuild' : 'call', lessorId: x.def.id, band, grade, days: daysOf(t), ...(newBuild ? { newBuild: true } : {}) };
  if (opts.depositMonths !== undefined) o.depositMonths = opts.depositMonths;
  if (opts.handoverAt !== undefined) o.handoverAt = opts.handoverAt;
  return makeOffer(g, t, o);
}

/**
 * The guaranteed early offers (refreshMarket: the narrowbody lease in month 1–2, the old widebody in months 4–6) as
 * lessor calls priced at our grade. A start-up rated C still gets them: a mid-life lessor keen to place one, at our
 * grade's deposit (§J.1). Always an offer.
 */
export function guaranteedCall(g: GameState, t: AcmiType, r: RngHolder, opts: { band?: AgeBand; depositMonths?: number; handoverAt?: Minute } = {}): AircraftOffer {
  const o = lessorCall(g, t, r, { lease: true, ...opts });
  if (o) return o;
  // No lessor fits our rating or caps: a mid-life lessor keen to place one (Carlyle takes every family it leases).
  const keen: LessorId = LESSOR_BY_ID.aircastle.families.includes(t.family) && chance(r, 0.5) ? 'aircastle' : LESSOR_BY_ID.carlyle.families.includes(t.family) ? 'carlyle' : 'vallair';
  const bands: AgeBand[] = bandsFor(g, t).filter((b) => b !== 'new');
  const band = opts.band && bands.includes(opts.band) ? opts.band : bands.includes('mid') ? 'mid' : bands[bands.length - 1] ?? 'old';
  return makeOffer(g, t, { source: 'call', lessorId: keen, band, days: daysOf(t), ...(opts.depositMonths !== undefined ? { depositMonths: opts.depositMonths } : {}), ...(opts.handoverAt !== undefined ? { handoverAt: opts.handoverAt } : {}) });
}

/** Lessor calls of a body open now (and how many of them are teasers we cannot sign yet). Pure. */
function openCalls(g: GameState, body: 'narrow' | 'wide'): { n: number; teasers: number } {
  let n = 0;
  let teasers = 0;
  for (const o of g.market.aircraft) {
    if (!isCall(o) || typeOf(o.typeId).body !== body) continue;
    n++;
    if (!aircraftGate(g, o.typeId).ok) teasers++;
  }
  return { n, teasers };
}

/**
 * Daily (dailyMarket while BAL.v017.on): lapsed offers leave; the narrowbody, widebody and exotic rolls (each thrown
 * every day so the stream stays put); the post-filing widebody (as in v0.16, at one month's deposit); the reserves
 * escalation. Step 0's v0.16 roll stays in dailyMarketLegacy for --market=v16.
 */
export function dailyCalls(g: GameState): void {
  if (!BAL.v017.on) return dailyMarketLegacy(g);
  const m = g.market;
  m.aircraft = m.aircraft.filter((o) => o.expires > g.now);
  const r = leasingSide(g, `call:${Math.floor(g.now / DAY)}`);
  const K = C();
  const L = g.leasing;
  const all = m.aircraft.filter(isCall).length;
  const pool = eligibleTypes(g).filter((e) => !isExotic(e.t.id) && !BAL.v017.supply.rfpOnly.includes(e.t.id));
  // Narrowbodies: 1.6 a month.
  if (chance(r, K.narrowPerMonth / 30.44) && all < K.maxOpen) {
    const x = weightedPick(r, pool.filter((e) => e.t.body === 'narrow'), (e) => e.w);
    const o = x ? lessorCall(g, x.t, r, { newBuild: chance(r, K.newBuildChance) }) : null;
    if (o) {
      postOffer(g, o);
      if (L) L.stats.calls.narrow++;
    }
  }
  // Widebodies: 0.35 a month once a widebody gate is held or pending; one rung away a rare teaser (× 0.3, 1 open).
  if (chance(r, K.widePerMonth / 30.44)) {
    const wide = pool.filter((e) => e.t.body === 'wide');
    const held = wide.filter((e) => !e.teaser);
    const open = openCalls(g, 'wide');
    const teaserOk = open.teasers < K.maxTeasers;
    const cands = held.length ? wide.filter((e) => !e.teaser || teaserOk) : teaserOk && chance(r, K.teaserWeight) ? wide : [];
    const x = weightedPick(r, cands, (e) => e.w);
    if (x && open.n < K.maxWide && m.aircraft.filter(isCall).length < K.maxOpen) {
      const o = lessorCall(g, x.t, r, { newBuild: chance(r, K.newBuildChance) });
      if (o) {
        postOffer(g, o);
        if (L) L.stats.calls.wide++;
      }
    }
  }
  // Exotics (§T): about once a year when the gate allows one.
  if (chance(r, BAL.v017.exotic.callsPerYear / 365)) exoticCall(g, r);
  // The post-filing widebody (§J.1: priced at our grade but one month's deposit, "a lessor keen to place").
  postFiling(g, r, (typeId, handoverAt) => guaranteedCall(g, typeOf(typeId), r, { band: 'old', depositMonths: 1, handoverAt }));
  escalateReserves(g);
}

/**
 * An exotic comes up (§T): an A380, a 747, a rare A340 whose gate we hold or have filed. From a specialist lessor or
 * the airline retiring it; 40 % of them (and every 747 classic, every one at rating D) for sale, the classics from
 * storage. A lease follows the grade rule (B or better, C with the big security); with no lessor to place it, a sale.
 */
export function exoticCall(g: GameState, r: RngHolder): AircraftOffer | null {
  const X = BAL.v017.exotic;
  const types = ACMI_TYPES_LIST.filter((t) => isExotic(t.id) && t.available && !t.newOnly && aircraftGate(g, t.id).ok && bandsFor(g, t).some((b) => b !== 'new'));
  const t = weightedPick(r, types, (x) => Math.max(0.05, 1 - tightNow(g, x.id)));
  if (!t) return null;
  const grade = gradeNow(g).grade;
  const classic = X.classics.includes(t.id);
  const lessors = callLessors(g, t, { grade });
  const sale = classic || grade === 'D' || !lessors.length || chance(r, X.sale.share);
  const bands = bandsFor(g, t).filter((b) => b !== 'new');
  let o: AircraftOffer;
  if (sale) {
    const ops = EX_OPERATORS[t.id] ?? [];
    const store = STORAGE_SITES.filter((s) => AIRPORT_BY_CODE[s.code]);
    if (classic || !ops.length) {
      const s = pick(r, store);
      o = makeOffer(g, t, { source: 'call', kind: 'buy', band: 'old', seller: `${s.name}, ${s.city}`, site: s.code, days: C().wideDays, grade });
    } else {
      const x = pick(r, ops);
      o = makeOffer(g, t, { source: 'call', kind: 'buy', band: pick(r, bands), seller: x.airline, lessorId: 'exop', exOperator: x.airline, days: C().wideDays, grade });
    }
  } else {
    const x = weightedPick(r, lessors, (f) => f.def.appetite.wide ?? 0.1)!;
    o = makeOffer(g, t, { source: 'call', lessorId: x.def.id, band: pick(r, x.bands), days: C().wideDays, grade });
  }
  postOffer(g, o);
  if (g.leasing) g.leasing.stats.calls.wide++;
  return o;
}

/** Daily: +3 % on the reserves of a v0.17 lease at each anniversary of its handover (§E.3). */
export function escalateReserves(g: GameState): void {
  const esc = BAL.v017.terms.reserveEsc;
  for (const ac of Object.values(g.fleet)) {
    const own = ac.ownership;
    if (own.kind !== 'dryLeaseIn' || own.reservesEscAt === undefined || own.reservesEscAt > g.now) continue;
    own.reservesPerFH = Math.round((own.reservesPerFH * (1 + esc)) / 10) * 10;
    own.reservesEscAt += Math.round(12 * MONTH);
  }
}

/**
 * §T "never impossible": the least chance a request that meets every requirement has of a proposal from a source
 * that holds the type (0 for a common type): 12 %, or 5 % for a 747 classic (a sale from storage). For lane deals'
 * request answers (rfp.ts). Pure.
 */
export function supplyFloor(typeId: string): number {
  const X = BAL.v017.exotic;
  if (!isExotic(typeId)) return 0;
  return X.classics.includes(typeId) ? X.floor.classic : X.floor.default;
}
