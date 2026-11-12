// v0.17 the bot's fleet planning on the aircraft market (UPDATE-0.17.md §O; lane `market-ui`): requests to lessors for
// narrowbody growth and the widebody, short-term aircraft in the summer, tech reps, the answers to the lessors' credit
// committees, and the `--greedy` probe of the caps. Only with BAL.v017.on (the v0.16 market: acmi-bot.ts as before).
//
// 1. Narrowbody growth (narrowGrowth's test: committed 75 %, 60 % from day 150; a third narrowbody at most): a request
//    for the fleet's main type, mid-life (old at D), 36 months, from the next season start (1 Feb or 1 Jun) when that
//    is 90+ days away, else as soon as possible. The cheapest rent + reserves at 250 FH a month among the offers ready
//    by the target + 30 days is signed by letter of intent (automatic signing); a lessor call that beats the proposals
//    is taken instead. acmi-bot.ts narrowGrowth stands down while the v0.17 market is on.
// 2. Widebody: with Widebody operations held or filed and no widebody yet, a request for the wide family's type (old,
//    48 months) from the grant − 15 days, so fleet() finds proposals; fleet() still signs only with the job in hand.
// 3. Short-term, May–September: 90 %+ committed over 60 days and a 60-day+ narrowbody base or series on offer: ask the
//    airlines for 5 months; sign one handed over near home.
// 4. Tech reps when a transition waits 21+ days for the CAMO and work is booked on the aircraft.
// 5. More security: paid when the cash is the extra + $1M, else a letter of credit, else walk away. A lease approved
//    but not signed (cash short): signed when the cash is there with $300K over.
// 6. --newfam: a 737 variation in month 8 (§H). --greedy: every 30 days a request for each widebody type the gate
//    allows (as soon as possible and 6 months out) and every widebody proposal signed it can afford (cash ≥ deposit +
//    $500K), with no job: it measures the caps.
// Decisions read only the game state (no module state), so a reloaded save plays on identically; the module keeps a
// tally for the report (report017.ts).

import { BAL } from '../../src/engine/core/balance';
import { typeOf } from '../../src/engine/core/perf';
import { DAY, fromUTC, toDate } from '../../src/engine/core/time';
import type { AgeBand, AircraftOffer, GameState, Minute } from '../../src/engine/core/types';
import {
  addTechRepsToInduction, applyVariation, askSpot, cashToSign, depositDue, inductionPlan, lcWhy, loiQuote, meetConditions, rating, rfpPreview, sendRfp, signLease, signLoi, usesLoi, walkAway, type RfpDraft,
} from '../../src/engine/leasing';
import { acquireAircraft, aircraftGate, groundGaps, ratedPilots } from '../../src/engine/ops';
import { isWideJob } from '../../src/engine/contracts/pricing';

export interface BotMarketOpts {
  /** --greedy: every 30 days a request for every widebody type the gate allows; signs every proposal it can afford. */
  greedy: boolean;
  /** --newfam: a 737-800 variation in month 8 (tests §H). */
  newfam: boolean;
  /** Player bot round (--player): narrowbodies grown to at most this many (the player's first year: 2 → 6); default 3. */
  maxNarrow?: number;
  /** Player bot round: the committed share (next 60 days) that asks for another narrowbody (default 0.75, 0.6 from day 150). */
  growAt?: number;
}

/** The report's tally (report017.ts): grades by quarter, growth needs and when they were met, greedy and exotic counts. */
export const MARKET_TALLY = {
  grades: [] as string[],
  /** Day the narrowbody growth need first held (cleared once an aircraft is signed for it). */
  needAt: null as number | null,
  /** Per growth aircraft: the need's day and the offer / deal / aircraft it became. */
  growth: [] as { needAt: number; offerId: string; signedAt: number; dealId?: string; aircraftId?: string }[],
  exotic: { rfps: 0, signed: 0 },
  greedy: { rfps: 0, lois: 0 },
  /**
   * Balance step: every aircraft that joined after day 0, by id: type, source, the day it was asked for (the request
   * sent, or the call posted), the letter of intent or signing day, the day in service (home from the ferry).
   */
  acq: {} as Record<string, { typeId: string; src: string; askedAt?: number; signedAt?: number; svcAt?: number }>,
  /** Balance step: per deal, the day its request was sent (or its call posted) and the letter of intent. */
  dealAsk: {} as Record<string, { askedAt?: number; loiAt: number }>,
};

const dayOf = (g: GameState, t: Minute) => Math.floor((t - g.started) / DAY);

/** Balance step: tracks every aircraft that joins (both markets), for the report's acquisitions line. */
export function trackFleet(g: GameState): void {
  for (const ac of Object.values(g.fleet)) {
    if (!ac.delivery && ac.deliveredAt <= g.started + DAY) continue;
    let x = MARKET_TALLY.acq[ac.id];
    if (!x) {
      const deal = g.leasing?.deals.find((d) => d.aircraftId === ac.id);
      const da = deal ? MARKET_TALLY.dealAsk[deal.id] : undefined;
      const o = ac.ownership;
      const src = deal ? (deal.offer.source ?? 'loi') : o.kind === 'owned' ? 'buy' : o.spot ? 'spot' : o.lessorId ? 'call' : 'legacy';
      x = MARKET_TALLY.acq[ac.id] = { typeId: ac.typeId, src, signedAt: da?.loiAt ?? dayN(g), ...(da?.askedAt !== undefined ? { askedAt: da.askedAt } : {}) };
    }
    if (x.svcAt === undefined && ac.status !== 'delivering' && (!ac.delivery || ac.delivery.arrived !== undefined)) x.svcAt = ac.delivery?.arrived !== undefined ? dayOf(g, ac.delivery.arrived) : dayN(g);
  }
}

const dayN = (g: GameState) => Math.floor((g.now - g.started) / DAY);
const NOSIGN = process.argv.includes('--nosign');
const ACTIVE = new Set(['committee', 'conditions', 'approved']);
const activeDeals = (g: GameState) => (g.leasing?.deals ?? []).filter((d) => ACTIVE.has(d.stage));
const wide = (typeId: string) => typeOf(typeId).body === 'wide';

/** Next `days`: the share of narrowbody aircraft-time already committed (as acmi-bot.ts committed()). */
function committed(g: GameState, days: number): number {
  const nb = Object.values(g.fleet).filter((a) => !wide(a.typeId) && a.status !== 'delivering' && !a.returning);
  if (!nb.length) return 0;
  let idle = 0;
  for (const ac of nb) for (const gp of groundGaps(g, ac, g.now, g.now + days * DAY)) if (gp.to - gp.from >= DAY) idle += gp.to - gp.from;
  return 1 - idle / (nb.length * days * DAY);
}

/** The fleet's main narrowbody type. */
function mainNarrow(g: GameState): string {
  const n: Record<string, number> = {};
  for (const a of Object.values(g.fleet)) if (!wide(a.typeId)) n[a.typeId] = (n[a.typeId] ?? 0) + 1;
  return Object.entries(n).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0] ?? 'a320ceo';
}

/** The next season start (1 Feb or 1 Jun) after now. */
function nextSeason(g: GameState): Minute {
  const y = toDate(g.now).getUTCFullYear();
  return [fromUTC(y, 2, 1), fromUTC(y, 6, 1), fromUTC(y + 1, 2, 1), fromUTC(y + 1, 6, 1)].find((t) => t > g.now)!;
}

/** When an offer is ready (in service at its site): after the letter of intent's credit check and the transition. */
function readyOf(g: GameState, o: AircraftOffer): Minute {
  if (usesLoi(g, o)) return loiQuote(g, o.id)?.ready ?? g.now + o.leadDays * DAY;
  return o.source ? inductionPlan(g, o).ready : g.now + o.leadDays * DAY;
}

/** Signs an offer the way it goes: a letter of intent (automatic signing) or at once. */
function sign(g: GameState, o: AircraftOffer): { ok: boolean; dealId?: string; aircraftId?: string } {
  const rfp = o.rfpId ? g.leasing?.rfps.find((x) => x.id === o.rfpId) : undefined;
  const askedAt = rfp ? dayOf(g, rfp.sent) : o.created !== undefined ? dayOf(g, o.created) : undefined;
  if (usesLoi(g, o)) {
    const r = signLoi(g, o.id, { autoSign: true });
    if (r.ok) MARKET_TALLY.dealAsk[r.data!.dealId] = { loiAt: dayN(g), ...(askedAt !== undefined ? { askedAt } : {}) };
    return r.ok ? { ok: true, dealId: r.data!.dealId } : { ok: false };
  }
  const r = acquireAircraft(g, o.id);
  if (r.ok) MARKET_TALLY.acq[r.data!.aircraftId] = { typeId: o.typeId, src: o.source ?? 'legacy', signedAt: dayN(g), ...(askedAt !== undefined ? { askedAt } : {}) };
  return r.ok ? { ok: true, aircraftId: r.data!.aircraftId } : { ok: false };
}

const lastRfp = (g: GameState, pred: (typeId: string) => boolean) => Math.max(-Infinity, ...(g.leasing?.rfps ?? []).filter((r) => !r.spot && pred(r.typeId)).map((r) => r.sent));
const openRfp = (g: GameState, pred: (typeId: string) => boolean) => (g.leasing?.rfps ?? []).some((r) => r.status === 'open' && !r.spot && pred(r.typeId));

/** Sends a request, trying the next age band when no lessor will consider us for the first. */
function ask(g: GameState, d: RfpDraft, bands: AgeBand[]): boolean {
  for (const band of bands) {
    const dr = { ...d, band };
    if (rfpPreview(g, dr).blocked) continue;
    if (sendRfp(g, dr).ok) return true;
  }
  return false;
}

/** 5. The lessors' committees: more security, or a lease approved and waiting for us. */
function answerDeals(g: GameState): boolean {
  let acted = false;
  for (const d of activeDeals(g)) {
    if (d.stage === 'conditions' && d.conditions) {
      if (g.company.cash >= d.conditions.extraDeposit + 1_000_000 && meetConditions(g, d.id, 'cash').ok) acted = true;
      else if (!lcWhy(g, d.offer.lessorId, rating(g).grade, depositDue(d)) && meetConditions(g, d.id, 'lc').ok) acted = true;
      else if (walkAway(g, d.id).ok) acted = true;
    } else if (d.stage === 'approved' && g.company.cash >= cashToSign(g, d) + 300_000) {
      if (signLease(g, d.id).ok) acted = true;
    }
  }
  return acted;
}

/** Links signed growth deals to their aircraft (for narrowNeedToService). */
function trackGrowth(g: GameState): void {
  for (const x of MARKET_TALLY.growth) {
    if (x.aircraftId || !x.dealId) continue;
    const d = g.leasing?.deals.find((y) => y.id === x.dealId);
    if (d?.aircraftId) x.aircraftId = d.aircraftId;
  }
}

/** 1. Narrowbody growth through requests and letters of intent. */
function narrowGrowth(g: GameState, maxNarrow = 3, growAt?: number): boolean {
  if (dayN(g) < 75 || Object.values(g.fleet).some((a) => a.status === 'delivering')) return false;
  const narrows = Object.values(g.fleet).filter((a) => !wide(a.typeId)).length + activeDeals(g).filter((d) => !wide(d.offer.typeId)).length;
  if (narrows >= maxNarrow) {
    MARKET_TALLY.needAt = null;
    return false;
  }
  if (committed(g, 60) < (growAt ?? (dayN(g) >= 150 ? 0.6 : 0.75))) return false;
  const need = (MARKET_TALLY.needAt ??= dayN(g));
  const main = mainNarrow(g);
  const fam = typeOf(main).family;
  const season = nextSeason(g);
  // Balance step: with the season under 90 days away, the date 50 days out rather than "as soon as possible" (the
  // 45–120-day window has 0.9 of the chance, as soon as possible 0.5 and stored aircraft only).
  // The need is the next 60 days' flying: a season start 5 months or more away is not the target (from 1 June the next
  // one is February, and a June need took an aircraft ready in January).
  const target = season - g.now >= 90 * DAY && season - g.now <= 150 * DAY ? season : g.now + 50 * DAY;
  // The offers: proposals and calls of our family, leases, not new builds, ready by the target + 30 days.
  const cands = g.market.aircraft
    .filter((o) => o.kind === 'dryLeaseIn' && !o.newBuild && !o.spot && o.expires > g.now && !wide(o.typeId) && typeOf(o.typeId).family === fam && aircraftGate(g, o.typeId).ok)
    .map((o) => ({ o, ready: readyOf(g, o), cost: o.rentPerMonth + 250 * o.reservesPerFH }))
    // Balance step: ready within 4 months, or a month after a later target (a "later" proposal 5–6 months out loses to
    // asking again in a month: the mid-life lessors answer about 3 times in 4).
    .filter((x) => x.ready <= Math.max(target, g.now + 90 * DAY) + 30 * DAY)
    // Balance step: a day late past the target costs about $10K of lost flying (36 months of rent + reserves against it).
    .map((x) => ({ ...x, score: 36 * x.cost + 10_000 * Math.max(0, (x.ready - Math.max(target, g.now + 60 * DAY)) / DAY) }))
    .sort((a, b) => a.score - b.score || (a.o.id < b.o.id ? -1 : 1));
  const asking = openRfp(g, (id) => !wide(id));
  // While our request is out, wait for its answers unless an offer is about to lapse.
  const best = cands.find((x) => !asking || (x.o.validUntil ?? x.o.expires) - g.now <= 2 * DAY);
  if (best) {
    const o = best.o;
    const holding = usesLoi(g, o) ? Math.round(BAL.v017.deal.holdingMonths * o.rentPerMonth) : o.deposit + (o.transition ?? 0);
    if (g.company.cash >= holding + 1_000_000) {
      const r = sign(g, o);
      if (r.ok) {
        MARKET_TALLY.growth.push({ needAt: need, offerId: o.id, signedAt: dayN(g), ...(r.dealId ? { dealId: r.dealId } : {}), ...(r.aircraftId ? { aircraftId: r.aircraftId } : {}) });
        MARKET_TALLY.needAt = null;
        return true;
      }
    }
  }
  if (asking || g.now - lastRfp(g, (id) => !wide(id)) < 14 * DAY) return false;
  const grade = rating(g).grade;
  return ask(g, { typeId: main, band: 'mid', months: 36, count: 1, from: target, flex: true }, grade === 'D' ? ['old', 'mid'] : ['mid', 'old']);
}

/** The widebody family to ask for: the one with widebody pilots (rated or converting), else the A330. */
function wideType(g: GameState): string {
  const a = ratedPilots(g, ['A330/340'], { booked: true });
  const b = ratedPilots(g, ['B757/767'], { booked: true });
  return b.CPT + b.FO > a.CPT + a.FO ? 'b763' : 'a332';
}

/** 2. The first widebody: a request ahead of the grant, so fleet() finds proposals with the job. */
function widebody(g: GameState): boolean {
  if (Object.values(g.fleet).some((a) => wide(a.typeId)) || activeDeals(g).some((d) => wide(d.offer.typeId))) return false;
  const co = g.company;
  const pend = co.pendingApprovals.find((p) => p.id === 'widebody');
  if (!co.approvals.includes('widebody') && !pend) return false;
  if (openRfp(g, wide) || g.now - lastRfp(g, wide) < 45 * DAY || co.cash < 1_500_000) return false;
  const typeId = wideType(g);
  if (!aircraftGate(g, typeId).ok) return false;
  const from = pend && pend.done - 15 * DAY > g.now + 45 * DAY ? pend.done - 15 * DAY : null;
  return ask(g, { typeId, band: 'old', months: 48, count: 1, from, flex: true }, ['old', 'mid']);
}

/** Short-term handovers near home (the European airlines' bases): no long ferry for a few months' use. */
const NEAR_SPOT = ['FRA', 'AMS', 'PRG', 'WAW', 'AYT'];

/** 3. Short-term in the summer: 90 %+ committed and a long narrowbody series on offer. */
function shortTerm(g: GameState): boolean {
  const mo = toDate(g.now).getUTCMonth();
  if (mo < 4 || mo > 8) return false;
  if (Object.values(g.fleet).some((a) => a.ownership.kind === 'dryLeaseIn' && !!a.ownership.spot)) return false;
  const fam = typeOf(mainNarrow(g)).family;
  // A short-term offer in hand: signed when handed over near home and the cash is there.
  for (const o of g.market.aircraft) {
    if (o.source !== 'spot' || o.expires <= g.now || typeOf(o.typeId).family !== fam || !o.spot) continue;
    if (g.company.cash < o.deposit + (o.transition ?? 0) + 1_000_000) continue;
    if (o.spot.base !== g.company.homeBase && !NEAR_SPOT.includes(o.spot.base)) continue;
    if (acquireAircraft(g, o.id).ok) return true;
  }
  if ((g.leasing?.rfps ?? []).some((r) => r.spot && (r.status === 'open' || r.sent > g.now - 90 * DAY))) return false;
  if (committed(g, 60) < 0.9) return false;
  const series = Object.values(g.offers).some((x) => x.status === 'open' && x.end - x.start >= 60 * DAY && x.start > g.now + 14 * DAY && (x.pattern.kind === 'base' || x.archetype === 'tourSeries') && !isWideJob(x.requirements));
  if (!series) return false;
  return askSpot(g, { family: fam, months: 5, from: g.now }).ok;
}

/** 4. Tech reps on a transition waiting 21+ days for the CAMO with work booked on the aircraft. */
function techReps(g: GameState): boolean {
  let acted = false;
  for (const ac of Object.values(g.fleet)) {
    const i = ac.induction;
    if (ac.status !== 'delivering' || !i || i.techReps || i.waitedCamo < 21 || i.slot <= g.now) continue;
    if (!Object.values(g.flights).some((f) => f.aircraftId === ac.id && f.contractId && f.status === 'scheduled')) continue;
    if (g.company.cash > 1_000_000 && addTechRepsToInduction(g, ac.id).ok) acted = true;
  }
  return acted;
}

/** --greedy: requests for every widebody type the gate allows; every widebody proposal it can afford, signed. */
function greedy(g: GameState): boolean {
  let acted = false;
  for (const o of [...g.market.aircraft]) {
    if (o.source !== 'proposal' || !wide(o.typeId) || o.expires <= g.now) continue;
    if (g.company.cash < o.deposit + 500_000) continue;
    if (sign(g, o).ok) {
      acted = true;
      MARKET_TALLY.greedy.lois++;
      if (BAL.v017.exotic.types.includes(o.typeId)) MARKET_TALLY.exotic.signed++;
    }
  }
  if (dayN(g) % 30 !== 0) return acted;
  const types = Object.keys(BAL.v017.supply.base).filter((id) => wide(id) && aircraftGate(g, id).ok);
  for (const typeId of types) {
    for (const from of [null, g.now + 182 * DAY]) {
      const r = sendRfp(g, { typeId, band: 'mid', months: 60, count: 1, from, flex: true });
      const r2 = r.ok ? r : sendRfp(g, { typeId, band: 'old', months: 48, count: 1, from, flex: true });
      if (r2.ok) {
        acted = true;
        MARKET_TALLY.greedy.rfps++;
        if (BAL.v017.exotic.types.includes(typeId)) MARKET_TALLY.exotic.rfps++;
      }
    }
  }
  return acted;
}

/** Once a day from acmi-bot.ts policy(). True when it acted (the caller re-plans). */
export function botMarket(g: GameState, opts: BotMarketOpts): boolean {
  trackFleet(g);
  if (!BAL.v017.on || !g.leasing) return false;
  // The grade each quarter, for the report.
  if (dayN(g) > 0 && dayN(g) % 91 === 0 && MARKET_TALLY.grades.length < Math.floor(dayN(g) / 91)) MARKET_TALLY.grades.push(rating(g).grade);
  trackGrowth(g);
  let acted = answerDeals(g);
  if (opts.newfam && dayN(g) >= 210 && !(g.company.aocVariations ?? []).some((v) => v.family === 'B737') && !(g.company.aocFamilies ?? []).includes('B737') && g.company.cash > 500_000) {
    if (applyVariation(g, 'B737', 'b738').ok) acted = true;
  }
  if (!NOSIGN) {
    if (narrowGrowth(g, opts.maxNarrow, opts.growAt)) acted = true;
    if (widebody(g)) acted = true;
    if (shortTerm(g)) acted = true;
    if (opts.greedy && greedy(g)) acted = true;
  }
  if (techReps(g)) acted = true;
  return acted;
}
