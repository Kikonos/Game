// v0.17 Fleet › Market (UPDATE-0.17.md §N; lane `market-ui`): the pure wording and grouping behind the Offers,
// Requests and In progress views, the rating line and the fleet card's transition line. No React, no store: tested in
// marketLogic.test.ts.

import { LESSOR_BY_ID } from '../../../data/lessors';
import { AIRPORT_BY_CODE } from '../../../data/airports';
import { BAL } from '../../../engine/core/balance';
import { typeOf } from '../../../engine/core/perf';
import { DAY, fmtDay, fmtDayAt, yearOf } from '../../../engine/core/time';
import type { Aircraft, AircraftOffer, CreditGrade, GameState, LeaseDeal, LessorRating, Minute, Rfp, RfpAnswer } from '../../../engine/core/types';
import { siteCity } from '../../../engine/ops/market';
import { money } from '../../format';

/** '12 Jan', or '12 Jan 2028' outside the current year. */
const dayIn = (now: Minute, t: Minute) => (yearOf(t) === yearOf(now) ? fmtDay(t) : `${fmtDay(t)} ${yearOf(t)}`);

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Type name without the maker: 'A330-200', '767-300ER'. */
export const tName = (typeId: string) => typeOf(typeId).name.replace(/^(Airbus|Boeing) /, '');

// ---------- offers ----------

export type OfferFilter = 'all' | 'narrow' | 'wide' | 'spot' | 'bunks';

/** The badge on an offer card (§N.2 line 1): where it came from. Legacy offers (no source) keep the v0.7 words. */
export function sourceBadge(o: Pick<AircraftOffer, 'source' | 'kind' | 'newBuild' | 'later'>): { label: string; tone: string } {
  if (o.kind === 'buy') return { label: o.source === 'batch' ? 'Batch · for sale' : 'For sale', tone: 'gold' };
  switch (o.source) {
    case 'proposal': return { label: o.later ? 'Proposal · later' : 'Proposal', tone: 'good' };
    case 'batch': return { label: 'Batch', tone: 'warn' };
    case 'spot': return { label: 'Short-term', tone: 'accent' };
    case 'newBuild': return { label: 'New build', tone: 'accent' };
    case 'call': return { label: 'Lessor call', tone: 'info' };
  }
  if (o.newBuild) return { label: 'New-build lease', tone: 'accent' };
  return { label: 'Lease used', tone: 'info' };
}

/** Deposit months of an offer: as quoted, else the deposit over the rent. */
export function depositMonthsOf(o: Pick<AircraftOffer, 'depositMonths' | 'deposit' | 'rentPerMonth'>): number {
  if (o.depositMonths) return o.depositMonths;
  return o.rentPerMonth > 0 ? Math.max(1, Math.round(o.deposit / o.rentPerMonth)) : 0;
}

/** §N.2 line 2: '$287K/month · 36 months · deposit 2 months ($574K)', or 'Price $38.5M'. */
export function offerTermsLine(o: Pick<AircraftOffer, 'kind' | 'rentPerMonth' | 'leaseMonths' | 'deposit' | 'depositMonths' | 'price'>): string {
  if (o.kind !== 'dryLeaseIn') return `Price ${money(o.price)}`;
  const m = depositMonthsOf(o);
  return `${money(o.rentPerMonth)}/month · ${o.leaseMonths} months · deposit ${plural(m, 'month')} (${money(o.deposit)})`;
}

/** Whether an offer's aircraft is still flying with its airline (proposals: `freeAt` a week or more away). */
export const stillFlying = (now: Minute, o: Pick<AircraftOffer, 'freeAt'>) => (o.freeAt ?? 0) > now + 7 * DAY;

/**
 * §N.2 line 3: 'Ready ~12 Mar at Shannon · home ~16 Mar', or 'With Air Europa until 20 May · ready ~2 Jul' when the
 * aircraft is still flying with its airline. `ready`: the handover after the transition; `home`: after the ferry.
 */
export function offerReadyLine(now: Minute, o: Pick<AircraftOffer, 'freeAt' | 'exOperator' | 'site' | 'spot'>, ready: Minute, home: Minute | null): string {
  const site = o.spot ? o.spot.base : o.site;
  const at = site ? siteCity(site) : 'our base';
  const tail = home && home > ready + DAY / 2 ? ` · home ~${dayIn(now, home)}` : '';
  if (stillFlying(now, o)) return `With ${o.exOperator ?? 'its airline'} until ${dayIn(now, o.freeAt!)} · ready ~${dayIn(now, ready)}${tail}`;
  return `Ready ~${dayIn(now, ready)} at ${at}${tail}`;
}

/** The filter chips (§N.1). `bunks`: the v0.7.3 'Has bunks' test, passed in (it reads the crew module). */
export function offerMatches(o: Pick<AircraftOffer, 'typeId' | 'source' | 'spot'>, f: OfferFilter, bunks: boolean): boolean {
  switch (f) {
    case 'narrow': return typeOf(o.typeId).body !== 'wide';
    case 'wide': return typeOf(o.typeId).body === 'wide';
    case 'spot': return o.source === 'spot' || !!o.spot;
    case 'bunks': return bunks;
  }
  return true;
}

/** Days left on an offer ('Open 6 more days'), from its validity. */
export function offerDaysLeft(now: Minute, o: Pick<AircraftOffer, 'validUntil' | 'expires'>): number {
  return Math.max(0, Math.ceil(((o.validUntil ?? o.expires) - now) / DAY));
}

/** The lessor's display name ('AerCap'; 'Air Lease Corporation' with its new name in the tooltip). */
export function lessorLabel(o: Pick<AircraftOffer, 'lessor' | 'lessorId'>): { name: string; tip?: string } {
  const name = o.lessor.replace(/ \(used sale\)$/, '');
  const def = o.lessorId ? LESSOR_BY_ID[o.lessorId] : undefined;
  return def?.note ? { name, tip: def.note } : { name };
}

// ---------- the rating line ----------

const GRADE_SHORT: Record<CreditGrade, string> = { A: 'strong', B: 'sound', C: 'start-up', D: 'weak' };

/** §N.1 'Lessor rating C · start-up · deposit 3 months'. */
export function ratingLine(r: Pick<LessorRating, 'grade'>, depositMonths: number): string {
  return `Lessor rating ${r.grade} · ${GRADE_SHORT[r.grade]} · deposit ${plural(depositMonths, 'month')}`;
}

/** The Why? popover's rows, biggest effect first, zero rows last ('+14', '−25', '0'). */
export function ratingParts(r: Pick<LessorRating, 'parts' | 'score'>): { label: string; pts: string; tone: 'good' | 'bad' | '' }[] {
  return [...r.parts]
    .sort((a, b) => Math.abs(b.pts) - Math.abs(a.pts))
    .map((p) => ({ label: p.label, pts: p.pts > 0 ? `+${p.pts}` : p.pts < 0 ? `−${Math.abs(p.pts)}` : '0', tone: p.pts > 0 ? 'good' as const : p.pts < 0 ? 'bad' as const : '' as const }));
}

// ---------- requests ----------

const ANSWER_WORD: Record<NonNullable<RfpAnswer['kind']>, string> = {
  proposal: 'proposal', later: 'later than asked', none: 'no aircraft', credit: 'rating', exposure: 'at its limit', placed: 'placed', blocked: 'still owed',
};

/** A lessor or an airline answering a request ('AerCap', 'Cebu Pacific', 'The previous operator'). */
export function answerName(a: Pick<RfpAnswer, 'lessorId'>, typeId?: string): string {
  const def = LESSOR_BY_ID[a.lessorId as keyof typeof LESSOR_BY_ID];
  if (!def) return a.lessorId;
  if (def.id === 'exop' && typeId && BAL.v017.exotic.classics.includes(typeId)) return 'Owners in storage';
  return def.id === 'exop' ? 'The previous operator' : def.name;
}

/** One answer chip: 'AerCap ✓ proposal' · 'Avolon: no aircraft' · 'Carlyle: rating' · 'Doric: due 14 Mar'. */
export function answerChip(now: Minute, a: RfpAnswer, typeId?: string): { text: string; tone: 'good' | 'warn' | 'bad' | ''; tip?: string } {
  const name = answerName(a, typeId);
  if (a.at === undefined || !a.kind) return { text: `${name}: by ${dayIn(now, a.due)}`, tone: '' };
  const n = a.offerIds?.length ?? 0;
  if (a.kind === 'proposal') return { text: `${name} ✓ ${n > 1 ? `${n} proposals` : 'proposal'}`, tone: 'good', ...(a.text ? { tip: a.text } : {}) };
  if (a.kind === 'later') return { text: `${name} ✓ later`, tone: 'good', ...(a.text ? { tip: a.text } : {}) };
  const tone = a.kind === 'none' ? '' : 'warn';
  return { text: `${name}: ${ANSWER_WORD[a.kind]}`, tone, ...(a.text ? { tip: a.text } : {}) };
}

/** The request card's title line: 'A330-200 · mid-life · 36 months · from 1 Jun (± a month) · 1 aircraft'. */
export function rfpTitle(now: Minute, r: Pick<Rfp, 'typeId' | 'band' | 'months' | 'from' | 'asap' | 'flex' | 'count' | 'spot'>): string {
  const band = r.spot ? 'short-term' : r.band === 'mid' ? 'mid-life' : r.band === 'new' ? 'new build' : r.band;
  const from = r.asap ? 'as soon as possible' : `from ${dayIn(now, r.from)}${r.flex ? ' (± a month)' : ''}`;
  return `${tName(r.typeId)} · ${band} · ${r.months} months · ${from}${r.count > 1 ? ` · ${r.count} aircraft` : ''}`;
}

/** The request's state: 'Answers by 14 Mar · 2 of 5 in' / 'Done: 2 proposals' / 'Withdrawn'. */
export function rfpStatus(now: Minute, r: Pick<Rfp, 'status' | 'replyBy' | 'answers'>): string {
  const inn = r.answers.filter((a) => a.at !== undefined).length;
  const props = r.answers.reduce((s, a) => s + (a.kind === 'proposal' || a.kind === 'later' ? a.offerIds?.length || 1 : 0), 0);
  if (r.status === 'withdrawn') return 'Withdrawn';
  if (r.status === 'done') return props ? `Answered: ${plural(props, 'proposal')}` : 'Answered: nothing that fits';
  return `Answers by ${dayIn(now, r.replyBy)} · ${inn} of ${r.answers.length} in${props ? ` · ${plural(props, 'proposal')}` : ''}`;
}

/** Requests shown: open first, then answered or withdrawn in the last 60 days, newest first. */
export function rfpsShown(now: Minute, list: readonly Rfp[]): Rfp[] {
  const recent = (r: Rfp) => r.status === 'open' || r.sent > now - 60 * DAY;
  return list.filter(recent).sort((a, b) => (a.status === 'open' ? 0 : 1) - (b.status === 'open' ? 0 : 1) || b.sent - a.sent);
}

// ---------- in progress ----------

export type StageKey = 'loi' | 'credit' | 'lease' | 'transition' | 'ferry';
export interface StageChip { key: StageKey; label: string; state: 'done' | 'now' | 'next' | 'bad' }

const STAGES: [StageKey, string][] = [['loi', 'LOI'], ['credit', 'Credit check'], ['lease', 'Lease'], ['transition', 'Transition'], ['ferry', 'Ferry']];

/** §N.1 stage chips 'LOI ✓ · Credit check · Lease · Transition · Ferry' for a deal or a delivering aircraft. */
export function stageChips(at: StageKey, bad = false): StageChip[] {
  const i = STAGES.findIndex(([k]) => k === at);
  return STAGES.map(([key, label], j) => ({ key, label: j < i ? `${label} ✓` : label, state: j < i ? 'done' : j === i ? (bad ? 'bad' : 'now') : 'next' }));
}

/** A deal's stage key and its line: 'Credit check · answer by 14 Mar' / 'More security asked · by 9 Mar'. */
export function dealLine(now: Minute, d: Pick<LeaseDeal, 'stage' | 'committeeAt' | 'conditions' | 'signBy' | 'endedAt' | 'why' | 'holding'>): { at: StageKey; text: string; tone: '' | 'warn' | 'bad' | 'good' } {
  switch (d.stage) {
    case 'committee': return { at: 'credit', text: `Credit check · answer by ${dayIn(now, d.committeeAt)}`, tone: '' };
    case 'conditions': return { at: 'credit', text: `More security asked · answer by ${dayIn(now, d.conditions?.until ?? now)}`, tone: 'warn' };
    case 'approved': return { at: 'lease', text: `Approved · sign by ${dayIn(now, d.signBy ?? now)}`, tone: 'warn' };
    case 'signed': return { at: 'transition', text: 'Lease signed', tone: 'good' };
    case 'declined': return { at: 'credit', text: `Declined${d.why ? `: ${d.why}` : ''} · holding deposit back`, tone: 'bad' };
    case 'walked': return { at: 'lease', text: `Walked away${d.why ? `: ${d.why}` : ''}`, tone: 'bad' };
  }
}

/** The transition step in player words ('records review', 'check', 'paint', 'acceptance flight', 'waiting for our CAMO'). */
export const STEP_WORD: Record<'waiting' | 'records' | 'check' | 'paint' | 'acceptance' | 'done', string> = {
  waiting: 'waiting for our CAMO', records: 'records review', check: 'transition check', paint: 'paint', acceptance: 'acceptance flight', done: 'done',
};

/**
 * §N.1 the fleet card's line while in transition: 'Transition at Shannon: transition check · ready 14 Mar (UTC) ·
 * 15 Mar local' (local only when the day differs).
 */
export function transitionLine(ac: Pick<Aircraft, 'induction' | 'at' | 'delivery'>, step: keyof typeof STEP_WORD): string | null {
  const i = ac.induction;
  if (!i) return null;
  const site = ac.delivery?.site ?? ac.at;
  const where = site ? siteCity(site) : 'the site';
  const utc = fmtDay(i.ready);
  const local = site && AIRPORT_BY_CODE[site] ? fmtDayAt(site, i.ready) : utc;
  return `Transition at ${where}: ${STEP_WORD[step]} · ready ${utc} (UTC)${local !== utc ? ` · ${local} local` : ''}`;
}

/** §N.1 a short-term aircraft's line: 'Back to TUI fly 31 Mar'. */
export function spotLine(ac: Pick<Aircraft, 'ownership'>): string | null {
  const o = ac.ownership;
  if (o.kind !== 'dryLeaseIn' || !o.spot) return null;
  return `Back to ${o.spot.airline} ${fmtDay(o.leaseEnd)}`;
}

/** The segmented control's counts (§N.1): offers on the market, open requests, deals and transitions in progress. */
export function marketCounts(g: GameState, offers: number): { offers: number; requests: number; progress: number } {
  const L = g.leasing;
  const requests = (L?.rfps ?? []).filter((r) => r.status === 'open').length;
  const deals = (L?.deals ?? []).filter((d) => d.stage === 'committee' || d.stage === 'conditions' || d.stage === 'approved').length;
  const trans = Object.values(g.fleet).filter((a) => a.status === 'delivering').length;
  return { offers, requests, progress: deals + trans };
}

/** 'Exotic' types worth the What it takes block (§T): the BAL list. */
export const isExoticType = (typeId: string) => BAL.v017.exotic.types.includes(typeId);
