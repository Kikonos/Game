// v0.17 the lessor rating (UPDATE-0.17.md §C; lane `deals`): the score, its grade and parts (a pure read), cached
// daily in g.leasing.credit with a message when the grade changes; each lessor's exposure and cap (§C.3); who will deal
// with us for a type (§D.3 steps 1–3, §T); the sale-and-leaseback lessor pick (§K.2).
// (The design calls the rating `creditView`; that name is engine/finance's bank credit line.)

import { BAL } from '../core/balance';
import { DAY, fmtDay } from '../core/time';
import type { AgeBand, CreditGrade, GameState, LessorId, LessorRating } from '../core/types';
import { monthEndBill } from '../ops/finance';
import { monthKey } from '../core/time';
import { pushMessage } from '../core/messages';
import { typeOf } from '../core/perf';
import { playerStars } from '../contracts/prestige';
import { LESSOR_BY_ID, LESSOR_DEFS, lessorIdOf, type LessorDef } from '../../data/lessors';

const MONTH = 30.44 * DAY;
const K = () => BAL.v017.credit;
const X = () => BAL.v017.exotic;

/** A < B < C < D as 0…3 (lower is better). */
export const RANK: Record<CreditGrade, number> = { A: 0, B: 1, C: 2, D: 3 };
/** True when grade `a` is at least as good as `b`. Pure. */
export const gradeAtLeast = (a: CreditGrade, b: CreditGrade): boolean => RANK[a] <= RANK[b];

/** Points of the highest band reached: [[12, 8], [24, 14]] at 30 → 14. */
const band = (x: number, bands: readonly (readonly [number, number])[]): number => {
  let p = 0;
  for (const [at, pts] of bands) if (x >= at) p = pts;
  return p;
};

/** The grade of a score (§C.1). Pure. */
export function gradeOf(score: number): CreditGrade {
  const G = K().grades;
  return score >= G.A ? 'A' : score >= G.B ? 'B' : score >= G.C ? 'C' : 'D';
}

/** Our lessor rating now, with its parts (§C.1). Pure. */
export function lessorRating(g: GameState): LessorRating {
  const R = K();
  const parts: { label: string; pts: number }[] = [];
  const add = (label: string, pts: number) => parts.push({ label, pts });
  const co = g.company;
  const months = Math.floor((g.now - (co.aocAt ?? g.started)) / MONTH);
  add(`${months} months on the AOC`, band(months, R.aocMonths));
  const fleet = Object.values(g.fleet).filter((a) => a.status !== 'delivering').length;
  add(`${fleet} aircraft on the AOC`, band(fleet, R.fleet));
  const line = g.treasury?.credit;
  const undrawn = line && !line.frozen ? Math.max(0, line.limit - line.drawn) : 0;
  if (co.cash < 0) add('Cash below zero', R.cover.negative);
  else {
    const bill = monthEndBill(g, monthKey(g.now) + 1).total;
    const cover = bill > 0 ? (co.cash + undrawn) / bill : 99;
    add(`Cash cover ${cover >= 10 ? '10+' : cover.toFixed(1)} months`, band(cover, R.cover.bands));
  }
  const closed = g.finance.history.filter((s) => s.closed).slice(-6);
  if (closed.length < R.profit.minStatements) add('Fewer than 3 months of accounts', 0);
  else {
    let rev = 0;
    let profit = 0;
    for (const s of closed) {
      for (const [cat, v] of Object.entries(s.lines)) {
        if (v === undefined) continue;
        profit += v;
        if (v > 0 && /Revenue$|^leaseIncome$|^interestIncome$/.test(cat)) rev += v;
      }
      // Approval fees are one-offs: added back.
      profit -= s.lines.approvals ?? 0;
    }
    const margin = rev > 0 ? profit / rev : 0;
    add(profit < 0 ? 'A loss over the last six months' : margin >= R.profit.margin[0] ? `Profitable, ${Math.round(margin * 100)} % margin` : 'Profitable', profit < 0 ? R.profit.loss : margin >= R.profit.margin[0] ? R.profit.margin[1] : R.profit.profit);
  }
  const d = g.treasury?.distress;
  if (d?.rentDeferrals.some((x) => !x.done)) add('Rent deferral running', R.distress.deferral);
  if (d?.plans.some((x) => !x.done)) add('Creditor payment plan', R.distress.plan);
  if (d?.investor && !d.investor.released) add("Investor's board seated", R.distress.investor);
  if (line?.frozen) add('Credit line frozen', R.distress.frozen);
  else if (line && line.breaches > 0) add('Covenant breach', R.distress.breach);
  const stars = playerStars(g);
  add(`${stars}★ clients`, R.stars[stars] ?? 0);
  if (co.approvals.includes('iosa')) add('IOSA held', R.iosa);
  const rel = co.reputation.reliable;
  if (rel >= R.reliableHigh[0]) add('Reliable operation', R.reliableHigh[1]);
  else if (rel <= R.reliableLow[0]) add('Unreliable operation', R.reliableLow[1]);
  const returns = g.stats.leaseReturns ?? 0;
  if (returns) add(`${returns} lease${returns > 1 ? 's' : ''} handed back properly`, Math.min(R.returns.max, returns * R.returns.per));
  const score = Math.max(0, Math.min(100, R.base + parts.reduce((s, p) => s + p.pts, 0)));
  // A restructuring running, or its label standing, caps the grade at D (§C.1).
  const capped = restructuring(g);
  if (capped) parts.push({ label: 'Restructuring: rating capped at D', pts: 0 });
  return { score, grade: capped ? 'D' : gradeOf(score), parts, at: g.now };
}

/** A restructuring (PER) running or its label standing (§C.1, §K.4). Pure. */
export function restructuring(g: GameState): boolean {
  const per = g.treasury?.distress?.per;
  return !!per && per.labelUntil > g.now;
}

/** The rating as cached today (computed when nothing is cached yet). Pure. */
export function rating(g: GameState): LessorRating {
  return g.leasing?.credit ?? lessorRating(g);
}

const GRADE_WORDS: Record<CreditGrade, string> = {
  A: 'Strong: lessors compete for us',
  B: 'Sound',
  C: "Start-up or thin: mid-life and older aircraft, 3 months' deposit",
  D: 'Weak: only end-of-life lessors, big deposits',
};
/** The rating's words on screen (§C.1). Pure. */
export const gradeWords = (gr: CreditGrade): string => GRADE_WORDS[gr];

/** The deposit in months at a rating (§C.2): D is 5, or 7 below a score of 25. Pure. */
export function depositMonthsFor(r: Pick<LessorRating, 'grade' | 'score'>): number {
  const D = K().deposit;
  if (r.grade !== 'D') return D[r.grade];
  return r.score < D.DlowBelow ? D.Dlow : D.D;
}

/** Load: the rating cached at once (no message). */
export function loadCredit(g: GameState): void {
  if (g.leasing && !g.leasing.credit) g.leasing.credit = lessorRating(g);
}

/** Daily: the rating recomputed and cached; a grade change is told (up: `ladder`; down: `notice`) (§N.4). */
export function dailyCredit(g: GameState): void {
  const L = g.leasing;
  if (!L) return;
  const was = L.credit;
  const now = lessorRating(g);
  L.credit = now;
  if (!was || was.grade === now.grade) return;
  const up = RANK[now.grade] < RANK[was.grade];
  const months = depositMonthsFor(now);
  const dep = `${months} month${months === 1 ? '' : 's'}' deposit`;
  const what = up
    ? now.grade === 'A' ? `Every lessor will talk to us; ${dep}` : now.grade === 'B' ? `${dep} now; top lessors will talk to us` : `${dep} now; mid-life lessors will talk to us`
    : now.grade === 'D' ? `${dep}; only end-of-life lessors will talk to us` : now.grade === 'C' ? `${dep}; top lessors won't consider us for now` : `${dep} now`;
  pushMessage(g, {
    tone: up ? 'good' : 'warn', cat: 'finance', topic: 'market', cue: up ? 'ladder' : 'notice',
    title: `Lessor rating ${up ? 'up' : 'down'} to ${now.grade}`,
    body: `${what}. Score ${now.score} (was ${was.score}). ${gradeWords(now.grade)}.`,
  });
}

// ---------- exposure, caps, blocks (§C.3) ----------

/** The key exposure counts by (the previous operator counts per airline). */
function exposureKey(lessorId: LessorId | null | undefined, name: string): string | null {
  if (!lessorId) return null;
  return lessorId === 'exop' ? `exop:${name}` : lessorId;
}

/**
 * Aircraft we lease from a lessor now (§C.3): dry leases in (leasebacks included), delivering ones and deals at letter
 * of intent, credit check or approval. `name` picks the airline for the previous operator ('exop'). Pure.
 */
export function exposureOf(g: GameState, lessorId: LessorId, name?: string): { all: number; wide: number } {
  const want = lessorId === 'exop' ? `exop:${name ?? ''}` : lessorId;
  let all = 0;
  let wide = 0;
  for (const a of Object.values(g.fleet)) {
    const o = a.ownership;
    if (o.kind !== 'dryLeaseIn') continue;
    if (exposureKey(o.lessorId ?? lessorIdOf(o.lessor), o.lessor) !== want) continue;
    all++;
    if (typeOf(a.typeId).body === 'wide') wide++;
  }
  for (const d of g.leasing?.deals ?? []) {
    if (d.stage !== 'committee' && d.stage !== 'conditions' && d.stage !== 'approved') continue;
    if (exposureKey(d.offer.lessorId, d.offer.lessor) !== want) continue;
    all++;
    if (typeOf(d.offer.typeId).body === 'wide') wide++;
  }
  return { all, wide };
}

/** Widebodies in all (§C.2): on the AOC, delivering, and in lease deals not yet signed. Pure. */
export function widebodiesInAll(g: GameState): number {
  let n = 0;
  for (const a of Object.values(g.fleet)) if (typeOf(a.typeId).body === 'wide' && a.status !== 'leasedOut') n++;
  for (const d of g.leasing?.deals ?? []) if ((d.stage === 'committee' || d.stage === 'conditions' || d.stage === 'approved') && typeOf(d.offer.typeId).body === 'wide') n++;
  return n;
}

/** The day a lessor will deal with us again after a rent-deferral default (v0.16.3 lessorBlock; 24 months). Pure. */
export function lessorBlockedUntil(g: GameState, name: string): number {
  const d = g.treasury?.distress;
  if (!d) return 0;
  let until = d.lessorBlock?.[name] ?? 0;
  for (const r of d.rentDeferrals) if (r.lessor === name && r.defaulted !== undefined) until = Math.max(until, r.defaulted + K().blockMonths * MONTH);
  return until;
}

/** A lessor's cap with us at a grade: a rent deferral running with it takes one off (§K.4). Pure. */
export function capOf(g: GameState, def: LessorDef, grade: CreditGrade, name = def.name): { all: number; wide: number } {
  const c = def.caps[grade];
  const deferring = g.treasury?.distress?.rentDeferrals.some((r) => !r.done && r.lessor === name) ?? false;
  const less = deferring ? K().deferralCapLess : 0;
  return { all: Math.max(0, c.all - less), wide: Math.max(0, Math.min(c.wide, c.all - less)) };
}

/** A lessor's answer before looking for an aircraft (§D.3 steps 1–3): ok, or the stated no. */
export interface LessorStance {
  ok: boolean;
  kind?: 'blocked' | 'credit' | 'exposure' | 'placed';
  text: string;
  /** §T an exotic at the security grade: more deposit and reserves up front. */
  security?: boolean;
}

const firstWord = (s: string) => s.split(' ')[0];
const count = (n: number) => (n === 1 ? 'one' : n === 2 ? 'two' : n === 3 ? 'three' : n === 4 ? 'four' : String(n));

/**
 * Whether a lessor will consider us for a type (§D.3 steps 1–3; §T for exotics). `name` is the airline for the previous
 * operator. Placement of new builds (step 4) is the request's check (it needs the date). Pure.
 */
export function lessorStance(g: GameState, def: LessorDef, typeId: string, bandIn: AgeBand, name = def.name, r: Pick<LessorRating, 'grade'> = rating(g)): LessorStance {
  const t = typeOf(typeId);
  const grade = r.grade;
  // 1. Blocked after a rent-deferral default.
  const until = lessorBlockedUntil(g, name);
  if (until > g.now) return { ok: false, kind: 'blocked', text: `We're still owed rent from last time (until ${fmtDay(until)})` };
  // 2. Credit.
  const min = def.minGrade[t.body];
  if (!min) return { ok: false, kind: 'credit', text: `${firstWord(def.name)} doesn't lease ${t.body === 'wide' ? 'widebodies' : 'narrowbodies'}` };
  if (restructuring(g) && def.tier === 'top') return { ok: false, kind: 'credit', text: "Not while you're in restructuring" };
  const exotic = X().types.includes(typeId);
  let security = false;
  if (exotic) {
    const minG = X().minGrade as CreditGrade;
    const secG = X().securityGrade as CreditGrade;
    // The stricter of the lessor's own grade and the exotic rule; one grade lower with big security; never at D.
    const need: CreditGrade = RANK[min] < RANK[minG] ? min : minG;
    if (!gradeAtLeast(grade, need)) {
      if (grade !== 'D' && gradeAtLeast(grade, secG)) security = true;
      else return { ok: false, kind: 'credit', text: grade === 'D' ? `No lease of a ${t.short} at rating D: buy one instead` : `We need rating ${need} or better for a ${t.short}, or ${secG} with big security (now ${grade})` };
    }
  } else if (!gradeAtLeast(grade, min)) return { ok: false, kind: 'credit', text: `We need a stronger balance sheet: rating ${min} or better` };
  const newBuild = bandIn === 'new';
  if ((t.tier >= 4 || (newBuild && t.body === 'wide')) && grade !== 'A') return { ok: false, kind: 'credit', text: `We need a stronger balance sheet: rating A for a ${newBuild ? 'new ' : ''}${t.short}` };
  const nbGrade = (BAL.v017.newBuild.grade.narrow ?? 'B') as CreditGrade;
  if (newBuild && t.body === 'narrow' && !gradeAtLeast(grade, nbGrade)) return { ok: false, kind: 'credit', text: `We need a stronger balance sheet: rating ${nbGrade} for a new build` };
  if (t.body === 'wide' && grade === 'C' && (bandIn === 'new' || bandIn === 'young') && !exotic) return { ok: false, kind: 'credit', text: `At rating C we place only widebodies ${K().wideMinAgeC} years or older` };
  // 3. Exposure: the lessor's cap, then our grade's widebody total.
  const capGrade = security ? (X().securityGrade as CreditGrade) : grade;
  const cap = capOf(g, def, capGrade, name);
  if (cap.all <= 0 || (t.body === 'wide' && cap.wide <= 0)) return { ok: false, kind: 'credit', text: `We don't place ${t.body === 'wide' ? 'widebodies' : 'aircraft'} with an airline rated ${grade}` };
  const ex = exposureOf(g, def.id, name);
  if (ex.all >= cap.all || (t.body === 'wide' && ex.wide >= cap.wide)) {
    const n = t.body === 'wide' && ex.wide >= cap.wide ? ex.wide : ex.all;
    return { ok: false, kind: 'exposure', text: `We already have ${count(n)} of yours: that's our limit for now` };
  }
  if (t.body === 'wide') {
    const total = K().wideTotal[capGrade] ?? 0;
    if (widebodiesInAll(g) >= total) return { ok: false, kind: 'exposure', text: total ? `At rating ${grade} lessors see ${count(total)} widebodies as our limit` : `At rating ${grade} no lessor places a widebody with us` };
  }
  return { ok: true, text: security ? 'Will deal, with big security' : 'Will look', ...(security ? { security } : {}) };
}

/** The lessors that lease a type at an age band (the previous operator only for types it has). Pure. */
export function lessorsFor(typeId: string, bandIn: AgeBand, hasExOperator: boolean): LessorDef[] {
  const t = typeOf(typeId);
  return LESSOR_DEFS.filter((l) => l.families.includes(t.family) && l.ages.includes(bandIn) && l.minGrade[t.body] !== null && (l.id !== 'exop' || hasExOperator));
}

// ---------- sale and leaseback (§K.2) ----------

/** Carlyle buys and leases back at D: a distressed sale (§K.2). */
const LEASEBACK_AT_D: LessorId[] = ['carlyle'];

/** Whether a lessor would take our aircraft in a sale and leaseback (grade, block and cap) (§K.2). Pure. */
export function leasebackLessorOk(g: GameState, lessorName: string): boolean {
  if (!BAL.v017.on) return true;
  const id = lessorIdOf(lessorName);
  if (!id) return true;
  const def = LESSOR_BY_ID[id];
  const grade = rating(g).grade;
  const min = def.minGrade.narrow ?? def.minGrade.wide;
  if (!min) return false;
  if (lessorBlockedUntil(g, def.name) > g.now) return false;
  if (!gradeAtLeast(grade, min) && !(grade === 'D' && LEASEBACK_AT_D.includes(id))) return false;
  if (restructuring(g) && def.tier === 'top') return false;
  const cap = capOf(g, def, grade);
  return exposureOf(g, id).all < cap.all;
}

/**
 * The lessor of a sale and leaseback (§K.2): the stable pick when it is willing, else the next willing one of `list`
 * (then Carlyle, which buys at D); `why` when none is. Pure.
 */
export function leasebackLessorFor(g: GameState, preferred: string, list: readonly string[]): { lessor: string; why: string | null } {
  if (leasebackLessorOk(g, preferred)) return { lessor: preferred, why: null };
  const i = Math.max(0, list.indexOf(preferred));
  const order = [...list.slice(i + 1), ...list.slice(0, i), ...LEASEBACK_AT_D.map((id) => LESSOR_BY_ID[id].name).filter((n) => !list.includes(n))];
  for (const n of order) if (leasebackLessorOk(g, n)) return { lessor: n, why: null };
  const grade = rating(g).grade;
  return {
    lessor: preferred,
    why: restructuring(g) ? "No lessor will take it while we're in restructuring" : `No lessor will take it at rating ${grade}${grade === 'D' ? ": Vallair-type lessors don't do leasebacks" : ': each is at its limit with us'}`,
  };
}
