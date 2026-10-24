// v0.8 client relationships and company standing (UPDATE-0.8.md §1). One number per client (`relation`, −100…100)
// drives a stored level with hysteresis (Unhappy · New · Known · Trusted · Partner); every change goes through
// bumpClient (a short plain-language log). Company standing (Newcomer → Established → Respected) gates the work a
// new company is offered. Views are pure; the daily/load hooks and bumpClient are action-side.

import { clientVoice } from '../../data/clientVoice';
import { BAL } from '../core/balance';
import { pushMessage } from '../core/messages';
import { DAY, fmtDay, fmtMonth, monthKey } from '../core/time';
import { clamp } from '../core/util';
import type { Client, ClientKind, ClientLevel, Contract, GameState, Minute, ProblemRef } from '../core/types';

export type { ClientLevel };

const V = BAL.v08;
export type LevelPerks = (typeof V.perks)[ClientLevel];
export const LEVEL_PERKS: Record<ClientLevel, LevelPerks> = V.perks;
export const LEVEL_NAME: Record<ClientLevel, string> = { unhappy: 'Unhappy', new: 'New', known: 'Known', trusted: 'Trusted', partner: 'Partner' };
export const LEVEL_ORDER: ClientLevel[] = ['unhappy', 'new', 'known', 'trusted', 'partner'];
const rank = (l: ClientLevel) => LEVEL_ORDER.indexOf(l);

const pct = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.round(Math.abs(v) * 100)} %`;
const r1 = (v: number) => Math.round(v * 10) / 10;

// ---------- levels ----------

const live = (c: Contract) => c.status === 'signed' || c.status === 'active';

/** Signed or active contracts for the client. Pure. */
function activeFor(g: GameState, clientId: string): Contract[] {
  return Object.values(g.contracts).filter((c) => c.clientId === clientId && live(c));
}

/**
 * The level the client is at now (§1.2), from `cur` with hysteresis (no `cur`: the plain thresholds, as a load).
 * Unhappy below −15 (−25 once Known); back at −5. Trusted from 30 and 2 jobs (kept to 20); Partner from 60 and 4
 * jobs (kept to 50). Pure.
 */
export function levelFor(g: GameState, c: Client, cur: ClientLevel | undefined = c.level): ClientLevel {
  const L = V.levels;
  const rel = c.relation;
  const jobs = c.jobs ?? 0;
  const base: ClientLevel = jobs >= 1 || activeFor(g, c.id).length ? 'known' : 'new';
  if (cur === 'unhappy' && rel < L.unhappyBack) return 'unhappy';
  const knownPlus = cur === 'known' || cur === 'trusted' || cur === 'partner';
  if (rel < (knownPlus ? L.knownDown : L.unhappy)) return 'unhappy';
  const h = L.hysteresis;
  if (rel >= L.partner[0] && jobs >= L.partner[1]) return 'partner';
  if (cur === 'partner' && rel >= L.partner[0] - h && jobs >= L.partner[1]) return 'partner';
  if (rel >= L.trusted[0] && jobs >= L.trusted[1]) return 'trusted';
  if ((cur === 'partner' || cur === 'trusted') && rel >= L.trusted[0] - h && jobs >= L.trusted[1]) return 'trusted';
  return base;
}

/** The client's stored level (computed for a client the daily pass has not seen yet). Pure. */
export const levelOf = (g: GameState, c: Client | undefined): ClientLevel => (c ? c.level ?? levelFor(g, c) : 'new');

/** The perks of a client's level. Pure. */
export const perksOf = (g: GameState, clientId: string): LevelPerks => LEVEL_PERKS[levelOf(g, g.clients[clientId])];

/**
 * The one writer of client relations: clamps, keeps the last 8 changes with a plain reason (changes for the same
 * reason on the same day are merged) and never posts a message. Action-side.
 */
export function bumpClient(g: GameState, clientId: string | undefined, delta: number, why: string): void {
  const c = clientId ? g.clients[clientId] : undefined;
  if (!c || !delta) return;
  const was = c.relation;
  c.relation = clamp(Math.round((c.relation + delta) * 100) / 100, -100, 100);
  const d = c.relation - was;
  if (!d || !why) return;
  const log = (c.log ??= []);
  const last = log[log.length - 1];
  if (last && last[2] === why && Math.floor(last[0] / DAY) === Math.floor(g.now / DAY)) last[1] = Math.round((last[1] + d) * 100) / 100;
  else log.push([g.now, Math.round(d * 100) / 100, why]);
  if (log.length > 8) log.splice(0, log.length - 8);
}

/** A completed job for the client (accept.ts completeContract). */
export function noteJobDone(g: GameState, clientId: string): void {
  const c = g.clients[clientId];
  if (!c) return;
  c.jobs = (c.jobs ?? 0) + 1;
  c.firstJob ??= g.now;
  c.lastJob = g.now;
}

/**
 * A small delay by our fault that a Trusted / Partner client lets go this month (§1.4): true and counted when one
 * is left. Action-side.
 */
export function forgiveDelay(g: GameState, clientId: string): boolean {
  const c = g.clients[clientId];
  if (!c) return false;
  const n = perksOf(g, clientId).forgive;
  if (!n) return false;
  const k = monthKey(g.now);
  const used = c.forgiven && c.forgiven[0] === k ? c.forgiven[1] : 0;
  if (used >= n) return false;
  c.forgiven = [k, used + 1];
  return true;
}

// ---------- texts ----------

/** What a level brings, as plain lines. Pure. */
export function perkLines(level: ClientLevel): string[] {
  const p = LEVEL_PERKS[level];
  const out: string[] = [];
  if (p.rate) out.push(`${pct(p.rate)} on their rates`);
  if (p.offers !== 1) out.push(p.offers < 1 ? 'They call about a third as often' : `They call about ${p.offers.toFixed(1)}× as often`);
  if (p.length > 1) out.push(`Longer programmes (×${p.length}) and ${Math.round(p.mgh * 100)} % more guaranteed hours`);
  if (p.first) out.push('First refusal: they ask us before any rival');
  if (p.payDays) out.push(`They pay ${p.payDays} days sooner and more reliably`);
  if (p.forgive) out.push(`${p.forgive} small delay${p.forgive > 1 ? 's' : ''} a month forgiven`);
  if (p.repeat) out.push(`${Math.round(p.repeat * 100)} % chance of repeat business after a job`);
  if (level === 'partner') out.push('Exclusive capacity leases');
  if (level === 'unhappy') out.push('No delays forgiven');
  if (!out.length) out.push('Normal rates and terms');
  return out;
}

/** The next level and what it needs ('one more job and relation 30 (now 26)'). Pure. */
export function nextLevel(g: GameState, c: Client): { level: ClientLevel; need: string } | null {
  const L = V.levels;
  const lv = levelOf(g, c);
  const jobs = c.jobs ?? 0;
  const rel = Math.round(c.relation);
  const parts = (relNeed: number, jobsNeed: number) => {
    const p: string[] = [];
    if (jobs < jobsNeed) p.push(jobsNeed - jobs === 1 ? 'one more job' : `${jobsNeed - jobs} more jobs`);
    if (rel < relNeed) p.push(`relation ${relNeed} (now ${rel})`);
    return p.join(' and ') || 'keep it up';
  };
  switch (lv) {
    case 'unhappy': return { level: jobs ? 'known' : 'new', need: `relation ${L.unhappyBack} (now ${rel})` };
    case 'new': return { level: 'known', need: 'a first job for them' };
    case 'known': return { level: 'trusted', need: parts(L.trusted[0], L.trusted[1]) };
    case 'trusted': return { level: 'partner', need: parts(L.partner[0], L.partner[1]) };
    default: return null;
  }
}

/** The favour chip on a change request: 'Condor: Known → 26/30 to Trusted' after `delta`. Pure. */
export function favourChip(g: GameState, clientId: string, delta: number): string {
  const c = g.clients[clientId];
  if (!c) return '';
  const nx = nextLevel(g, c);
  const lv = LEVEL_NAME[levelOf(g, c)];
  const rel = Math.round(c.relation + delta);
  const L = V.levels;
  const need = nx?.level === 'trusted' ? L.trusted[0] : nx?.level === 'partner' ? L.partner[0] : null;
  return nx && need !== null ? `${c.name}: ${lv} → ${rel}/${need} to ${LEVEL_NAME[nx.level]}` : `${c.name}: ${lv}, relation ${rel}`;
}

/** 'Fly their next job on time…' — why a client is unhappy, from the log's worst recent reasons. Pure. */
export function unhappyReasons(c: Client): string[] {
  return [...(c.log ?? [])].filter((x) => x[1] < 0).sort((a, b) => a[1] - b[1]).slice(0, 3).map((x) => x[2]);
}

// ---------- views ----------

export interface ClientView {
  id: string; name: string; kind: ClientKind; country: string; base: string;
  level: ClientLevel; levelName: string; relation: number;
  next: { level: ClientLevel; need: string } | null;
  perks: string[]; jobs: number; lastJob: Minute | null;
  active: string[]; offers: string[];
  log: { t: Minute; delta: number; text: string }[];
  unhappy: ProblemRef | null;
  rivalId?: string;
}

/** One client for the Clients view and ClientModal. Pure. */
export function clientView(g: GameState, clientId: string): ClientView | null {
  const c = g.clients[clientId];
  if (!c) return null;
  const level = levelOf(g, c);
  return {
    id: c.id, name: c.name, kind: c.kind, country: c.country, base: c.base,
    level, levelName: LEVEL_NAME[level], relation: Math.round(c.relation),
    next: nextLevel(g, c), perks: perkLines(level), jobs: c.jobs ?? 0, lastJob: c.lastJob ?? null,
    active: activeFor(g, c.id).map((k) => k.id),
    offers: Object.values(g.offers).filter((o) => o.clientId === c.id && (o.status === 'open' || o.status === 'countered')).map((o) => o.id),
    log: [...(c.log ?? [])].reverse().map(([t, delta, text]) => ({ t, delta: r1(delta), text })),
    unhappy: level === 'unhappy' ? { kind: 'clientUnhappy', ref: { kind: 'client', id: c.id } } : null,
    ...(c.rivalId ? { rivalId: c.rivalId } : {}),
  };
}

/** Clients for the list: working with us (a job done, a contract or an open offer), all, or unhappy; best first. Pure. */
export function clientList(g: GameState, filter: 'working' | 'all' | 'unhappy'): ClientView[] {
  const out: ClientView[] = [];
  for (const id of Object.keys(g.clients)) {
    const v = clientView(g, id)!;
    if (filter === 'unhappy' && v.level !== 'unhappy') continue;
    if (filter === 'working' && !v.jobs && !v.active.length && !v.offers.length) continue;
    out.push(v);
  }
  return out.sort((a, b) => rank(b.level) - rank(a.level) || b.relation - a.relation || a.name.localeCompare(b.name));
}

/** The chip for an offer card: 'Trusted · +8 %', 'New client', 'Unhappy · −5 %'. Pure. */
export function levelChip(level: ClientLevel): string {
  const r = LEVEL_PERKS[level].rate;
  return level === 'new' ? 'New client' : `${LEVEL_NAME[level]}${r ? ` · ${pct(r)}` : ''}`;
}

/** The client block of an offer (§1.8): level chip, the perks that apply to this offer, the progress line. Pure. */
export function offerClientLine(g: GameState, offerId: string): { level: ClientLevel; chip: string; lines: string[]; progress: string } | null {
  const o = g.offers[offerId];
  const c = o ? g.clients[o.clientId] : undefined;
  if (!o || !c) return null;
  const level = levelOf(g, c);
  const p = LEVEL_PERKS[level];
  const lines: string[] = [];
  const lp = o.levelPct ?? 0;
  if (lp) lines.push(`${pct(lp)} rate (${LEVEL_NAME[level]} client, included)`);
  if (o.standingPct) lines.push(`${pct(o.standingPct)} rate (${o.standingPct < 0 ? 'Newcomer' : 'Respected'} company, included)`);
  if (o.firstRefusal) lines.push('First refusal: no rival will take it before it expires');
  if (p.forgive) lines.push(`${p.forgive} small delay${p.forgive > 1 ? 's' : ''} a month forgiven`);
  if (p.payDays) lines.push(`Pays ${p.payDays} days sooner`);
  if (o.urgency === 'urgent') lines.push(`+${V.rel.urgentSign} relation for helping at short notice`);
  if (o.repeatOf) lines.push('Repeat business: they liked the last job');
  if (level === 'unhappy') lines.push('Unhappy client: no delays forgiven');
  const nx = nextLevel(g, c);
  const jobs = c.jobs ?? 0;
  const progress = `${jobs} job${jobs === 1 ? '' : 's'}, relation ${Math.round(c.relation)}${nx ? `: ${LEVEL_NAME[nx.level]} with ${nx.need}` : ': top level'}`;
  // The chip shows the rate this offer was priced with (the level may have moved since it was made).
  const chip = level === 'new' ? levelChip(level) : `${LEVEL_NAME[level]}${lp ? ` · ${pct(lp)}` : ''}`;
  return { level, chip, lines, progress };
}

// ---------- company standing (§1.6) ----------

export const STANDING_NAME = { 0: 'Newcomer', 1: 'Established', 2: 'Respected' } as const;

export interface Standing {
  tier: 0 | 1 | 2;
  name: 'Newcomer' | 'Established' | 'Respected';
  text: string;
  effects: string[];
  next: string | null;
  progress: { label: string; have: number; need: number }[];
}

/** What the record earns (no memory): Respected, Established or Newcomer. Pure. */
export function standingFor(g: GameState): 0 | 1 | 2 {
  const S = V.standing;
  const done = g.stats.contractsDone ?? 0;
  const days = (g.now - g.started) / DAY;
  const { reliable, clean } = g.company.reputation;
  if (done >= S.resp.done && days >= S.resp.days && reliable >= S.resp.reliable && clean >= S.resp.clean) return 2;
  if (done >= S.est.done && days >= S.est.days && reliable >= S.est.reliable) return 1;
  return 0;
}

/** The stored standing with its rules: never back to Newcomer; Respected drops only below reliable 60 / clean 40. Pure. */
export function standingNow(g: GameState): 0 | 1 | 2 {
  const cur = g.company.standing ?? standingFor(g);
  const want = standingFor(g);
  if (want > cur) return want;
  if (cur === 2) {
    const { reliable, clean } = g.company.reputation;
    return reliable < V.standing.respDown.reliable || clean < V.standing.respDown.clean ? 1 : 2;
  }
  return cur;
}

/** The rate part of company standing: Newcomer −8 %, Respected +4 %. Pure. */
export function standingRate(g: GameState): number {
  const s = g.company.standing ?? 0;
  return s === 0 ? V.standing.newcomerRate : s === 2 ? V.standing.respectedRate : 0;
}

const STANDING_EFFECTS: Record<0 | 1 | 2, string[]> = {
  0: ['Rates 8 % lower', 'Season bases of 30–45 days', 'Odd hours and unloved routes', 'Demanding clients', 'No VIP, presidential, UN, capacity-lease or Antarctic work'],
  1: ['Normal rates', 'Normal programmes at normal hours', 'VIP work; UN rotations once IOSA-registered'],
  2: ['Rates 4 % higher', 'Capacity leases of 6–12 months', 'Presidential and Antarctic work', 'Season bases up to 7 months'],
};
const STANDING_TEXT: Record<0 | 1 | 2, string> = {
  0: 'Short, low-margin work for now',
  1: 'Brokers send longer programmes at normal rates',
  2: 'The work other operators want comes to us',
};

/** The standing card: tier, what it brings, what is missing for the next. Pure. */
export function standing(g: GameState): Standing {
  const S = V.standing;
  const tier = (g.company.standing ?? standingFor(g)) as 0 | 1 | 2;
  const done = g.stats.contractsDone ?? 0;
  const days = Math.floor((g.now - g.started) / DAY);
  const { reliable, clean } = g.company.reputation;
  let progress: Standing['progress'] = [];
  let next: string | null = null;
  if (tier < 2) {
    const t = tier === 0 ? S.est : S.resp;
    progress = [
      { label: 'Contracts done', have: done, need: t.done },
      { label: 'Days on the AOC', have: days, need: t.days },
      { label: 'Reliability', have: Math.round(reliable), need: t.reliable },
      ...(tier === 1 ? [{ label: 'Clean record', have: Math.round(clean), need: S.resp.clean }] : []),
    ];
    const miss: string[] = [];
    if (done < t.done) miss.push(`${t.done - done} more contract${t.done - done === 1 ? '' : 's'}`);
    if (days < t.days) miss.push(`${t.days - days} days`);
    if (reliable < t.reliable) miss.push(`reliability ${t.reliable}`);
    if (tier === 1 && clean < S.resp.clean) miss.push(`clean ${S.resp.clean}`);
    next = `${miss.length ? miss.join(' and ') : 'nothing more'} to ${STANDING_NAME[(tier + 1) as 1 | 2]}`;
  }
  return { tier, name: STANDING_NAME[tier], text: STANDING_TEXT[tier], effects: STANDING_EFFECTS[tier], next, progress };
}

// ---------- daily / load ----------

const LEVEL_UP_TITLE: Record<ClientLevel, (n: string) => string> = {
  unhappy: (n) => `${n} is unhappy with us`,
  new: (n) => `${n} is willing to try us again`,
  known: (n) => `${n} knows us now`,
  trusted: (n) => `${n} now trusts us`,
  partner: (n) => `${n} is now a partner`,
};

/** What changed with a level, for the message body. */
function levelBody(c: Client, from: ClientLevel, to: ClientLevel): string {
  const voice = clientVoice(c.name, c.kind, to);
  const p = LEVEL_PERKS[to];
  if (to === 'unhappy') {
    const why = unhappyReasons(c).slice(0, 2).join('; ').toLowerCase();
    return `${why ? `${why[0].toUpperCase()}${why.slice(1)}. ` : ''}They'll call less and want 5 % off. Fly their next job on time and say yes to their next request.`;
  }
  const gains: string[] = [];
  if (p.first) gains.push('offers you first refusal');
  if (p.payDays) gains.push(`pays ${p.payDays} days sooner`);
  if (p.rate > 0) gains.push(`adds ${Math.round(p.rate * 100)} % to its rates`);
  const what = gains.length ? ` ${c.name} ${gains.length > 1 ? `${gains.slice(0, -1).join(', ')} and ${gains[gains.length - 1]}` : gains[0]}.` : '';
  const back = rank(to) < rank(from) ? ` Back to ${LEVEL_NAME[to]}.` : '';
  return `${voice ? `${voice} ` : ''}${what}${back}`.trim() || `${c.name}: ${LEVEL_NAME[to]} client.`;
}

/** Daily: client levels with hysteresis (one message per change), relation drift for idle clients monthly, standing. */
export function dailyRelations(g: GameState): void {
  const v8 = statsV08(g);
  for (const c of Object.values(g.clients)) {
    const was = c.level ?? levelFor(g, c, undefined);
    const now = levelFor(g, c, was);
    c.level = now;
    if (now === was) continue;
    // A first contract signed makes a New client Known: no message (the signing said it all).
    if (was === 'new' && now === 'known') continue;
    if (rank(now) > rank(was) && now !== 'unhappy') v8.levelUps++;
    const up = rank(now) > rank(was);
    pushMessage(g, {
      tone: now === 'unhappy' ? 'warn' : up ? 'good' : 'info', cat: 'commercial', title: up || now === 'unhappy' ? LEVEL_UP_TITLE[now](c.name) : `${c.name} is now a ${LEVEL_NAME[now]} client`,
      body: levelBody(c, was, now), ref: { kind: 'client', id: c.id }, ...(now === 'unhappy' ? { cue: 'clientCollapse' as const } : {}),
      ...(now === 'unhappy' ? { problem: { kind: 'clientUnhappy' as const, ref: { kind: 'client' as const, id: c.id } } } : {}),
    });
  }
  const s = standingNow(g);
  const cur = g.company.standing ?? s;
  if (s !== cur) {
    g.company.standing = s;
    if (s === 1 && cur === 0) v8.establishedAt ??= g.now;
    if (s === 2) v8.respectedAt ??= g.now;
    const done = g.stats.contractsDone ?? 0;
    const months = Math.max(1, Math.round((g.now - g.started) / (30.44 * DAY)));
    pushMessage(g, {
      tone: s > cur ? 'good' : 'warn', cat: 'company',
      title: s === 1 && cur === 0 ? "We're an established operator now" : s === 2 ? 'Brokers call us a respected operator' : 'Our standing has slipped to Established',
      body: s === 1 && cur === 0
        ? `${done} contracts flown and ${months} months on the AOC: brokers send longer programmes at normal rates, at normal hours.`
        : s === 2 ? 'Ten contracts and a clean, reliable year: capacity leases, presidential and Antarctic work now come our way, at 4 % better rates.'
        : 'Reliability or our clean record has dropped: the respected-operator work and its 4 % premium are gone until we recover.',
    });
  }
  g.company.standing = s;
}

/** Monthly (§1.3): clients with no flying for us in 120 days drift 1 toward 0 (replaces the flat −2 for everyone). */
export function monthlyRelationDrift(g: GameState): void {
  const R = V.rel;
  for (const c of Object.values(g.clients)) {
    if (!c.relation) continue;
    const busy = activeFor(g, c.id).length > 0 || (c.lastJob !== undefined && c.lastJob !== null && g.now - c.lastJob < R.driftIdleDays * DAY);
    if (busy) continue;
    const d = Math.min(R.drift, Math.abs(c.relation)) * -Math.sign(c.relation);
    if (d) bumpClient(g, c.id, d, '');
  }
}

/** v0.8 counters, created on first use. */
export function statsV08(g: GameState): NonNullable<GameState['stats']['v08']> {
  return (g.stats.v08 ??= { lostToRival: 0, subIn: 0, dryLeases: 0, dryMonths: 0, worldEvents: 0, closuresHit: 0, legsRerouted: 0, legsFm: 0, warRiskPaid: 0, injunctions: 0, whiteouts: 0, levelUps: 0, feesWaived: 0 });
}

/** Load (and new game): jobs, first/last job from the contracts in the save; levels and standing without messages. */
export function loadRelations(g: GameState): void {
  const done = new Map<string, Contract[]>();
  for (const k of Object.values(g.contracts)) if (k.status === 'completed') (done.get(k.clientId) ?? done.set(k.clientId, []).get(k.clientId)!).push(k);
  for (const c of Object.values(g.clients)) {
    const ks = done.get(c.id) ?? [];
    c.jobs ??= ks.length;
    if (c.firstJob === undefined) c.firstJob = ks.length ? Math.min(...ks.map((k) => k.end)) : null;
    if (c.lastJob === undefined) c.lastJob = ks.length ? Math.max(...ks.map((k) => k.end)) : null;
    c.log ??= [];
    c.level ??= levelFor(g, c, undefined);
  }
  g.company.standing ??= standingFor(g);
  statsV08(g);
}

/** 'Aug' style month for log lines. */
export const logMonth = (t: Minute) => fmtMonth(monthKey(t));
/** '12 Aug' for log lines. */
export const logDay = (t: Minute) => fmtDay(t);
