// v0.14 tender season (Update 2 "Commercial"). From November to February European leisure and low-cost airlines
// issue RFPs for summer ACMI capacity; operators answer with a rate per block hour, an MGH, the tail, the crew and
// the dates; the airline short-lists and awards weeks later. A small winter round (June–August) covers winter-sun,
// Gulf and North African capacity. Each RFP is the season-base offer builder's own job (base, destinations, waves,
// seats, the client's budget rate and MGH), kept off the market; a won tender goes back on it with our terms and is
// signed on the tail we bid. Rivals bid too. RFPs and results come on the event director's busy days.

import { AIRPORT_BY_CODE } from '../../data/airports';
import { countryName } from '../../data/countries';
import { TENDER_ISSUERS } from '../../data/fairs';
import { BAL } from '../core/balance';
import { nextId } from '../core/entities';
import { pushMessage } from '../core/messages';
import { complement, typeOf } from '../core/perf';
import { schedule } from '../core/queue';
import { chance, int, range, weightedPick } from '../core/rng';
import { DAY, fmtDay, fromUTC, toDate } from '../core/time';
import { clamp } from '../core/util';
import type { ActionResult, ContractOffer, GameState, Minute, Rival } from '../core/types';
import { acceptOffer } from '../contracts/accept';
import { feasibility, type CheckLevel } from '../contracts/feasibility';
import { generateOffer } from '../contracts/offers';
import { productValue } from '../contracts/pricing';
import { bumpClient, levelOf } from '../contracts/relations';
import { isActive, rivalFits } from '../contracts/rivals';
import { busyShare } from '../ops/director';
import { busyNow, clientByName, com, comStats, paceOf, sideOf, withStream } from './state';
import type { RivalTenderBid, Tender, TenderBid } from './types';

/** v0.14 the tender rounds and the award model (kept here, not in balance.ts). */
export const TENDER = {
  /** Summer: issued Nov–Feb (UTC months 10, 11, 0, 1), flying from April to June for 4–6 months. */
  summer: { months: [10, 11, 0, 1], count: { calm: 5, normal: 7, busy: 9 }, starts: [[4, 1], [4, 15], [5, 1], [5, 15], [6, 1]] as [number, number][], days: [120, 185] as [number, number] },
  /** Winter: issued Jun–Aug, flying from mid-October for 3–5 months. */
  winter: { months: [5, 6, 7], count: { calm: 2, normal: 3, busy: 4 }, starts: [[10, 15], [11, 1], [12, 1]] as [number, number][], days: [90, 150] as [number, number] },
  /** Days from issue to the bid deadline, and from the deadline to the award. */
  deadline: [14, 21] as [number, number],
  decide: [14, 35] as [number, number],
  /** How far our dates may move from the asked window (days): start earlier/later, end earlier/later. */
  startShift: [-14, 21] as [number, number],
  endShift: [-30, 14] as [number, number],
  /** Rivals per RFP (an invitation: at most one). */
  rivals: [2, 4] as [number, number],
  /** Award weights. */
  w: { base: 0.55, rate: 1.2, mgh: 0.25, rel: 0.8, age: 0.006, ageFrom: 8, fam: 0.06, crew: 0.03, crewOff: 0.02, cover: 0.3, noise: 0.03 },
  level: { unhappy: -0.1, new: 0, known: 0.02, trusted: 0.05, partner: 0.08 } as Record<string, number>,
  standing: [-0.04, 0, 0.02],
  /** A won tender left unsigned (no aircraft) lapses after this many days; relation lost. */
  signDays: 7,
  lapseRelation: -10,
};

const city = (code: string) => AIRPORT_BY_CODE[code]?.city ?? code;
const r10 = (v: number) => Math.round(v / 10) * 10;
const yearsOld = (g: GameState, built: number) => Math.max(0, toDate(g.now).getUTCFullYear() - built);

// ---------- rounds ----------

export interface TenderRound {
  key: string;
  kind: 'summer' | 'winter';
  /** Calendar year the flying starts in. */
  year: number;
  /** Issue window end (exclusive). */
  until: Minute;
}

/** The round whose RFPs are issued now (null outside Nov–Feb and Jun–Aug). Pure. */
export function roundAt(t: Minute): TenderRound | null {
  const d = toDate(t);
  const mo = d.getUTCMonth();
  const y = d.getUTCFullYear();
  if (TENDER.summer.months.includes(mo)) {
    const year = mo >= 10 ? y + 1 : y;
    return { key: `S${year}`, kind: 'summer', year, until: fromUTC(year, 3, 1) };
  }
  if (TENDER.winter.months.includes(mo)) return { key: `W${y}`, kind: 'winter', year: y, until: fromUTC(y, 9, 1) };
  return null;
}

/** The season's name for a round ('summer 2028', 'winter 2027/28'). Pure. */
export const roundName = (key: string): string => (key.startsWith('S') ? `summer ${key.slice(1)}` : `winter ${key.slice(1)}/${String((Number(key.slice(1)) + 1) % 100).padStart(2, '0')}`);

// ---------- issuing ----------

/** The client's ask as an offer (a clone; never on the market). Pure. */
export const askOf = (t: Tender): ContractOffer => t.ask;

/** Rival bids for an RFP (2–4 whose fleet fits; an invitation 0–1), priced by their style. */
function rivalBids(g: GameState, o: ContractOffer, n: number, key: string): RivalTenderBid[] {
  const r = sideOf(g, `tr:${key}`);
  const pool = g.rivals.filter((x) => isActive(x) && rivalFits(x, o));
  const out: RivalTenderBid[] = [];
  for (let i = 0; i < n && pool.length; i++) {
    const x = weightedPick(r, pool, (v) => (v.personality === 'big' ? 1.5 : v.personality === 'military' ? 0.3 : 1))!;
    pool.splice(pool.indexOf(x), 1);
    const [lo, hi] = x.personality === 'cheap' ? [0.93, 0.99] : x.personality === 'big' ? [0.96, 1.02] : x.personality === 'premium' ? [1.02, 1.08] : x.personality === 'steady' ? [0.98, 1.04] : [1.0, 1.08];
    out.push({
      rivalId: x.id, rateX: Math.round(range(r, lo, hi) * 1000) / 1000, mghX: Math.round(range(r, 0.95, 1.05) * 100) / 100,
      quality: Math.round((0.85 + 0.12 * x.quality) * 1000) / 1000, age: int(r, x.personality === 'cheap' ? 12 : 6, x.personality === 'premium' ? 14 : 20),
    });
  }
  return out;
}

/**
 * Issues one RFP now (dev, an invitation, the daily roll): the issuer (weighted, or the client given), its season-base
 * ask built on a borrowed stream, rivals, deadline and award date. Null when no ask could be built.
 */
export function issueTender(g: GameState, opts: { clientId?: string; invited?: boolean; round?: TenderRound } = {}): Tender | null {
  const c = com(g);
  const round = opts.round ?? roundAt(g.now) ?? nextRoundOf(g.now);
  const spec = TENDER[round.kind];
  const key = `${round.key}:${(c.rounds?.[round.key] ?? 0)}:${c.tenders.length}:${opts.clientId ?? ''}`;
  const r = sideOf(g, `tn:${key}`);
  // Never two open RFPs from one client.
  const busy = new Set(c.tenders.filter((t) => t.status === 'open').map((t) => t.clientId));
  const issuers = TENDER_ISSUERS.filter((x) => round.kind === 'summer' || x.winter);
  for (let tries = 0; tries < 4; tries++) {
    const pickd = opts.clientId ? null : weightedPick(r, issuers, (x) => x.w);
    const client = opts.clientId ? g.clients[opts.clientId] : pickd ? clientByName(g, pickd.name) : undefined;
    if (!client || busy.has(client.id) || !AIRPORT_BY_CODE[client.base]) {
      if (opts.clientId) return null;
      continue;
    }
    const meta = TENDER_ISSUERS.find((x) => x.name === client.name);
    const [m, d] = spec.starts[int(r, 0, spec.starts.length - 1)];
    const start = fromUTC(round.year, m, d);
    const days = int(r, spec.days[0], spec.days[1]);
    const o = withStream(g, `ask:${key}:${tries}`, () => generateOffer(g, 'seasonBase', { client: client.id, wide: false, window: false, start, days, paint: false, cabin: false }), true);
    if (!o) continue;
    // Off the market: the ask lives in the tender (its queued expiry and any rival bid find nothing).
    delete g.offers[o.id];
    delete o.rivalBid;
    delete o.requirements.families;
    // Summer leisure and low-cost flying: any everyday cabin (all-economy or two-class) with the seats.
    delete o.requirements.layout;
    o.requirements.layouts = ['all-economy', 'two-class'];
    o.blurb = o.blurb.replace(', two-class cabin', '');
    o.status = 'declined';
    const invited = !!opts.invited;
    const n = invited ? int(r, 0, 1) : int(r, TENDER.rivals[0], TENDER.rivals[1]);
    const deadline = g.now + int(r, TENDER.deadline[0], TENDER.deadline[1]) * DAY;
    const t: Tender = {
      id: nextId(g, 'tn'), round: round.key, clientId: client.id, ask: o, issued: g.now, deadline,
      resultAt: deadline + int(r, TENDER.decide[0], TENDER.decide[1]) * DAY,
      ...(invited ? { invited } : {}), ...(meta?.fam ? { family: meta.fam } : {}), ...(meta?.mixed ? { mixedPref: true } : {}),
      rivals: rivalBids(g, o, n, key), status: 'open',
    };
    c.tenders.push(t);
    (c.rounds ??= {})[round.key] = (c.rounds[round.key] ?? 0) + 1;
    pushMessage(g, {
      tone: 'info', cat: 'commercial', title: `${invited ? 'Invitation to tender' : 'Tender'}: ${client.name}, ${roundName(round.key)}`,
      body: `${client.name} wants ${aircraftWanted(t)} based at ${city(o.pattern.kind === 'base' ? o.pattern.base : client.base)} from ${fmtDay(o.start)} to ${fmtDay(o.end - 1)}. Bids close ${fmtDay(deadline)} (00:00 UTC).`,
      ref: { kind: 'tender', id: t.id }, cue: 'offerNew',
    });
    return t;
  }
  return null;
}

/** The next round's window (dev helper outside the seasons): the coming summer round. */
function nextRoundOf(t: Minute): TenderRound {
  const y = toDate(t).getUTCFullYear();
  const mo = toDate(t).getUTCMonth();
  const year = mo >= 2 ? y + 1 : y;
  return { key: `S${year}`, kind: 'summer', year, until: fromUTC(year, 3, 1) };
}

/** 'an A320-family aircraft (180 seats)' from the ask. Pure. */
export function aircraftWanted(t: Tender): string {
  const req = t.ask.requirements;
  const fam = t.family === 'B737' ? 'a 737' : t.family === 'A320' ? 'an A320' : 'an A320 or 737';
  return `${fam}-size aircraft (${req.minSeats}+ seats)`;
}

/** Daily: issue the round's RFPs on busy days (spread over the window), close deadlines, award results. */
export function dailyTenders(g: GameState): void {
  const c = com(g);
  for (const t of c.tenders) {
    if (t.status === 'open' && g.now >= t.deadline) t.status = t.bid ? 'closed' : 'noBid';
    if (t.status === 'closed' && g.now >= t.resultAt && (busyNow(g) || g.now >= t.resultAt + 4 * DAY)) decideTender(g, t);
  }
  lapseWon(g);
  // Results and lapsed RFPs older than 400 days are pruned.
  if (c.tenders.length > 60) c.tenders = c.tenders.filter((t) => t.status === 'open' || t.status === 'closed' || g.now - t.issued < 400 * DAY);
  if (g.gameOver || g.now - g.started < 7 * DAY) return;
  const round = roundAt(g.now);
  if (!round || !busyNow(g)) return;
  const want = TENDER[round.kind].count[paceOf(g)];
  const have = c.rounds?.[round.key] ?? 0;
  if (have >= want) return;
  // Spread what is left over the busy days left in the window.
  const daysLeft = Math.max(1, (round.until - g.now) / DAY);
  const p = clamp((want - have) / Math.max(1, daysLeft * busyShare(paceOf(g))), 0.05, 1);
  if (chance(sideOf(g, `issue:${round.key}:${Math.floor(g.now / DAY)}`), p)) issueTender(g, { round });
}

// ---------- bidding ----------

export interface BidAircraft {
  id: string;
  reg: string;
  type: string;
  age: number;
  family: string;
  level: CheckLevel;
  /** The first blocker or warning ('Busy 3 May–20 Jun with Condor'). */
  note: string;
  /** Other open bids using this tail over an overlapping window. */
  otherBids: number;
}

export interface BidQuote {
  tenderId: string;
  budget: number;
  mgh: number;
  /** Suggested rate (the budget) and the steps the form walks. */
  rateMin: number;
  rateMax: number;
  mghMin: number;
  mghMax: number;
  start: Minute;
  end: Minute;
  startRange: [Minute, Minute];
  endRange: [Minute, Minute];
  aircraft: BidAircraft[];
  /** 'Crew based in Portugal'. */
  crewLabel: string;
  /** Cabin crew the client would put on board with 'mixed', and the rate cut per block hour. */
  mixedCut: number;
  mixedPref: boolean;
  rivals: number;
}

/** The ask with our terms: dates moved by whole days, our rate and MGH, their cabin crew. Pure (a clone). */
export function offerWithBid(t: Tender, bid: Pick<TenderBid, 'rate' | 'mgh' | 'start' | 'end' | 'crew'>, typeId?: string, seats?: number): ContractOffer {
  const o = structuredClone(t.ask);
  const ds = Math.round((bid.start - o.start) / DAY) * DAY;
  const de = Math.round((bid.end - o.end) / DAY) * DAY;
  o.start += ds;
  o.end += de;
  if (o.pattern.kind === 'base') {
    o.pattern.from += ds;
    o.pattern.to += de;
  }
  if (o.product.kind === 'wet') {
    o.product.ratePerBH = Math.round(bid.rate);
    o.product.mghPerMonth = Math.round(bid.mgh);
    o.estValue = productValue(o.product, o.estBH, o.start, o.end, o.terms);
  }
  if (bid.crew === 'mixed' && typeId) {
    const M = complement(typeId, seats ?? o.requirements.minSeats).filter((x) => x === 'PUR' || x === 'CC').length;
    if (M > 1) o.requirements.clientCabin = { n: M - 1, of: M, leads: false };
  }
  return o;
}

/** Feasibility of the ask (with our dates) on one aircraft, through a temporary market entry. */
function fitOn(g: GameState, o: ContractOffer, aircraftId: string): { level: CheckLevel; note: string } {
  const had = g.offers[o.id];
  g.offers[o.id] = { ...o, status: 'open', expires: Math.max(o.expires, g.now + DAY) };
  try {
    const rep = feasibility(g, o.id, aircraftId, { quick: true });
    const worst = rep.checks.find((c) => c.level === 'no') ?? rep.checks.find((c) => c.level === 'warn');
    return { level: rep.level, note: worst?.label ?? '' };
  } catch {
    return { level: 'no', note: 'Cannot be checked' };
  } finally {
    if (had) g.offers[o.id] = had;
    else delete g.offers[o.id];
  }
}

const mixedCutPerBH = () => BAL.v08.mixedCrew.perCabinBH;

/** Everything the bid form needs. Null when the tender is not open. */
export function bidQuote(g: GameState, tenderId: string): BidQuote | null {
  const t = com(g).tenders.find((x) => x.id === tenderId);
  if (!t || t.status !== 'open') return null;
  const o = t.ask;
  const budget = o.product.kind === 'wet' ? o.product.ratePerBH : 0;
  const mgh = o.product.kind === 'wet' ? o.product.mghPerMonth : 0;
  const bid0 = t.bid ?? { rate: budget, mgh, start: o.start, end: o.end, crew: 'ours' as const };
  const others = com(g).tenders.filter((x) => x.id !== t.id && x.status === 'open' && x.bid && x.bid.start < o.end && x.bid.end > o.start);
  const aircraft: BidAircraft[] = Object.values(g.fleet)
    .filter((a) => a.status !== 'stored' && a.status !== 'leasedOut' && !a.sale && typeOf(a.typeId).body === 'narrow')
    .map((a) => {
      const fit = fitOn(g, offerWithBid(t, bid0, a.typeId, a.cabin.total), a.id);
      return { id: a.id, reg: a.reg, type: typeOf(a.typeId).short, age: yearsOld(g, a.builtYear), family: typeOf(a.typeId).family, level: fit.level, note: fit.note, otherBids: others.filter((x) => x.bid!.aircraftId === a.id).length };
    })
    .sort((a, b) => (a.level === 'no' ? 1 : 0) - (b.level === 'no' ? 1 : 0) || (a.reg < b.reg ? -1 : 1));
  const home = g.company.homeBase;
  return {
    tenderId, budget, mgh, rateMin: r10(budget * 0.85), rateMax: r10(budget * 1.15), mghMin: Math.round(mgh * 0.8), mghMax: Math.round(mgh * 1.2),
    start: bid0.start, end: bid0.end,
    startRange: [o.start + TENDER.startShift[0] * DAY, o.start + TENDER.startShift[1] * DAY], endRange: [o.end + TENDER.endShift[0] * DAY, o.end + TENDER.endShift[1] * DAY],
    aircraft, crewLabel: `Crew based in ${countryName(AIRPORT_BY_CODE[home]?.country ?? '') || home}`, mixedCut: mixedCutPerBH(), mixedPref: !!t.mixedPref, rivals: t.rivals.length,
  };
}

/** Player action: send (or change) our bid before the deadline. */
export function placeBid(g: GameState, tenderId: string, bid: Omit<TenderBid, 'at'>): ActionResult {
  const t = com(g).tenders.find((x) => x.id === tenderId);
  if (!t) return { ok: false, error: 'Tender not found' };
  if (t.status !== 'open' || g.now >= t.deadline) return { ok: false, error: 'Bids for this tender have closed' };
  const ac = g.fleet[bid.aircraftId];
  if (!ac) return { ok: false, error: 'Choose an aircraft' };
  if (typeOf(ac.typeId).body !== 'narrow') return { ok: false, error: `${ac.reg} is a widebody: they want a narrowbody` };
  const o = t.ask;
  if (!(bid.rate > 0) || !(bid.mgh > 0)) return { ok: false, error: 'Rate and MGH must be above zero' };
  if (bid.start < o.start + TENDER.startShift[0] * DAY || bid.start > o.start + TENDER.startShift[1] * DAY) return { ok: false, error: 'Start too far from their dates' };
  if (bid.end < o.end + TENDER.endShift[0] * DAY || bid.end > o.end + TENDER.endShift[1] * DAY || bid.end - bid.start < 30 * DAY) return { ok: false, error: 'End too far from their dates' };
  const first = !t.bid;
  t.bid = { ...bid, rate: Math.round(bid.rate), mgh: Math.round(bid.mgh), at: g.now };
  if (first) comStats(g).bids++;
  return { ok: true, msg: `Bid sent to ${g.clients[t.clientId]?.name ?? 'the client'}: $${t.bid.rate.toLocaleString('en-US')}/BH, MGH ${t.bid.mgh}, ${ac.reg}` };
}

/** Player action: withdraw our bid before the deadline. */
export function withdrawBid(g: GameState, tenderId: string): ActionResult {
  const t = com(g).tenders.find((x) => x.id === tenderId);
  if (!t || !t.bid) return { ok: false, error: 'No bid to withdraw' };
  if (t.status !== 'open') return { ok: false, error: 'Bids for this tender have closed' };
  delete t.bid;
  return { ok: true, msg: 'Bid withdrawn' };
}

// ---------- award ----------

interface Score {
  total: number;
  parts: { price: number; mgh: number; rel: number; level: number; age: number; fit: number; cover: number; standing: number };
}

/** Our bid's score (without noise). Pure. */
export function ourScore(g: GameState, t: Tender, bid: TenderBid): Score {
  const W = TENDER.w;
  const o = t.ask;
  const budget = o.product.kind === 'wet' ? o.product.ratePerBH : bid.rate;
  const mgh = o.product.kind === 'wet' ? o.product.mghPerMonth : bid.mgh;
  const ac = g.fleet[bid.aircraftId];
  const fam = ac ? typeOf(ac.typeId).family : '';
  const lo = Math.max(o.start, bid.start);
  const hi = Math.min(o.end, bid.end);
  const cover = clamp((hi - lo) / Math.max(1, o.end - o.start), 0, 1);
  const parts = {
    price: -W.rate * (bid.rate / budget - 1),
    mgh: -W.mgh * (bid.mgh / mgh - 1),
    rel: W.rel * (g.company.reputation.reliable / 100 - 0.85),
    level: TENDER.level[levelOf(g, g.clients[t.clientId])] ?? 0,
    age: -W.age * Math.max(0, (ac ? yearsOld(g, ac.builtYear) : 20) - W.ageFrom),
    fit: (t.family && fam !== t.family ? -W.fam : 0) + (bid.crew === 'mixed' ? (t.mixedPref ? W.crew : -W.crewOff) : 0),
    cover: -W.cover * (1 - cover),
    standing: TENDER.standing[g.company.standing ?? 0] ?? 0,
  };
  return { total: W.base + Object.values(parts).reduce((s, v) => s + v, 0), parts };
}

function rivalScore(g: GameState, t: Tender, b: RivalTenderBid, rv: Rival | undefined): Score {
  const W = TENDER.w;
  const fam = rv?.fleet.some((f) => f.count > 0 && typeOf(f.typeId).family === t.family) ?? true;
  const r = sideOf(g, `inc:${t.id}:${b.rivalId}`);
  const parts = {
    price: -W.rate * (b.rateX - 1), mgh: -W.mgh * (b.mghX - 1), rel: W.rel * (b.quality - 0.85), level: range(r, 0, 0.05),
    age: -W.age * Math.max(0, b.age - W.ageFrom), fit: t.family && !fam ? -W.fam : 0, cover: 0, standing: 0,
  };
  return { total: W.base + Object.values(parts).reduce((s, v) => s + v, 0), parts };
}

const PART_TEXT: Record<keyof Score['parts'], [string, string]> = {
  price: ['your lower rate', 'their lower rate'],
  mgh: ['your lower MGH', 'their lower MGH'],
  rel: ['your reliability record', 'their reliability record'],
  level: ['your relationship with them', 'their relationship with the airline'],
  age: ['your younger aircraft', 'their younger aircraft'],
  fit: ['your aircraft and crew fit their fleet', 'their aircraft fit the fleet better'],
  cover: ['you covered their dates', 'they covered all the dates'],
  standing: ['your standing', 'your standing as a newcomer'],
};

/** The one or two parts that decided it, in words. Pure. */
function whyWords(a: Score, b: Score, weWon: boolean): string {
  const diffs = (Object.keys(a.parts) as (keyof Score['parts'])[]).map((k) => [k, a.parts[k] - b.parts[k]] as const).filter(([, d]) => (weWon ? d > 0.004 : d < -0.004));
  diffs.sort((x, y) => Math.abs(y[1]) - Math.abs(x[1]));
  const words = diffs.slice(0, 2).map(([k]) => PART_TEXT[k][weWon ? 0 : 1]);
  return words.length ? words.join(' and ') : 'a close call';
}

/** Awards the tender: our score against the rivals' (noise from the tender's own stream); won → signed or offered to sign. */
export function decideTender(g: GameState, t: Tender): void {
  if (t.status !== 'closed' || !t.bid) return;
  const cl = g.clients[t.clientId];
  const name = cl?.name ?? 'The client';
  const r = sideOf(g, `award:${t.id}`);
  const us = ourScore(g, t, t.bid);
  us.total += range(r, -TENDER.w.noise, TENDER.w.noise);
  let best: { id: string; s: Score } | null = null;
  for (const b of t.rivals) {
    const rv = g.rivals.find((x) => x.id === b.rivalId);
    if (!rv || !isActive(rv)) continue;
    const s = rivalScore(g, t, b, rv);
    s.total += range(r, -TENDER.w.noise, TENDER.w.noise);
    if (!best || s.total > best.s.total) best = { id: b.rivalId, s };
  }
  const st = comStats(g);
  if (best && best.s.total >= us.total) {
    const rv = g.rivals.find((x) => x.id === best!.id)!;
    t.status = 'lost';
    t.result = { winner: rv.id, why: whyWords(us, best.s, false), ours: round3(us.total), best: round3(best.s.total) };
    st.lost++;
    rv.won = (rv.won ?? 0) + 1;
    pushMessage(g, {
      tone: 'info', cat: 'commercial', title: `Tender lost: ${name} chose ${rv.name}`,
      body: `For ${roundName(t.round)}: ${t.result.why}. Nothing lost but the work.`, ref: { kind: 'tender', id: t.id },
    });
    return;
  }
  t.status = 'won';
  t.result = { winner: 'us', why: best ? whyWords(us, best.s, true) : 'no other operator met their terms', ours: round3(us.total), ...(best ? { best: round3(best.s.total) } : {}) };
  st.won++;
  bumpClient(g, t.clientId, 4, `We won their ${roundName(t.round)} tender`);
  award(g, t);
}

const round3 = (v: number) => Math.round(v * 1000) / 1000;

/** A won tender: the offer back on the market with our terms (no rival, 7 days), signed on the tail we bid when it can. */
function award(g: GameState, t: Tender): void {
  const bid = t.bid!;
  const ac = g.fleet[bid.aircraftId];
  const o = offerWithBid(t, bid, ac?.typeId, ac?.cabin.total);
  o.id = nextId(g, 'o');
  o.created = g.now;
  o.expires = g.now + TENDER.signDays * DAY;
  o.status = 'open';
  o.firstRefusal = true;
  o.seen = true;
  o.urgency = 'normal';
  delete o.counter;
  delete o.rivalBid;
  o.blurb = `Won in their ${roundName(t.round)} tender. ${o.blurb}`;
  g.offers[o.id] = o;
  schedule(g, o.expires, 'offer.expire', o.id);
  t.result!.offerId = o.id;
  const name = g.clients[t.clientId]?.name ?? 'The client';
  const res = ac ? acceptOffer(g, o.id, [ac.id], { priced: true }) : { ok: false as const, error: 'The aircraft we bid has left the fleet' };
  if (res.ok) {
    t.result!.contractId = res.data!.contractId;
    pushMessage(g, {
      tone: 'good', cat: 'commercial', title: `Tender won: ${name}, ${roundName(t.round)}`,
      body: `${t.result!.why[0].toUpperCase()}${t.result!.why.slice(1)}. Signed on ${ac!.reg}: $${bid.rate.toLocaleString('en-US')}/BH, MGH ${bid.mgh}, ${fmtDay(o.start)}–${fmtDay(o.end - 1)}.`,
      ref: { kind: 'contract', id: res.data!.contractId }, cue: 'contractSigned',
    });
    return;
  }
  pushMessage(g, {
    tone: 'warn', cat: 'commercial', title: `Tender won: choose an aircraft for ${name}`,
    body: `${res.ok ? '' : `${ac?.reg ?? 'The aircraft we bid'} can no longer take it (${res.error}). `}Sign it on another aircraft by ${fmtDay(o.expires)}, or it lapses and ${name} will remember.`,
    ref: { kind: 'offer', id: o.id }, cue: 'counterReply',
  });
}

/** A won tender's offer that lapsed unsigned: relation lost (once). */
function lapseWon(g: GameState): void {
  for (const t of com(g).tenders) {
    if (t.status !== 'won' || !t.result?.offerId || t.result.contractId) continue;
    const o = g.offers[t.result.offerId];
    if (!o) continue;
    if (o.status === 'accepted') {
      t.result.contractId = Object.values(g.contracts).find((k) => k.offerId === o.id)?.id;
      continue;
    }
    if ((o.status === 'expired' || o.status === 'lost' || o.status === 'declined') && !t.result.why.endsWith('(not signed)')) {
      t.result.why = `${t.result.why} (not signed)`;
      bumpClient(g, t.clientId, TENDER.lapseRelation, 'We won their tender and did not sign');
    }
  }
}

// ---------- views ----------

export interface TenderRow {
  id: string;
  clientId: string;
  client: string;
  country: string;
  round: string;
  base: string;
  dests: string[];
  start: Minute;
  end: Minute;
  seats: number;
  wanted: string;
  deadline: Minute;
  resultAt: Minute;
  status: Tender['status'];
  invited: boolean;
  rivals: number;
  bid?: TenderBid & { reg: string };
  result?: Tender['result'] & { winnerName: string };
  budget: number;
  mgh: number;
}

export function tenderRow(g: GameState, t: Tender): TenderRow {
  const o = t.ask;
  const cl = g.clients[t.clientId];
  const p = o.pattern;
  return {
    id: t.id, clientId: t.clientId, client: cl?.name ?? 'Client', country: cl?.country ?? '', round: roundName(t.round),
    base: p.kind === 'base' ? p.base : cl?.base ?? '', dests: p.kind === 'base' ? p.dests : [], start: o.start, end: o.end, seats: o.requirements.minSeats,
    wanted: aircraftWanted(t), deadline: t.deadline, resultAt: t.resultAt, status: t.status, invited: !!t.invited, rivals: t.rivals.length,
    ...(t.bid ? { bid: { ...t.bid, reg: g.fleet[t.bid.aircraftId]?.reg ?? '—' } } : {}),
    ...(t.result ? { result: { ...t.result, winnerName: t.result.winner === 'us' ? 'You' : g.rivals.find((x) => x.id === t.result!.winner)?.name ?? 'A rival' } } : {}),
    budget: o.product.kind === 'wet' ? o.product.ratePerBH : 0, mgh: o.product.kind === 'wet' ? o.product.mghPerMonth : 0,
  };
}

/** The tender board: open RFPs (deadline first), my bids waiting, results (newest first). Pure. */
export function tenderBoard(g: GameState): { open: TenderRow[]; mine: TenderRow[]; results: TenderRow[] } {
  const all = com(g).tenders.map((t) => tenderRow(g, t));
  return {
    open: all.filter((t) => t.status === 'open').sort((a, b) => a.deadline - b.deadline),
    mine: all.filter((t) => t.status === 'closed' || (t.status === 'open' && t.bid)).sort((a, b) => a.resultAt - b.resultAt),
    results: all.filter((t) => t.status === 'won' || t.status === 'lost' || t.status === 'noBid').sort((a, b) => b.resultAt - a.resultAt).slice(0, 20),
  };
}

export const tenderById = (g: GameState, id: string): Tender | undefined => com(g).tenders.find((t) => t.id === id);
