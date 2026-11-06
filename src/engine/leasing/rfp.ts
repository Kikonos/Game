// v0.17 requests for proposals (UPDATE-0.17.md §D; lane `deals`): we ask lessors for a type, age, term, start and
// count; each answers on its own day (narrowbody 5–14 days, widebody 10–24, new build 14–28; × 0.7 at grade A) with
// proposals or a stated no. Every roll is on the side stream `rfp:<id>:<lessor>`.
// - Checked in order: blocked (a rent-deferral default), credit, exposure (the lessor's cap, our widebody total),
//   placed (new builds before their earliest year), then the aircraft: p = appetite × (1 − tightNow) × window × work
//   × gradeFactor (≤ 0.95); a second aircraft at p × 0.5, a third at p × 0.25; 30 % of misses answer "later".
// - §T exotics: a request that meets every requirement has at least the floor chance (12 %, 5 % for 747 classics,
//   which come only as sales from storage).

import { ACMI_TYPES, floorRent, rentForAge, type AcmiType } from '../../data/acmiTypes';
import { AIRPORT_BY_CODE } from '../../data/airports';
import { LESSOR_BY_ID, type LessorDef } from '../../data/lessors';
import { EX_OPERATORS, FACTORIES, NEW_BUILD } from '../../data/market';
import { BAL } from '../core/balance';
import { nextId } from '../core/entities';
import { pushMessage } from '../core/messages';
import { runwayFit, typeOf } from '../core/perf';
import { chance, int, pick, range, type RngHolder } from '../core/rng';
import { DAY, fmtDay, yearOf } from '../core/time';
import type { ActionResult, AgeBand, AircraftOffer, GameState, LessorId, Minute, Rfp, RfpAnswer } from '../core/types';
import { aircraftGate } from '../ops/company';
import { makeOffer } from '../ops/market';
import { lockOf } from '../scenario/rules';
import { needsVariation, variationQuote } from './aoc';
import { depositMonthsFor, lessorsFor, lessorStance, rating } from './credit';
import { leasingSide } from './side';
import { quoteTerms } from './terms';
import { tightNow } from './tightness';

const R = () => BAL.v017.rfp;
const X = () => BAL.v017.exotic;

export interface RfpDraft {
  typeId: string;
  band: AgeBand;
  months: number;
  count: 1 | 2 | 3;
  /** Wanted handover; null = as soon as possible. */
  from: Minute | null;
  flex: boolean;
}

/** The request dialog's lines before sending (§D.1, §N.3). */
export interface RfpPreview {
  lessors: { id: LessorId; name: string; ok: boolean; why?: string }[];
  goesTo: number;
  wontConsider: number;
  /** Days to the answers, [first, last]. */
  replyDays: [number, number];
  /** 'Goes to 7 lessors · 3 won't consider us yet (rating C) · answers in 1–2 weeks'. */
  text: string;
  /** Why it can't be sent (too many open, scenario lock, the type's gate). */
  blocked: string | null;
  /** 'New type for our AOC: the variation takes 90 days'. */
  aocNote?: string;
  /** 'Fleet average age would be 19.4: the majors ask 18 or less'. */
  ageWarning?: string;
}

/** The age band's built years for a type now (within its production years); null when none exist. Pure. */
export function bandYears(g: GameState, t: AcmiType, band: AgeBand): [number, number] | null {
  const now = yearOf(g.now);
  if (band === 'new') return NEW_BUILD.includes(t.id) && FACTORIES[t.family] ? [now, now] : null;
  if (t.newOnly) return null;
  const B = BAL.v017.terms.bands[band];
  const lo = Math.max(now - B[1] + 1, t.firstYear ?? 1970);
  const hi = Math.min(now - Math.max(1, B[0]), t.lastYear ?? now, now - 1);
  return lo <= hi ? [lo, hi] : null;
}

const replyRange = (t: AcmiType, band: AgeBand): [number, number] => R().reply[band === 'new' ? 'newBuild' : t.body === 'wide' ? 'wide' : 'narrow'];
const openRfps = (g: GameState) => (g.leasing?.rfps ?? []).filter((r) => r.status === 'open' && !r.spot);
const exOpName = (typeId: string) => (EX_OPERATORS[typeId]?.length ? 'The previous operator' : '');

/** The lessors a draft goes to, with whether each will consider us (and why not). Pure. */
function lessorLines(g: GameState, d: Pick<RfpDraft, 'typeId' | 'band'>): { def: LessorDef; ok: boolean; why?: string; kind?: RfpAnswer['kind'] }[] {
  const has = !!EX_OPERATORS[d.typeId]?.length;
  const r = rating(g);
  return lessorsFor(d.typeId, d.band, has).map((def) => {
    const quiet = g.leasing?.quiet[`${def.id}:${d.typeId}`];
    if (quiet !== undefined && quiet > g.now) return { def, ok: false, why: `${def.name.split(' ')[0]} looked on ${fmtDay(quiet - R().quietDays * DAY)}: again from ${fmtDay(quiet)}` };
    const st = lessorStance(g, def, d.typeId, d.band, def.name, r);
    return st.ok ? { def, ok: true } : { def, ok: false, why: st.text, kind: st.kind };
  });
}

/** The request dialog's lines (§D.1, §N.3). Pure. */
export function rfpPreview(g: GameState, d: RfpDraft): RfpPreview {
  const empty: RfpPreview = { lessors: [], goesTo: 0, wontConsider: 0, replyDays: [0, 0], text: '', blocked: null };
  if (!BAL.v017.on) return { ...empty, blocked: 'Requests to lessors are not open' };
  const t = ACMI_TYPES[d.typeId];
  if (!t) return { ...empty, blocked: 'Unknown type' };
  const lk = lockOf(g, 'fleet');
  const max = (g.company.standing ?? 0) === 0 ? R().maxOpenNewcomer : R().maxOpen;
  const lines = lessorLines(g, d);
  const okN = lines.filter((l) => l.ok).length;
  const grade = rating(g).grade;
  const rr = replyRange(t, d.band);
  const x = grade === 'A' ? R().replyXA : 1;
  const reply: [number, number] = [Math.round(rr[0] * x), Math.round(rr[1] * x)];
  const weeks = (n: number) => Math.max(1, Math.round(n / 7));
  const won = lines.length - okN;
  const credit = lines.some((l) => !l.ok && l.kind === 'credit');
  const text = `Goes to ${okN} lessor${okN === 1 ? '' : 's'}${won ? ` · ${won} won't consider us yet${credit ? ` (rating ${grade})` : ''}` : ''} · answers in ${weeks(reply[0])}–${weeks(reply[1])} weeks`;
  const gate = aircraftGate(g, d.typeId);
  const years = bandYears(g, t, d.band);
  let blocked: string | null = null;
  if (lk) blocked = lk;
  else if (openRfps(g).length >= max) blocked = `At most ${max} requests open${max === R().maxOpenNewcomer ? ' while we are a Newcomer' : ''}`;
  else if (!gate.ok) blocked = `${gate.text} first`;
  else if (!years) blocked = d.band === 'new' ? `No new ${t.short}s are built` : `No ${t.short} of that age exists`;
  else if (d.band === 'new' && d.months < BAL.v017.newBuild.months[0]) blocked = `A new build needs a lease of ${BAL.v017.newBuild.months[0] / 12} years or more`;
  else if (!lines.length) blocked = `No lessor leases ${d.band === 'new' ? 'new' : d.band === 'old' ? 'old' : d.band === 'mid' ? 'mid-life' : 'young'} ${t.short}s`;
  else if (!okN) blocked = `No lessor will consider us for this yet: ${lines[0].why}`;
  const out: RfpPreview = {
    lessors: lines.map((l) => ({ id: l.def.id, name: l.def.id === 'exop' ? exOpName(d.typeId) || l.def.name : l.def.name, ok: l.ok, ...(l.why ? { why: l.why } : {}) })),
    goesTo: okN, wontConsider: won, replyDays: reply, text, blocked,
  };
  const vq = needsVariation(g, t.family) ? variationQuote(g, t.family, t.id) : null;
  if (vq) out.aocNote = `New type for our AOC: the variation takes ${vq.days} days`;
  const age = ageWarning(g, d, t);
  if (age) out.ageWarning = age;
  return out;
}

/** §K.5 the fleet's average age with one more of this band, against the next level's limit. Pure. */
function ageWarning(g: GameState, d: RfpDraft, t: AcmiType): string | undefined {
  const years = bandYears(g, t, d.band);
  if (!years || d.band === 'new' || d.band === 'young') return undefined;
  const lv = g.company.prestige?.level ?? 1;
  const reqs = BAL.v016.prestige.reqs;
  const next = lv < 3 ? 3 : lv < 4 ? 4 : 4;
  const r = reqs[next];
  if (!r) return undefined;
  const now = yearOf(g.now);
  const fleet = Object.values(g.fleet).filter((a) => a.status !== 'delivering');
  const ages = fleet.map((a) => Math.max(0, now - a.builtYear));
  ages.push(now - Math.round((years[0] + years[1]) / 2));
  const avg = ages.reduce((s, a) => s + a, 0) / ages.length;
  if (avg <= r.maxAge) return undefined;
  return `Fleet average age would be ${avg.toFixed(1)}: ${next === 4 ? 'the majors' : 'national carriers'} ask ${r.maxAge} or less`;
}

/** Sends a request to every lessor that leases that family and age (§D.1). Our action: quiet. */
export function sendRfp(g: GameState, d: RfpDraft): ActionResult<{ rfpId: string }> {
  const p = rfpPreview(g, d);
  if (p.blocked) return { ok: false, error: p.blocked };
  const L = g.leasing!;
  const t = typeOf(d.typeId);
  const id = nextId(g, 'rfp');
  const grade = rating(g).grade;
  const rr = replyRange(t, d.band);
  const x = grade === 'A' ? R().replyXA : 1;
  const from = d.from === null ? g.now : Math.max(g.now, d.from);
  const answers: RfpAnswer[] = [];
  for (const l of lessorLines(g, d)) {
    if (!l.ok && !l.kind) continue; // looked lately: not asked
    if (!l.ok) {
      answers.push({ lessorId: l.def.id, due: g.now, at: g.now, kind: l.kind, text: l.why });
      bump(g, l.kind!);
      continue;
    }
    const r = leasingSide(g, `rfp:${id}:${l.def.id}`);
    answers.push({ lessorId: l.def.id, due: g.now + Math.max(1, Math.round(int(r, rr[0], rr[1]) * x)) * DAY });
  }
  const rfp: Rfp = {
    id, typeId: d.typeId, band: d.band, months: d.months, count: d.count, from, asap: d.from === null, flex: d.flex,
    sent: g.now, replyBy: Math.max(...answers.map((a) => a.due)), answers, status: 'open',
  };
  L.rfps.push(rfp);
  L.stats.rfps++;
  if (X().types.includes(d.typeId)) (L.exotic ??= { rfps: 0, proposals: 0 }).rfps++;
  touch(g);
  pushMessage(g, {
    tone: 'info', cat: 'company', topic: 'market', cue: null, title: `Request sent: ${t.short}`,
    body: `${p.text}. ${d.count > 1 ? `${d.count} aircraft, ` : ''}${d.band === 'new' ? 'new build' : d.band === 'mid' ? 'mid-life' : d.band}, ${d.months} months, ${rfp.asap ? 'as soon as possible' : `from ${fmtDay(from)}`}.`,
    ref: { kind: 'rfp', id },
  });
  return { ok: true, msg: `Request sent to ${p.goesTo} lessor${p.goesTo === 1 ? '' : 's'}`, data: { rfpId: id } };
}

const touch = (g: GameState) => {
  if (g.leasing) g.leasing.rev = (g.leasing.rev ?? 0) + 1;
};
const bump = (g: GameState, kind: string) => {
  const s = g.leasing!.stats.answers;
  s[kind] = (s[kind] ?? 0) + 1;
};

/** Withdraws an open request (answers not yet in are dropped; proposals already in stay on offer). Our action: quiet. */
export function withdrawRfp(g: GameState, rfpId: string): ActionResult {
  const r = g.leasing?.rfps.find((x) => x.id === rfpId);
  if (!r || r.status !== 'open') return { ok: false, error: 'Request not found' };
  r.status = 'withdrawn';
  r.answers = r.answers.filter((a) => a.at !== undefined);
  touch(g);
  return { ok: true, msg: 'Request withdrawn' };
}

/** The `window` factor of a start this many days away (§D.3). Pure. */
export function windowX(days: number): number {
  for (const [lim, x] of R().window) if (days < lim) return x;
  return 1;
}

/** Signed work that needs a widebody from the handover to 60 days after it (§D.3 `work`). Pure. */
export function wideWorkInHand(g: GameState, at: Minute): boolean {
  return Object.values(g.contracts).some((c) => (c.status === 'signed' || c.status === 'active') && (c.requirements.body === 'wide' || c.requirements.minSeats >= 230) && c.start <= at + 60 * DAY && c.end >= at);
}

/** The chance a lessor has an aircraft for a request (§D.3 step 5, §T floor). Pure. */
export function aircraftChance(g: GameState, rfp: Pick<Rfp, 'typeId' | 'from' | 'asap'>, def: LessorDef): number {
  const t = typeOf(rfp.typeId);
  const app = def.appetite[t.body] ?? 0;
  const days = rfp.asap ? 0 : Math.max(0, (rfp.from - g.now) / DAY);
  const work = t.body === 'wide' ? (wideWorkInHand(g, rfp.from) ? R().work.inHand : R().work.none) : 1;
  const gx = BAL.v017.credit.chanceX[rating(g).grade] ?? 1;
  let p = Math.max(0, Math.min(R().pMax, app * (1 - tightNow(g, rfp.typeId)) * windowX(days) * work * gx));
  if (X().types.includes(rfp.typeId) && aircraftGate(g, rfp.typeId).ok) p = Math.max(p, X().classics.includes(rfp.typeId) ? X().floor.classic : X().floor.default);
  return p;
}

/** New builds: the earliest handover (§J.2). Pure. */
function earliestNew(g: GameState, typeId: string): Minute {
  const NB = BAL.v017.newBuild;
  const y = NB.earliestYear[typeId];
  const lead = (NB.lead[typeId] ?? NB.lead.narrow) as [number, number] | number;
  const lo = typeof lead === 'number' ? lead : lead[0];
  const t = g.now + lo * DAY;
  if (!y) return t;
  return Math.max(t, Date.UTC(y, 0, 1) / 60_000);
}

/** The term a lessor offers on a band: the request's, moved into the band's range (end-of-life lessors take 12). Pure. */
function termFor(def: LessorDef, band: AgeBand, months: number): number {
  const [lo, hi] = BAL.v017.terms.termsByBand[band];
  const min = band === 'old' && (def.tier === 'endOfLife' || def.tier === 'midLife') ? 12 : lo;
  return Math.max(min, Math.min(hi, months));
}

/** Builds one proposal (§D.4) for a request from a lessor, on its stream. */
function makeProposal(g: GameState, rfp: Rfp, def: LessorDef, r: RngHolder, later: boolean): AircraftOffer | null {
  const t = typeOf(rfp.typeId);
  const now = yearOf(g.now);
  const newBuild = rfp.band === 'new';
  const classic = X().classics.includes(t.id);
  const years = bandYears(g, t, rfp.band);
  if (!years) return null;
  const o = makeOffer(g, t, newBuild ? { newBuild: true } : classic ? { kind: 'buy' } : { lease: true });
  if (newBuild && !o.newBuild) return null;
  const grade = rating(g).grade;
  // Built year inside the band (at C a widebody 15 years or older).
  let hi = years[1];
  if (t.body === 'wide' && grade === 'C' && !X().types.includes(t.id)) hi = Math.min(hi, now - BAL.v017.credit.wideMinAgeC);
  const built = newBuild ? o.builtYear : int(r, years[0], Math.max(years[0], hi));
  const age = Math.max(0, now - built);
  // When it is free: stored now (every as-soon-as-possible proposal), else with its airline until about the date asked.
  const stored = rfp.asap || chance(r, R().stored[t.body === 'wide' ? 'wide' : 'narrow']);
  const flexDays = rfp.flex ? int(r, -R().flexDays, R().flexDays) : 0;
  const laterDays = int(r, R().later[0], R().later[1]);
  let freeAt: Minute;
  if (newBuild) freeAt = Math.max(rfp.from, earliestNew(g, t.id)) + int(r, 0, 60) * DAY;
  else if (later) freeAt = Math.max(g.now, rfp.from) + laterDays * DAY;
  else if (stored) freeAt = g.now;
  else freeAt = Math.max(g.now + 7 * DAY, rfp.from + flexDays * DAY);
  // The airline it flies with (the previous operator, or a lessor's lessee with a known hub).
  const ops = (EX_OPERATORS[t.id] ?? []).filter((x) => AIRPORT_BY_CODE[x.hub] && runwayFit(t.id, x.hub) !== 'no');
  const exop = def.id === 'exop' ? (ops.length ? pick(r, ops) : null) : !stored && !newBuild && ops.length && chance(r, 0.5) ? pick(r, ops) : null;
  if (def.id === 'exop' && !exop) return null;
  const depMonths = depositMonthsFor(rating(g)) + (newBuild ? BAL.v017.newBuild.extraDepositMonths : 0);
  const index = t.body === 'wide' ? g.market.wideIndex : g.market.narrowIndex;
  const rent0 = newBuild
    ? Math.round(((t.rentNew ?? t.rentMonth) * range(r, BAL.v017.newBuild.rentX[0], BAL.v017.newBuild.rentX[1]) * index) / 1000) * 1000
    : floorRent(t, Math.round((rentForAge(t, age) * range(r, BAL.v017.terms.noise[0], BAL.v017.terms.noise[1]) * index) / 1000) * 1000);
  const months = classic ? 0 : termFor(def, rfp.band, rfp.months);
  const priceX = range(r, X().sale.priceX[0], X().sale.priceX[1]);
  o.builtYear = built;
  o.lessor = def.id === 'exop' && exop ? exop.airline : def.name;
  if (classic) o.lessor = `${o.lessor} (used sale)`;
  o.lessorId = def.id;
  o.source = 'proposal';
  o.rfpId = rfp.id;
  o.band = rfp.band;
  o.grade = grade;
  o.freeAt = freeAt;
  if (later) o.later = true;
  if (exop) {
    o.exOperator = exop.airline;
    o.site = exop.hub;
    o.where = `${def.id === 'exop' || !stored ? '' : 'ex-'}${exop.airline}, ${AIRPORT_BY_CODE[exop.hub].city} (${exop.hub})`;
  } else if (o.exOperator && stored) delete o.exOperator;
  const valid = R().valid[newBuild ? 'newBuild' : t.body === 'wide' ? 'wide' : 'narrow'];
  o.validUntil = g.now + valid * DAY;
  o.expires = o.validUntil;
  o.created = g.now;
  const price = classic ? Math.round((t.valueUsed * priceX * Math.max(0.3, 1 - age * 0.03)) / 10_000) * 10_000 : 0;
  Object.assign(o, {
    kind: classic ? 'buy' : 'dryLeaseIn',
    rentPerMonth: classic ? 0 : rent0,
    reservesPerFH: classic ? 0 : o.reservesPerFH,
    leaseMonths: months,
    price,
    deposit: classic ? price : depMonths * rent0,
  } satisfies Partial<AircraftOffer>);
  Object.assign(o, quoteTerms(g, {
    offerId: o.id, typeId: t.id, kind: o.kind, builtYear: built, newBuild, source: 'proposal', lessorId: def.id, band: rfp.band, monthsWanted: rfp.months, grade,
    rentPerMonth: o.rentPerMonth, reservesPerFH: o.reservesPerFH, leaseMonths: o.leaseMonths, deposit: o.deposit, price: o.price,
  }));
  if (!classic) {
    o.depositMonths ??= depMonths;
    o.minFH ??= BAL.v017.terms.minFH[t.body === 'wide' ? 'wide' : 'narrow'];
    o.halfLifeShare ??= BAL.v017.terms.halfLife[rfp.band] ?? 0.5;
  }
  // The legacy lead (the market card's "handover in …"): until free plus a typical transition.
  o.leadDays = Math.max(1, Math.round((freeAt - g.now) / DAY) + (newBuild ? 0 : t.body === 'wide' ? 48 : 31));
  return o;
}

/** One lessor's answer to a request, due today (§D.3). */
function answer(g: GameState, rfp: Rfp, a: RfpAnswer): void {
  const L = g.leasing!;
  const def = LESSOR_BY_ID[a.lessorId as LessorId];
  a.at = g.now;
  if (!def) {
    a.kind = 'none';
    return;
  }
  const t = typeOf(rfp.typeId);
  const name = def.id === 'exop' ? exOpName(rfp.typeId) : def.name;
  const st = lessorStance(g, def, rfp.typeId, rfp.band, def.name);
  if (!st.ok) {
    a.kind = st.kind;
    a.text = st.text;
    bump(g, st.kind ?? 'credit');
    return;
  }
  if (rfp.band === 'new') {
    const e = earliestNew(g, rfp.typeId);
    if (rfp.asap || e > rfp.from + 365 * DAY) {
      a.kind = 'placed';
      a.text = `Our ${t.short} deliveries are placed until ${yearOf(e)}`;
      bump(g, 'placed');
      return;
    }
  }
  const r = leasingSide(g, `rfp:${rfp.id}:${def.id}`);
  int(r, 0, 1); // the reply-day roll made at sending
  const p = aircraftChance(g, rfp, def);
  const ids: string[] = [];
  for (let k = 0; k < rfp.count; k++) {
    const pk = p * (k === 0 ? 1 : R().extra[k - 1] ?? 0);
    if (!chance(r, pk)) break;
    // Within the lessor's cap (the deals signed from these count when they are).
    const st2 = lessorStance(g, def, rfp.typeId, rfp.band, def.name);
    if (!st2.ok && k > 0) break;
    const o = makeProposal(g, rfp, def, leasingSide(g, `rfp:${rfp.id}:${def.id}:${k}`), false);
    if (!o) break;
    g.market.aircraft.push(o);
    ids.push(o.id);
  }
  if (ids.length) {
    a.kind = 'proposal';
    a.offerIds = ids;
    a.text = `${ids.length} proposal${ids.length > 1 ? 's' : ''}`;
    bump(g, 'proposal');
    if (X().types.includes(rfp.typeId)) (L.exotic ??= { rfps: 0, proposals: 0 }).proposals += ids.length;
    return;
  }
  if (chance(r, R().laterShare)) {
    const o = makeProposal(g, rfp, def, leasingSide(g, `rfp:${rfp.id}:${def.id}:later`), true);
    if (o) {
      g.market.aircraft.push(o);
      a.kind = 'later';
      a.offerIds = [o.id];
      a.text = `Nothing for ${rfp.asap ? 'now' : fmtDay(rfp.from)}; one from ${fmtDay(o.freeAt ?? g.now)}`;
      bump(g, 'later');
      return;
    }
  }
  a.kind = 'none';
  a.text = 'No aircraft that fits';
  L.quiet[`${def.id}:${rfp.typeId}`] = g.now + R().quietDays * DAY;
  bump(g, 'none');
  void name;
}

const KIND_WORD: Record<string, string> = { none: 'had nothing', credit: "won't consider us (rating)", exposure: 'at their limit with us', placed: 'fully placed', blocked: 'still owed rent', later: 'later than asked' };

/** Daily: answers due today (§D.2–§D.3), the summary message when the last is in; lapsed proposals leave the market. */
export function dailyRfps(g: GameState): void {
  const L = g.leasing;
  if (!L) return;
  g.market.aircraft = g.market.aircraft.filter((o) => o.source !== 'proposal' || (o.validUntil ?? o.expires) > g.now);
  let changed = false;
  for (const rfp of L.rfps) {
    if (rfp.status !== 'open' || rfp.spot) continue;
    for (const a of rfp.answers) {
      if (a.at !== undefined || a.due > g.now) continue;
      answer(g, rfp, a);
      changed = true;
    }
    if (rfp.answers.every((a) => a.at !== undefined)) {
      rfp.status = 'done';
      changed = true;
      summary(g, rfp);
    }
  }
  // Requests closed over 90 days ago leave the list.
  L.rfps = L.rfps.filter((r) => r.status === 'open' || r.replyBy > g.now - 90 * DAY);
  if (changed) touch(g);
}

/** 'A330-200 request: 2 proposals (AerCap, Carlyle) · 4 had nothing · 1 won't consider us (rating)'. */
function summary(g: GameState, rfp: Rfp): void {
  const t = typeOf(rfp.typeId);
  const who = (id: string) => (id === 'exop' ? 'the previous operator' : (LESSOR_BY_ID[id as LessorId]?.name ?? id).split(' ')[0]);
  const props = rfp.answers.filter((a) => a.kind === 'proposal');
  const n = props.reduce((s, a) => s + (a.offerIds?.length ?? 0), 0);
  const parts: string[] = [];
  if (n) parts.push(`${n} proposal${n > 1 ? 's' : ''} (${props.map((a) => who(String(a.lessorId))).join(', ')})`);
  const by: Record<string, number> = {};
  for (const a of rfp.answers) if (a.kind && a.kind !== 'proposal') by[a.kind] = (by[a.kind] ?? 0) + 1;
  for (const [k, c] of Object.entries(by)) parts.push(`${c} ${KIND_WORD[k] ?? k}`);
  pushMessage(g, {
    tone: n ? 'good' : 'info', cat: 'company', topic: 'market', cue: n ? 'offerNew' : null,
    title: `${t.short} request: ${n ? `${n} proposal${n > 1 ? 's' : ''}` : by.later ? 'later than asked' : 'no proposal'}`,
    body: `${parts.join(' · ')}.${n ? ' On Fleet › Market › Offers.' : by.later ? ' The later ones are on Fleet › Market › Offers.' : ' Try another age, a later start, or ask again in a month.'}`,
    ref: { kind: 'rfp', id: rfp.id },
  });
}
