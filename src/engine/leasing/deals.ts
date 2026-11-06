// v0.17 from letter of intent to lease (UPDATE-0.17.md §F; lane `deals`).
// 1. Sign the letter of intent: the holding deposit (one month's rent, cash), the offer leaves the market and is kept
//    as a snapshot in a LeaseDeal with its options (sign automatically when approved, letter of credit, paint, tech reps).
// 2. The lessor's credit committee: 10–20 days narrowbody, 14–30 widebody, 21–35 new build (× 0.6 at grade A).
// 3. Approved (grade held; at C 15 % still ask one more month), more security (grade fell by one: 2 months more or a
//    letter of credit, 7 days to answer, walking away refunds the holding deposit), declined (fell by two or more, or a
//    restructuring: the holding deposit back, the lessor looks again after 30 days).
// 4. Sign the lease: the rest of the deposit (or the letter of credit), the transition cost and the extras; the
//    aircraft is created 'delivering' with its transition plan, the handover at its end. Walking away after approval,
//    or letting the 7-day signing window lapse without cash, forfeits the holding deposit (posted as rent).
// Purchases, short-term subleases and legacy offers (no `source`) sign at once (ops/market.ts acquireAircraft).

import { AIRPORT_BY_CODE } from '../../data/airports';
import { LESSOR_BY_ID } from '../../data/lessors';
import { BAL } from '../core/balance';
import { nextId } from '../core/entities';
import { cashOnly, post } from '../core/ledger';
import { pushMessage } from '../core/messages';
import { typeOf } from '../core/perf';
import { int, range } from '../core/rng';
import { DAY, fmtDay, yearOf } from '../core/time';
import type { ActionResult, AircraftOffer, CreditGrade, GameState, LeaseDeal, Minute } from '../core/types';
import { aircraftGate, ratedPilots } from '../ops/company';
import { deliveryQuote } from '../ops/delivery';
import type { ForecastItem } from '../ops/finance';
import { returnSiteOf, signOffer, siteCity } from '../ops/market';
import { checkRegistration } from '../ops/registration';
import { usd } from '../ops/util';
import { postProblem } from '../problems';
import { leaseConditionsCard, leaseSignCard, variationNeededCard } from '../problems/leasing';
import { lockOf } from '../scenario/rules';
import { issueLc, lcWhy, moveLc, releaseLc } from '../finance/lc';
import { needsVariation, variationQuote } from './aoc';
import { gradeAtLeast, lessorStance, RANK, rating, restructuring } from './credit';
import { camoFreeAt, inductionPlan, inductionSteps } from './induction';
import { leasingSide } from './side';
import { bandOf } from './terms';

const D = () => BAL.v017.deal;
const X = () => BAL.v017.exotic;
const MONTH = 30.44 * DAY;

export interface LoiOpts {
  autoSign?: boolean;
  lc?: boolean;
  paint?: boolean;
  techReps?: boolean;
  /** Registration and name chosen in the dialog (as acquireAircraft). */
  reg?: string;
  name?: string;
  delivery?: 'thisSide' | 'ferryCo';
}

/** The letter-of-intent dialog's rows (§N.3). */
export interface LoiQuote {
  offerId: string;
  holding: number;
  depositAtSign: number;
  transition: number;
  techReps: number;
  paint: number;
  /** 'Mid-life A320ceo $220K · 36 months +4 % · normal market −1 % · start-up rating +5 %'. */
  whyRent: string;
  /** '$560/FH · at least 80 FH a month · +3 % a year'. */
  reserves: string;
  /** 'Shannon · 7-day check · half-life 0.5'. */
  ret: string;
  /** Records · check · paint · acceptance, as dates. */
  ready: Minute;
  steps: { label: string; from: Minute; to: Minute }[];
  camo: string;
  aoc: string | null;
  pilots: string | null;
  lcAllowed: boolean;
  cashAfter: number;
  /** What stands in the way (null: can sign). */
  why: string | null;
  // v0.17 deals
  /** §T an exotic below the lessor's grade: the extra deposit and the reserves deposit asked (0 otherwise). */
  exoticSecurity: number;
  reservesDeposit: number;
  /** Why a letter of credit can't be used (null when it can). */
  lcWhy: string | null;
  /** The committee's answer expected in about this many days. */
  committeeDays: [number, number];
  /** The lessor and our rating as it sees it. */
  lessor: string;
  grade: CreditGrade;
}

const ACTIVE: LeaseDeal['stage'][] = ['committee', 'conditions', 'approved'];
const isActive = (d: LeaseDeal) => ACTIVE.includes(d.stage);

/** Whether an offer goes through the letter of intent (§F): a v0.17 lease from a lessor (not short-term, not a sale). Pure. */
export function usesLoi(g: GameState, o: AircraftOffer): boolean {
  void g;
  return BAL.v017.on && !!o.source && o.kind === 'dryLeaseIn' && o.source !== 'spot' && !o.spot;
}

const offerOf = (g: GameState, offerId: string) => g.market.aircraft.find((o) => o.id === offerId);
const lessorName = (o: AircraftOffer) => o.lessor.replace(' (used sale)', '');
const bandOfOffer = (g: GameState, o: AircraftOffer) => o.band ?? bandOf(Math.max(0, yearOf(g.now) - o.builtYear), !!o.newBuild);

/** The committee's days for an offer (§F step 2). Pure. */
function committeeRange(o: AircraftOffer, grade: CreditGrade): [number, number] {
  const k = o.newBuild ? 'newBuild' : typeOf(o.typeId).body === 'wide' ? 'wide' : 'narrow';
  const [a, b] = D().committee[k];
  const x = grade === 'A' ? D().committeeXA : 1;
  return [Math.round(a * x), Math.round(b * x)];
}

/** The transition cost at signing (§G.3): $90K / $180K, × 1.5 for a family new to the AOC. Pure. */
export function transitionCost(g: GameState, o: AircraftOffer): number {
  const t = typeOf(o.typeId);
  const C = BAL.v017.induction.cost;
  const base = t.body === 'wide' ? C.wide : C.narrow;
  const fams = g.company.aocFamilies ?? [];
  return Math.round(base * (fams.includes(t.family) ? 1 : C.newFamilyX));
}

/** The paint in our colours at the transition (BAL.paint.full, the middle of the range). Pure. */
export function paintCost(typeId: string): number {
  const [a, b] = BAL.paint.full.cost[typeOf(typeId).body === 'wide' ? 1 : 0];
  return Math.round((a + b) / 2 / 1000) * 1000;
}

const techRepsCost = (typeId: string) => BAL.v017.induction.techReps.cost[typeOf(typeId).body === 'wide' ? 'wide' : 'narrow'];

/** §T the extra security of an exotic lease at the security grade: deposit months more, reserves up front. Pure. */
export function exoticSecurityOf(g: GameState, o: AircraftOffer): { deposit: number; reserves: number } {
  if (!X().types.includes(o.typeId) || !o.lessorId) return { deposit: 0, reserves: 0 };
  const def = LESSOR_BY_ID[o.lessorId];
  if (!def) return { deposit: 0, reserves: 0 };
  const st = lessorStance(g, def, o.typeId, bandOfOffer(g, o), lessorName(o));
  if (!st.security) return { deposit: 0, reserves: 0 };
  const fh = o.minFH ?? BAL.v017.terms.minFH.wide;
  return { deposit: Math.round(X().securityMonths * o.rentPerMonth), reserves: Math.round(X().reservesDepositMonths * fh * o.reservesPerFH) };
}

/** Why a letter of intent can't be signed now (null: it can). Pure. */
function loiWhy(g: GameState, o: AircraftOffer, holding: number): string | null {
  const lk = lockOf(g, 'fleet');
  if (lk) return lk;
  if ((o.validUntil ?? o.expires) <= g.now) return 'This offer has expired';
  const gate = aircraftGate(g, o.typeId);
  if (!gate.ok) return `${gate.text}: apply under Company › Ladder`;
  const def = o.lessorId ? LESSOR_BY_ID[o.lessorId] : undefined;
  if (def) {
    const st = lessorStance(g, def, o.typeId, bandOfOffer(g, o), lessorName(o));
    if (!st.ok) return `${lessorName(o)}: ${st.text}`;
  }
  if (g.company.cash < holding) return `Not enough cash: ${usd(holding)} holding deposit`;
  return null;
}

/** The letter-of-intent dialog's rows for an open lease offer (§N.3). Null: not a letter-of-intent offer. Pure. */
export function loiQuote(g: GameState, offerId: string, opts: LoiOpts = {}): LoiQuote | null {
  const o = offerOf(g, offerId);
  if (!o || !usesLoi(g, o)) return null;
  const t = typeOf(o.typeId);
  const r = rating(g);
  const holding = Math.round(D().holdingMonths * o.rentPerMonth);
  const sec = exoticSecurityOf(g, o);
  const depositAtSign = Math.max(0, o.deposit - holding) + sec.deposit;
  const transition = transitionCost(g, o);
  const techReps = opts.techReps ? techRepsCost(o.typeId) : 0;
  const paint = opts.paint ? paintCost(o.typeId) : 0;
  const cr = committeeRange(o, r.grade);
  const signAt = g.now + Math.round(((cr[0] + cr[1]) / 2) * DAY);
  const plan = inductionPlan(g, o, { start: signAt, techReps: !!opts.techReps, paint: !!opts.paint });
  const ind = plan.induction;
  const busy = camoFreeAt(g, t.body === 'wide');
  const wantFrom = Math.max(signAt, o.freeAt ?? 0);
  const camo = ind && ind.slot > wantFrom + DAY ? `Our CAMO is busy until ${fmtDay(ind.slot)}: the transition starts then` : busy > g.now + DAY ? `Busy until ${fmtDay(busy)}; free by the signing` : 'Free';
  const vq = variationQuote(g, t.family, o.typeId);
  const p = ratedPilots(g, [t.family], { booked: true });
  const pilots = p.CPT >= 1 && p.FO >= 1 ? `${p.CPT} captains and ${p.FO} first officers rated` : `No ${t.short}-rated pilots yet: book a conversion before the handover`;
  const minFH = o.minFH;
  const reserves = `${usd(o.reservesPerFH)}/FH${minFH ? ` · at least ${minFH} FH a month` : ''}${minFH ? ` · +${Math.round(BAL.v017.terms.reserveEsc * 100)} % a year` : ''}`;
  const site = returnSiteOf(o);
  const ret = `${siteCity(site)} · half-life ${o.halfLifeShare ?? 0.5}`;
  const whyRent = o.why?.length ? `${usd(o.rentPerMonth)}: ${o.why.map((w) => `${w.label} ${w.pct >= 0 ? '+' : '−'}${Math.abs(Math.round(w.pct * 100))} %`).join(' · ')}` : `${usd(o.rentPerMonth)} a month`;
  const lcAmount = depositAtSign;
  const lw = lcWhy(g, o.lessorId, r.grade, lcAmount);
  return {
    offerId, holding, depositAtSign, transition, techReps, paint, whyRent, reserves, ret,
    ready: plan.expected ?? plan.ready, steps: ind ? inductionSteps({ ...ind, ready: plan.expected ?? ind.ready, findings: undefined }) : [], camo,
    aoc: vq ? vq.text : null, pilots, lcAllowed: !lw, cashAfter: g.company.cash - holding,
    why: loiWhy(g, o, holding), exoticSecurity: sec.deposit, reservesDeposit: sec.reserves, lcWhy: lw, committeeDays: cr,
    lessor: lessorName(o), grade: r.grade,
  };
}

/** Signs the letter of intent: the holding deposit, the offer kept as a snapshot in a LeaseDeal (§F step 1). Our action: quiet. */
export function signLoi(g: GameState, offerId: string, opts: LoiOpts = {}): ActionResult<{ dealId: string }> {
  const i = g.market.aircraft.findIndex((o) => o.id === offerId);
  if (i < 0) return { ok: false, error: 'Offer not found' };
  const o = g.market.aircraft[i];
  if (!usesLoi(g, o)) return { ok: false, error: 'This offer signs directly' };
  const holding = Math.round(D().holdingMonths * o.rentPerMonth);
  const why = loiWhy(g, o, holding);
  if (why) return { ok: false, error: why };
  let reg: string | undefined;
  if (opts.reg !== undefined) {
    const prefix = g.company.regPrefix;
    const up = opts.reg.trim().toUpperCase();
    const chk = checkRegistration(g, up.startsWith(prefix) ? up.slice(prefix.length) : up);
    if (!chk.ok) return { ok: false, error: chk.reason };
    reg = chk.reg;
  }
  const L = g.leasing!;
  const r = rating(g);
  const sec = exoticSecurityOf(g, o);
  g.market.aircraft.splice(i, 1);
  cashOnly(g, -holding);
  const id = nextId(g, 'deal');
  const rr = leasingSide(g, `deal:${id}`);
  const cr = committeeRange(o, r.grade);
  const days = int(rr, cr[0], cr[1]);
  const deal: LeaseDeal = {
    id, offer: structuredClone(o), stage: 'committee', loiAt: g.now, holding,
    autoSign: opts.autoSign ?? true, lc: !!opts.lc, paint: !!opts.paint, techReps: !!opts.techReps,
    gradeAtOffer: o.grade ?? r.grade, committeeAt: g.now + days * DAY,
    ...(reg || opts.name || opts.delivery ? { opts: { ...(reg ? { reg } : {}), ...(opts.name ? { name: opts.name } : {}), ...(opts.delivery ? { delivery: opts.delivery } : {}) } } : {}),
    ...(sec.deposit ? { exoticSecurity: sec.deposit, reservesDeposit: sec.reserves } : {}),
  };
  L.deals.push(deal);
  L.stats.lois++;
  touch(g);
  const t = typeOf(o.typeId);
  pushMessage(g, {
    tone: 'info', cat: 'company', topic: 'market', cue: null, title: `Letter of intent: ${t.short} from ${lessorName(o)}`,
    body: `Holding deposit ${usd(holding)} paid; the aircraft is off the market. ${lessorName(o)}'s credit check answers in about ${days} days (${fmtDay(deal.committeeAt)}).${deal.autoSign ? ' The lease is signed when it passes.' : ''}`,
    ref: { kind: 'deal', id },
  });
  return { ok: true, msg: `Letter of intent signed · credit check by ${fmtDay(deal.committeeAt)}`, data: { dealId: id } };
}

const touch = (g: GameState) => {
  if (g.leasing) g.leasing.rev = (g.leasing.rev ?? 0) + 1;
};

/** The deposit due at the lease signing (the rest after the holding deposit, more security, an exotic's security). Pure. */
export function depositDue(d: LeaseDeal): number {
  return Math.max(0, d.offer.deposit - d.holding) + (d.conditions?.extraDeposit ?? 0) + (d.exoticSecurity ?? 0);
}

/** Cash due at the lease signing: the deposit unless covered by a letter of credit, the reserves deposit, transition, extras. Pure. */
export function cashToSign(g: GameState, d: LeaseDeal): number {
  const dep = d.lc ? 0 : depositDue(d);
  return dep + (d.reservesDeposit ?? 0) + transitionCost(g, d.offer) + (d.techReps ? techRepsCost(d.offer.typeId) : 0) + (d.paint ? paintCost(d.offer.typeId) : 0);
}

/** Signs the lease after approval (§F step 4). */
export function signLease(g: GameState, dealId: string): ActionResult<{ aircraftId: string }> {
  const L = g.leasing;
  const d = L?.deals.find((x) => x.id === dealId);
  if (!L || !d) return { ok: false, error: 'Deal not found' };
  if (d.stage !== 'approved') return { ok: false, error: d.stage === 'committee' ? 'The credit check has not answered yet' : d.stage === 'conditions' ? 'The lessor wants more security first' : 'This deal is closed' };
  const lk = lockOf(g, 'fleet');
  if (lk) return { ok: false, error: lk };
  const o = d.offer;
  const gate = aircraftGate(g, o.typeId);
  if (!gate.ok) return { ok: false, error: `${gate.text}: apply under Company › Ladder` };
  const due = cashToSign(g, d);
  if (g.company.cash < due) return { ok: false, error: `Not enough cash: ${usd(due)} due to sign` };
  const dep = depositDue(d);
  if (d.lc) {
    const lw = lcWhy(g, o.lessorId, rating(g).grade, dep - (L.lc[d.id] ?? 0));
    if (lw) return { ok: false, error: `Letter of credit: ${lw}` };
  }
  const plan = inductionPlan(g, o, { start: g.now, techReps: d.techReps, paint: d.paint });
  let site = o.site ?? g.company.homeBase;
  let handover = plan.ready;
  let where = o.where;
  let fee = 0;
  const block = deliveryQuote(g, o.typeId, site, handover, o.where).blocked;
  if (block) {
    const way = d.opts?.delivery ?? (block.thisSide ? 'thisSide' : 'ferryCo');
    if (way === 'thisSide' && block.thisSide) {
      ({ site, where } = block.thisSide);
      handover += block.thisSide.days * DAY;
      fee = block.thisSide.fee;
    } else {
      site = g.company.homeBase;
      handover = block.ferryCo.homeBy;
      where = `${AIRPORT_BY_CODE[site]?.city ?? site} (${site}), flown in by a ferry company`;
      fee = block.ferryCo.fee;
    }
    if (g.company.cash < due + fee) return { ok: false, error: `Not enough cash: ${usd(due + fee)} due to sign` };
  }
  const induction = plan.induction ? { ...plan.induction, ready: Math.max(plan.induction.ready, handover) } : undefined;
  const cashDep = d.lc ? 0 : dep;
  const res = signOffer(g, { ...o, deposit: d.holding + cashDep }, { site, handover, where, fee, pay: cashDep + (d.reservesDeposit ?? 0), reg: d.opts?.reg, name: d.opts?.name, delivery: d.opts?.delivery, induction });
  if (!res.ok || !res.data) return res;
  const ac = g.fleet[res.data.aircraftId];
  const tc = transitionCost(g, o);
  post(g, 'transition', -tc);
  if (d.techReps) post(g, 'transition', -techRepsCost(o.typeId));
  if (d.paint) post(g, 'paint', -paintCost(o.typeId));
  else ac.livery = 'white';
  if (ac.ownership.kind === 'dryLeaseIn') {
    const own = ac.ownership;
    own.deposit = d.holding + cashDep + (d.reservesDeposit ?? 0);
    if (o.lessorId) own.lessorId = o.lessorId;
    if (o.minFH) {
      own.minFH = o.minFH;
      own.reservesEscAt = own.leaseStart + 12 * MONTH;
    }
    if (o.halfLifeShare !== undefined) own.halfLifeShare = o.halfLifeShare;
    if (d.reservesDeposit) own.reservesDeposit = d.reservesDeposit;
    own.grade = d.gradeAtCommittee ?? d.gradeAtOffer;
    if (d.lc) {
      moveLc(g, d.id, ac.id);
      const more = dep - (L.lc[ac.id] ?? 0);
      if (more > 0) issueLc(g, ac.id, more);
      own.lc = L.lc[ac.id] ?? 0;
    }
  }
  d.stage = 'signed';
  d.signedAt = g.now;
  d.aircraftId = ac.id;
  d.endedAt = g.now;
  L.stats.signed++;
  if (induction) {
    L.stats.inductions++;
    L.stats.inductionDays += Math.round((induction.ready - g.now) / DAY);
    L.stats.camoWaitDays += induction.waitedCamo;
  }
  touch(g);
  const fam = typeOf(o.typeId).family;
  if (needsVariation(g, fam)) {
    const card = variationNeededCard(g, ac.id);
    if (card) postProblem(g, card, { cat: 'company', topic: 'ladder', cue: 'notice' });
  }
  return res;
}

/** More security asked (§F 3b): met in cash at signing or by a letter of credit; then approved. Our action: quiet. */
export function meetConditions(g: GameState, dealId: string, how: 'cash' | 'lc'): ActionResult {
  const d = g.leasing?.deals.find((x) => x.id === dealId);
  if (!d) return { ok: false, error: 'Deal not found' };
  if (d.stage !== 'conditions' || !d.conditions) return { ok: false, error: 'Nothing asked on this deal' };
  if (how === 'lc') {
    const lw = lcWhy(g, d.offer.lessorId, rating(g).grade, depositDue(d));
    if (lw) return { ok: false, error: `Letter of credit: ${lw}` };
    d.lc = true;
  } else if (g.company.cash < cashToSign(g, d)) return { ok: false, error: `Not enough cash: ${usd(cashToSign(g, d))} due to sign` };
  d.conditionsMet = how;
  approve(g, d);
  return { ok: true, msg: `${lessorName(d.offer)}: security agreed` };
}

/** Walks away from a deal: the holding deposit back before approval, lost after (§F). Our action: quiet. */
export function walkAway(g: GameState, dealId: string): ActionResult {
  const d = g.leasing?.deals.find((x) => x.id === dealId);
  if (!d || !isActive(d)) return { ok: false, error: 'Deal not found' };
  const lost = d.stage === 'approved';
  end(g, d, 'walked', lost);
  return { ok: true, msg: lost ? `Walked away: ${usd(d.holding)} holding deposit lost` : `Walked away: ${usd(d.holding)} holding deposit back` };
}

/** Ends a deal: the holding deposit refunded or forfeited (posted as rent), the letter of credit released. */
function end(g: GameState, d: LeaseDeal, stage: 'walked' | 'declined', forfeit: boolean, why?: string): void {
  const L = g.leasing!;
  d.stage = stage;
  d.endedAt = g.now;
  if (why) d.why = why;
  cashOnly(g, d.holding);
  if (forfeit) {
    post(g, 'rent', -d.holding);
    L.stats.forfeited += d.holding;
  }
  releaseLc(g, d.id);
  if (stage === 'walked') L.stats.walked++;
  else L.stats.declined++;
  if (d.offer.lessorId) L.quiet[`${d.offer.lessorId}:${d.offer.typeId}`] = g.now + D().lookAgainDays * DAY;
  touch(g);
}

/** Contract tech reps on a deal before signing (§G.2). Our action: quiet. */
export function addTechReps(g: GameState, id: string): ActionResult {
  const d = g.leasing?.deals.find((x) => x.id === id);
  if (!d) return { ok: false, error: 'Deal not found' };
  if (!isActive(d)) return { ok: false, error: 'This deal is closed' };
  if (d.techReps) return { ok: false, error: 'Tech reps are already booked' };
  d.techReps = true;
  touch(g);
  return { ok: true, msg: `Tech reps booked (${usd(techRepsCost(d.offer.typeId))} at signing)` };
}

/** The In progress rows (§N.1): one per open deal. Pure. */
export function dealsOpen(g: GameState): LeaseDeal[] {
  return (g.leasing?.deals ?? []).filter(isActive);
}

/** Approval: the signing window opens; signed at once when automatic and the cash is there, else the decision card. */
function approve(g: GameState, d: LeaseDeal): void {
  d.stage = 'approved';
  d.signBy = g.now + D().signDays * DAY;
  touch(g);
  if (d.autoSign && g.company.cash >= cashToSign(g, d)) {
    const r = signLease(g, d.id);
    if (r.ok) return;
  }
  const card = leaseSignCard(g, d.id);
  if (card) postProblem(g, card, { cat: 'company', topic: 'market', cue: 'decision' });
}

/** Daily: committee answers, the 7-day windows lapsing (§F). */
export function dailyDeals(g: GameState): void {
  const L = g.leasing;
  if (!L) return;
  for (const d of L.deals) {
    if (d.stage === 'committee' && d.committeeAt <= g.now) committee(g, d);
    else if (d.stage === 'conditions' && d.conditions && d.conditions.until <= g.now) {
      end(g, d, 'walked', false, 'No answer to the security asked');
      pushMessage(g, { tone: 'info', cat: 'company', topic: 'market', title: `Deal lapsed: ${typeOf(d.offer.typeId).short} from ${lessorName(d.offer)}`, body: `No answer to the security asked within ${D().decideDays} days. The ${usd(d.holding)} holding deposit is back.`, ref: { kind: 'deal', id: d.id } });
    } else if (d.stage === 'approved' && (d.signBy ?? Infinity) <= g.now) {
      // The default at expiry: sign when the cash is there, else walk away (the holding deposit is lost).
      if (signLease(g, d.id).ok) continue;
      end(g, d, 'walked', true, 'Not signed in time');
      pushMessage(g, { tone: 'warn', cat: 'company', topic: 'market', title: `Holding deposit forfeited (${lessorName(d.offer)})`, body: `The ${typeOf(d.offer.typeId).short} lease was not signed by ${fmtDay(d.signBy!)}. ${lessorName(d.offer)} keeps the ${usd(d.holding)} holding deposit.`, ref: { kind: 'deal', id: d.id } });
    }
  }
  // Closed deals leave the list after 60 days.
  L.deals = L.deals.filter((d) => isActive(d) || (d.endedAt ?? g.now) > g.now - 60 * DAY);
}

/** The credit committee's answer (§F step 3). */
function committee(g: GameState, d: LeaseDeal): void {
  const r = rating(g);
  d.gradeAtCommittee = r.grade;
  const t = typeOf(d.offer.typeId);
  const who = lessorName(d.offer);
  const drop = RANK[r.grade] - RANK[d.gradeAtOffer];
  const rr = leasingSide(g, `deal:${d.id}:committee`);
  const condRoll = range(rr, 0, 1);
  if (restructuring(g) || drop >= 2) {
    end(g, d, 'declined', false, restructuring(g) ? 'Restructuring' : `Rating fell from ${d.gradeAtOffer} to ${r.grade}`);
    pushMessage(g, {
      tone: 'info', cat: 'company', topic: 'market', title: `${who} declined the ${t.short}`,
      body: `${restructuring(g) ? "Not while we're in restructuring." : `Our lessor rating fell from ${d.gradeAtOffer} to ${r.grade} since the letter of intent.`} No harm: the ${usd(d.holding)} holding deposit is back. Lessors look again after ${D().lookAgainDays} days.`,
      ref: { kind: 'deal', id: d.id },
    });
    return;
  }
  if (drop === 1 || (r.grade === 'C' && condRoll < D().condC && !gradeAtLeast(d.gradeAtOffer, 'B'))) {
    d.stage = 'conditions';
    // A grade lower: two more months (or a letter of credit); the 15 % at C: one more month.
    d.conditions = { extraDeposit: Math.round((drop === 1 ? D().condMonths : 1) * d.offer.rentPerMonth), until: g.now + D().decideDays * DAY };
    g.leasing!.stats.conditions++;
    touch(g);
    const card = leaseConditionsCard(g, d.id);
    if (card) postProblem(g, card, { cat: 'company', topic: 'market', cue: 'decision' });
    return;
  }
  approve(g, d);
}

/** The cash forecast's leasing lines (§K.3): deposits and transition costs to sign. Pure. */
export function leasingForecastItems(g: GameState, days: number): ForecastItem[] {
  const out: ForecastItem[] = [];
  const until = g.now + days * DAY;
  for (const d of g.leasing?.deals ?? []) {
    if (!isActive(d)) continue;
    const at = d.stage === 'committee' ? d.committeeAt : d.stage === 'conditions' ? d.conditions?.until ?? g.now : g.now + DAY;
    if (at > until) continue;
    const t = typeOf(d.offer.typeId);
    const dep = d.lc ? 0 : depositDue(d);
    if (dep + (d.reservesDeposit ?? 0)) out.push({ t: at, amount: -(dep + (d.reservesDeposit ?? 0)), what: `deposit to sign the ${t.short} lease (${lessorName(d.offer)})` });
    const tc = transitionCost(g, d.offer) + (d.techReps ? techRepsCost(d.offer.typeId) : 0) + (d.paint ? paintCost(d.offer.typeId) : 0);
    out.push({ t: at, amount: -tc, what: `transition of the ${t.short}${d.paint ? ' with paint' : ''}` });
  }
  return out;
}

/** Deals that need our answer (the cards): more security asked, or approved and waiting for us to sign. Pure. */
export function dealsWaiting(g: GameState): LeaseDeal[] {
  return (g.leasing?.deals ?? []).filter((d) => d.stage === 'conditions' || (d.stage === 'approved' && d.signBy !== undefined));
}

export { needsVariation };
